# navmesh-routing

## Purpose

Compute the shortest walking route between two destinations over the bundle's
**triangle navmesh** — A* across triangle adjacency, then a true funnel
(string-pull) to a corner-hugging polyline — and stitch cross-floor routes
through the bundle's `transitions`. The result is **per-floor polyline segments**
(never a synthesized `Node[]`), the shape every route layer consumes.

## Behavior

- `buildNavGraph(levels, transitions)` produces one `LevelGraph` **per meshed
  level only** — a meshless level (no navmesh) is absent from `levelGraphs` — plus
  the parsed bidirectional `RouteTransition` groups.
- `triangleAStar(mesh, startTri, endTri)` returns the ordered triangle-index
  sequence connecting two triangles (length ≥ 3 across an L-shaped mesh); two
  disconnected triangles yield `[]`.
- `findNearestTriangle(mesh, x, y)` returns the index of the containing/nearest
  triangle for a point (used to snap a shop/connector centroid onto the mesh).
- `funnelPath(triPath, mesh, start, end)` string-pulls a triangle corridor into
  the shortest polyline: it begins at `start`, ends at `end`, inserts an interior
  **elbow** vertex at a concave corner, and is strictly shorter than a
  centroid-hop through the same triangles. A straight corridor returns exactly
  `[start, end]` (no spurious interior point).
- **Same-floor** `findPath` ⇒ `segments` of size 1 keyed by that floor,
  `transitions: []`. **Cross-floor** ⇒ `segments` of size 2 (one polyline each
  floor), `transitions.length === 1` carrying `from/to` x,y at the connector
  centroids, `fromLevelCode`/`toLevelCode`, `levelCodes`, and a `distance` equal
  to the summed polyline length. **Start == end point** ⇒ a single-point segment
  and `distance === 0`.
- Snap order for a destination: `doors_by_unit[unit][0]` (carries its
  `triangle_index`) first, else `centroids_by_unit[unit]` + a nearest-triangle
  search.
- The router **never throws** — every call returns a typed `RouteResult` with
  `success` (see `unroutable-level-handling` for the failure codes).

## Interfaces & contracts

- `buildNavGraph(levels, transitions, context = {})` → `{ levelGraphs: Map<levelCode, LevelGraph>, transitions: RouteTransition[] }` — meshless levels omitted.
- `class LevelGraph { levelCode, levelId, navmesh }`.
- `class RouteTransition { groupId, kind, direction, cost, isAccessible, members; memberOnLevel(levelCode) }`.
- `triangleAStar(mesh, startTri, endTri)` → `number[]` (triangle indices; `[]` if disconnected).
- `triangleCentroid(mesh, triIndex)` → `{x,y}`; `findNearestTriangle(mesh, x, y)` → `number`.
- `funnelPath(triPath, mesh, start, end)` → `[x,y][]`.
- `class PathFinder` — `constructor(navGraph, …)`, `findPath(startId, endId, options)` → `RouteResult`, `findPathToAnchor(startId, target, options)`, `setRouteMode(mode)`, `setStepFree(bool)`, `clearCache()`.
- `MapGeometryStore.buildNavGraph(transitions = [])` → delegates to the pure `buildNavGraph` over `this.levels` — the single wiring seam, called from `MapEngine.#createNavigationSystem`.

## Data model

- **RouteResult** — `{ success, segments: Map<levelCode,[x,y][]>, transitions: RouteTransitionStep[], distance, startAnchor:{levelCode,x,y}, endAnchor:{levelCode,x,y}, startLocation, endLocation }` (failure shape carries `code` instead — see `unroutable-level-handling`).
- **LevelGraph** — per-meshed-level wrapper over `MapLevel.navmesh` (triangles + adjacency + `doors_by_unit`/`centroids_by_unit`).
- **RouteTransition** — a bundle `transitions[]` group: `kind`, `cost`, `is_accessible`, members keyed by level. Owns no persistence; built per init from the parsed `BundleModel`.

## Decisions & constraints

- **Decision:** true funnel (string-pull) path. Rejected: centroid-hop (zig-zags through triangle centers; not the indoorcms behavior).
- **Decision:** the graph lives **inside `MapGeometryStore`** via the pure `NavGraph` builder — no third store. Rejected: a separate `WayfinderEngine`/store (rewrites proven orchestration; new read sites everywhere).
- **Decision:** route result = per-floor polyline `segments` + `transitions` + anchors. Rejected: synthesize fake `Node[]` (breaks any `node.peers`/`node.id` consumer and the cross-floor split).
- **Invariant:** one fetch per init — the graph is built from the already-parsed `BundleModel` inside `#createNavigationSystem`; no store fetches its own data.
- **Invariant:** the router returns a typed result and never throws; callers branch on `result.success`.
- **Constraint (data):** `PathFinder` does **not** memoise routes — every `findPath` re-plans from scratch, so a flipped `routeMode`/`stepFree` needs no invalidation. `clearCache()` is a retained no-op lifecycle hook (a dead `#cache` field that memoised nothing was removed in review).

## Tests

- `test/navigation/NavmeshRouting.test.js` — `buildNavGraph` meshless-omission + transition parse, `triangleAStar` connected/disconnected, `findNearestTriangle`, `funnelPath` elbow + strictly-shorter + straight-corridor, same-floor / cross-floor / same-point `findPath` shapes.
- `test/navigation/routingFixture.js` — the synthetic mini-bundle (F1 L-shaped mesh, F2 rectangular, meshless F0, escalator+lift groups F1↔F2).
- Opt-in real-`SGC_v001.json` smoke: two L3 shops route single-floor; L2→L3 routes with `transitions[0].kind === 'escalator'` and segments on both floors.
