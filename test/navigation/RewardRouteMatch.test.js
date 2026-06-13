// >>> TARS cap:reward-route-matching
//
// reward-route-matching — a PURE matcher (`rewardRouteMatch`) that, given a drawn
// route (its per-floor `segments` polylines + start/end Locations) plus the
// placed-shop catalog (`LocationStore`) and the active-reward store
// (`RewardStore`), selects the reward-shops that lie WITHIN a tunable `buffer` of
// the per-floor route polyline. The selection is:
//   * route-GATED      — a shop on a floor not present in `route.segments` is out;
//   * near-PATH        — display point within `buffer` of that floor's polyline;
//   * endpoint-SUPPRESSED — the route's own start/end shops are excluded;
//   * DEDUPED per shop — a shop with several near placements yields ONE entry,
//     carrying that shop's active rewards + the `levelCode` it was matched on;
//   * EMPTY for no/absent route.
//
// Pure Node/Vitest: a synthetic mini-bundle (rewards on the `datas` half) is
// hydrated through the REAL BundleLoader -> LocationStore (catalog) + RewardStore
// (active-window join). Routes are HAND-BUILT (`segments` Map + start/end
// Locations) so the geometry is the witness — no PathFinder dependency, no port.
// Coordinates are raw CMS units with renderScale=1, so the buffer and the display
// points share ONE coordinate space (the inherited tech-stack decision).
//
// Targets (one per acceptance criterion):
//   1. a reward-shop whose display point is within `buffer` of the floor polyline
//      is selected; one beyond `buffer` is excluded.
//   2. a reward-shop on a floor NOT in route.segments is excluded; the same shop
//      on a traversed floor near the line is included (levelCode carried).
//   3. the route's start shop and end shop are excluded even when they carry
//      active rewards and sit within the buffer.
//   4. a shop with multiple near display points produces exactly ONE entry,
//      carrying that shop's active rewards.
//   5. an empty / absent route produces an empty selection.

import { describe, it, expect } from 'vitest';
import { BundleLoader } from '../../src/data/BundleLoader.js';
import { LocationStore } from '../../src/data/LocationModel.js';

// Deterministic active-window for the RewardStore join. Every reward in the
// mini-bundle uses this window and `NOW` sits strictly inside it, so the active
// filter never silently drops a reward this suite is reasoning about.
const WINDOW_START = '2026-06-01T00:00:00Z';
const WINDOW_END = '2026-06-30T23:59:59Z';
const NOW = new Date('2026-06-13T12:00:00Z');

// --- Lazy module resolution -------------------------------------------------
// The matcher is not built yet. Resolve it lazily across the plausible homes
// (`src/navigation/RewardRouteMatch.js` or the navigation barrel) and the
// plausible export name, so the suite COLLECTS cleanly and each test fails on a
// behavioural assertion (an explicit, message-bearing failure) rather than a
// module-resolution crash. Once the module exists these pass through unchanged.
async function tryImport(path) {
  try {
    return await import(path);
  } catch {
    return null;
  }
}

async function importRewardRouteMatch() {
  const candidates = [
    '../../src/navigation/RewardRouteMatch.js',
    '../../src/navigation/rewardRouteMatch.js',
    '../../src/navigation/index.js'
  ];
  let fn = null;
  for (const path of candidates) {
    const mod = await tryImport(path);
    if (mod && typeof mod.rewardRouteMatch === 'function') {
      fn = mod.rewardRouteMatch;
      break;
    }
    if (mod && typeof mod.default === 'function') {
      fn = mod.default;
      break;
    }
  }
  expect(
    fn,
    'a pure rewardRouteMatch() must be exported from src/navigation/ (RewardRouteMatch.js or the barrel)'
  ).toBeTypeOf('function');
  return fn;
}

async function importRewardStore() {
  const mod = await tryImport('../../src/data/RewardStore.js');
  expect(mod, 'src/data/RewardStore.js must exist').not.toBeNull();
  expect(mod.RewardStore, 'RewardStore.js must export a RewardStore class').toBeTypeOf('function');
  return mod.RewardStore;
}

// --- Synthetic mini-bundle --------------------------------------------------
// Two meshed-ish floors M1/M2. Shops are placed via tenancies (so the catalog
// produces `shop:<id>` Locations with displayNodes at their label_point).
//
// Label points (raw CMS coords; the route polylines below run along y≈0 / y≈100):
//   shop 1 (M1, unit 201)  near-line  display (10, 2)   <- within buffer 5 of y=0
//   shop 2 (M1, unit 202)  FAR        display (50, 40)  <- beyond buffer 5 of y=0
//   shop 3 (M1, units 203+213) two placements: (30, 2) near + (35, 3) near (DEDUPE)
//   shop 4 (M1, unit 204)  START shop  display (0, 1)   <- on the line, suppressed
//   shop 5 (M2, unit 205)  END shop    display (90, 101) <- near M2 line, suppressed
//   shop 6 (M2, unit 206)  near-line on the OTHER floor display (60, 102)
//   shop 7 (M1, unit 207)  near-line BUT no active reward (control)
const REWARD_SHOP_IDS = [1, 2, 3, 4, 5, 6, 7];

function makeMatchBundle() {
  const square = (cx, cy, half = 1) => ({
    type: 'Polygon',
    coordinates: [[
      [cx - half, cy - half],
      [cx + half, cy - half],
      [cx + half, cy + half],
      [cx - half, cy + half],
      [cx - half, cy - half]
    ]]
  });
  const unit = ({ id, levelId, layerId, shopId, name, x, y }) => ({
    id,
    level_id: levelId,
    layer_id: layerId,
    kind: 'shop',
    name: '',
    geometry: square(x, y),
    display_point: [x, y],
    label_point: [x, y],
    label_rotation: 0,
    position: 0,
    is_active: true,
    hidden: false,
    locked: false,
    opacity: 1.0,
    stroke_color: '',
    stroke_width: null,
    fill_color: '',
    doors: [],
    connector_group_id: null,
    tenancies: [{ shop_id: shopId, name }]
  });
  const shop = (id, name) => ({
    id, mall: 99, name, slug: `s${id}`, logo: null, description: '', category: 1,
    unit_number: `${id}`, contact_phone: '', contact_email: '', website: '',
    operating_hours: {}, is_active: true
  });
  // An active reward in the deterministic window for a set of shops.
  const reward = (id, shops, title, type = 'deals') => ({
    id, name: title, title, type, shops, start_date: WINDOW_START, end_date: WINDOW_END
  });

  const M1 = 10;
  const M2 = 11;
  return {
    mall: { id: 99, name: 'Match Mall', code: 'MATCH' },
    levels: [
      { id: M1, name: 'M1', code: 'M1', position: 100, hidden: false, locked: false, opacity: 1.0 },
      { id: M2, name: 'M2', code: 'M2', position: 200, hidden: false, locked: false, opacity: 1.0 }
    ],
    layers: [
      { id: 1, level_id: M1, parent_id: null, name: 'L', position: 0, stroke_color: '', stroke_width: null, fill_color: '' },
      { id: 2, level_id: M2, parent_id: null, name: 'L', position: 0, stroke_color: '', stroke_width: null, fill_color: '' }
    ],
    kinds: [
      { id: 1, slug: 'shop', label: 'Shop', position: 0, stroke_color: '#1e40af', stroke_width: 1.5, fill_color: '#dbeafe', is_system: true, is_tenant: true, is_routable: true, is_connector: false, is_accessible: false }
    ],
    units: [
      unit({ id: 201, levelId: M1, layerId: 1, shopId: 1, name: 'Near', x: 10, y: 2 }),
      unit({ id: 202, levelId: M1, layerId: 1, shopId: 2, name: 'Far', x: 50, y: 40 }),
      // shop 3 spans two M1 units, both near the M1 line (the dedupe witness).
      unit({ id: 203, levelId: M1, layerId: 1, shopId: 3, name: 'Twin', x: 30, y: 2 }),
      unit({ id: 213, levelId: M1, layerId: 1, shopId: 3, name: 'Twin', x: 35, y: 3 }),
      unit({ id: 204, levelId: M1, layerId: 1, shopId: 4, name: 'Start', x: 0, y: 1 }),
      unit({ id: 205, levelId: M2, layerId: 2, shopId: 5, name: 'End', x: 90, y: 101 }),
      unit({ id: 206, levelId: M2, layerId: 2, shopId: 6, name: 'OtherFloor', x: 60, y: 102 }),
      unit({ id: 207, levelId: M1, layerId: 1, shopId: 7, name: 'NoReward', x: 20, y: 2 })
    ],
    shops: REWARD_SHOP_IDS.map((id) => shop(id, `Shop ${id}`)),
    categories: [{ id: 1, name: 'Retail', slug: 'retail', icon: null }],
    navmesh_by_level: {
      [M1]: { vertices: [[0, 0], [100, 0], [100, 50]], triangles: [[0, 1, 2]], adjacency: [[-1, -1, -1]], doors_by_unit: {}, centroids_by_unit: {}, envelope_dims: [100, 50] },
      [M2]: { vertices: [[0, 100], [100, 100], [100, 150]], triangles: [[0, 1, 2]], adjacency: [[-1, -1, -1]], doors_by_unit: {}, centroids_by_unit: {}, envelope_dims: [100, 50] }
    },
    transitions: [],
    rewards: [
      reward(1, [1], '20% off coffee'),       // shop 1 — near M1
      reward(2, [2], 'Far deal'),              // shop 2 — far on M1
      reward(3, [3], 'Twin tenancy deal'),     // shop 3 — two near M1 placements
      reward(4, [4], 'Start shop deal'),       // shop 4 — START shop (suppressed)
      reward(5, [5], 'End shop deal'),         // shop 5 — END shop (suppressed)
      reward(6, [6], 'Cross-floor deal', 'rewards') // shop 6 — near the M2 line
      // shop 7 deliberately has NO reward (a near-line control that must NOT pin).
    ]
  };
}

// --- Build the catalog + reward store from the mini-bundle ------------------
async function buildStores(rawBundle = makeMatchBundle(), now = NOW) {
  const RewardStore = await importRewardStore();
  const loader = new BundleLoader({ load: () => Promise.resolve(structuredClone(rawBundle)) });
  const model = await loader.load('/bundle.json');

  const locationStore = new LocationStore();
  locationStore.hydrate(model, { renderScale: 1 });

  // Hydrate the reward store with `now` injected, tolerant of the constructor /
  // hydrate / setter injection seam (mirrors the reward-catalog suite).
  let rewardStore;
  try { rewardStore = new RewardStore({ now }); } catch { rewardStore = new RewardStore(); }
  const attempts = [
    () => rewardStore.hydrate(model, { catalog: locationStore, locationStore, now }),
    () => rewardStore.hydrate(model, locationStore, { now }),
    () => rewardStore.hydrate(model, { now })
  ];
  for (const attempt of attempts) {
    try { attempt(); break; } catch { /* next shape */ }
  }
  if (typeof rewardStore.setNow === 'function') rewardStore.setNow(now);

  return { model, locationStore, rewardStore };
}

// --- Route construction (hand-built, no PathFinder) -------------------------
// A route is { segments: Map<levelCode, [x,y][]>, startLocation, endLocation }.
// `startLocation`/`endLocation` are the catalog Location objects (so the matcher
// can read their `shop:<id>` ids for endpoint suppression), matching the shape
// PathFinder attaches on a successful RouteResult.
function makeRoute(locationStore, { floors, startId = null, endId = null }) {
  const segments = new Map();
  for (const [code, poly] of Object.entries(floors)) segments.set(code, poly);
  return {
    success: true,
    segments,
    transitions: [],
    distance: 0,
    startLocation: startId ? locationStore.getLocation(startId) : null,
    endLocation: endId ? locationStore.getLocation(endId) : null
  };
}

// Invoke the matcher across the plausible call shapes (keyword bag first, then a
// route-then-options positional form), so the test pins BEHAVIOUR not a fixed
// signature. The returned value is normalized to an array of selection entries.
function runMatch(rewardRouteMatch, { route, locationStore, rewardStore, buffer, now = NOW }) {
  const bag = { route, locationStore, catalog: locationStore, rewardStore, buffer, now };
  const shapes = [
    () => rewardRouteMatch(bag),
    () => rewardRouteMatch(route, { locationStore, catalog: locationStore, rewardStore, buffer, now }),
    () => rewardRouteMatch(route, locationStore, rewardStore, buffer)
  ];
  let out;
  let lastErr;
  for (const call of shapes) {
    try { out = call(); if (out !== undefined) break; } catch (err) { lastErr = err; }
  }
  if (out === undefined && lastErr) throw lastErr;
  // Tolerate either a bare array or a { selection } wrapper.
  if (Array.isArray(out)) return out;
  if (out && Array.isArray(out.selection)) return out.selection;
  if (out && Array.isArray(out.entries)) return out.entries;
  return [];
}

// Pull a stable shop id out of a selection entry however it is spelled (the entry
// is a per-shop selection record carrying its rewards + matched levelCode).
function entryShopId(entry) {
  if (entry == null) return null;
  if (entry.shopId != null) return Number(entry.shopId);
  if (entry.shop_id != null) return Number(entry.shop_id);
  // Fall back to a `shop:<id>` location id if the entry carries the Location.
  const locId = entry.id ?? entry.location?.id;
  if (typeof locId === 'string' && locId.startsWith('shop:')) {
    return Number(locId.slice('shop:'.length));
  }
  return null;
}

const selectedShopIds = (selection) =>
  selection.map(entryShopId).filter((id) => id != null).sort((a, b) => a - b);

describe('reward-route-matching: rewardRouteMatch() near-path selection', () => {
  // ===== Criterion 1: within-buffer included, beyond-buffer excluded =========
  describe('buffer inclusion / exclusion against the floor polyline', () => {
    it('selects a reward-shop whose display point is WITHIN buffer of the polyline; excludes one BEYOND it', async () => {
      const { locationStore, rewardStore } = await buildStores();
      const rewardRouteMatch = await importRewardRouteMatch();

      // M1-only route along the line y=0 from (0,0) to (100,0); NO endpoint shops
      // so endpoint-suppression cannot mask the buffer test.
      const route = makeRoute(locationStore, { floors: { M1: [[0, 0], [100, 0]] } });
      const selection = runMatch(rewardRouteMatch, {
        route, locationStore, rewardStore, buffer: 5
      });
      const ids = selectedShopIds(selection);

      // shop 1 @ (10,2) is 2 units off the line -> within buffer 5 -> selected.
      expect(ids, 'near-line reward-shop 1 must be selected').toContain(1);
      // shop 2 @ (50,40) is 40 units off the line -> beyond buffer 5 -> excluded.
      expect(ids, 'far reward-shop 2 must be excluded').not.toContain(2);
    });

    it('tightening the buffer below a shop\'s offset drops that shop from the selection', async () => {
      const { locationStore, rewardStore } = await buildStores();
      const rewardRouteMatch = await importRewardRouteMatch();
      const route = makeRoute(locationStore, { floors: { M1: [[0, 0], [100, 0]] } });

      // shop 1 sits 2 units off the line. buffer 1 < 2 -> it must drop out, proving
      // the threshold is the real `buffer` distance (not "any shop on the floor").
      const tight = runMatch(rewardRouteMatch, { route, locationStore, rewardStore, buffer: 1 });
      expect(selectedShopIds(tight)).not.toContain(1);

      // Loosening past its offset brings it back.
      const loose = runMatch(rewardRouteMatch, { route, locationStore, rewardStore, buffer: 3 });
      expect(selectedShopIds(loose)).toContain(1);
    });

    it('does NOT select a near-line shop that has no ACTIVE reward (shop 7 control)', async () => {
      const { locationStore, rewardStore } = await buildStores();
      const rewardRouteMatch = await importRewardRouteMatch();
      const route = makeRoute(locationStore, { floors: { M1: [[0, 0], [100, 0]] } });

      const ids = selectedShopIds(runMatch(rewardRouteMatch, { route, locationStore, rewardStore, buffer: 5 }));
      // shop 7 @ (20,2) is near the line but carries NO reward -> never pinned.
      expect(ids, 'a near-line shop with no active reward must not be selected').not.toContain(7);
    });
  });

  // ===== Criterion 2: route-gated by floor; levelCode carried ================
  describe('route-gating by traversed floor + levelCode on each entry', () => {
    it('a reward-shop on a floor NOT in route.segments is excluded', async () => {
      const { locationStore, rewardStore } = await buildStores();
      const rewardRouteMatch = await importRewardRouteMatch();

      // Route traverses M1 ONLY. shop 6 is placed on M2 (untraversed) near where
      // an M2 line would run, but M2 is absent from segments -> excluded.
      const route = makeRoute(locationStore, { floors: { M1: [[0, 0], [100, 0]] } });
      const ids = selectedShopIds(runMatch(rewardRouteMatch, { route, locationStore, rewardStore, buffer: 5 }));
      expect(ids, 'shop 6 on the untraversed floor M2 must be excluded').not.toContain(6);
    });

    it('the same shop is included on a traversed floor, and its entry carries that levelCode', async () => {
      const { locationStore, rewardStore } = await buildStores();
      const rewardRouteMatch = await importRewardRouteMatch();

      // Now traverse M2 along y=100; shop 6 @ (60,102) is 2 units off -> selected.
      const route = makeRoute(locationStore, { floors: { M2: [[0, 100], [100, 100]] } });
      const selection = runMatch(rewardRouteMatch, { route, locationStore, rewardStore, buffer: 5 });
      const ids = selectedShopIds(selection);
      expect(ids, 'shop 6 on the traversed floor M2 must be selected').toContain(6);

      // The selected entry carries the levelCode it was matched on (M2), not M1.
      const entry = selection.find((e) => entryShopId(e) === 6);
      expect(entry, 'shop 6 selection entry must exist').toBeTruthy();
      expect(entry.levelCode, 'each selected entry carries its matched floor code').toBe('M2');
    });

    it('a multi-floor route only matches shops on the floors it actually traverses', async () => {
      const { locationStore, rewardStore } = await buildStores();
      const rewardRouteMatch = await importRewardRouteMatch();

      // Cross-floor route: a leg on M1 and a leg on M2. shop 1 (M1) and shop 6 (M2)
      // both qualify; shop 2 (M1, far) does not.
      const route = makeRoute(locationStore, {
        floors: { M1: [[0, 0], [100, 0]], M2: [[0, 100], [100, 100]] }
      });
      const selection = runMatch(rewardRouteMatch, { route, locationStore, rewardStore, buffer: 5 });
      const ids = selectedShopIds(selection);
      expect(ids).toContain(1);
      expect(ids).toContain(6);
      expect(ids).not.toContain(2);

      // Per-floor levelCode is honoured: shop 1 is matched on M1, shop 6 on M2.
      expect(selection.find((e) => entryShopId(e) === 1).levelCode).toBe('M1');
      expect(selection.find((e) => entryShopId(e) === 6).levelCode).toBe('M2');
    });
  });

  // ===== Criterion 3: start/end shops suppressed =============================
  describe('endpoint suppression: the route start/end shops are excluded', () => {
    it('excludes the start shop and the end shop even though both carry active rewards within the buffer', async () => {
      const { locationStore, rewardStore } = await buildStores();
      const rewardRouteMatch = await importRewardRouteMatch();

      // Precondition: both endpoint shops genuinely carry an active reward (so the
      // exclusion is endpoint-suppression, not a "no reward" artefact).
      expect(rewardStore.getRewardsByShopId(4).length, 'start shop 4 must carry an active reward').toBeGreaterThan(0);
      expect(rewardStore.getRewardsByShopId(5).length, 'end shop 5 must carry an active reward').toBeGreaterThan(0);

      // Route from shop:4 (M1 @ (0,1), on the M1 line) to shop:5 (M2 @ (90,101), on
      // the M2 line). Both endpoints sit within buffer 5 of their floor's line.
      const route = makeRoute(locationStore, {
        floors: { M1: [[0, 0], [100, 0]], M2: [[0, 100], [100, 100]] },
        startId: 'shop:4',
        endId: 'shop:5'
      });
      const ids = selectedShopIds(runMatch(rewardRouteMatch, { route, locationStore, rewardStore, buffer: 5 }));

      // The endpoints are suppressed...
      expect(ids, 'start shop 4 must be suppressed').not.toContain(4);
      expect(ids, 'end shop 5 must be suppressed').not.toContain(5);
      // ...while non-endpoint near-line reward-shops still come through.
      expect(ids, 'non-endpoint near-line shop 1 still selected').toContain(1);
      expect(ids, 'non-endpoint near-line shop 6 still selected').toContain(6);
    });
  });

  // ===== Criterion 4: one entry per shop (dedupe) ============================
  describe('dedupe: a shop with several near placements yields exactly one entry', () => {
    it('shop 3 (two near M1 placements) produces a single selection entry carrying its active rewards', async () => {
      const { locationStore, rewardStore } = await buildStores();
      const rewardRouteMatch = await importRewardRouteMatch();

      // Precondition: shop 3 really does have two display nodes near the line.
      const loc3 = locationStore.getLocation('shop:3');
      const nearNodes = loc3.displayNodes.filter(
        (n) => n.levelCode === 'M1' && Math.abs(n.point.y - 0) <= 5
      );
      expect(nearNodes.length, 'shop 3 must have >=2 near-line placements (the dedupe witness)').toBeGreaterThanOrEqual(2);

      const route = makeRoute(locationStore, { floors: { M1: [[0, 0], [100, 0]] } });
      const selection = runMatch(rewardRouteMatch, { route, locationStore, rewardStore, buffer: 5 });

      // Exactly ONE entry for shop 3 despite two near placements.
      const shop3Entries = selection.filter((e) => entryShopId(e) === 3);
      expect(shop3Entries.length, 'a shop with multiple near placements is deduped to one entry').toBe(1);

      // That entry carries shop 3's active rewards (reward id 3).
      const entry = shop3Entries[0];
      expect(Array.isArray(entry.rewards), 'a selection entry carries a rewards array').toBe(true);
      const rewardIds = entry.rewards.map((r) => r.id).sort((a, b) => a - b);
      expect(rewardIds, 'shop 3 entry carries its active reward (id 3)').toEqual([3]);
    });

    it('the overall selection has no duplicate shop ids', async () => {
      const { locationStore, rewardStore } = await buildStores();
      const rewardRouteMatch = await importRewardRouteMatch();
      const route = makeRoute(locationStore, {
        floors: { M1: [[0, 0], [100, 0]], M2: [[0, 100], [100, 100]] }
      });
      const ids = selectedShopIds(runMatch(rewardRouteMatch, { route, locationStore, rewardStore, buffer: 5 }));
      expect(ids.length, 'no shop id appears twice in the selection').toBe(new Set(ids).size);
    });
  });

  // ===== Criterion 5: empty / absent route -> empty selection ================
  describe('no route -> empty selection', () => {
    it('a null route produces an empty selection', async () => {
      const { locationStore, rewardStore } = await buildStores();
      const rewardRouteMatch = await importRewardRouteMatch();
      const selection = runMatch(rewardRouteMatch, { route: null, locationStore, rewardStore, buffer: 5 });
      expect(Array.isArray(selection)).toBe(true);
      expect(selection.length).toBe(0);
    });

    it('a route with empty segments produces an empty selection', async () => {
      const { locationStore, rewardStore } = await buildStores();
      const rewardRouteMatch = await importRewardRouteMatch();
      const route = makeRoute(locationStore, { floors: {} });
      const selection = runMatch(rewardRouteMatch, { route, locationStore, rewardStore, buffer: 5 });
      expect(Array.isArray(selection)).toBe(true);
      expect(selection.length).toBe(0);
    });

    it('a failed route (success:false, no segments) produces an empty selection', async () => {
      const { locationStore, rewardStore } = await buildStores();
      const rewardRouteMatch = await importRewardRouteMatch();
      const failed = { success: false, code: 'NO_PATH', segments: new Map(), transitions: [], startLocation: null, endLocation: null };
      const selection = runMatch(rewardRouteMatch, { route: failed, locationStore, rewardStore, buffer: 5 });
      expect(Array.isArray(selection)).toBe(true);
      expect(selection.length).toBe(0);
    });
  });
});
// <<< TARS cap:reward-route-matching
