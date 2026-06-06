/**
 * StyleResolver — the indoorcms style cascade, ported verbatim.
 *
 * A unit's rendered style is resolved by walking `unit -> layer -> kind ->
 * default`, where an empty string (`""`) or `null`/`undefined` value at a level
 * means "inherit from the next level down". The first concrete (non-inherit)
 * value wins. When every level under-specifies, the hard defaults apply:
 * stroke `#000`, fill `#ccc`, stroke width `1`.
 *
 * @see capabilities/floor-rendering.md — the style-cascade contract.
 */

const DEFAULT_STROKE_COLOR = '#000';
const DEFAULT_FILL_COLOR = '#ccc';
const DEFAULT_STROKE_WIDTH = 1;

/**
 * Is this a concrete colour value (not an inherit sentinel)?
 * `""` and `null`/`undefined` are inherit; any other string is concrete.
 * @param {*} v
 * @returns {boolean}
 */
function hasColor(v) {
  return typeof v === 'string' && v !== '';
}

/**
 * Is this a concrete width value (not an inherit sentinel)?
 * `null`/`undefined` is inherit; a finite number is concrete.
 * @param {*} v
 * @returns {boolean}
 */
function hasWidth(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Resolve the cascade for one colour channel across unit/layer/kind.
 * @param {Object|undefined} unit
 * @param {Object|undefined} layer
 * @param {Object|undefined} kind
 * @param {string} key - the property name on each record (e.g. 'stroke_color')
 * @param {string} fallback
 * @returns {string}
 */
function resolveColor(unit, layer, kind, key, fallback) {
  if (unit && hasColor(unit[key])) return unit[key];
  if (layer && hasColor(layer[key])) return layer[key];
  if (kind && hasColor(kind[key])) return kind[key];
  return fallback;
}

/**
 * Resolve the cascade for the stroke-width channel across unit/layer/kind.
 * @param {Object|undefined} unit
 * @param {Object|undefined} layer
 * @param {Object|undefined} kind
 * @returns {number}
 */
function resolveWidth(unit, layer, kind) {
  if (unit && hasWidth(unit.stroke_width)) return unit.stroke_width;
  if (layer && hasWidth(layer.stroke_width)) return layer.stroke_width;
  if (kind && hasWidth(kind.stroke_width)) return kind.stroke_width;
  return DEFAULT_STROKE_WIDTH;
}

/**
 * Resolve the effective render style for a unit via the `unit || layer || kind
 * || default` cascade.
 *
 * @param {Object} unit - the unit record (`{layer_id, kind, stroke_color, ...}`)
 * @param {Map<number, Object>} layersById - layer id -> layer record
 * @param {Map<string, Object>} kindsBySlug - kind slug -> kind record
 * @returns {{strokeColor:string, fillColor:string, strokeWidth:number}}
 */
export function resolveStyle(unit, layersById, kindsBySlug) {
  const u = unit || {};
  const layer =
    layersById && u.layer_id != null && typeof layersById.get === 'function'
      ? layersById.get(u.layer_id)
      : undefined;
  const kind =
    kindsBySlug && u.kind != null && typeof kindsBySlug.get === 'function'
      ? kindsBySlug.get(u.kind)
      : undefined;

  return {
    strokeColor: resolveColor(u, layer, kind, 'stroke_color', DEFAULT_STROKE_COLOR),
    fillColor: resolveColor(u, layer, kind, 'fill_color', DEFAULT_FILL_COLOR),
    strokeWidth: resolveWidth(u, layer, kind)
  };
}

export default resolveStyle;
