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

function jsonResponse(obj, { status = 200, contentType = 'application/json' } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h) => (String(h).toLowerCase() === 'content-type' ? contentType : null) },
    clone() { return jsonResponse(obj, { status, contentType }); },
    json: () => Promise.resolve(obj)
  };
}

// NOTE: The legacy `map-bootstrap: MapEngine single-bundle init` block (single
// `data-url` fetch, `map-url` never fetched) was RETIRED by the
// `split-data-loading` amendment, which replaces the single `data-url` path
// entirely with the two-URL `{mapsUrl, datasUrl}` load (plan: "Replace
// data-url/map-url entirely — one load path"). Its behaviours are re-covered
// against the split path by the block below: floor-count on success ('emits
// data:loaded with floorCount === 5 …'), and engine:error + no data:loaded on a
// structurally-broken half ('emits engine:error and no data:loaded when a
// fetched half is structurally broken').

// >>> TARS cap:split-data-loading
//
// split-data-loading (engine half) — `MapEngine` init now reads `mapsUrl` +
// `datasUrl` and threads them into the REAL BundleLoader's two-fetch
// `load({mapsUrl, datasUrl})`. Init must fetch BOTH urls (keyed mock), merge into
// the unchanged store-hydration path, and emit `data:loaded` with floorCount===5;
// NEITHER a legacy `data-url` NOR a `map-url` is fetched.
//
// The render/interaction/store collaborators reuse the module mocks installed in
// the map-bootstrap block above (this file is one module graph); only the URL
// wiring + keyed fetch differ. BundleLoader + globalThis.fetch stay REAL, so the
// two-fetch + floor-count facts are genuinely observed.
//
// Target: criterion 6.

const SPLIT_MAPS_URL = '/datas/maps_SGC_v001.json.gz';
const SPLIT_DATAS_URL = '/datas/datas_SGC_v001.json.gz';
const LEGACY_DATA_URL = '/datas/SGC_v001.json';
const LEGACY_MAP_URL = '/should-never-be-fetched/map.json';

// Slice the merged fixture into the two halves the CMS publishes (maps: geometry
// + mall; datas: shop directory), so the engine must fetch + merge both.
function splitSgc(merged = loadSgc()) {
  const maps = {
    mall: merged.mall,
    levels: merged.levels,
    layers: merged.layers,
    kinds: merged.kinds,
    units: merged.units,
    navmesh_by_level: merged.navmesh_by_level,
    transitions: merged.transitions
  };
  const datas = { shops: merged.shops, categories: merged.categories };
  return { maps, datas };
}

describe('split-data-loading: MapEngine two-URL init', () => {
  beforeEach(() => {
    globalThis.HTMLCanvasElement = class HTMLCanvasElement {};
    mockState.loadedBundle = null;
  });

  afterEach(() => {
    delete globalThis.HTMLCanvasElement;
    vi.restoreAllMocks();
  });

  async function createSplitEngine(extra = {}) {
    const MapEngine = await importMapEngine();
    return new MapEngine(new globalThis.HTMLCanvasElement(), {
      mapsUrl: SPLIT_MAPS_URL,
      datasUrl: SPLIT_DATAS_URL,
      ...extra
    });
  }

  function installSplitFetch() {
    const { maps, datas } = splitSgc();
    globalThis.fetch = vi.fn().mockImplementation((url) => {
      if (url === SPLIT_MAPS_URL) return Promise.resolve(jsonResponse(maps));
      if (url === SPLIT_DATAS_URL) return Promise.resolve(jsonResponse(datas));
      return Promise.reject(new Error(`unexpected fetch of ${url}`));
    });
  }

  it('fetches BOTH the maps-url and datas-url during init', async () => {
    installSplitFetch();
    const engine = await createSplitEngine();
    await engine.init();

    const fetched = globalThis.fetch.mock.calls.map((c) => c[0]);
    expect(fetched).toContain(SPLIT_MAPS_URL);
    expect(fetched).toContain(SPLIT_DATAS_URL);
  });

  it('fetches NEITHER a legacy data-url NOR a map-url', async () => {
    installSplitFetch();
    const engine = await createSplitEngine();
    await engine.init();

    const fetched = globalThis.fetch.mock.calls.map((c) => c[0]);
    expect(fetched).not.toContain(LEGACY_DATA_URL);
    expect(fetched).not.toContain(LEGACY_MAP_URL);
  });

  it('emits data:loaded with floorCount === 5 from the merged split halves', async () => {
    installSplitFetch();
    const engine = await createSplitEngine();
    const payloads = [];
    engine.on('data:loaded', (detail) => payloads.push(detail));

    await engine.init();

    expect(payloads).toHaveLength(1);
    expect(payloads[0].floorCount).toBe(5);
  });

  it('emits engine:error and no data:loaded when a fetched half is structurally broken', async () => {
    const { maps, datas } = splitSgc();
    delete maps.navmesh_by_level; // break the maps half
    globalThis.fetch = vi.fn().mockImplementation((url) => {
      if (url === SPLIT_MAPS_URL) return Promise.resolve(jsonResponse(maps));
      if (url === SPLIT_DATAS_URL) return Promise.resolve(jsonResponse(datas));
      return Promise.reject(new Error(`unexpected fetch of ${url}`));
    });
    const engine = await createSplitEngine();
    const errors = [];
    const loaded = [];
    engine.on('engine:error', (d) => errors.push(d));
    engine.on('data:loaded', (d) => loaded.push(d));
    await engine.init().catch(() => {});
    expect(errors).toHaveLength(1);
    expect(errors[0].error).toBeInstanceOf(Error);
    expect(loaded).toHaveLength(0);
  });
});
// <<< TARS cap:split-data-loading
