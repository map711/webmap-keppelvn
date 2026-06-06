// >>> TARS cap:map-bootstrap
//
// Build / test / dev infrastructure contract (criterion 6). The shell must ship a
// build that emits the three dist bundles, a Vitest test script, and a dev setup
// that serves on port 5080.
//
// The dev setup is the ownership-aware `.dev/` harness (a zero-dep node server),
// NOT a plain http-server. Its whole reason to exist is the survival guarantee:
// an agent/QA run must never kill the human's `npm run dev`. So this gate asserts
//   - `dev` launches the harness server (.dev/server.mjs, owner=human);
//   - `dev:ensure` / `dev:stop` / `dev:status` are wired to the harness;
//   - the harness pins port 5080, overridable via $PORT;
//   - `dev:stop` refuses to stop a non-agent (human) server without --force —
//     the actual "don't kill my dev server" guarantee, asserted on the shipped
//     artifact since there is no port-free behavioral check (no test binds a port);
//   - the live-reload client injection is present and idempotent;
//   - `build` runs rollup AND stages the deploy gallery; `deploy` is wired.
//
// These assert the SHIPPED artifacts (package.json scripts, rollup output config,
// the harness modules) structurally — the artifacts ARE the deliverable, so
// parsing them is the honest contract check, not a source-string proxy for hidden
// behaviour. The pure helpers (resolvePort, injectLivereload) are exercised
// directly; neither binds a port.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, statSync, rmSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');

function readPkg() {
  return JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
}

describe('map-bootstrap: build/test/dev infrastructure', () => {
  it('package.json "build" runs rollup AND stages the deploy gallery', () => {
    const pkg = readPkg();
    expect(pkg.scripts, 'package.json must declare scripts').toBeTruthy();
    expect(typeof pkg.scripts.build, 'a "build" script is required').toBe('string');
    expect(pkg.scripts.build).toMatch(/rollup/);
    expect(pkg.scripts.build).toMatch(/scripts\/build\.js/);
  });

  it('package.json "test" script runs the Vitest suite', () => {
    const pkg = readPkg();
    expect(typeof pkg.scripts.test).toBe('string');
    expect(pkg.scripts.test).toMatch(/vitest/);
  });

  it('package.json "dev" launches the ownership-aware harness server', () => {
    const pkg = readPkg();
    expect(typeof pkg.scripts.dev, 'a "dev" script is required').toBe('string');
    expect(pkg.scripts.dev).toMatch(/\.dev\/server\.mjs/);
    // The old concurrently/http-server compose is gone — the harness owns serving
    // AND the rollup watch, so a watch hiccup can't cascade-kill the server.
    expect(pkg.scripts.dev).not.toMatch(/concurrently/);
    expect(pkg.scripts.dev).not.toMatch(/http-server/);
  });

  it('package.json wires the agent-safe harness commands', () => {
    const pkg = readPkg();
    expect(pkg.scripts['dev:ensure'], 'a "dev:ensure" script is required').toMatch(/\.dev\/ensure\.mjs/);
    expect(pkg.scripts['dev:stop'], 'a "dev:stop" script is required').toMatch(/\.dev\/stop\.mjs/);
    expect(pkg.scripts['dev:status'], 'a "dev:status" script is required').toMatch(/\.dev\/status\.mjs/);
  });

  it('package.json "deploy" is wired to the deploy script', () => {
    const pkg = readPkg();
    expect(typeof pkg.scripts.deploy, 'a "deploy" script is required').toBe('string');
    expect(pkg.scripts.deploy).toMatch(/scripts\/deploy\.js/);
  });

  it('the harness ships all its modules', () => {
    for (const f of ['_shared.mjs', 'server.mjs', 'ensure.mjs', 'stop.mjs', 'status.mjs', 'livereload.mjs', 'config.json']) {
      expect(existsSync(join(repoRoot, '.dev', f)), `.dev/${f} must exist`).toBe(true);
    }
  });

  it('the harness pins port 5080 and honours $PORT (no port binding)', async () => {
    const cfg = JSON.parse(readFileSync(join(repoRoot, '.dev', 'config.json'), 'utf8'));
    expect(cfg.port, 'config.json must pin port 5080').toBe(5080);

    const { resolvePort } = await import(join(repoRoot, '.dev', '_shared.mjs'));
    const saved = process.env.PORT;
    try {
      delete process.env.PORT;
      expect(resolvePort()).toBe(5080); // falls back to config.json
      process.env.PORT = '6123';
      expect(resolvePort()).toBe(6123); // $PORT wins, so a fork can coexist
    } finally {
      if (saved === undefined) delete process.env.PORT;
      else process.env.PORT = saved;
    }
  });

  it('dev:stop refuses to kill a non-agent (human) server without --force', () => {
    // The survival guarantee, asserted on the shipped artifact. No port-free
    // behavioural check exists (no test binds a port), so we pin the guard itself.
    const stop = readFileSync(join(repoRoot, '.dev', 'stop.mjs'), 'utf8');
    expect(stop).toMatch(/owner\s*!==\s*'agent'/);
    expect(stop).toMatch(/--force/);
  });

  it('live-reload client injection is present and idempotent', async () => {
    const { injectLivereload } = await import(join(repoRoot, '.dev', 'livereload.mjs'));
    const once = injectLivereload('<html><body>hi</body></html>');
    expect(once).toMatch(/__dev_livereload/);
    expect(once).toMatch(/EventSource/);
    expect(once.indexOf('</body>')).toBeGreaterThan(once.indexOf('__dev_livereload')); // injected before </body>
    // Idempotent: re-serving an already-injected page must not double-inject.
    const twice = injectLivereload(once);
    expect(twice).toBe(once);
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

  it('`npm run build` emits non-empty ESM + UMD + min bundles WITHOUT clobbering a live dev dist/', () => {
    // The structural checks above only parse config. This one runs the REAL build
    // so a missing toolchain or a broken rollup config fails the gate instead of
    // passing it (a config that "looks right" but cannot build is not a deliverable).
    //
    // Coexistence contract: a running `npm run dev` OWNS dist/ — `rollup -w` writes
    // it and the harness serves it on :5080. So this gate must verify the build
    // WITHOUT deleting or rewriting that shared dist/. Otherwise every `vitest run`
    // during a tars:run rm -rf's the dir the watcher is mid-write on and races a
    // second rollup over the same files — blanking the served bundles and killing
    // the watcher half ("my npm run dev got killed"). We redirect the build into an
    // isolated temp dir via WAYFINDER_BUILD_OUT_DIR and prove dist/ stays untouched.
    const distDir = join(repoRoot, 'dist');
    const sentinel = join(distDir, '.dev-server-live');
    mkdirSync(distDir, { recursive: true });
    writeFileSync(sentinel, 'a running dev server owns this dir');
    const sentinelMtimeBefore = statSync(sentinel).mtimeMs;

    const outDir = mkdtempSync(join(tmpdir(), 'wayfinder-build-'));
    try {
      // Invoke rollup exactly as `npm run build` does, redirected to an isolated
      // out dir. Throws (failing the test) if the toolchain is absent or errors.
      execFileSync('npx', ['rollup', '-c'], {
        cwd: repoRoot,
        stdio: 'pipe',
        env: { ...process.env, WAYFINDER_BUILD_OUT_DIR: outDir }
      });

      for (const name of ['wayfinder-map.esm.js', 'wayfinder-map.umd.js', 'wayfinder-map.min.js']) {
        const file = join(outDir, name);
        expect(existsSync(file), `${name} must build into the isolated out dir`).toBe(true);
        expect(statSync(file).size, `${name} must be non-empty`).toBeGreaterThan(0);
      }

      // The shared dist/ a dev server owns must survive untouched: not deleted
      // (sentinel still present) and not recreated (sentinel mtime unchanged).
      expect(existsSync(sentinel), 'the build must not delete a running dev server\'s dist/').toBe(true);
      expect(statSync(sentinel).mtimeMs, 'the build must not wipe/recreate dist/').toBe(sentinelMtimeBefore);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
      rmSync(sentinel, { force: true });
    }
  }, 120000);
});
// <<< TARS cap:map-bootstrap
