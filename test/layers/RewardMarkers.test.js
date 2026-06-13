// >>> TARS cap:reward-markers
//
// reward-markers — the (ui) "gold seal + label pill at each matched reward-shop"
// contract over the REAL RewardMarkerLayer and the REAL MapEngine route/floor/clear
// fan-out into that layer's selection.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT MAKES THESE BINDING (read before judging RED state):
//   • Criterion 1 (z-order) is read off the REAL engine's registered layer stack
//     (`renderer.layers.add(...)` order, captured by the Renderer mock). The
//     RewardMarkerLayer index must sit ABOVE LocationLayer and BELOW both marker
//     layers — asserted as concrete index comparisons, so a layer registered at the
//     wrong z (or not at all) goes RED.
//   • Criterion 2 drives the REAL MapEngine over the REAL routing stack
//     (BundleLoader -> LocationStore + MapGeometryStore.buildNavGraph -> PathFinder)
//     for a genuine cross-floor RouteResult whose per-floor polylines were probed
//     offline: F1 = [[2,5],[30,10],[38,30]], F2 = [[10,15],[50,15]]. Two NON-endpoint
//     reward-shops sit EXACTLY on those polylines (distance 0): shop 10 @ (30,10) on
//     F1, shop 11 @ (30,15) on F2. The selection is observed through the layer's
//     RENDERED seal anchors (a `['translate', x, y]` IS where a seal was drawn) — so
//     the engine must (a) build + register the layer, (b) recompute its selection on
//     navigateTo, (c) re-resolve it per active floor on setFloor, (d) empty it on
//     clearRoute. A no-op engine draws nothing and every assertion fails meaningfully.
//   • Criterion 3 unit-tests the layer in isolation with a recording 2D context and a
//     mock Image: one seal `drawImage` per selected shop, the drawn image's `src`
//     IS the `ICON_SEAL_PERCENT` constant (imported, not a literal), positioned at
//     the shop's projected display point (the `translate` anchor).
//   • Criterion 4 unit-tests the pill caption: a shop with ONE active reward draws
//     its reward `title` (a short title verbatim; a very long title truncated to a
//     bounded length that is a prefix of the original); a shop with n>=2 active
//     rewards draws the literal "<n> offers".
// ─────────────────────────────────────────────────────────────────────────────
//
// Targets (one per acceptance criterion):
//   1. RewardMarkerLayer z-index > LocationLayer and < PinMarkerLayer & NavMarkerLayer.
//   2. navigateTo -> selection = active-floor matches; setFloor -> other floor's
//      matches; clearRoute -> empty (no seal drawn on any floor).
//   3. renderWithContext draws one ICON_SEAL_PERCENT per selected shop at its point.
//   4. pill text = primary reward title (truncated) for one reward; "<n> offers" for n>=2.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ICON_SEAL_PERCENT } from '../../src/assets/icons.js';
import { makeRoutingBundle, SHOP_A_ID, SHOP_B_ID } from '../navigation/routingFixture.js';

// ─────────────────────────────────────────────────────────────────────────────
// Lazy layer resolution. The layer is not built yet; resolve it across the
// plausible export name so the suite COLLECTS cleanly and each test fails on a
// behavioural assertion rather than a module-resolution crash.
// ─────────────────────────────────────────────────────────────────────────────
async function importRewardMarkerLayer() {
  let mod = null;
  try { mod = await import('../../src/layers/RewardMarkerLayer.js'); } catch { mod = null; }
  expect(mod, 'src/layers/RewardMarkerLayer.js must exist').not.toBeNull();
  const Ctor = mod?.RewardMarkerLayer ?? mod?.default;
  expect(Ctor, 'RewardMarkerLayer.js must export a RewardMarkerLayer class').toBeTypeOf('function');
  return Ctor;
}

// A recording mock 2D context. `translate` captures the world point a seal/pill is
// positioned at (layers position via withScreenSpaceTransform -> translate(x,y));
// `fillText` captures the pill caption; `drawImage` captures the seal icon (its
// first arg is the Image whose `.src` identifies the icon). getTransform => identity.
function makeRecordingCtx() {
  const calls = [];
  const ctx = {
    calls,
    save() {}, restore() {},
    beginPath() {}, moveTo() {}, lineTo() {},
    quadraticCurveTo() {}, arcTo() {}, arc() {}, closePath() {},
    fill() {}, stroke() {}, clip() {}, rect() {},
    translate(x, y) { calls.push(['translate', x, y]); },
    rotate() {}, scale() {},
    fillText(text, x, y) { calls.push(['fillText', text, x, y]); },
    strokeText(text, x, y) { calls.push(['strokeText', text, x, y]); },
    measureText(t) { return { width: (typeof t === 'string' ? t.length : 4) * 8 }; },
    drawImage(img, ...rest) { calls.push(['drawImage', img, ...rest]); },
    getTransform() { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; },
    set fillStyle(_v) {}, set strokeStyle(_v) {}, set lineWidth(_v) {},
    set font(_v) {}, set textAlign(_v) {}, set textBaseline(_v) {}, set globalAlpha(_v) {}
  };
  return ctx;
}

const translateAnchors = (ctx) =>
  ctx.calls.filter((c) => c[0] === 'translate').map((c) => [c[1], c[2]]);
const drawnLabels = (ctx) =>
  ctx.calls.filter((c) => c[0] === 'fillText').map((c) => c[1]);
const drawnImageSrcs = (ctx) =>
  ctx.calls.filter((c) => c[0] === 'drawImage').map((c) => c[1]?.src);

// A mock Image: synchronously "loaded" (complete + non-zero natural size) so an
// icon-cache layer draws it immediately. Records the assigned src so the seal icon
// can be identified by `ICON_SEAL_PERCENT`. The src is normalised to the value the
// layer assigned (data URIs are not re-encoded by jsdom-less node).
function installMockImage() {
  const prev = globalThis.Image;
  globalThis.Image = class {
    constructor() {
      this._src = '';
      this.complete = true;
      this.naturalWidth = 64;
      this.naturalHeight = 64;
      this.width = 64;
      this.height = 64;
      this.onload = null;
      this.onerror = null;
    }
    set src(v) { this._src = v; this.complete = true; if (typeof this.onload === 'function') this.onload(); }
    get src() { return this._src; }
  };
  return () => { if (prev === undefined) delete globalThis.Image; else globalThis.Image = prev; };
}

// A document shim so any canvas-measure / tint-canvas path in the layer can run in
// node-env (returns a measuring 2D context; toDataURL returns a stable data URI).
function installMeasureDocument() {
  const prev = globalThis.document;
  globalThis.document = {
    createElement: () => ({
      width: 0, height: 0,
      getContext: () => ({
        set font(_v) {}, set fillStyle(_v) {}, set globalCompositeOperation(_v) {},
        clearRect() {}, drawImage() {}, fillRect() {},
        measureText: (t) => ({ width: (typeof t === 'string' ? t.length : 4) * 8 })
      }),
      toDataURL: () => 'data:image/png;base64,seal'
    })
  };
  return () => { if (prev === undefined) delete globalThis.document; else globalThis.document = prev; };
}

// ─────────────────────────────────────────────────────────────────────────────
// A reward selection entry, in the shape rewardRouteMatch() emits:
//   { shopId, levelCode, rewards:[{id,title,...}], location:{ displayNodes:[...] } }
// Build one with a display node on `levelCode` at (x,y) so the layer can project it.
// ─────────────────────────────────────────────────────────────────────────────
function selectionEntry({ shopId, levelCode, x, y, rewards }) {
  return {
    shopId,
    levelCode,
    rewards,
    location: {
      id: `shop:${shopId}`,
      title: `Shop ${shopId}`,
      displayNodes: [{ levelCode, unitId: 900 + shopId, point: { x, y } }]
    }
  };
}

// Push a selection onto the layer however the setter is spelled (setSelection is the
// design-contract name; tolerate a couple of synonyms so the test pins BEHAVIOUR).
function applySelection(layer, selection) {
  const fn = layer.setSelection ?? layer.setMatches ?? layer.setRewards;
  expect(typeof fn, 'RewardMarkerLayer must expose setSelection(selection)').toBe('function');
  fn.call(layer, selection);
}

// Shared across the two engine-driven describes (criteria 1 & 2). A single
// vi.hoisted() store — two separate ones would hoist to the same top-level scope
// and collide on the identifier.
const renderState = vi.hoisted(() => ({ addedLayers: [] }));

describe('reward-markers: gold seal + pill at each matched reward-shop', () => {
  // ───────────────────────────────────────────────────────────────────────────
  // Criterion 1 — z-order in the REAL MapEngine layer stack.
  // ───────────────────────────────────────────────────────────────────────────
  describe('criterion 1: RewardMarkerLayer z-order (above LocationLayer, below the marker layers)', () => {
    beforeEach(() => {
      globalThis.HTMLCanvasElement = class HTMLCanvasElement {};
      globalThis.document = {
        createElement: () => ({
          getContext: () => ({ set font(_v) {}, measureText: () => ({ width: 40 }) })
        })
      };
      globalThis.requestAnimationFrame = () => 1;
      globalThis.cancelAnimationFrame = () => {};
      renderState.addedLayers = [];
    });
    afterEach(() => {
      delete globalThis.HTMLCanvasElement;
      delete globalThis.document;
      delete globalThis.requestAnimationFrame;
      delete globalThis.cancelAnimationFrame;
      vi.restoreAllMocks();
      vi.resetModules();
    });

    function jsonResponse(obj) {
      return {
        ok: true, status: 200, headers: { get: () => 'application/json' },
        clone() { return jsonResponse(obj); }, json: () => Promise.resolve(obj)
      };
    }

    async function importMapEngine() {
      vi.doMock('../../src/renderer/Renderer.js', () => {
        class MockTransform {
          setScaleBounds() {}
          getScaleBounds() { return { min: 0.1, max: 8 }; }
          fitToBounds() {}
          getViewState() { return { scale: 1, panX: 0, panY: 0, rotation: 0 }; }
          setViewState() {}
          pan() {} zoom() {} centerOn() {} resetRotation() {}
          screenToWorld() { return { x: 0, y: 0 }; }
          getCanvasCenter() { return { x: 0, y: 0 }; }
          setMaxScaleFromFit() {}
        }
        return {
          Renderer: class {
            constructor() {
              this.transform = new MockTransform();
              this.layers = { add: (layer) => renderState.addedLayers.push(layer) };
              this.animator = { cancel() {} };
            }
            fitToBounds() {} animateTo() {} requestRender() {} resize() {} dispose() {}
          }
        };
      });
      vi.doMock('../../src/interaction/GestureRecognizer.js', () => ({
        GestureRecognizer: class { dispose() {} }
      }));
      vi.resetModules();
      const mod = await import('../../src/core/MapEngine.js');
      expect(mod.MapEngine, 'MapEngine.js must export a MapEngine class').toBeTypeOf('function');
      return mod.MapEngine;
    }

    async function createEngine() {
      const MapEngine = await importMapEngine();
      globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(makeRewardRoutingBundle()));
      const engine = new MapEngine(new globalThis.HTMLCanvasElement(), {
        mapsUrl: '/maps_bundle.json.gz',
        datasUrl: '/datas_bundle.json.gz',
        renderScale: 1,
        defaultFloor: 'F1'
      });
      await engine.init();
      return engine;
    }

    function indexByName(name) {
      return renderState.addedLayers.findIndex((l) => l?.name === name);
    }

    it('registers RewardMarkerLayer ABOVE LocationLayer and BELOW both PinMarkerLayer and NavMarkerLayer', async () => {
      await createEngine();

      const reward = indexByName('RewardMarkerLayer');
      const location = indexByName('LocationLayer');
      const pin = indexByName('PinMarkerLayer');
      const nav = indexByName('NavMarkerLayer');

      expect(reward, 'RewardMarkerLayer must be registered in the layer stack').toBeGreaterThanOrEqual(0);
      expect(location, 'LocationLayer must be registered').toBeGreaterThanOrEqual(0);
      expect(pin, 'PinMarkerLayer must be registered').toBeGreaterThanOrEqual(0);
      expect(nav, 'NavMarkerLayer must be registered').toBeGreaterThanOrEqual(0);

      // ABOVE labels, BELOW the start/end + connector bubbles (which draw on top).
      expect(reward, 'RewardMarkerLayer must draw above LocationLayer').toBeGreaterThan(location);
      expect(reward, 'RewardMarkerLayer must draw below PinMarkerLayer').toBeLessThan(pin);
      expect(reward, 'RewardMarkerLayer must draw below NavMarkerLayer').toBeLessThan(nav);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Criterion 2 — selection recomputed on route/floor/clear, observed through the
  //   REAL engine's RewardMarkerLayer rendered seal anchors.
  // ───────────────────────────────────────────────────────────────────────────
  describe('criterion 2: selection tracks route, active floor, and clear', () => {
    let restoreImage;
    let restoreDoc;

    beforeEach(() => {
      globalThis.HTMLCanvasElement = class HTMLCanvasElement {};
      globalThis.requestAnimationFrame = () => 1;
      globalThis.cancelAnimationFrame = () => {};
      restoreImage = installMockImage();
      restoreDoc = installMeasureDocument();
      renderState.addedLayers = [];
    });
    afterEach(() => {
      delete globalThis.HTMLCanvasElement;
      delete globalThis.requestAnimationFrame;
      delete globalThis.cancelAnimationFrame;
      restoreImage();
      restoreDoc();
      vi.restoreAllMocks();
      vi.resetModules();
    });

    function jsonResponse(obj) {
      return {
        ok: true, status: 200, headers: { get: () => 'application/json' },
        clone() { return jsonResponse(obj); }, json: () => Promise.resolve(obj)
      };
    }

    async function importMapEngine() {
      vi.doMock('../../src/renderer/Renderer.js', () => {
        class MockTransform {
          setScaleBounds() {}
          getScaleBounds() { return { min: 0.1, max: 8 }; }
          fitToBounds() {}
          getViewState() { return { scale: 1, panX: 0, panY: 0, rotation: 0 }; }
          setViewState() {}
          pan() {} zoom() {} centerOn() {} resetRotation() {}
          screenToWorld() { return { x: 0, y: 0 }; }
          getCanvasCenter() { return { x: 0, y: 0 }; }
          setMaxScaleFromFit() {}
        }
        return {
          Renderer: class {
            constructor() {
              this.transform = new MockTransform();
              this.layers = { add: (layer) => renderState.addedLayers.push(layer) };
              this.animator = { cancel() {} };
            }
            fitToBounds() {} animateTo() {} requestRender() {} resize() {} dispose() {}
          }
        };
      });
      vi.doMock('../../src/interaction/GestureRecognizer.js', () => ({
        GestureRecognizer: class { dispose() {} }
      }));
      vi.resetModules();
      const mod = await import('../../src/core/MapEngine.js');
      expect(mod.MapEngine, 'MapEngine.js must export a MapEngine class').toBeTypeOf('function');
      return mod.MapEngine;
    }

    async function createEngine() {
      const MapEngine = await importMapEngine();
      globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(makeRewardRoutingBundle()));
      const engine = new MapEngine(new globalThis.HTMLCanvasElement(), {
        mapsUrl: '/maps_bundle.json.gz',
        datasUrl: '/datas_bundle.json.gz',
        renderScale: 1,
        defaultFloor: 'F1'
      });
      await engine.init();
      return engine;
    }

    const layerByName = (name) => renderState.addedLayers.find((l) => l?.name === name) || null;

    // The seal anchors the reward layer draws on a given floor.
    function rewardAnchorsOn(layer, floorCode) {
      layer.setFloor(floorCode);
      const ctx = makeRecordingCtx();
      layer.renderWithContext({ ctx, invalidate() {} });
      return translateAnchors(ctx);
    }

    it('after navigateTo, the reward layer draws the active-floor matches; setFloor moves them; clearRoute empties', async () => {
      const engine = await createEngine();

      const result = engine.navigateTo(SHOP_A_ID, SHOP_B_ID);
      expect(result.success, 'cross-floor route must succeed').toBe(true);

      const rewardLayer = layerByName('RewardMarkerLayer');
      expect(rewardLayer, 'RewardMarkerLayer must be registered with the renderer').toBeTruthy();

      // Active floor after navigateTo is F1 (the start floor). The F1 reward-shop
      // (shop 10 @ (30,10), on the F1 polyline) draws a seal; the F2 reward-shop
      // (shop 11 @ (30,15)) does NOT draw on F1.
      const f1 = rewardAnchorsOn(rewardLayer, 'F1');
      expect(f1, 'F1 reward-shop seal must draw at its display point on F1').toContainEqual([30, 10]);
      expect(f1, 'F2 reward-shop must NOT draw while F1 is active').not.toContainEqual([30, 15]);

      // setFloor to F2 (the other traversed floor): the selection updates to F2's
      // match (shop 11 @ (30,15)); the F1 match no longer draws.
      const f2 = rewardAnchorsOn(rewardLayer, 'F2');
      expect(f2, 'F2 reward-shop seal must draw at its display point on F2').toContainEqual([30, 15]);
      expect(f2, 'F1 reward-shop must NOT draw while F2 is active').not.toContainEqual([30, 10]);

      // clearRoute empties the selection: nothing draws on EITHER floor.
      engine.clearRoute();
      expect(rewardAnchorsOn(rewardLayer, 'F1'),
        'no reward seal may draw on F1 after clearRoute').toEqual([]);
      expect(rewardAnchorsOn(rewardLayer, 'F2'),
        'no reward seal may draw on F2 after clearRoute').toEqual([]);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Criterion 3 — one ICON_SEAL_PERCENT per selected shop at its display point.
  // ───────────────────────────────────────────────────────────────────────────
  describe('criterion 3: one seal icon per selected shop at its projected point', () => {
    let restoreImage;
    let restoreDoc;
    beforeEach(() => { restoreImage = installMockImage(); restoreDoc = installMeasureDocument(); });
    afterEach(() => { restoreImage(); restoreDoc(); });

    it('draws exactly one ICON_SEAL_PERCENT seal per selected shop, anchored at each shop point', async () => {
      const RewardMarkerLayer = await importRewardMarkerLayer();
      const layer = new RewardMarkerLayer('F1');

      const selection = [
        selectionEntry({ shopId: 10, levelCode: 'F1', x: 30, y: 10, rewards: [{ id: 1, title: 'Latte deal' }] }),
        selectionEntry({ shopId: 12, levelCode: 'F1', x: 70, y: 20, rewards: [{ id: 2, title: 'Sale' }] }),
        // a shop on ANOTHER floor — must NOT draw while F1 is active.
        selectionEntry({ shopId: 11, levelCode: 'F2', x: 30, y: 15, rewards: [{ id: 3, title: 'BOGO' }] })
      ];
      applySelection(layer, selection);

      const ctx = makeRecordingCtx();
      layer.renderWithContext({ ctx, invalidate() {} });

      // Every seal image drawn is the ICON_SEAL_PERCENT icon (imported constant).
      const seals = drawnImageSrcs(ctx);
      expect(seals.length, 'one seal per F1 selected shop (the F2 shop is off-floor)').toBe(2);
      for (const src of seals) {
        expect(src, 'the drawn seal icon must be ICON_SEAL_PERCENT').toBe(ICON_SEAL_PERCENT);
      }

      // Each seal sits at its shop's projected display point.
      const anchors = translateAnchors(ctx);
      expect(anchors, 'seal for shop 10 at its display point').toContainEqual([30, 10]);
      expect(anchors, 'seal for shop 12 at its display point').toContainEqual([70, 20]);
      // The off-floor shop (F2) draws nothing on F1.
      expect(anchors, 'off-floor reward-shop must not draw on F1').not.toContainEqual([30, 15]);
    });

    it('draws nothing when the selection is empty', async () => {
      const RewardMarkerLayer = await importRewardMarkerLayer();
      const layer = new RewardMarkerLayer('F1');
      applySelection(layer, []);

      const ctx = makeRecordingCtx();
      layer.renderWithContext({ ctx, invalidate() {} });

      expect(drawnImageSrcs(ctx), 'no seal drawn for an empty selection').toEqual([]);
      expect(translateAnchors(ctx), 'no marker positioned for an empty selection').toEqual([]);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Criterion 4 — pill caption: truncated primary title for one reward; "<n> offers".
  // ───────────────────────────────────────────────────────────────────────────
  describe('criterion 4: pill caption (truncated title for one reward; "<n> offers" for many)', () => {
    let restoreImage;
    let restoreDoc;
    beforeEach(() => { restoreImage = installMockImage(); restoreDoc = installMeasureDocument(); });
    afterEach(() => { restoreImage(); restoreDoc(); });

    // The drawn pill caption for a single F1-selected shop (the non-seal fillText).
    function pillTextFor(layer, entry) {
      applySelection(layer, [entry]);
      const ctx = makeRecordingCtx();
      layer.renderWithContext({ ctx, invalidate() {} });
      const labels = drawnLabels(ctx);
      expect(labels.length, 'the pill must draw exactly one caption line').toBeGreaterThanOrEqual(1);
      return labels[0];
    }

    it('draws a SHORT single-reward title verbatim', async () => {
      const RewardMarkerLayer = await importRewardMarkerLayer();
      const layer = new RewardMarkerLayer('F1');

      const text = pillTextFor(layer, selectionEntry({
        shopId: 10, levelCode: 'F1', x: 30, y: 10,
        rewards: [{ id: 1, title: '20% off' }]
      }));
      expect(text, 'a short single-reward title is drawn verbatim').toBe('20% off');
    });

    it('TRUNCATES a long single-reward title to a bounded prefix of the original', async () => {
      const RewardMarkerLayer = await importRewardMarkerLayer();
      const layer = new RewardMarkerLayer('F1');

      const longTitle = 'Spend fifty dollars and receive a complimentary tote bag this weekend only';
      const text = pillTextFor(layer, selectionEntry({
        shopId: 10, levelCode: 'F1', x: 30, y: 10,
        rewards: [{ id: 1, title: longTitle }]
      }));

      // Truncation: shorter than the original and bounded (well under the full
      // length), and built from the original's leading characters (a prefix, modulo
      // a trailing ellipsis). The strip lets a "…"/"..." suffix pass.
      expect(text.length, 'a long title must be truncated, not drawn in full').toBeLessThan(longTitle.length);
      expect(text.length, 'the pill caption must be bounded to a short line').toBeLessThanOrEqual(40);
      const core = text.replace(/(\.\.\.|…)+\s*$/u, '');
      expect(longTitle.startsWith(core),
        'the truncated caption must be a leading prefix of the original title').toBe(true);
      expect(core.length, 'the truncated caption must retain real title text').toBeGreaterThan(0);
    });

    it('draws "<n> offers" when the shop has n>=2 active rewards', async () => {
      const RewardMarkerLayer = await importRewardMarkerLayer();
      const layer = new RewardMarkerLayer('F1');

      // Two active rewards -> "2 offers".
      const two = pillTextFor(layer, selectionEntry({
        shopId: 11, levelCode: 'F1', x: 30, y: 15,
        rewards: [{ id: 1, title: 'BOGO' }, { id: 2, title: 'Free gift' }]
      }));
      expect(two, 'two rewards -> aggregate "2 offers" pill').toBe('2 offers');

      // Three active rewards -> "3 offers" (the count is data-driven, not hardcoded 2).
      const three = pillTextFor(layer, selectionEntry({
        shopId: 12, levelCode: 'F1', x: 80, y: 25,
        rewards: [{ id: 1, title: 'A' }, { id: 2, title: 'B' }, { id: 3, title: 'C' }]
      }));
      expect(three, 'three rewards -> aggregate "3 offers" pill').toBe('3 offers');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Refinement criteria (5,6,7) — the marker becomes a START/END-style speech
// bubble OFFSET ABOVE the display point, reading as one inline row "⊛ <title>":
//
//   5. the seal is drawn INLINE BEFORE (left of) the caption — seal drawImage
//      centre x < caption fillText x, on roughly the same vertical band (one row,
//      not a vertical seal-under-pill stack).
//   6. EVERY drawn glyph (seal drawImage AND caption fillText) sits at NEGATIVE
//      screen-space y in the anchor frame, so the display point (y≈0, where the
//      shop label draws) is left clear; the bubble carries a downward tail whose
//      tip reaches the display point (modelled on PinMarkerLayer.#drawBubblePath).
//   7. the offset bubble stays tappable at the shop: hitTest at the display point
//      (the anchor, y≈0) still returns {type:'reward', shopId, …} — the tail tip
//      extends the hit target down to the display point.
//
// These are unit tests of the REAL layer in isolation, driven through a recording
// 2D context that ALSO records path commands (moveTo/lineTo/quadraticCurveTo) so
// the tail geometry is observable. The transform is identity (scale 1 / rot 0),
// so a `drawImage`/`fillText`/`lineTo` local coordinate IS its position in the
// anchor frame (the frame whose origin is the shop's display point).
// ─────────────────────────────────────────────────────────────────────────────
describe('reward-markers (refinement): seal-before-label inline bubble offset above the shop', () => {
  let restoreImage;
  let restoreDoc;
  beforeEach(() => { restoreImage = installMockImage(); restoreDoc = installMeasureDocument(); });
  afterEach(() => { restoreImage(); restoreDoc(); });

  // A recording context that captures path commands too (the base helper no-ops
  // them). Identity transform => recorded coords are anchor-frame coordinates.
  function makePathRecordingCtx() {
    const calls = [];
    const path = [];
    const ctx = {
      calls,
      path,
      save() {}, restore() {},
      beginPath() { path.length = 0; },
      moveTo(x, y) { path.push(['moveTo', x, y]); },
      lineTo(x, y) { path.push(['lineTo', x, y]); },
      quadraticCurveTo(cx, cy, x, y) { path.push(['quadraticCurveTo', cx, cy, x, y]); },
      arcTo() {}, arc() {}, closePath() {},
      fill() {}, stroke() {}, clip() {}, rect() {},
      translate(x, y) { calls.push(['translate', x, y]); },
      rotate() {}, scale() {},
      fillText(text, x, y) { calls.push(['fillText', text, x, y]); },
      strokeText(text, x, y) { calls.push(['strokeText', text, x, y]); },
      measureText(t) { return { width: (typeof t === 'string' ? t.length : 4) * 8 }; },
      drawImage(img, ...rest) { calls.push(['drawImage', img, ...rest]); },
      getTransform() { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; },
      set fillStyle(_v) {}, set strokeStyle(_v) {}, set lineWidth(_v) {},
      set font(_v) {}, set textAlign(_v) {}, set textBaseline(_v) {}, set globalAlpha(_v) {}
    };
    return ctx;
  }

  // The single seal drawImage call: {x,y} top-left, {cx,cy} centre, {top,bottom}
  // vertical span — all in the anchor frame (identity transform).
  function sealGlyph(ctx) {
    const call = ctx.calls.find((c) => c[0] === 'drawImage');
    expect(call, 'the marker must draw exactly one seal image').toBeTruthy();
    const [, , dx, dy, dw, dh] = call;
    expect([dx, dy, dw, dh].every((n) => typeof n === 'number'),
      'the seal must be drawn with explicit dx,dy,dw,dh').toBe(true);
    return { x: dx, y: dy, w: dw, h: dh, cx: dx + dw / 2, cy: dy + dh / 2, top: dy, bottom: dy + dh };
  }

  // The single caption fillText call: {x,y} baseline anchor in the anchor frame.
  function captionGlyph(ctx) {
    const call = ctx.calls.find((c) => c[0] === 'fillText');
    expect(call, 'the marker must draw exactly one caption').toBeTruthy();
    const [, text, x, y] = call;
    return { text, x, y };
  }

  async function renderOne(entry) {
    const RewardMarkerLayer = await importRewardMarkerLayer();
    const layer = new RewardMarkerLayer('F1');
    applySelection(layer, [entry]);
    const ctx = makePathRecordingCtx();
    layer.renderWithContext({ ctx, invalidate() {} });
    return { layer, ctx };
  }

  // The shared selection entry: one F1 reward-shop with a short single-reward
  // title, anchored at its display point (0,0) so the anchor frame == the
  // recorded-coordinate frame (no anchor offset to subtract).
  const ENTRY = () => selectionEntry({
    shopId: 77, levelCode: 'F1', x: 0, y: 0,
    rewards: [{ id: 1, title: '20% off' }]
  });

  // ── Criterion 5 — seal INLINE BEFORE (left of) the caption, same vertical band.
  it('draws the seal inline LEFT of the caption (seal centre x < caption x), on one row', async () => {
    const { ctx } = await renderOne(ENTRY());

    const seal = sealGlyph(ctx);
    const caption = captionGlyph(ctx);

    // Seal sits to the LEFT of the caption text — a horizontal "⊛ <title>" row.
    // (Fails today: the seal centres on the anchor at x≈0 and the caption centres
    // above it at x≈0 — identical x, a vertical stack.)
    expect(seal.cx, 'the seal must be drawn to the LEFT of the caption text')
      .toBeLessThan(caption.x);

    // They share roughly the same vertical band: the caption baseline lies within
    // the seal's vertical extent (one row, not seal-under-pill). A generous half-
    // seal-height tolerance keeps this about ROW co-location, not pixel identity.
    const tol = seal.h / 2;
    expect(Math.abs(caption.y - seal.cy),
      'seal and caption must share roughly one vertical band (one inline row)')
      .toBeLessThanOrEqual(tol);
  });

  // ── Criterion 6 — every drawn glyph at NEGATIVE y; tail tip reaches the point.
  it('offsets the WHOLE marker above the display point (every glyph at y<0) and tails down to it', async () => {
    const { ctx } = await renderOne(ENTRY());

    const seal = sealGlyph(ctx);
    const caption = captionGlyph(ctx);

    // The seal is drawn ENTIRELY above the display point — its lowest edge is
    // strictly negative, so it cannot cover the shop label at y≈0.
    // (Fails today: the seal is drawn at dy=-size/2, so its bottom edge is +size/2
    // — it straddles y=0 and covers the label.)
    expect(seal.bottom, 'the entire seal must sit above the display point (negative y)')
      .toBeLessThan(0);
    // The caption baseline is also above the display point.
    expect(caption.y, 'the caption must sit above the display point (negative y)')
      .toBeLessThan(0);

    // A downward tail reaches the display point: the bubble path includes a point
    // at (≈0, ≈0) — the tail tip meeting the anchor — while the bubble body is
    // offset up. Model: PinMarkerLayer.#drawBubblePath's tail apex at (0, tailBottomY).
    const pts = ctx.path.map((c) => {
      if (c[0] === 'quadraticCurveTo') return { x: c[3], y: c[4] };
      return { x: c[1], y: c[2] };
    });
    expect(pts.length, 'the bubble must trace a path (so it can carry a tail)')
      .toBeGreaterThan(0);
    const tailTip = pts.find((p) => Math.abs(p.x) <= 2 && Math.abs(p.y) <= 2);
    expect(tailTip, 'the bubble must carry a downward tail whose tip meets the display point (≈0,0)')
      .toBeTruthy();
    // The body of the bubble is genuinely offset up (some path point well above 0),
    // so the tail is a real spur, not the whole bubble sitting at the anchor.
    const minY = Math.min(...pts.map((p) => p.y));
    expect(minY, 'the bubble body must be offset above the display point')
      .toBeLessThan(-seal.h / 2);
  });

  // ── Criterion 7 — the offset bubble stays tappable at the shop's display point.
  it('still returns a reward hit AT the display point after the offset (tail tip is tappable)', async () => {
    const entry = ENTRY();
    const { layer } = await renderOne(entry);

    // Tap exactly at the shop's display point (the anchor, y≈0) — where the offset
    // bubble's tail tip lands. The hit target must still reach down here so the
    // existing reward-tap pipeline (RewardTap.test.js) keeps working.
    const hit = layer.hitTest(0, 0);
    expect(hit, 'a tap at the display point must still hit the offset reward marker').not.toBeNull();
    expect(hit.type, 'the hit is self-describing as a reward hit').toBe('reward');
    expect(hit.shopId, 'the hit carries the matched shopId verbatim').toBe(77);
    expect(hit.rewards, 'the hit carries the shop active rewards verbatim')
      .toEqual([{ id: 1, title: '20% off' }]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A routing bundle (the routingFixture cross-floor mall) AUGMENTED with two
// non-endpoint reward-shops placed EXACTLY on the probed route polylines, plus a
// `rewards` list (active window 2000->2099 so it is active under any real `now`
// the engine injects):
//   • shop 10 (unit 401) on F1 @ (30,10) — the route's F1 bend vertex (distance 0)
//   • shop 11 (unit 402) on F2 @ (30,15) — on the route's F2 segment (distance 0)
// The route shop:1 -> shop:3 (start/end, suppressed) traverses F1 then F2, so each
// reward-shop is matched on, and only on, its own floor.
// ─────────────────────────────────────────────────────────────────────────────
function makeRewardRoutingBundle() {
  const b = makeRoutingBundle();
  const F1_ID = 31;
  const F2_ID = 32;
  const square = (cx, cy, half = 2) => ({
    type: 'Polygon',
    coordinates: [[
      [cx - half, cy - half], [cx + half, cy - half],
      [cx + half, cy + half], [cx - half, cy + half], [cx - half, cy - half]
    ]]
  });
  const rewardUnit = ({ id, levelId, layerId, shopId, name, x, y }) => ({
    id, level_id: levelId, layer_id: layerId, kind: 'shop', name: '',
    geometry: square(x, y), display_point: [x, y], label_point: [x, y],
    label_rotation: 0, position: 0, is_active: true, hidden: false, locked: false,
    opacity: 1.0, stroke_color: '', stroke_width: null, fill_color: '',
    doors: [], connector_group_id: null, tenancies: [{ shop_id: shopId, name }]
  });
  b.units.push(rewardUnit({ id: 401, levelId: F1_ID, layerId: 2, shopId: 10, name: 'Reward F1', x: 30, y: 10 }));
  b.units.push(rewardUnit({ id: 402, levelId: F2_ID, layerId: 3, shopId: 11, name: 'Reward F2', x: 30, y: 15 }));
  const rewardShop = (id, name) => ({
    id, mall: 700, name, slug: `r${id}`, logo: null, description: '', category: 1,
    unit_number: `${id}`, contact_phone: '', contact_email: '', website: '',
    operating_hours: {}, is_active: true
  });
  b.shops.push(rewardShop(10, 'Reward F1'));
  b.shops.push(rewardShop(11, 'Reward F2'));
  const WINDOW_START = '2000-01-01T00:00:00Z';
  const WINDOW_END = '2099-12-31T23:59:59Z';
  b.rewards = [
    { id: 1001, title: 'Half-price latte', name: 'Half-price latte', type: 'deals', shops: [10], start_date: WINDOW_START, end_date: WINDOW_END },
    { id: 1002, title: 'Buy one get one', name: 'Buy one get one', type: 'rewards', shops: [11], start_date: WINDOW_START, end_date: WINDOW_END }
  ];
  return b;
}
// <<< TARS cap:reward-markers
