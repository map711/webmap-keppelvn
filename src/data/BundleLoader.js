import { DataLoader, DataLoadError } from './DataLoader.js';

/**
 * The required top-level keys of a webmap consumer bundle. A bundle missing any
 * of these is structurally invalid and yields a {@link BundleLoadError}.
 *
 * @see datas/webmap-data.md "Top-level shape"
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
 * The single-URL loader for the webmap consumer bundle. `load(url)` issues ONE
 * fetch (via the cached/gzip-aware {@link DataLoader}), validates the bundle's
 * required top-level keys, and returns an indexed {@link BundleModel}.
 *
 * This replaces the legacy two-URL split (separate `data-url` catalog +
 * `map-url` geometry): the published bundle is self-contained.
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
   * Fetch, validate, and index the bundle at `url`.
   * @param {string} url
   * @returns {Promise<BundleModel>}
   * @throws {BundleLoadError} when the bundle is missing a required top-level key
   */
  async load(url) {
    const bundle = await this.#dataLoader.load(url);
    this.#validate(bundle, url);
    return new BundleModel(bundle);
  }

  /**
   * @param {any} bundle
   * @param {string} url
   * @throws {BundleLoadError}
   */
  #validate(bundle, url) {
    if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
      throw new BundleLoadError(`Bundle at ${url} is not a JSON object`, url);
    }

    const missing = [];
    for (const key of REQUIRED_KEYS) {
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
    for (const key of REQUIRED_KEYS) {
      if (key === 'navmesh_by_level') {
        if (typeof bundle[key] !== 'object' || Array.isArray(bundle[key])) {
          throw new BundleLoadError(`Bundle "${key}" must be an object`, url);
        }
        continue;
      }
      if (!Array.isArray(bundle[key])) {
        throw new BundleLoadError(`Bundle "${key}" must be an array`, url);
      }
    }
  }
}

export { DataLoadError };
