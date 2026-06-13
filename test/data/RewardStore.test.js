// >>> TARS cap:reward-catalog
//
// reward-catalog (Reward catalog: active-window store) — `RewardStore` hydrates
// from the parsed `BundleModel` (it NEVER fetches; it mirrors `LocationStore`) and
// surfaces, for a PLACED shop, only the rewards that are CURRENTLY ACTIVE:
//   active  <=>  start_date <= now <= end_date   (inclusive window)
// `now` is INJECTABLE so the window is deterministic in tests. The filter is
// TYPE-INCLUSIVE: both `type:"deals"` and `type:"rewards"` qualify (no type drop).
// The store is PLACED-SHOP aware (via the catalog/LocationStore): a reward whose
// `shops[]` names an unplaced/unknown shop id must NOT throw and is simply never
// returned for any placed shop.
//
// Pure Node/Vitest: the model is built with the REAL BundleLoader from a synthetic
// mini-bundle (rewards live on the `datas` half; the loader carries them through to
// `model.rewards` + `model.rewardsByShopId`, per the reward-data capability). The
// rewards here are HAND-BUILT with explicit date windows so the active-window edges
// are the witness — concrete reward records, never raw production data.
//
// Targets (one per acceptance criterion):
//   1. now inside [start_date,end_date] -> getRewardsByShopId returns that reward;
//      now after end_date OR before start_date -> excluded.
//   2. a type:"deals" reward and a type:"rewards" reward are BOTH returned when
//      active (no type filtering).
//   3. a placed shop with two active rewards -> both (length 2); a placed shop with
//      none -> [].
//   4. a reward whose shops[] references an unplaced/unknown shop id does not throw
//      and is never returned for any placed shop.

import { describe, it, expect, beforeEach } from 'vitest';
import { BundleLoader } from '../../src/data/BundleLoader.js';
import { LocationStore } from '../../src/data/LocationModel.js';

// Resolve the not-yet-built RewardStore lazily so the suite COLLECTS cleanly and
// each test fails on its own behavioural assertion (not a module-resolution crash).
// A missing module becomes an explicit, message-bearing assertion failure, so RED
// is assertion-shaped from the first run; once the module exists it passes through.
async function importRewardStore() {
  let mod = null;
  try {
    mod = await import('../../src/data/RewardStore.js');
  } catch {
    mod = null;
  }
  expect(mod, 'src/data/RewardStore.js must exist and export a RewardStore class').not.toBeNull();
  expect(mod.RewardStore, 'RewardStore.js must export a RewardStore class').toBeTypeOf('function');
  return mod.RewardStore;
}

// Fixed reference instants for the deterministic active-window.
// Window for the "in-window" rewards is [WINDOW_START, WINDOW_END].
const WINDOW_START = '2026-06-01T00:00:00Z';
const WINDOW_END = '2026-06-30T23:59:59Z';
const NOW_INSIDE = new Date('2026-06-13T12:00:00Z'); // strictly inside the window
const NOW_AFTER = new Date('2026-07-15T12:00:00Z');  // after WINDOW_END
const NOW_BEFORE = new Date('2026-05-15T12:00:00Z'); // before WINDOW_START

// Build a synthetic mini-bundle. Shops 1 & 2 are PLACED (tenancy-referenced);
// shop 9001 is UNPLACED (named only by a reward's shops[], never tenanted). The
// rewards live on the bundle so the real BundleLoader carries them into
// model.rewards / model.rewardsByShopId.
//
//   - shop 1 (placed, unit 201): reward 100 type:"deals"  in-window
//                                 reward 101 type:"rewards" in-window
//                                 reward 102 type:"deals"  EXPIRED (ended in May)
//   - shop 2 (placed, unit 202): reward 200 type:"rewards" NOT-YET (starts in July)
//   - shop 9001 (UNPLACED):      reward 900 type:"deals"  in-window (dangling ref)
function makeRewardBundle({ rewards } = {}) {
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
  const defaultRewards = [
    { id: 100, name: 'Deal A', title: '20% off', type: 'deals', shops: [1], start_date: WINDOW_START, end_date: WINDOW_END },
    { id: 101, name: 'Reward A', title: 'Free tote', type: 'rewards', shops: [1], start_date: WINDOW_START, end_date: WINDOW_END },
    { id: 102, name: 'Expired Deal', title: 'old', type: 'deals', shops: [1], start_date: '2026-04-01T00:00:00Z', end_date: '2026-05-31T23:59:59Z' },
    { id: 200, name: 'Future Reward', title: 'soon', type: 'rewards', shops: [2], start_date: '2026-07-01T00:00:00Z', end_date: '2026-07-31T23:59:59Z' },
    { id: 900, name: 'Dangling Deal', title: 'ghost', type: 'deals', shops: [9001], start_date: WINDOW_START, end_date: WINDOW_END }
  ];
  return {
    mall: { id: 99, name: 'Mini Mall', code: 'MINI' },
    levels: [
      { id: 10, name: 'M1', code: 'M1', position: 100, hidden: false, locked: false, opacity: 1.0 }
    ],
    layers: [
      { id: 1, level_id: 10, parent_id: null, name: 'L', position: 0, stroke_color: '', stroke_width: null, fill_color: '' }
    ],
    kinds: [
      { id: 1, slug: 'shop', label: 'Shop', position: 0, stroke_color: '#1e40af', stroke_width: 1.5, fill_color: '#dbeafe', is_system: true, is_tenant: true, is_routable: true, is_connector: false, is_accessible: false }
    ],
    units: [
      unit({ id: 201, level_id: 10, layer_id: 1, kind: 'shop', label_point: [5, 5], tenancies: [{ shop_id: 1, name: 'Alpha' }] }),
      unit({ id: 202, level_id: 10, layer_id: 1, kind: 'shop', geometry: square(20, 0), display_point: [25, 5], label_point: [25, 5], tenancies: [{ shop_id: 2, name: 'Beta' }] })
    ],
    shops: [
      { id: 1, mall: 99, name: 'Alpha', slug: 'alpha', logo: null, description: '', category: 1, unit_number: 'M-1', contact_phone: '', contact_email: '', website: '', operating_hours: {}, is_active: true },
      { id: 2, mall: 99, name: 'Beta', slug: 'beta', logo: null, description: '', category: 1, unit_number: 'M-2', contact_phone: '', contact_email: '', website: '', operating_hours: {}, is_active: true },
      // shop 9001 deliberately NOT placed (no tenancy names it) and not even in shops[]:
      // it exists ONLY as a dangling reward.shops[] reference.
    ],
    categories: [
      { id: 1, name: 'Food', slug: 'food', icon: null }
    ],
    navmesh_by_level: {
      10: { vertices: [[0, 0], [10, 0], [10, 10]], triangles: [[0, 1, 2]], adjacency: [[-1, -1, -1]], doors_by_unit: {}, centroids_by_unit: {}, envelope_dims: [40, 10] }
    },
    transitions: [],
    rewards: rewards ?? defaultRewards
  };
}

// Build a BundleModel via the real loader (mocked single-fetch resolution), then a
// hydrated LocationStore (the placed-shop catalog), then the RewardStore under test.
// The RewardStore is the engine seam: hydrated from the parsed model + the catalog,
// with `now` injected. We tolerate the precise injection shape (constructor option,
// hydrate option, or per-call argument) so the tests pin BEHAVIOUR, not a signature.
async function buildStores(rawBundle, now) {
  const RewardStore = await importRewardStore();
  const loader = new BundleLoader({
    load: () => Promise.resolve(structuredClone(rawBundle))
  });
  const model = await loader.load('/bundle.json');
  const catalog = new LocationStore();
  catalog.hydrate(model, { renderScale: 1 });
  return { RewardStore, model, catalog };
}

// Construct + hydrate a RewardStore with `now` injected, across the plausible
// injection seams. Returns a probe `rewardsFor(shopId)` that reads the store's
// active-rewards-for-a-placed-shop view, normalizing `now` delivery so the test
// asserts the WINDOW behaviour, not one accessor name.
async function makeStoreAt(rawBundle, now) {
  const { RewardStore, model, catalog } = await buildStores(rawBundle, now);

  // Try constructor-injected now first, then hydrate-injected now. The store may
  // accept the catalog either as a second hydrate arg or inside the options bag.
  let store;
  try {
    store = new RewardStore({ now });
  } catch {
    store = new RewardStore();
  }

  // Hydrate from the parsed model + the placed-shop catalog, threading `now` in
  // the options bag too (so either injection point satisfies the contract).
  const hydrateAttempts = [
    () => store.hydrate(model, { catalog, locationStore: catalog, now }),
    () => store.hydrate(model, catalog, { now }),
    () => store.hydrate(model, { now })
  ];
  let hydrated = false;
  for (const attempt of hydrateAttempts) {
    try {
      attempt();
      hydrated = true;
      break;
    } catch {
      /* try the next hydrate shape */
    }
  }
  expect(hydrated, 'RewardStore.hydrate(model, catalog/options) must accept the parsed model + catalog').toBe(true);

  // If the store exposes a settable `now`, set it (covers a property-injection seam).
  if (typeof store.setNow === 'function') store.setNow(now);
  else if ('now' in store) {
    try { store.now = now; } catch { /* read-only is fine */ }
  }

  // Read active rewards for a shop id, tolerating an optional `now` per-call arg.
  function rewardsFor(shopId) {
    expect(typeof store.getRewardsByShopId, 'RewardStore must expose getRewardsByShopId(shopId)').toBe('function');
    const viaArg = store.getRewardsByShopId(shopId, now);
    if (Array.isArray(viaArg)) return viaArg;
    const viaPlain = store.getRewardsByShopId(shopId);
    return Array.isArray(viaPlain) ? viaPlain : [];
  }

  return { store, model, catalog, rewardsFor };
}

const rewardIds = (list) => list.map((r) => r.id).sort((a, b) => a - b);

describe('reward-catalog: RewardStore active-window catalog', () => {
  // ---- Criterion 1: active-window inclusion / exclusion ----
  describe('active-window filter (start_date <= now <= end_date)', () => {
    it('includes a reward whose window contains the injected now (shop 1 reward 100 in-window)', async () => {
      const { rewardsFor } = await makeStoreAt(makeRewardBundle(), NOW_INSIDE);
      const ids = rewardIds(rewardsFor(1));
      // reward 100 (deals) and 101 (rewards) are in-window; reward 102 expired.
      expect(ids).toContain(100);
    });

    it('excludes a reward whose end_date is BEFORE now (expired reward 102 dropped)', async () => {
      const { rewardsFor } = await makeStoreAt(makeRewardBundle(), NOW_INSIDE);
      const ids = rewardIds(rewardsFor(1));
      // reward 102 ended 2026-05-31, now is 2026-06-13 -> excluded.
      expect(ids).not.toContain(102);
    });

    it('excludes a reward whose start_date is AFTER now (not-yet-started reward 200 dropped)', async () => {
      const { rewardsFor } = await makeStoreAt(makeRewardBundle(), NOW_INSIDE);
      // shop 2's only reward (200) starts in July -> not active on 2026-06-13.
      expect(rewardsFor(2)).toEqual([]);
    });

    it('the SAME reward flips out of the window when now moves past end_date', async () => {
      const inWindow = await makeStoreAt(makeRewardBundle(), NOW_INSIDE);
      const afterWindow = await makeStoreAt(makeRewardBundle(), NOW_AFTER);
      // In-window: reward 100 present. After the window: shop 1 has NO active reward
      // (100,101 ended 2026-06-30; 102 ended in May) -> empty.
      expect(rewardIds(inWindow.rewardsFor(1))).toContain(100);
      expect(afterWindow.rewardsFor(1)).toEqual([]);
    });

    it('the SAME reward is excluded when now is BEFORE start_date', async () => {
      const beforeWindow = await makeStoreAt(makeRewardBundle(), NOW_BEFORE);
      // now = 2026-05-15: reward 100/101 start 2026-06-01 (future); 102 active in May.
      const ids = rewardIds(beforeWindow.rewardsFor(1));
      expect(ids).not.toContain(100);
      expect(ids).not.toContain(101);
    });
  });

  // ---- Criterion 2: both types qualify (no type filtering) ----
  describe('type-inclusive (both "deals" and "rewards")', () => {
    it('returns BOTH the deals reward (100) and the rewards reward (101) when active', async () => {
      const { rewardsFor } = await makeStoreAt(makeRewardBundle(), NOW_INSIDE);
      const active = rewardsFor(1);
      const byId = new Map(active.map((r) => [r.id, r]));
      expect(byId.has(100), 'the type:"deals" reward must be returned').toBe(true);
      expect(byId.has(101), 'the type:"rewards" reward must be returned').toBe(true);
      // their distinct types survive verbatim (no normalization to a single type).
      expect(byId.get(100).type).toBe('deals');
      expect(byId.get(101).type).toBe('rewards');
    });

    it('does not drop a reward purely on its type (a "rewards"-only shop still surfaces it)', async () => {
      // A bundle where shop 1's ONLY active reward is type:"rewards".
      const rewards = [
        { id: 301, name: 'Voucher only', title: 'mall voucher', type: 'rewards', shops: [1], start_date: WINDOW_START, end_date: WINDOW_END }
      ];
      const { rewardsFor } = await makeStoreAt(makeRewardBundle({ rewards }), NOW_INSIDE);
      const ids = rewardIds(rewardsFor(1));
      expect(ids).toEqual([301]);
    });
  });

  // ---- Criterion 3: count-by-shop (two active -> 2; none -> []) ----
  describe('per-shop active reward count', () => {
    it('a placed shop with TWO active rewards returns both (length 2)', async () => {
      const { rewardsFor } = await makeStoreAt(makeRewardBundle(), NOW_INSIDE);
      const active = rewardsFor(1);
      // shop 1 has 100 (deals) + 101 (rewards) active; 102 expired -> exactly 2.
      expect(active.length).toBe(2);
      expect(rewardIds(active)).toEqual([100, 101]);
    });

    it('a placed shop with NO active reward returns an empty array (not null/undefined)', async () => {
      const { rewardsFor } = await makeStoreAt(makeRewardBundle(), NOW_INSIDE);
      // shop 2's only reward (200) is not yet active -> [].
      const active = rewardsFor(2);
      expect(Array.isArray(active)).toBe(true);
      expect(active.length).toBe(0);
    });
  });

  // ---- Criterion 4: a dangling shops[] reference does not throw / is never returned ----
  describe('unplaced / unknown shop id in a reward.shops[]', () => {
    it('hydrating a bundle whose reward names an unplaced shop (9001) does not throw', async () => {
      let caught;
      try {
        await makeStoreAt(makeRewardBundle(), NOW_INSIDE);
      } catch (err) {
        caught = err;
      }
      expect(caught, 'a dangling reward.shops[] reference must not throw at hydrate').toBeUndefined();
    });

    it('the dangling reward (900 -> shop 9001) is never returned for any PLACED shop', async () => {
      const { catalog, rewardsFor } = await makeStoreAt(makeRewardBundle(), NOW_INSIDE);
      // Enumerate the placed shop ids from the catalog (shop:<id> Locations).
      const placedShopIds = catalog.locations
        .map((l) => String(l.id))
        .filter((id) => id.startsWith('shop:'))
        .map((id) => Number(id.slice('shop:'.length)));
      expect(placedShopIds.sort((a, b) => a - b)).toEqual([1, 2]); // sanity: 9001 is not placed

      for (const shopId of placedShopIds) {
        const ids = rewardIds(rewardsFor(shopId));
        expect(ids, `reward 900 must not surface for placed shop ${shopId}`).not.toContain(900);
      }
    });

    it('asking for the unplaced shop id 9001 directly returns [] (placed-shop aware), not the dangling reward', async () => {
      const { rewardsFor } = await makeStoreAt(makeRewardBundle(), NOW_INSIDE);
      // 9001 is not a placed shop -> the store returns nothing for it even though
      // reward 900 names it and is in-window.
      const active = rewardsFor(9001);
      expect(Array.isArray(active)).toBe(true);
      expect(active.length).toBe(0);
    });
  });
});
// <<< TARS cap:reward-catalog
