// >>> TARS cap:navmesh-routing
//
// navmesh-routing — triangle-A* + funnel over `navmesh_by_level`, cross-floor
// stitching via bundle `transitions[]`, exposed as a typed `RouteResult` from
// `PathFinder.findPath(id, id)`.
//
// Pure ports (NavGraph / TriangleAStar / FunnelPath) are driven by a SYNTHETIC
// routing fixture (test/navigation/routingFixture.js): a meshless level F0, an
// L-shaped multi-triangle F1 where straight-line != shortest, a rectangular F2,
// and TWO bidirectional connector groups (escalator cost 1.0, lift cost 2.0).
// PathFinder.findPath is exercised end-to-end over the SAME fixture hydrated
// through the real BundleLoader -> LocationStore + MapGeometryStore.buildNavGraph.
// The real SGC_v001.json drives the opt-in smoke checks (rules only).
//
// Targets (one per acceptance criterion):
//   1. buildNavGraph -> levelGraphs keyed {F1,F2} (meshless F0 absent); transitions
//      parsed to 2 bidirectional RouteTransition groups.
//   2. triangleAStar on the L-shape -> ordered triangle path (len>=3); on two
//      disconnected triangles -> [].
//   3. findNearestTriangle -> the triangle index containing/closest-to (x,y)
//      (shop centroid + connector centroid).
//   4. funnelPath([0,1,2,3]) -> polyline starting@start ending@end, with an
//      interior elbow near the concave corner, strictly shorter than centroid-hop.
//   5. funnelPath([0,1]) on a straight corridor -> exactly [a,b].
//   6. findPath(shopA,shopB) same floor -> {success:true}, segments Map size 1,
//      transitions:[], startAnchor/endAnchor {levelCode,x,y}.
//   7. findPath cross-floor -> segments size 2 (F1,F2), transitions.length 1
//      (from/toLevelCode + from/to at connector centroids), levelCodes [F1,F2],
//      distance == summed polyline length.
//   8. start==end -> {success:true}, single-point segment, distance===0.
//   9. smoke (real SGC): L3<->L3 single-floor; L2->L3 cross-floor escalator.

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BundleLoader } from '../../src/data/BundleLoader.js';
import { LocationStore } from '../../src/data/LocationModel.js';
import { MapGeometryStore } from '../../src/data/MapGeometryModel.js';
import {
  makeRoutingBundle,
  F1_VERTICES,
  F1_TRIANGLES,
  F1_ADJACENCY,
  F1_START,
  F1_END,
  F1_CONCAVE_CORNER,
  DISCONNECTED_VERTICES,
  DISCONNECTED_TRIANGLES,
  DISCONNECTED_ADJACENCY,
  STRAIGHT_VERTICES,
  STRAIGHT_TRIANGLES,
  STRAIGHT_ADJACENCY,
  STRAIGHT_A,
  STRAIGHT_B,
  ANCHORS,
  SHOP_A_ID,
  SHOP_A2_ID,
  SHOP_B_ID
} from './routingFixture.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');
const sgcFixturePath = join(repoRoot, 'test', 'fixtures', 'SGC_v001.json');

function loadSgcRaw() {
  return JSON.parse(readFileSync(sgcFixturePath, 'utf8'));
}

// --- Lazy module resolution -------------------------------------------------
// Resolve the not-yet-built ports lazily so the suite COLLECTS cleanly and each
// test fails on a behavioural assertion (an explicit, message-bearing failure)
// rather than a module-resolution crash. Once the module exists these pass
// through unchanged.
async function importNamed(path, name) {
  let mod = null;
  try {
    mod = await import(path);
  } catch {
    mod = null;
  }
  expect(mod, `${path} must exist`).not.toBeNull();
  expect(mod[name], `${path} must export ${name}`).toBeTypeOf('function');
  return mod[name];
}

async function importBuildNavGraph() {
  return importNamed('../../src/navigation/NavGraph.js', 'buildNavGraph');
}
async function importTriangleAStar() {
  return importNamed('../../src/navigation/TriangleAStar.js', 'triangleAStar');
}
async function importFindNearestTriangle() {
  return importNamed('../../src/navigation/TriangleAStar.js', 'findNearestTriangle');
}
async function importFunnelPath() {
  return importNamed('../../src/navigation/FunnelPath.js', 'funnelPath');
}
async function importPathFinder() {
  return importNamed('../../src/navigation/PathFinder.js', 'PathFinder');
}

// A bare mesh object in the navmesh shape the pure ports consume.
function meshOf(vertices, triangles, adjacency) {
  return { vertices, triangles, adjacency, doors_by_unit: {}, centroids_by_unit: {} };
}

// --- Geometry helpers (test-owned, so assertions are independent of impl) ----
function asXY(p) {
  if (p == null) return null;
  if (Array.isArray(p)) return { x: p[0], y: p[1] };
  return { x: p.x, y: p.y };
}
function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
function polylineLength(points) {
  const pts = points.map(asXY);
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += dist(pts[i - 1], pts[i]);
  return total;
}
function centroidOf(mesh, triIndex) {
  const t = mesh.triangles[triIndex];
  const v = t.map((i) => mesh.vertices[i]);
  return {
    x: (v[0][0] + v[1][0] + v[2][0]) / 3,
    y: (v[0][1] + v[1][1] + v[2][1]) / 3
  };
}

// Build the full routing system over the synthetic fixture, mirroring the engine
// seam: BundleLoader.load -> BundleModel; LocationStore + MapGeometryStore
// hydrate; navGraph = store.buildNavGraph(transitions); PathFinder(navGraph,
// locationStore).
async function buildRoutingSystem(rawBundle = makeRoutingBundle()) {
  const PathFinder = await importPathFinder();
  const loader = new BundleLoader({ load: () => Promise.resolve(structuredClone(rawBundle)) });
  const model = await loader.load('/bundle.json');

  const locationStore = new LocationStore();
  locationStore.hydrate(model, { renderScale: 1 });

  const geometryStore = new MapGeometryStore();
  geometryStore.hydrate(model, { renderScale: 1 });

  expect(
    typeof geometryStore.buildNavGraph,
    'MapGeometryStore.buildNavGraph must exist (the graph-build seam)'
  ).toBe('function');
  const navGraph = geometryStore.buildNavGraph(model.transitions);

  const pathFinder = new PathFinder(navGraph, locationStore);
  return { pathFinder, navGraph, locationStore, geometryStore, model };
}

// Normalise the result `segments` into a Map<levelCode, [x,y][]> regardless of
// whether the impl returns a Map or a plain object — the contract is "a Map of
// per-floor polylines"; we assert size/keys/contents either way.
function segmentsMap(result) {
  const s = result.segments;
  if (s instanceof Map) return s;
  if (s && typeof s === 'object') return new Map(Object.entries(s));
  return new Map();
}

describe('navmesh-routing', () => {
  // ===== Criterion 1: buildNavGraph =========================================
  describe('NavGraph.buildNavGraph: meshless level dropped, transitions parsed', () => {
    let buildNavGraph;
    let model;
    beforeEach(async () => {
      buildNavGraph = await importBuildNavGraph();
      const loader = new BundleLoader({ load: () => Promise.resolve(makeRoutingBundle()) });
      model = await loader.load('/bundle.json');
    });

    it('levelGraphs is keyed {F1,F2} ONLY — meshless F0 is absent', () => {
      const graph = buildNavGraph(model.levels, model.transitions);
      const levelGraphs = graph.levelGraphs ?? graph;
      // Resolve the set of floor codes the graph holds, however it is exposed.
      const keys = levelGraphs instanceof Map
        ? [...levelGraphs.keys()]
        : Object.keys(levelGraphs);
      expect(keys.sort()).toEqual(['F1', 'F2']);
      expect(keys).not.toContain('F0');
    });

    it('parses transitions into 2 bidirectional RouteTransition groups', () => {
      const graph = buildNavGraph(model.levels, model.transitions);
      const transitions = graph.transitions ?? graph.routeTransitions;
      expect(Array.isArray(transitions), 'graph exposes a transitions array').toBe(true);
      expect(transitions.length).toBe(2);
      // Each group is bidirectional and spans F1 <-> F2.
      for (const t of transitions) {
        expect(t.direction ?? 'bidirectional').toBe('bidirectional');
        const codes = (t.levelCodes ?? [t.fromLevelCode, t.toLevelCode]).slice().sort();
        expect(codes).toEqual(['F1', 'F2']);
      }
      // The two distinct connector kinds survive (escalator + lift/elevator).
      const kinds = transitions.map((t) => t.kind).sort();
      expect(kinds).toEqual(['elevator', 'escalator']);
    });
  });

  // ===== Criterion 2: triangleAStar =========================================
  describe('triangleAStar: ordered triangle path on L-shape; [] when disconnected', () => {
    let triangleAStar;
    beforeEach(async () => {
      triangleAStar = await importTriangleAStar();
    });

    it('returns the ordered triangle-index chain 0..3 connecting start tri 0 and end tri 3', () => {
      const mesh = meshOf(F1_VERTICES, F1_TRIANGLES, F1_ADJACENCY);
      const path = triangleAStar(mesh, 0, 3);
      expect(Array.isArray(path)).toBe(true);
      expect(path.length).toBeGreaterThanOrEqual(3);
      // Endpoints pinned; the chain runs from the start triangle to the end.
      expect(path[0]).toBe(0);
      expect(path[path.length - 1]).toBe(3);
      // Consecutive entries must be edge-adjacent in the mesh adjacency.
      for (let i = 1; i < path.length; i++) {
        const neighbours = F1_ADJACENCY[path[i - 1]];
        expect(neighbours, `tri ${path[i - 1]} adjacency`).toContain(path[i]);
      }
    });

    it('returns [] for two triangles with no connecting path', () => {
      const mesh = meshOf(DISCONNECTED_VERTICES, DISCONNECTED_TRIANGLES, DISCONNECTED_ADJACENCY);
      const path = triangleAStar(mesh, 0, 1);
      expect(path).toEqual([]);
    });
  });

  // ===== Criterion 3: findNearestTriangle ===================================
  describe('findNearestTriangle: index of the containing/closest triangle', () => {
    let findNearestTriangle;
    beforeEach(async () => {
      findNearestTriangle = await importFindNearestTriangle();
    });

    it('locates the triangle containing a shop centroid (tri 0 on F1)', () => {
      const mesh = meshOf(F1_VERTICES, F1_TRIANGLES, F1_ADJACENCY);
      const { x, y } = ANCHORS.shopA_F1; // (2,5) lies inside tri0
      const idx = findNearestTriangle(mesh, x, y);
      expect(idx).toBe(0);
    });

    it('locates the triangle containing a connector centroid (tri 3 on F1)', () => {
      const mesh = meshOf(F1_VERTICES, F1_TRIANGLES, F1_ADJACENCY);
      const { x, y } = ANCHORS.escalatorF1; // (38,30) lies inside tri3
      const idx = findNearestTriangle(mesh, x, y);
      expect(idx).toBe(3);
    });
  });

  // ===== Criterion 4: funnelPath over the L-shape ===========================
  describe('funnelPath: string-pull bends through the concave corner', () => {
    let funnelPath;
    beforeEach(async () => {
      funnelPath = await importFunnelPath();
    });

    it('begins at start, ends at end, has an interior elbow near the concave corner, and is shorter than a centroid-hop', () => {
      const mesh = meshOf(F1_VERTICES, F1_TRIANGLES, F1_ADJACENCY);
      const raw = funnelPath([0, 1, 2, 3], mesh, F1_START, F1_END);
      const poly = raw.map(asXY);

      // (a) endpoints
      expect(poly[0].x).toBeCloseTo(F1_START.x, 6);
      expect(poly[0].y).toBeCloseTo(F1_START.y, 6);
      expect(poly[poly.length - 1].x).toBeCloseTo(F1_END.x, 6);
      expect(poly[poly.length - 1].y).toBeCloseTo(F1_END.y, 6);

      // (b) at least one INTERIOR vertex, and one sits near the concave corner
      //     (30,10) — the bend the straight line cannot make.
      expect(poly.length).toBeGreaterThanOrEqual(3);
      const interior = poly.slice(1, -1);
      const nearCorner = interior.some(
        (p) => dist(p, F1_CONCAVE_CORNER) < 1.0
      );
      expect(nearCorner, 'an interior elbow vertex sits at the concave corner (30,10)').toBe(true);

      // (c) strictly shorter than hopping centroid-to-centroid through the same
      //     four triangles.
      const centroidHop = [
        F1_START,
        centroidOf(mesh, 0),
        centroidOf(mesh, 1),
        centroidOf(mesh, 2),
        centroidOf(mesh, 3),
        F1_END
      ];
      expect(polylineLength(poly)).toBeLessThan(polylineLength(centroidHop));
    });
  });

  // ===== Criterion 5: funnelPath over a straight corridor ===================
  describe('funnelPath: straight corridor yields no spurious interior point', () => {
    let funnelPath;
    beforeEach(async () => {
      funnelPath = await importFunnelPath();
    });

    it('funnelPath([0,1], straightMesh, a, b) returns exactly [a, b]', () => {
      const mesh = meshOf(STRAIGHT_VERTICES, STRAIGHT_TRIANGLES, STRAIGHT_ADJACENCY);
      const raw = funnelPath([0, 1], mesh, STRAIGHT_A, STRAIGHT_B);
      const poly = raw.map(asXY);
      expect(poly.length).toBe(2);
      expect(poly[0]).toEqual({ x: STRAIGHT_A.x, y: STRAIGHT_A.y });
      expect(poly[1]).toEqual({ x: STRAIGHT_B.x, y: STRAIGHT_B.y });
    });
  });

  // ===== Criterion 6: same-floor findPath ===================================
  describe('PathFinder.findPath: same-floor route', () => {
    let pathFinder;
    beforeEach(async () => {
      ({ pathFinder } = await buildRoutingSystem());
    });

    it('two shops on F1 -> success, segments Map size 1 keyed F1, transitions [], anchors carry {levelCode,x,y}', () => {
      const result = pathFinder.findPath(SHOP_A_ID, SHOP_A2_ID);
      expect(result.success).toBe(true);

      const segs = segmentsMap(result);
      expect(segs instanceof Map).toBe(true);
      expect(segs.size).toBe(1);
      expect([...segs.keys()]).toEqual(['F1']);
      const poly = segs.get('F1');
      expect(Array.isArray(poly)).toBe(true);
      expect(poly.length).toBeGreaterThanOrEqual(2);

      expect(result.transitions).toEqual([]);

      // anchors carry the level + world coords of the snapped start/end.
      expect(result.startAnchor.levelCode).toBe('F1');
      expect(result.endAnchor.levelCode).toBe('F1');
      expect(typeof result.startAnchor.x).toBe('number');
      expect(typeof result.startAnchor.y).toBe('number');
      expect(result.startAnchor.x).toBeCloseTo(ANCHORS.shopA_F1.x, 6);
      expect(result.startAnchor.y).toBeCloseTo(ANCHORS.shopA_F1.y, 6);
      expect(result.endAnchor.x).toBeCloseTo(ANCHORS.shopA2_F1.x, 6);
      expect(result.endAnchor.y).toBeCloseTo(ANCHORS.shopA2_F1.y, 6);
    });
  });

  // ===== Criterion 7: cross-floor findPath ==================================
  describe('PathFinder.findPath: cross-floor route', () => {
    let pathFinder;
    beforeEach(async () => {
      ({ pathFinder } = await buildRoutingSystem());
    });

    it('F1 shop -> F2 shop: segments size 2, one transition F1->F2 at connector centroids, levelCodes [F1,F2], distance = summed polyline length', () => {
      const result = pathFinder.findPath(SHOP_A_ID, SHOP_B_ID);
      expect(result.success).toBe(true);

      const segs = segmentsMap(result);
      expect(segs.size).toBe(2);
      const f1 = segs.get('F1');
      const f2 = segs.get('F2');
      expect(Array.isArray(f1) && f1.length > 0, 'non-empty F1 segment').toBe(true);
      expect(Array.isArray(f2) && f2.length > 0, 'non-empty F2 segment').toBe(true);

      // exactly one floor transition
      expect(result.transitions.length).toBe(1);
      const t = result.transitions[0];
      expect(t.fromLevelCode).toBe('F1');
      expect(t.toLevelCode).toBe('F2');
      expect(t.levelCodes).toEqual(['F1', 'F2']);

      // from/to sit at the connector member centroids (escalator is preferred
      // by default and is cheaper here).
      const from = asXY(t.from);
      const to = asXY(t.to);
      expect(from.x).toBeCloseTo(ANCHORS.escalatorF1.x, 6);
      expect(from.y).toBeCloseTo(ANCHORS.escalatorF1.y, 6);
      expect(to.x).toBeCloseTo(ANCHORS.escalatorF2.x, 6);
      expect(to.y).toBeCloseTo(ANCHORS.escalatorF2.y, 6);

      // distance is the SUM of both per-floor polyline lengths.
      const expected = polylineLength(f1) + polylineLength(f2);
      expect(result.distance).toBeCloseTo(expected, 4);
    });
  });

  // ===== Criterion 8: degenerate same-point route ===========================
  describe('PathFinder.findPath: start == end', () => {
    let pathFinder;
    beforeEach(async () => {
      ({ pathFinder } = await buildRoutingSystem());
    });

    it('routing a destination to itself -> success, single-point segment, distance 0', () => {
      const result = pathFinder.findPath(SHOP_A_ID, SHOP_A_ID);
      expect(result.success).toBe(true);
      expect(result.distance).toBe(0);

      const segs = segmentsMap(result);
      expect(segs.size).toBe(1);
      const poly = segs.get('F1');
      expect(Array.isArray(poly)).toBe(true);
      expect(poly.length).toBe(1);
    });
  });

  // ===== Criterion 9: opt-in smoke over the real SGC bundle =================
  // Heavier: reads the real 2 MB SGC fixture from disk and asserts RULES only
  // (counts/coords are sparse-seed specific and live in the synthetic fixture).
  describe('smoke (real SGC_v001.json): rules only', () => {
    let pathFinder;
    let locationStore;
    beforeEach(async () => {
      const PathFinder = await importPathFinder();
      const loader = new BundleLoader({ load: () => Promise.resolve(loadSgcRaw()) });
      const model = await loader.load('/sgc.json');

      locationStore = new LocationStore();
      locationStore.hydrate(model, { renderScale: 1 });

      const geometryStore = new MapGeometryStore();
      geometryStore.hydrate(model, { renderScale: 1 });
      expect(
        typeof geometryStore.buildNavGraph,
        'MapGeometryStore.buildNavGraph must exist (the graph-build seam)'
      ).toBe('function');
      const navGraph = geometryStore.buildNavGraph(model.transitions);
      pathFinder = new PathFinder(navGraph, locationStore);
    });

    it('two shops on L3 route on a single floor (success, one L3 segment, no transition)', () => {
      // shop:10 (Starbucks, unit 108) and shop:4 (unit 122) are both placed on L3.
      const result = pathFinder.findPath('shop:10', 'shop:4');
      expect(result.success).toBe(true);
      expect(result.transitions).toEqual([]);

      const segs = segmentsMap(result);
      expect([...segs.keys()]).toEqual(['L3']);
      expect((segs.get('L3') || []).length).toBeGreaterThanOrEqual(1);
    });

    it('a cross-floor route into L2 uses the escalator group: transitions[0].kind escalator, segments on L2 and L3', () => {
      // The seed has NO placed shop on L2 (all 4 placed shops are on L3), so a
      // shop:L2 -> shop:L3 pair is not expressible from the catalog. The faithful
      // witness of "L2 <-> L3 routes via the escalator connector" is a route from
      // an L3 shop down to the L2 escalator member. PathFinder must expose a way
      // to route to a raw connector anchor (the L2 escalator unit 67) for this.
      // Asserted rules: success, an escalator transition, and both floor segments.
      expect(
        typeof pathFinder.findPathToAnchor,
        'PathFinder must expose findPathToAnchor for cross-floor anchors (no L2 shop on the seed)'
      ).toBe('function');

      const result = pathFinder.findPathToAnchor('shop:4', {
        levelCode: 'L2',
        unitId: 67 // the L2 escalator connector member of the L2<->L3 group
      });
      expect(result.success).toBe(true);
      expect(result.transitions.length).toBe(1);
      expect(result.transitions[0].kind).toBe('escalator');

      const segs = segmentsMap(result);
      expect(segs.has('L2')).toBe(true);
      expect(segs.has('L3')).toBe(true);
      expect((segs.get('L2') || []).length).toBeGreaterThan(0);
      expect((segs.get('L3') || []).length).toBeGreaterThan(0);
    });
  });
});
// <<< TARS cap:navmesh-routing

// >>> TARS cap:route-preferences
//
// route-preferences — the cross-floor connector CHOICE policy layered on top of
// the navmesh router. Two knobs, exercised end-to-end over the SAME synthetic
// routing fixture (test/navigation/routingFixture.js, F1<->F2 with an escalator
// group cost 1.0 is_accessible:false + a lift group cost 2.0 is_accessible:true):
//
//   * `routeMode` ('escalator' default | 'lift') — a SOFT penalty: the preferred
//     connector kind is favoured, but the other kind is never filtered out; if
//     only the non-preferred connector exists the route still succeeds via it.
//   * `stepFree` (default false | true) — a HARD gate: only `is_accessible`
//     groups may be used; an inaccessible connector is gated to Infinity (never
//     used), so with no accessible connector the route fails NO_PATH.
//
// Changing either knob must invalidate any memoised route so a re-`findPath`
// reflects the new policy, not a stale answer.
//
// Targets (one per acceptance criterion):
//   1. routeMode 'escalator' (default) cross-floor F1->F2 -> transitions[0].kind escalator.
//   2. routeMode 'lift' -> the lift group is chosen (accessible, not the escalator).
//   3. only the non-preferred connector present -> route still succeeds via it.
//   4. stepFree=true -> transitions[0].is_accessible === true even when escalator cheaper.
//   5. stepFree=true with no accessible connector -> {success:false, code NO_PATH}.
//   6. changing routeMode / stepFree invalidates the cache (re-findPath is fresh).

import {
  makeRoutingBundle as rpMakeRoutingBundle,
  ANCHORS as RP_ANCHORS,
  SHOP_A_ID as RP_SHOP_A_ID,
  SHOP_B_ID as RP_SHOP_B_ID
} from './routingFixture.js';

// Drop one connector group from a fresh routing bundle by its `name`
// ('esc' | 'lift'), returning the mutated bundle. Removing the group's transition
// AND its member units leaves exactly ONE connector kind between F1 and F2.
function rpBundleWithout(groupName) {
  const bundle = rpMakeRoutingBundle();
  const dropped = bundle.transitions.find((t) => t.name === groupName);
  const droppedUnitIds = new Set(
    (dropped?.members || []).map((m) => m.unit_id)
  );
  bundle.transitions = bundle.transitions.filter((t) => t.name !== groupName);
  bundle.units = bundle.units.filter((u) => !droppedUnitIds.has(u.id));
  return bundle;
}

// Build the routing system over an explicit bundle (mirrors buildRoutingSystem
// but lets each preference test choose which connector groups exist).
async function rpBuildRoutingSystem(rawBundle = rpMakeRoutingBundle()) {
  return buildRoutingSystem(rawBundle);
}

// Apply the step-free preference through the PathFinder's public surface,
// tolerating either a stateful setter (symmetric with setRouteMode) or a
// findPath option. We assert at least ONE mechanism exists so the test fails
// with a clear message rather than silently passing if neither is wired.
function rpSetStepFree(pathFinder, value) {
  if (typeof pathFinder.setStepFree === 'function') {
    pathFinder.setStepFree(value);
    return { mode: 'setter', findPathArgs: [] };
  }
  // Fallback: a per-call option object understood by findPath.
  return { mode: 'option', findPathArgs: [{ stepFree: value }] };
}

// Run findPath honouring whichever step-free mechanism rpSetStepFree selected.
function rpFindPath(pathFinder, startId, endId, stepFreeApply) {
  const extra = stepFreeApply?.findPathArgs ?? [];
  return pathFinder.findPath(startId, endId, ...extra);
}

// The transition step the router chose for a successful cross-floor route.
function rpTransition(result) {
  expect(result.success, result.code || result.error || 'route failed').toBe(true);
  expect(Array.isArray(result.transitions)).toBe(true);
  expect(result.transitions.length).toBe(1);
  return result.transitions[0];
}

// True when a transition step denotes the LIFT (accessible) group — tolerant of
// the 'lift'/'elevator' kind-slug spelling, but it must NOT be the escalator.
function rpIsLift(step) {
  return step.kind !== 'escalator' && (step.kind === 'lift' || step.kind === 'elevator');
}

describe('route-preferences', () => {
  // ===== Criterion 1: escalator is the default cross-floor choice ============
  describe('routeMode escalator (default): escalator group chosen', () => {
    it('cross-floor F1->F2 default route uses the escalator group', async () => {
      const { pathFinder } = await rpBuildRoutingSystem();
      // Default mode is escalator — assert it without setting anything first.
      expect(pathFinder.getRouteMode()).toBe('escalator');

      const result = pathFinder.findPath(RP_SHOP_A_ID, RP_SHOP_B_ID);
      const step = rpTransition(result);
      expect(step.kind).toBe('escalator');
      // The escalator transition lands at the escalator member centroids, not
      // the lift's — proving the escalator group (not the lift) was stitched.
      expect(asXY(step.from).x).toBeCloseTo(RP_ANCHORS.escalatorF1.x, 6);
      expect(asXY(step.from).y).toBeCloseTo(RP_ANCHORS.escalatorF1.y, 6);
      expect(asXY(step.to).x).toBeCloseTo(RP_ANCHORS.escalatorF2.x, 6);
      expect(asXY(step.to).y).toBeCloseTo(RP_ANCHORS.escalatorF2.y, 6);
    });
  });

  // ===== Criterion 2: routeMode 'lift' flips the choice to the lift group ====
  describe("routeMode 'lift': lift group chosen over the cheaper escalator", () => {
    it('lift mode picks the accessible lift group even though escalator is cheaper', async () => {
      const { pathFinder } = await rpBuildRoutingSystem();
      pathFinder.setRouteMode('lift');
      expect(pathFinder.getRouteMode()).toBe('lift');

      const result = pathFinder.findPath(RP_SHOP_A_ID, RP_SHOP_B_ID);
      const step = rpTransition(result);

      // The lift group (accessible) is chosen, NOT the escalator — the soft
      // penalty (escalator cost 2.0+100) makes the lift's cost 2.0 win.
      expect(step.kind).not.toBe('escalator');
      expect(rpIsLift(step), `expected lift group, got kind=${step.kind}`).toBe(true);
      // Lands at the lift member centroids, not the escalator's.
      expect(asXY(step.from).x).toBeCloseTo(RP_ANCHORS.liftF1.x, 6);
      expect(asXY(step.from).y).toBeCloseTo(RP_ANCHORS.liftF1.y, 6);
      expect(asXY(step.to).x).toBeCloseTo(RP_ANCHORS.liftF2.x, 6);
      expect(asXY(step.to).y).toBeCloseTo(RP_ANCHORS.liftF2.y, 6);
    });
  });

  // ===== Criterion 3: soft penalty never filters the only connector =========
  describe('soft penalty fallback: non-preferred connector still routes', () => {
    it('escalator-preferred but only the lift exists -> route succeeds via the lift', async () => {
      // Drop the escalator group: only the (non-preferred under default mode)
      // lift connects F1<->F2.
      const { pathFinder } = await rpBuildRoutingSystem(rpBundleWithout('esc'));
      expect(pathFinder.getRouteMode()).toBe('escalator'); // prefers the absent kind

      const result = pathFinder.findPath(RP_SHOP_A_ID, RP_SHOP_B_ID);
      // A soft penalty must NOT filter the only available connector.
      expect(result.success, result.code || 'route should fall back to the lift').toBe(true);
      const step = rpTransition(result);
      expect(rpIsLift(step), `fell back to a non-escalator connector; got ${step.kind}`).toBe(true);
    });

    it("lift-preferred but only the escalator exists -> route succeeds via the escalator", async () => {
      // Symmetric: drop the lift group, prefer 'lift'; the escalator must serve.
      const { pathFinder } = await rpBuildRoutingSystem(rpBundleWithout('lift'));
      pathFinder.setRouteMode('lift'); // prefers the absent kind

      const result = pathFinder.findPath(RP_SHOP_A_ID, RP_SHOP_B_ID);
      expect(result.success, result.code || 'route should fall back to the escalator').toBe(true);
      const step = rpTransition(result);
      expect(step.kind).toBe('escalator');
    });
  });

  // ===== Criterion 4: step-free hard gate, route exists =====================
  describe('stepFree hard gate (route exists): only the accessible group is used', () => {
    it('stepFree=true takes the accessible lift even when the escalator is cheaper', async () => {
      const { pathFinder } = await rpBuildRoutingSystem();
      // Default route mode prefers the escalator (cheaper) — step-free must
      // override that and pick the accessible connector regardless.
      expect(pathFinder.getRouteMode()).toBe('escalator');
      const sf = rpSetStepFree(pathFinder, true);

      const result = rpFindPath(pathFinder, RP_SHOP_A_ID, RP_SHOP_B_ID, sf);
      const step = rpTransition(result);

      expect(step.is_accessible).toBe(true);
      // And it is concretely the lift group (the only accessible one), not the
      // escalator that the cost would otherwise prefer.
      expect(step.kind).not.toBe('escalator');
      expect(asXY(step.from).x).toBeCloseTo(RP_ANCHORS.liftF1.x, 6);
      expect(asXY(step.to).x).toBeCloseTo(RP_ANCHORS.liftF2.x, 6);
    });
  });

  // ===== Criterion 5: step-free hard gate, no accessible connector ==========
  describe('stepFree hard gate (no route): inaccessible connector is gated out', () => {
    it('stepFree=true with only the inaccessible escalator -> {success:false, NO_PATH}', async () => {
      // Only the escalator (is_accessible:false) connects F1<->F2.
      const { pathFinder } = await rpBuildRoutingSystem(rpBundleWithout('lift'));
      const sf = rpSetStepFree(pathFinder, true);

      const result = rpFindPath(pathFinder, RP_SHOP_A_ID, RP_SHOP_B_ID, sf);
      expect(result.success).toBe(false);
      // The inaccessible connector is gated to Infinity, not used — so the
      // failure is "no path", not a successful escalator route.
      const code = String(result.code || '').toLowerCase().replace(/_/g, '-');
      expect(code, `expected a NO_PATH failure, got code=${result.code}`).toBe('no-path');
      // No connector should have leaked into the result.
      expect(result.transitions).toEqual([]);
    });
  });

  // ===== Criterion 6: changing a preference invalidates the cache ===========
  describe('preference change invalidates the cache: re-findPath is fresh', () => {
    it('routeMode escalator->lift: the second findPath reflects lift, not the stale escalator', async () => {
      const { pathFinder } = await rpBuildRoutingSystem();

      const first = pathFinder.findPath(RP_SHOP_A_ID, RP_SHOP_B_ID);
      expect(rpTransition(first).kind).toBe('escalator');

      pathFinder.setRouteMode('lift');
      const second = pathFinder.findPath(RP_SHOP_A_ID, RP_SHOP_B_ID);
      const step2 = rpTransition(second);
      // If the cache were stale this would still read 'escalator'.
      expect(step2.kind).not.toBe('escalator');
      expect(rpIsLift(step2), `stale cache: expected lift after mode change, got ${step2.kind}`).toBe(true);
    });

    it('stepFree false->true: the second findPath uses the accessible group, not the stale escalator', async () => {
      const { pathFinder } = await rpBuildRoutingSystem();

      const off = rpSetStepFree(pathFinder, false);
      const first = rpFindPath(pathFinder, RP_SHOP_A_ID, RP_SHOP_B_ID, off);
      expect(rpTransition(first).kind).toBe('escalator');

      const on = rpSetStepFree(pathFinder, true);
      const second = rpFindPath(pathFinder, RP_SHOP_A_ID, RP_SHOP_B_ID, on);
      const step2 = rpTransition(second);
      // Stale cache would keep the inaccessible escalator.
      expect(step2.is_accessible).toBe(true);
      expect(step2.kind).not.toBe('escalator');
    });
  });
});
// <<< TARS cap:route-preferences

// >>> TARS cap:unroutable-level-handling
//
// unroutable-level-handling — the TYPED-FAILURE contract of the navmesh router:
// destinations that cannot be routed to return a `{success:false, code}` result
// (never throw), the RouteManager turns any such result into a `route:error`
// bus event WITHOUT taking a route, and the meshless level stays browseable.
//
// The three failure codes are a NEW, distinct vocabulary the criteria pin:
//   * MESHLESS_LEVEL    — the destination resolves to a level with NO navmesh.
//   * UNKNOWN_DESTINATION — the destination id is not in the catalog.
//   * SNAP_FAILED       — the destination's level HAS a mesh, but its unit has
//                         neither a doors_by_unit nor a centroids_by_unit entry,
//                         so there is no snappable navmesh point.
//
// Exercised end-to-end over the SAME synthetic routing fixture (a meshless F0 +
// meshed F1/F2) hydrated through the real BundleLoader -> LocationStore +
// MapGeometryStore.buildNavGraph, plus an opt-in real-SGC smoke (L1 is meshless).
//
// Targets (one per acceptance criterion):
//   1. findPath to a shop on meshless F0 -> {success:false, MESHLESS_LEVEL}, no throw.
//   2. findPath to an unknown id -> {success:false, UNKNOWN_DESTINATION}.
//   3. findPath to a meshed-floor unit with no door/centroid -> {success:false, SNAP_FAILED}.
//   4. RouteManager.navigateTo on a !success result emits route:error {code,error,
//      fromId,toId}, getCurrentRoute() stays null, and no layer receives the path.
//   5. The meshless level stays selectable/browseable after a failed route, with
//      no route geometry leaking onto it.
//   6. smoke (real SGC): a destination on L1 (id 3, no mesh) -> MESHLESS_LEVEL.

import { RouteManager } from '../../src/navigation/RouteManager.js';
import { EventBus } from '../../src/core/EventBus.js';
import {
  makeRoutingBundle as ulhMakeRoutingBundle,
  F0_ID as ULH_F0_ID,
  F1_ID as ULH_F1_ID,
  ANCHORS as ULH_ANCHORS,
  SHOP_A_ID as ULH_SHOP_A_ID
} from './routingFixture.js';

// Failure codes the criteria bind (the contract under test). These are the
// EXPECTED literals — hard-coded here, NOT imported from the implementation, so a
// test cannot pass by mirroring whatever the impl happens to emit.
const ULH_MESHLESS_LEVEL = 'MESHLESS_LEVEL';
const ULH_UNKNOWN_DESTINATION = 'UNKNOWN_DESTINATION';
const ULH_SNAP_FAILED = 'SNAP_FAILED';

// A square GeoJSON polygon centred at (cx,cy) — a placed unit needs real geometry.
function ulhSquare(cx, cy, half = 3) {
  return {
    type: 'Polygon',
    coordinates: [[
      [cx - half, cy - half],
      [cx + half, cy - half],
      [cx + half, cy + half],
      [cx - half, cy + half],
      [cx - half, cy - half]
    ]]
  };
}

// A bundle-shaped shop unit record (active, tenanted), placed on `levelId`.
function ulhShopUnit({ unitId, levelId, layerId, shopId, name, x, y }) {
  return {
    id: unitId,
    level_id: levelId,
    layer_id: layerId,
    kind: 'shop',
    name: '',
    geometry: ulhSquare(x, y),
    display_point: [x, y],
    label_point: [x, y],
    label_rotation: 0,
    position: 0,
    is_active: true,
    hidden: false,
    locked: false,
    opacity: 1.0,
    stroke_color: '',
    stroke_width: null,
    fill_color: '',
    doors: [],
    connector_group_id: null,
    tenancies: [{ shop_id: shopId, name }]
  };
}

function ulhShopRecord(shopId, name, slug) {
  return {
    id: shopId, mall: 700, name, slug, logo: null, description: '', category: 1,
    unit_number: slug, contact_phone: '', contact_email: '', website: '',
    operating_hours: {}, is_active: true
  };
}

// Resolve the synthetic-fixture layer id owning a given level (so the injected
// unit attaches to the same layer the level's other units use).
function ulhLayerIdForLevel(bundle, levelId) {
  return bundle.layers.find((l) => l.level_id === levelId)?.id ?? bundle.layers[0].id;
}

// A routing bundle that additionally places a NEW shop on the MESHLESS level F0.
// F0 is absent from navmesh_by_level, so this shop is on a level with no mesh.
function ulhBundleWithF0Shop() {
  const bundle = ulhMakeRoutingBundle();
  const SHOP_ID = 90;
  bundle.shops.push(ulhShopRecord(SHOP_ID, 'F0 Shop', 'f0-shop'));
  bundle.units.push(ulhShopUnit({
    unitId: 390,
    levelId: ULH_F0_ID,
    layerId: ulhLayerIdForLevel(bundle, ULH_F0_ID),
    shopId: SHOP_ID,
    name: 'F0 Shop',
    x: 5,
    y: 5
  }));
  return { bundle, destinationId: `shop:${SHOP_ID}` };
}

// A routing bundle that places a NEW shop on MESHED F1 but registers NO
// doors_by_unit and NO centroids_by_unit entry for its unit — there is a mesh,
// but nothing to snap the unit to.
function ulhBundleWithUnsnappableF1Shop() {
  const bundle = ulhMakeRoutingBundle();
  const SHOP_ID = 91;
  const UNIT_ID = 391;
  bundle.shops.push(ulhShopRecord(SHOP_ID, 'NoSnap Shop', 'nosnap'));
  bundle.units.push(ulhShopUnit({
    unitId: UNIT_ID,
    levelId: ULH_F1_ID,
    layerId: ulhLayerIdForLevel(bundle, ULH_F1_ID),
    shopId: SHOP_ID,
    name: 'NoSnap Shop',
    // geometry inside the F1 mesh, but deliberately UNLISTED in the mesh indices.
    x: ULH_ANCHORS.shopA_F1.x,
    y: ULH_ANCHORS.shopA_F1.y
  }));
  // Guard the contract precondition: the F1 mesh carries neither a door nor a
  // centroid index for this unit.
  const f1mesh = bundle.navmesh_by_level[ULH_F1_ID];
  expect(f1mesh, 'F1 must be meshed in the fixture').toBeTruthy();
  expect(f1mesh.doors_by_unit?.[UNIT_ID]).toBeUndefined();
  expect(f1mesh.centroids_by_unit?.[UNIT_ID]).toBeUndefined();
  return { bundle, destinationId: `shop:${SHOP_ID}` };
}

// Build the router stack over an explicit bundle (mirrors buildRoutingSystem but
// scoped to this block so it never collides with the other blocks' helpers).
async function ulhBuildRoutingSystem(rawBundle) {
  const PathFinder = await importPathFinder();
  const loader = new BundleLoader({ load: () => Promise.resolve(structuredClone(rawBundle)) });
  const model = await loader.load('/bundle.json');

  const locationStore = new LocationStore();
  locationStore.hydrate(model, { renderScale: 1 });

  const geometryStore = new MapGeometryStore();
  geometryStore.hydrate(model, { renderScale: 1 });

  const navGraph = geometryStore.buildNavGraph(model.transitions);
  const pathFinder = new PathFinder(navGraph, locationStore);
  return { pathFinder, locationStore, geometryStore, model };
}

// A minimal layer spy that records whether the engine/manager ever handed it a
// route. On a failed route NO layer must be populated, so setPath stays uncalled.
function ulhLayerSpy() {
  return {
    paths: [],
    cleared: 0,
    setPath(result) { this.paths.push(result); },
    clearPath() { this.cleared += 1; },
    clear() { this.cleared += 1; },
    setFloor() {}
  };
}

describe('unroutable-level-handling', () => {
  // ===== Criterion 1: destination on the meshless level F0 ===================
  describe('findPath to a meshless-level destination', () => {
    it('returns {success:false, code:MESHLESS_LEVEL} and does not throw', async () => {
      const { bundle, destinationId } = ulhBundleWithF0Shop();
      const { pathFinder, locationStore } = await ulhBuildRoutingSystem(bundle);

      // Precondition: the destination IS in the catalog and IS on F0 (meshless) —
      // so the failure is specifically "meshless level", not "unknown id".
      const dest = locationStore.getLocation(destinationId);
      expect(dest, 'the F0 shop must be a real catalog destination').toBeTruthy();
      expect(dest.levelCodes).toEqual(['F0']);

      let result;
      expect(() => { result = pathFinder.findPath(ULH_SHOP_A_ID, destinationId); }).not.toThrow();
      expect(result.success).toBe(false);
      expect(result.code).toBe(ULH_MESHLESS_LEVEL);
      // A failure carries no route geometry.
      expect(segmentsMap(result).size).toBe(0);
      expect(result.transitions).toEqual([]);
    });
  });

  // ===== Criterion 2: unknown destination id ================================
  describe('findPath to an unknown destination id', () => {
    it('returns {success:false, code:UNKNOWN_DESTINATION}', async () => {
      const { pathFinder, locationStore } = await ulhBuildRoutingSystem(ulhMakeRoutingBundle());

      const unknownId = 'shop:99999';
      // Precondition: this id genuinely is NOT in the catalog.
      expect(locationStore.getLocation(unknownId)).toBeUndefined();

      let result;
      expect(() => { result = pathFinder.findPath(ULH_SHOP_A_ID, unknownId); }).not.toThrow();
      expect(result.success).toBe(false);
      expect(result.code).toBe(ULH_UNKNOWN_DESTINATION);
    });

    it('is distinct from MESHLESS_LEVEL — an unknown id is not a meshless one', async () => {
      const { pathFinder } = await ulhBuildRoutingSystem(ulhMakeRoutingBundle());
      const result = pathFinder.findPath(ULH_SHOP_A_ID, 'shop:99999');
      expect(result.code).not.toBe(ULH_MESHLESS_LEVEL);
      expect(result.code).toBe(ULH_UNKNOWN_DESTINATION);
    });
  });

  // ===== Criterion 3: destination on a meshed floor with no snap point ======
  describe('findPath to a unit with no snappable navmesh point', () => {
    it('returns {success:false, code:SNAP_FAILED} when the unit has no door/centroid entry', async () => {
      const { bundle, destinationId } = ulhBundleWithUnsnappableF1Shop();
      const { pathFinder, locationStore } = await ulhBuildRoutingSystem(bundle);

      // Precondition: the destination IS catalogued and IS on a MESHED floor (F1)
      // — so the failure is specifically "snap failed", not "meshless level".
      const dest = locationStore.getLocation(destinationId);
      expect(dest, 'the no-snap shop must be a real catalog destination').toBeTruthy();
      expect(dest.levelCodes).toEqual(['F1']);

      const result = pathFinder.findPath(ULH_SHOP_A_ID, destinationId);
      expect(result.success).toBe(false);
      expect(result.code).toBe(ULH_SNAP_FAILED);
      // It is NOT mislabelled as meshless (the floor does have a mesh).
      expect(result.code).not.toBe(ULH_MESHLESS_LEVEL);
    });
  });

  // ===== Criterion 4: RouteManager turns !success into route:error ==========
  describe('RouteManager.navigateTo on a failed result', () => {
    it('emits route:error {code,error,fromId,toId}, keeps getCurrentRoute() null, and populates no layer', async () => {
      const { pathFinder } = await ulhBuildRoutingSystem(ulhMakeRoutingBundle());
      const bus = new EventBus();
      const manager = new RouteManager(pathFinder, bus);

      const navLayer = ulhLayerSpy();
      // The manager itself owns route STATE; the layer spy stands in for the
      // engine's nav layers to prove a failed route reaches NO layer.
      const errors = [];
      const founds = [];
      bus.on('route:error', (e) => errors.push(e));
      bus.on('route:found', (e) => founds.push(e));
      // A bus consumer that would forward a successful route to the layer; on a
      // failure it must never fire, so the layer stays empty.
      bus.on('route:found', (e) => navLayer.setPath(e));

      const fromId = ULH_SHOP_A_ID;
      const toId = 'shop:99999'; // unknown -> guaranteed failure
      const result = manager.navigateTo(fromId, toId);

      // The result is a typed failure, not a throw.
      expect(result.success).toBe(false);

      // Exactly one route:error, no route:found.
      expect(errors.length).toBe(1);
      expect(founds.length).toBe(0);

      // The error payload carries the four bound fields with the right values.
      const err = errors[0];
      expect(err.code).toBe(ULH_UNKNOWN_DESTINATION);
      expect(typeof err.error).toBe('string');
      expect(err.error.length).toBeGreaterThan(0);
      expect(err.fromId).toBe(fromId);
      expect(err.toId).toBe(toId);

      // No route is taken, and no layer was populated.
      expect(manager.getCurrentRoute()).toBeNull();
      expect(manager.hasRoute()).toBe(false);
      expect(navLayer.paths).toEqual([]);
    });

    it('also reports MESHLESS_LEVEL through route:error for a meshless destination', async () => {
      const { bundle, destinationId } = ulhBundleWithF0Shop();
      const { pathFinder } = await ulhBuildRoutingSystem(bundle);
      const bus = new EventBus();
      const manager = new RouteManager(pathFinder, bus);

      const errors = [];
      bus.on('route:error', (e) => errors.push(e));

      manager.navigateTo(ULH_SHOP_A_ID, destinationId);

      expect(errors.length).toBe(1);
      expect(errors[0].code).toBe(ULH_MESHLESS_LEVEL);
      expect(errors[0].fromId).toBe(ULH_SHOP_A_ID);
      expect(errors[0].toId).toBe(destinationId);
      expect(manager.getCurrentRoute()).toBeNull();
    });
  });

  // ===== Criterion 5: meshless level stays browseable after a failed route ==
  describe('the meshless level remains selectable after a failed route', () => {
    it('F0 still resolves as a level and no route geometry leaks onto it', async () => {
      const { bundle, destinationId } = ulhBundleWithF0Shop();
      const { pathFinder, geometryStore } = await ulhBuildRoutingSystem(bundle);
      const bus = new EventBus();
      const manager = new RouteManager(pathFinder, bus);

      // The meshless F0 is a real, selectable level BEFORE any routing.
      const f0Before = geometryStore.getLevelByCode('F0');
      expect(f0Before, 'F0 must be a selectable level').toBeTruthy();
      expect(f0Before.code).toBe('F0');

      // A route TO the F0 shop fails (meshless).
      const failed = manager.navigateTo(ULH_SHOP_A_ID, destinationId);
      expect(failed.success).toBe(false);

      // F0 is STILL selectable afterwards (the failed route did not corrupt the
      // geometry store / level set).
      const f0After = geometryStore.getLevelByCode('F0');
      expect(f0After, 'F0 must remain selectable after a failed route').toBeTruthy();
      expect(geometryStore.getFloorCodes()).toContain('F0');

      // No route state leaked: no active route, and no route polyline on F0.
      expect(manager.getCurrentRoute()).toBeNull();
      expect(manager.getPathOnFloor('F0')).toEqual([]);
      expect(manager.getRouteFloors()).toEqual([]);
    });

    it('a successful same-floor route afterwards does not retroactively populate F0', async () => {
      // Prove the failed-route path is inert: after it fails, a normal route on
      // the meshed floor still works and touches only its own floors, never F0.
      const { bundle } = ulhBundleWithF0Shop();
      const { pathFinder } = await ulhBuildRoutingSystem(bundle);
      const bus = new EventBus();
      const manager = new RouteManager(pathFinder, bus);

      manager.navigateTo(ULH_SHOP_A_ID, 'shop:99999'); // fails, no state
      expect(manager.getCurrentRoute()).toBeNull();

      // A real F1 same-floor route now succeeds and is confined to F1.
      const ok = manager.navigateTo(ULH_SHOP_A_ID, 'shop:2');
      expect(ok.success).toBe(true);
      expect(manager.getPathOnFloor('F0')).toEqual([]);
      expect(manager.getRouteFloors()).not.toContain('F0');
    });
  });

  // ===== Criterion 6: opt-in smoke over the real SGC bundle =================
  describe('smoke (real SGC_v001.json): a destination on meshless L1', () => {
    it('routing to shop id 3 placed on L1 (no mesh) -> {success:false, MESHLESS_LEVEL}', async () => {
      // The real seed places shop id 3 (ALDO) nowhere, and L1 (level id 3) is the
      // meshless floor (navmesh_by_level keys are 1,2,4,5). Inject a placement of
      // shop 3 on L1 so the destination resolves to the meshless level, then
      // assert the typed meshless failure.
      const raw = loadSgcRaw();
      const L1_ID = 3;
      raw.units.push({
        id: 990003,
        level_id: L1_ID,
        layer_id: raw.layers.find((l) => l.level_id === L1_ID)?.id ?? raw.layers[0].id,
        kind: 'shop',
        name: '',
        geometry: ulhSquare(5, 5),
        display_point: [5, 5],
        label_point: [5, 5],
        label_rotation: 0,
        position: 0,
        is_active: true,
        hidden: false,
        locked: false,
        opacity: 1.0,
        stroke_color: '',
        stroke_width: null,
        fill_color: '',
        doors: [],
        connector_group_id: null,
        tenancies: [{ shop_id: 3, name: 'ALDO' }]
      });

      const { pathFinder, locationStore } = await ulhBuildRoutingSystem(raw);

      // Precondition: shop:3 is now catalogued on L1, and L1 truly has no mesh.
      const dest = locationStore.getLocation('shop:3');
      expect(dest, 'shop:3 must be catalogued on L1').toBeTruthy();
      expect(dest.levelCodes).toEqual(['L1']);
      expect(raw.navmesh_by_level[L1_ID]).toBeUndefined();
      expect(raw.navmesh_by_level[String(L1_ID)]).toBeUndefined();

      // shop:10 (Starbucks, L3, meshed) -> shop:3 (L1, meshless).
      const result = pathFinder.findPath('shop:10', 'shop:3');
      expect(result.success).toBe(false);
      expect(result.code).toBe(ULH_MESHLESS_LEVEL);
    });
  });
});
// <<< TARS cap:unroutable-level-handling
