# Plan — Phase 1: Browse the map

> Phase 1 of the **Keppel Webmap (Saigon Centre wayfinder)** epic. Inherits all cross-cutting
> decisions from [tars-epic.md](tars-epic.md). This phase delivers a browsable SGC map (no routing
> yet — that is Phase 2).

## What & why            (PM ↔ client)

- **Intent:** Stand up the standalone `<wayfinder-map>` app for Saigon Centre by forking the `webmap-sunwaymalls` Canvas-2D shell and feeding it the CMS bundle `datas/SGC_v001.json`. By end of phase, a visitor opening the page at **:5080** sees SGC's floors drawn from the bundle's GeoJSON units (per-unit styling from the kind→layer→unit cascade), reads shop labels, switches between the 5 floors (B2/B1/L1/L2/L3), searches shops & facilities, and taps a shop (in search or directly on its polygon) to focus it with a pin. Wayfinding/routes are explicitly out of scope this phase.
- **Constraints:** No Konva — port the indoorcms render *logic* into the existing Canvas-2D layers. Single `data-url` (the bundle carries everything). Raw CMS coordinates, `renderScale=1`. The public component/engine API and built-in UI from the shell stay intact (so Phase 2/3 features drop in). Dev server + local run on **port 5080**. Vitest node-env; pure ports tested against a synthetic mini-bundle, the real 2 MB bundle only in one opt-in smoke test. **The SGC seed is a _sparse fixture_** — of 20 shops only **5 are placed** (4 tenanted units, all on L3), and **L1 (level 3) has no navmesh _and_ no units** — so a meshless/empty level must still be selectable and activate without error, framing via a bounds fallback (routing degradation is a Phase 2 concern). Because the seed is sparse, **real-bundle criteria assert data-driven _rules_, not seed magic-numbers** — concrete counts live in the synthetic mini-bundle (stable top-level array counts excepted).
- **Decisions:** (inherited from the epic — see its *Cross-cutting decisions*) string-namespaced ids `shop:<id>`/`unit:<id>`; destinations = tenanted shops + routable facility units, connectors excluded; unit-aware floor layer (polygon `hitTest` → `unitId`); `_fitScale` labels ported now; level dims from `envelope_dims` with bbox fallback. **Resolved this phase against the real bundle:** (a) catalog = **placed shops only** — a shop in `shops[]` with no unit tenancy yields **no** Location; (b) a **multi-tenant unit** (one polygon, ≥2 tenancies — e.g. unit 121 = ASICS + Basta Hiro) yields **one Location per tenancy**, so `unitId → Location` is one-to-many (`getLocationsByUnitId` returns a list; a polygon tap on such a unit disambiguates rather than silently picking); (c) a meshless **and** unit-less level (L1 here) is selectable, renders empty, and `getBounds()` falls back (mesh `envelope_dims` → unit-bbox union → neutral default) without error.

## How                   (tech lead — grounded in the codebase)

- **Module map:**
  - **Fork unchanged** from `webmap-sunwaymalls/src/`: `core/EventBus.js`, `core/Config.js`, `core/MapEngine.js` (rebuild only `#loadData`/`#createLayers`/`#createNavigationSystem`), `renderer/*` (Renderer, TransformPipeline, LayerStack, AnimationScheduler, RectVisibility), `interaction/*` (GestureRecognizer, HitTestManager — patch `#classifyHit` for `{unitId}`), `layers/Layer.js`, `component/WayfinderMap.js` (+ `controls/`, `styles.js`), `assets/*`, `index.js`, and the build/test infra (`rollup.config.js`, `scripts/`, `vitest.config.js`, `package.json` — dev script → `-p 5080`).
  - **Add** (new, mostly pure): `src/data/BundleLoader.js` (fetch + parse + index the single bundle), `src/data/StyleResolver.js` (`resolveStyle(unit, layersById, kindsBySlug)` cascade), and a label-fit helper (`_fitScale` port) under the labels layer/util.
  - **Replace internals** (public contract preserved): `src/data/LocationModel.js` (`LocationStore` → Location catalog from shops+facilities), `src/data/MapGeometryModel.js` (`MapGeometryStore`/`MapLevel` → per-unit polygons + dims), `src/layers/FloorLayer.js` (unit-aware draw + `hitTest`→`unitId`), `src/layers/LocationLayer.js` (labels from `displayNodes`).
- **Patterns:** keep the shell's seam contracts — `LocationStore`/`MapGeometryStore` public arrays/maps, the `Layer` interface (`renderWithContext`/`setFloor`/`hitTest`/`dispose`), `MapEngine` public API, `EventBus` `entity:action` events re-emitted as DOM events. Port the indoorcms pure logic verbatim where possible: `geometryToPoints` (drop the closing ring vertex), the `resolveStyle` cascade (`unit || layer || kind || default`; `""`/`null` = inherit), label anchor = `label_point` / angle = `label_rotation` (pre-resolved; no polylabel/OBB).
- **Integration seams:** one bundle fetch in `MapEngine.#loadData` → `BundleLoader.load(dataUrl)` → both stores hydrate from the parsed object. `FloorLayer.hitTest` returns `unitId`; `HitTestManager.#classifyHit` maps it via `LocationStore.getLocationsByUnitId` (one-to-many) → `tap:location` when exactly one Location owns the unit, a disambiguation when ≥2 (multi-tenant unit), else `tap:floor`. `LocationLayer` reads `Location.displayNodes` (thin `{id, levelCode, point, rotation, fitScale, location}` records) filtered by active level.
- **Reuse:** the whole sunwaymalls render/gesture/animation/transform stack, the component's built-in search + level-selector UI, `RectVisibility`/rbush for label overlap, `DataLoader` (gzip/cache) under `BundleLoader`, the Vitest harness + canvas/window/fetch mocks.
- **Cross-cutting tech-stack decisions:** all resolved in [tars-epic.md](tars-epic.md) — Canvas-2D (no Konva), single bundle, string ids, raw coords/`renderScale=1`, unit-aware floor hit-test, mini-bundle test fixture, port 5080.

<!-- Decision log (epic panel) -->
- Rejected **Konva swap** — re-plumbs the proven gesture/marker/animation shell for no data-fidelity gain.
- Rejected **new `WayfinderEngine.js`** — duplicates ~600 lines of working `MapEngine` orchestration.
- Rejected **numeric `+1e6` facility ids** — fragile, silent shop/unit collisions; string namespacing is honest + URL-clean.
- Rejected **style-grouped meshes in FloorLayer** — loses per-unit identity needed for polygon tap-to-select.
- Rejected **0–1 normalization × renderScale** — FP drift + ambiguous for meshless L1; raw coords are simplest.
- Rejected **real 2 MB bundle in all tests** — slow + non-deterministic; mini-bundle makes edge cases assertable.

## Capability breakdown

- [ ] `map-bootstrap` — fork the Canvas-2D shell into this repo; single `data-url` fetch + parse + index of `SGC_v001.json`; engine init; build/test/lint + dev server on :5080 · depends on: none
- [ ] `destination-catalog` — `LocationStore` builds the searchable/routable destination catalog: one `shop:<id>` Location **per placed (tenancy-referenced) shop** (multi-unit aware; a multi-tenant unit yields one Location per tenancy → `getLocationsByUnitId` is one-to-many), one `unit:<id>` per routable facility unit; connectors and unplaced shops excluded · depends on: `map-bootstrap`
- [ ] `floor-rendering` `(ui)` — unit-aware `FloorLayer` draws each active-level unit polygon with its resolved `unit→layer→kind` style; per-level visibility (an empty level draws nothing without error); fit-to-bounds with a fallback for meshless/empty levels; polygon `hitTest`→`unitId` · depends on: `map-bootstrap`
- [ ] `map-labels` `(ui)` — `LocationLayer` renders labels for labelable units at `label_point`/`label_rotation` with `_fitScale` shrink-to-polygon + screen-rect overlap suppression · depends on: `floor-rendering`, `destination-catalog`
- [ ] `floor-switching` `(ui)` — level selector lists the 5 levels in `position` order; `setFloor(code)` swaps the active level's geometry+labels and refits; emits `floor-changed` · depends on: `floor-rendering`
- [ ] `destination-search` `(ui)` — search filters the catalog by title/`search_tokens`; results dropdown + info card (title, venue, logo, description) · depends on: `destination-catalog`, `map-labels`
- [ ] `destination-focus` `(ui)` — `focusLocation(id)` and tapping a shop polygon both resolve to a Location, switch floor if needed, zoom in, and drop an end pin; clearing returns to browse · depends on: `destination-search`, `floor-rendering`

## How to test           (the binding acceptance criteria)

### `map-bootstrap`
- `BundleLoader.load` on the real `SGC_v001.json` yields an indexed model with **5 levels** (codes B2,B1,L1,L2,L3), **10 kinds**, **158 units**, **20 shops**, **10 categories**, **2 transitions**, and `navmesh_by_level` keys exactly `{1,2,4,5}` (level id 3 / L1 absent).
- The loader's indexes resolve: `kindsBySlug.get('elevator').is_accessible === true`, `kindsBySlug.get('escalator').is_connector === true && is_accessible === false`, `layersById` and `levelsById` return the matching records, and units are retrievable grouped by `level_id`.
- Loading the synthetic **mini-bundle** fixture yields its documented counts (2 levels, 1 meshless, shops+escalator+elevator units, 1 transition) — proving the loader is data-driven, not SGC-hardcoded.
- A bundle missing a required top-level key (e.g. no `units`) produces a structured load error (engine emits an `error` event), not an unhandled throw.
- Engine init fetches a single `data-url` (no `map-url` request is made) and on success emits `data-loaded` with `floorCount === 5`.
- `npm run build` emits `dist/` ESM + UMD + min bundles; `npm test` runs the Vitest suite; the dev script invokes `http-server` with `-p 5080`.

### `destination-catalog`
- Catalog = **placed shops only**: the count of `shop:<id>` Locations **equals the number of distinct `shop_id`s across all unit `tenancies[]`**, not `shops[].length`. On the SGC seed that is **5** (Starbucks, ABC Mart Grand Stage, ASICS, Basta Hiro, Armani Exchange — from 4 tenanted units, all on L3); a shop present in `shops[]` but referenced by **no** tenancy (15 of 20 on this seed) yields **no** Location. `getLocation('shop:<id>')` round-trips and each carries `title` (shop name), `search_tokens` including the name + `unit_number` + category name, plus `logo`/`description`/`venue`.
- A shop occupying multiple units exposes every unit in `unitIds[]` and every spanned floor in `levelCodes[]` (real seed has none — verified on the mini-bundle's multi-unit shop).
- A **multi-tenant unit** (one polygon with ≥2 tenancies) produces **one `shop:<id>` Location per tenancy**, each listing that shared `unitId` (real seed: unit 121 → both `shop:7` ASICS and `shop:11` Basta Hiro). `getLocationsByUnitId(121)` returns **both** Locations.
- Routable non-connector facility units (`kind.is_routable && !is_connector && !is_tenant`) become **one `unit:<id>` Location each** (mini-bundle: a `toilet` unit → `unit:<id>`); on the real SGC seed this set is **empty** (no facility units placed) so the catalog contains only the placed-shop Locations.
- Connector units (escalator/elevator) and non-routable units (entrance/parking/other), and **vacant shop-kind units** (no tenancy — 149 of 153 on this seed), produce **no** Location.
- `getLocationsByUnitId(unitId)` returns a **list** of the Locations owning that unit: empty for a connector or vacant unit, one for a single-tenant unit, ≥2 for a multi-tenant unit.
- Every Location has `displayNodes` with one entry per unit: `point` = that unit's `label_point`, `rotation` from `label_rotation`, `levelCode` derived from `unit.level_id`.

### `floor-rendering` `(ui)`
- `resolveStyle(unit, layersById, kindsBySlug)` returns the cascade: a unit with `stroke_color===""` inherits its kind's stroke color; `stroke_width===null` inherits; an explicit unit `fill_color` overrides the kind; with no overrides the kind's style is used (fallbacks `#000`/`#ccc`/width 1).
- `geometryToPoints` on a closed GeoJSON ring of `N+1` coordinates returns `N` points (closing duplicate dropped).
- For a chosen active level, the layer produces exactly one drawable polygon per unit on that level and **none** from other levels; switching the active level changes the produced set; editor `hidden`/`locked`/`opacity` flags do not affect output. An **empty active level** (L1 — 0 units) produces **zero** polygons without error.
- `MapLevel.getBounds()` resolves by fallback: a level **with a navmesh** returns its `envelope_dims`; a **meshless level with units** returns the bbox union of its unit polygons (finite); a **meshless, unit-less level** (L1 on this seed) returns a **neutral default extent** (finite, non-degenerate) rather than an empty/NaN box.
- `FloorLayer.hitTest(x,y)` returns the `unitId` whose polygon contains the point and `null` for empty space; `HitTestManager.#classifyHit` turns a catalogued `unitId` into a `tap:location` and a non-catalogued one into a `tap:floor`.

### `map-labels` `(ui)`
- A label is emitted only when the unit is labelable — `tenancies.length>0 && kind.is_tenant && labelsVisible`: a vacant `shop`-kind unit (no tenancy) and an `escalator` unit each emit **no** label; a tenanted shop unit emits its tenancy name.
- The label anchor equals `unit.label_point` and its angle equals `unit.label_rotation` converted degrees→radians — with no polylabel/OBB recomputation (assert a known `label_rotation` maps to the expected radians).
- `_fitScale` returns `<1` for a long label in a small polygon (so the rotated text box fits the unit extents) and is **clamped at 1** (never upscales) when the label already fits.
- When two label screen-rects overlap, the lower-priority label is suppressed (one survives), exercising the RectVisibility/rbush path.

### `floor-switching` `(ui)`
- `getFloors()`/the selector lists all **5** level codes ordered by `Level.position` (B2 lowest … L3 highest).
- `setFloor('L2')` makes L2 the active rendered level (geometry + labels reflect L2), sets `currentFloor==='L2'`, refits the view, and emits a `floor-changed` event with `{floor:'L2'}`.
- On load with `default-floor` set, that floor is active; with it unset, the first floor by the engine's priority is active.
- Selecting **L1** activates it without error and renders its geometry — which is **empty on this seed (0 units)** — still framing sensibly via the `getBounds()` fallback. The sparse floors B2/B1 (1 unit each) likewise activate and render cleanly.

### `destination-search` `(ui)`
- A query matching a placed shop name (case-insensitive substring over title/`search_tokens`) returns that shop's Location in results; a query matching nothing returns an empty result set. An **unplaced** shop (no Location) is **not** searchable.
- Selecting a result opens an info card exposing the Location's `title`, `venue`, `logo` (when present), and `description`.
- A facility Location is searchable (mini-bundle: querying "toilet" returns the `unit:<id>` facility); connector units never appear in results.

### `destination-focus` `(ui)`
- `focusLocation('shop:<id>')` switches to a floor the shop occupies, animates a zoom-in, and places an end pin at the shop's `displayNode` point; the focused Location is reflected by the engine.
- Tapping a shop's polygon resolves `unitId`→Location(s): a **single-tenant** unit focuses that one Location and emits `location-tap` carrying it; a **multi-tenant** unit (≥2 Locations, e.g. unit 121) surfaces a disambiguation rather than silently picking one, so both shops stay reachable.
- Focusing a Location on a different floor switches the floor first; for a multi-unit shop, focus targets the unit on the current floor when present, else the shop's first unit/floor.
- `clearRoute()` (return to browse) removes the pin and restores browse mode.

## Design intent         (UI-facing `(ui)` capabilities only — guidance, not a gate)

Aesthetic bar & reference: match the `webmap-sunwaymalls` look-and-feel (it is the visual reference this is forked from) while rendering SGC's real geometry with the indoorcms fidelity. Clean, calm indoor-mall map; the floor geometry is the hero, chrome is minimal and unobtrusive. Desktop + mobile/touch kiosk both matter (device mode resolved at init, ≤768px = mobile).

### `floor-rendering`
- **Layout & hierarchy:** the floorplan fills the viewport and auto-fits on load (`min-zoom: fit`); unit polygons fill by kind color with subtle strokes so tenancy blocks read as distinct rooms; the active floor is the only geometry shown. Empty/edge state: a sparse level (B2/B1, 1 unit) or a fully empty level (L1, 0 units) still frames sensibly via the `getBounds()` fallback rather than collapsing or erroring.
- **Interaction:** smooth pan / pinch-zoom (rotation optional); tapping a shop polygon gives immediate visual acknowledgement (hands off to `destination-focus`); tapping empty space does nothing jarring.
- **Responsive:** per-device viewport tuning (render-scale/zoom) resolved at init; crisp on DPR>1.
- **Accessibility:** canvas is decorative; the searchable catalog (below) is the accessible path to every destination; respect reduced-motion for fit/zoom animations.
- **Reference:** sunwaymalls `FloorLayer` visual weight; indoorcms `resolveStyle` cascade for colors.

### `map-labels`
- **Layout & hierarchy:** shop names sit centered on their unit at the pre-resolved anchor/rotation, legible at a glance with a light halo for contrast over fills; labels hold constant screen size across zoom; overlaps thin out gracefully rather than colliding.
- **Interaction:** labels track their unit during pan/zoom without jitter; suppressed labels reappear when zoom relieves the collision.
- **Responsive:** base + min font size per device; never upscale beyond the unit (`_fitScale` ≤ 1).
- **Accessibility:** label text mirrors the searchable `title`; contrast target ≥ 4.5:1 against typical fills.
- **Reference:** indoorcms `label-overlay.js` placement/fit; sunwaymalls `LocationLayer` typography knobs.

### `floor-switching`
- **Layout & hierarchy:** a vertical floor-button stack (highest floor on top), the active floor clearly marked; ordered by `Level.position`.
- **Interaction:** one tap switches floors with a quick refit; the selection state is obvious; L1 is selectable like any floor.
- **Responsive:** comfortable tap targets (≥44px) on mobile/kiosk; reachable thumb zone.
- **Accessibility:** ARIA-labelled buttons, keyboard-navigable, focus ring visible, current floor announced.
- **Reference:** sunwaymalls built-in level-selector.

### `destination-search`
- **Layout & hierarchy:** desktop = top-left search panel with results dropdown + info card; mobile = fullscreen overlay with an expand/collapse info panel. The query field is the primary affordance; results show name + venue (+ logo when present).
- **Interaction:** type-to-filter with responsive results; selecting a result opens the info card and (via focus) frames it on the map; clear/close returns to browse. Empty state: "no matches" messaging; loading is effectively instant (in-memory index).
- **Responsive:** distinct desktop panel vs mobile fullscreen layouts at the 768px breakpoint.
- **Accessibility:** input is labelled, results are a keyboard-navigable listbox, Enter selects, Esc closes, focus is managed into/out of the overlay.
- **Reference:** sunwaymalls search control (desktop panel / mobile overlay).

### `destination-focus`
- **Layout & hierarchy:** the focused destination is centered and zoomed with a single clear end pin (speech-bubble style) showing its name; the rest of the floor recedes.
- **Interaction:** focusing from search or from a polygon tap behaves identically; a cross-floor focus switches floors first; a back/clear affordance returns to browse and removes the pin.
- **Responsive:** focus zoom level + pin sizing scale per device/DPR.
- **Accessibility:** focus change is announced (the destination name); the pin's information is available as text, not color alone.
- **Reference:** sunwaymalls focus mode + `PinMarkerLayer` end marker.
