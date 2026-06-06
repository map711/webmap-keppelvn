# map-bootstrap

## Purpose

Stand up the standalone `<wayfinder-map>` app for Saigon Centre by forking the
`webmap-sunwaymalls` Canvas-2D shell and feeding it the single CMS bundle
`datas/SGC_v001.json`. This capability is the foundation every other Phase-1
capability builds on: one `data-url` fetch → parse → index of the self-contained
bundle, engine initialization over the indexed model, and the build/test/dev
infrastructure (Rollup bundles, Vitest suite, `http-server` on port 5080).

## Behavior

- `BundleLoader.load(url)` issues **one** fetch via the cached/gzip-aware
  `DataLoader`, validates the bundle's required top-level keys, and returns an
  indexed `BundleModel`. On the real `SGC_v001.json` the model exposes the raw
  source arrays verbatim (5 levels B2/B1/L1/L2/L3, 10 kinds, 158 units, 20 shops,
  10 categories, 2 transitions) plus `navmesh_by_level` keyed by stringified
  level id — keys `{1,2,4,5}`, level id 3 (L1) absent because it is meshless.
- The model's derived indexes resolve the joins the renderer/router need:
  `kindsBySlug` (e.g. `elevator.is_accessible === true`,
  `escalator.is_connector === true && is_accessible === false`), `layersById`,
  `levelsById`, `shopsById`, `categoriesById`, and `unitsByLevelId` (every level
  seeded with an empty array first, so a unit-less level like L1 resolves a
  non-null empty group).
- A bundle missing a required top-level key (or with a wrong container shape —
  array vs object) raises a structured `BundleLoadError` (subclasses `Error`,
  carries `name` + `url`). At the engine boundary this surfaces as an emitted
  error event, never an unhandled throw.
- Engine init fetches the single `data-url` (no `map-url` request); on success
  both stores hydrate from the **already-parsed** indexed model (no second
  fetch) and the engine emits `data:loaded` with `floorCount === 5`. The
  component re-emits this as the `data-loaded` DOM event.
- `npm run build` (Rollup) emits ESM + UMD + min bundles to `dist/`; `npm test`
  runs Vitest; `npm run dev` runs `rollup -w` + `http-server -p 5080`
  concurrently.

## Interfaces & contracts

- `new BundleLoader(dataLoader?)` / `load(url) → Promise<BundleModel>` — one
  fetch, validate, index; throws `BundleLoadError` on a missing/mis-typed key.
- `new BundleModel(bundle)` — raw arrays (`levels`, `layers`, `kinds`, `units`,
  `shops`, `categories`, `transitions`, `navmesh_by_level`, `mall`) + indexes
  (`kindsBySlug`, `layersById`, `levelsById`, `shopsById`, `categoriesById`,
  `unitsByLevelId`); `getUnitsByLevelId(levelId) → Array|null`,
  `getKind(slug) → Object|undefined`.
- `class BundleLoadError extends Error` — `{ name:'BundleLoadError', url }`.
- `MapEngine` public API preserved from the shell: `init()`, `dispose()`,
  `getFloors()`, `setFloor()`, `focusLocation()`, `clearRoute()`, etc.
- `REQUIRED_KEYS` — `levels, layers, kinds, units, shops, categories,
  navmesh_by_level, transitions` (arrays except `navmesh_by_level`, an object).

## Data model

- **BundleModel** — the indexed in-memory model both stores hydrate from. Owns
  the raw bundle arrays (exposed unchanged so consumer-asserted counts mirror the
  served data) plus the derived lookup maps. `navmesh_by_level` is object-keyed
  by stringified level id; a meshless level is **absent**, not present-with-empty.
- **Bundle top-level shape** — the loader validates the parsed bundle against
  `REQUIRED_KEYS` (`mall`/`levels`/`units`/`shops`/`navmesh_by_level`/…); the live
  `datas/SGC_v001.json` is the authoritative example of the produced shape.

## Decisions & constraints

- **Decision:** single self-contained bundle, one `data-url` → `SGC_v001.json` —
  rejected: keep the legacy `data-url` catalog + `map-url` geometry split (there
  is no second file; the published bundle carries everything).
- **Decision:** rebuild only `MapEngine`'s `#loadData`/`#createLayers`/
  `#createNavigationSystem` internals over the bundle — rejected: a new
  `WayfinderEngine.js` (duplicates ~600 lines of proven dispose/resize/zoom
  orchestration).
- **Decision:** stores hydrate from the already-parsed model (`hydrate(model)`),
  the engine owns the one fetch — rejected: each store fetching its own URL
  (the green-but-wrong double-fetch QA caught, which left `floorCount===0`).
- **Invariant:** exactly one network fetch per init; `data:loaded` carries
  `floorCount===5`. Raw bundle arrays are exposed verbatim (counts are an honest
  function of the served data; indexes are derived, never authoritative).
- **Invariant:** a structurally invalid bundle yields a `BundleLoadError` /
  emitted error event, never an unhandled throw.

## Tests

- `test/data/BundleLoader.test.js` — single-fetch load, real-SGC counts +
  `navmesh_by_level` keys `{1,2,4,5}`, index joins, mini-bundle data-driven
  counts, missing-key structured error.
- `test/core/MapEngine.bootstrap.test.js` — single `data-url` fetch (no
  `map-url`), `data:loaded` with `floorCount===5`.
- `test/build/buildInfra.test.js` — build emits 3 bundles; dev script binds
  `-p 5080`; test script runs Vitest.
