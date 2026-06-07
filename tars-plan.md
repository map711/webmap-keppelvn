# Plan — Consume split remote data (`maps_` + `datas_`)

## What & why            (PM ↔ client)

- **Intent:** The CMS has stopped publishing one self-contained `SGC_v001.json`
  bundle and now publishes **two** files to the dev bucket
  (`https://keppelvn-data-dev.indoorcms.com/datas/`): `maps_SGC_v001.json.gz`
  (geometry/navmesh, ~2.6 MB) and `datas_SGC_v001.json.gz` (shop directory + CMS
  content, ~128 KB). This cycle makes the webmap consume those two remote files
  instead of the single locally-bundled `datas/SGC_v001.json`, and adds a pull
  script so local dev mirrors the latest published data. This **amends the
  shipped `map-bootstrap` capability** — it is not a new Phase-3 capability.
- **Constraints:**
  - `BundleModel` and everything downstream of it (stores, layers, router,
    catalog) must stay **untouched** — only the load + merge front-end changes.
  - Tests stay **offline** — fetch mocked, fixtures read from disk, no port
    bound, no network (per the repo's testing invariants).
  - The dev server stays the ownership-aware `.dev/` harness on :5010; nothing
    may reintroduce a path that binds :5010 directly.
  - Deploy must **not** delete the CMS-owned `datas/` objects in the bucket.
- **Decisions:**
  - **Two explicit URLs** (`maps-url` + `datas-url` component attrs) — rejected:
    base-URL+code+version derivation; reusing `data-url` as a base prefix.
  - **Gzip (`.gz`)** transfer — `DataLoader` already decompresses via
    `DecompressionStream`; rejected: plain JSON (2.6 MB uncompressed).
  - **Replace `data-url`/`map-url` entirely** — one load path; rejected: keeping
    single-bundle fallback (two code paths + precedence rule).
  - **Local mirror via pull script + relative demo URLs** — same-origin locally
    (dev serves the pulled copy) *and* deployed (bucket serves the CMS copy), so
    **no CORS**; rejected: demos hardcode the absolute dev-bucket URL (CORS for
    localhost; supersedes an earlier in-conversation choice).
  - **Revises the epic's "single bundle, one `data-url`" cross-cutting
    decision** (`tars-epic.md`) — the producer re-split along its natural
    maps/datas seam, so the consumer follows. The two-store split
    (`LocationStore` + `MapGeometryStore`) and string-namespaced ids are
    unaffected.
  - Source intent: `docs/superpowers/specs/2026-06-07-remote-split-data-design.md`.

## How                   (tech lead — grounded in the codebase)

- **Module map:**
  - `src/data/BundleLoader.js` — `load(url)` → `load({mapsUrl, datasUrl})`; two
    parallel `DataLoader` fetches, per-half validation, merge, `new BundleModel`.
    `BundleModel` + its index-building are **unchanged**.
  - `src/core/Config.js` — replace `dataUrl`(required)/`mapUrl` schema keys with
    `mapsUrl`(required) + `datasUrl`(required).
  - `src/core/MapEngine.js` `#loadData` — read `mapsUrl`+`datasUrl`; call
    `load({mapsUrl, datasUrl})`. Hydration path below it unchanged.
  - `src/component/WayfinderMap.js` — `observedAttributes` drop `data-url`/
    `map-url`, add `maps-url`/`datas-url`; both-required init gate + config build.
  - `scripts/pull-data.js` (new) + `package.json` `data:pull` script.
  - `scripts/deploy.js` — remove the `aws s3 sync "datas/" … --delete` step.
  - `demo/*.html` (+ doc pages) — relative split URLs; `.gitignore` + remove the
    committed `datas/SGC_v001.json`.
- **Patterns:** Follow the existing `DataLoader` gzip/cache contract (no new HTTP
  client in the browser path); follow the repo's **zero-dependency Node tooling**
  style for the pull script (node builtins only, like `.dev/*.mjs`); keep
  `BundleLoadError` as the structured failure type.
- **Integration seams:** The only behavioral seam that moves is
  `BundleLoader.load`'s signature and the component's data attributes. The merge
  produces a byte-shape-identical object to today's single bundle, so
  `BundleModel` is the firewall — nothing downstream observes the split.
- **Reuse:** `DataLoader` (parallel, cached, gzip-aware) for both fetches;
  `BundleModel` + `BundleLoadError` verbatim; the merged on-disk
  `test/fixtures/SGC_v001.json` sliced into `{maps, datas}` by a test helper
  (no new 2 MB fixtures committed).
- **Cross-cutting tech-stack decisions:** None new — this *revises* one existing
  epic decision (single→split bundle). No design panel (one-seam slice, design
  pre-resolved in the approved spec; `--no-panel` by YAGNI).

## Capability breakdown

- [x] `split-data-loading` — webmap loads two remote URLs (`maps-url` +
  `datas-url`), validates each half, merges into the unchanged `BundleModel`;
  `data-url`/`map-url` removed across loader, config, component, engine, demos &
  deploy · depends on: none
- [x] `data-pull-script` — `npm run data:pull` downloads the latest split `.gz`
  files into `datas/` (zero-dep, env-overridable base/mall/version) · depends on: none

## How to test           (the binding acceptance criteria)

### `split-data-loading`

- `BundleLoader.load({mapsUrl, datasUrl})` with two mocked fetches (keyed by URL,
  bodies sliced from the on-disk fixture via a `splitFixture()` helper returning
  `{maps, datas}`) resolves a `BundleModel` whose **merged counts equal today's**:
  5 levels, 10 kinds, 158 units, 20 shops, 10 categories, 2 transitions, and
  `navmesh_by_level` carrying its level keys.
- The merge sources geometry + `mall` from the **maps** half and `shops` +
  `categories` from the **datas** half: the resolved model's `mall` equals the
  maps input's `mall`, and `shopsById`/`categoriesById` resolve an id that exists
  only in the datas input.
- Extra `datas_` keys present on the datas input but unused by the webmap
  (e.g. `banners`, `events`, `malls`) are **ignored** — they do not appear as
  `BundleModel` fields and do not trigger a validation error.
- A required geometry key (e.g. `navmesh_by_level`) missing from the **maps**
  half rejects with a `BundleLoadError` whose message **names the maps URL**; a
  required key (`shops` or `categories`) missing from the **datas** half rejects
  with a `BundleLoadError` whose message **names the datas URL**.
- `new Config({mapsUrl, datasUrl})` validates; omitting `mapsUrl` **or**
  `datasUrl` throws `Config: "mapsUrl"/"datasUrl" is required`; `dataUrl`/`mapUrl`
  are no longer schema keys (a config of only `{dataUrl}` throws for missing
  `mapsUrl`).
- `MapEngine` init (real `BundleLoader`, mocked `globalThis.fetch`, store mocks)
  fetches **both** `mapsUrl` and `datasUrl` and emits `data:loaded` with
  `floorCount === 5`; neither a `data-url` nor a `map-url` is fetched.
- `WayfinderMap.observedAttributes` includes `maps-url` and `datas-url` and
  excludes `data-url`/`map-url`; calling `init()` with only one of the two
  present rejects/throws
  `wayfinder-map: maps-url and datas-url attributes are required`.
- Every `demo/*.html` that renders a `<wayfinder-map>` carries
  `maps-url="../datas/maps_SGC_v001.json.gz"` +
  `datas-url="../datas/datas_SGC_v001.json.gz"` and **no** `data-url`/`map-url`
  attribute remains in `demo/`.
- `scripts/deploy.js` syncs the local `datas/` mirror **without `--delete`** (the
  CMS owns those bucket objects — never delete them) — the deploy bucket is a
  separate origin from the CMS dev bucket and the demos load `../datas/…gz`
  same-origin from it, so deploy must publish the mirror (an empty mirror aborts);
  `.gitignore` ignores `datas/*.gz` and the tracked `datas/SGC_v001.json` is
  removed from the repo. *(Revised from the original "no `s3 sync` of `datas/`"
  criterion — that 403'd every deployed demo; the real constraint is no-`--delete`.)*
- (QA-verified, code-qa) Against the running `.dev/` harness on :5010, a GET of
  `/datas/maps_SGC_v001.json.gz` returns 200 with the file bytes — confirming dev
  serves the local mirror with no docroot restriction.

### `data-pull-script`

- `scripts/pull-data.js` exports an injectable `pullData({baseUrl, mall, version,
  outDir, fetch})`; called with a stub fetcher returning known bytes, it writes
  **both** `maps_SGC_v001.json.gz` and `datas_SGC_v001.json.gz` into `outDir`
  with exactly the fetched bytes.
- The derived download URLs are
  `${baseUrl}/maps_${mall}_${version}.json.gz` and
  `${baseUrl}/datas_${mall}_${version}.json.gz`; defaults are
  `baseUrl=https://keppelvn-data-dev.indoorcms.com/datas`, `mall=SGC`,
  `version=v001`, each overridable via env (`DATA_BASE_URL`, `MALL`, `VERSION`).
- A non-2xx response for either file **rejects** with an error naming the failed
  URL/status and does **not** leave a partial/garbage output file for that target.
- The script imports only Node builtins (`node:*`) — no new `package.json`
  dependency is added; `package.json` `scripts` includes
  `"data:pull": "node scripts/pull-data.js"`.
