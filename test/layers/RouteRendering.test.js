// >>> TARS cap:route-rendering
//
// route-rendering — the (ui) "animated per-floor route polyline" contract over the
// REAL NavigationLayer and the REAL MapEngine navigate-then-frame path. The route
// itself is a genuine RouteResult produced by the REAL routing stack (BundleLoader
// -> LocationStore + MapGeometryStore.buildNavGraph -> PathFinder) over the SAME
// synthetic routing fixture the navmesh-routing suite uses (F0 meshless, F1 L-shape,
// F2 rectangle, F1<->F2 connectors). Counts/coords diverge from SGC on purpose, so a
// hard-coded layer/engine cannot pass.
//
// ─────────────────────────────────────────────────────────────────────────────
// BROWNFIELD-RETROFIT / REGRESSION-LOCK NOTICE (read before judging RED state):
// NavigationLayer (the RAF skeleton + per-floor slice + two-stroke draw) and
// MapEngine.navigateTo (the post-success setFloor(startAnchor.levelCode) +
// centerOn(startAnchor.x, startAnchor.y) framing reusing the focus camera path) were
// REBUILT IN PLACE by the EARLIER capabilities of this commit-free run (navmesh-
// routing produced the RouteResult with per-floor `segments` + `startAnchor`; the
// forked Canvas-2D shell carried the NavigationLayer animation skeleton). So the
// implementation LEGITIMATELY PRE-EXISTS — there is no untouched module to make this
// temporally RED. These tests therefore stand as a REGRESSION LOCK on a pre-existing
// contract: assertion-shaped and binding, fault-injection-verified (deleting/zeroing
// the per-floor filter, the two-stroke draw, the animation start/stop, or the engine
// setFloor/centerOn handoff each flips a criterion RED on a meaningful assertion).
// The structured return reports `failsForRightReason` honestly for the slice-of-the-
// suite that is genuinely pre-impl vs. regression-lock.
// ─────────────────────────────────────────────────────────────────────────────
//
// Targets (one per acceptance criterion):
//   1. NavigationLayer.setPath(routeResult) for a 2-floor route -> hasPath()===true;
//      with F1 active the drawn points equal segments.get('F1'); after setFloor('F2')
//      they equal segments.get('F2').
//   2. setFloor to a floor NOT in segments (F0) -> hasPath()===false, draws nothing,
//      no throw.
//   3. setPath starts the animation (getAnimationStatus().isAnimating===true);
//      clearPath() stops it (isAnimating===false) and drops the stored result.
//   4. renderWithContext draws TWO strokes (full grey + partial animated) using
//      segment[i][0]/[1] coords — asserted via a mock 2D context recording
//      moveTo/lineTo over the active floor's points.
//   5. After engine.navigateTo success, the engine setFloors to startAnchor.levelCode
//      and centerOns (startAnchor.x, startAnchor.y) (reusing the focus camera path).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BundleLoader } from '../../src/data/BundleLoader.js';
import { LocationStore } from '../../src/data/LocationModel.js';
import { MapGeometryStore } from '../../src/data/MapGeometryModel.js';
import { NavigationLayer } from '../../src/layers/NavigationLayer.js';
import {
  makeRoutingBundle,
  SHOP_A_ID as RR_SHOP_A_ID,
  SHOP_B_ID as RR_SHOP_B_ID
} from '../navigation/routingFixture.js';

// ─────────────────────────────────────────────────────────────────────────────
// Per-floor polyline ground truth (hard-coded from the routing fixture geometry,
// NOT mirrored from the implementation). The cross-floor route shop:1(F1) ->
// shop:3(F2) funnels these exact world points; a hard-coded or broken slicer fails.
// ─────────────────────────────────────────────────────────────────────────────
const RR_EXPECT_F1 = [[2, 5], [30, 10], [38, 30]];
const RR_EXPECT_F2 = [[10, 15], [50, 15]];
const RR_EXPECT_START_ANCHOR = { levelCode: 'F1', x: 2, y: 5 };

// A recording mock 2D canvas context: captures the ORDERED moveTo/lineTo/stroke
// calls so the layer's drawn geometry is observed, not assumed. The style setters
// are inert (the criterion is about COORDINATES + stroke count, not colours).
function makeRecordingCtx() {
  const calls = [];
  return {
    calls,
    save() {},
    restore() {},
    beginPath() {},
    moveTo(x, y) { calls.push(['moveTo', x, y]); },
    lineTo(x, y) { calls.push(['lineTo', x, y]); },
    stroke() { calls.push(['stroke']); },
    set strokeStyle(_v) {},
    set lineWidth(_v) {},
    set lineCap(_v) {},
    set lineJoin(_v) {}
  };
}

// The moveTo/lineTo coordinate pairs the layer emitted, in order (strokes dropped).
function pointCalls(ctx) {
  return ctx.calls.filter((c) => c[0] === 'moveTo' || c[0] === 'lineTo');
}
function strokeCount(ctx) {
  return ctx.calls.filter((c) => c[0] === 'stroke').length;
}

// The FULL polyline the layer draws (the grey bottom path), reconstructed from the
// FIRST contiguous moveTo + lineTo run — i.e. up to (but excluding) the SECOND
// moveTo, which begins the partial animated top path. Returns `[[x,y],...]`.
function fullPathDrawn(ctx) {
  const pts = pointCalls(ctx);
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    if (i > 0 && pts[i][0] === 'moveTo') break; // second moveTo => top path begins
    out.push([pts[i][1], pts[i][2]]);
  }
  return out;
}

// Build the route system over the synthetic fixture and produce a real cross-floor
// RouteResult (shop:1 on F1 -> shop:3 on F2). Mirrors the engine seam exactly.
async function makeCrossFloorRoute() {
  const loader = new BundleLoader({ load: () => Promise.resolve(makeRoutingBundle()) });
  const model = await loader.load('/bundle.json');

  const locationStore = new LocationStore();
  locationStore.hydrate(model, { renderScale: 1 });
  const geometryStore = new MapGeometryStore();
  geometryStore.hydrate(model, { renderScale: 1 });

  const { PathFinder } = await import('../../src/navigation/PathFinder.js');
  const navGraph = geometryStore.buildNavGraph(model.transitions);
  const pathFinder = new PathFinder(navGraph, locationStore);

  const result = pathFinder.findPath(RR_SHOP_A_ID, RR_SHOP_B_ID);
  expect(result.success, 'fixture cross-floor route must succeed').toBe(true);
  return result;
}

// segments.get(floor) regardless of Map vs plain-object representation.
function segOf(result, floor) {
  const s = result.segments;
  if (s instanceof Map) return s.get(floor);
  return s?.[floor];
}

// Renderer-mock capture state for criterion 5 (engine camera). Hoisted at module
// top level so the vi.mock factory in importMapEngine can close over it.
const renderState = vi.hoisted(() => ({ fits: [], animations: [], addedLayers: [] }));

describe('route-rendering: animated per-floor route polyline', () => {
  // The NavigationLayer's RAF loop calls requestAnimationFrame/cancelAnimationFrame,
  // which are absent in node-env. Shim them as inert: a frame is scheduled but never
  // re-fires (no synchronous recursion), so getAnimationStatus()/renderWithContext
  // are driven deterministically by the test, not the event loop.
  let savedRaf;
  let savedCaf;
  beforeEach(() => {
    savedRaf = globalThis.requestAnimationFrame;
    savedCaf = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = () => 1;
    globalThis.cancelAnimationFrame = () => {};
  });
  afterEach(() => {
    if (savedRaf === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = savedRaf;
    if (savedCaf === undefined) delete globalThis.cancelAnimationFrame;
    else globalThis.cancelAnimationFrame = savedCaf;
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Criterion 1 — setPath + per-floor slice; F1 points then F2 points after switch.
  // ───────────────────────────────────────────────────────────────────────────
  describe('criterion 1: setPath slices to the active floor, re-slices on setFloor', () => {
    it('hasPath() is true for a 2-floor route with the start floor active', async () => {
      const result = await makeCrossFloorRoute();
      const layer = new NavigationLayer('F1');
      layer.setPath(result);
      expect(layer.hasPath()).toBe(true);
    });

    it("with F1 active, the drawn polyline equals segments.get('F1')", async () => {
      const result = await makeCrossFloorRoute();
      // sanity: the fixture really carries the expected F1 slice.
      expect(segOf(result, 'F1')).toEqual(RR_EXPECT_F1);

      const layer = new NavigationLayer('F1');
      layer.setPath(result);

      const ctx = makeRecordingCtx();
      layer.renderWithContext({ ctx, invalidate() {} });

      // The grey full path the layer draws is exactly the F1 segment polyline.
      expect(fullPathDrawn(ctx)).toEqual(RR_EXPECT_F1);
      // And it equals segments.get('F1') (the binding criterion, not a literal).
      expect(fullPathDrawn(ctx)).toEqual(segOf(result, 'F1'));
    });

    it("after setFloor('F2') the drawn polyline equals segments.get('F2')", async () => {
      const result = await makeCrossFloorRoute();
      expect(segOf(result, 'F2')).toEqual(RR_EXPECT_F2);

      const layer = new NavigationLayer('F1');
      layer.setPath(result);
      layer.setFloor('F2');

      const ctx = makeRecordingCtx();
      layer.renderWithContext({ ctx, invalidate() {} });

      // The re-sliced polyline is now the F2 segment — different points, proving
      // the layer re-slices on floor switch rather than caching the F1 slice.
      expect(fullPathDrawn(ctx)).toEqual(RR_EXPECT_F2);
      expect(fullPathDrawn(ctx)).toEqual(segOf(result, 'F2'));
      expect(fullPathDrawn(ctx)).not.toEqual(RR_EXPECT_F1);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Criterion 1b — the line reaches the SHOP anchor, not just the routing door.
  //   The navmesh path terminates at the door (corridor edge); the drawn polyline
  //   must extend a cosmetic leg to the shop's display anchor (where the pin sits)
  //   so the line meets the pin. Door-less units (anchor ≈ display point) get no
  //   leg; the leg only appears when the door diverges from the shop anchor.
  // ───────────────────────────────────────────────────────────────────────────
  describe('criterion 1b: the polyline extends to the shop anchor (the pin), not the door', () => {
    // A same-floor route whose anchors are snapped to DOORS that diverge from the
    // shops' display anchors: start door (100,200) vs Shop A display (10,20);
    // end door (140,240) vs Shop B display (50,60).
    function makeDoorDivergentResult() {
      return {
        success: true,
        startAnchor: { levelCode: 'F1', x: 100, y: 200 },
        endAnchor: { levelCode: 'F1', x: 140, y: 240 },
        startLocation: {
          title: 'Shop A',
          nodes: [],
          displayNodes: [{ levelCode: 'F1', unitId: 301, point: { x: 10, y: 20 } }]
        },
        endLocation: {
          title: 'Shop B',
          nodes: [],
          displayNodes: [{ levelCode: 'F1', unitId: 303, point: { x: 50, y: 60 } }]
        },
        segments: new Map([['F1', [[100, 200], [120, 220], [140, 240]]]]),
        transitions: []
      };
    }

    it('prepends the start shop anchor and appends the end shop anchor to the drawn line', () => {
      const layer = new NavigationLayer('F1');
      layer.setPath(makeDoorDivergentResult());

      const ctx = makeRecordingCtx();
      layer.renderWithContext({ ctx, invalidate() {} });

      // The grey line now runs: start shop anchor -> door -> ...door... -> end shop anchor.
      expect(fullPathDrawn(ctx)).toEqual([
        [10, 20], // start shop anchor (the pin) — prepended leg
        [100, 200], // start door (navmesh terminus)
        [120, 220],
        [140, 240], // end door (navmesh terminus)
        [50, 60] // end shop anchor (the pin) — appended leg
      ]);
    });

    it('adds NO leg when the route carries no Location metadata (anchor-only fallback)', () => {
      const layer = new NavigationLayer('F1');
      layer.setPath({
        success: true,
        startAnchor: { levelCode: 'F1', x: 100, y: 200 },
        endAnchor: { levelCode: 'F1', x: 140, y: 240 },
        startLocation: null,
        endLocation: null,
        segments: new Map([['F1', [[100, 200], [140, 240]]]]),
        transitions: []
      });

      const ctx = makeRecordingCtx();
      layer.renderWithContext({ ctx, invalidate() {} });

      // No Location => the door endpoints are the only known points; draw them as-is.
      expect(fullPathDrawn(ctx)).toEqual([[100, 200], [140, 240]]);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Criterion 2 — a floor NOT in segments (F0): no path, draws nothing, no throw.
  // ───────────────────────────────────────────────────────────────────────────
  describe('criterion 2: a floor absent from segments draws nothing', () => {
    it('setFloor to F0 (not in segments) -> hasPath() is false', async () => {
      const result = await makeCrossFloorRoute();
      // sanity: the route has no F0 segment.
      expect(segOf(result, 'F0')).toBeUndefined();

      const layer = new NavigationLayer('F1');
      layer.setPath(result);
      expect(layer.hasPath()).toBe(true); // sanity before the switch

      layer.setFloor('F0');
      expect(layer.hasPath()).toBe(false);
    });

    it('renderWithContext on F0 draws nothing and does not throw', async () => {
      const result = await makeCrossFloorRoute();
      const layer = new NavigationLayer('F1');
      layer.setPath(result);
      layer.setFloor('F0');

      const ctx = makeRecordingCtx();
      expect(() => layer.renderWithContext({ ctx, invalidate() {} })).not.toThrow();
      // No geometry was emitted for a floor the route does not touch.
      expect(ctx.calls).toEqual([]);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Criterion 3 — setPath starts the animation; clearPath stops it + drops result.
  // ───────────────────────────────────────────────────────────────────────────
  describe('criterion 3: setPath starts the animation, clearPath stops it', () => {
    it('setPath sets getAnimationStatus().isAnimating to true', async () => {
      const result = await makeCrossFloorRoute();
      const layer = new NavigationLayer('F1');
      // sanity: nothing animating before a path is set.
      expect(layer.getAnimationStatus().isAnimating).toBe(false);

      layer.setPath(result);
      expect(layer.getAnimationStatus().isAnimating).toBe(true);
    });

    it('clearPath() stops the animation and drops the stored result', async () => {
      const result = await makeCrossFloorRoute();
      const layer = new NavigationLayer('F1');
      layer.setPath(result);
      expect(layer.getAnimationStatus().isAnimating).toBe(true); // sanity

      layer.clearPath();
      expect(layer.getAnimationStatus().isAnimating).toBe(false);
      // The stored route result is dropped, and nothing remains to draw.
      expect(layer.getPathResult()).toBeNull();
      expect(layer.hasPath()).toBe(false);

      const ctx = makeRecordingCtx();
      layer.renderWithContext({ ctx, invalidate() {} });
      expect(ctx.calls).toEqual([]);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Criterion 4 — two strokes (full grey + partial animated) over the active floor.
  // ───────────────────────────────────────────────────────────────────────────
  describe('criterion 4: renderWithContext draws two strokes over the active floor', () => {
    it('emits exactly two stroke() calls — the full grey path and the partial top path', async () => {
      const result = await makeCrossFloorRoute();
      const layer = new NavigationLayer('F1');
      layer.setPath(result);

      const ctx = makeRecordingCtx();
      layer.renderWithContext({ ctx, invalidate() {} });

      // Two strokes: the grey full path underneath + the animated progress stroke.
      expect(strokeCount(ctx)).toBe(2);
    });

    it('both strokes use the active floor segment[i][0]/[1] coordinates', async () => {
      const result = await makeCrossFloorRoute();
      const seg = segOf(result, 'F1'); // [[x,y],...]
      const layer = new NavigationLayer('F1');
      layer.setPath(result);

      const ctx = makeRecordingCtx();
      layer.renderWithContext({ ctx, invalidate() {} });

      const pts = pointCalls(ctx);
      // The full grey path moves to segment[0] then lines to each subsequent vertex.
      expect(pts[0]).toEqual(['moveTo', seg[0][0], seg[0][1]]);
      expect(pts[1]).toEqual(['lineTo', seg[1][0], seg[1][1]]);
      expect(pts[2]).toEqual(['lineTo', seg[2][0], seg[2][1]]);

      // The partial animated path is a SECOND sub-path that also starts at segment[0]
      // (segment[i][0]/[1]) — a distinct moveTo after the full path's lineTos.
      const secondMoveTo = pts.findIndex((c, i) => i > 0 && c[0] === 'moveTo');
      expect(secondMoveTo, 'a second sub-path (the animated stroke) must begin').toBeGreaterThan(0);
      expect(pts[secondMoveTo]).toEqual(['moveTo', seg[0][0], seg[0][1]]);
    });

    it('the F2 slice draws its own two strokes from segments.get(F2), not the F1 coords', async () => {
      const result = await makeCrossFloorRoute();
      const layer = new NavigationLayer('F1');
      layer.setPath(result);
      layer.setFloor('F2');

      const ctx = makeRecordingCtx();
      layer.renderWithContext({ ctx, invalidate() {} });

      expect(strokeCount(ctx)).toBe(2);
      const pts = pointCalls(ctx);
      const seg = segOf(result, 'F2');
      expect(pts[0]).toEqual(['moveTo', seg[0][0], seg[0][1]]);
      // none of the emitted points belong to the F1 slice's interior vertex (30,10).
      expect(pts.some((c) => c[1] === 30 && c[2] === 10)).toBe(false);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Criterion 5 — after navigateTo success the engine setFloors to the start
  //               anchor's level and centerOns its (x,y), reusing the focus camera.
  // ───────────────────────────────────────────────────────────────────────────
  describe('criterion 5: navigateTo frames the start anchor via setFloor + centerOn', () => {
    // ── Renderer mock (captured in module-top `renderState`): records the camera the
    //    engine drives. animateTo records the animated focus target; the real layers
    //    are added via layers.add. The transform baseline scale is 1.
    beforeEach(() => {
      globalThis.HTMLCanvasElement = class HTMLCanvasElement {};
      renderState.fits = [];
      renderState.animations = [];
      renderState.addedLayers = [];
    });
    afterEach(() => {
      delete globalThis.HTMLCanvasElement;
      vi.restoreAllMocks();
      vi.resetModules();
    });

    function jsonResponse(obj) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        clone() { return jsonResponse(obj); },
        json: () => Promise.resolve(obj)
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
        }
        return {
          Renderer: class {
            constructor() {
              this.transform = new MockTransform();
              this.layers = { add: (layer) => renderState.addedLayers.push(layer) };
              this.animator = { cancel() {} };
            }
            fitToBounds(bounds) { renderState.fits.push(bounds); }
            animateTo(target) { renderState.animations.push(target); }
            requestRender() {}
            resize() {}
            dispose() {}
          }
        };
      });
      // The gesture recognizer is DOM-bound; inert shell.
      vi.doMock('../../src/interaction/GestureRecognizer.js', () => ({
        GestureRecognizer: class { dispose() {} }
      }));
      vi.resetModules();
      let mod = null;
      try {
        mod = await import('../../src/core/MapEngine.js');
      } catch {
        mod = null;
      }
      expect(mod, 'src/core/MapEngine.js must exist and export MapEngine').not.toBeNull();
      expect(mod.MapEngine, 'MapEngine.js must export a MapEngine class').toBeTypeOf('function');
      return mod.MapEngine;
    }

    async function createEngineOnF2() {
      const MapEngine = await importMapEngine();
      globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(makeRoutingBundle()));
      const engine = new MapEngine(new globalThis.HTMLCanvasElement(), {
        mapsUrl: '/maps_bundle.json.gz',
        datasUrl: '/datas_bundle.json.gz',
        renderScale: 1,
        defaultFloor: 'F2' // boot AWAY from the route's start floor (F1)
      });
      await engine.init();
      return engine;
    }

    it('navigateTo switches the engine to the start anchor floor (F1), not the boot floor (F2)', async () => {
      const engine = await createEngineOnF2();
      expect(engine.getCurrentFloor()).toBe('F2'); // sanity: booted on F2

      const result = engine.navigateTo(RR_SHOP_A_ID, RR_SHOP_B_ID);
      expect(result.success).toBe(true);
      // startAnchor is on F1 — the engine must switch to it.
      expect(result.startAnchor.levelCode).toBe(RR_EXPECT_START_ANCHOR.levelCode);
      expect(engine.getCurrentFloor()).toBe('F1');
    });

    it('navigateTo centerOns the start anchor (x,y) reusing the focus camera (animated, zoom-in)', async () => {
      const engine = await createEngineOnF2();

      // Spy on the engine's OWN centerOn — the reused focus camera path the
      // criterion names. (centerOn is the collaborator the navigate path delegates
      // framing to; navigateTo is the unit under test.)
      const centerSpy = vi.spyOn(engine, 'centerOn');

      const result = engine.navigateTo(RR_SHOP_A_ID, RR_SHOP_B_ID);
      expect(result.success).toBe(true);
      expect(result.startAnchor.x).toBe(RR_EXPECT_START_ANCHOR.x);
      expect(result.startAnchor.y).toBe(RR_EXPECT_START_ANCHOR.y);

      expect(centerSpy).toHaveBeenCalledTimes(1);
      const [x, y, opts] = centerSpy.mock.calls[0];
      expect(x).toBe(RR_EXPECT_START_ANCHOR.x);
      expect(y).toBe(RR_EXPECT_START_ANCHOR.y);
      // reuses the focus camera: animated, with a zoom-in scale beyond the baseline 1.
      expect(opts.animate).toBe(true);
      expect(opts.scale).toBeGreaterThan(1);
    });

    it('the animated camera target frames the start anchor (a single animateTo, scale > 1)', async () => {
      const engine = await createEngineOnF2();
      renderState.animations = [];

      const result = engine.navigateTo(RR_SHOP_A_ID, RR_SHOP_B_ID);
      expect(result.success).toBe(true);

      // The engine pushed exactly one animated camera frame for the start anchor —
      // not a teleport, and a zoom-in past the baseline scale of 1.
      const cam = renderState.animations[renderState.animations.length - 1];
      expect(cam, 'navigateTo must push an animated camera target').toBeTruthy();
      expect(cam.scale).toBeGreaterThan(1);
      expect(cam.duration).toBeGreaterThan(0);
    });
  });
});
// <<< TARS cap:route-rendering
