import { MinHeap } from './MinHeap.js';

/**
 * Triangle-adjacency A* and point→triangle location over a navmesh.
 *
 * A navmesh is `{ vertices: [[x,y],...], triangles: [[i,j,k],...],
 * adjacency: [[t0,t1,t2],...] }` where `adjacency[t][e]` is the index of the
 * triangle sharing edge `e` of triangle `t` (or `-1` at a mesh boundary). Edges
 * are numbered opposite their vertex: edge0 = (v1,v2), edge1 = (v2,v0),
 * edge2 = (v0,v1) — matching the bundle's `navmesh_by_level` convention.
 */

/**
 * Centroid (average vertex) of a triangle.
 * @param {Object} mesh
 * @param {number} triIndex
 * @returns {{x:number, y:number}}
 */
export function triangleCentroid(mesh, triIndex) {
  const tri = mesh.triangles[triIndex];
  const a = mesh.vertices[tri[0]];
  const b = mesh.vertices[tri[1]];
  const c = mesh.vertices[tri[2]];
  return {
    x: (a[0] + b[0] + c[0]) / 3,
    y: (a[1] + b[1] + c[1]) / 3
  };
}

function dist(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

/**
 * Triangle-adjacency A* over a navmesh: the ordered chain of triangle indices
 * from `startTri` to `endTri`, stepping only across shared edges. Cost and
 * heuristic are the straight-line distance between triangle centroids.
 *
 * Returns `[startTri]` when start === end, and `[]` when the two triangles are
 * not connected (disjoint mesh components) or either index is out of range.
 *
 * @param {Object} mesh - `{ vertices, triangles, adjacency }`
 * @param {number} startTri
 * @param {number} endTri
 * @returns {number[]} ordered triangle-index path (`[]` if unreachable)
 */
export function triangleAStar(mesh, startTri, endTri) {
  const triangles = mesh?.triangles;
  const adjacency = mesh?.adjacency;
  if (!Array.isArray(triangles) || !Array.isArray(adjacency)) return [];

  const n = triangles.length;
  if (startTri < 0 || startTri >= n || endTri < 0 || endTri >= n) return [];
  if (startTri === endTri) return [startTri];

  const centroids = new Array(n);
  const centroidOf = (t) => {
    if (!centroids[t]) centroids[t] = triangleCentroid(mesh, t);
    return centroids[t];
  };

  const endC = centroidOf(endTri);
  const heuristic = (t) => {
    const c = centroidOf(t);
    return dist(c.x, c.y, endC.x, endC.y);
  };

  const gScore = new Map();
  const fScore = new Map();
  const cameFrom = new Map();
  const closed = new Set();

  gScore.set(startTri, 0);
  fScore.set(startTri, heuristic(startTri));

  const open = new MinHeap((a, b) => (fScore.get(a) ?? Infinity) - (fScore.get(b) ?? Infinity));
  open.insert(startTri);

  while (!open.isEmpty) {
    const current = open.extractMin();

    if (current === endTri) {
      return reconstruct(cameFrom, current);
    }

    closed.add(current);
    const cc = centroidOf(current);
    const neighbours = adjacency[current] || [];

    for (const next of neighbours) {
      if (next < 0 || next >= n || closed.has(next)) continue;

      const nc = centroidOf(next);
      const stepCost = dist(cc.x, cc.y, nc.x, nc.y);
      const tentativeG = (gScore.get(current) ?? Infinity) + stepCost;

      if (tentativeG < (gScore.get(next) ?? Infinity)) {
        cameFrom.set(next, current);
        gScore.set(next, tentativeG);
        fScore.set(next, tentativeG + heuristic(next));
        if (open.has(next)) {
          open.updatePriority(next);
        } else {
          open.insert(next);
        }
      }
    }
  }

  return [];
}

function reconstruct(cameFrom, endTri) {
  const path = [endTri];
  let current = endTri;
  while (cameFrom.has(current)) {
    current = cameFrom.get(current);
    path.push(current);
  }
  return path.reverse();
}

/**
 * Sign of the cross product (b-a)x(p-a); >0 left of a->b, <0 right, 0 on the line.
 */
function side(ax, ay, bx, by, px, py) {
  return (bx - ax) * (py - ay) - (by - ay) * (px - ax);
}

/**
 * True when `(px,py)` lies inside (or on the boundary of) triangle `triIndex`.
 * Orientation-agnostic: accepts both CW and CCW winding.
 */
function pointInTriangle(mesh, triIndex, px, py) {
  const tri = mesh.triangles[triIndex];
  const a = mesh.vertices[tri[0]];
  const b = mesh.vertices[tri[1]];
  const c = mesh.vertices[tri[2]];
  const d1 = side(a[0], a[1], b[0], b[1], px, py);
  const d2 = side(b[0], b[1], c[0], c[1], px, py);
  const d3 = side(c[0], c[1], a[0], a[1], px, py);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  // Inside iff all signs agree (allowing zero on edges).
  return !(hasNeg && hasPos);
}

/**
 * Squared distance from point `(px,py)` to triangle `triIndex`: 0 when the point
 * is inside, else the min squared distance to the triangle's three edges.
 */
function distanceSqToTriangle(mesh, triIndex, px, py) {
  if (pointInTriangle(mesh, triIndex, px, py)) return 0;
  const tri = mesh.triangles[triIndex];
  const a = mesh.vertices[tri[0]];
  const b = mesh.vertices[tri[1]];
  const c = mesh.vertices[tri[2]];
  return Math.min(
    distSqToSegment(px, py, a[0], a[1], b[0], b[1]),
    distSqToSegment(px, py, b[0], b[1], c[0], c[1]),
    distSqToSegment(px, py, c[0], c[1], a[0], a[1])
  );
}

function distSqToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return (px - cx) * (px - cx) + (py - cy) * (py - cy);
}

/**
 * The index of the triangle that contains `(x,y)`, or — when the point lies
 * outside every triangle — the index of the nearest triangle by edge distance.
 * Returns `-1` for an empty/degenerate mesh.
 *
 * @param {Object} mesh - `{ vertices, triangles }`
 * @param {number} x
 * @param {number} y
 * @returns {number}
 */
export function findNearestTriangle(mesh, x, y) {
  const triangles = mesh?.triangles;
  if (!Array.isArray(triangles) || triangles.length === 0) return -1;

  let best = -1;
  let bestDistSq = Infinity;

  for (let t = 0; t < triangles.length; t++) {
    if (pointInTriangle(mesh, t, x, y)) return t;
    const dsq = distanceSqToTriangle(mesh, t, x, y);
    if (dsq < bestDistSq) {
      bestDistSq = dsq;
      best = t;
    }
  }
  return best;
}
