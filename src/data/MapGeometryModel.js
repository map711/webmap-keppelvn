import { DataLoader } from './DataLoader.js';
import { BundleLoader } from './BundleLoader.js';
import { resolveStyle } from './StyleResolver.js';
import { buildNavGraph } from '../navigation/NavGraph.js';

/**
 * The neutral default world extent used to frame a meshless, unit-less level
 * (e.g. SGC L1) so fit-to-view always has a finite, non-degenerate box to work
 * with rather than an empty/NaN one.
 */
const DEFAULT_EXTENT = Object.freeze({ width: 1000, height: 1000 });

/**
 * 2D point in world coordinate space.
 */
export class Point {
  /**
   * @param {number} x
   * @param {number} y
   */
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }

  /**
   * Distance to another point.
   * @param {Point} other
   * @returns {number}
   */
  distanceTo(other) {
    const dx = this.x - other.x;
    const dy = this.y - other.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Create a copy.
   * @returns {Point}
   */
  clone() {
    return new Point(this.x, this.y);
  }
}

/**
 * Convert a GeoJSON Polygon (or its outer ring) into an array of {@link Point}s,
 * dropping the closing duplicate vertex of the ring.
 *
 * A GeoJSON linear ring of `N+1` coordinates closes by repeating its first
 * coordinate as its last; the rendered polygon needs only the `N` distinct
 * vertices, so the trailing duplicate is dropped.
 *
 * Accepts a GeoJSON Polygon object (`{type:'Polygon', coordinates:[[...]]}`),
 * a bare ring (`[[x,y], ...]`), or a MultiPolygon's first polygon. Returns
 * `Point` instances; ported from indoorcms `geometryToPoints`.
 *
 * @param {Object|Array} geometry
 * @returns {Point[]}
 */
export function geometryToPoints(geometry) {
  const ring = extractOuterRing(geometry);
  if (!Array.isArray(ring) || ring.length === 0) return [];

  let coords = ring;
  // Drop the closing duplicate vertex if the ring is closed (first === last).
  if (coords.length > 1) {
    const first = coords[0];
    const last = coords[coords.length - 1];
    if (
      Array.isArray(first) &&
      Array.isArray(last) &&
      first[0] === last[0] &&
      first[1] === last[1]
    ) {
      coords = coords.slice(0, -1);
    }
  }

  return coords
    .filter((pair) => Array.isArray(pair) && pair.length >= 2)
    .map(([x, y]) => new Point(x, y));
}

/**
 * Pull the outer ring (array of `[x,y]` pairs) out of a GeoJSON geometry shape.
 * @param {Object|Array} geometry
 * @returns {Array|null}
 */
function extractOuterRing(geometry) {
  if (!geometry) return null;

  // Bare ring: [[x,y], [x,y], ...]
  if (Array.isArray(geometry)) {
    if (geometry.length && Array.isArray(geometry[0]) && typeof geometry[0][0] === 'number') {
      return geometry;
    }
    // [[[x,y],...]] — coordinates array of a Polygon
    if (geometry.length && Array.isArray(geometry[0]) && Array.isArray(geometry[0][0])) {
      return geometry[0];
    }
    return null;
  }

  const type = geometry.type;
  const coords = geometry.coordinates;
  if (!Array.isArray(coords)) return null;

  if (type === 'MultiPolygon') {
    // [[ ring, ...holes ], ...] -> first polygon's outer ring
    return Array.isArray(coords[0]) ? coords[0][0] : null;
  }
  // Polygon: [ outerRing, ...holes ]
  return coords[0];
}

/**
 * A single drawable unit polygon on a level: the resolved point ring, the
 * owning unit id, and the cascade-resolved render style.
 */
export class UnitPolygon {
  /**
   * @param {Object} params
   * @param {string|number} params.unitId
   * @param {Point[]} params.points
   * @param {Object} params.style - { strokeColor, fillColor, strokeWidth }
   * @param {Object} [params.unit] - the source unit record
   */
  constructor({ unitId, points, style, unit }) {
    this.unitId = unitId;
    this.points = points;
    this.strokeColor = style.strokeColor;
    this.fillColor = style.fillColor;
    this.strokeWidth = style.strokeWidth;
    this.unit = unit;
  }

  /**
   * Bounding box of this polygon.
   * @returns {{minX:number,minY:number,maxX:number,maxY:number}|null}
   */
  getBounds() {
    if (!this.points.length) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of this.points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    return { minX, minY, maxX, maxY };
  }
}

/**
 * MapLevel: a single floor's drawable unit polygons plus framing metadata.
 *
 * Built from the indexed bundle: one {@link UnitPolygon} per active unit on the
 * level (editor `hidden`/`locked`/`opacity` flags are deliberately ignored —
 * the published consumer bundle renders the authored geometry regardless of the
 * authoring tool's view state).
 */
export class MapLevel {
  /**
   * @param {Object} params
   * @param {Object} params.level - the level record `{id, code, position, ...}`
   * @param {Array} params.units - units owned by this level
   * @param {Object|undefined} params.navmesh - the level's navmesh (or undefined)
   * @param {Map<number, Object>} params.layersById
   * @param {Map<string, Object>} params.kindsBySlug
   */
  constructor({ level, units, navmesh, layersById, kindsBySlug }) {
    this.id = level.id;
    this.code = level.code;
    this.ordinal = level.position ?? level.ordinal ?? 0;
    this.name = level.name ?? level.code;
    this.navmesh = navmesh ?? null;

    /** @type {UnitPolygon[]} */
    this.drawables = this.#buildDrawables(units, layersById, kindsBySlug);
  }

  #buildDrawables(units, layersById, kindsBySlug) {
    if (!Array.isArray(units)) return [];

    const out = [];
    for (const unit of units) {
      if (!unit) continue;
      // Editor flags (hidden/locked/opacity) do NOT gate rendering. Only
      // explicitly inactive units are dropped.
      if (unit.is_active === false) continue;

      const points = geometryToPoints(unit.geometry);
      if (points.length < 3) continue;

      const style = resolveStyle(unit, layersById, kindsBySlug);
      out.push(new UnitPolygon({ unitId: unit.id, points, style, unit }));
    }
    return out;
  }

  /**
   * The drawable unit polygons on this level (one per active unit).
   * @returns {UnitPolygon[]}
   */
  getDrawables() {
    return this.drawables;
  }

  /**
   * Calculate the framing bounding box of this level via the fallback chain:
   *   1. a level WITH a navmesh frames to its `envelope_dims`;
   *   2. a meshless level WITH units frames to the finite bbox union of its
   *      unit polygons;
   *   3. a meshless, unit-less level frames to a neutral default extent.
   *
   * Always returns a finite, non-degenerate box (never empty/NaN).
   * @returns {{minX:number,minY:number,maxX:number,maxY:number,width:number,height:number,centerX:number,centerY:number}}
   */
  getBounds() {
    // 1. Navmesh envelope_dims.
    if (this.navmesh && Array.isArray(this.navmesh.envelope_dims)) {
      const [w, h] = this.navmesh.envelope_dims;
      if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
        return this.#box(0, 0, w, h);
      }
    }

    // 2. Meshless with units -> bbox union of unit polygons.
    if (this.drawables.length) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const d of this.drawables) {
        const b = d.getBounds();
        if (!b) continue;
        if (b.minX < minX) minX = b.minX;
        if (b.minY < minY) minY = b.minY;
        if (b.maxX > maxX) maxX = b.maxX;
        if (b.maxY > maxY) maxY = b.maxY;
      }
      if (
        Number.isFinite(minX) &&
        Number.isFinite(minY) &&
        Number.isFinite(maxX) &&
        Number.isFinite(maxY) &&
        maxX > minX &&
        maxY > minY
      ) {
        return this.#boxFromExtent(minX, minY, maxX, maxY);
      }
    }

    // 3. Neutral default extent.
    return this.#box(0, 0, DEFAULT_EXTENT.width, DEFAULT_EXTENT.height);
  }

  #box(minX, minY, w, h) {
    return this.#boxFromExtent(minX, minY, minX + w, minY + h);
  }

  #boxFromExtent(minX, minY, maxX, maxY) {
    return {
      minX,
      minY,
      maxX,
      maxY,
      width: maxX - minX,
      height: maxY - minY,
      centerX: minX + (maxX - minX) / 2,
      centerY: minY + (maxY - minY) / 2
    };
  }
}

/**
 * Store for map geometry (floor plans), rebuilt over the webmap bundle.
 *
 * Hydrates per-unit drawable polygons per level from an indexed bundle model.
 * The public seam is preserved from the sunwaymalls shell: `levels` /
 * `levelByCode` arrays/maps, `getLevelByCode` / `getLevelsSorted` /
 * `getFloorCodes`.
 */
export class MapGeometryStore {
  #loader;
  #loaded = false;
  #renderScale = 1;

  /** @type {Map<number|string, Object>} unit id -> unit record (for connector kinds) */
  #unitsById = new Map();

  /** @type {MapLevel[]} */
  levels = [];

  /** @type {Map<string, MapLevel>} */
  levelByCode = new Map();

  /**
   * @param {BundleLoader|DataLoader} [loader]
   */
  constructor(loader = new BundleLoader()) {
    this.#loader = loader;
  }

  /**
   * Load and process map geometry from a bundle URL (single fetch).
   * @param {string} url
   * @param {Object} [options] - { renderScale }
   */
  async load(url, options = {}) {
    if (this.#loaded) return;
    const model = await this.#loader.load(url);
    this.hydrate(model, options);
  }

  /**
   * Populate the store from an ALREADY-INDEXED bundle model (no fetch).
   * The engine fetches the self-contained bundle once via BundleLoader and
   * threads the indexed model in here.
   * @param {import('./BundleLoader.js').BundleModel} model
   * @param {Object} [options] - { renderScale }
   */
  hydrate(model, options = {}) {
    if (this.#loaded) return;

    this.#renderScale = options.renderScale || 1;

    if (!model || !Array.isArray(model.levels)) {
      throw new Error('MapGeometryStore: Unrecognized map data format');
    }

    const layersById = model.layersById ?? this.#indexById(model.layers, 'id');
    const kindsBySlug = model.kindsBySlug ?? this.#indexById(model.kinds, 'slug');
    const navmeshByLevel = model.navmesh_by_level ?? {};

    this.levels = model.levels.map((level) => {
      const units = this.#unitsForLevel(model, level.id);
      const navmesh = navmeshByLevel[level.id] ?? navmeshByLevel[String(level.id)];
      return new MapLevel({ level, units, navmesh, layersById, kindsBySlug });
    });

    this.levels.sort((a, b) => a.ordinal - b.ordinal);
    this.levelByCode = new Map(this.levels.map((l) => [l.code, l]));

    // Index units by id so the nav-graph builder can derive each connector
    // group's kind from its member unit kind slug (architect decision (b)).
    this.#unitsById = new Map();
    for (const unit of model.units || []) {
      if (unit && unit.id != null) this.#unitsById.set(unit.id, unit);
    }

    this.#loaded = true;
  }

  /**
   * Build the routing {@link import('../navigation/NavGraph.js').NavGraph} from
   * the hydrated {@link MapLevel} navmeshes (meshless levels dropped) and the
   * bundle's vertical connector `transitions[]`. Pure pass-through: no fetch.
   *
   * @param {Array} [transitions] - bundle `transitions[]`
   * @returns {{levelGraphs: Map<string, Object>, transitions: Object[]}}
   */
  buildNavGraph(transitions = []) {
    return buildNavGraph(this.levels, transitions, {
      unitsById: this.#unitsById
    });
  }

  #unitsForLevel(model, levelId) {
    if (typeof model.getUnitsByLevelId === 'function') {
      return model.getUnitsByLevelId(levelId) ?? [];
    }
    if (model.unitsByLevelId && typeof model.unitsByLevelId.get === 'function') {
      return model.unitsByLevelId.get(levelId) ?? [];
    }
    if (Array.isArray(model.units)) {
      return model.units.filter((u) => u && u.level_id === levelId);
    }
    return [];
  }

  #indexById(arr, key) {
    const map = new Map();
    if (Array.isArray(arr)) {
      for (const item of arr) {
        if (item && item[key] != null) map.set(item[key], item);
      }
    }
    return map;
  }

  /**
   * Lookup level by code.
   * @param {string} code
   * @returns {MapLevel|undefined}
   */
  getLevelByCode(code) {
    return this.levelByCode.get(code);
  }

  /**
   * Get levels sorted by ordinal.
   * @returns {MapLevel[]}
   */
  getLevelsSorted() {
    return [...this.levels];
  }

  /**
   * Get floor codes in ordinal order.
   * @returns {string[]}
   */
  getFloorCodes() {
    return this.levels.map((l) => l.code);
  }

  /**
   * Get the render scale used.
   * @returns {number}
   */
  getRenderScale() {
    return this.#renderScale;
  }
}
