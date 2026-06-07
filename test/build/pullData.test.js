// >>> TARS cap:data-pull-script
//
// Data pull script (mirror latest split .gz files locally).
//
// scripts/pull-data.js must expose an INJECTABLE `pullData({baseUrl, mall,
// version, outDir, fetch})` — a pure-ish function whose only I/O is the injected
// fetcher and the on-disk writes into outDir. With a stub fetcher we drive it
// fully offline and assert observable facts:
//   1. both maps_ and datas_ .gz files land in outDir with EXACTLY the fetched
//      bytes (byte-for-byte equality, not just "a file exists").
//   2. the derived download URLs are the split-bundle URLs, and the documented
//      defaults / env overrides (DATA_BASE_URL, MALL, VERSION) are honoured.
//   3. a non-2xx response REJECTS naming the failed URL + status and leaves NO
//      partial/garbage output file for that target.
//   4. the script imports only node:* builtins (no new dep) and package.json
//      wires `"data:pull": "node scripts/pull-data.js"`.
//
// The script's network fetch is fully injected here — no test binds a port and
// no real download happens (matches the repo's hermetic-tests rule).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');
const scriptPath = join(repoRoot, 'scripts', 'pull-data.js');

// Build a stub fetcher: a Response-shaped object per URL, recording every call.
// `routes` maps a URL substring -> { status, statusText, bytes }. Default 200.
function makeFetch(routes = {}, calls = []) {
  return async function stubFetch(url) {
    calls.push(String(url));
    const key = Object.keys(routes).find((k) => String(url).includes(k));
    const r = key ? routes[key] : null;
    const status = r && r.status != null ? r.status : 200;
    const bytes = r && r.bytes != null ? r.bytes : Buffer.from(`BYTES:${url}`);
    const body = Uint8Array.from(bytes);
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: r && r.statusText ? r.statusText : (status === 200 ? 'OK' : 'Error'),
      url: String(url),
      async arrayBuffer() {
        return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
      }
    };
  };
}

async function importPullData() {
  const mod = await import('../../scripts/pull-data.js');
  return mod.pullData;
}

let outDir;
beforeEach(() => {
  outDir = mkdtempSync(join(tmpdir(), 'pull-data-'));
});
afterEach(() => {
  if (outDir && existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
});

describe('data-pull-script: pullData()', () => {
  // ---- Criterion 1: injectable pullData writes BOTH files with exact bytes ----
  it('exports an injectable pullData({baseUrl, mall, version, outDir, fetch})', async () => {
    const pullData = await importPullData();
    expect(typeof pullData, 'scripts/pull-data.js must export a function `pullData`').toBe('function');
  });

  it('writes both maps_ and datas_ .gz files into outDir with EXACTLY the fetched bytes', async () => {
    const pullData = await importPullData();
    const mapsBytes = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x4d, 0x41, 0x50, 0x53]); // gz magic + "MAPS"
    const datasBytes = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x44, 0x41, 0x54, 0x41]); // gz magic + "DATA"

    await pullData({
      baseUrl: 'https://example.test/datas',
      mall: 'SGC',
      version: 'v001',
      outDir,
      fetch: makeFetch({
        'maps_SGC_v001.json.gz': { bytes: mapsBytes },
        'datas_SGC_v001.json.gz': { bytes: datasBytes }
      })
    });

    const mapsPath = join(outDir, 'maps_SGC_v001.json.gz');
    const datasPath = join(outDir, 'datas_SGC_v001.json.gz');
    expect(existsSync(mapsPath), 'maps_SGC_v001.json.gz must be written').toBe(true);
    expect(existsSync(datasPath), 'datas_SGC_v001.json.gz must be written').toBe(true);

    // Byte-for-byte equality — not merely non-empty.
    expect(Buffer.compare(readFileSync(mapsPath), mapsBytes)).toBe(0);
    expect(Buffer.compare(readFileSync(datasPath), datasBytes)).toBe(0);
  });

  // ---- Criterion 2: derived URLs + defaults + env overrides ----
  it('derives ${baseUrl}/maps_${mall}_${version}.json.gz and datas_ URLs from the args', async () => {
    const pullData = await importPullData();
    const calls = [];
    await pullData({
      baseUrl: 'https://cdn.example.test/datas',
      mall: 'XYZ',
      version: 'v009',
      outDir,
      fetch: makeFetch({}, calls)
    });
    expect(calls).toContain('https://cdn.example.test/datas/maps_XYZ_v009.json.gz');
    expect(calls).toContain('https://cdn.example.test/datas/datas_XYZ_v009.json.gz');
  });

  it('uses the documented defaults (keppelvn-data-dev/datas, SGC, v001) when args omitted', async () => {
    const pullData = await importPullData();
    const calls = [];
    // No baseUrl/mall/version, and a clean env so process.env can't supply them.
    const saved = { b: process.env.DATA_BASE_URL, m: process.env.MALL, v: process.env.VERSION };
    delete process.env.DATA_BASE_URL;
    delete process.env.MALL;
    delete process.env.VERSION;
    try {
      await pullData({ outDir, fetch: makeFetch({}, calls) });
    } finally {
      if (saved.b !== undefined) process.env.DATA_BASE_URL = saved.b;
      if (saved.m !== undefined) process.env.MALL = saved.m;
      if (saved.v !== undefined) process.env.VERSION = saved.v;
    }
    expect(calls).toContain('https://keppelvn-data-dev.indoorcms.com/datas/maps_SGC_v001.json.gz');
    expect(calls).toContain('https://keppelvn-data-dev.indoorcms.com/datas/datas_SGC_v001.json.gz');
  });

  it('honours DATA_BASE_URL / MALL / VERSION env overrides when args are omitted', async () => {
    const pullData = await importPullData();
    const calls = [];
    const saved = { b: process.env.DATA_BASE_URL, m: process.env.MALL, v: process.env.VERSION };
    process.env.DATA_BASE_URL = 'https://env.example.test/d';
    process.env.MALL = 'KEP';
    process.env.VERSION = 'v042';
    try {
      await pullData({ outDir, fetch: makeFetch({}, calls) });
    } finally {
      if (saved.b === undefined) delete process.env.DATA_BASE_URL; else process.env.DATA_BASE_URL = saved.b;
      if (saved.m === undefined) delete process.env.MALL; else process.env.MALL = saved.m;
      if (saved.v === undefined) delete process.env.VERSION; else process.env.VERSION = saved.v;
    }
    expect(calls).toContain('https://env.example.test/d/maps_KEP_v042.json.gz');
    expect(calls).toContain('https://env.example.test/d/datas_KEP_v042.json.gz');
  });

  // ---- Criterion 3: non-2xx rejects, names url/status, leaves no partial file ----
  it('rejects when the maps_ file returns a non-2xx response', async () => {
    const pullData = await importPullData();
    const err = await pullData({
      baseUrl: 'https://example.test/datas',
      mall: 'SGC',
      version: 'v001',
      outDir,
      fetch: makeFetch({ 'maps_SGC_v001.json.gz': { status: 404, statusText: 'Not Found' } })
    }).then(() => null, (e) => e);

    expect(err, 'a non-2xx maps_ response must reject').toBeInstanceOf(Error);
    const msg = String(err && err.message);
    expect(msg).toContain('404');
    expect(msg).toContain('maps_SGC_v001.json.gz');
  });

  it('rejects when the datas_ file returns a non-2xx response', async () => {
    const pullData = await importPullData();
    const err = await pullData({
      baseUrl: 'https://example.test/datas',
      mall: 'SGC',
      version: 'v001',
      outDir,
      fetch: makeFetch({ 'datas_SGC_v001.json.gz': { status: 500, statusText: 'Server Error' } })
    }).then(() => null, (e) => e);

    expect(err, 'a non-2xx datas_ response must reject').toBeInstanceOf(Error);
    const msg = String(err && err.message);
    expect(msg).toContain('500');
    expect(msg).toContain('datas_SGC_v001.json.gz');
  });

  it('leaves NO partial/garbage output file for the failed target on a non-2xx response', async () => {
    const pullData = await importPullData();
    await pullData({
      baseUrl: 'https://example.test/datas',
      mall: 'SGC',
      version: 'v001',
      outDir,
      fetch: makeFetch({ 'datas_SGC_v001.json.gz': { status: 403, statusText: 'Forbidden' } })
    }).then(() => null, (e) => e);

    // The failed half must not have been written (no zero-byte/garbage stub left behind).
    expect(
      existsSync(join(outDir, 'datas_SGC_v001.json.gz')),
      'the failed datas_ target must not leave a partial output file'
    ).toBe(false);
  });

  // ---- Criterion 4: node builtins only + package.json wiring ----
  it('imports only node:* builtins (no bare-package import that would add a dependency)', () => {
    const src = readFileSync(scriptPath, 'utf8');
    const importRe = /import\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;
    const offenders = [];
    let m;
    while ((m = importRe.exec(src)) !== null) {
      const spec = m[1];
      const isBuiltin = spec.startsWith('node:');
      const isRelative = spec.startsWith('.') || spec.startsWith('/');
      if (!isBuiltin && !isRelative) offenders.push(spec);
    }
    expect(offenders, `pull-data.js must import only node:* builtins, found: ${offenders.join(', ')}`).toEqual([]);
  });

  it('adds no new runtime/dev dependency to package.json for the pull script', () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    // The pull script is zero-dep node tooling; the only deps present are the
    // pre-existing build/test ones — assert no HTTP client was pulled in.
    for (const banned of ['node-fetch', 'undici', 'got', 'axios', 'request']) {
      expect(deps, `pull-data.js must not introduce an HTTP-client dependency (${banned})`).not.toHaveProperty(banned);
    }
  });

  it('package.json scripts wires "data:pull": "node scripts/pull-data.js"', () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
    expect(pkg.scripts).toHaveProperty('data:pull');
    expect(pkg.scripts['data:pull']).toBe('node scripts/pull-data.js');
  });
});
// <<< TARS cap:data-pull-script
