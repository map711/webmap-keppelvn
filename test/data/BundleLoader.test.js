// >>> TARS cap:map-bootstrap
//
// BundleLoader — the single-URL, fetch+parse+index loader for the SGC consumer
// bundle. `load(url)` issues ONE fetch (the two-URL DataLoader's `map-url` fetch
// is gone), parses the bundle, and returns an INDEXED MODEL: the source arrays
// plus prebuilt lookups (`kindsBySlug`, `layersById`, `levelsById`,
// `navmesh_by_level`) and units retrievable grouped by `level_id`.
//
// Pure Node/Vitest (no browser): fetch is mocked; the real SGC_v001 fixture is
// read from disk as ground truth, and a hand-written synthetic mini-bundle pins
// data-driven counts (proving the loader is NOT SGC-hardcoded).
//
// Targets (one per acceptance criterion for this capability):
//   1. load(real SGC) -> indexed model: 5 levels (B2,B1,L1,L2,L3), 10 kinds,
//      158 units, 20 shops, 10 categories, 2 transitions, navmesh keys {1,2,4,5}.
//   2. indexes resolve: kindsBySlug flags, layersById/levelsById records, units
//      grouped by level_id.
//   3. mini-bundle -> its documented counts (data-driven, not SGC magic numbers).
//   4. a bundle missing a required top-level key -> structured load error (reject),
//      not an unhandled throw of a different shape.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');
const sgcFixturePath = join(repoRoot, 'test', 'fixtures', 'SGC_v001.json');

function loadSgc() {
  return JSON.parse(readFileSync(sgcFixturePath, 'utf8'));
}

// Resolve the not-yet-built loader lazily so the suite COLLECTS cleanly and each
// test fails on its own behavioural assertion (not a module-resolution crash).
// A missing module becomes an explicit, message-bearing assertion failure, so
// RED is assertion-shaped from the first run; once the module exists it passes
// through unchanged.
async function importBundleLoader() {
  let mod = null;
  try {
    mod = await import('../../src/data/BundleLoader.js');
  } catch {
    mod = null;
  }
  expect(mod, 'src/data/BundleLoader.js must exist and export the BundleLoader API').not.toBeNull();
  expect(mod.BundleLoader, 'BundleLoader.js must export a BundleLoader class').toBeTypeOf('function');
  return mod.BundleLoader;
}

async function makeLoader() {
  const BundleLoader = await importBundleLoader();
  return new BundleLoader();
}

// A Response-like mock whose body parses to `obj` via .json().
function jsonResponse(obj, { status = 200, contentType = 'application/json' } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h) => (String(h).toLowerCase() === 'content-type' ? contentType : null) },
    clone() {
      return jsonResponse(obj, { status, contentType });
    },
    json: () => Promise.resolve(obj)
  };
}

// Normalize an index that may be a Map or a plain object into a {get} probe.
// The criterion's contract is `.get(key)`; if the impl ships a plain object we
// still resolve the value so the test fails on the VALUE, not on Map-vs-object.
function indexGet(index, key) {
  if (index == null) return undefined;
  if (typeof index.get === 'function') return index.get(key);
  return index[key];
}

// Resolve "units grouped by level_id" across the few accessor shapes the indexed
// model might expose, so the test pins the GROUPING (a value), not one method name.
function unitsForLevelId(model, levelId) {
  const candidates = [
    () => (typeof model.getUnitsByLevelId === 'function' ? model.getUnitsByLevelId(levelId) : undefined),
    () => (typeof model.getUnitsForLevel === 'function' ? model.getUnitsForLevel(levelId) : undefined),
    () => indexGet(model.unitsByLevelId, levelId),
    () => indexGet(model.unitsByLevel, levelId)
  ];
  for (const get of candidates) {
    const v = get();
    if (Array.isArray(v)) return v;
  }
  return null;
}

describe('map-bootstrap: BundleLoader indexed model', () => {
  let loader;

  beforeEach(async () => {
    globalThis.fetch = vi.fn();
    loader = await makeLoader();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---- Criterion 1: real SGC -> indexed model with the exact top-level counts ----
  describe('real SGC_v001 top-level counts', () => {
    async function loadModel() {
      globalThis.fetch.mockResolvedValueOnce(jsonResponse(loadSgc()));
      return loader.load('/datas/SGC_v001.json');
    }

    it('yields exactly 5 levels with codes B2,B1,L1,L2,L3 (ascending by position)', async () => {
      const model = await loadModel();
      expect(model.levels.length).toBe(5);
      const codesByPosition = [...model.levels]
        .sort((a, b) => a.position - b.position)
        .map((l) => l.code);
      expect(codesByPosition).toEqual(['B2', 'B1', 'L1', 'L2', 'L3']);
    });

    it('yields 10 kinds, 158 units, 20 shops, 10 categories, 2 transitions', async () => {
      const model = await loadModel();
      expect(model.kinds.length).toBe(10);
      expect(model.units.length).toBe(158);
      expect(model.shops.length).toBe(20);
      expect(model.categories.length).toBe(10);
      expect(model.transitions.length).toBe(2);
    });

    it('keys navmesh_by_level exactly as {1,2,4,5} (level id 3 / L1 absent)', async () => {
      const model = await loadModel();
      const keys = Object.keys(model.navmesh_by_level).sort();
      expect(keys).toEqual(['1', '2', '4', '5']);
      // L1 (level id 3) carries geometry but no mesh: its key is absent, not empty.
      expect(Object.prototype.hasOwnProperty.call(model.navmesh_by_level, '3')).toBe(false);
    });
  });

  // ---- Criterion 2: the indexes resolve to the right records ----
  describe('real SGC_v001 index resolution', () => {
    async function loadModel() {
      globalThis.fetch.mockResolvedValueOnce(jsonResponse(loadSgc()));
      return loader.load('/datas/SGC_v001.json');
    }

    it('kindsBySlug.get("elevator") is accessible and a connector', async () => {
      const model = await loadModel();
      const elevator = indexGet(model.kindsBySlug, 'elevator');
      expect(elevator, 'kindsBySlug must resolve the "elevator" kind').toBeTruthy();
      expect(elevator.is_accessible).toBe(true);
      expect(elevator.is_connector).toBe(true);
    });

    it('kindsBySlug.get("escalator") is a connector but NOT accessible', async () => {
      const model = await loadModel();
      const escalator = indexGet(model.kindsBySlug, 'escalator');
      expect(escalator, 'kindsBySlug must resolve the "escalator" kind').toBeTruthy();
      expect(escalator.is_connector).toBe(true);
      expect(escalator.is_accessible).toBe(false);
    });

    it('layersById resolves a layer to its owning level (layer id 6 -> level_id 1)', async () => {
      const model = await loadModel();
      // Ground truth read off the SGC seed: layer id 6 belongs to level id 1 (B2).
      const layer = indexGet(model.layersById, 6);
      expect(layer, 'layersById must resolve layer id 6').toBeTruthy();
      expect(layer.id).toBe(6);
      expect(layer.level_id).toBe(1);
    });

    it('levelsById resolves a level id to its matching record (id 4 -> code L2)', async () => {
      const model = await loadModel();
      const level = indexGet(model.levelsById, 4);
      expect(level, 'levelsById must resolve level id 4').toBeTruthy();
      expect(level.id).toBe(4);
      expect(level.code).toBe('L2');
    });

    it('retrieves units grouped by level_id matching the seed distribution', async () => {
      const model = await loadModel();
      // Ground truth read off the SGC seed: per-level active-unit counts.
      const expected = { 1: 1, 2: 1, 4: 74, 5: 82 };
      let total = 0;
      for (const [levelId, count] of Object.entries(expected)) {
        const units = unitsForLevelId(model, Number(levelId));
        expect(units, `units grouped by level_id must be retrievable for level ${levelId}`).not.toBeNull();
        expect(units.length).toBe(count);
        expect(units.every((u) => u.level_id === Number(levelId))).toBe(true);
        total += units.length;
      }
      // L1 (level id 3) has no units: an empty (not null) group.
      const l1Units = unitsForLevelId(model, 3);
      expect(l1Units, 'meshless L1 must still resolve a (possibly empty) unit group').not.toBeNull();
      expect(l1Units.length).toBe(0);
      // The per-level groups partition the full unit population.
      expect(total).toBe(158);
    });
  });

  // ---- Criterion 3: the synthetic mini-bundle -> its documented counts ----
  // The mini-bundle is the contract's data-driven witness: hand-built here with
  // counts that DIFFER from SGC, so a loader that hard-coded SGC magic numbers
  // would fail these assertions. Documented shape:
  //   - 2 levels: M1 (id 10, has mesh) and M2 (id 20, MESHLESS)
  //   - units: 2 shops + 1 escalator + 1 elevator = 4 units total
  //   - 2 shops, 1 category
  //   - 1 transition (the escalator+elevator connector group spanning both levels)
  function makeMiniBundle() {
    const square = (x, y) => ({
      type: 'Polygon',
      coordinates: [[[x, y], [x + 10, y], [x + 10, y + 10], [x, y + 10], [x, y]]]
    });
    return {
      mall: { id: 99, name: 'Mini Mall', code: 'MINI' },
      levels: [
        { id: 10, name: 'M1', code: 'M1', position: 100, hidden: false, locked: false, opacity: 1.0 },
        { id: 20, name: 'M2', code: 'M2', position: 200, hidden: false, locked: false, opacity: 1.0 }
      ],
      layers: [
        { id: 1, level_id: 10, parent_id: null, name: 'L', position: 0, stroke_color: '', stroke_width: null, fill_color: '' },
        { id: 2, level_id: 20, parent_id: null, name: 'L', position: 0, stroke_color: '', stroke_width: null, fill_color: '' }
      ],
      kinds: [
        { id: 1, slug: 'shop', label: 'Shop', position: 0, stroke_color: '#1e40af', stroke_width: 1.5, fill_color: '#dbeafe', is_system: true, is_tenant: true, is_routable: true, is_connector: false, is_accessible: false },
        { id: 2, slug: 'escalator', label: 'Escalator', position: 1, stroke_color: '#000', stroke_width: 1.0, fill_color: '#eee', is_system: true, is_tenant: false, is_routable: true, is_connector: true, is_accessible: false },
        { id: 3, slug: 'elevator', label: 'Elevator', position: 2, stroke_color: '#000', stroke_width: 1.0, fill_color: '#eee', is_system: true, is_tenant: false, is_routable: true, is_connector: true, is_accessible: true }
      ],
      units: [
        { id: 101, level_id: 10, layer_id: 1, kind: 'shop', name: '', geometry: square(0, 0), display_point: [5, 5], position: 0, is_active: true, hidden: false, locked: false, opacity: 1.0, stroke_color: '', stroke_width: null, fill_color: '', doors: [], connector_group_id: null, label_rotation: 0.0, label_point: [5, 5], tenancies: [{ shop_id: 1, name: 'Mini Cafe' }] },
        { id: 102, level_id: 20, layer_id: 2, kind: 'shop', name: '', geometry: square(20, 0), display_point: [25, 5], position: 1, is_active: true, hidden: false, locked: false, opacity: 1.0, stroke_color: '', stroke_width: null, fill_color: '', doors: [], connector_group_id: null, label_rotation: 0.0, label_point: [25, 5], tenancies: [{ shop_id: 2, name: 'Mini Shop' }] },
        { id: 103, level_id: 10, layer_id: 1, kind: 'escalator', name: '', geometry: square(40, 0), display_point: [45, 5], position: 2, is_active: true, hidden: false, locked: false, opacity: 1.0, stroke_color: '', stroke_width: null, fill_color: '', doors: [], connector_group_id: 7, label_rotation: 0.0, label_point: [45, 5], tenancies: [] },
        { id: 104, level_id: 20, layer_id: 2, kind: 'elevator', name: '', geometry: square(40, 0), display_point: [45, 5], position: 3, is_active: true, hidden: false, locked: false, opacity: 1.0, stroke_color: '', stroke_width: null, fill_color: '', doors: [], connector_group_id: 7, label_rotation: 0.0, label_point: [45, 5], tenancies: [] }
      ],
      shops: [
        { id: 1, mall: 99, name: 'Mini Cafe', slug: 'mini-cafe', logo: null, description: '', category: 1, unit_number: 'M1-01', contact_phone: '', contact_email: '', website: '', operating_hours: {}, is_active: true },
        { id: 2, mall: 99, name: 'Mini Shop', slug: 'mini-shop', logo: null, description: '', category: 1, unit_number: 'M2-01', contact_phone: '', contact_email: '', website: '', operating_hours: {}, is_active: true }
      ],
      categories: [
        { id: 1, name: 'Food', slug: 'food', icon: null }
      ],
      // M1 (id 10) has a mesh; M2 (id 20) is MESHLESS -> its key is absent.
      navmesh_by_level: {
        10: {
          vertices: [[0, 0], [10, 0], [10, 10]],
          triangles: [[0, 1, 2]],
          adjacency: [[-1, -1, -1]],
          doors_by_unit: { 101: [] },
          centroids_by_unit: { 101: [5, 5] },
          envelope_dims: [50, 10]
        }
      },
      transitions: [
        { group_id: 7, name: 'mini-connector', direction: 'bidirectional', cost: 2.0, is_accessible: true,
          members: [
            { unit_id: 103, level_id: 10, centroid: [45, 5], position: 100 },
            { unit_id: 104, level_id: 20, centroid: [45, 5], position: 200 }
          ] }
      ]
    };
  }

  describe('synthetic mini-bundle (data-driven, not SGC-hardcoded)', () => {
    async function loadMini() {
      globalThis.fetch.mockResolvedValueOnce(jsonResponse(makeMiniBundle()));
      return loader.load('/mini.json');
    }

    it('reports the mini-bundle level/unit/shop/transition counts, not SGC magic numbers', async () => {
      const model = await loadMini();
      // Counts diverge from SGC (5/158/20/2) -> an SGC-hardcoded loader fails here.
      expect(model.levels.length).toBe(2);
      expect(model.units.length).toBe(4);
      expect(model.shops.length).toBe(2);
      expect(model.categories.length).toBe(1);
      expect(model.transitions.length).toBe(1);
    });

    it('has exactly one meshless level (M2 / id 20 absent from navmesh_by_level)', async () => {
      const model = await loadMini();
      const meshKeys = Object.keys(model.navmesh_by_level);
      expect(meshKeys).toEqual(['10']);
      expect(Object.prototype.hasOwnProperty.call(model.navmesh_by_level, '20')).toBe(false);
    });

    it('groups the mini-bundle units by level_id (M1: shop+escalator, M2: shop+elevator)', async () => {
      const model = await loadMini();
      const m1 = unitsForLevelId(model, 10);
      const m2 = unitsForLevelId(model, 20);
      expect(m1, 'mini units must group under level id 10').not.toBeNull();
      expect(m2, 'mini units must group under level id 20').not.toBeNull();
      expect(m1.map((u) => u.kind).sort()).toEqual(['escalator', 'shop']);
      expect(m2.map((u) => u.kind).sort()).toEqual(['elevator', 'shop']);
    });

    it('indexes the escalator and elevator kinds with their distinct accessibility flags', async () => {
      const model = await loadMini();
      expect(indexGet(model.kindsBySlug, 'escalator').is_accessible).toBe(false);
      expect(indexGet(model.kindsBySlug, 'elevator').is_accessible).toBe(true);
    });
  });

  // ---- Criterion 4: a bundle missing a required top-level key -> structured error ----
  describe('missing required top-level key', () => {
    it('rejects (not silently resolves) when a required key like "units" is absent', async () => {
      const broken = loadSgc();
      delete broken.units;
      globalThis.fetch.mockResolvedValueOnce(jsonResponse(broken));

      let caught;
      let result;
      try {
        result = await loader.load('/broken.json');
      } catch (err) {
        caught = err;
      }

      expect(caught, 'load must reject a bundle missing "units", not resolve to a model').toBeInstanceOf(Error);
      expect(result, 'load must not resolve when a required key is missing').toBeUndefined();
    });

    it('rejects when "navmesh_by_level" is absent', async () => {
      const broken = loadSgc();
      delete broken.navmesh_by_level;
      globalThis.fetch.mockResolvedValueOnce(jsonResponse(broken));
      await expect(loader.load('/broken2.json')).rejects.toBeInstanceOf(Error);
    });
  });
});
// <<< TARS cap:map-bootstrap

// >>> TARS cap:split-data-loading
//
// split-data-loading (loader half) — `BundleLoader.load({mapsUrl, datasUrl})`
// fetches the two remote halves IN PARALLEL (the CMS now publishes `maps_…`
// geometry + `datas_…` directory separately), validates each half against the
// keys that half is supposed to carry, and MERGES them into the unchanged
// `BundleModel`. The merge produces a shape byte-identical to today's single
// bundle, so the resolved model's counts must equal today's.
//
// The on-disk merged SGC fixture is SLICED into {maps, datas} by `splitFixture()`
// here (no new 2 MB fixtures committed); the fetch is keyed by URL so the loader
// must request BOTH urls and merge — a loader that only read one half fails the
// count/identity assertions.
//
// Targets (one per acceptance criterion):
//   1. load({mapsUrl,datasUrl}) -> merged model with today's exact counts.
//   2. merge sources geometry+mall from MAPS, shops+categories from DATAS.
//   3. extra datas_ keys (banners/events/malls) are IGNORED, not validated/leaked.
//   4. a required key missing from MAPS names the maps URL; missing from DATAS
//      names the datas URL.
import { describe as describe2, it as it2, expect as expect2, beforeEach as beforeEach2, afterEach as afterEach2, vi as vi2 } from 'vitest';

const MAPS_URL = '/datas/maps_SGC_v001.json.gz';
const DATAS_URL = '/datas/datas_SGC_v001.json.gz';

// Slice the merged on-disk fixture into the two halves the CMS publishes.
// `maps` carries geometry + `mall`; `datas` carries the shop directory.
// Returns disjoint-key objects so each half can be validated independently and a
// loader that merged WRONG (e.g. read shops from maps) is observable.
function splitFixture(merged = loadSgc()) {
  const maps = {
    mall: merged.mall,
    levels: merged.levels,
    layers: merged.layers,
    kinds: merged.kinds,
    units: merged.units,
    navmesh_by_level: merged.navmesh_by_level,
    transitions: merged.transitions
  };
  const datas = {
    shops: merged.shops,
    categories: merged.categories
  };
  return { maps, datas };
}

// URL-keyed fetch: the maps url resolves the maps half, the datas url the datas
// half; any other url rejects. So the loader must request EXACTLY both halves.
function installSplitFetch({ maps, datas }, { mapsUrl = MAPS_URL, datasUrl = DATAS_URL } = {}) {
  globalThis.fetch = vi2.fn().mockImplementation((url) => {
    if (url === mapsUrl) return Promise.resolve(jsonResponse(maps));
    if (url === datasUrl) return Promise.resolve(jsonResponse(datas));
    return Promise.reject(new Error(`unexpected fetch of ${url}`));
  });
}

describe2('split-data-loading: BundleLoader.load({mapsUrl, datasUrl})', () => {
  let loader;

  beforeEach2(async () => {
    loader = await makeLoader();
  });

  afterEach2(() => {
    vi2.restoreAllMocks();
  });

  // ---- Criterion 1: merged counts equal today's single-bundle counts ----
  it2('resolves a BundleModel whose merged counts equal today\'s (5/10/158/20/10/2 + mesh keys)', async () => {
    installSplitFetch(splitFixture());
    const model = await loader.load({ mapsUrl: MAPS_URL, datasUrl: DATAS_URL });

    expect2(model.levels.length).toBe(5);
    expect2(model.kinds.length).toBe(10);
    expect2(model.units.length).toBe(158);
    expect2(model.shops.length).toBe(20);
    expect2(model.categories.length).toBe(10);
    expect2(model.transitions.length).toBe(2);
    // navmesh_by_level carries its level keys (the maps half's mesh, merged through).
    expect2(Object.keys(model.navmesh_by_level).sort()).toEqual(['1', '2', '4', '5']);
  });

  it2('fetches BOTH the maps and datas URLs (the two-fetch contract)', async () => {
    installSplitFetch(splitFixture());
    await loader.load({ mapsUrl: MAPS_URL, datasUrl: DATAS_URL });

    const fetched = globalThis.fetch.mock.calls.map((c) => c[0]);
    expect2(fetched).toContain(MAPS_URL);
    expect2(fetched).toContain(DATAS_URL);
  });

  // ---- Criterion 2: merge sources geometry+mall from MAPS, shops+categories from DATAS ----
  it2('takes `mall` from the maps half and resolves shop/category ids that live only in datas', async () => {
    const { maps, datas } = splitFixture();
    // Distinguish the maps half's mall with a sentinel the datas half does NOT carry,
    // so a model.mall that matched required reading the MAPS input, not datas.
    maps.mall = { id: 1, name: 'Saigon Centre', code: 'SGC', _from: 'maps-half' };
    // Pick ids that exist ONLY in the datas half (shops/categories are datas-only).
    const datasShopId = datas.shops[0].id;
    const datasCatId = datas.categories[0].id;

    installSplitFetch({ maps, datas });
    const model = await loader.load({ mapsUrl: MAPS_URL, datasUrl: DATAS_URL });

    expect2(model.mall).toEqual({ id: 1, name: 'Saigon Centre', code: 'SGC', _from: 'maps-half' });
    expect2(model.shopsById.get(datasShopId), 'shopsById must resolve a datas-only shop id').toBeTruthy();
    expect2(model.shopsById.get(datasShopId).id).toBe(datasShopId);
    expect2(model.categoriesById.get(datasCatId), 'categoriesById must resolve a datas-only category id').toBeTruthy();
    expect2(model.categoriesById.get(datasCatId).id).toBe(datasCatId);
  });

  // ---- Criterion 3: extra datas_ keys are IGNORED (no model field, no validation error) ----
  it2('ignores extra datas_ keys (banners/events/malls): not BundleModel fields, no rejection', async () => {
    const { maps, datas } = splitFixture();
    datas.banners = [{ id: 1, title: 'spring sale' }];
    datas.events = [{ id: 2, name: 'fashion week' }];
    datas.malls = [{ id: 3, name: 'sibling mall' }];

    installSplitFetch({ maps, datas });
    const model = await loader.load({ mapsUrl: MAPS_URL, datasUrl: DATAS_URL });

    // Resolves (no validation error) AND the extras never become model fields.
    expect2(model.levels.length).toBe(5);
    expect2(Object.prototype.hasOwnProperty.call(model, 'banners')).toBe(false);
    expect2(Object.prototype.hasOwnProperty.call(model, 'events')).toBe(false);
    expect2(model.banners).toBeUndefined();
    expect2(model.events).toBeUndefined();
    // `malls` (plural CMS list) must not clobber the singular `mall` identity.
    expect2(model.mall).toEqual({ id: 1, name: 'Saigon Centre', code: 'SGC' });
  });

  // ---- Criterion 4: a missing required key names the URL of the OFFENDING half ----
  it2('rejects with a BundleLoadError naming the MAPS url when a geometry key (navmesh_by_level) is missing from maps', async () => {
    const { maps, datas } = splitFixture();
    delete maps.navmesh_by_level;
    installSplitFetch({ maps, datas });

    let caught;
    try {
      await loader.load({ mapsUrl: MAPS_URL, datasUrl: DATAS_URL });
    } catch (err) {
      caught = err;
    }
    expect2(caught, 'a maps half missing navmesh_by_level must reject').toBeInstanceOf(Error);
    expect2(caught.name).toBe('BundleLoadError');
    expect2(caught.message).toContain(MAPS_URL);
    expect2(caught.message).not.toContain(DATAS_URL);
  });

  it2('rejects with a BundleLoadError naming the DATAS url when `shops` is missing from datas', async () => {
    const { maps, datas } = splitFixture();
    delete datas.shops;
    installSplitFetch({ maps, datas });

    let caught;
    try {
      await loader.load({ mapsUrl: MAPS_URL, datasUrl: DATAS_URL });
    } catch (err) {
      caught = err;
    }
    expect2(caught, 'a datas half missing shops must reject').toBeInstanceOf(Error);
    expect2(caught.name).toBe('BundleLoadError');
    expect2(caught.message).toContain(DATAS_URL);
    expect2(caught.message).not.toContain(MAPS_URL);
  });

  it2('rejects naming the DATAS url when `categories` is missing from datas', async () => {
    const { maps, datas } = splitFixture();
    delete datas.categories;
    installSplitFetch({ maps, datas });

    let caught;
    try {
      await loader.load({ mapsUrl: MAPS_URL, datasUrl: DATAS_URL });
    } catch (err) {
      caught = err;
    }
    expect2(caught, 'a datas half missing categories must reject').toBeInstanceOf(Error);
    expect2(caught.name).toBe('BundleLoadError');
    expect2(caught.message).toContain(DATAS_URL);
  });
});
// <<< TARS cap:split-data-loading

// >>> TARS cap:reward-data
//
// reward-data (Reward data passthrough) — the `datas_…` half MAY carry a
// `rewards: [{id, shops:[...], ...}]` list. The loader must carry it across the
// `#loadSplit` merge so the resolved `BundleModel` exposes:
//   - `model.rewards` — the input `datas.rewards` array, verbatim (deep-equal).
//   - `model.rewardsByShopId` — a shopId -> [rewards…] index that mirrors
//     `shopsById`: a reward listing N shops is indexed under EVERY one of its
//     `shops[]`, so `.get(shopId)` returns the rewards that touch that shop.
//
// `rewards` is OPTIONAL: a datas half with no `rewards` key must still validate
// and resolve (rewards -> [], index empty). The split validation must NOT add
// `rewards` to the datas half's required keys.
//
// The merged on-disk SGC fixture carries NO `rewards`, so these tests SYNTHESIZE
// the rewards onto a sliced datas half (via splitFixture) — the contract is the
// passthrough+index, asserted against hand-built reward records, never raw data.
//
// Targets (one per acceptance criterion):
//   1. datas.rewards present -> model.rewards deep-equals datas.rewards.
//   2. a multi-shop reward is indexed under EACH of its shops[] ids.
//   3. a shop id with no reward -> undefined/empty from rewardsByShopId.
//   4. datas half with NO rewards key -> resolves (no BundleLoadError);
//      rewards === [] and rewardsByShopId empty.
//   5. the split validation does NOT require `rewards`: a datas half missing
//      rewards but carrying shops+categories still validates.
import { describe as describe3, it as it3, expect as expect3, beforeEach as beforeEach3, afterEach as afterEach3, vi as vi3 } from 'vitest';

// Resolve "rewards for a shop id" across the index shapes the model might expose
// (Map<shopId, reward[]> or a plain object), normalizing to a reward[] (or
// undefined when the shop has none). The criterion's contract is `.get(shopId)`.
function rewardsForShopId(model, shopId) {
  const index = model.rewardsByShopId;
  if (index == null) return undefined;
  if (typeof index.get === 'function') return index.get(shopId);
  return index[shopId];
}

describe3('reward-data: BundleModel rewards passthrough + shop index', () => {
  let loader;

  beforeEach3(async () => {
    loader = await makeLoader();
  });

  afterEach3(() => {
    vi3.restoreAllMocks();
  });

  // The reward fixture: one reward (id 9) spanning two shops, one single-shop
  // reward (id 12) so per-shop isolation is observable. Shop ids 3 / 477 / 50
  // are chosen NOT to collide with each other's lists.
  const REWARDS = [
    { id: 9, name: 'Double Points', type: 'points', shops: [3, 477] },
    { id: 12, name: 'Free Coffee', type: 'voucher', shops: [50] }
  ];

  function splitWithRewards(rewards = REWARDS) {
    const { maps, datas } = splitFixture();
    datas.rewards = rewards;
    return { maps, datas };
  }

  // ---- Criterion 1: model.rewards deep-equals the input datas.rewards ----
  it3('carries datas.rewards across the merge so model.rewards deep-equals the input', async () => {
    installSplitFetch(splitWithRewards());
    const model = await loader.load({ mapsUrl: MAPS_URL, datasUrl: DATAS_URL });

    expect3(Array.isArray(model.rewards), 'model.rewards must be an array').toBe(true);
    expect3(model.rewards).toEqual(REWARDS);
    // The reward id 9 with its two shops survives verbatim (the criterion's witness).
    const r9 = model.rewards.find((r) => r.id === 9);
    expect3(r9, 'reward id 9 must survive the merge').toBeTruthy();
    expect3(r9.shops).toEqual([3, 477]);
  });

  // ---- Criterion 2: a multi-shop reward is indexed under EACH of its shops[] ----
  it3('indexes a multi-shop reward under every one of its shops[] (rewardsByShopId.get(3) and .get(477) both include 9)', async () => {
    installSplitFetch(splitWithRewards());
    const model = await loader.load({ mapsUrl: MAPS_URL, datasUrl: DATAS_URL });

    const forShop3 = rewardsForShopId(model, 3);
    const forShop477 = rewardsForShopId(model, 477);

    expect3(Array.isArray(forShop3), 'rewardsByShopId.get(3) must be an array of rewards').toBe(true);
    expect3(Array.isArray(forShop477), 'rewardsByShopId.get(477) must be an array of rewards').toBe(true);
    expect3(forShop3.map((r) => r.id)).toContain(9);
    expect3(forShop477.map((r) => r.id)).toContain(9);

    // The single-shop reward (id 12 / shop 50) is NOT indexed under shop 3 or 477.
    expect3(forShop3.map((r) => r.id)).not.toContain(12);
    expect3(forShop477.map((r) => r.id)).not.toContain(12);
    const forShop50 = rewardsForShopId(model, 50);
    expect3(Array.isArray(forShop50)).toBe(true);
    expect3(forShop50.map((r) => r.id)).toEqual([12]);
  });

  // ---- Criterion 3: a shop id with no reward -> undefined / empty ----
  it3('returns undefined or an empty list for a shop id that no reward lists', async () => {
    installSplitFetch(splitWithRewards());
    const model = await loader.load({ mapsUrl: MAPS_URL, datasUrl: DATAS_URL });

    // 999999 is not in any reward's shops[].
    const none = rewardsForShopId(model, 999999);
    const isEmpty = none === undefined || (Array.isArray(none) && none.length === 0);
    expect3(isEmpty, 'a shop with no reward must yield undefined or an empty array').toBe(true);
  });

  // ---- Criterion 4: datas half with NO rewards key still resolves; rewards [] / index empty ----
  it3('resolves a datas half WITH NO rewards key (no BundleLoadError); rewards is [] and the index is empty', async () => {
    const { maps, datas } = splitFixture();
    expect3(
      Object.prototype.hasOwnProperty.call(datas, 'rewards'),
      'the sliced fixture datas half must carry no rewards key (precondition)'
    ).toBe(false);

    installSplitFetch({ maps, datas });

    let caught;
    let model;
    try {
      model = await loader.load({ mapsUrl: MAPS_URL, datasUrl: DATAS_URL });
    } catch (err) {
      caught = err;
    }

    expect3(caught, 'a datas half with no rewards must NOT raise a BundleLoadError').toBeUndefined();
    expect3(Array.isArray(model.rewards), 'model.rewards must default to an array').toBe(true);
    expect3(model.rewards).toEqual([]);

    // The index is empty: any shop id resolves to nothing.
    const someShopId = datas.shops[0].id;
    const got = rewardsForShopId(model, someShopId);
    const empty = got === undefined || (Array.isArray(got) && got.length === 0);
    expect3(empty, 'with no rewards, rewardsByShopId must resolve nothing for any shop').toBe(true);
  });

  // ---- Criterion 5: split validation does NOT require `rewards` ----
  it3('validates a datas half that has shops+categories but no rewards (rewards is not a required key)', async () => {
    const { maps, datas } = splitFixture();
    // Precondition: the datas half carries shops + categories, but no rewards.
    expect3(Array.isArray(datas.shops)).toBe(true);
    expect3(Array.isArray(datas.categories)).toBe(true);
    expect3(Object.prototype.hasOwnProperty.call(datas, 'rewards')).toBe(false);

    installSplitFetch({ maps, datas });

    // Must resolve (validation passes) rather than reject for a missing `rewards`.
    const model = await loader.load({ mapsUrl: MAPS_URL, datasUrl: DATAS_URL });
    expect3(model.shops.length).toBe(20);
    expect3(model.categories.length).toBe(10);
  });
});
// <<< TARS cap:reward-data
