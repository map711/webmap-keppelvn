# Overview — Keppel Webmap (Saigon Centre wayfinder)

---

# Product

## Product intent

A standalone, browser-first indoor wayfinding map for **Saigon Centre (SGC)** — a
Keppel mall — shipped as a `<wayfinder-map>` Web Component. It is a **port**: the
product *shell* of `webmap-sunwaymalls` (a polished Canvas-2D component + UI +
build) is forked, but its data/render guts are replaced with logic ported from
the `indoorcms-keppelvn` CMS so the engine can consume the CMS's published bundle
`datas/SGC_v001.json` (GeoJSON-polygon units in raw coordinates + a navmesh +
cross-floor transitions). The CMS is the *producer* of the bundle; this webmap is
the *consumer*; the two meet only at `SGC_v001.json`. **Phase 1 ("Browse the
map") is shipped:** a visitor can browse SGC's 5 floors, read shop labels, switch
floors, search shops/facilities, and focus a shop by search or polygon tap.
Routing/wayfinding is Phase 2.

## Capabilities

| Capability | Does | Record |
|------------|------|--------|
| `map-bootstrap` | Fork the shell; single `data-url` fetch + parse + index of `SGC_v001.json`; engine init; build/test/dev on :5080 | `capabilities/map-bootstrap.md` |
| `destination-catalog` | `LocationStore` builds the placed-shop + facility destination catalog (multi-tenant/multi-unit aware; one-to-many `unitId→Location`) | `capabilities/destination-catalog.md` |
| `floor-rendering` `(ui)` | Unit-aware `FloorLayer`: per-unit polygons, `unit→layer→kind` style cascade, `getBounds()` fallback, `hitTest→unitId` | `capabilities/floor-rendering.md` |
| `map-labels` `(ui)` | `LocationLayer` draws labelable-unit labels at `label_point`/`label_rotation` with `_fitScale` + overlap suppression | `capabilities/map-labels.md` |
| `floor-switching` `(ui)` | Level selector + `setFloor` swap geometry+labels and refit; `floor:changed` event; empty L1 + sparse B2/B1 | `capabilities/floor-switching.md` |
| `destination-search` `(ui)` | Built-in search filters the catalog by title/tokens; results dropdown + info card | `capabilities/destination-search.md` |
| `destination-focus` `(ui)` | `focusLocation` / polygon tap: switch floor + zoom + end pin; multi-tenant disambiguation; clear → browse | `capabilities/destination-focus.md` |

## Constraints

- **Sparse seed fixture:** of 20 shops only **5 are placed** (4 tenanted units,
  all on L3), and **L1 (level id 3) is meshless _and_ unit-less** — a meshless/
  empty level must still be selectable, browseable, and frame without error.
  Real-bundle criteria assert data-driven **rules**, not seed magic-numbers.
- Canvas-2D only — no Konva. Single `data-url` (the bundle carries everything).
  Raw CMS coordinates, `renderScale = 1`.
- Public component/engine API + built-in UI from the shell stay intact so Phase
  2/3 features drop in.
- Dev server + local run on **port 5080**.

## Decisions

- **Reuse-first port** — keep the sunwaymalls Canvas-2D renderer + component
  shell, replace store/layer internals in place; rejected a Konva swap and a new
  `WayfinderEngine.js` (both re-plumb proven, working code).
- **Single self-contained bundle** — one `data-url`; rejected keeping `map-url`
  (no second file exists).
- **Placed-shops-only catalog** — a shop with no tenancy yields no Location;
  rejected one Location per `shops[]` entry.
- **String-namespaced ids** `shop:<id>` / `unit:<id>`; rejected numeric `+1e6`
  facility offsets (fragile collisions).
- **Meshless L1 stays visible** — browse/search work; only routing to/from it is
  a Phase-2 structured error; rejected hiding L1.

## Known-incomplete / carried forward

- Phase 1 shipped **7/7 green, 0 blocked**. Routing (`navmesh-routing` et al.) is
  **Phase 2** — `src/navigation/` (`PathFinder`, `RouteManager`, `MinHeap`) and
  the route/marker layers (`NavigationLayer`, `NavMarkerLayer`) are carried over
  from the shell but **not yet rebuilt over the bundle's navmesh**; treat them as
  Phase-2 scaffolding, not active wayfinding.

---

# System

## Module map

| Directory | Responsibility | Key entry point |
|-----------|----------------|-----------------|
| `src/data/` | Bundle load + index; destination catalog; geometry store; style cascade | `BundleLoader.js`, `LocationModel.js`, `MapGeometryModel.js`, `StyleResolver.js` |
| `src/core/` | Engine orchestration (init/dispose/floor/focus), config, event bus | `MapEngine.js` |
| `src/layers/` | Canvas layers: floor polygons, labels, pins (+ Phase-2 route layers) | `FloorLayer.js`, `LocationLayer.js`, `labelFit.js` |
| `src/renderer/` | Render loop, transform pipeline, layer stack, rbush overlap | `Renderer.js`, `RectVisibility.js` |
| `src/interaction/` | Gesture recognition + hit-test classification | `HitTestManager.js` |
| `src/component/` | `<wayfinder-map>` Web Component + built-in UI controls | `WayfinderMap.js` |
| `src/navigation/` | **Phase-2** routing (carried-over shell, not yet rebuilt) | `PathFinder.js`, `RouteManager.js` |
| `test/` | Vitest node-env suite + `fixtures/SGC_v001.json` real bundle | per-capability `*.test.js` |
| `demo/` | Static showcase pages for the Phase-1 browse capabilities (bare / default-controls / `focus-shop-id` / theme) + per-demo guide | `index.html` |

## Key patterns

### Indexed model → store hydrate (no second fetch)
- **Where used:** `MapEngine.#loadData` → `BundleLoader.load(url)` → both stores
  `.hydrate(model)`.
- **Example:** the engine owns the **single** fetch; `LocationStore` and
  `MapGeometryStore` hydrate from the already-parsed `BundleModel`.
- **When to use:** any new store/consumer of bundle data — hydrate from the
  indexed model, never fetch independently (a per-store fetch was the
  double-fetch / `floorCount===0` green-but-wrong).

### Inherit-cascade resolution
- **Where used:** `StyleResolver.resolveStyle` (`unit → layer → kind → default`).
- **Example:** `""`/`null` = inherit; first concrete value wins; hard defaults
  `#000`/`#ccc`/`1`.
- **When to use:** any unit-level visual property that can be authored at multiple
  levels of the bundle hierarchy.

### Pre-resolved label placement
- **Where used:** `LocationModel`'s `DisplayNode` (anchor=`label_point`,
  rotation=`label_rotation` deg→rad at build) consumed by `LocationLayer`.
- **Example:** the layer draws at the pre-resolved anchor/angle and only
  shrink-to-fits; no polylabel/OBB recompute.
- **When to use:** trust the CMS's authored placement; don't re-derive geometry.

### Bus event → DOM event re-emit
- **Where used:** `WayfinderMap.#wireEvents` maps `floor:changed`→`floor-changed`,
  `data:loaded`→`data-loaded`, `tap:location`→`location-tap`,
  `tap:disambiguate`→`location-disambiguate`.
- **When to use:** exposing any new engine event to host-page listeners.

## Reusable utilities

| Utility | Location | Purpose |
|---------|----------|---------|
| `resolveStyle(unit, layersById, kindsBySlug)` | `src/data/StyleResolver.js` | unit→layer→kind style cascade |
| `geometryToPoints(geometry)` | `src/data/MapGeometryModel.js` | GeoJSON ring → `Point[]` (drop closing vertex) |
| `_fitScale(...)` | `src/layers/labelFit.js` | shrink-to-fit scalar, clamped at 1 |
| `computeVisibleRects(rects)` | `src/renderer/RectVisibility.js` | rbush screen-rect overlap suppression |
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

## Tech-stack decisions

(Inherited from `tars-epic.md`'s cross-cutting decisions.)

- **Canvas-2D renderer + component shell** (sunwaymalls) — rejected Konva swap.
- **Single bundle, one `data-url`** → `SGC_v001.json` — rejected `map-url` split.
- **Raw CMS coords, `renderScale = 1`** — rejected 0–1 normalization (FP drift,
  ambiguous for meshless L1).
- **String-namespaced ids** `shop:<id>` / `unit:<id>` — rejected numeric offsets.
- **Unit-aware floor hit-test** (per-unit polygons retain `unitId`) — rejected
  style-grouped meshes.
- **Build:** Rollup → ESM/UMD/min. **Test:** Vitest node-env, pure ports driven
  by a synthetic mini-bundle; the real 2 MB bundle only in opt-in smoke tests.
  **Dev/run:** port 5080.

## UI/UX patterns

### Design system & tokens
- **Stack:** vanilla Web Component (`<wayfinder-map>`) over a Canvas-2D render
  stack; built-in search + level-selector controls forked from sunwaymalls; SVG
  icon set under `src/assets/`.
- **Visual reference:** match the `webmap-sunwaymalls` look-and-feel (the fork
  source) while rendering SGC's real geometry with indoorcms fidelity — clean,
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
- **Empty/edge:** sparse (B2/B1) and empty (L1) levels still frame via the
  `getBounds()` fallback; search empty state shows "no matches"; load is instant
  (in-memory catalog index).

### Responsive & accessibility baseline
- **Breakpoint:** 768px (desktop panel vs mobile fullscreen). Device mode resolved
  at init; crisp on DPR>1.
- **Focus & keyboard:** labelled search input, keyboard-navigable results, Esc
  closes; ARIA-labelled floor buttons with visible focus ring.
- **Canvas is decorative:** the searchable catalog is the accessible path to
  every destination; label text mirrors the searchable `title`.
