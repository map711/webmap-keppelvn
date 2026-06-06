// >>> TARS cap:route-markers
//
// route-markers — the (ui) "start/end pins + floor-transition bubbles" contract over
// the REAL PinMarkerLayer / NavMarkerLayer and the REAL MapEngine clear-route fan-out.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT MAKES THESE BINDING (read before judging RED state):
//   • Anchors/transitions are observed through a RECORDING mock 2D context. The
//     layers draw their bubbles via `withScreenSpaceTransform`, which `translate`s to
//     the world anchor before drawing — so a `['translate', x, y]` call IS the rendered
//     pin/bubble position, observed not assumed. `fillText` carries the bubble label
//     (the up/down arrow glyph + target floor).
//   • The transition route results give the stored `transitions[]` flat
//     `fromX/fromY/toX/toY` coordinates that DIVERGE from the per-floor `segments`
//     endpoints (fromX=200,201 vs the F1 segment endpoint 38,30; toX=300,301 vs the F2
//     segment start 10,15). The acceptance contract is that NavMarkerLayer STORES
//     `routeResult.transitions` and draws at `(transition.fromX, fromY)` / `(toX, toY)`
//     — so an implementation that instead re-derives the anchor from the flattened
//     `segments` (the brownfield behaviour) draws at the WRONG point and these tests go
//     RED on a coordinate assertion. The divergence is the fault injection.
//   • Criterion 4 drives the REAL MapEngine over the REAL routing stack (BundleLoader ->
//     LocationStore + MapGeometryStore.buildNavGraph -> PathFinder) for a genuine cross-
//     floor RouteResult, then asserts `clearRoute()` leaves NO geometry on EITHER floor
//     across all three layers — a regression-lock on the engine's clear fan-out.
// ─────────────────────────────────────────────────────────────────────────────
//
// Targets (one per acceptance criterion):
//   1. PinMarkerLayer.setPath(routeResult): a pin draws ONLY on its anchor's active
//      floor (verified by switching floors). With no Location metadata the pin sits
//      at the route anchor.
//   1b. The pin marks the SHOP, not the routing door: when a Location carries a
//      display node on the active floor, the pin renders at that display anchor
//      (unit centroid / label_point), NOT the snapped door anchor — the polyline
//      still terminates at the door. Anchor is the no-Location fallback.
//   2. NavMarkerLayer.setPath stores routeResult.transitions; departure floor active ->
//      bubble at (transition.fromX, fromY) with an UP arrow (toOrdinal > fromOrdinal);
//      arrival floor active -> bubble at (transition.toX, toY) with a DOWN arrow.
//   3. NavMarkerLayer.hitTest over a rendered bubble returns the target level code
//      (departure bubble -> toLevelCode; arrival bubble -> fromLevelCode); a miss -> null.
//   4. MapEngine.clearRoute() clears all three layers: no start/end pin, no bubble, no
//      polyline drawn on ANY floor afterwards.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PinMarkerLayer } from '../../src/layers/PinMarkerLayer.js';
import { NavMarkerLayer } from '../../src/layers/NavMarkerLayer.js';
import {
  makeRoutingBundle,
  SHOP_A_ID as RM_SHOP_A_ID,
  SHOP_B_ID as RM_SHOP_B_ID
} from '../navigation/routingFixture.js';

// ─────────────────────────────────────────────────────────────────────────────
// A recording mock 2D context. `translate` captures the world anchor the layer
// positions a marker at (via withScreenSpaceTransform); `fillText` captures the
// bubble/pin label text (the arrow glyph + target floor for nav bubbles, the
// destination title for the end pin). Bubble-path / fill / stroke / image draws
// are inert — the criteria are about ANCHOR position + arrow direction, not paint.
// getTransform returns identity so scale=1, rotation=0 (deterministic hit-testing).
// ─────────────────────────────────────────────────────────────────────────────
function makeRecordingCtx() {
  const calls = [];
  const ctx = {
    calls,
    save() {}, restore() {},
    beginPath() {}, moveTo() {}, lineTo() {},
    quadraticCurveTo() {}, closePath() {},
    fill() {}, stroke() {},
    translate(x, y) { calls.push(['translate', x, y]); },
    rotate() {}, scale() {},
    fillText(text, x, y) { calls.push(['fillText', text, x, y]); },
    measureText() { return { width: 40 }; },
    drawImage() {},
    getTransform() { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; },
    set fillStyle(_v) {}, set strokeStyle(_v) {}, set lineWidth(_v) {},
    set font(_v) {}, set textAlign(_v) {}, set textBaseline(_v) {}
  };
  return ctx;
}

// The world anchors the layer translated a marker to, in order: [[x,y],...].
function translateAnchors(ctx) {
  return ctx.calls.filter((c) => c[0] === 'translate').map((c) => [c[1], c[2]]);
}

// The label text the layer drew (bubble/pin captions), in order.
function drawnLabels(ctx) {
  return ctx.calls.filter((c) => c[0] === 'fillText').map((c) => c[1]);
}

// NavMarkerLayer measures bubble width through a document.createElement('canvas')
// measure-context; node-env has no document. Provide an inert measuring shim so
// the bubble geometry (used for both draw and hit-test) computes.
function installMeasureDocument() {
  const prev = globalThis.document;
  globalThis.document = {
    createElement: () => ({
      getContext: () => ({ set font(_v) {}, measureText: () => ({ width: 40 }) })
    })
  };
  return () => {
    if (prev === undefined) delete globalThis.document;
    else globalThis.document = prev;
  };
}

// Level ordinals for the synthetic fixture: F0=50, F1=100, F2=200. The up/down arrow
// is derived from these — F1->F2 is UP (200 > 100), F2->F1 is DOWN.
const RM_ORDINALS = new Map([['F0', 50], ['F1', 100], ['F2', 200]]);

const ARROW_UP = '⬆';   // ⬆
const ARROW_DOWN = '⬇'; // ⬇

// A cross-floor route result whose stored transition flat coords DELIBERATELY DIVERGE
// from the per-floor segment endpoints, so a bubble drawn from the stored transition
// (the contract) is distinguishable from one re-derived off the segments polyline.
//   F1 segment endpoint = (38,30)   but   transition.fromX/fromY = (200,201)
//   F2 segment start     = (10,15)   but   transition.toX/toY     = (300,301)
function makeDivergentCrossFloorResult() {
  return {
    success: true,
    startAnchor: { levelCode: 'F1', x: 2, y: 5 },
    endAnchor: { levelCode: 'F2', x: 50, y: 15 },
    startLocation: { title: 'Shop A' },
    endLocation: { title: 'Shop B' },
    segments: new Map([
      ['F1', [[2, 5], [30, 10], [38, 30]]],
      ['F2', [[10, 15], [50, 15]]]
    ]),
    transitions: [
      {
        kind: 'escalator',
        fromLevelCode: 'F1',
        toLevelCode: 'F2',
        levelCodes: ['F1', 'F2'],
        fromX: 200, fromY: 201,
        toX: 300, toY: 301,
        cost: 1,
        is_accessible: false
      }
    ]
  };
}

describe('route-markers: start/end pins + floor-transition bubbles', () => {
  // ───────────────────────────────────────────────────────────────────────────
  // Criterion 1 — PinMarkerLayer: start pin at startAnchor only on its floor; end
  //               pin at endAnchor only on its floor.
  // ───────────────────────────────────────────────────────────────────────────
  describe('criterion 1: PinMarkerLayer pins the start/end anchors to their own floors', () => {
    function makeRouteResult() {
      return {
        success: true,
        startAnchor: { levelCode: 'F1', x: 2, y: 5 },
        endAnchor: { levelCode: 'F2', x: 50, y: 15 },
        startLocation: { title: 'Shop A' },
        endLocation: { title: 'Shop B' },
        segments: new Map([['F1', [[2, 5]]], ['F2', [[50, 15]]]]),
        transitions: []
      };
    }

    it('with the start floor (F1) active, draws the start pin at startAnchor.(x,y) and NOT the end pin', () => {
      const layer = new PinMarkerLayer('F1');
      layer.setPath(makeRouteResult());

      const ctx = makeRecordingCtx();
      layer.renderWithContext({ ctx, invalidate() {} });

      const anchors = translateAnchors(ctx);
      // Exactly one marker positioned — the start pin at startAnchor (2,5).
      expect(anchors).toContainEqual([2, 5]);
      // The end anchor (50,15) is on F2 — it must NOT be drawn while F1 is active.
      expect(anchors).not.toContainEqual([50, 15]);
      // And the destination caption ("Shop B") belongs to the end pin — absent on F1.
      expect(drawnLabels(ctx)).not.toContain('Shop B');
    });

    it('after setFloor(F2), draws the end pin at endAnchor.(x,y) (with its title) and NOT the start pin', () => {
      const layer = new PinMarkerLayer('F1');
      layer.setPath(makeRouteResult());
      layer.setFloor('F2');

      const ctx = makeRecordingCtx();
      layer.renderWithContext({ ctx, invalidate() {} });

      const anchors = translateAnchors(ctx);
      // The end pin is now positioned at endAnchor (50,15)...
      expect(anchors).toContainEqual([50, 15]);
      // ...and the start anchor (2,5) on F1 is gone.
      expect(anchors).not.toContainEqual([2, 5]);
      // The end pin carries the destination title.
      expect(drawnLabels(ctx)).toContain('Shop B');
    });

    it('on a floor carrying NEITHER anchor (F0), draws no pin at all', () => {
      const layer = new PinMarkerLayer('F1');
      layer.setPath(makeRouteResult());
      layer.setFloor('F0');

      const ctx = makeRecordingCtx();
      layer.renderWithContext({ ctx, invalidate() {} });

      expect(translateAnchors(ctx)).toEqual([]);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Criterion 1b — the pin marks the SHOP, not the routing door. A route anchor
  //   is snapped to the unit's door (on the corridor edge) so the polyline can
  //   reach a walkable point; but the start/end PIN must sit on the shop's own
  //   display anchor (centroid / label_point). When a Location carries a display
  //   node on the active floor, the pin renders THERE — even though it diverges
  //   from the route anchor. (The route polyline still terminates at the door.)
  //   The anchor is only a fallback for routes that omit Location metadata.
  // ───────────────────────────────────────────────────────────────────────────
  describe('criterion 1b: the pin marks the shop display anchor, not the routing door', () => {
    // A same-floor route whose anchors are snapped to DOORS that diverge from the
    // shops' display anchors: door at (100,200) vs Shop A display node (10,20);
    // door at (140,240) vs Shop B display node (50,60).
    function makeDoorDivergentResult() {
      return {
        success: true,
        startAnchor: { levelCode: 'F1', x: 100, y: 200 }, // the DOOR (corridor edge)
        endAnchor: { levelCode: 'F1', x: 140, y: 240 }, // the DOOR (corridor edge)
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
        segments: new Map([['F1', [[100, 200], [140, 240]]]]),
        transitions: []
      };
    }

    it('draws the start pin at the shop display node (10,20), NOT the door anchor (100,200)', () => {
      const layer = new PinMarkerLayer('F1');
      layer.setPath(makeDoorDivergentResult());

      const ctx = makeRecordingCtx();
      layer.renderWithContext({ ctx, invalidate() {} });

      const anchors = translateAnchors(ctx);
      expect(anchors).toContainEqual([10, 20]); // shop anchor (display node)
      expect(anchors).not.toContainEqual([100, 200]); // NOT the routing door
    });

    it('draws the end pin at the shop display node (50,60), NOT the door anchor (140,240)', () => {
      const layer = new PinMarkerLayer('F1');
      layer.setPath(makeDoorDivergentResult());

      const ctx = makeRecordingCtx();
      layer.renderWithContext({ ctx, invalidate() {} });

      const anchors = translateAnchors(ctx);
      expect(anchors).toContainEqual([50, 60]); // shop anchor (display node)
      expect(anchors).not.toContainEqual([140, 240]); // NOT the routing door
    });

    it('falls back to the route anchor when the Location carries no display node', () => {
      const layer = new PinMarkerLayer('F1');
      layer.setPath({
        success: true,
        startAnchor: { levelCode: 'F1', x: 100, y: 200 },
        endAnchor: { levelCode: 'F1', x: 140, y: 240 },
        startLocation: null, // route without catalog metadata
        endLocation: null,
        segments: new Map([['F1', [[100, 200], [140, 240]]]]),
        transitions: []
      });

      const ctx = makeRecordingCtx();
      layer.renderWithContext({ ctx, invalidate() {} });

      const anchors = translateAnchors(ctx);
      // With no Location, the anchor IS the only known position — draw there.
      expect(anchors).toContainEqual([100, 200]);
      expect(anchors).toContainEqual([140, 240]);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Criterion 2 — NavMarkerLayer stores routeResult.transitions and draws bubbles
  //               at the stored transition coords with up/down arrows.
  // ───────────────────────────────────────────────────────────────────────────
  describe('criterion 2: NavMarkerLayer draws transition bubbles at the stored transition coords', () => {
    let restoreDoc;
    beforeEach(() => { restoreDoc = installMeasureDocument(); });
    afterEach(() => { restoreDoc(); });

    it('with the departure floor (F1) active, draws a bubble at (transition.fromX, fromY) with an UP arrow', () => {
      const layer = new NavMarkerLayer('F1');
      layer.setLevelOrdinals(RM_ORDINALS);
      layer.setPath(makeDivergentCrossFloorResult());

      const ctx = makeRecordingCtx();
      layer.renderWithContext({ ctx, invalidate() {} });

      // The bubble anchors at the STORED transition.fromX/fromY (200,201) — NOT the
      // F1 segment endpoint (38,30). This is the "stores routeResult.transitions" bind.
      expect(translateAnchors(ctx)).toContainEqual([200, 201]);
      expect(translateAnchors(ctx)).not.toContainEqual([38, 30]);

      // F1 (ord 100) -> F2 (ord 200) is upward: the bubble glyph is the UP arrow.
      const labels = drawnLabels(ctx).join(' ');
      expect(labels).toContain(ARROW_UP);
      expect(labels).not.toContain(ARROW_DOWN);
    });

    it('with the arrival floor (F2) active, draws a bubble at (transition.toX, toY) with a DOWN arrow', () => {
      const layer = new NavMarkerLayer('F1');
      layer.setLevelOrdinals(RM_ORDINALS);
      layer.setPath(makeDivergentCrossFloorResult());
      layer.setFloor('F2');

      const ctx = makeRecordingCtx();
      layer.renderWithContext({ ctx, invalidate() {} });

      // The arrival bubble anchors at the STORED transition.toX/toY (300,301) — NOT
      // the F2 segment start (10,15).
      expect(translateAnchors(ctx)).toContainEqual([300, 301]);
      expect(translateAnchors(ctx)).not.toContainEqual([10, 15]);

      // Going BACK from F2 (ord 200) to F1 (ord 100) is downward: the DOWN arrow.
      const labels = drawnLabels(ctx).join(' ');
      expect(labels).toContain(ARROW_DOWN);
      expect(labels).not.toContain(ARROW_UP);
    });

    it('on a floor the transition does not touch (F0), draws no bubble', () => {
      const layer = new NavMarkerLayer('F1');
      layer.setLevelOrdinals(RM_ORDINALS);
      layer.setPath(makeDivergentCrossFloorResult());
      layer.setFloor('F0');

      const ctx = makeRecordingCtx();
      layer.renderWithContext({ ctx, invalidate() {} });

      expect(translateAnchors(ctx)).toEqual([]);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Criterion 3 — NavMarkerLayer.hitTest over a rendered bubble returns the target
  //               level code; a miss returns null.
  // ───────────────────────────────────────────────────────────────────────────
  describe('criterion 3: NavMarkerLayer.hitTest returns the target floor over a bubble, null on a miss', () => {
    let restoreDoc;
    beforeEach(() => { restoreDoc = installMeasureDocument(); });
    afterEach(() => { restoreDoc(); });

    function renderDeparture() {
      const layer = new NavMarkerLayer('F1');
      layer.setLevelOrdinals(RM_ORDINALS);
      layer.setPath(makeDivergentCrossFloorResult());
      // hitTest reads the bubble geometry recorded during render, so render first.
      layer.renderWithContext({ ctx: makeRecordingCtx(), invalidate() {} });
      return layer;
    }

    it('a hit on the departure bubble (anchored at fromX,fromY) returns the toLevelCode (F2)', () => {
      const layer = renderDeparture();
      // The bubble is anchored at (200,201); a tap on the anchor is inside the bubble.
      expect(layer.hitTest(200, 201)).toBe('F2');
    });

    it('a miss far from the bubble returns null', () => {
      const layer = renderDeparture();
      expect(layer.hitTest(-9999, -9999)).toBeNull();
    });

    it('the arrival bubble (on F2) returns the fromLevelCode (F1)', () => {
      const layer = new NavMarkerLayer('F1');
      layer.setLevelOrdinals(RM_ORDINALS);
      layer.setPath(makeDivergentCrossFloorResult());
      layer.setFloor('F2');
      layer.renderWithContext({ ctx: makeRecordingCtx(), invalidate() {} });

      // The arrival bubble is anchored at (300,301); tapping it switches back to F1.
      expect(layer.hitTest(300, 301)).toBe('F1');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Criterion 4 — MapEngine.clearRoute() clears all three layers (no pin, no
  //               bubble, no polyline on any floor). Driven over the REAL engine
  //               + REAL routing stack.
  // ───────────────────────────────────────────────────────────────────────────
  describe('criterion 4: clearRoute() clears all three layers on every floor', () => {
    const renderState = vi.hoisted(() => ({ addedLayers: [] }));

    beforeEach(() => {
      globalThis.HTMLCanvasElement = class HTMLCanvasElement {};
      // NavMarkerLayer's bubble measurer needs a document.createElement('canvas').
      globalThis.document = {
        createElement: () => ({
          getContext: () => ({ set font(_v) {}, measureText: () => ({ width: 40 }) })
        })
      };
      // The NavigationLayer RAF loop is shimmed inert (node-env has no RAF).
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
            fitToBounds() {}
            animateTo() {}
            requestRender() {}
            resize() {}
            dispose() {}
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
      globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(makeRoutingBundle()));
      const engine = new MapEngine(new globalThis.HTMLCanvasElement(), {
        dataUrl: '/bundle.json',
        renderScale: 1,
        defaultFloor: 'F1'
      });
      await engine.init();
      return engine;
    }

    function layerByName(name) {
      return renderState.addedLayers.find((l) => l?.name === name) || null;
    }

    // The geometry a layer emits when rendered on a given floor: translate anchors
    // (pins/bubbles) plus stroke/line draws (polyline). Empty => nothing drawn.
    function drawnGeometryOn(layer, floorCode) {
      layer.setFloor(floorCode);
      const ctx = makeRecordingCtx();
      // capture polyline strokes too (NavigationLayer draws via moveTo/lineTo/stroke).
      ctx.stroke = () => ctx.calls.push(['stroke']);
      layer.renderWithContext({ ctx, invalidate() {} });
      return ctx.calls.filter((c) =>
        c[0] === 'translate' || c[0] === 'stroke' || c[0] === 'fillText'
      );
    }

    it('after a successful cross-floor route, clearRoute() leaves every layer drawing nothing on F1 and F2', async () => {
      const engine = await createEngine();

      const result = engine.navigateTo(RM_SHOP_A_ID, RM_SHOP_B_ID);
      expect(result.success, 'fixture cross-floor route must succeed').toBe(true);

      const pinLayer = layerByName('PinMarkerLayer');
      const navLayer = layerByName('NavMarkerLayer');
      const routeLayer = layerByName('NavigationLayer');
      expect(pinLayer, 'PinMarkerLayer must be registered with the renderer').toBeTruthy();
      expect(navLayer, 'NavMarkerLayer must be registered with the renderer').toBeTruthy();
      expect(routeLayer, 'NavigationLayer must be registered with the renderer').toBeTruthy();

      // SANITY: before clearing, the route actually paints something on each floor.
      const pinBefore = [...drawnGeometryOn(pinLayer, 'F1'), ...drawnGeometryOn(pinLayer, 'F2')];
      const routeBefore = [...drawnGeometryOn(routeLayer, 'F1'), ...drawnGeometryOn(routeLayer, 'F2')];
      expect(pinBefore.length, 'route must draw at least one pin before clear').toBeGreaterThan(0);
      expect(routeBefore.length, 'route must draw a polyline before clear').toBeGreaterThan(0);

      // PRODUCTION end-pin guard (real PathFinder result shape, no fabricated
      // endLocation): the destination pin must draw on F2 at the real endAnchor,
      // captioned with the catalog destination title. This exercises the path the
      // criterion-1 mock cannot — the raw router result must yield a drawn end pin.
      const f2Geometry = drawnGeometryOn(pinLayer, 'F2');
      const f2Anchors = f2Geometry.filter((c) => c[0] === 'translate').map((c) => [c[1], c[2]]);
      const f2Labels = f2Geometry.filter((c) => c[0] === 'fillText').map((c) => c[1]);
      expect(f2Anchors, 'destination pin must draw at the real endAnchor on F2').toContainEqual([50, 15]);
      expect(f2Labels, 'destination pin must carry the catalog title on F2').toContain('Shop B');

      // CLEAR — the single public entry point that fans out to all three layers.
      engine.clearRoute();

      // After clear: NO pin, NO bubble, NO polyline on EITHER floor, on ANY layer.
      for (const floor of ['F1', 'F2']) {
        expect(drawnGeometryOn(pinLayer, floor),
          `PinMarkerLayer must draw nothing on ${floor} after clearRoute`).toEqual([]);
        expect(drawnGeometryOn(navLayer, floor),
          `NavMarkerLayer must draw nothing on ${floor} after clearRoute`).toEqual([]);
        expect(drawnGeometryOn(routeLayer, floor),
          `NavigationLayer must draw nothing on ${floor} after clearRoute`).toEqual([]);
      }
    });
  });
});
// <<< TARS cap:route-markers
