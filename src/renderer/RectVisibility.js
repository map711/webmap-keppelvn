import RBush from 'rbush/index.js';

/**
 * Compute the indices of visible rectangles in input order.
 * A rectangle is visible only if it doesn't overlap any previously visible rectangle.
 * @param {Array<{cx: number, cy: number, width: number, height: number, rotation: number}>} rects
 * @returns {Array<number>} indices of visible rectangles
 */
export function computeVisibleRects(rects) {
  const tree = new RBush();
  const visible = [];

  for (let i = 0; i < rects.length; i++) {
    const rect = rects[i];
    const corners = getCorners(rect);
    const axes = getAxes(corners);
    const aabb = getAABB(corners);

    const candidates = tree.search(aabb);
    let overlaps = false;
    for (const candidate of candidates) {
      if (checkSATOverlap({ corners, axes }, candidate)) {
        overlaps = true;
        break;
      }
    }

    if (!overlaps) {
      tree.insert({
        ...aabb,
        corners,
        axes
      });
      visible.push(i);
    }
  }

  return visible;
}

function getCorners(rect) {
  const hw = rect.width / 2;
  const hh = rect.height / 2;
  const cos = Math.cos(rect.rotation);
  const sin = Math.sin(rect.rotation);

  const local = [
    { x: -hw, y: -hh },
    { x: hw, y: -hh },
    { x: hw, y: hh },
    { x: -hw, y: hh }
  ];

  return local.map((pt) => ({
    x: rect.cx + pt.x * cos - pt.y * sin,
    y: rect.cy + pt.x * sin + pt.y * cos
  }));
}

function getAABB(corners) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const pt of corners) {
    if (pt.x < minX) minX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y > maxY) maxY = pt.y;
  }

  return { minX, minY, maxX, maxY };
}

function getAxes(corners) {
  const axes = [];
  for (let i = 0; i < 2; i++) {
    const a = corners[i];
    const b = corners[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) {
      axes.push({ x: 1, y: 0 });
    } else {
      axes.push({ x: -dy / length, y: dx / length });
    }
  }
  return axes;
}

function project(axis, corners) {
  let min = Infinity;
  let max = -Infinity;
  for (const pt of corners) {
    const dot = axis.x * pt.x + axis.y * pt.y;
    if (dot < min) min = dot;
    if (dot > max) max = dot;
  }
  return { min, max };
}

function checkSATOverlap(rectA, rectB) {
  const axes = rectA.axes.concat(rectB.axes);
  for (const axis of axes) {
    const projA = project(axis, rectA.corners);
    const projB = project(axis, rectB.corners);
    if (projA.min > projB.max || projB.min > projA.max) {
      return false;
    }
  }
  return true;
}
