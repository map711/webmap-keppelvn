# map-bootstrap

## Purpose

Stand up the standalone `<wayfinder-map>` app for Saigon Centre by forking the
upstream Canvas-2D shell and feeding it the CMS-published data. The CMS now
publishes the consumer bundle **split into two remote halves** — a `maps_…`
(geometry + navmesh + `mall`) file and a `datas_…` (shop directory + categories)
file, both gzipped on the dev bucket — so this capability fetches **both URLs in
parallel**, validates each half, and **merges them into the unchanged
`BundleModel`** before indexing. It is the foundation every other Phase-1
capability builds on: two-URL parallel fetch → per-half validate → merge → parse →
index, engine initialization over the indexed model, and the build/test/dev/
deploy infrastructure (Rollup bundles, Vitest suite, an ownership-aware `.dev/`
dev-server harness on port 5010, a `data:pull` mirror script, and a gallery build
+ DigitalOcean-Spaces deploy).

## Behavior

- `BundleLoader.load(source)` accepts **two call shapes**: `load(url)` issues
  **one** fetch of a self-contained bundle (legacy/test path), while
  `load({mapsUrl, datasUrl})` — the path the engine now uses — fetches **both
  remote halves in parallel** via the cached/gzip-aware `DataLoader`, validates
  each half against the keys *that half* carries, and **merges** them into one
  bundle object before indexing. The merge sources geometry (`levels`, `layers`,
  `kinds`, `units`, `navmesh_by_level`, `transitions`) + `mall` from the **maps**
  half and `shops` + `categories` from the **datas** half; extra `datas_` keys the
  webmap doesn't consume (`banners`, `events`, `malls`, …) are **ignored** — never
  validated, never merged, never `BundleModel` fields. The merged object is
  byte-shape-identical to the old single bundle, so `BundleModel` and everything
  downstream of it is the **firewall** — nothing observes the split. The merged
  model exposes the raw source arrays verbatim (5 levels B2/B1/L1/L2/L3, 10 kinds,
  158 units, 20 shops, 10 categories, 2 transitions) plus `navmesh_by_level` keyed
  by stringified level id — keys `{1,2,4,5}`, level id 3 (L1) absent (meshless).
- The model's derived indexes resolve the joins the renderer/router need:
  `kindsBySlug` (e.g. `elevator.is_accessible === true`,
  `escalator.is_connector === true && is_accessible === false`), `layersById`,
  `levelsById`, `shopsById`, `categoriesById`, and `unitsByLevelId` (every level
  seeded with an empty array first, so a unit-less level like L1 resolves a
  non-null empty group).
- A half missing a required key (or with a wrong container shape — array vs
  object) raises a structured `BundleLoadError` (subclasses `Error`, carries
  `name` + `url`) whose message **names the offending half's URL** — a missing
  geometry key names the maps URL, a missing `shops`/`categories` names the datas
  URL. At the engine boundary this surfaces as an emitted error event, never an
  unhandled throw.
- Engine init reads `mapsUrl` + `datasUrl` from config and calls
  `load({mapsUrl, datasUrl})` — two parallel fetches, no `data-url`/`map-url`
  request; on success both stores hydrate from the **already-parsed** merged
  model (no per-store fetch) and the engine emits `data:loaded` with
  `floorCount === 5`. The component re-emits this as the `data-loaded` DOM event.
- The `<wayfinder-map>` component observes `maps-url` + `datas-url` (not
  `data-url`/`map-url`); `connectedCallback` schedules init only when **both** are
  present, and `init()` throws `wayfinder-map: maps-url and datas-url attributes
  are required` if either is missing. The demo gallery passes the same-origin
  relative `maps-url="../datas/maps_SGC_v001.json.gz"` +
  `datas-url="../datas/datas_SGC_v001.json.gz"` (no CORS — dev and deploy both
  serve the mirror from their own origin).
- `npm run build` = `rollup -c` (ESM + UMD + min bundles to `dist/`) then
  `scripts/build.js`, which stages the demo gallery into `dist/<BUILD_SECRET>/`
  (rewriting each page's `dist/wayfinder-map.esm.js` import to
  `../wayfinder-map.min.js`). `npm run deploy` builds then `aws s3 sync`s the
  gallery + `wayfinder-map.min.js` to DigitalOcean Spaces, and syncs the local
  `datas/` mirror's `maps_*.json.gz` + `datas_*.json.gz` **without `--delete`**
  (the CMS owns those objects on a separate origin; deploy must never delete them)
  — guarded by a pre-flight check that **aborts** if the mirror is empty/absent
  (telling you to run `npm run data:pull` first, since a missing `/datas/…` 403s
  every demo). Both read `.env` (gitignored — `BUILD_SECRET` + `DO_SPACES_*`) via
  `dotenv`; `BUILD_SECRET` is validated `^[\w.-]+$` so it can't escape `dist/`.
- `npm run data:pull` (= `node scripts/pull-data.js`) mirrors the latest split
  `.gz` halves from the CMS dev bucket into `datas/` — see the `data-pull-script`
  capability. The mirror is **gitignored** (`datas/*.gz`); the old self-contained
  `datas/SGC_v001.json` is removed from the repo.
- `npm test` runs Vitest (`vitest run`), which **binds no port** (fetch mocked,
  fixtures read from disk) — so it never collides with a live dev server.
- The dev server is the zero-dependency **ownership-aware `.dev/` harness**, not
  `http-server`. `npm run dev` starts an `owner=human` server on :5010 (static
  serve + live-reload injection + a spawned `rollup -c -w`) — what the user leaves
  running. Automated paths use `npm run dev:ensure`, which reuses a running server
  or starts a detached `owner=agent` one; `npm run dev:stop` refuses to stop a
  human server without `--force`; a later `npm run dev` reclaims an agent-held
  port. The harness recognises its own servers via `/__dev/health` (sentinel
  `keppelvn-dev`); a foreign process on :5010 makes it fail fast, never kill.
  Port is 5010 by default, overridable via `$PORT` (read over `.dev/config.json`
  by `resolvePort()`).

## Interfaces & contracts

- `new BundleLoader(dataLoader?)` / `load(source) → Promise<BundleModel>` —
  `source` is either a `string` URL (one fetch of a self-contained bundle, the
  legacy/test path) or `{mapsUrl, datasUrl}` (two parallel fetches → per-half
  validate → merge). Throws `BundleLoadError` naming the offending URL on a
  missing/mis-typed key.
- `new BundleModel(bundle)` — raw arrays (`levels`, `layers`, `kinds`, `units`,
  `shops`, `categories`, `transitions`, `navmesh_by_level`, `mall`) + indexes
  (`kindsBySlug`, `layersById`, `levelsById`, `shopsById`, `categoriesById`,
  `unitsByLevelId`); `getUnitsByLevelId(levelId) → Array|null`,
  `getKind(slug) → Object|undefined`. **Unchanged** by the split — it indexes the
  merged object exactly as it indexed the single bundle.
- `class BundleLoadError extends Error` — `{ name:'BundleLoadError', url }`.
- `Config` schema keys: `mapsUrl` (required) + `datasUrl` (required); the old
  `dataUrl`/`mapUrl` keys are **removed** (a config of only `{dataUrl}` throws
  `Config: "mapsUrl" is required`).
- `<wayfinder-map>` attributes: `maps-url` + `datas-url` (both required) replace
  `data-url`/`map-url` in `observedAttributes`.
- `MapEngine` public API preserved from the shell: `init()`, `dispose()`,
  `getFloors()`, `setFloor()`, `focusLocation()`, `clearRoute()`, etc.
- Validation key-sets: `MAPS_KEYS` = `levels, layers, kinds, units,
  navmesh_by_level, transitions` (the maps half); `DATAS_KEYS` = `shops,
  categories` (the datas half); `REQUIRED_KEYS` (their union) still validates a
  self-contained single bundle. Arrays except `navmesh_by_level`, an object.

## Data model

- **BundleModel** — the indexed in-memory model both stores hydrate from. Owns
  the raw bundle arrays (exposed unchanged so consumer-asserted counts mirror the
  served data) plus the derived lookup maps. `navmesh_by_level` is object-keyed
  by stringified level id; a meshless level is **absent**, not present-with-empty.
- **Split bundle shape** — the CMS publishes two gzipped halves:
  `maps_<MALL>_<VERSION>.json.gz` carries `MAPS_KEYS` (geometry/navmesh/
  transitions) + `mall`; `datas_<MALL>_<VERSION>.json.gz` carries `DATAS_KEYS`
  (`shops`, `categories`) plus unconsumed extras (`banners`/`events`/`malls`).
  The loader validates each half against its own key-set and merges only the
  consumed keys into one object whose shape equals the old self-contained bundle —
  the authoritative example of that merged shape is the pinned
  `test/fixtures/SGC_v001.json` (sliced into `{maps, datas}` by a test helper).

## Decisions & constraints

- **Decision (revised this cycle):** consume the CMS's **split** publish — two
  required URLs (`maps-url` + `datas-url`), fetched in parallel and merged. This
  *revises* the earlier "single self-contained bundle, one `data-url`" decision:
  the producer re-split its publish along its natural maps/datas seam, so the
  consumer follows. Rejected: base-URL+code+version derivation (a third config
  surface); reusing `data-url` as a base prefix; keeping a single-bundle fallback
  alongside the split (two code paths + a precedence rule). `load(string)` stays
  only as the self-contained/test shape.
- **Decision:** transfer the halves **gzipped** (`.gz`) — `DataLoader` already
  decompresses via `DecompressionStream`; rejected plain JSON (2.6 MB
  uncompressed for the maps half).
- **Decision:** demos use **same-origin relative** split URLs + a `data:pull`
  local mirror — no CORS in dev (the `.dev/` harness serves the pulled copy) or
  deployed (the bucket serves the deploy-published copy). Rejected: demos hardcode
  the absolute CMS dev-bucket URL (CORS from localhost).
- **Decision:** rebuild only `MapEngine`'s `#loadData`/`#createLayers`/
  `#createNavigationSystem` internals over the bundle — rejected: a new
  `WayfinderEngine.js` (duplicates ~600 lines of proven dispose/resize/zoom
  orchestration).
- **Decision:** stores hydrate from the already-parsed model (`hydrate(model)`),
  the engine owns the one fetch — rejected: each store fetching its own URL
  (the green-but-wrong double-fetch QA caught, which left `floorCount===0`).
- **Invariant:** the engine owns the data load (stores never fetch their own URL —
  the double-fetch / `floorCount===0` bug); per init it issues exactly **two
  parallel fetches** (the maps + datas halves) via one `load({mapsUrl, datasUrl})`
  call, and `data:loaded` carries `floorCount===5`. Raw merged arrays are exposed
  verbatim (counts are an honest function of the served data; indexes are derived,
  never authoritative).
- **Invariant:** `BundleModel` is the split firewall — the merged object is
  byte-shape-identical to the old single bundle, so nothing downstream of the
  loader observes that the data arrived in two halves. Validation/merge are the
  *only* code touched; `BundleModel`, stores, layers, router, catalog are
  untouched.
- **Invariant:** deploy syncs the `datas/` mirror **without `--delete`** (the CMS
  owns those bucket objects) and aborts when the local mirror is empty; never
  reintroduce a `--delete` of `datas/`.
- **Invariant:** a structurally invalid bundle yields a `BundleLoadError` /
  emitted error event, never an unhandled throw.
- **Decision:** the dev server is an ownership-aware `.dev/` harness (human vs
  agent owner) rather than a bare `http-server` — rejected: a plain port-bound
  dev script that an agent/QA path could SIGTERM, killing the user's running
  `npm run dev` (the "don't kill my dev server" guarantee).
- **Decision:** the build-infra test builds into an isolated temp dir via
  `WAYFINDER_BUILD_OUT_DIR` (rollup reads it; default `dist`) and asserts a
  `dist/` sentinel survives — rejected: `rmSync(dist) + rollup -c`, which races a
  live `rollup -w` mid-write on the dir the harness is serving on :5010.
- **Invariant:** `npm test` never touches a live dev server's `dist/`; the test
  suite binds no port.

## Tests

- `test/data/BundleLoader.test.js` — single-fetch load, real-SGC counts +
  `navmesh_by_level` keys `{1,2,4,5}`, index joins, mini-bundle data-driven
  counts, missing-key structured error; **plus** the split path:
  `load({mapsUrl, datasUrl})` with two URL-keyed mocked fetches (bodies sliced
  from the fixture via the `splitFixture()` helper) merges to identical counts;
  geometry+`mall` sourced from maps, `shops`/`categories` from datas; unconsumed
  `datas_` extras ignored; a missing geometry key names the maps URL and a missing
  `shops`/`categories` names the datas URL.
- `test/core/Config.split.test.js` — `{mapsUrl, datasUrl}` validates; omitting
  either throws `Config: "mapsUrl"/"datasUrl" is required`; `dataUrl`/`mapUrl` are
  no longer schema keys.
- `test/component/WayfinderMap.split.test.js` — `observedAttributes` includes
  `maps-url`/`datas-url` and excludes `data-url`/`map-url`; init with only one
  present throws the both-required error.
- `test/build/splitData.test.js` — every `demo/*.html` carries the split URLs and
  no `data-url`/`map-url`; `deploy.js` has no `datas/` `--delete`; `.gitignore`
  ignores `datas/*.gz` and the tracked `datas/SGC_v001.json` is gone; a live
  `:5010` GET of `/datas/maps_SGC_v001.json.gz` returns 200 (QA-verified mirror).
- `test/core/MapEngine.bootstrap.test.js` — engine fetches **both** `mapsUrl` and
  `datasUrl` (no `data-url`/`map-url`), `data:loaded` with `floorCount===5`, and
  the engine:error / no-`data:loaded` path on an invalid half.
- `test/build/buildInfra.test.js` — `build` runs rollup **and** stages the
  gallery; `test` runs Vitest; `dev`/`dev:ensure`/`dev:stop`/`dev:status` wire the
  ownership-aware harness; `deploy` wires `scripts/deploy.js`; the harness ships
  all its `.dev/` modules; `config.json` pins 5010 and `resolvePort()` honours
  `$PORT` (no port binding); `dev:stop` refuses a human server without `--force`;
  live-reload injection is idempotent; `rollup.config.js` emits ESM + UMD + min;
  and a real `rollup` build into a temp `WAYFINDER_BUILD_OUT_DIR` emits non-empty
  bundles while a `dist/` sentinel stays untouched.
