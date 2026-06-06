# map-bootstrap

## Purpose

Stand up the standalone `<wayfinder-map>` app for Saigon Centre by forking the
upstream Canvas-2D shell and feeding it the single CMS bundle
`datas/SGC_v001.json`. This capability is the foundation every other Phase-1
capability builds on: one `data-url` fetch → parse → index of the self-contained
bundle, engine initialization over the indexed model, and the build/test/dev/
deploy infrastructure (Rollup bundles, Vitest suite, an ownership-aware `.dev/`
dev-server harness on port 5080, and a gallery build + DigitalOcean-Spaces deploy).

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
- `npm run build` = `rollup -c` (ESM + UMD + min bundles to `dist/`) then
  `scripts/build.js`, which stages the demo gallery into `dist/<BUILD_SECRET>/`
  (rewriting each page's `dist/wayfinder-map.esm.js` import to
  `../wayfinder-map.min.js`). `npm run deploy` builds then `aws s3 sync`s the
  gallery + `wayfinder-map.min.js` + `datas/` + `qa-shims/` to DigitalOcean
  Spaces. Both read `.env` (gitignored — `BUILD_SECRET` + `DO_SPACES_*`) via
  `dotenv`; `BUILD_SECRET` is validated `^[\w.-]+$` so it can't escape `dist/`.
- `npm test` runs Vitest (`vitest run`), which **binds no port** (fetch mocked,
  fixtures read from disk) — so it never collides with a live dev server.
- The dev server is the zero-dependency **ownership-aware `.dev/` harness**, not
  `http-server`. `npm run dev` starts an `owner=human` server on :5080 (static
  serve + live-reload injection + a spawned `rollup -c -w`) — what the user leaves
  running. Automated paths use `npm run dev:ensure`, which reuses a running server
  or starts a detached `owner=agent` one; `npm run dev:stop` refuses to stop a
  human server without `--force`; a later `npm run dev` reclaims an agent-held
  port. The harness recognises its own servers via `/__dev/health` (sentinel
  `keppelvn-dev`); a foreign process on :5080 makes it fail fast, never kill.
  Port is 5080 by default, overridable via `$PORT` (read over `.dev/config.json`
  by `resolvePort()`).

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
- **Decision:** the dev server is an ownership-aware `.dev/` harness (human vs
  agent owner) rather than a bare `http-server` — rejected: a plain port-bound
  dev script that an agent/QA path could SIGTERM, killing the user's running
  `npm run dev` (the "don't kill my dev server" guarantee).
- **Decision:** the build-infra test builds into an isolated temp dir via
  `WAYFINDER_BUILD_OUT_DIR` (rollup reads it; default `dist`) and asserts a
  `dist/` sentinel survives — rejected: `rmSync(dist) + rollup -c`, which races a
  live `rollup -w` mid-write on the dir the harness is serving on :5080.
- **Invariant:** `npm test` never touches a live dev server's `dist/`; the test
  suite binds no port.

## Tests

- `test/data/BundleLoader.test.js` — single-fetch load, real-SGC counts +
  `navmesh_by_level` keys `{1,2,4,5}`, index joins, mini-bundle data-driven
  counts, missing-key structured error.
- `test/core/MapEngine.bootstrap.test.js` — single `data-url` fetch (no
  `map-url`), `data:loaded` with `floorCount===5`.
- `test/build/buildInfra.test.js` — `build` runs rollup **and** stages the
  gallery; `test` runs Vitest; `dev`/`dev:ensure`/`dev:stop`/`dev:status` wire the
  ownership-aware harness; `deploy` wires `scripts/deploy.js`; the harness ships
  all its `.dev/` modules; `config.json` pins 5080 and `resolvePort()` honours
  `$PORT` (no port binding); `dev:stop` refuses a human server without `--force`;
  live-reload injection is idempotent; `rollup.config.js` emits ESM + UMD + min;
  and a real `rollup` build into a temp `WAYFINDER_BUILD_OUT_DIR` emits non-empty
  bundles while a `dist/` sentinel stays untouched.
