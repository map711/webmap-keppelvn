// >>> TARS cap:map-bootstrap
//
// MapEngine bootstrap: the rebuilt `#loadData` fetches a SINGLE `data-url` bundle
// (the legacy parallel `map-url` fetch is gone), then on success emits
// `data:loaded` (re-emitted to the DOM as `data-loaded`) carrying the bundle's
// floor count; a structurally-broken bundle surfaces as an `engine:error` event
// (DOM `error`), not an unhandled throw that escapes init.
//
// Pure Node/Vitest: the render/interaction/store collaborators are module-mocked
// (they need a DOM/canvas the node env lacks); the REAL BundleLoader + real
// `globalThis.fetch` boundary is what's under test, so the single-fetch and
// floor-count facts are genuinely observed, not fabricated by a mock.
//
// Targets:
//   4 (engine half). A bundle missing a required key -> `engine:error` emitted
//      (no unhandled throw of a foreign shape).
//   5. init fetches exactly the `dataUrl` (never the `mapUrl`) and emits
//      `data:loaded` with floorCount === 5 (the SGC bundle's 5 levels).

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

const mockState = vi.hoisted(() => ({
  /** the parsed bundle the engine threaded into the mocked stores */
  loadedBundle: null
}));

// Capture a `{levels:[...]}` -bearing argument the engine hands to a store, so
// the floor count is an honest function of the data the engine threaded through
// (BundleLoader -> store), not a constant baked into the mock.
function captureBundleArg(...args) {
  for (const arg of args) {
    if (arg && typeof arg === 'object' && Array.isArray(arg.levels)) {
      mockState.loadedBundle = arg;
      return;
    }
  }
}

// --- Mock the render/interaction collaborators (DOM-bound) as inert shells. ---
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
        this.layers = { add() {} };
        this.animator = { cancel() {} };
        this.requestRender = vi.fn();
      }
      fitToBounds() {}
      resize() {}
      animateTo() {}
      dispose() {}
    }
  };
});

// Layer shells: every method the engine may call during init is a no-op.
function makeInertLayer() {
  return class {
    constructor() {
      return new Proxy(this, {
        get(target, prop) {
          if (prop in target) return target[prop];
          return () => undefined;
        }
      });
    }
  };
}
vi.mock('../../src/layers/FloorLayer.js', () => ({ FloorLayer: makeInertLayer() }));
vi.mock('../../src/layers/LocationLayer.js', () => ({ LocationLayer: makeInertLayer() }));
vi.mock('../../src/layers/NavigationLayer.js', () => ({ NavigationLayer: makeInertLayer() }));
vi.mock('../../src/layers/PinMarkerLayer.js', () => ({ PinMarkerLayer: makeInertLayer() }));
vi.mock('../../src/layers/NavMarkerLayer.js', () => ({ NavMarkerLayer: makeInertLayer() }));
vi.mock('../../src/interaction/GestureRecognizer.js', () => ({
  GestureRecognizer: class { dispose() {} }
}));
vi.mock('../../src/interaction/HitTestManager.js', () => ({
  HitTestManager: class { registerHandler() {} }
}));

// --- Mock the two stores: their FINAL shape is a downstream capability, so here
// they only need to (a) accept the engine's load() call, (b) expose floors that
// MIRROR the actually-fetched bundle (no fabricated count), so `floorCount` is an
// honest function of the served data, not a constant baked into the mock. ---
vi.mock('../../src/data/LocationModel.js', () => ({
  LocationStore: class {
    constructor() {
      this.locations = [];
      this.levels = [];
      this.nodes = [];
      this.nodeById = new Map();
    }
    async load(...args) { captureBundleArg(...args); }
    hydrate(...args) { captureBundleArg(...args); }
    getLocation() { return undefined; }
    getLocationsOnLevel() { return []; }
    getLocationsByUnitId() { return []; }
    getNode() { return undefined; }
  }
}));

vi.mock('../../src/data/MapGeometryModel.js', () => {
  // floors derive from the bundle the engine threaded into the stores (captured
  // in mockState) — so the floor count is the served bundle's level count, not a
  // constant baked into the mock.
  function floorCodesFromState() {
    const levels = mockState.loadedBundle?.levels;
    if (!Array.isArray(levels)) return [];
    return [...levels].sort((a, b) => a.position - b.position).map((l) => l.code);
  }
  return {
    MapGeometryStore: class {
      constructor() {
        this.levels = [];
      }
      async load(...args) { captureBundleArg(...args); }
      hydrate(...args) { captureBundleArg(...args); }
      getFloorCodes() { return floorCodesFromState(); }
      getLevelByCode(code) {
        const levels = mockState.loadedBundle?.levels ?? [];
        const level = levels.find((l) => l.code === code);
        if (!level) return undefined;
        return {
          code: level.code,
          ordinal: level.position,
          getBounds: () => ({ width: 1000, height: 700, centerX: 500, centerY: 350 })
        };
      }
    }
  };
});

// BundleLoader is REAL — the single-fetch contract is genuinely exercised through
// the mocked `globalThis.fetch`. The store mocks capture the bundle the engine
// threads in (so floorCount mirrors the served data).
//
// MapEngine is imported LAZILY so the suite COLLECTS cleanly before the forked
// shell exists; a missing module becomes a message-bearing assertion failure
// (assertion-shaped RED) instead of a file-level module-resolution crash.
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

const SGC_DATA_URL = '/datas/SGC_v001.json';
const UNUSED_MAP_URL = '/should-never-be-fetched/map.json';

function jsonResponse(obj, { status = 200, contentType = 'application/json' } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h) => (String(h).toLowerCase() === 'content-type' ? contentType : null) },
    clone() { return jsonResponse(obj, { status, contentType }); },
    json: () => Promise.resolve(obj)
  };
}

describe('map-bootstrap: MapEngine single-bundle init', () => {
  beforeEach(() => {
    globalThis.HTMLCanvasElement = class HTMLCanvasElement {};
    mockState.loadedBundle = null;
  });

  afterEach(() => {
    delete globalThis.HTMLCanvasElement;
    vi.restoreAllMocks();
  });

  async function createEngine(extra = {}) {
    const MapEngine = await importMapEngine();
    return new MapEngine(new globalThis.HTMLCanvasElement(), {
      dataUrl: SGC_DATA_URL,
      mapUrl: UNUSED_MAP_URL,
      ...extra
    });
  }

  it('fetches exactly the data-url and NEVER the map-url during init', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url) => {
      if (url === SGC_DATA_URL || (typeof url === 'string' && url.endsWith('SGC_v001.json'))) {
        return Promise.resolve(jsonResponse(loadSgc()));
      }
      // Any other URL (notably the map-url) must never be requested.
      return Promise.reject(new Error(`unexpected fetch of ${url}`));
    });

    const engine = await createEngine();
    await engine.init();

    const fetchedUrls = globalThis.fetch.mock.calls.map((c) => c[0]);
    expect(fetchedUrls).toContain(SGC_DATA_URL);
    expect(fetchedUrls).not.toContain(UNUSED_MAP_URL);
    // Exactly one bundle fetch (the single-URL contract).
    expect(fetchedUrls.filter((u) => u === SGC_DATA_URL)).toHaveLength(1);
  });

  it('emits data:loaded with floorCount === 5 on the SGC bundle', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(loadSgc()));

    const engine = await createEngine();
    const payloads = [];
    engine.on('data:loaded', (detail) => payloads.push(detail));

    await engine.init();

    expect(payloads).toHaveLength(1);
    expect(payloads[0].floorCount).toBe(5);
  });

  it('emits engine:error (no unhandled throw escaping a different way) on a bundle missing a required key', async () => {
    const broken = loadSgc();
    delete broken.units;
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(broken));

    const engine = await createEngine();
    const errors = [];
    engine.on('engine:error', (detail) => errors.push(detail));

    // init may reject (it re-throws after emitting) — the contract is that the
    // failure is SIGNALLED via the error event, not swallowed and not surfaced
    // only as a foreign unhandled throw.
    await engine.init().catch(() => {});

    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeTruthy();
    expect(errors[0].error).toBeInstanceOf(Error);
  });

  it('does not emit data:loaded when the bundle is structurally invalid', async () => {
    const broken = loadSgc();
    delete broken.navmesh_by_level;
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(broken));

    const engine = await createEngine();
    const loaded = [];
    engine.on('data:loaded', (detail) => loaded.push(detail));

    await engine.init().catch(() => {});

    expect(loaded).toHaveLength(0);
  });
});
// <<< TARS cap:map-bootstrap
