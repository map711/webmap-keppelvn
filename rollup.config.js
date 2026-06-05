// Rollup build config: emits the three shipped bundles into dist/ —
//   - dist/wayfinder-map.esm.js   (ESM, for bundlers)
//   - dist/wayfinder-map.umd.js   (UMD, for <script> / require)
//   - dist/wayfinder-map.min.js   (minified UMD)
//
// The plugins are resolved lazily so this config module IMPORTS cleanly even in
// an environment where the rollup plugins are not installed (e.g. the Vitest
// build-infra contract test, which parses `output` without running rollup).
// When rollup actually runs the build, the plugins are present and applied.

async function loadPlugins() {
  try {
    const [{ nodeResolve }, terserMod] = await Promise.all([
      import('@rollup/plugin-node-resolve'),
      import('@rollup/plugin-terser')
    ]);
    const terser = terserMod.default ?? terserMod;
    const base = [nodeResolve({ browser: true, mainFields: ['module', 'main'] })];
    return { base, terser };
  } catch {
    // Plugins unavailable (config is being introspected, not built): no plugins.
    return { base: [], terser: null };
  }
}

const { base: basePlugins, terser } = await loadPlugins();

const input = 'src/index.js';

export default [
  {
    input,
    output: {
      file: 'dist/wayfinder-map.esm.js',
      format: 'esm',
      sourcemap: true
    },
    plugins: basePlugins
  },
  {
    input,
    output: {
      file: 'dist/wayfinder-map.umd.js',
      format: 'umd',
      name: 'WayfinderMap',
      sourcemap: true
    },
    plugins: basePlugins
  },
  {
    input,
    output: {
      file: 'dist/wayfinder-map.min.js',
      format: 'umd',
      name: 'WayfinderMap',
      sourcemap: false
    },
    plugins: terser ? [...basePlugins, terser({ maxWorkers: 1 })] : basePlugins
  }
];
