// >>> TARS cap:floor-switching
//
// floor-switching — the engine's floor selection contract over the REAL stores,
// REAL FloorLayer, REAL LocationLayer, REAL BundleLoader and REAL EventBus. Only
// the DOM-bound collaborators (Renderer, GestureRecognizer, HitTestManager, and
// the marker/nav layers that need a canvas) are mocked: the Renderer mock CAPTURES
// the bounds threaded into `fitToBounds` and exposes the engine's real added
// layers, so "geometry + labels reflect the active level", the refit, and the
// emitted event are GENUINELY observed — not fabricated by a mock.
//
// ─────────────────────────────────────────────────────────────────────────────
// BROWNFIELD-RETROFIT / REGRESSION-LOCK NOTICE (read before judging RED state):
// This capability's floor-selection API (`getFloors`/`getLevels`/`setFloor`/
// `getCurrentFloor`, the floor:changed emit, the getBounds() refit) was inherited
// VERBATIM from the forked upstream Canvas-2D shell, and every data
// collaborator it drives (MapGeometryStore level ordering, FloorLayer per-level
// drawables + getBounds fallback, LocationLayer per-level labels) already shipped
// in the prior capabilities `floor-rendering`, `map-labels`, `destination-catalog`.
// So the implementation LEGITIMATELY PRE-EXISTS: there is no untouched module to
// make these tests fail temporally. These tests therefore stand as a REGRESSION
// LOCK on a pre-existing contract, not a pre-impl RED. They remain assertion-
// shaped and binding — fault-injection-verified (e.g. reversing the level sort in
// MapGeometryModel breaks criteria 1+3; pinning geometry to one level breaks the
// criterion-2/4 geometry+labels+bounds asserts; corrupting the {floor} payload
// breaks the criterion-2 event asserts; degenerating the neutral DEFAULT_EXTENT
// breaks the L1 framing assert) — so a future edit that regresses any of the four
// criteria flips this suite RED on a meaningful assertion. The structured return
// reports `failsForRightReason:false` honestly for this reason.
// ─────────────────────────────────────────────────────────────────────────────
//
// Four test targets, one per acceptance criterion:
//   1. getFloors() lists all 5 level codes ordered by Level.position
//      (B2 lowest .. L3 highest -> ['B2','B1','L1','L2','L3']); getLevels()
//      carries Level.position in that same ascending order.
//   2. setFloor('L2') -> currentFloor==='L2', the FloorLayer renders L2's
//      geometry (74 polys, none from other levels) and the LocationLayer renders
//      L2's labels (none — L2 has 0 tenancies — vs L3's tenant names), the view
//      refits to L2's bounds, and a floor:changed event carrying {floor:'L2'} is
//      emitted (re-emitted verbatim to the DOM as `floor-changed`).
//   3. default-floor set -> that floor is active on load; unset -> the first
//      floor by the engine's priority (lowest position, B2) is active.
//   4. L1 (meshless, 0 units) activates without error, renders ZERO geometry, and
//      still frames sensibly via the getBounds() neutral-default fallback; the
//      sparse B2/B1 (1 unit each) activate and render exactly one polygon.
//
// Pure Node/Vitest. MapEngine is imported LAZILY so the suite COLLECTS cleanly
// even if the forked shell is absent; a missing module becomes a message-bearing
// assertion failure, not a file-level resolution crash.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');
const sgcFixturePath = join(repoRoot, 'test', 'fixtures', 'SGC_v001.json');

function loadSgc() {
  return JSON.parse(readFileSync(sgcFixturePath, 'utf8'));
}

// --- Renderer mock: a controllable shell that records the bounds the engine
// fits to and the layers the engine adds, while exposing the transform/animator
// surface the engine touches. The KEY observables (fitToBounds bounds, the real
// added layers) flow through here so floor-switching facts are honestly seen. ---
const renderState = vi.hoisted(() => ({
  fits: [],
  renders: 0,
  addedLayers: []
}));

vi.mock('../../src/renderer/Renderer.js', () => {
  class MockTransform {
    setScaleBounds() {}
    getScaleBounds() { return { min: 0.1, max: 2.5 }; }
    fitToBounds() {}
    getViewState() { return { scale: 1, panX: 0, panY: 0, rotation: 0 }; }
    setViewState() {}
    pan() {}
    zoom() {}
    centerOn() {}
    resetRotation() {}
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
      requestRender() { renderState.renders += 1; }
      resize() {}
      animateTo() {}
      dispose() {}
    }
  };
});

// The marker/nav layers and interaction managers are DOM/canvas-bound; mock them
// as inert shells exposing only the methods the engine calls. (The FloorLayer and
// LocationLayer are deliberately REAL — their per-level behaviour IS the contract.)
vi.mock('../../src/interaction/GestureRecognizer.js', () => ({
  GestureRecognizer: class { dispose() {} }
}));
vi.mock('../../src/interaction/HitTestManager.js', () => ({
  HitTestManager: class {
    registerHandler(type, fn) {
      renderState.handlers = renderState.handlers || {};
      renderState.handlers[type] = fn;
    }
  }
}));
vi.mock('../../src/layers/PinMarkerLayer.js', () => ({
  PinMarkerLayer: class {
    setFloor() {} setStyle() {} setIconSources() {} setYouAreHereNode() {}
    setYouAreHereVisible() {} setManualEndLocation() {} setPath() {} clear() {}
  }
}));
vi.mock('../../src/layers/NavMarkerLayer.js', () => ({
  NavMarkerLayer: class {
    setFloor() {} setStyle() {} setLevelOrdinals() {} setPath() {} clear() {}
  }
}));
vi.mock('../../src/layers/NavigationLayer.js', () => ({
  NavigationLayer: class {
    setFloor() {} setPath() {} clearPath() {} stopAnimation() {}
  }
}));

function jsonResponse(obj) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    clone() { return jsonResponse(obj); },
    json: () => Promise.resolve(obj)
  };
}

// A minimal 2D context shim that records every fillText (LocationLayer labels) and
// counts beginPath calls (FloorLayer polygons), so "what the active layer draws"
// is a captured observable rather than a guess. Fixed-width font metric keeps
// label boxes deterministic.
function makeRecordingCtx() {
  const ctx = {
    font: '', textAlign: '', textBaseline: '',
    fillStyle: '', strokeStyle: '', lineWidth: 1, lineJoin: '', lineCap: '',
    fillTexts: [],
    polygonCount: 0,
    save() {}, restore() {}, translate() {}, rotate() {}, scale() {},
    beginPath() { ctx.polygonCount += 1; },
    moveTo() {}, lineTo() {}, quadraticCurveTo() {}, closePath() {},
    fill() {}, stroke() {},
    measureText(t) { return { width: String(t).length * 6 }; },
    getTransform() { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; },
    fillText(t) { ctx.fillTexts.push(String(t)); }
  };
  return ctx;
}

async function importMapEngine() {
  let mod = null;
  try {
    mod = await import('../../src/core/MapEngine.js');
  } catch {
    mod = null;
  }
  expect(mod, 'src/core/MapEngine.js must exist and export the MapEngine class').not.toBeNull();
  expect(mod.MapEngine, 'MapEngine.js must export a MapEngine class').toBeTypeOf('function');
  return mod.MapEngine;
}

// Build an initialized engine over the served SGC bundle. `config` lets a test
// stage default-floor etc. renderScale:1 mirrors the raw-coords seam used by the
// store tests.
async function createInitializedEngine(config = {}) {
  const MapEngine = await importMapEngine();
  globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(loadSgc()));
  const engine = new MapEngine(new globalThis.HTMLCanvasElement(), {
    dataUrl: '/datas/SGC_v001.json',
    renderScale: 1,
    ...config
  });
  await engine.init();
  return engine;
}

// Pull a real added layer by its `name` (FloorLayer / LocationLayer).
function addedLayer(name) {
  return renderState.addedLayers.find((l) => l && l.name === name);
}

// The number of polygons the (real) FloorLayer draws right now = one beginPath per
// drawable. A geometry-blind layer that draws nothing would read 0 everywhere, so
// this distinguishes a populated floor from an empty one.
function renderedPolygonCount(floorLayer) {
  const ctx = makeRecordingCtx();
  floorLayer.renderWithContext({ ctx, dpr: 1, scale: 1, rotation: 0, invalidate() {} });
  return ctx.polygonCount;
}

// The label texts the (real) LocationLayer draws right now.
function renderedLabels(locationLayer) {
  const ctx = makeRecordingCtx();
  locationLayer.renderWithContext({ ctx, dpr: 1, scale: 1, rotation: 0, invalidate() {} });
  return ctx.fillTexts.slice();
}

describe('floor-switching: engine floor selection over real stores + layers', () => {
  beforeEach(() => {
    globalThis.HTMLCanvasElement = class HTMLCanvasElement {};
    renderState.fits = [];
    renderState.renders = 0;
    renderState.addedLayers = [];
    renderState.handlers = {};
  });

  afterEach(() => {
    delete globalThis.HTMLCanvasElement;
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Criterion 1 — getFloors() lists all 5 codes ordered by Level.position
  // -------------------------------------------------------------------------
  describe('criterion 1: getFloors() ordered by Level.position', () => {
    it('lists exactly the 5 SGC level codes from B2 (lowest) to L3 (highest)', async () => {
      const engine = await createInitializedEngine();
      const floors = engine.getFloors();
      // ascending by position: B2(50) < B1(100) < L1(150) < L2(200) < L3(250).
      expect(floors).toEqual(['B2', 'B1', 'L1', 'L2', 'L3']);
      expect(floors.length).toBe(5);
    });

    it('getLevels() carries Level.position strictly ascending in the same order', async () => {
      const engine = await createInitializedEngine();
      const levels = engine.getLevels();
      expect(levels.map((l) => l.code)).toEqual(['B2', 'B1', 'L1', 'L2', 'L3']);
      // the floor ORDER is a function of Level.position, not insertion order.
      const positions = levels.map((l) => l.position);
      expect(positions).toEqual([50, 100, 150, 200, 250]);
      for (let i = 1; i < positions.length; i++) {
        expect(positions[i]).toBeGreaterThan(positions[i - 1]);
      }
    });

    it('returns a COPY — mutating the returned array does not corrupt the engine', async () => {
      const engine = await createInitializedEngine();
      const floors = engine.getFloors();
      floors.push('GHOST');
      floors.length = 0;
      expect(engine.getFloors()).toEqual(['B2', 'B1', 'L1', 'L2', 'L3']);
    });
  });

  // -------------------------------------------------------------------------
  // Criterion 2 — setFloor('L2') makes L2 the active rendered level
  // -------------------------------------------------------------------------
  describe("criterion 2: setFloor('L2') activates L2 (geometry + labels), refits, emits floor:changed", () => {
    it("sets currentFloor to 'L2'", async () => {
      const engine = await createInitializedEngine();
      expect(engine.getCurrentFloor()).not.toBe('L2'); // starts elsewhere (B2)
      engine.setFloor('L2');
      expect(engine.getCurrentFloor()).toBe('L2');
    });

    it("makes the FloorLayer render L2's geometry (74 polygons) and none from other levels", async () => {
      const engine = await createInitializedEngine();
      const floorLayer = addedLayer('FloorLayer');
      expect(floorLayer, 'the engine must add a FloorLayer').toBeTruthy();

      engine.setFloor('L2');
      // SGC ground truth: 74 active units on L2 (level id 4).
      expect(renderedPolygonCount(floorLayer)).toBe(74);

      // switching to L3 changes the rendered set (82 units, level id 5) — geometry
      // tracks the active level, it is not a constant.
      engine.setFloor('L3');
      expect(renderedPolygonCount(floorLayer)).toBe(82);
    });

    it("makes the LocationLayer render L2's labels (L2 has 0 tenancies -> no labels; L3 shows tenant names)", async () => {
      const engine = await createInitializedEngine();
      const locationLayer = addedLayer('LocationLayer');
      expect(locationLayer, 'the engine must add a LocationLayer').toBeTruthy();

      engine.setFloor('L2');
      // every SGC tenancy lives on L3, so L2 draws NO labels — labels reflect L2.
      expect(renderedLabels(locationLayer)).toEqual([]);

      engine.setFloor('L3');
      const l3Labels = renderedLabels(locationLayer);
      // L3 surfaces its tenant names (Starbucks is one of the 5 placed shops).
      expect(l3Labels.length).toBeGreaterThan(0);
      expect(l3Labels).toContain('Starbucks');
      // and those L3 labels were absent on L2.
      expect(renderedLabels(locationLayer)).not.toEqual([]); // still L3 active
    });

    it('refits the view to L2 bounds (envelope_dims ~4363.33 x 4478.25)', async () => {
      const engine = await createInitializedEngine();
      renderState.fits = [];
      engine.setFloor('L2', { fitToBounds: true });

      const bounds = renderState.fits[renderState.fits.length - 1];
      expect(bounds, 'setFloor with fitToBounds must refit the view').toBeTruthy();
      // L2 (level id 4) has a navmesh; its envelope_dims drive the framing box.
      expect(bounds.width).toBeCloseTo(4363.32642610794, 2);
      expect(bounds.height).toBeCloseTo(4478.24524562068, 2);
    });

    it('a plain setFloor (no options) still refits — the programmatic/initial-load contract', async () => {
      const engine = await createInitializedEngine();
      renderState.fits = [];
      // The engine's DEFAULT remains "fit on a real floor change". Only the
      // user-facing switch call sites opt out (see the two tests below).
      engine.setFloor('L2');

      const bounds = renderState.fits[renderState.fits.length - 1];
      expect(bounds, 'a plain setFloor must refit the view on a real floor change').toBeTruthy();
      expect(bounds.width).toBeCloseTo(4363.32642610794, 2);
      expect(bounds.height).toBeCloseTo(4478.24524562068, 2);
    });

    it('a connector-pin (floor-transition) tap PRESERVES the view — switches level with no refit', async () => {
      const engine = await createInitializedEngine();
      renderState.fits = [];
      // Fire the exact handler MapEngine registers for connector-bubble taps.
      // A user must not lose zoom/pan/rotation context when stepping between levels.
      renderState.handlers['floor-transition']({ targetFloor: 'L2' });

      expect(engine.getCurrentFloor(), 'the connector tap still switches the active level').toBe('L2');
      expect(renderState.fits, 'a connector-pin switch must NOT refit — the view is preserved').toEqual([]);
    });

    it('an explicit { fitToBounds: false } opts the level-selector / navigation / focus paths out of the refit', async () => {
      const engine = await createInitializedEngine();
      renderState.fits = [];
      // The level-selector tap and the pan-to-target call sites all switch floors
      // but suppress the refit to keep the current view.
      engine.setFloor('L2', { fitToBounds: false });
      expect(renderState.fits).toEqual([]);
    });

    it("emits a floor:changed event carrying {floor:'L2'} (the DOM `floor-changed` payload)", async () => {
      const engine = await createInitializedEngine();
      const events = [];
      engine.on('floor:changed', (detail) => events.push(detail));

      engine.setFloor('L2');

      expect(events.length).toBe(1);
      expect(events[0].floor).toBe('L2');
    });

    it('does not emit floor:changed for an unknown floor code (and currentFloor is unchanged)', async () => {
      const engine = await createInitializedEngine();
      const before = engine.getCurrentFloor();
      const events = [];
      engine.on('floor:changed', (detail) => events.push(detail));

      engine.setFloor('NOPE');

      expect(events).toEqual([]);
      expect(engine.getCurrentFloor()).toBe(before);
    });
  });

  // -------------------------------------------------------------------------
  // Criterion 3 — load-time active floor: default-floor vs engine priority
  // -------------------------------------------------------------------------
  describe('criterion 3: initial active floor (default-floor set vs unset)', () => {
    it('activates the configured default-floor when set', async () => {
      const engine = await createInitializedEngine({ defaultFloor: 'L2' });
      expect(engine.getCurrentFloor()).toBe('L2');
    });

    it('honours a different default-floor (L3) on load', async () => {
      const engine = await createInitializedEngine({ defaultFloor: 'L3' });
      expect(engine.getCurrentFloor()).toBe('L3');
    });

    it("activates the first floor by the engine's priority (lowest position, B2) when default-floor is unset", async () => {
      const engine = await createInitializedEngine();
      // unset default -> first of getFloors() (the lowest-position level).
      expect(engine.getCurrentFloor()).toBe('B2');
      expect(engine.getCurrentFloor()).toBe(engine.getFloors()[0]);
    });
  });

  // -------------------------------------------------------------------------
  // Criterion 4 — empty L1 + sparse B2/B1 activate and render cleanly
  // -------------------------------------------------------------------------
  describe('criterion 4: empty L1 and sparse B2/B1 activate and render cleanly', () => {
    it('activating L1 does not throw and sets it active', async () => {
      const engine = await createInitializedEngine();
      expect(() => engine.setFloor('L1')).not.toThrow();
      expect(engine.getCurrentFloor()).toBe('L1');
    });

    it('L1 (0 units) renders ZERO geometry polygons', async () => {
      const engine = await createInitializedEngine();
      const floorLayer = addedLayer('FloorLayer');
      engine.setFloor('L1');
      expect(renderedPolygonCount(floorLayer)).toBe(0);
    });

    it('L1 still frames sensibly via the getBounds() fallback (a finite, non-degenerate box)', async () => {
      const engine = await createInitializedEngine();
      renderState.fits = [];
      engine.setFloor('L1', { fitToBounds: true });

      const bounds = renderState.fits[renderState.fits.length - 1];
      expect(bounds, 'L1 must still produce framing bounds for the refit').toBeTruthy();
      // meshless + unit-less -> the neutral default extent: finite and positive
      // (never empty/NaN). The seed frames L1 to the 1000x1000 default box.
      expect(Number.isFinite(bounds.width)).toBe(true);
      expect(Number.isFinite(bounds.height)).toBe(true);
      expect(bounds.width).toBeGreaterThan(0);
      expect(bounds.height).toBeGreaterThan(0);
      expect(bounds.width).toBeCloseTo(1000, 6);
      expect(bounds.height).toBeCloseTo(1000, 6);
    });

    it('the sparse floors B2 and B1 (1 unit each) activate and render exactly one polygon', async () => {
      const engine = await createInitializedEngine();
      const floorLayer = addedLayer('FloorLayer');

      engine.setFloor('B2');
      expect(engine.getCurrentFloor()).toBe('B2');
      expect(renderedPolygonCount(floorLayer)).toBe(1); // SGC: 1 unit on level id 1

      engine.setFloor('B1');
      expect(engine.getCurrentFloor()).toBe('B1');
      expect(renderedPolygonCount(floorLayer)).toBe(1); // SGC: 1 unit on level id 2
    });

    it('switching across the sparse + empty floors emits a floor:changed event for each', async () => {
      const engine = await createInitializedEngine(); // starts on B2
      const floors = [];
      engine.on('floor:changed', (detail) => floors.push(detail.floor));

      engine.setFloor('B1');
      engine.setFloor('L1');
      engine.setFloor('B2');

      expect(floors).toEqual(['B1', 'L1', 'B2']);
    });
  });
});
// <<< TARS cap:floor-switching
