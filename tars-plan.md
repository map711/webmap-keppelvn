# Plan — Phase 2: Wayfinding (Keppel Webmap / SGC)

## What & why            (PM ↔ client)

- **Intent:** Give a SGC visitor turn-by-nothing **wayfinding**: pick a *from* and a
  *to* destination and see the shortest walking route drawn on the map — across
  floors, hugging corners, with start/end pins and "tap to change floor" bubbles at
  escalator/lift transitions. This is Phase 2 of the epic; Phase 1 (browse/search/
  focus) shipped. The engine routes over the bundle's **triangle navmesh** +
  **cross-floor transitions** (`SGC_v001.json`) — the carried-over node-graph
  routing scaffolding is rebuilt in place to consume that navmesh.
- **Constraints:**
  - **Rebuild in place, no parallel files.** Keep `MapEngine`, the two-store split
    (`LocationStore` + `MapGeometryStore`), `RouteManager`/`PathFinder`, and the
    three route layers; replace their *internals*. No new `Navmesh*Layer`, no third
    store, no `WayfinderEngine`.
  - **Route result = per-floor polyline segments**, never a synthesized `Node[]`
    (the epic explicitly rejected fake nodes). Layers consume segments + anchors +
    transitions.
  - **Sparse real bundle.** Only **L2 (id 4)** and **L3 (id 5)** carry real meshes;
    B2/B1 are stubs; **L1 (id 3) has no navmesh entry at all**. There is exactly
    **one** usable cross-floor connector — the escalator group L2↔L3 (cost 1.0,
    `is_accessible:false`). The only *accessible* transition (the lift group) lands
    on **meshless B1**, so it is non-navigable. ⇒ **preference + step-free semantics
    are proven on the synthetic routing fixture; the real bundle asserts only the
    rules** (an intra-floor L3 route exists; the L2↔L3 escalator route exists; any
    route touching a meshless level is a structured error). [CLAUDE.md rules-vs-
    counts split.]
  - Canvas-2D only, raw CMS coordinates (`renderScale = 1`). Vitest node-env; pure
    ports driven by a synthetic mini-bundle, the 2 MB bundle only in opt-in smoke
    tests. Dev/run on port 5080. Public component/engine API stays intact.
  - **You-are-here as a route start is OUT** (deferred to Phase 3 `kiosk-here`).
    Phase 2 routing is **destination → destination** only.
- **Decisions:**
  - **True funnel (string-pull) path** — A* over triangles then funnel to the
    shortest corner-hugging polyline. *Rejected:* centroid-hop (zig-zags through
    triangle centers; not the indoorcms behavior).
  - **All six capabilities this cycle** (core + ui) in one plan → run → cleanup.
  - **Animated walk** for the drawn route (grey full path + animated black
    progress), rebuilt over segments. *Rejected:* static-only polyline.
  - **Soft connector preference, hard step-free gate** (inherited from the epic):
    preferred connector kind ⇒ `transition.cost`; non-preferred ⇒ `cost + 100` (a
    route still exists when only the non-preferred connector is available);
    step-free ⇒ only `is_accessible` transitions, else a structured error.
  - **Connector kind from the member unit's `kind` slug** (escalator/elevator/
    stairs), not from `cost`. `is_accessible` comes from the transition. *Rejected:*
    inferring kind from `cost` magic numbers (fragile).

## How                   (tech lead — grounded in the codebase)

- **Module map:**
  - **New pure ports** in `src/navigation/`: `NavGraph.js` (build the routing graph
    from `MapLevel.navmesh` + bundle `transitions[]`), `TriangleAStar.js` (triangle-
    adjacency A* + `findNearestTriangle`), `FunnelPath.js` (string-pull a triangle
    path → `[x,y][]`). `MinHeap.js` is reused as-is.
  - **Rebuilt in place:** `src/navigation/PathFinder.js` (triangle A* + funnel +
    cross-floor + preference/step-free → `RouteResult`), `RouteManager.js` (thin
    state + events over the new result), the three layers `src/layers/
    NavigationLayer.js` / `NavMarkerLayer.js` / `PinMarkerLayer.js` (consume
    segments / transitions / anchors).
  - **Touched seams:** `src/data/MapGeometryModel.js` (`MapGeometryStore.buildNavGraph`
    pass-through; `MapLevel.navmesh` is already hydrated), `src/core/MapEngine.js`
    (`#bundleModel` field + rebuild `#createNavigationSystem`; `navigateTo` reads
    `startAnchor` instead of `startNode.point`), `src/component/WayfinderMap.js`
    (wire the already-scaffolded from/to + connector-toggle nav UI to `navigateTo`;
    re-emit `route:error`).
- **Patterns:**
  - **One-fetch hydration** — the graph is built from the already-parsed
    `BundleModel` inside `#createNavigationSystem`; no store fetches its own data
    (`MapEngine.#loadData`).
  - **Layer contract** — `renderWithContext` / `setFloor(levelCode)` / `hitTest` /
    `dispose`; the engine drives the active floor via `setFloor` on all layers.
  - **Bus → DOM re-emit** — `route:found`→`route-found`, `route:cleared`→
    `route-cleared` already exist; add `route:error`→`route-error`
    (`WayfinderMap.#wireEvents`).
  - **Typed result, no throw** — `findPath` always returns `RouteResult`; callers
    branch on `result.success`; failures carry a `code` enum.
- **Integration seams:**
  - `MapEngine.#createNavigationSystem` is the **only** wiring point that changes:
    build `navGraph = mapGeometryStore.buildNavGraph(bundleModel.transitions)`, pass
    it (+ `locationStore` for id→unit→snap resolution) to `PathFinder`.
  - The floor-transition tap already routes through `NavMarkerLayer.hitTest →
    tap:floor-transition → setFloor` (`MapEngine` interaction wiring) — preserved.
  - `navigateTo` / `clearRoute` / `setFloor` / `centerOn` / `focusLocation` external
    behavior unchanged; only `navigateTo`'s post-success anchor reads change.
- **Reuse:** `MinHeap`; the RAF animation skeleton in `NavigationLayer`; the bubble
  draw + screen-space hit-test in `NavMarkerLayer`; the speech-bubble pin draw +
  `#resolveNode` dual-path in `PinMarkerLayer`; the scaffolded nav UI in
  `WayfinderMap` (from/to fields, lift/escalator/step-free toggles, summary panel);
  `MapLevel.navmesh` (already stored), `BundleModel.transitions` (already parsed).
- **Cross-cutting tech-stack decisions:** inherited verbatim from `tars-epic.md`
  (renderer strategy, engine, data contract, destination identity, route result
  shape, coordinate space, route preferences, floor hit-testing, meshless level,
  testing, dev/run). This phase opens no new cross-cutting question, so **no design
  panel was re-run** — the epic-scope panel already resolved the *How*; a single
  grounded `code-architect` pass produced this synthesis.

<!-- Decision log: no per-phase panel (epic settled the How). Sub-decisions resolved
in the architect pass: (a) graph lives inside MapGeometryStore via a pure NavGraph
builder, not a third store; (b) connector kind from member unit kind slug, not cost;
(c) snap order = doors_by_unit[unit][0] (carries triangle_index) then
centroids_by_unit[unit] + nearest-triangle search; (d) you-are-here start deferred
to P3. -->

## Capability breakdown

- [x] `navmesh-routing` — triangle-A* + funnel over `navmesh_by_level`, cross-floor
  via `transitions`, emitting per-floor polyline segments. · depends on: Phase-1
  `destination-catalog`, `floor-rendering` (shipped)
- [x] `route-preferences` — escalator/lift soft penalty (`cost` vs `cost + 100`) +
  step-free hard gate (`is_accessible` only, else structured error). · depends on:
  `navmesh-routing`
- [x] `unroutable-level-handling` — meshless L1 / no-path / unknown-destination
  return typed `{success:false, code}` results without throwing; the floor stays
  browseable. · depends on: `navmesh-routing`
- [x] `route-rendering` `(ui)` — animated route polyline per active floor; re-slices
  on floor switch. · depends on: `navmesh-routing`, Phase-1 `floor-switching`
- [x] `route-markers` `(ui)` — start/end pins at the snapped anchors + floor-
  transition bubbles ("↑ tap to L3") that switch floor on tap. · depends on:
  `route-rendering`
- [x] `search-to-route` `(ui)` — the built-in from/to search + connector toggles
  drive `navigateTo`; route/error feedback in the summary panel. · depends on:
  `route-markers`, Phase-1 `destination-search`

## How to test           (the binding acceptance criteria)

<!-- Pure-port criteria run on the synthetic routing fixture (test/navigation/
routingFixture.js): two MESHFUL levels F1 (L-shaped multi-triangle mesh where
straight-line ≠ shortest) + F2 (rectangular), one MESHLESS level F0, and TWO
connector groups between F1↔F2 — escalator (is_accessible:false, cost 1.0) and lift
(is_accessible:true, cost 2.0). Counts deliberately differ from SGC. Real-bundle
smoke tests are opt-in (skipped by default) and assert rules only. -->

### `navmesh-routing`
- `NavGraph.buildNavGraph(levels, transitions)` over the fixture yields
  `levelGraphs` keyed `{F1, F2}` only — the **meshless F0 is absent**; and
  `transitions` parsed to **2** bidirectional `RouteTransition` groups.
- `triangleAStar(F1mesh, startTri, endTri)` on the L-shaped mesh returns the ordered
  triangle-index sequence connecting them (length ≥ 3); on two **disconnected**
  triangles it returns `[]`.
- `findNearestTriangle(mesh, x, y)` returns the index of the triangle whose region
  contains/﻿is-closest-to `(x,y)` (asserted for a shop centroid and a connector
  centroid).
- `funnelPath([0,1,2,3], F1mesh, start, end)` on the L-shape returns a polyline that
  (a) begins at `start` and ends at `end`, (b) includes an **interior elbow vertex**
  near the concave corner, and (c) is **strictly shorter** than a centroid-hop path
  through the same triangles.
- A straight corridor (`funnelPath([0,1], mesh, a, b)`) returns exactly `[a, b]` (no
  spurious interior point).
- `PathFinder.findPath('shop:A', 'shop:B')` for two shops on the **same** floor
  returns `{success:true}` with `segments` a `Map` of size 1 keyed by that floor,
  `transitions: []`, and `startAnchor`/`endAnchor` carrying `{levelCode,x,y}`.
- A **cross-floor** `findPath('shop:A'(F1), 'shop:B'(F2))` returns `segments` of size
  2 (`F1` and `F2` entries, each a non-empty `[x,y][]`), `transitions.length === 1`
  with `fromLevelCode:'F1'`/`toLevelCode:'F2'` and `from/to` x,y at the connector
  centroids, `levelCodes: ['F1','F2']`, and `distance` = the summed polyline length.
- Same start==end point ⇒ `{success:true}` with a single-point segment and
  `distance === 0`.
- **Smoke (opt-in, real `SGC_v001.json`):** two shops on **L3** route with
  `success:true` and a single-floor segment; a shop on **L2** to a shop on **L3**
  routes with `success:true`, `transitions[0].kind === 'escalator'`, and segments on
  both floors.

### `route-preferences`
- With `routeMode='escalator'` (default), the cross-floor F1→F2 route picks the
  **escalator** group: `transitions[0].kind === 'escalator'`.
- With `routeMode='lift'`, the same route picks the **lift** group:
  `transitions[0].kind === 'lift'` (lift `cost 2.0` beats escalator `cost 2.0+100`).
- **Soft penalty fallback:** when only the **non-preferred** connector exists between
  the two floors (drop the preferred group from the fixture), the route **still
  succeeds** using the available connector — it is not filtered out.
- **Step-free hard gate, route exists:** with `stepFree=true`, the cross-floor route
  uses **only the `is_accessible` (lift) group**: `transitions[0].is_accessible ===
  true`, even when the escalator is cheaper.
- **Step-free hard gate, no route:** with `stepFree=true` and **no accessible**
  connector between the floors, `findPath` returns `{success:false,
  code:'NO_PATH'}` (the inaccessible connector is gated to `Infinity`, not used).
- Changing `routeMode` or `stepFree` **invalidates the cache** (a re-`findPath`
  returns a result consistent with the new mode, not the stale one).

### `unroutable-level-handling`
- `findPath` to a destination on the **meshless** level F0 returns
  `{success:false, code:'MESHLESS_LEVEL'}` — and does **not** throw.
- `findPath` for an **unknown** destination id returns `{success:false,
  code:'UNKNOWN_DESTINATION'}`.
- A destination that resolves to a unit with **no snappable navmesh point** (no
  `doors_by_unit` entry and no `centroids_by_unit` entry) returns `{success:false,
  code:'SNAP_FAILED'}`.
- `RouteManager.navigateTo` on any `!success` result **emits `route:error`** with
  `{code, error, fromId, toId}` and leaves `getCurrentRoute()` `null`; no layer is
  populated.
- The meshless level **remains selectable/browseable**: `setFloor(F0)` after a
  failed route succeeds and the floor renders (no route state leaks onto it).
- **Smoke (opt-in, real bundle):** a destination on **L1** (id 3, no mesh) ⇒
  `{success:false, code:'MESHLESS_LEVEL'}`.

### `route-rendering` `(ui)`
- `NavigationLayer.setPath(routeResult)` for a 2-floor route ⇒ `hasPath()` is `true`;
  with floor `F1` active the layer's filtered points equal `segments.get('F1')`,
  and after `setFloor('F2')` they equal `segments.get('F2')`.
- `setFloor` to a floor **not** in `segments` (e.g. F0) ⇒ `hasPath()` is `false` and
  the layer draws nothing (no throw).
- `setPath` **starts** the animation (`getAnimationStatus().isAnimating === true`)
  and `clearPath()` **stops** it and drops the stored result.
- `renderWithContext` draws **two strokes** (full grey path + partial animated path)
  using `segment[i][0]/[1]` coordinates — asserted via a mock 2D context recording
  `moveTo`/`lineTo` calls over the active floor's points.
- After `engine.navigateTo` success, the engine `setFloor`s to `startAnchor.levelCode`
  and `centerOn`s `(startAnchor.x, startAnchor.y)` (reusing the focus camera path).

### `route-markers` `(ui)`
- `PinMarkerLayer.setPath(routeResult)` renders the **start** pin at
  `startAnchor.(x,y)` only when `startAnchor.levelCode` is the active floor, and the
  **end** pin at `endAnchor.(x,y)` only when `endAnchor.levelCode` is active (asserted
  by switching floors against a mock context).
- `NavMarkerLayer.setPath` stores `routeResult.transitions`; with the **departure**
  floor active it draws a bubble at `(transition.fromX, fromY)` with an **up/down
  arrow** derived from level ordinals; with the **arrival** floor active it draws at
  `(transition.toX, toY)`.
- `NavMarkerLayer.hitTest(worldX, worldY)` over a rendered bubble returns the **target
  level code** to switch to (departure bubble → `toLevelCode`); a miss returns
  `null`.
- `clearRoute()` clears all three layers (no start/end pin, no bubble, no polyline
  on any floor).

### `search-to-route` `(ui)`
- With both `from` and `to` chosen, triggering navigation calls
  `engine.navigateTo(fromId, toId, …)` with the string-namespaced ids and, on
  success, sets map mode to `navigation` and populates the summary panel with the
  resolved **from/to titles**.
- The **lift** / **escalator** toggle sets the route mode and **re-routes** (a
  subsequent `route-found` reflects the chosen connector kind); the **step-free**
  toggle sets `stepFree` and re-routes.
- A failed route (e.g. meshless destination) surfaces the **error** in the UI (a
  `route-error` DOM event is dispatched and the summary shows the error, no polyline
  drawn).
- `clearRoute` from the UI returns the component to **browse** mode (nav summary
  hidden, route layers cleared).
- `element.navigateTo({from, to})` (public API) returns the `RouteResult` and drives
  the same rendering as the built-in UI.

## Design intent         (UI-facing `(ui)` capabilities only — guidance, not a gate)

### `route-rendering`
- **Layout & hierarchy:** the route is the hero once active — a calm, confident
  polyline tracing the walkable path on the current floor; the rest of the floor
  recedes (matches focus-mode dimming). Empty state = no route (browse). Error state
  = no polyline drawn, message in the summary panel.
- **Interaction:** animated "walk" along the path (grey full path underneath, a
  darker progress stroke advancing start→end, looping) to imply direction of travel;
  redraws smoothly on floor switch to the per-floor slice.
- **Responsive:** path stroke width / pin size scale sensibly at DPR>1 and across
  desktop/mobile; the auto-fit framing keeps the active floor's route in view.
- **Accessibility:** the canvas is decorative — the searchable catalog + the textual
  from/to summary are the accessible path; route availability is announced via the
  `route-found`/`route-error` DOM events.
- **Reference:** the sunwaymalls shell's animated route look; reuse the existing RAF
  skeleton and stroke styling.

### `route-markers`
- **Layout & hierarchy:** speech-bubble pins — a "start" pin at the origin and an
  "end" pin at the destination, each only on its own floor; floor-transition bubbles
  ("↑ Tap to L3") sit on the connector, clearly tappable.
- **Interaction:** tapping a transition bubble switches to the connected floor and
  re-centers on the arrival side; pins use the same speech-bubble idiom as Phase-1
  focus.
- **Responsive:** bubbles and arrows scale with DPR and shrink-to-fit on mobile;
  remain legible over the floor fill.
- **Accessibility:** transition affordance is mirrored by the existing
  `tap:floor-transition` → `floor-transition-tap` DOM event; arrow direction encodes
  up/down by level ordinal.
- **Reference:** Phase-1 `destination-focus` end pin; the carried-over bubble
  drawing in `NavMarkerLayer`.

### `search-to-route`
- **Layout & hierarchy:** reuse the Phase-1 search panel; a from/to pair with a clear
  "swap"/direction affordance, connector toggles (escalator / lift / step-free), and
  a bottom **summary panel** showing from → to (+ error state inline). Desktop =
  top-left panel; mobile (≤768px) = fullscreen overlay + bottom summary card.
- **Interaction:** choosing a destination as *to* (e.g. from a search result or
  polygon tap) and a *from* triggers routing; toggles re-route live; a back/clear
  control returns to browse.
- **Responsive:** 768px breakpoint (inherited); the summary panel is a bottom card on
  mobile, inline on desktop.
- **Accessibility:** labelled from/to inputs, keyboard-navigable results, Esc clears;
  ARIA-labelled connector toggles with visible focus; error text is readable, not
  color-only.
- **Reference:** Phase-1 `destination-search` panel + info card; the scaffolded nav
  UI fields/toggles already present in `WayfinderMap`.
