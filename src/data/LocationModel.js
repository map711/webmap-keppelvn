import { DataLoader } from './DataLoader.js';
import { Point } from './MapGeometryModel.js';

/**
 * A single placement of a Location on a floor: the label anchor + angle + the
 * owning unit's level, as a thin record the LocationLayer can draw without
 * re-deriving geometry. One displayNode per owned unit.
 *
 * Shape: `{ id, levelCode, point, rotation, fitScale, location }`.
 */
export class DisplayNode {
  /**
   * @param {Object} data
   */
  constructor(data) {
    this.id = data.id;
    this.levelCode = data.levelCode ?? null;
    this.point = data.point instanceof Point
      ? data.point
      : new Point(data.point?.x ?? data.point?.[0] ?? 0, data.point?.y ?? data.point?.[1] ?? 0);
    /** @type {number} label angle in RADIANS (label_rotation degrees -> radians) */
    this.rotation = data.rotation ?? 0;
    this.fitScale = data.fitScale ?? 1;
    this.unitId = data.unitId ?? null;
    /** @type {string} the label text to draw (tenancy/shop name) */
    this.text = data.text ?? '';
    /** @type {boolean} whether this placement is a labelable tenant-shop unit */
    this.labelable = data.labelable ?? false;
    /** @type {number} owning unit polygon width (world units) for shrink-to-fit */
    this.unitWidth = data.unitWidth ?? 0;
    /** @type {number} owning unit polygon height (world units) for shrink-to-fit */
    this.unitHeight = data.unitHeight ?? 0;
    /** @type {Location|null} back-reference to the owning Location */
    this.location = data.location ?? null;
  }
}

/**
 * Location (placed shop or routable facility) — a searchable/routable entry in
 * the destination CATALOG. Built from the bundle by {@link LocationStore}.
 *
 * Identity is namespaced: `shop:<id>` for a tenancy-placed shop, `unit:<id>`
 * for a routable non-connector facility unit. A shop spanning several units lists
 * every unit in {@link Location#unitIds} and every spanned floor in
 * {@link Location#levelCodes}; a shared (multi-tenant) unit appears on every
 * tenant Location.
 */
export class Location {
  /**
   * @param {Object} data
   */
  constructor(data) {
    this.id = data.id;
    this.title = data.title ?? '';
    this.label = data.label ?? this.title;
    this.kind = data.kind;
    this.search_tokens = Array.isArray(data.search_tokens)
      ? data.search_tokens
      : (data.search_tokens ? [data.search_tokens] : []);
    this.venue = data.venue ?? '';
    this.image_url = data.image_url ?? '';
    this.images = Array.isArray(data.images)
      ? data.images.filter(Boolean)
      : (data.images ? [data.images] : []);
    this.logo = data.logo ?? '';
    this.description = data.description ?? '';
    this.category = data.category ?? null;

    /** @type {Array<number|string>} every unit this Location occupies */
    this.unitIds = Array.isArray(data.unitIds) ? data.unitIds : [];
    /** @type {string[]} every floor code this Location spans */
    this.levelCodes = Array.isArray(data.levelCodes) ? data.levelCodes : [];
    /** @type {DisplayNode[]} one placement per owned unit */
    this.displayNodes = Array.isArray(data.displayNodes) ? data.displayNodes : [];

    // --- Legacy aliases preserved for the renderer/router seam ---
    /** @type {Array} resolved level records or codes */
    this.levels = data.levels || this.levelCodes;
    /** @type {Array} navigation nodes (legacy); destination catalog uses displayNodes */
    this.nodes = data.nodes || [];
  }

  /**
   * Check if location exists on a specific level (by code).
   * @param {string} levelCode
   * @returns {boolean}
   */
  isOnLevel(levelCode) {
    if (this.levelCodes.length) return this.levelCodes.includes(levelCode);
    return this.levels.some((level) =>
      typeof level === 'object' ? level.code === levelCode : level === levelCode
    );
  }

  /**
   * Display nodes placed on a specific level (by code).
   * @param {string} levelCode
   * @returns {DisplayNode[]}
   */
  getNodesOnLevel(levelCode) {
    if (this.displayNodes.length) {
      return this.displayNodes.filter((n) => n.levelCode === levelCode);
    }
    return this.nodes.filter((node) =>
      typeof node === 'object' && node.level?.code === levelCode
    );
  }
}

/**
 * Level (floor) metadata.
 */
export class Level {
  /**
   * @param {Object} data
   */
  constructor(data) {
    this.id = data.id;
    this.code = data.code;
    this.title = data.title ?? data.name ?? data.code;
    this.label = data.label ?? data.name ?? data.code;
    this.position = data.position;
  }
}

/**
 * Navigation graph node (legacy shape; retained for the router seam).
 */
export class Node {
  /**
   * @param {Object} data
   * @param {typeof Point} PointClass
   */
  constructor(data, PointClass = Point) {
    this.id = data.id;
    this.level = data.level;
    this.point = new PointClass(data.x, data.y);
    this.rotation = data.rotation || 0;
    this.location = data.location;
    this.peers = data.peers || [];
  }
}

/**
 * Store that builds the destination CATALOG from the parsed bundle model.
 *
 * The catalog is **placed shops + routable facilities only**:
 *   - one `shop:<id>` Location per DISTINCT `shop_id` referenced by any unit
 *     tenancy (a shop in `shops[]` referenced by no tenancy yields nothing);
 *   - one `unit:<id>` Location per unit whose kind is
 *     `is_routable && !is_connector && !is_tenant` (a routable facility);
 *   - vacant shop-kind units, connectors, and non-routable units yield NOTHING.
 *
 * A multi-unit shop lists every unit/floor it occupies; a multi-tenant unit
 * (>=2 tenancies on one polygon) produces one Location per tenancy, each listing
 * the shared unit, so {@link LocationStore#getLocationsByUnitId} is one-to-many.
 *
 * Public seam preserved from the upstream shell: `locations`/`levels`
 * arrays, `getLocation`/`getLevel`/`getLevelByCode`/`getLocationsOnLevel`.
 */
export class LocationStore {
  #loader;
  #loaded = false;
  #renderScale = 1;

  locations = [];
  levels = [];
  nodes = [];

  locationById = new Map();
  levelById = new Map();
  levelByCode = new Map();
  nodeById = new Map();

  /** @type {Map<number|string, Location[]>} unit id -> Locations owning it */
  locationsByUnitId = new Map();

  /**
   * @param {DataLoader} [loader]
   */
  constructor(loader = new DataLoader()) {
    this.#loader = loader;
  }

  /**
   * Load and build the catalog from a bundle URL (single fetch).
   * @param {string} url
   * @param {Object} [options] - { renderScale }
   */
  async load(url, options = {}) {
    if (this.#loaded) return;
    const raw = await this.#loader.load(url);
    this.hydrate(raw, options);
  }

  /**
   * Build the catalog from an ALREADY-PARSED bundle model (no fetch). The engine
   * fetches the self-contained bundle once via BundleLoader and threads the
   * parsed/indexed model in here.
   * @param {Object} bundle - a BundleModel (or bundle-shaped object), or a
   *   legacy `{locations, levels, nodes}` payload.
   * @param {Object} [options] - { renderScale }
   */
  hydrate(bundle, options = {}) {
    if (this.#loaded) return;

    this.#renderScale = options.renderScale || 1;

    if (this.#isBundle(bundle)) {
      this.#buildFromBundle(bundle);
    } else {
      const normalized = this.#normalizeLegacyPayload(bundle);
      if (!normalized) {
        throw new Error('LocationStore: Unrecognized location data format');
      }
      this.#buildFromLegacy(normalized, options);
    }

    this.#indexEntities();
    this.#loaded = true;
  }

  /**
   * A bundle model carries `units`, `shops`, and `kinds` arrays; the legacy
   * payload carries `locations`/`nodes`. This disambiguates the two without
   * coupling to the concrete BundleModel class.
   * @param {any} bundle
   * @returns {boolean}
   */
  #isBundle(bundle) {
    return !!bundle
      && typeof bundle === 'object'
      && Array.isArray(bundle.units)
      && Array.isArray(bundle.shops)
      && Array.isArray(bundle.kinds);
  }

  // ---- Catalog build from the bundle -------------------------------------

  #buildFromBundle(model) {
    const kindsBySlug = model.kindsBySlug ?? this.#indexBy(model.kinds, 'slug');
    const shopsById = model.shopsById ?? this.#indexBy(model.shops, 'id');
    const categoriesById = model.categoriesById ?? this.#indexBy(model.categories, 'id');
    const levelsById = model.levelsById ?? this.#indexBy(model.levels, 'id');

    const venue = model.mall?.name ?? '';

    // Levels mirrored from the bundle so the renderer/level-selector seam works.
    this.levels = (model.levels || []).map((lvl) => new Level(lvl));

    const levelCodeFor = (levelId) => {
      const lvl = levelsById.get?.(levelId) ?? levelsById[levelId];
      return lvl ? lvl.code : null;
    };

    // --- Group tenanted units per shop_id (one Location per distinct shop) ---
    // For each shop_id, collect the units that reference it (a shop may span
    // several units); preserve unit order so displayNodes are stable.
    /** @type {Map<number|string, Array>} shop_id -> units occupied by that shop */
    const unitsByShopId = new Map();

    for (const unit of model.units || []) {
      if (!unit) continue;
      for (const tenancy of unit.tenancies || []) {
        if (tenancy == null || tenancy.shop_id == null) continue;
        const sid = tenancy.shop_id;
        let group = unitsByShopId.get(sid);
        if (!group) {
          group = [];
          unitsByShopId.set(sid, group);
        }
        group.push(unit);
      }
    }

    const locations = [];

    const kindFor = (slug) => kindsBySlug.get?.(slug) ?? kindsBySlug[slug] ?? null;

    // --- Placed-shop Locations (shop:<id>) ---
    for (const [shopId, units] of unitsByShopId) {
      const shop = shopsById.get?.(shopId) ?? shopsById[shopId] ?? null;
      const location = this.#makeShopLocation(shopId, shop, units, {
        categoriesById,
        levelCodeFor,
        kindFor,
        venue
      });
      locations.push(location);
    }

    // --- Facility Locations (unit:<id>): routable, non-connector, non-tenant ---
    for (const unit of model.units || []) {
      if (!unit) continue;
      const kind = kindsBySlug.get?.(unit.kind) ?? kindsBySlug[unit.kind] ?? null;
      if (!this.#isFacilityKind(kind)) continue;
      const location = this.#makeFacilityLocation(unit, kind, { levelCodeFor, venue });
      locations.push(location);
    }

    this.locations = locations;
    this.#buildUnitIndex();
  }

  /**
   * A facility unit becomes a `unit:<id>` Location when its kind is routable,
   * not a connector (escalator/elevator/stairs), and not a tenant (shop) kind.
   * @param {Object|null} kind
   * @returns {boolean}
   */
  #isFacilityKind(kind) {
    return !!kind && kind.is_routable === true && !kind.is_connector && !kind.is_tenant;
  }

  /**
   * @param {number|string} shopId
   * @param {Object|null} shop - the shop record (may be null if absent)
   * @param {Array} units - units this shop occupies
   * @param {Object} ctx
   * @returns {Location}
   */
  #makeShopLocation(shopId, shop, units, ctx) {
    const name = shop?.name ?? '';
    const category = shop ? this.#categoryName(shop.category, ctx.categoriesById) : '';

    const unitIds = [];
    const levelCodes = [];
    const displayNodes = [];

    for (const unit of units) {
      const levelCode = ctx.levelCodeFor(unit.level_id);
      if (!unitIds.includes(unit.id)) unitIds.push(unit.id);
      if (levelCode && !levelCodes.includes(levelCode)) levelCodes.push(levelCode);
      // Labelable iff this is a tenant-kind unit carrying >=1 tenancy. The shop
      // Location is built FROM a tenancy, so the tenancy count is already >0; we
      // still re-check kind.is_tenant so a tenancy on a non-tenant-kind unit
      // (mis-authored data) does not emit a floating shop label.
      const kind = ctx.kindFor ? ctx.kindFor(unit.kind) : null;
      const labelable = !!kind && kind.is_tenant === true
        && Array.isArray(unit.tenancies) && unit.tenancies.length > 0;
      displayNodes.push(this.#makeDisplayNode(unit, levelCode, {
        text: name,
        labelable
      }));
    }

    const searchTokens = this.#buildSearchTokens([
      name,
      shop?.unit_number,
      category
    ]);

    const location = new Location({
      id: `shop:${shopId}`,
      kind: 'shop',
      title: name,
      label: name,
      venue: ctx.venue,
      logo: shop?.logo ?? '',
      description: shop?.description ?? '',
      image_url: shop?.logo ?? '',
      category: shop?.category ?? null,
      search_tokens: searchTokens,
      unitIds,
      levelCodes,
      displayNodes
    });
    for (const node of displayNodes) node.location = location;
    return location;
  }

  /**
   * @param {Object} unit
   * @param {Object} kind
   * @param {Object} ctx
   * @returns {Location}
   */
  #makeFacilityLocation(unit, kind, ctx) {
    const levelCode = ctx.levelCodeFor(unit.level_id);
    const title = unit.name || kind.label || kind.slug || '';
    const displayNodes = [this.#makeDisplayNode(unit, levelCode)];

    const searchTokens = this.#buildSearchTokens([
      title,
      kind.label,
      kind.slug
    ]);

    const location = new Location({
      id: `unit:${unit.id}`,
      kind: unit.kind,
      title,
      label: title,
      venue: ctx.venue,
      search_tokens: searchTokens,
      unitIds: [unit.id],
      levelCodes: levelCode ? [levelCode] : [],
      displayNodes
    });
    for (const node of displayNodes) node.location = location;
    return location;
  }

  /**
   * Build a DisplayNode from a unit's pre-resolved label anchor/angle/level.
   *
   * The anchor is the unit's `label_point` verbatim (× renderScale; no
   * polylabel/OBB recompute) and the angle is `label_rotation` converted
   * degrees → radians. The owning unit's polygon extents are captured so the
   * label layer can shrink-to-fit without re-deriving geometry.
   *
   * @param {Object} unit
   * @param {string|null} levelCode
   * @param {Object} [opts] - { text, labelable }
   * @returns {DisplayNode}
   */
  #makeDisplayNode(unit, levelCode, opts = {}) {
    const lp = unit.label_point ?? unit.display_point ?? [0, 0];
    const x = (Array.isArray(lp) ? lp[0] : lp?.x ?? 0) * this.#renderScale;
    const y = (Array.isArray(lp) ? lp[1] : lp?.y ?? 0) * this.#renderScale;
    const degrees = unit.label_rotation ?? 0;
    const { width, height } = this.#unitExtents(unit);
    return new DisplayNode({
      id: `${unit.id}`,
      unitId: unit.id,
      levelCode,
      point: new Point(x, y),
      rotation: (degrees * Math.PI) / 180,
      fitScale: 1,
      text: opts.text ?? '',
      labelable: opts.labelable ?? false,
      unitWidth: width,
      unitHeight: height
    });
  }

  /**
   * The world-space bounding-box extents of a unit's polygon (× renderScale),
   * used as the available box for label shrink-to-fit. Falls back to `0` when
   * the unit carries no usable geometry.
   * @param {Object} unit
   * @returns {{width:number,height:number}}
   */
  #unitExtents(unit) {
    const ring = this.#outerRing(unit.geometry);
    if (!ring || ring.length === 0) return { width: 0, height: 0 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const pair of ring) {
      if (!Array.isArray(pair) || pair.length < 2) continue;
      const px = pair[0];
      const py = pair[1];
      if (px < minX) minX = px;
      if (py < minY) minY = py;
      if (px > maxX) maxX = px;
      if (py > maxY) maxY = py;
    }
    if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return { width: 0, height: 0 };
    return {
      width: Math.max(0, (maxX - minX) * this.#renderScale),
      height: Math.max(0, (maxY - minY) * this.#renderScale)
    };
  }

  /**
   * Pull the outer ring of `[x,y]` pairs out of a GeoJSON Polygon/MultiPolygon
   * or a bare ring; mirrors the geometry-model extractor without re-importing it.
   * @param {Object|Array} geometry
   * @returns {Array|null}
   */
  #outerRing(geometry) {
    if (!geometry) return null;
    if (Array.isArray(geometry)) {
      if (geometry.length && Array.isArray(geometry[0]) && typeof geometry[0][0] === 'number') {
        return geometry;
      }
      if (geometry.length && Array.isArray(geometry[0]) && Array.isArray(geometry[0][0])) {
        return geometry[0];
      }
      return null;
    }
    const coords = geometry.coordinates;
    if (!Array.isArray(coords)) return null;
    if (geometry.type === 'MultiPolygon') {
      return Array.isArray(coords[0]) ? coords[0][0] : null;
    }
    return coords[0];
  }

  /**
   * Resolve a category id to its display name.
   * @param {number|string} categoryId
   * @param {Map|Object} categoriesById
   * @returns {string}
   */
  #categoryName(categoryId, categoriesById) {
    if (categoryId == null) return '';
    const cat = categoriesById.get?.(categoryId) ?? categoriesById[categoryId];
    return cat?.name ?? '';
  }

  /**
   * Build a de-duplicated, non-empty token list for search.
   * @param {Array<string|undefined|null>} parts
   * @returns {string[]}
   */
  #buildSearchTokens(parts) {
    const out = [];
    const seen = new Set();
    for (const part of parts) {
      if (part == null) continue;
      const token = String(part).trim();
      if (!token) continue;
      const key = token.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(token);
    }
    return out;
  }

  /** Build the unit-id -> Locations[] one-to-many index. */
  #buildUnitIndex() {
    const index = new Map();
    for (const loc of this.locations) {
      for (const unitId of loc.unitIds) {
        let list = index.get(unitId);
        if (!list) {
          list = [];
          index.set(unitId, list);
        }
        list.push(loc);
      }
    }
    this.locationsByUnitId = index;
  }

  // ---- Legacy `{locations, levels, nodes}` payload (upstream shape) ----

  #normalizeLegacyPayload(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (raw.locations || raw.levels || raw.nodes) return raw;
    const candidates = [raw.data, raw.payload, raw.result, raw.body];
    for (const candidate of candidates) {
      if (candidate && (candidate.locations || candidate.levels || candidate.nodes)) {
        return candidate;
      }
    }
    return null;
  }

  #buildFromLegacy(raw, options) {
    const allowedKinds = options.locationKinds || ['SHOP', 'FACILITY'];

    this.locations = (raw.locations || [])
      .filter((loc) => allowedKinds.includes(loc.kind))
      .map((loc) => new Location(loc));

    this.levels = (raw.levels || []).map((lvl) => new Level(lvl));
    this.nodes = (raw.nodes || []).map((nd) => new Node(nd, Point));

    if (this.#renderScale !== 1) {
      const scale = this.#renderScale;
      for (const node of this.nodes) {
        node.point.x *= scale;
        node.point.y *= scale;
      }
    }

    this.#resolveLegacyReferences();
    this.#buildUnitIndex();
  }

  #resolveLegacyReferences() {
    const levelById = new Map(this.levels.map((o) => [o.id, o]));
    const nodeById = new Map(this.nodes.map((o) => [o.id, o]));
    const locationById = new Map(this.locations.map((o) => [o.id, o]));
    const resolveIds = (ids, lookup) => ids.map((id) => lookup.get(id)).filter(Boolean);

    for (const loc of this.locations) {
      if (loc.levels.length && typeof loc.levels[0] !== 'object') {
        loc.levels = resolveIds(loc.levels, levelById);
      }
      if (loc.nodes.length && typeof loc.nodes[0] !== 'object') {
        loc.nodes = resolveIds(loc.nodes, nodeById);
      }
    }

    for (const node of this.nodes) {
      if (node.level && typeof node.level !== 'object') {
        const level = levelById.get(node.level);
        if (level) node.level = level;
      }
      if (node.location && typeof node.location !== 'object') {
        const location = locationById.get(node.location);
        if (location) node.location = location;
      }
      if (node.peers.length && typeof node.peers[0] !== 'object') {
        node.peers = resolveIds(node.peers, nodeById);
      }
    }
  }

  // ---- Indexing -----------------------------------------------------------

  #indexEntities() {
    this.locationById = new Map(this.locations.map((o) => [o.id, o]));
    this.levelById = new Map(this.levels.map((o) => [o.id, o]));
    this.levelByCode = new Map(this.levels.map((o) => [o.code, o]));
    this.nodeById = new Map(this.nodes.map((o) => [o.id, o]));
  }

  #indexBy(arr, key) {
    const map = new Map();
    for (const item of arr || []) {
      if (item && item[key] != null) map.set(item[key], item);
    }
    return map;
  }

  // ---- Public lookups -----------------------------------------------------

  /**
   * Lookup a Location by its namespaced id (`shop:<id>` or `unit:<id>`).
   * @param {string|number} id
   * @returns {Location|undefined}
   */
  getLocation(id) {
    return this.locationById.get(id);
  }

  /**
   * The list of Locations owning a unit: empty for a connector or vacant unit,
   * one for a single-tenant unit, >=2 for a multi-tenant unit.
   * @param {number|string} unitId
   * @returns {Location[]}
   */
  getLocationsByUnitId(unitId) {
    return this.locationsByUnitId.get(unitId) ?? [];
  }

  /**
   * Lookup level by id.
   * @param {string|number} id
   * @returns {Level|undefined}
   */
  getLevel(id) {
    return this.levelById.get(id);
  }

  /**
   * Lookup level by code.
   * @param {string} code
   * @returns {Level|undefined}
   */
  getLevelByCode(code) {
    return this.levelByCode.get(code);
  }

  /**
   * Lookup node by id (legacy router seam).
   * @param {string|number} id
   * @returns {Node|undefined}
   */
  getNode(id) {
    return this.nodeById.get(id);
  }

  /**
   * Locations placed on a specific level (by code).
   * @param {string} levelCode
   * @returns {Location[]}
   */
  getLocationsOnLevel(levelCode) {
    return this.locations.filter((loc) => loc.isOnLevel(levelCode));
  }

  /**
   * Nodes placed on a specific level (legacy router seam).
   * @param {string} levelCode
   * @returns {Node[]}
   */
  getNodesOnLevel(levelCode) {
    return this.nodes.filter((node) => node.level?.code === levelCode);
  }
}
