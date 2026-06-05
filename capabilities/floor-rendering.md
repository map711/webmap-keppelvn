# floor-rendering

## Purpose

Draw the active floor as per-unit polygons, each styled by the
`unit → layer → kind` cascade, and resolve a tap to the owning `unitId`. The
unit-aware floor layer is what makes "tap a shop's polygon to select it"
possible; it also frames every level — including the sparse and fully empty
ones — via a `getBounds()` fallback chain.

## Behavior

- `resolveStyle(unit, layersById, kindsBySlug)` walks `unit → layer → kind →
  default`: `""` / `null` / `undefined` at a level means inherit; the first
  concrete value wins. Hard defaults: stroke `#000`, fill `#ccc`, width `1`. So
  a unit with `stroke_color===""` inherits its kind's stroke; `stroke_width===null`
  inherits; an explicit unit `fill_color` overrides the kind.
- `geometryToPoints(geometry)` converts a GeoJSON Polygon / bare ring /
  MultiPolygon-first into `Point[]`, dropping the closing duplicate vertex
  (an `N+1`-coordinate closed ring → `N` points). Ported from indoorcms.
- A `MapLevel` produces exactly one `UnitPolygon` per active unit on that level
  and **none** from other levels. Switching the active level changes the produced
  set. Editor `hidden`/`locked`/`opacity` flags do **not** affect output (only
  `is_active === false` drops a unit); the published consumer bundle renders the
  authored geometry regardless of the authoring tool's view state. An **empty
  level** (L1, 0 units) produces **zero** polygons without error.
- `MapLevel.getBounds()` resolves by fallback chain: (1) a level **with a
  navmesh** frames to its `envelope_dims`; (2) a **meshless level with units**
  frames to the finite bbox union of its unit polygons; (3) a **meshless,
  unit-less level** (L1 on this seed) frames to a neutral default extent
  (1000×1000). Always finite and non-degenerate — never empty/NaN.
- `FloorLayer.hitTest(x,y)` returns the `unitId` of the top-most (last-drawn)
  unit polygon containing the point via even-odd ray casting, or `null` for empty
  space. `HitTestManager.#classifyHit` turns a catalogued `unitId` into a
  `tap:location` (or `tap:disambiguate` for multi-tenant) and a non-catalogued
  one into a `tap:floor`.

## Interfaces & contracts

- `resolveStyle(unit, layersById, kindsBySlug) → {strokeColor, fillColor,
  strokeWidth}`.
- `geometryToPoints(geometry) → Point[]` (closing vertex dropped).
- `class MapLevel` — `getDrawables() → UnitPolygon[]`, `getBounds() →
  {minX,minY,maxX,maxY,width,height,centerX,centerY}`.
- `class UnitPolygon` — `{ unitId, points:Point[], strokeColor, fillColor,
  strokeWidth, unit }`, `getBounds()`.
- `MapGeometryStore.hydrate(model, {renderScale}?)` / `getLevelByCode(code)` /
  `getLevelsSorted()` / `getFloorCodes()` — levels sorted by `position`.
- `FloorLayer` — `setMapLevel(level)` (alias `setLevel`), `getBounds()`,
  `renderWithContext(ctx)`, `hitTest(x,y) → unitId|null`,
  `hitTestUnitId(x,y)`.

## Data model

- **MapLevel** — one floor's `drawables: UnitPolygon[]` + framing metadata
  (`id, code, ordinal, navmesh`). Owns the `getBounds()` fallback.
- **UnitPolygon** — one drawable unit: resolved point ring + `unitId` (retained
  for tap-to-select) + cascade-resolved style.

## Decisions & constraints

- **Decision:** unit-aware floor layer — each polygon keeps its `unitId` so
  `hitTest` returns it. Rejected: style-grouped meshes (lose per-unit identity,
  no polygon tap-to-select).
- **Decision:** raw CMS coordinates, `renderScale = 1`. Rejected: 0–1
  normalization × renderScale (FP drift; ambiguous for meshless L1).
- **Decision:** `getBounds()` 3-step fallback (envelope_dims → unit-bbox union →
  neutral default). Rejected: returning an empty/NaN box for meshless levels
  (collapses fit-to-view).
- **Invariant:** editor view-state flags (`hidden`/`locked`/`opacity`) never gate
  rendering; only `is_active === false` drops a unit.
- **Invariant:** `getBounds()` is always finite and non-degenerate.

## UX & accessibility

- **Layout & hierarchy:** the floorplan fills the viewport and auto-fits on load;
  unit polygons fill by kind color with subtle strokes so tenancy blocks read as
  distinct rooms; only the active floor's geometry is shown. A sparse level
  (B2/B1, 1 unit) or fully empty level (L1, 0 units) still frames sensibly via the
  `getBounds()` fallback rather than collapsing.
- **Interaction:** tapping a shop polygon hands off to `destination-focus` for
  immediate visual acknowledgement; tapping empty space emits `tap:empty` (does
  nothing jarring).
- **Responsive:** raw coords + `renderScale=1`; per-device viewport tuning
  resolved at init, crisp on DPR>1.
- **Accessibility:** the canvas is decorative — the searchable catalog is the
  accessible path to every destination.
- **Note:** browser-QA was skipped for this capability (chrome-devtools-mcp
  unavailable at the time); it was verified code+render-only. The other `(ui)`
  capabilities got live-browser QA.

## Tests

- `test/layers/FloorRendering.test.js` — `resolveStyle` cascade (inherit/override/
  default), `geometryToPoints` closing-vertex drop, per-level drawable set
  (empty L1 → 0), `getBounds()` 3-step fallback, `hitTest`→`unitId` and
  classification to `tap:location`/`tap:floor`.
