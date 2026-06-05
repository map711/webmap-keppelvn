/**
 * Label shrink-to-fit scalar — ported verbatim from the indoorcms
 * `label-overlay` placement logic.
 *
 * Given a label's natural (text-box) dimensions and the available extents of the
 * owning unit polygon, return the largest uniform scale at which the rotated text
 * box still fits inside the unit, **clamped at 1** so a label that already fits is
 * never upscaled. The binding axis is whichever of width/height is tighter:
 *
 *   fitScale = min(1, unitWidth / labelWidth, unitHeight / labelHeight)
 *
 * Degenerate inputs (a zero/negative label dimension) fall back to 1 — there is
 * nothing to shrink and we must never divide by zero.
 *
 * Accepts a few argument shapes so callers (and tests) are not coupled to one
 * signature:
 *   - `_fitScale(labelW, labelH, unitW, unitH)`
 *   - `_fitScale({ width, height }, { width, height })`
 *   - `_fitScale({ labelWidth, labelHeight, unitWidth, unitHeight })`
 *   - `_fitScale({ textWidth, textHeight }, { width, height })`
 *
 * @returns {number} a finite scalar in `(0, 1]`
 */
export function _fitScale(a, b, c, d) {
  const dims = normalizeArgs(a, b, c, d);
  if (!dims) return 1;

  const { labelWidth, labelHeight, unitWidth, unitHeight } = dims;

  // A label with no natural extent cannot be shrunk; treat as already-fitting.
  if (!(labelWidth > 0) || !(labelHeight > 0)) return 1;

  const fitX = unitWidth > 0 ? unitWidth / labelWidth : 1;
  const fitY = unitHeight > 0 ? unitHeight / labelHeight : 1;

  const scale = Math.min(1, fitX, fitY);
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

/**
 * Coerce the supported call signatures into a single
 * `{labelWidth, labelHeight, unitWidth, unitHeight}` record.
 * @returns {{labelWidth:number,labelHeight:number,unitWidth:number,unitHeight:number}|null}
 */
function normalizeArgs(a, b, c, d) {
  // (labelW, labelH, unitW, unitH)
  if (typeof a === 'number') {
    return {
      labelWidth: a,
      labelHeight: Number(b),
      unitWidth: Number(c),
      unitHeight: Number(d)
    };
  }

  if (a && typeof a === 'object') {
    // ({labelWidth, labelHeight, unitWidth, unitHeight})
    if (a.labelWidth != null || a.unitWidth != null) {
      return {
        labelWidth: Number(a.labelWidth),
        labelHeight: Number(a.labelHeight),
        unitWidth: Number(a.unitWidth),
        unitHeight: Number(a.unitHeight)
      };
    }
    // ({width|textWidth, height|textHeight}, {width, height})
    if (b && typeof b === 'object') {
      return {
        labelWidth: Number(a.width ?? a.textWidth),
        labelHeight: Number(a.height ?? a.textHeight),
        unitWidth: Number(b.width ?? b.unitWidth),
        unitHeight: Number(b.height ?? b.unitHeight)
      };
    }
  }

  return null;
}

export { _fitScale as fitScale, _fitScale as computeFitScale };
export default _fitScale;
