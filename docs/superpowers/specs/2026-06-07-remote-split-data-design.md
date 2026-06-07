# Design — webmap consumes split remote data (`maps_` + `datas_`)

**Date:** 2026-06-07
**Status:** Approved (pending spec review)
**Capability touched:** `map-bootstrap` (load + merge front-end only)

## Problem

The CMS has refactored its published SGC data from one self-contained bundle
into **two files**, served from the dev bucket
`https://keppelvn-data-dev.indoorcms.com/datas/`:

- `maps_SGC_v001.json.gz` — geometry/navmesh (~2.6 MB uncompressed)
- `datas_SGC_v001.json.gz` — directory + CMS content (~128 KB)

The webmap currently loads a single locally-bundled `datas/SGC_v001.json` via a
single `data-url`. We want it to consume the two remote files instead.

## Key insight: the split mirrors webmap's own model

`BundleModel` needs these nine top-level keys; the split divides them cleanly:

| `BundleModel` key | Source file |
|---|---|
| `mall, levels, layers, kinds, units, navmesh_by_level, transitions` | **`maps_`** |
| `shops, categories` | **`datas_`** |

`datas_` also carries `malls, banners, events, news, popups, sections,
campaigns, terms_and_conditions, privacy_policy, faq` (and the full 250-shop
directory) — **all unused by the webmap**. The unit→shop link is
`unit.tenancies[].shop_id`, and every placed `shop_id` resolves in
`datas_.shops`.

Therefore **`BundleModel` and everything downstream of it are untouched**. Only
the load + merge front-end changes. This is effectively a clean re-introduction
of the old two-file split (`map-url` = geometry, `data-url` = catalog) that was
previously merged — but split along the producer's natural maps/datas seam.

## Decisions (resolved during brainstorming)

- **Two explicit URLs** — component attrs `maps-url` + `datas-url` (full URLs).
  Rejected: base-URL + code + version derivation; reusing `data-url` as a base.
- **Gzip (`.gz`)** — fetch the compressed files; `DataLoader` already decompresses
  via `DecompressionStream` (and handles server `Content-Encoding: gzip`).
- **Remote-only, test fixtures kept** — demos load from `datas/`; tests stay
  offline reading disk fixtures.
- **Replace `data-url` entirely** — drop single-bundle support; one load path.
- **Local mirror + pull script** (added requirement): a script downloads the
  latest `.gz` files into `datas/`; `npm run dev` serves them; demos reference
  relative `../datas/...` (same-origin local *and* deployed → **no CORS**). This
  supersedes the earlier "demos hardcode the dev bucket URL" choice; the absolute
  bucket URL now lives only in the pull script and in docs as the production
  `maps-url` example.

## Data flow

```
<wayfinder-map maps-url=… datas-url=…>
   → Config { mapsUrl, datasUrl }            (replaces dataUrl/mapUrl)
   → MapEngine.#loadData
   → BundleLoader.load({ mapsUrl, datasUrl })
        ├─ DataLoader.load(mapsUrl)   ⟍ parallel, gzip-aware (existing)
        └─ DataLoader.load(datasUrl)  ⟋
        → validate each half → MERGE → new BundleModel(merged)   ← unchanged below
```

**Merge:** `merged = { ...maps, shops: datas.shops, categories: datas.categories }`.
`maps_` supplies `mall` + geometry; `datas_` supplies `shops` + `categories`;
extra `datas_` keys are ignored. The merged object is byte-shape-identical to
what `BundleModel` consumes today.

## Components & changes

### `src/data/BundleLoader.js`
- Change `load(url)` → **`load({ mapsUrl, datasUrl })`**: `Promise.all` the two
  `DataLoader` fetches, validate each half, merge, `new BundleModel(merged)`.
- **Validation split** — `maps_` required keys: `levels, layers, kinds, units,
  navmesh_by_level, transitions`; `datas_` required keys: `shops, categories`.
  `BundleLoadError` messages name **which file** is broken.
- `BundleModel` and the existing index-building logic are unchanged.
- *Rejected:* separate `MapsLoader`/`DatasLoader` classes (splits `BundleModel`
  construction, more surface); keeping a dead `load(url)` single path.

### `src/core/Config.js`
- Replace `dataUrl: { required: true }` and `mapUrl` with
  `mapsUrl: { type: 'string', required: true }` and
  `datasUrl: { type: 'string', required: true }`.

### `src/core/MapEngine.js`
- `#loadData`: read `mapsUrl` + `datasUrl` from config; call
  `this.#bundleLoader.load({ mapsUrl, datasUrl })`. Downstream unchanged.

### `src/component/WayfinderMap.js`
- `observedAttributes`: drop `data-url`/`map-url`; add `maps-url`/`datas-url`.
- `init()` gate requires **both**; error:
  `"wayfinder-map: maps-url and datas-url attributes are required"`.
- Config build reads `maps-url` + `datas-url`.
- The connect-time auto-init triggers when both attrs are present.

### `scripts/pull-data.js` (new) + `package.json`
- `npm run data:pull` → downloads `maps_SGC_v001.json.gz` +
  `datas_SGC_v001.json.gz` into `datas/`.
- Base URL / mall / version overridable via env (default base
  `https://keppelvn-data-dev.indoorcms.com/datas`, mall `SGC`, version `v001`).
- Zero-dependency Node (use built-in `fetch`/`https` + `fs`), matching the
  repo's zero-dep tooling style.

### Dev harness
- `npm run dev` serves the repo root, so `datas/*.gz` is reachable at
  `/datas/...` and demos under `/demo/*.html` resolve `../datas/...`. Confirm the
  harness has no docroot restriction that hides `datas/`; if it does, widen it.

### Demos (`demo/*.html`)
- Replace every `data-url="../datas/SGC_v001.json"` with:
  ```
  maps-url="../datas/maps_SGC_v001.json.gz"
  datas-url="../datas/datas_SGC_v001.json.gz"
  ```
- Update demo doc pages that describe the single-`data-url` / no-`map-url` API to
  describe `maps-url` + `datas-url`.

### `scripts/deploy.js`
- **Remove the `aws s3 sync "datas/" … --delete` step** — it would wipe the
  CMS-owned `datas/` files. Deploy pushes only the gallery + `wayfinder-map.min.js`.

### `.gitignore` + repo
- Gitignore `datas/*.gz` (reproducible via `data:pull`); remove the committed
  `datas/SGC_v001.json`.

## Tests (stay offline)

- `test/data/BundleLoader.test.js`: drive `load({mapsUrl,datasUrl})`. Add a
  `splitFixture()` helper that slices the on-disk merged
  `test/fixtures/SGC_v001.json` into `{maps, datas}`. Two mocked fetches keyed by
  URL. Assert:
  - merged counts unchanged (5 levels, 10 kinds, 158 units, 20 shops, 10
    categories, 2 transitions, navmesh keys present);
  - a required key missing from `maps_` rejects with a `BundleLoadError` naming
    the maps file;
  - a required key missing from `datas_` rejects naming the datas file;
  - extra `datas_` keys (e.g. `banners`) are ignored, not validated.
- `test/core/MapEngine.bootstrap.test.js`: swap `dataUrl` for `mapsUrl`+`datasUrl`;
  assert **both** URLs are fetched and `floorCount === 5`.
- Audit remaining tests for `dataUrl` in engine/component config and swap to the
  two-URL pair (most inject `BundleModel`/`hydrate` directly and are unaffected).
- Fixtures remain on disk; no test binds a port or hits the network.

## Error handling

Either fetch failing (network or validation) rejects `BundleLoader.load` →
`#loadData` rejects → `init()` rejects. Same failure surface as a structurally
broken single bundle today; no partial render, no `data:loaded` emitted.

## Out of scope (YAGNI)

- Base-URL + version derivation / manifest files.
- Single-bundle `data-url` backward-compat fallback.
- Runtime version switching or multi-mall selection in the component.
- Caching beyond `DataLoader`'s existing in-memory map.

## Prerequisites / risks

- The dev bucket must keep `maps_SGC_v001.json.gz` + `datas_SGC_v001.json.gz`
  published at `/datas/` (the CMS owns this). Deployed demos depend on their
  presence; `data:pull` depends on them for local dev.
- CORS is avoided by the relative-path + local-mirror approach; if a future
  consumer points `maps-url`/`datas-url` cross-origin at the bucket, the bucket
  needs `Access-Control-Allow-Origin`.
