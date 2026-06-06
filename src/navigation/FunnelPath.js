/**
 * Funnel (string-pull) over a triangle channel.
 *
 * Given an ordered triangle-index path through a navmesh and the world-space
 * start/end points, derive the shortest polyline that stays inside the channel
 * the triangles form. Consecutive triangles share an edge ("portal"); the
 * funnel walks those portals, pulling the string taut so it bends only at the
 * portal vertices it must — yielding a path shorter than hopping centroids and,
 * on a convex channel, the straight segment `[start, end]` with no spurious
 * interior vertex.
 *
 * Implements Mikko Mononen's "Simple Stupid Funnel Algorithm".
 */

const EPS = 1e-9;

/**
 * Twice the signed area of triangle (a,b,c): >0 CCW, <0 CW, 0 collinear.
 */
function triArea2(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
}

function equalPoint(a, b) {
  return Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS;
}

function asPoint(p) {
  if (Array.isArray(p)) return { x: p[0], y: p[1] };
  return { x: p.x, y: p.y };
}

function vertexPoint(mesh, vi) {
  const v = mesh.vertices[vi];
  return { x: v[0], y: v[1] };
}

function meshCentroid(mesh, triIndex) {
  const tri = mesh.triangles[triIndex];
  const a = mesh.vertices[tri[0]];
  const b = mesh.vertices[tri[1]];
  const c = mesh.vertices[tri[2]];
  return { x: (a[0] + b[0] + c[0]) / 3, y: (a[1] + b[1] + c[1]) / 3 };
}

/**
 * Build the ordered list of portals (left/right vertex pairs in world space)
 * between consecutive triangles of `triPath`. Each portal is the shared edge of
 * `tri[i]` and `tri[i+1]`, oriented from the direction of travel: the vertex on
 * the left of the source→next centroid heading is `left`, the other is `right`.
 * This is winding-agnostic and keeps a consistent funnel orientation through a
 * re-entrant (concave) corner.
 *
 * @param {number[]} triPath
 * @param {Object} mesh
 * @returns {Array<{left:{x,y}, right:{x,y}}>}
 */
function buildPortals(triPath, mesh) {
  const portals = [];
  for (let i = 0; i < triPath.length - 1; i++) {
    const a = mesh.triangles[triPath[i]];
    const b = mesh.triangles[triPath[i + 1]];
    const shared = a.filter((vi) => b.includes(vi));
    if (shared.length < 2) continue; // not edge-adjacent; skip defensively

    const ca = meshCentroid(mesh, triPath[i]);
    const cb = meshCentroid(mesh, triPath[i + 1]);
    const dirX = cb.x - ca.x;
    const dirY = cb.y - ca.y;

    const p0 = vertexPoint(mesh, shared[0]);
    const p1 = vertexPoint(mesh, shared[1]);
    // cross(dir, vertex - ca) > 0 => vertex is to the geometric LEFT of the
    // heading. The SSFA's `right` array is the CW boundary; in this world space
    // (y-up) that is the left-of-heading vertex, so it is stored as `right`.
    const cross0 = dirX * (p0.y - ca.y) - dirY * (p0.x - ca.x);

    if (cross0 > 0) {
      portals.push({ left: p1, right: p0 });
    } else {
      portals.push({ left: p0, right: p1 });
    }
  }
  return portals;
}

/**
 * String-pull a triangle path into the shortest polyline through its channel.
 *
 * @param {number[]} triPath - ordered, edge-adjacent triangle indices
 * @param {Object} mesh - `{ vertices, triangles }`
 * @param {{x:number,y:number}|[number,number]} start - world start point
 * @param {{x:number,y:number}|[number,number]} end - world end point
 * @returns {Array<{x:number,y:number}>} polyline from start to end
 */
export function funnelPath(triPath, mesh, start, end) {
  const startPt = asPoint(start);
  const endPt = asPoint(end);

  if (!Array.isArray(triPath) || triPath.length === 0) {
    return [startPt, endPt];
  }
  if (triPath.length === 1) {
    return [startPt, endPt];
  }

  // Resolve each portal edge, oriented (left,right) by direction of travel.
  const portals = buildPortals(triPath, mesh);

  // Channel as an ordered list of (left, right) world points, bookended by the
  // degenerate start/end portals (apex == both sides).
  const channel = [{ left: startPt, right: startPt }];
  for (const p of portals) {
    channel.push({ left: p.left, right: p.right });
  }
  channel.push({ left: endPt, right: endPt });

  return stringPull(channel, startPt, endPt);
}

/**
 * Mononen's Simple Stupid Funnel over an ordered (left,right) channel.
 * @param {Array<{left:{x,y},right:{x,y}}>} channel
 * @param {{x,y}} startPt
 * @param {{x,y}} endPt
 * @returns {Array<{x,y}>}
 */
function stringPull(channel, startPt, endPt) {
  const path = [startPt];

  let apex = startPt;
  let left = startPt;
  let right = startPt;
  let apexIndex = 0;
  let leftIndex = 0;
  let rightIndex = 0;

  for (let i = 1; i < channel.length; i++) {
    const portalLeft = channel[i].left;
    const portalRight = channel[i].right;

    // --- Update RIGHT vertex ---
    if (triArea2(apex, right, portalRight) <= 0) {
      if (equalPoint(apex, right) || triArea2(apex, left, portalRight) > 0) {
        // Tighten the funnel.
        right = portalRight;
        rightIndex = i;
      } else {
        // Right over left -> insert left as a corner and restart from it.
        if (!equalPoint(path[path.length - 1], left)) {
          path.push(left);
        }
        apex = left;
        apexIndex = leftIndex;
        left = apex;
        right = apex;
        leftIndex = apexIndex;
        rightIndex = apexIndex;
        i = apexIndex;
        continue;
      }
    }

    // --- Update LEFT vertex ---
    if (triArea2(apex, left, portalLeft) >= 0) {
      if (equalPoint(apex, left) || triArea2(apex, right, portalLeft) < 0) {
        // Tighten the funnel.
        left = portalLeft;
        leftIndex = i;
      } else {
        // Left over right -> insert right as a corner and restart from it.
        if (!equalPoint(path[path.length - 1], right)) {
          path.push(right);
        }
        apex = right;
        apexIndex = rightIndex;
        left = apex;
        right = apex;
        leftIndex = apexIndex;
        rightIndex = apexIndex;
        i = apexIndex;
        continue;
      }
    }
  }

  if (!equalPoint(path[path.length - 1], endPt)) {
    path.push(endPt);
  }

  return path;
}
