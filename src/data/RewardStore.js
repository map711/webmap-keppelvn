/**
 * RewardStore — the active-window reward catalog.
 *
 * Mirrors {@link LocationStore}: the engine fetches/parses the bundle ONCE via
 * {@link BundleLoader} and threads the parsed/indexed {@link BundleModel} in here
 * via {@link RewardStore#hydrate}. The store NEVER fetches — it hydrates from the
 * already-parsed model (its `rewards` + `rewardsByShopId`) and the placed-shop
 * catalog (the hydrated `LocationStore`).
 *
 * For a PLACED shop, {@link RewardStore#getRewardsByShopId} returns only the
 * rewards that are CURRENTLY ACTIVE:
 *
 *   active  <=>  start_date <= now <= end_date   (inclusive window)
 *
 * `now` is INJECTABLE (constructor option, hydrate option, `setNow`, or a
 * per-call argument) so the active-window is deterministic in tests. The filter
 * is TYPE-INCLUSIVE: both `type:"deals"` and `type:"rewards"` qualify — type is
 * never used to drop a reward.
 *
 * The store is PLACED-SHOP aware: a reward whose `shops[]` names an unplaced or
 * unknown shop id does NOT throw at hydrate and is simply never returned for any
 * placed shop (asking for the unplaced id directly yields `[]`).
 */
export class RewardStore {
  /** @type {Date|null} injected reference instant for the active-window */
  #now = null;
  /** @type {Map<number, Array>} placed shop id -> rewards touching that shop */
  #rewardsByShopId = new Map();
  /** @type {Set<number|string>} the placed shop ids (from the catalog) */
  #placedShopIds = new Set();
  /** @type {boolean} */
  #loaded = false;

  /**
   * @param {Object} [options] - { now } an injectable reference instant.
   */
  constructor(options = {}) {
    if (options && options.now != null) this.#now = this.#coerceDate(options.now);
  }

  /**
   * The injected reference instant used for the active-window comparison.
   * @returns {Date|null}
   */
  get now() {
    return this.#now;
  }

  set now(value) {
    this.#now = value == null ? null : this.#coerceDate(value);
  }

  /**
   * Inject/replace the reference instant for the active-window comparison.
   * @param {Date|string|number} value
   */
  setNow(value) {
    this.#now = value == null ? null : this.#coerceDate(value);
  }

  /**
   * Build the catalog from an ALREADY-PARSED bundle model + the placed-shop
   * catalog (a hydrated {@link LocationStore}). No fetch.
   *
   * Tolerant call shapes (so the injection seam is not pinned to one signature):
   *   - `hydrate(model, { catalog, locationStore, now })`
   *   - `hydrate(model, catalog, { now })`
   *   - `hydrate(model, { now })`
   *
   * @param {Object} model - a {@link BundleModel} (or bundle-shaped object) that
   *   carries `rewards` and (optionally) the derived `rewardsByShopId`.
   * @param {Object} [arg2] - either an options bag or the catalog.
   * @param {Object} [arg3] - the options bag when `arg2` is the catalog.
   */
  hydrate(model, arg2, arg3) {
    if (this.#loaded) return;
    if (!model || typeof model !== 'object') {
      throw new Error('RewardStore.hydrate: a parsed bundle model is required');
    }

    // Disambiguate the two trailing-arg shapes: a LocationStore-like catalog has
    // a `locations` array / `getLocation`; an options bag does not.
    let catalog = null;
    let options = {};
    if (this.#isCatalog(arg2)) {
      catalog = arg2;
      options = arg3 && typeof arg3 === 'object' ? arg3 : {};
    } else {
      options = arg2 && typeof arg2 === 'object' ? arg2 : {};
      catalog = this.#isCatalog(options.catalog)
        ? options.catalog
        : (this.#isCatalog(options.locationStore) ? options.locationStore : null);
    }

    if (options.now != null) this.#now = this.#coerceDate(options.now);

    this.#placedShopIds = this.#derivePlacedShopIds(catalog);
    this.#rewardsByShopId = this.#deriveRewardsByShopId(model);
    this.#loaded = true;
  }

  /**
   * The CURRENTLY-ACTIVE rewards for a PLACED shop, type-inclusive.
   *
   * Returns `[]` (never null/undefined) for: an unplaced/unknown shop id, a
   * placed shop with no rewards, or a placed shop whose rewards are all outside
   * the active window. A dangling reward.shops[] reference (an unplaced shop id)
   * is never surfaced for any placed shop.
   *
   * @param {number|string} shopId
   * @param {Date|string|number} [now] - per-call reference instant override.
   * @returns {Array}
   */
  getRewardsByShopId(shopId, now) {
    // Placed-shop aware: an unplaced/unknown shop id yields nothing, even if a
    // dangling reward names it.
    if (!this.#isPlaced(shopId)) return [];

    const group = this.#rewardsByShopId.get(this.#normalizeShopId(shopId));
    if (!group || group.length === 0) return [];

    const at = now != null ? this.#coerceDate(now) : this.#now;
    return group.filter((reward) => this.#isActive(reward, at));
  }

  // ---- Internals ----------------------------------------------------------

  /**
   * A reward is active when `start_date <= now <= end_date` (inclusive). With no
   * injected `now` the window cannot be evaluated, so nothing is active. Missing
   * bounds are treated as open on that side (so a reward with only a start_date
   * is active from that instant onward). The filter is TYPE-INCLUSIVE — `type`
   * is never consulted here.
   * @param {Object} reward
   * @param {Date|null} now
   * @returns {boolean}
   */
  #isActive(reward, now) {
    if (!reward) return false;
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) return false;
    const t = now.getTime();

    const start = this.#parseInstant(reward.start_date);
    const end = this.#parseInstant(reward.end_date);
    if (start != null && t < start) return false;
    if (end != null && t > end) return false;
    return true;
  }

  /**
   * Parse a date-ish value to epoch ms, or `null` when absent/unparseable (an
   * unparseable bound is treated as open, never as a thrown error).
   * @param {string|number|Date|null|undefined} value
   * @returns {number|null}
   */
  #parseInstant(value) {
    if (value == null) return null;
    if (value instanceof Date) {
      const t = value.getTime();
      return Number.isNaN(t) ? null : t;
    }
    const t = new Date(value).getTime();
    return Number.isNaN(t) ? null : t;
  }

  /**
   * Coerce an injected `now` to a Date without throwing on a bad value.
   * @param {Date|string|number} value
   * @returns {Date}
   */
  #coerceDate(value) {
    return value instanceof Date ? value : new Date(value);
  }

  /**
   * The set of placed shop ids derived from the catalog's `shop:<id>` Locations.
   * Absent a catalog, the set is empty (so nothing is placed and every lookup is
   * `[]`) — placed-shop awareness is the catalog's job.
   * @param {Object|null} catalog
   * @returns {Set<number|string>}
   */
  #derivePlacedShopIds(catalog) {
    const ids = new Set();
    if (!catalog || !Array.isArray(catalog.locations)) return ids;
    for (const loc of catalog.locations) {
      if (!loc || loc.id == null) continue;
      const id = String(loc.id);
      if (!id.startsWith('shop:')) continue;
      const raw = id.slice('shop:'.length);
      const num = Number(raw);
      ids.add(Number.isNaN(num) ? raw : num);
    }
    return ids;
  }

  /**
   * Rewards indexed by shop id, restricted to PLACED shops, sourced from the
   * model's prebuilt `rewardsByShopId` (a `BundleModel` always exposes it as a
   * Map — `BundleLoader` builds it unconditionally; an absent `rewards` key
   * yields an empty Map). A reward touching an unplaced shop is simply not
   * indexed under that id (it can still be indexed under another, placed shop
   * it also names).
   * @param {Object} model
   * @returns {Map<number|string, Array>}
   */
  #deriveRewardsByShopId(model) {
    const index = new Map();
    const fromModel = model.rewardsByShopId;
    if (!(fromModel instanceof Map)) return index;
    for (const [shopId, group] of fromModel) {
      if (!this.#isPlaced(shopId)) continue;
      index.set(this.#normalizeShopId(shopId), Array.isArray(group) ? group.slice() : []);
    }
    return index;
  }

  /**
   * Whether a shop id is one of the placed shops (catalog-known).
   * @param {number|string} shopId
   * @returns {boolean}
   */
  #isPlaced(shopId) {
    return this.#placedShopIds.has(this.#normalizeShopId(shopId));
  }

  /**
   * Normalize a shop id to its numeric form when it is a numeric string, so a
   * `shop:1` catalog id (-> 1) and a numeric `reward.shops[0]` (1) collate.
   * @param {number|string} shopId
   * @returns {number|string}
   */
  #normalizeShopId(shopId) {
    if (typeof shopId === 'number') return shopId;
    const num = Number(shopId);
    return Number.isNaN(num) ? shopId : num;
  }

  /**
   * A catalog-shaped object exposes a `locations` array (and usually
   * `getLocation`). Distinguishes the trailing catalog arg from an options bag.
   * @param {any} value
   * @returns {boolean}
   */
  #isCatalog(value) {
    return !!value
      && typeof value === 'object'
      && Array.isArray(value.locations)
      && typeof value.getLocation === 'function';
  }
}
