// >>> TARS cap:map-bootstrap
//
// Build / test / dev infrastructure contract (criterion 6). The forked shell must
// ship a build that emits the three dist bundles, a Vitest test script, and a dev
// setup that serves on port 5080 (the keppelvn port, not sunwaymalls' 5555).
//
// The dev setup is split into composable halves — `dev:watch` (rollup -w) and
// `dev:serve` (http-server) — and a `dev` script that runs both via concurrently.
// The serve port lives on `dev:serve`, so the port assertion now targets that half
// rather than the composed `dev` string. Two further survival rules are asserted:
//   - `dev` must NOT pass `-k`/`--kill-others` to concurrently, so a rollup-watch
//     hiccup can no longer cascade-kill the running http-server.
//   - the two halves must exist as standalone scripts, so each can be run in its own
//     terminal as a fully independent process.
//
// These assert the SHIPPED artifacts (package.json scripts, rollup output config)
// structurally — the artifacts ARE the deliverable, so parsing them is the
// honest contract check, not a source-string proxy for hidden behaviour.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, statSync, rmSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');

function readPkg() {
  return JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
}

describe('map-bootstrap: build/test/dev infrastructure', () => {
  it('package.json exposes a build script that runs rollup', () => {
    const pkg = readPkg();
    expect(pkg.scripts, 'package.json must declare scripts').toBeTruthy();
    expect(typeof pkg.scripts.build, 'a "build" script is required').toBe('string');
    expect(pkg.scripts.build).toMatch(/rollup/);
  });

  it('package.json "test" script runs the Vitest suite', () => {
    const pkg = readPkg();
    expect(typeof pkg.scripts.test).toBe('string');
    expect(pkg.scripts.test).toMatch(/vitest/);
  });

  it('package.json "dev:serve" serves on port 5080 (not 5555)', () => {
    const pkg = readPkg();
    expect(typeof pkg.scripts['dev:serve'], 'a "dev:serve" script is required').toBe('string');
    expect(pkg.scripts['dev:serve']).toMatch(/http-server/);
    expect(pkg.scripts['dev:serve']).toMatch(/-p\s*5080/);
    // The sunwaymalls fork served on 5555 — that port must NOT survive the fork.
    expect(pkg.scripts['dev:serve']).not.toMatch(/5555/);
  });

  it('package.json exposes "dev:watch" as a standalone rollup watcher', () => {
    const pkg = readPkg();
    expect(typeof pkg.scripts['dev:watch'], 'a "dev:watch" script is required').toBe('string');
    expect(pkg.scripts['dev:watch']).toMatch(/rollup/);
    expect(pkg.scripts['dev:watch']).toMatch(/-w\b|--watch/);
  });

  it('package.json "dev" runs both halves WITHOUT a cascade kill', () => {
    const pkg = readPkg();
    expect(typeof pkg.scripts.dev, 'a "dev" script is required').toBe('string');
    // dev composes the two halves (one-terminal convenience).
    expect(pkg.scripts.dev).toMatch(/concurrently/);
    expect(pkg.scripts.dev).toMatch(/dev:watch/);
    expect(pkg.scripts.dev).toMatch(/dev:serve/);
    // No -k / --kill-others: a rollup-watch hiccup must not tear down the server.
    expect(pkg.scripts.dev).not.toMatch(/(^|\s)-k(\s|$)/);
    expect(pkg.scripts.dev).not.toMatch(/--kill-others/);
  });

  it('rollup.config.js emits ESM + UMD + minified UMD bundles into dist/', async () => {
    const rollupConfigPath = join(repoRoot, 'rollup.config.js');
    expect(existsSync(rollupConfigPath), 'rollup.config.js must exist').toBe(true);

    const mod = await import(rollupConfigPath);
    const config = mod.default;
    const builds = Array.isArray(config) ? config : [config];

    const outputs = builds.flatMap((b) => {
      const out = b.output;
      return Array.isArray(out) ? out : [out];
    });

    const files = outputs.map((o) => o.file);
    const formats = outputs.map((o) => o.format);

    // Every emitted file lands under dist/.
    expect(files.length).toBeGreaterThanOrEqual(3);
    expect(files.every((f) => typeof f === 'string' && f.startsWith('dist/'))).toBe(true);

    // ESM build present.
    expect(formats).toContain('esm');
    // UMD build(s) present (the plain UMD and the minified UMD).
    expect(formats.filter((f) => f === 'umd').length).toBeGreaterThanOrEqual(2);

    // A dedicated minified bundle (".min.") is among the outputs.
    expect(files.some((f) => /\.min\.js$/.test(f)), 'a *.min.js bundle is required').toBe(true);
    // An ESM bundle file is among the outputs.
    expect(files.some((f) => /\.esm\.js$/.test(f) || /\.mjs$/.test(f)), 'an ESM bundle file is required').toBe(true);
  });

  it('`npm run build` actually emits non-empty ESM + UMD + min bundles into dist/', () => {
    // The structural checks above only parse config. This one runs the REAL build
    // so a missing toolchain or a broken rollup config fails the gate instead of
    // passing it (a config that "looks right" but cannot build is not a deliverable).
    const expected = [
      join(repoRoot, 'dist', 'wayfinder-map.esm.js'),
      join(repoRoot, 'dist', 'wayfinder-map.umd.js'),
      join(repoRoot, 'dist', 'wayfinder-map.min.js')
    ];

    // Start from a clean slate so we prove THIS run produced the bundles.
    rmSync(join(repoRoot, 'dist'), { recursive: true, force: true });

    // Invoke rollup exactly as `npm run build` does. Throws (failing the test) if
    // the toolchain is absent or the build errors.
    execFileSync('npx', ['rollup', '-c'], {
      cwd: repoRoot,
      stdio: 'pipe'
    });

    for (const file of expected) {
      expect(existsSync(file), `${file} must exist after the build`).toBe(true);
      expect(statSync(file).size, `${file} must be non-empty`).toBeGreaterThan(0);
    }
  }, 120000);
});
// <<< TARS cap:map-bootstrap
