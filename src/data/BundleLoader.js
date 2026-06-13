import { DataLoader, DataLoadError } from './DataLoader.js';

/**
 * The required top-level keys of a webmap consumer bundle. A bundle missing any
 * of these is structurally invalid and yields a {@link BundleLoadError}.
 *
 * @see datas/SGC_v001.json — the authoritative example of the produced shape.
 */
const REQUIRED_KEYS = Object.freeze([
  'levels',
  'layers',
  'kinds',
  'units',
  'shops',
  'categories',
  'navmesh_by_level',
  'transitions'
]);

/**
 * The keys the CMS publishes in the `maps_…` (geometry) half: floor/layer
 * geometry, the navmesh, connector transitions, and the singular `mall` identity.
 */
const MAPS_KEYS = Object.freeze([
  'levels',
  'layers',
  'kinds',
  'units',
  'navmesh_by_level',
  'transitions'
]);

/**
 * The keys the CMS publishes in the `datas_…` (directory) half: the shop
 * directory and its categories. Extra `datas_` keys the webmap doesn't consume
 * (e.g. `banners`, `events`, `malls`) are ignored — not validated, not merged.
 */
const DATAS_KEYS = Object.freeze(['shops', 'categories']);

/**
 * Error raised when a fetched bundle is missing a required top-level key or is
 * otherwise structurally invalid. Subclasses {@link Error} so callers can use
 * `instanceof Error` while still discriminating on `name`.
 */
export class BundleLoadError extends Error {
  /**
   * @param {string} message
   * @param {string} [url]
   */
  constructor(message, url) {
    super(message);
    this.name = 'BundleLoadError';
    this.url = url;
  }
}

/**
 * The indexed model returned by {@link BundleLoader#load}: the parsed source
 * arrays of the bundle plus prebuilt lookups for the joins the renderer/router
 * need (`kind` slug → kind, layer/level id → record, units grouped by level).
 *
 * The raw arrays are exposed unchanged (`levels`, `kinds`, `units`, …) so the
 * counts a consumer asserts are an honest function of the served data; the
 * indexes are derived, never authoritative.
 */
export class BundleModel {
  /**
   * @param {Object} bundle - the parsed bundle object
   */
  constructor(bundle) {
    /** @type {Object} mall identity `{id, name, code}` */
    this.mall = bundle.mall ?? null;

    // --- Source arrays (verbatim, so counts mirror the served bundle) ---
    /** @type {Array} */ this.levels = bundle.levels;
    /** @type {Array} */ this.layers = bundle.layers;
    /** @type {Array} */ this.kinds = bundle.kinds;
    /** @type {Array} */ this.units = bundle.units;
    /** @type {Array} */ this.shops = bundle.shops;
    /** @type {Array} */ this.categories = bundle.categories;
    /** @type {Array} */ this.transitions = bundle.transitions;

    /**
     * Loyalty rewards (OPTIONAL): the `datas_…` half MAY carry a
     * `rewards: [{id, shops:[...], ...}]` list. Absent -> an empty array, so
     * downstream consumers always read an array. Verbatim otherwise.
     * @type {Array}
     */
    this.rewards = Array.isArray(bundle.rewards) ? bundle.rewards : [];

    /**
     * Object keyed by stringified level id; a level with no buildable mesh is
     * ABSENT (not present-with-empty). Preserved verbatim.
     * @type {Object<string, Object>}
     */
    this.navmesh_by_level = bundle.navmesh_by_level;

    // --- Derived indexes ---
    /** @type {Map<string, Object>} kind slug -> kind record */
    this.kindsBySlug = new Map();
    for (const kind of this.kinds) {
      if (kind && kind.slug != null) this.kindsBySlug.set(kind.slug, kind);
    }

    /** @type {Map<number, Object>} layer id -> layer record */
    this.layersById = new Map();
    for (const layer of this.layers) {
      if (layer && layer.id != null) this.layersById.set(layer.id, layer);
    }

    /** @type {Map<number, Object>} level id -> level record */
    this.levelsById = new Map();
    for (const level of this.levels) {
      if (level && level.id != null) this.levelsById.set(level.id, level);
    }

    /** @type {Map<number, Object>} shop id -> shop record */
    this.shopsById = new Map();
    for (const shop of this.shops) {
      if (shop && shop.id != null) this.shopsById.set(shop.id, shop);
    }

    /** @type {Map<number, Object>} category id -> category record */
    this.categoriesById = new Map();
    for (const category of this.categories) {
      if (category && category.id != null) this.categoriesById.set(category.id, category);
    }

    /**
     * Rewards indexed by shop id. A reward listing N shops is indexed under
     * EVERY one of its `shops[]`, mirroring `shopsById`: `.get(shopId)` returns
     * the rewards that touch that shop. A shop with no reward is absent (so
     * `.get` yields `undefined`).
     * @type {Map<number, Array>}
     */
    this.rewardsByShopId = new Map();
    for (const reward of this.rewards) {
      if (!reward || !Array.isArray(reward.shops)) continue;
      for (const shopId of reward.shops) {
        let group = this.rewardsByShopId.get(shopId);
        if (!group) {
          group = [];
          this.rewardsByShopId.set(shopId, group);
        }
        group.push(reward);
      }
    }

    /**
     * Units grouped by their owning `level_id`. Every level present in the
     * bundle is seeded with an empty array first, so a geometry-bearing but
     * unit-less level (e.g. SGC L1 / id 3) still resolves a non-null (empty)
     * group rather than `undefined`.
     * @type {Map<number, Array>}
     */
    this.unitsByLevelId = new Map();
    for (const level of this.levels) {
      if (level && level.id != null) this.unitsByLevelId.set(level.id, []);
    }
    for (const unit of this.units) {
      if (!unit) continue;
      const levelId = unit.level_id;
      let group = this.unitsByLevelId.get(levelId);
      if (!group) {
        group = [];
        this.unitsByLevelId.set(levelId, group);
      }
      group.push(unit);
    }
  }

  /**
   * Retrieve the units on a given level, grouped by `level_id`.
   * Returns an empty array for a known level with no units; `null` only for an
   * id that is not a level in this bundle.
   * @param {number} levelId
   * @returns {Array|null}
   */
  getUnitsByLevelId(levelId) {
    const group = this.unitsByLevelId.get(levelId);
    return group ?? null;
  }

  /**
   * Resolve the kind record for a unit's `kind` slug.
   * @param {string} slug
   * @returns {Object|undefined}
   */
  getKind(slug) {
    return this.kindsBySlug.get(slug);
  }
}

/**
 * The loader for the webmap consumer bundle. Two call shapes:
 *
 *   - `load(url)` — ONE fetch of a SELF-CONTAINED bundle (legacy/test path):
 *     validates ALL required top-level keys and returns an indexed model.
 *   - `load({mapsUrl, datasUrl})` — the CMS now publishes the bundle SPLIT into
 *     a `maps_…` (geometry + `mall`) half and a `datas_…` (shop directory) half.
 *     Both are fetched IN PARALLEL (via the cached/gzip-aware {@link DataLoader}),
 *     each half is validated against the keys THAT half carries (a missing key
 *     names the offending half's URL), and the two are MERGED into a single
 *     bundle object before being indexed by the unchanged {@link BundleModel}.
 *
 * The merged object is byte-shape-identical to today's single bundle, so nothing
 * downstream of {@link BundleModel} observes the split.
 */
export class BundleLoader {
  #dataLoader;

  /**
   * @param {DataLoader} [dataLoader] - injectable loader (gzip/cache aware)
   */
  constructor(dataLoader = new DataLoader()) {
    this.#dataLoader = dataLoader;
  }

  /**
   * Fetch, validate, and index the bundle.
   * @param {string|{mapsUrl: string, datasUrl: string}} source - a single
   *   self-contained bundle URL, or the split `{mapsUrl, datasUrl}` pair.
   * @returns {Promise<BundleModel>}
   * @throws {BundleLoadError} when a fetched half is missing a required key
   */
  async load(source) {
    if (source && typeof source === 'object') {
      return this.#loadSplit(source.mapsUrl, source.datasUrl);
    }
    const url = source;
    const bundle = await this.#dataLoader.load(url);
    this.#validate(bundle, url, REQUIRED_KEYS);
    return new BundleModel(bundle);
  }

  /**
   * Fetch the two remote halves in parallel, validate each against the keys it
   * is supposed to carry, and merge them into one indexed model.
   * @param {string} mapsUrl - the `maps_…` (geometry + `mall`) half
   * @param {string} datasUrl - the `datas_…` (shop directory) half
   * @returns {Promise<BundleModel>}
   * @throws {BundleLoadError} naming the URL of the offending half
   */
  async #loadSplit(mapsUrl, datasUrl) {
    const [maps, datas] = await Promise.all([
      this.#dataLoader.load(mapsUrl),
      this.#dataLoader.load(datasUrl)
    ]);

    // Validate each half against the keys IT carries, so a missing key names the
    // offending half's URL (the maps half owns geometry + mall; the datas half
    // owns the shop directory).
    this.#validate(maps, mapsUrl, MAPS_KEYS);
    this.#validate(datas, datasUrl, DATAS_KEYS);

    // Merge: geometry + `mall` from the maps half, shops + categories from the
    // datas half. Only the consumed keys cross over — extra `datas_` keys
    // (banners/events/malls) are ignored, never becoming model fields.
    // `rewards` is an OPTIONAL datas-half key carried through verbatim when
    // present; BundleModel defaults a missing `rewards` to an empty array.
    const merged = {
      mall: maps.mall ?? null,
      levels: maps.levels,
      layers: maps.layers,
      kinds: maps.kinds,
      units: maps.units,
      navmesh_by_level: maps.navmesh_by_level,
      transitions: maps.transitions,
      shops: datas.shops,
      categories: datas.categories,
      rewards: datas.rewards
    };
    return new BundleModel(merged);
  }

  /**
   * @param {any} bundle
   * @param {string} url
   * @param {readonly string[]} requiredKeys - the keys this source must carry
   * @throws {BundleLoadError}
   */
  #validate(bundle, url, requiredKeys) {
    if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
      throw new BundleLoadError(`Bundle at ${url} is not a JSON object`, url);
    }

    const missing = [];
    for (const key of requiredKeys) {
      if (!Object.prototype.hasOwnProperty.call(bundle, key) || bundle[key] == null) {
        missing.push(key);
      }
    }
    if (missing.length > 0) {
      throw new BundleLoadError(
        `Bundle at ${url} is missing required key(s): ${missing.join(', ')}`,
        url
      );
    }

    // `navmesh_by_level` is an object keyed by stringified level id; the rest
    // are arrays. A wrong container shape is as broken as an absent key.
    for (const key of requiredKeys) {
      if (key === 'navmesh_by_level') {
        if (typeof bundle[key] !== 'object' || Array.isArray(bundle[key])) {
          throw new BundleLoadError(`Bundle "${key}" at ${url} must be an object`, url);
        }
        continue;
      }
      if (!Array.isArray(bundle[key])) {
        throw new BundleLoadError(`Bundle "${key}" at ${url} must be an array`, url);
      }
    }
  }
}

export { DataLoadError };
