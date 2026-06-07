/**
 * Reduce a list of per-floor bounds to the cross-floor envelope: the per-axis
 * maxima. Fitting THIS single worst-case box yields the smallest fit scale of any
 * floor (the "largest fitted view"), which the engine scales by the max-zoom
 * factor to get one global zoom-in ceiling shared by every floor.
 *
 * @param {Array<{width:number,height:number}|null|undefined>} boundsList
 * @returns {{width:number,height:number}|null} null when no entry has usable dims.
 */
export function computeEnvelope(boundsList) {
  let width = 0;
  let height = 0;
  for (const b of boundsList ?? []) {
    if (!b) continue;
    const { width: w, height: h } = b;
    if (Number.isFinite(w) && w > width) width = w;
    if (Number.isFinite(h) && h > height) height = h;
  }
  return width > 0 && height > 0 ? { width, height } : null;
}
