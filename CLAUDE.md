# CLAUDE.md — Keppel Webmap (SGC wayfinder)

Project map + decisions live in `overview.md`; per-capability records in
`capabilities/<slug>.md`. This file is only the cross-cutting gotchas.

## Conventions & gotchas

- **One fetch per init.** The engine (`MapEngine.#loadData`) owns the single
  `data-url` fetch via `BundleLoader`; stores `.hydrate(model)` from the parsed
  `BundleModel` — never let a store fetch its own URL (that was the double-fetch
  / `floorCount===0` bug).
- **`DisplayNode.rotation` is RADIANS** (converted from `label_rotation` degrees
  once, in the catalog build). Layers consume it as-is — do not re-convert.
- **`getLocationsByUnitId(unitId)` is one-to-many** — always returns a list
  (`[]` / 1 / ≥2 for multi-tenant). Branch on `.length`; never assume a scalar.
- **Editor view-state flags don't render-gate.** `hidden`/`locked`/`opacity` are
  ignored by `MapLevel`; only `is_active === false` drops a unit.
- **`_fitScale` is clamped at 1** — labels shrink to their unit, never upscale.
- **Web Component mutates host DOM in `connectedCallback`, not the constructor**,
  and does **not** require `map-url` (single-bundle). A constructor-time mutation
  / `map-url` gate is the "component never mounts, labels render nothing" bug.
- **`setFloor` refits by default**; internal pan paths pass `{fitToBounds:false}`.
  Re-derive `minScale` on every refit (a stale `minScale` after a tiny floor
  blocks focus zoom-in).
- **Bundle counts are seed-sparse:** 20 shops but only 5 placed (all L3); L1 is
  meshless **and** unit-less. Assert data-driven *rules* against the real
  `SGC_v001.json`; put concrete counts in the synthetic **mini-bundle** fixture.
- **Tests:** Vitest node-env; pure ports tested via mini-bundle, real 2 MB bundle
  only in opt-in smoke tests. Dev/run on **port 5080**.
- **Routing never throws** — `PathFinder.findPath` always returns a typed
  `RouteResult`; callers branch on `result.success` and read `code` on failure.
  Route consumers read per-floor `segments`/`anchors`/`transitions`; never
  synthesize a `Node[]` from the polyline.
- **Connector kind slug is `'elevator'`, not `'lift'`.** The real bundle's
  accessible connector is kind `elevator`; the `routeMode='lift'` toggle maps to
  it. Don't assert `'lift'` as an emitted `transition.kind`.
