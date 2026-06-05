// >>> TARS cap:destination-catalog
//
// destination-catalog — LocationStore builds the searchable/routable destination
// CATALOG from the bundle: one `shop:<id>` Location PER PLACED (tenancy-referenced)
// shop, one `unit:<id>` Location per routable non-connector facility unit; vacant
// shops, connectors, and non-routable units yield NOTHING.
//
// The catalog is hydrated from the BundleModel (the parsed+indexed object the
// engine threads into `LocationStore.hydrate(bundle, options)`), so these tests
// build that model with the REAL BundleLoader and a hand-written synthetic
// mini-bundle. The real SGC fixture is the sparse ground truth (5 placed shops,
// 0 facilities, a multi-tenant unit 121); the mini-bundle witnesses the edge
// cases the seed lacks (a multi-unit shop, a placed toilet facility).
//
// Targets (one per acceptance criterion):
//   1. catalog = placed shops only: count(shop:* Locations) === distinct shop_ids
//      across all tenancies (SGC: 5), NOT shops[].length (20). Round-trip +
//      title/search_tokens(name+unit_number+category)/logo/description/venue.
//   2. a multi-unit shop exposes every unit in unitIds[] and every floor in
//      levelCodes[] (mini-bundle).
//   3. a multi-tenant unit (>=2 tenancies) -> one Location per tenancy, each
//      listing the shared unitId; getLocationsByUnitId(121) returns BOTH.
//   4. routable non-connector non-tenant facility unit -> one unit:<id> Location
//      (mini-bundle toilet); SGC facility set is empty.
//   5. connectors, non-routable units, and vacant shop-kind units -> NO Location.
//   6. getLocationsByUnitId returns a LIST: empty for connector/vacant, one for
//      single-tenant, >=2 for multi-tenant.
//   7. every Location has displayNodes (one per unit): point=label_point,
//      rotation from label_rotation, levelCode derived from unit.level_id.

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BundleLoader } from '../../src/data/BundleLoader.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');
const sgcFixturePath = join(repoRoot, 'test', 'fixtures', 'SGC_v001.json');

function loadSgcRaw() {
  return JSON.parse(readFileSync(sgcFixturePath, 'utf8'));
}

// Resolve the (rebuilt) LocationStore lazily so the suite COLLECTS cleanly and
// each test fails on a behavioural assertion rather than a module-resolution
// crash. If the catalog rebuild is not present, this surfaces as an explicit,
// message-bearing assertion failure (assertion-shaped RED), not an import error.
async function importLocationStore() {
  let mod = null;
  try {
    mod = await import('../../src/data/LocationModel.js');
  } catch {
    mod = null;
  }
  expect(mod, 'src/data/LocationModel.js must exist and export LocationStore').not.toBeNull();
  expect(mod.LocationStore, 'LocationModel.js must export a LocationStore class').toBeTypeOf('function');
  return mod.LocationStore;
}

// Build a BundleModel from a raw bundle object via the real loader (one mocked
// fetch), then hydrate a fresh LocationStore from it. This exercises the actual
// engine seam: BundleLoader.load(url) -> BundleModel -> store.hydrate(model).
async function buildCatalog(rawBundle) {
  const LocationStore = await importLocationStore();
  const loader = new BundleLoader({
    load: () => Promise.resolve(structuredClone(rawBundle))
  });
  const model = await loader.load('/bundle.json');
  const store = new LocationStore();
  store.hydrate(model, { renderScale: 1 });
  return { store, model };
}

// The catalog's shop Locations, however the store names the collection. The
// contract is `getLocation('shop:<id>')` round-trip + a `locations` array; we
// derive the shop subset by id prefix so the test pins the CATALOG CONTENT, not
// an internal partitioning method.
function shopLocations(store) {
  return store.locations.filter((l) => String(l.id).startsWith('shop:'));
}
function facilityLocations(store) {
  return store.locations.filter((l) => String(l.id).startsWith('unit:'));
}

// Pull the unit-id list off a Location across the small set of names it might
// expose, so the test pins the VALUE (which units), not one property name.
function unitIdsOf(loc) {
  const v = loc.unitIds ?? loc.unit_ids ?? loc.units;
  return Array.isArray(v) ? v.map((u) => (u && typeof u === 'object' ? (u.id ?? u.unitId) : u)) : [];
}
function levelCodesOf(loc) {
  const v = loc.levelCodes ?? loc.level_codes ?? loc.levels;
  return Array.isArray(v)
    ? v.map((l) => (l && typeof l === 'object' ? l.code : l))
    : [];
}
function displayNodesOf(loc) {
  const v = loc.displayNodes ?? loc.display_nodes ?? loc.nodes;
  return Array.isArray(v) ? v : [];
}
function nodePoint(node) {
  if (!node) return null;
  const p = node.point ?? node;
  if (p == null) return null;
  if (Array.isArray(p)) return { x: p[0], y: p[1] };
  return { x: p.x, y: p.y };
}

// --- Synthetic mini-bundle: a multi-unit shop + a placed toilet facility ---
// Neither exists on the sparse SGC seed, so this is the only witness for those
// rules. Shape (deliberately divergent from SGC so a hard-coded catalog fails):
//   level M1 (id 10), level M2 (id 20)
//   - unit 201 (M1, shop) tenancy shop:1 "Dual Diner"  (part A of multi-unit shop)
//   - unit 202 (M2, shop) tenancy shop:1 "Dual Diner"  (part B -> spans 2 floors)
//   - unit 203 (M1, shop) tenancies shop:2 + shop:3   (MULTI-TENANT unit)
//   - unit 204 (M1, toilet) routable non-connector facility -> unit:204
//   - unit 205 (M1, escalator) connector -> NO Location
//   - unit 206 (M1, parking)  non-routable -> NO Location
//   - unit 207 (M1, shop, NO tenancy) vacant -> NO Location
function makeMiniBundle() {
  const square = (x, y) => ({
    type: 'Polygon',
    coordinates: [[[x, y], [x + 10, y], [x + 10, y + 10], [x, y + 10], [x, y]]]
  });
  const unit = (over) => ({
    id: 0, level_id: 10, layer_id: 1, kind: 'shop', name: '',
    geometry: square(0, 0), display_point: [5, 5], position: 0, is_active: true,
    hidden: false, locked: false, opacity: 1.0,
    stroke_color: '', stroke_width: null, fill_color: '',
    doors: [], connector_group_id: null, label_rotation: 0.0, label_point: [5, 5],
    tenancies: [], ...over
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
      { id: 2, slug: 'toilet', label: 'Toilet', position: 1, stroke_color: '#000', stroke_width: 1.0, fill_color: '#eee', is_system: true, is_tenant: false, is_routable: true, is_connector: false, is_accessible: true },
      { id: 3, slug: 'escalator', label: 'Escalator', position: 2, stroke_color: '#000', stroke_width: 1.0, fill_color: '#eee', is_system: true, is_tenant: false, is_routable: true, is_connector: true, is_accessible: false },
      { id: 4, slug: 'parking', label: 'Parking', position: 3, stroke_color: '#000', stroke_width: 1.0, fill_color: '#eee', is_system: true, is_tenant: false, is_routable: false, is_connector: false, is_accessible: false }
    ],
    units: [
      unit({ id: 201, level_id: 10, layer_id: 1, kind: 'shop', label_point: [5, 5], label_rotation: 0, tenancies: [{ shop_id: 1, name: 'Dual Diner' }] }),
      unit({ id: 202, level_id: 20, layer_id: 2, kind: 'shop', geometry: square(20, 0), label_point: [25, 5], label_rotation: 90, tenancies: [{ shop_id: 1, name: 'Dual Diner' }] }),
      unit({ id: 203, level_id: 10, layer_id: 1, kind: 'shop', geometry: square(40, 0), label_point: [45, 5], label_rotation: 0, tenancies: [{ shop_id: 2, name: 'Twin A' }, { shop_id: 3, name: 'Twin B' }] }),
      unit({ id: 204, level_id: 10, layer_id: 1, kind: 'toilet', geometry: square(60, 0), label_point: [65, 5], label_rotation: 0, tenancies: [] }),
      unit({ id: 205, level_id: 10, layer_id: 1, kind: 'escalator', geometry: square(80, 0), label_point: [85, 5], label_rotation: 0, connector_group_id: 7, tenancies: [] }),
      unit({ id: 206, level_id: 10, layer_id: 1, kind: 'parking', geometry: square(100, 0), label_point: [105, 5], label_rotation: 0, tenancies: [] }),
      unit({ id: 207, level_id: 10, layer_id: 1, kind: 'shop', geometry: square(120, 0), label_point: [125, 5], label_rotation: 0, tenancies: [] })
    ],
    shops: [
      { id: 1, mall: 99, name: 'Dual Diner', slug: 'dual-diner', logo: '/media/dual.png', description: 'two floors of food', category: 1, unit_number: 'M-DUAL', contact_phone: '', contact_email: '', website: '', operating_hours: {}, is_active: true },
      { id: 2, mall: 99, name: 'Twin A', slug: 'twin-a', logo: null, description: 'left twin', category: 1, unit_number: 'M-2A', contact_phone: '', contact_email: '', website: '', operating_hours: {}, is_active: true },
      { id: 3, mall: 99, name: 'Twin B', slug: 'twin-b', logo: null, description: 'right twin', category: 2, unit_number: 'M-2B', contact_phone: '', contact_email: '', website: '', operating_hours: {}, is_active: true }
    ],
    categories: [
      { id: 1, name: 'Food', slug: 'food', icon: null },
      { id: 2, name: 'Retail', slug: 'retail', icon: null }
    ],
    navmesh_by_level: {
      10: { vertices: [[0, 0], [10, 0], [10, 10]], triangles: [[0, 1, 2]], adjacency: [[-1, -1, -1]], doors_by_unit: {}, centroids_by_unit: {}, envelope_dims: [140, 10] }
    },
    transitions: [
      { group_id: 7, name: 'mini-connector', direction: 'bidirectional', cost: 2.0, is_accessible: false, members: [{ unit_id: 205, level_id: 10, centroid: [85, 5], position: 100 }] }
    ]
  };
}

describe('destination-catalog: LocationStore destination catalog', () => {
  // ---- Criterion 1: catalog = placed shops only (count + round-trip + fields) ----
  describe('placed-shops-only catalog (real SGC seed)', () => {
    let store;
    let raw;
    beforeEach(async () => {
      raw = loadSgcRaw();
      ({ store } = await buildCatalog(raw));
    });

    it('has exactly 5 shop Locations — distinct tenancy shop_ids, not shops[].length (20)', () => {
      const distinctTenancyShopIds = new Set();
      for (const u of raw.units) {
        for (const t of (u.tenancies || [])) distinctTenancyShopIds.add(t.shop_id);
      }
      // Ground truth on this seed: 5 distinct placed shops from 4 tenanted units.
      expect(distinctTenancyShopIds.size).toBe(5);
      expect(raw.shops.length).toBe(20);

      const shops = shopLocations(store);
      expect(shops.length).toBe(5);
      expect(shops.length).not.toBe(raw.shops.length);
    });

    it('catalogs exactly the 5 placed shop ids (10,1,7,11,4) and excludes the 15 unplaced', () => {
      const ids = shopLocations(store).map((l) => l.id).sort();
      expect(ids).toEqual(['shop:1', 'shop:10', 'shop:11', 'shop:4', 'shop:7'].sort());

      // A shop present in shops[] but referenced by NO tenancy yields no Location.
      // shop id 2 is in shops[] but never tenanted on this seed.
      expect(raw.shops.some((s) => s.id === 2)).toBe(true);
      expect(store.getLocation('shop:2')).toBeFalsy();
    });

    it('getLocation("shop:10") round-trips Starbucks with title/logo/description/venue', () => {
      const loc = store.getLocation('shop:10');
      expect(loc, 'shop:10 must be retrievable').toBeTruthy();
      expect(loc.id).toBe('shop:10');
      expect(loc.title).toBe('Starbucks');
      // logo + description carried verbatim off the shop record.
      const shop = raw.shops.find((s) => s.id === 10);
      expect(loc.logo).toBe(shop.logo);
      expect(loc.description).toBe(shop.description);
      // venue is a non-empty string (mall/venue name), not undefined.
      expect(typeof loc.venue).toBe('string');
      expect(loc.venue.length).toBeGreaterThan(0);
    });

    it('search_tokens for a placed shop include name + unit_number + category name', () => {
      const loc = store.getLocation('shop:1'); // ABC Mart Grand Stage
      const tokens = loc.search_tokens.map((t) => String(t).toLowerCase());
      const blob = tokens.join(' | ');
      expect(blob).toContain('abc mart grand stage'); // name
      expect(blob).toContain('l1-01'); // shop.unit_number
      expect(blob).toContain('fashion'); // category "Fashion & Apparel"
    });
  });

  // ---- Criterion 4 (SGC half): no facility Locations on the real seed ----
  describe('facility units on the real SGC seed', () => {
    it('produces zero unit:<id> Locations (no facility units placed) — catalog is shops only', async () => {
      const { store } = await buildCatalog(loadSgcRaw());
      expect(facilityLocations(store).length).toBe(0);
      // Every catalogued Location is therefore a placed shop.
      expect(store.locations.length).toBe(5);
      expect(store.locations.every((l) => String(l.id).startsWith('shop:'))).toBe(true);
    });
  });

  // ---- Criterion 3 & 6: multi-tenant unit 121 -> two Locations sharing the unit ----
  describe('multi-tenant unit 121 (ASICS + Basta Hiro) on the real seed', () => {
    let store;
    beforeEach(async () => {
      ({ store } = await buildCatalog(loadSgcRaw()));
    });

    it('yields one Location per tenancy: shop:7 (ASICS) and shop:11 (Basta Hiro)', () => {
      const asics = store.getLocation('shop:7');
      const basta = store.getLocation('shop:11');
      expect(asics, 'shop:7 ASICS').toBeTruthy();
      expect(basta, 'shop:11 Basta Hiro').toBeTruthy();
      expect(asics.title).toBe('ASICS');
      expect(basta.title).toBe('Basta Hiro');
      // both list the SHARED unit 121.
      expect(unitIdsOf(asics)).toContain(121);
      expect(unitIdsOf(basta)).toContain(121);
    });

    it('getLocationsByUnitId(121) returns BOTH Locations (one-to-many)', () => {
      const list = store.getLocationsByUnitId(121);
      expect(Array.isArray(list)).toBe(true);
      const ids = list.map((l) => l.id).sort();
      expect(ids).toEqual(['shop:11', 'shop:7']);
    });

    it('getLocationsByUnitId for a single-tenant unit (108 Starbucks) returns exactly one', () => {
      const list = store.getLocationsByUnitId(108);
      expect(Array.isArray(list)).toBe(true);
      expect(list.length).toBe(1);
      expect(list[0].id).toBe('shop:10');
    });
  });

  // ---- Criterion 5 & 6: vacant / connector units produce nothing ----
  describe('vacant shop-kind and connector units (real seed)', () => {
    let store;
    let raw;
    beforeEach(async () => {
      raw = loadSgcRaw();
      ({ store } = await buildCatalog(raw));
    });

    it('a vacant shop-kind unit (no tenancy) produces no Location and an empty owner list', () => {
      const vacant = raw.units.find(
        (u) => u.kind === 'shop' && (!u.tenancies || u.tenancies.length === 0)
      );
      expect(vacant, 'the seed has vacant shop-kind units').toBeTruthy();
      // 149 of 153 shop-kind units are vacant.
      const vacantCount = raw.units.filter(
        (u) => u.kind === 'shop' && (!u.tenancies || u.tenancies.length === 0)
      ).length;
      expect(vacantCount).toBe(149);

      expect(store.getLocationsByUnitId(vacant.id)).toEqual([]);
    });

    it('a connector unit (escalator/elevator) produces no Location and an empty owner list', () => {
      const connectorKinds = new Set(
        raw.kinds.filter((k) => k.is_connector).map((k) => k.slug)
      );
      const connector = raw.units.find((u) => connectorKinds.has(u.kind));
      expect(connector, 'the seed has connector units').toBeTruthy();
      expect(store.getLocationsByUnitId(connector.id)).toEqual([]);
      // no connector unit id appears among any catalogued Location's units.
      const allOwnedUnitIds = new Set(store.locations.flatMap((l) => unitIdsOf(l)));
      expect(allOwnedUnitIds.has(connector.id)).toBe(false);
    });
  });

  // ---- Criterion 7: displayNodes mirror each unit's label anchor/angle/level ----
  describe('displayNodes per Location (real seed)', () => {
    it('shop:1 (ABC Mart, unit 119) has one displayNode: point=label_point, rotation, level L3', async () => {
      const raw = loadSgcRaw();
      const { store } = await buildCatalog(raw);
      const unit119 = raw.units.find((u) => u.id === 119);
      expect(unit119.tenancies[0].shop_id).toBe(1); // sanity: 119 is ABC Mart's unit

      const loc = store.getLocation('shop:1');
      const nodes = displayNodesOf(loc);
      expect(nodes.length).toBe(1);

      const node = nodes[0];
      const pt = nodePoint(node);
      expect(pt.x).toBeCloseTo(unit119.label_point[0], 6);
      expect(pt.y).toBeCloseTo(unit119.label_point[1], 6);
      // label_rotation 90 carried onto the node's rotation, converted deg->rad
      // (the renderer consumes radians; see the map-labels contract).
      expect(node.rotation).toBeCloseTo((unit119.label_rotation * Math.PI) / 180, 9);
      // levelCode derived from unit.level_id (5 -> L3).
      expect(node.levelCode).toBe('L3');
    });
  });

  // ---- Criterion 2: a multi-unit shop spans units + floors (mini-bundle) ----
  describe('multi-unit shop (mini-bundle, absent from SGC)', () => {
    let store;
    beforeEach(async () => {
      ({ store } = await buildCatalog(makeMiniBundle()));
    });

    it('shop:1 Dual Diner exposes BOTH units (201,202) in unitIds[]', () => {
      const loc = store.getLocation('shop:1');
      expect(loc, 'mini shop:1 must be catalogued').toBeTruthy();
      expect(unitIdsOf(loc).sort()).toEqual([201, 202]);
    });

    it('shop:1 Dual Diner spans BOTH floors (M1,M2) in levelCodes[]', () => {
      const loc = store.getLocation('shop:1');
      expect(levelCodesOf(loc).sort()).toEqual(['M1', 'M2']);
    });

    it('its displayNodes carry one entry per unit with each unit own label_point/level', () => {
      const loc = store.getLocation('shop:1');
      const nodes = displayNodesOf(loc);
      expect(nodes.length).toBe(2);
      const byLevel = new Map(nodes.map((n) => [n.levelCode, nodePoint(n)]));
      expect(byLevel.has('M1')).toBe(true);
      expect(byLevel.has('M2')).toBe(true);
      // unit 201 on M1 anchored at [5,5]; unit 202 on M2 anchored at [25,5].
      expect(byLevel.get('M1')).toEqual({ x: 5, y: 5 });
      expect(byLevel.get('M2')).toEqual({ x: 25, y: 5 });
    });
  });

  // ---- Criterion 4 (mini half): a placed toilet facility -> unit:<id> Location ----
  describe('routable facility unit (mini-bundle toilet)', () => {
    let store;
    beforeEach(async () => {
      ({ store } = await buildCatalog(makeMiniBundle()));
    });

    it('a routable non-connector non-tenant toilet unit (204) becomes Location "unit:204"', () => {
      const loc = store.getLocation('unit:204');
      expect(loc, 'a placed toilet must produce a unit:<id> Location').toBeTruthy();
      expect(loc.id).toBe('unit:204');
      expect(unitIdsOf(loc)).toEqual([204]);
      // it appears in the facility subset of the catalog.
      expect(facilityLocations(store).map((l) => l.id)).toContain('unit:204');
    });

    it('getLocationsByUnitId(204) returns the single facility Location', () => {
      const list = store.getLocationsByUnitId(204);
      expect(Array.isArray(list)).toBe(true);
      expect(list.map((l) => l.id)).toEqual(['unit:204']);
    });
  });

  // ---- Criterion 5 & 6: mini-bundle exclusions (connector, parking, vacant) ----
  describe('excluded units produce no Location (mini-bundle)', () => {
    let store;
    beforeEach(async () => {
      ({ store } = await buildCatalog(makeMiniBundle()));
    });

    it('the escalator connector (205) yields no Location and empty owner list', () => {
      expect(store.getLocation('unit:205')).toBeFalsy();
      expect(store.getLocationsByUnitId(205)).toEqual([]);
    });

    it('the non-routable parking unit (206) yields no Location and empty owner list', () => {
      expect(store.getLocation('unit:206')).toBeFalsy();
      expect(store.getLocationsByUnitId(206)).toEqual([]);
    });

    it('the vacant shop-kind unit (207, no tenancy) yields no Location and empty owner list', () => {
      expect(store.getLocation('unit:207')).toBeFalsy();
      expect(store.getLocationsByUnitId(207)).toEqual([]);
    });
  });

  // ---- Criterion 3 & 6: multi-tenant unit 203 in the mini-bundle ----
  describe('multi-tenant unit (mini-bundle unit 203 -> Twin A + Twin B)', () => {
    let store;
    beforeEach(async () => {
      ({ store } = await buildCatalog(makeMiniBundle()));
    });

    it('produces one Location per tenancy (shop:2, shop:3), both listing unit 203', () => {
      const a = store.getLocation('shop:2');
      const b = store.getLocation('shop:3');
      expect(a, 'shop:2 Twin A').toBeTruthy();
      expect(b, 'shop:3 Twin B').toBeTruthy();
      expect(unitIdsOf(a)).toContain(203);
      expect(unitIdsOf(b)).toContain(203);
    });

    it('getLocationsByUnitId(203) returns BOTH tenant Locations (>=2)', () => {
      const list = store.getLocationsByUnitId(203);
      expect(Array.isArray(list)).toBe(true);
      expect(list.length).toBe(2);
      expect(list.map((l) => l.id).sort()).toEqual(['shop:2', 'shop:3']);
    });
  });
});
// <<< TARS cap:destination-catalog
