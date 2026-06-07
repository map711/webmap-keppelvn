# data-pull-script

## Purpose

Mirror the CMS-published split map data into the local `datas/` directory so
`npm run dev` serves it same-origin (and the demos resolve `../datas/…` without
CORS). The CMS publishes the SGC bundle as two gzip files on a dev bucket; this
script downloads both into `datas/` on demand — a deliberate, separate step from
deploy, so you control which data version ships. The mirror is gitignored
(reproducible via this script), never committed.

## Behavior

- `npm run data:pull` (= `node scripts/pull-data.js`) downloads both halves —
  `maps_<MALL>_<VERSION>.json.gz` and `datas_<MALL>_<VERSION>.json.gz` — into the
  repo's `datas/` directory, writing the fetched bytes **verbatim** (the `.gz`
  mirror is served as-is and decompressed in the browser by `DataLoader`'s
  `DecompressionStream`).
- The download URLs are derived as `${baseUrl}/maps_${mall}_${version}.json.gz`
  and `${baseUrl}/datas_${mall}_${version}.json.gz`. Defaults are
  `baseUrl=https://keppelvn-data-dev.indoorcms.com/datas`, `mall=SGC`,
  `version=v001`, each overridable via env (`DATA_BASE_URL`, `MALL`, `VERSION`);
  a trailing slash on the base is trimmed.
- **All-or-nothing writes:** both halves are fetched, checked for a 2xx response,
  and fully buffered **before any file is written**, so a non-2xx response on
  either target rejects (with an error naming the failed URL + status) and leaves
  **no partial/garbage file** for that or the other target.
- Importing the module (e.g. from a test) does **not** trigger a network fetch —
  the CLI `main()` runs only when the script is invoked directly (`process.argv[1]`
  resolves to this file); on a CLI error it prints `Error: <message>` and exits 1.

## Interfaces & contracts

- `export async function pullData({baseUrl?, mall?, version?, outDir, fetch?})
  → Promise<{baseUrl, files, outDir}>` — injectable fetcher (defaults to global
  `fetch`); `outDir` required. Each option falls back to its env var then its
  default. Returns the resolved base, the two written filenames, and `outDir`.
- Throws when no `fetch` is available, when `outDir` is missing, or when either
  download is non-2xx (error names the failed URL + HTTP status).
- `package.json` `scripts."data:pull": "node scripts/pull-data.js"`.

## Data model

- Produces two on-disk artifacts in `outDir` (the repo `datas/`):
  `maps_<MALL>_<VERSION>.json.gz` and `datas_<MALL>_<VERSION>.json.gz` — the
  exact bytes published by the CMS. These are the local mirror that
  `map-bootstrap`'s split loader and the demo gallery consume; gitignored via
  `datas/*.gz`.

## Decisions & constraints

- **Decision:** zero new dependencies — Node builtins only (`node:fs`,
  `node:path`, `node:url`, global `fetch`), matching the repo's zero-dep
  `.dev/*.mjs` tooling style. Rejected: an HTTP client / download library.
- **Decision:** an injectable `fetch` + required `outDir` make `pullData()`
  deterministically testable with a stub fetcher writing to a temp dir — no
  network, no real bucket. Rejected: a non-injectable script that can only be
  exercised by hitting the live bucket.
- **Invariant:** buffer-both-before-write — a failed half never leaves a partial
  output file (no half-written `.gz` that the dev harness would serve as garbage).
- **Constraint:** pulling is decoupled from deploy on purpose — deploy ships the
  mirror **as-is** and aborts if it's empty (see `map-bootstrap`), so refreshing
  data is an explicit `data:pull`, not a build side-effect.

## Tests

- `test/build/pullData.test.js` — stub-fetch writes both `.gz` files with exactly
  the fetched bytes; URL + env-override derivation (`DATA_BASE_URL`/`MALL`/
  `VERSION`); non-2xx on either target rejects naming the URL/status and leaves no
  partial file; imports only `node:*` builtins (no new dependency) + a CLI smoke
  that an import triggers no fetch.
