# Overview — Keppel Webmap (Saigon Centre wayfinder)

---

# Product

## Product intent

A standalone, browser-first indoor wayfinding map for **Saigon Centre (SGC)** — a
Keppel mall — shipped as a `<wayfinder-map>` Web Component. The product *shell*
(a polished Canvas-2D component + UI + build) provides the rendering and UI
scaffolding, but its data/render guts are replaced with logic ported from
the `indoorcms-keppelvn` CMS so the engine can consume the CMS's published data
(GeoJSON-polygon units in raw coordinates + a navmesh + cross-floor transitions).
The CMS now publishes that data **split into two gzipped remote halves** — a
`maps_…` (geometry/navmesh) file and a `datas_…` (shop directory) file — which the
webmap fetches in parallel and merges; the CMS is the *producer*, this webmap the
*consumer*, and they meet only at that split bundle. **Phases 1–2 are shipped:** a visitor can browse SGC's 5
floors, read shop labels, switch floors, search shops/facilities, focus a shop by
search or polygon tap (Phase 1), **and route destination → destination over the
navmesh** — shortest funnel path, cross-floor, with escalator/lift preference,
step-free gating, animated polyline, start/end pins, and tap-to-switch floor
bubbles (Phase 2). Kiosk/share is Phase 3.

## Capabilities

| Capability | Does | Record |
|------------|------|--------|
| `map-bootstrap` | Fork the shell; parallel `maps-url`+`datas-url` fetch → per-half validate → merge into the unchanged `BundleModel`; engine init; build/test + ownership-aware dev harness on :5010 + gallery build/deploy | `capabilities/map-bootstrap.md` |
| `data-pull-script` | `npm run data:pull` mirrors the CMS's split `maps_*.gz`+`datas_*.gz` halves into a gitignored local `datas/` (zero-dep, env-overridable, all-or-nothing writes) | `capabilities/data-pull-script.md` |
| `destination-catalog` | `LocationStore` builds the placed-shop + facility destination catalog (multi-tenant/multi-unit aware; one-to-many `unitId→Location`) | `capabilities/destination-catalog.md` |
| `floor-rendering` `(ui)` | Unit-aware `FloorLayer`: per-unit polygons, `unit→layer→kind` style cascade, `getBounds()` fallback, `hitTest→unitId` | `capabilities/floor-rendering.md` |
| `map-labels` `(ui)` | `LocationLayer` draws labelable-unit labels at `label_point`/`label_rotation`, zoom-responsive screen-space font (`max(minFontSize·dpr, fontSize·√scale·dpr)`) + cached overlap suppression with zoom-freeze/idle-recompute | `capabilities/map-labels.md` |
| `floor-switching` `(ui)` | Level selector + `setFloor` swap geometry+labels and refit; `floor:changed` event; empty L1 + sparse B2/B1 | `capabilities/floor-switching.md` |
| `destination-search` `(ui)` | Built-in search filters the catalog by title/tokens; results dropdown + info card | `capabilities/destination-search.md` |
| `destination-focus` `(ui)` | `focusLocation` / polygon tap: switch floor + zoom + end pin; multi-tenant disambiguation; clear → browse | `capabilities/destination-focus.md` |
| `navmesh-routing` | Triangle-A* + funnel string-pull over `navmesh_by_level`, cross-floor via `transitions`; per-floor polyline `segments` (no fake `Node[]`) | `capabilities/navmesh-routing.md` |
| `route-preferences` | Escalator/lift **soft** cost penalty (`cost` vs `cost+100`) + step-free **hard** gate + per-call hard `connectorConstraint`; no memoisation (each `findPath` re-plans) | `capabilities/route-preferences.md` |
| `unroutable-level-handling` | Meshless/unknown/un-snappable/no-path return typed `{success:false, code}` without throwing; `route:error`; floor stays browseable | `capabilities/unroutable-level-handling.md` |
| `route-rendering` `(ui)` | `NavigationLayer` animated per-floor polyline (grey full + black progress); re-slices on floor switch; engine frames start anchor | `capabilities/route-rendering.md` |
| `route-markers` `(ui)` | `PinMarkerLayer` start/end pins + `NavMarkerLayer` floor-transition bubbles ("↑ Tap to L3") with `hitTest→levelCode` | `capabilities/route-markers.md` |
| `search-to-route` `(ui)` | From/to search + connector toggles drive `navigateTo`; route/error in summary panel; public `element.navigateTo({from,to})` | `capabilities/search-to-route.md` |

## Constraints

- **Sparse seed, and fixture ≠ live bundle.** The live data (now the split
  `maps_`/`datas_` halves mirrored via `npm run data:pull`) places **6 of 20 shops
  across L2+L3**; **B2/B1/L1 are all unit-less and meshless** (units + navmesh live
  only on L2/L3). The pinned **test fixture** (`test/fixtures/SGC_v001.json`, the
  merged single-bundle shape, sliced into `{maps, datas}` by a test helper) is the
  older Phase-1 snapshot — **5 placed, all on L3**, with B2/B1 carrying 1 unit +
  mesh and only L1 empty — and the suite asserts against the **fixture**. Either
  way a meshless/empty level must stay selectable, browseable, and frame without
  error. Real-bundle criteria assert data-driven **rules**, never seed
  magic-numbers.
- Canvas-2D only — no Konva. Two required URLs (`maps-url` + `datas-url`); the
  merge is the firewall, so everything downstream of `BundleModel` is unchanged.
  Raw CMS coordinates, `renderScale = 1`.
- Public component/engine API + built-in UI from the shell stay intact so Phase
  2/3 features drop in.
- Dev server + local run on **port 5010**.

## Decisions

- **Reuse-first port** — keep the Canvas-2D renderer + component
  shell, replace store/layer internals in place; rejected a Konva swap and a new
  `WayfinderEngine.js` (both re-plumb proven, working code).
- **Split remote bundle** — two required URLs (`maps-url` geometry + `datas-url`
  directory) fetched in parallel and merged behind the `BundleModel` firewall;
  *revises* the earlier single-`data-url` decision (the producer re-split its
  publish). Rejected: base+code+version derivation; a single-bundle fallback path.
- **Placed-shops-only catalog** — a shop with no tenancy yields no Location;
  rejected one Location per `shops[]` entry.
- **String-namespaced ids** `shop:<id>` / `unit:<id>`; rejected numeric `+1e6`
  facility offsets (fragile collisions).
- **Meshless L1 stays visible** — browse/search work; only routing to/from it is
  a Phase-2 structured error; rejected hiding L1.

## Known-incomplete / carried forward

- Phase 1 shipped **7/7 green**; Phase 2 shipped **6/6 green, 0 blocked**.
- **Live-browser smoke owed for the 3 Phase-2 `(ui)` capabilities** (`route-
  rendering`, `route-markers`, `search-to-route`): chrome-devtools-mcp was locked
  during the run, so each was QA'd **code-only** against the real layer + engine
  stack. Run `/tars:review --ui` once the browser tool is free.
- **Phase 3 (Kiosk & share)** not started — `kiosk-here`, `deep-link-state`,
  `qr-share`, `brand-theming`. **You-are-here as a route start** is deferred here
  (Phase-2 routing is destination → destination only).

---

# System

## Module map

| Directory | Responsibility | Key entry point |
|-----------|----------------|-----------------|
| `src/data/` | Bundle load + index; destination catalog; geometry store; style cascade | `BundleLoader.js`, `LocationModel.js`, `MapGeometryModel.js`, `StyleResolver.js` |
| `src/core/` | Engine orchestration (init/dispose/floor/focus), config, event bus | `MapEngine.js` |
| `src/layers/` | Canvas layers: floor polygons, labels, route polyline, pins, transition bubbles | `FloorLayer.js`, `LocationLayer.js`, `NavigationLayer.js`, `PinMarkerLayer.js`, `NavMarkerLayer.js` |
| `src/renderer/` | Render loop, transform pipeline, layer stack, rbush overlap | `Renderer.js`, `RectVisibility.js` |
| `src/interaction/` | Gesture recognition + hit-test classification | `HitTestManager.js` |
| `src/component/` | `<wayfinder-map>` Web Component + built-in UI controls | `WayfinderMap.js` |
| `src/navigation/` | Navmesh routing: triangle-A*, funnel string-pull, graph builder, route planner + state | `NavGraph.js`, `TriangleAStar.js`, `FunnelPath.js`, `PathFinder.js`, `RouteManager.js` |
| `test/` | Vitest node-env suite + `fixtures/SGC_v001.json` real bundle | per-capability `*.test.js` |
| `demo/` | Static showcase pages for the Phase-1 browse capabilities (bare / default-controls / javascript-api / level-selector-only / `focus-shop-id` / theme) + per-demo guide | `index.html` |
| `.dev/` | Zero-dep ownership-aware dev-server harness (human vs agent owner, live-reload, `$PORT`/config) | `server.mjs`, `ensure.mjs`, `stop.mjs` |
| `scripts/` | One-shot build (Rollup + stage gallery into `dist/<BUILD_SECRET>/`), deploy (`aws s3 sync` → DigitalOcean Spaces, `--delete`-free for `datas/`), and `data:pull` (mirror the split `.gz` halves locally) | `build.js`, `deploy.js`, `pull-data.js` |

## Key patterns

### Indexed model → store hydrate (no per-store fetch)
- **Where used:** `MapEngine.#loadData` → `BundleLoader.load({mapsUrl, datasUrl})`
  → both stores `.hydrate(model)`.
- **Example:** the engine owns the data load — two parallel fetches of the split
  halves, merged into one `BundleModel`; `LocationStore` and `MapGeometryStore`
  hydrate from that already-parsed model.
- **When to use:** any new store/consumer of bundle data — hydrate from the
  indexed model, never fetch independently (a per-store fetch was the
  double-fetch / `floorCount===0` green-but-wrong).

### Split-then-merge behind the model firewall
- **Where used:** `BundleLoader.#loadSplit` validates the `maps_` + `datas_`
  halves against their own key-sets and merges only the consumed keys into one
  object before `new BundleModel(merged)`.
- **Example:** geometry+`mall` from maps, `shops`/`categories` from datas, extras
  ignored; the merged shape equals the old single bundle so nothing downstream
  observes the split.
- **When to use:** when a producer re-splits/re-shapes its publish — absorb it in
  the loader's validate+merge so `BundleModel` and everything past it stays put.

### Inherit-cascade resolution
- **Where used:** `StyleResolver.resolveStyle` (`unit → layer → kind → default`).
- **Example:** `""`/`null` = inherit; first concrete value wins; hard defaults
  `#000`/`#ccc`/`1`.
- **When to use:** any unit-level visual property that can be authored at multiple
  levels of the bundle hierarchy.

### Pre-resolved label placement
- **Where used:** `LocationModel`'s `DisplayNode` (anchor=`label_point`,
  rotation=`label_rotation` deg→rad at build) consumed by `LocationLayer`.
- **Example:** the layer draws at the pre-resolved anchor/angle (with a `+π`
  upright flip) at a zoom-responsive screen-space font; no polylabel/OBB recompute
  and no unit-shrink.
- **When to use:** trust the CMS's authored placement; don't re-derive geometry.

### Bus event → DOM event re-emit
- **Where used:** `WayfinderMap.#wireEvents` maps `floor:changed`→`floor-changed`,
  `data:loaded`→`data-loaded`, `tap:location`→`location-tap`,
  `tap:disambiguate`→`location-disambiguate`, and the route events
  `route:found`→`route-found`, `route:cleared`→`route-cleared`,
  `route:error`→`route-error`.
- **When to use:** exposing any new engine event to host-page listeners.

### Typed route result (segments, never `Node[]`)
- **Where used:** `PathFinder.findPath` → `RouteResult` consumed by
  `NavigationLayer` / `PinMarkerLayer` / `NavMarkerLayer` and `RouteManager`.
- **Example:** `{ success, segments: Map<levelCode,[x,y][]>, transitions[],
  distance, startAnchor, endAnchor, startLocation, endLocation }`; a failure
  carries `code` instead. The router **never throws** — callers branch on
  `success`.
- **When to use:** any route consumer — read per-floor `segments`/`anchors`/
  `transitions`; never synthesize a node graph from the polyline.

## Reusable utilities

| Utility | Location | Purpose |
|---------|----------|---------|
| `resolveStyle(unit, layersById, kindsBySlug)` | `src/data/StyleResolver.js` | unit→layer→kind style cascade |
| `geometryToPoints(geometry)` | `src/data/MapGeometryModel.js` | GeoJSON ring → `Point[]` (drop closing vertex) |
| `_fitScale(...)` | `src/layers/labelFit.js` | shrink-to-fit scalar, clamped at 1 (pure util; **no longer used by `LocationLayer`** after the label re-work) |
| `computeVisibleRects(rects)` | `src/renderer/RectVisibility.js` | rbush screen-rect overlap suppression |
| `buildNavGraph(levels, transitions)` | `src/navigation/NavGraph.js` | per-meshed-level graph + parsed `RouteTransition[]` (meshless omitted) |
| `triangleAStar` / `findNearestTriangle` | `src/navigation/TriangleAStar.js` | triangle-adjacency A* + point→triangle snap |
| `funnelPath(triPath, mesh, start, end)` | `src/navigation/FunnelPath.js` | string-pull a triangle corridor → shortest `[x,y][]` |
| `sortFloorCodesByPosition(codes, levels)` | `src/component/controls/levelOrder.js` | order floors by `Level.position` |

## Integration seams

1. **Adding a new bundle-derived store:** hydrate from the indexed `BundleModel`
   in `MapEngine.#loadData` (don't fetch); preserve a public seam like the
   `LocationStore`/`MapGeometryStore` arrays/maps.
2. **Adding a new layer:** extend `layers/Layer.js` (`renderWithContext`/
   `setFloor`/`hitTest`/`dispose`), register it in the engine's `#createLayers`,
   and drive its active level via `setFloor`.
3. **Adding a tap behavior:** `FloorLayer.hitTest` returns a `unitId`;
   `HitTestManager.#classifyHit` maps it via `getLocationsByUnitId` to
   `tap:location` / `tap:disambiguate` / `tap:floor`.
4. **Exposing an engine event to the host page:** add a bus→DOM entry in
   `WayfinderMap.#wireEvents`.
5. **Building the routing graph:** `MapEngine.#createNavigationSystem` is the
   **only** wiring point — `navGraph = mapGeometryStore.buildNavGraph(bundleModel.
   transitions)`, passed (+ `locationStore` for id→unit→snap) to `PathFinder`.
   Built from the already-parsed `BundleModel` (one fetch); no new store.

## Tech-stack decisions

(Inherited from `tars-epic.md`'s cross-cutting decisions.)

- **Canvas-2D renderer + component shell** — rejected Konva swap.
- **Split remote bundle, two URLs** (`maps-url` + `datas-url`, gzipped, parallel
  fetch + merge behind `BundleModel`) — revises the earlier single-`data-url`
  decision; rejected base+code derivation and a single-bundle fallback path.
- **Raw CMS coords, `renderScale = 1`** — rejected 0–1 normalization (FP drift,
  ambiguous for meshless L1).
- **String-namespaced ids** `shop:<id>` / `unit:<id>` — rejected numeric offsets.
- **Unit-aware floor hit-test** (per-unit polygons retain `unitId`) — rejected
  style-grouped meshes.
- **Route result = per-floor polyline `segments` + `transitions` + anchors** —
  rejected synthesizing fake `Node[]` (breaks consumers + the cross-floor split).
- **True funnel (string-pull) path** over triangle-A* — rejected centroid-hop
  (zig-zags; not the indoorcms behavior).
- **Soft connector penalty + hard step-free gate** — rejected hard-filter by kind
  (returns *no route* on a single-connector floor).
- **Build:** Rollup → ESM/UMD/min, then `scripts/build.js` stages the demo
  gallery into `dist/<BUILD_SECRET>/`. **Deploy:** `scripts/deploy.js` →
  DigitalOcean Spaces (`.env`-driven); syncs the local `datas/` mirror's `.gz`
  halves **without `--delete`** and aborts on an empty mirror. **Data:**
  `npm run data:pull` mirrors the split halves locally (gitignored). **Test:**
  Vitest node-env, pure ports
  driven by a synthetic mini-bundle; the real 2 MB bundle only in opt-in smoke
  tests; the suite binds no port. **Dev/run:** ownership-aware `.dev/` harness on
  port 5010 (`$PORT`-overridable) — won't kill a human's `npm run dev`.

## UI/UX patterns

### Design system & tokens
- **Stack:** vanilla Web Component (`<wayfinder-map>`) over a Canvas-2D render
  stack; built-in search + level-selector controls; SVG
  icon set under `src/assets/`.
- **Visual reference:** render SGC's real geometry with indoorcms fidelity — clean,
  calm indoor-mall map; the floor geometry is the hero, chrome minimal.
- **Colors:** unit fills come from the `unit→layer→kind` style cascade (per-kind
  fill, subtle strokes); label background is a light translucent halo for
  contrast.

### Layout & navigation
- **App shell:** full-viewport canvas; floorplan auto-fits on load (`min-zoom:
  fit`). Vertical floor-button stack (highest on top). Desktop = top-left search
  panel; mobile (≤768px) = fullscreen search overlay.
- **Focus mode:** the focused destination centers + zooms with a single
  speech-bubble end pin; the rest of the floor recedes.

### State & feedback patterns
- **Empty/edge:** empty sub-levels (B2/B1/L1 in the live bundle; L1 in the
  fixture) still frame via the `getBounds()` fallback; search empty state shows
  "no matches"; load is instant (in-memory catalog index).

### Responsive & accessibility baseline
- **Breakpoint:** 768px (desktop panel vs mobile fullscreen). Device mode resolved
  at init; crisp on DPR>1.
- **Focus & keyboard:** labelled search input, keyboard-navigable results, Esc
  closes; ARIA-labelled floor buttons with visible focus ring.
- **Canvas is decorative:** the searchable catalog is the accessible path to
  every destination; label text mirrors the searchable `title`.
