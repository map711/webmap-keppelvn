// Pull the CMS-published split map data into the local `datas/` mirror.
//
// The CMS publishes the SGC bundle as two gzip files at a dev bucket:
//   <BASE>/maps_<MALL>_<VERSION>.json.gz   — geometry + navmesh + transitions
//   <BASE>/datas_<MALL>_<VERSION>.json.gz  — shop directory + categories (+ extras)
//
// `npm run data:pull` downloads both into `datas/` so `npm run dev` serves them
// same-origin and the demos resolve `../datas/...` without CORS. The files are
// gitignored (reproducible via this script) — never committed.
//
// Zero dependency: built-in global `fetch` + node:fs/node:path only (matching
// the repo's zero-dep `.dev/*.mjs` tooling style). Overridable via env:
//   DATA_BASE_URL  (default https://keppelvn-data-dev.indoorcms.com/datas)
//   MALL           (default SGC)
//   VERSION        (default v001)

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_BASE_URL = 'https://keppelvn-data-dev.indoorcms.com/datas';
const DEFAULT_MALL = 'SGC';
const DEFAULT_VERSION = 'v001';

/**
 * Mirror the latest split `.gz` data files into `outDir`.
 *
 * Pure-ish: its only I/O is the injected `fetch` and the on-disk writes into
 * `outDir`. Both halves are fetched and fully validated/buffered BEFORE any file
 * is written, so a non-2xx response on either target rejects without leaving a
 * partial/garbage output file behind.
 *
 * @param {object}   [opts]
 * @param {string}   [opts.baseUrl]  download base (falls back to $DATA_BASE_URL, then default)
 * @param {string}   [opts.mall]     mall slug    (falls back to $MALL, then default)
 * @param {string}   [opts.version]  version slug (falls back to $VERSION, then default)
 * @param {string}    opts.outDir    directory to write the two `.gz` files into
 * @param {Function} [opts.fetch]    injectable fetcher (defaults to global fetch)
 * @returns {Promise<{baseUrl:string, files:string[], outDir:string}>}
 */
export async function pullData(opts = {}) {
  const {
    baseUrl,
    mall,
    version,
    outDir,
    fetch: fetchImpl
  } = opts;

  const base = (baseUrl || process.env.DATA_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const mallSlug = mall || process.env.MALL || DEFAULT_MALL;
  const versionSlug = version || process.env.VERSION || DEFAULT_VERSION;

  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (typeof doFetch !== 'function') {
    throw new Error('pullData: no fetch available — pass `fetch` or run on Node 18+.');
  }
  if (!outDir) {
    throw new Error('pullData: `outDir` is required.');
  }

  const files = [
    `maps_${mallSlug}_${versionSlug}.json.gz`,
    `datas_${mallSlug}_${versionSlug}.json.gz`
  ];

  // Fetch + validate + buffer BOTH halves before writing anything, so a failure
  // on either target leaves no partial/garbage file for that (or the other) target.
  const fetched = await Promise.all(
    files.map(async (name) => {
      const url = `${base}/${name}`;
      const res = await doFetch(url);
      if (!res || !res.ok) {
        const status = res ? res.status : 'no-response';
        const statusText = res && res.statusText ? res.statusText : '';
        throw new Error(`Failed to download ${url}: HTTP ${status} ${statusText}`.trim());
      }
      // Raw bytes verbatim — the .gz mirror is served as-is by the dev harness
      // and decompressed in the browser by DataLoader's DecompressionStream.
      const buffer = Buffer.from(await res.arrayBuffer());
      return { name, url, buffer };
    })
  );

  mkdirSync(outDir, { recursive: true });
  for (const { name, buffer } of fetched) {
    writeFileSync(join(outDir, name), buffer);
  }

  return { baseUrl: base, files, outDir };
}

async function main() {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(__dirname, '..');
  const outDir = join(repoRoot, 'datas');

  const base = (process.env.DATA_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const mall = process.env.MALL || DEFAULT_MALL;
  const version = process.env.VERSION || DEFAULT_VERSION;

  console.log(`Pulling ${mall} ${version} from ${base} into datas/ ...`);
  const result = await pullData({ baseUrl: base, mall, version, outDir });
  for (const name of result.files) {
    process.stdout.write(`  wrote ${join(outDir, name)}\n`);
  }
  console.log('Done. Local mirror refreshed.');
}

// Only run as a CLI when invoked directly — importing the module (e.g. tests)
// must not trigger a network fetch.
const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main().catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}
