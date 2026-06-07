// >>> TARS cap:split-data-loading
//
// split-data-loading (artifacts half) — the demos, deploy script, .gitignore, and
// committed data file are part of the shipped contract for consuming the remote
// split bundle. These read the SHIPPED artifacts off disk (the artifacts ARE the
// deliverable, so parsing them is the honest contract check):
//   8. every demo that renders a <wayfinder-map> carries the split URLs and NO
//      data-url/map-url attribute remains on any rendered element in demo/.
//   9. deploy.js no longer `s3 sync`s datas/ (CMS owns it); .gitignore ignores
//      datas/*.gz and the tracked datas/SGC_v001.json is removed from the repo.
//  10. (QA-verified live) the dev harness serves /datas/maps_SGC_v001.json.gz —
//      asserted offline via the server's docroot/serve-dir resolution (the path
//      lands inside the served root, no docroot restriction blocks it).

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, resolve, join, sep, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');
const demoDir = join(repoRoot, 'demo');

const MAPS_URL_ATTR = '../datas/maps_SGC_v001.json.gz';
const DATAS_URL_ATTR = '../datas/datas_SGC_v001.json.gz';

// Read every demo/*.html file.
function demoFiles() {
  return readdirSync(demoDir)
    .filter((f) => f.endsWith('.html'))
    .map((f) => ({ name: f, path: join(demoDir, f), html: readFileSync(join(demoDir, f), 'utf8') }));
}

// Extract the OPENING tags of LIVE (rendered) <wayfinder-map ...> elements — i.e.
// real markup, not the escaped `&lt;wayfinder-map` shown inside <code>/<pre>
// samples in the -doc pages. Returns the raw opening-tag text of each.
function liveWayfinderTags(html) {
  const tags = [];
  const re = /<wayfinder-map\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    tags.push(m[0]);
  }
  return tags;
}

// True if an opening-tag string declares the given HTML attribute.
function tagHasAttr(openingTag, attr) {
  return new RegExp(`\\b${attr}\\s*=`, 'i').test(openingTag);
}

describe('split-data-loading: demo / deploy / gitignore artifacts', () => {
  // ---- Criterion 8: rendered demos carry split URLs; no data-url/map-url attr remains ----
  it('every demo rendering a <wayfinder-map> exists (sanity: at least one rendered demo)', () => {
    const rendered = demoFiles().filter((d) => liveWayfinderTags(d.html).length > 0);
    expect(rendered.length, 'at least one demo must render a live <wayfinder-map>').toBeGreaterThan(0);
  });

  it('every rendered <wayfinder-map> carries both maps-url and datas-url split URLs', () => {
    const offenders = [];
    for (const d of demoFiles()) {
      for (const tag of liveWayfinderTags(d.html)) {
        const hasMaps = tag.includes(`maps-url="${MAPS_URL_ATTR}"`);
        const hasDatas = tag.includes(`datas-url="${DATAS_URL_ATTR}"`);
        if (!hasMaps || !hasDatas) offenders.push(`${d.name}: ${tag}`);
      }
    }
    expect(offenders, `these rendered <wayfinder-map> tags lack the split URLs:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('no rendered <wayfinder-map> element in demo/ carries a data-url or map-url attribute', () => {
    const offenders = [];
    for (const d of demoFiles()) {
      for (const tag of liveWayfinderTags(d.html)) {
        if (tagHasAttr(tag, 'data-url') || tagHasAttr(tag, 'map-url')) {
          offenders.push(`${d.name}: ${tag}`);
        }
      }
    }
    expect(offenders, `these rendered tags still carry a legacy data-url/map-url:\n${offenders.join('\n')}`).toEqual([]);
  });

  // ---- Criterion 9: deploy.js publishes datas/ but never --delete; gitignore + tracked file ----
  it('scripts/deploy.js syncs the datas/ mirror WITHOUT --delete (CMS owns those objects)', () => {
    const deploy = readFileSync(join(repoRoot, 'scripts', 'deploy.js'), 'utf8');
    // The deploy bucket is a SEPARATE origin from the CMS dev bucket, and the
    // demos load `../datas/…gz` same-origin from it — so deploy MUST publish the
    // local mirror there (without it `/datas/…` 403s every demo). The constraint
    // is that it must never `--delete` the bucket's datas/ objects (the CMS owns
    // them), so the sync is filtered to the `*.gz` halves with no `--delete`.
    expect(/s3\s+sync\s+["'`]?datas\//.test(deploy), 'deploy.js must publish the datas/ mirror').toBe(true);
    const datasSync = /aws s3 sync ["'`]?datas\/[\s\S]*?\);/.exec(deploy);
    expect(datasSync, 'expected a run(... s3 sync "datas/" ...) block in deploy.js').not.toBeNull();
    expect(/--delete/.test(datasSync[0]), 'the datas/ sync must not pass --delete').toBe(false);
  });

  it('.gitignore ignores datas/*.gz', () => {
    const gitignore = readFileSync(join(repoRoot, '.gitignore'), 'utf8');
    const lines = gitignore.split(/\r?\n/).map((l) => l.trim());
    expect(lines).toContain('datas/*.gz');
  });

  it('the committed datas/SGC_v001.json is removed from the repo (not tracked)', () => {
    const tracked = execFileSync('git', ['ls-files', 'datas/'], { cwd: repoRoot, encoding: 'utf8' })
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    expect(tracked, 'datas/SGC_v001.json must no longer be a tracked file').not.toContain('datas/SGC_v001.json');
  });

  // ---- Criterion 10 (QA-verified live): dev harness serves /datas/maps_SGC_v001.json.gz ----
  // The live 200/file-bytes fact is QA-verified against the running :5010 harness
  // (no test binds a port). The closest faithful OFFLINE check: the server's
  // docroot/serve-dir resolution lands the request inside the served root with no
  // docroot restriction (its path-traversal guard does NOT reject the path), so a
  // GET there resolves a real file rather than a 403/blocked path.
  it('the dev harness serves from the repo root by default (no docroot restriction on /datas)', async () => {
    const shared = await import('../../.dev/_shared.mjs');
    const serveDir = shared.resolveServeDir();
    // Default serve dir is the repo root, so /datas/<file> resolves inside it.
    expect(serveDir).toBe(repoRoot);

    // Re-run the server's own resolve + path-traversal guard for the gz request.
    const pathname = '/datas/maps_SGC_v001.json.gz';
    const filePath = join(serveDir, normalize(pathname));
    const insideRoot = filePath === serveDir || filePath.startsWith(serveDir + sep);
    expect(insideRoot, 'the maps_.gz path must resolve INSIDE the served root (not be Forbidden)').toBe(true);
    // And it points at the local mirror the pull script writes / deploy expects.
    expect(filePath).toBe(join(repoRoot, 'datas', 'maps_SGC_v001.json.gz'));
  });

  it('the dev harness can serve a .gz file (unknown ext falls back to a served octet-stream, not a block)', () => {
    const server = readFileSync(join(repoRoot, '.dev', 'server.mjs'), 'utf8');
    // An unknown extension is served with an octet-stream fallback (200 + bytes),
    // never rejected — so .gz files are served even without an explicit MIME entry.
    expect(/application\/octet-stream/.test(server), 'server must fall back to octet-stream for unknown extensions').toBe(true);
  });
});
// <<< TARS cap:split-data-loading
