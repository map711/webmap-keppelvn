# CLAUDE.md — Keppel Webmap (SGC wayfinder)

Project map + decisions live in `overview.md`; per-capability records in
`capabilities/<slug>.md`. This file is only the cross-cutting gotchas.

## Conventions & gotchas

- **Engine owns the data load; stores never fetch.** `MapEngine.#loadData` loads
  via `BundleLoader.load({mapsUrl, datasUrl})` — **two parallel fetches** of the
  CMS-split halves (`maps_…` geometry + `datas_…` directory), validated per-half
  and **merged** into one `BundleModel`; stores `.hydrate(model)` from the parsed
  model — never let a store fetch its own URL (that was the double-fetch /
  `floorCount===0` bug). The merge is the firewall: the merged object is
  byte-shape-identical to the old single bundle, so `BundleModel` and everything
  downstream is untouched by the split. `load(string)` survives only as the
  self-contained/test shape; a missing key names the offending half's URL.
- **`DisplayNode.rotation` is RADIANS** (converted from `label_rotation` degrees
  once, in the catalog build). Layers consume it as-is — do not re-convert.
- **`getLocationsByUnitId(unitId)` is one-to-many** — always returns a list
  (`[]` / 1 / ≥2 for multi-tenant). Branch on `.length`; never assume a scalar.
- **Editor view-state flags don't render-gate.** `hidden`/`locked`/`opacity` are
  ignored by `MapLevel`; only `is_active === false` drops a unit.
- **`_fitScale` is clamped at 1** — labels shrink to their unit, never upscale.
- **Web Component mutates host DOM in `connectedCallback`, not the constructor**,
  and gates init on **both** `maps-url` + `datas-url` (the split attrs; `data-url`/
  `map-url` are gone). A constructor-time mutation is the "component never mounts,
  labels render nothing" bug.
- **`setFloor` refits by default**; internal pan paths pass `{fitToBounds:false}`.
  Re-derive `minScale` on every refit (a stale `minScale` after a tiny floor
  blocks focus zoom-in). **But the user-facing switch paths — level-selector tap
  and connector-pin (floor-transition) tap — also pass `{fitToBounds:false}`** to
  hold zoom/pan/rotation across levels; only the initial load (or an explicit
  `{fitToBounds:true}`) reframes. A user floor-tap must NOT refit.
- **Bundle counts are seed-sparse, and live ≠ fixture.** The live data is now the
  split `maps_`/`datas_` `.gz` mirror (pulled via `npm run data:pull`, gitignored —
  the committed `datas/SGC_v001.json` is gone); it places **6 shops across L2+L3**,
  with **B2/B1/L1 all unit-less and meshless** (units + navmesh only on L2/L3). The
  pinned **test fixture** `test/fixtures/SGC_v001.json` is the older Phase-1
  snapshot (the **merged** single-bundle shape, sliced into `{maps,datas}` by a
  `splitFixture()` test helper) — **5 placed (all L3)**, B2/B1 carry 1 unit + mesh,
  only L1 empty — and **every test asserts against the fixture**, not live data.
  So: assert data-driven *rules* (never raw counts); keep concrete counts in the
  synthetic **mini-bundle** fixture; don't trust a fixture count as live reality.
- **Tests:** Vitest node-env; pure ports tested via mini-bundle, real 2 MB bundle
  only in opt-in smoke tests. **No test binds a port** — fetch is mocked / fixtures
  read from disk; only `buildInfra.test.js` shells out, to run the real `rollup`.
- **Never run `npm run dev` from an agent/QA path — use `npm run dev:ensure`.**
  The dev server is the ownership-aware `.dev/` harness (zero-dep node server).
  `npm run dev` = `owner=human` (what the user leaves running; serves :5010,
  live-reload, spawns `rollup -c -w`). `dev:ensure` reuses a running server or
  starts a detached `owner=agent` one; `dev:stop` **refuses to stop a human
  server** without `--force`; a later `npm run dev` reclaims an agent-held port.
  This is the "don't kill my `npm run dev`" guarantee — don't reintroduce a path
  that binds :5010 directly or SIGTERMs by port. The harness recognises its own
  servers via `/__dev/health` (sentinel `keppelvn-dev`); a foreign process on
  :5010 makes it fail fast, not kill.
- **Dev/run on port 5010, overridable via `$PORT`** (or `.dev/config.json`).
  Override so a second fork — or a server already holding 5010 — coexists:
  `PORT=5081 npm run dev`. `resolvePort()` reads `$PORT` over config.
- **`npm test` must never touch the dev server's `dist/`.** A live `npm run dev`
  owns `dist/` (`rollup -w` writes it, the harness serves it). The build-infra
  gate therefore builds into an **isolated temp dir** via `WAYFINDER_BUILD_OUT_DIR`
  (rollup reads it; default `dist`) and asserts a sentinel in `dist/` survives —
  so `vitest run` (and every `tars:run` iteration) can run alongside `npm run dev`
  without `rm -rf`-ing the dir the watcher is mid-write on and racing a second
  rollup over the same files (the "my `npm run dev` got killed" bug). Don't revert
  the build test to `rmSync(dist) + rollup -c`.
- **Build & deploy.** `npm run build` = `rollup -c` (the three `dist/` bundles)
  then `scripts/build.js` (stages the demo gallery into `dist/<BUILD_SECRET>/`,
  rewriting `dist/wayfinder-map.esm.js` imports to `../wayfinder-map.min.js`).
  `npm run deploy` builds then `aws s3 sync`s the gallery + min bundle + the local
  `datas/*.gz` mirror to DigitalOcean Spaces — **`datas/` syncs WITHOUT `--delete`**
  (the CMS owns those objects) and deploy **aborts on an empty mirror**. Refresh
  the mirror separately with `npm run data:pull` (zero-dep; pulls the split
  `maps_`/`datas_` `.gz` halves into gitignored `datas/`). Both read `.env`
  (gitignored; `BUILD_SECRET` + `DO_SPACES_*`) via `dotenv`; see `.env.example`.
- **Routing never throws** — `PathFinder.findPath` always returns a typed
  `RouteResult`; callers branch on `result.success` and read `code` on failure.
  Route consumers read per-floor `segments`/`anchors`/`transitions`; never
  synthesize a `Node[]` from the polyline.
- **Connector kind slug is `'elevator'`, not `'lift'`.** The real bundle's
  accessible connector is kind `elevator`; the `routeMode='lift'` toggle maps to
  it. Don't assert `'lift'` as an emitted `transition.kind`.
- **Pin marks the SHOP, not the routing door.** `PinMarkerLayer.#resolveNode`
  prefers the `start/endLocation` **display node** (unit centroid / `label_point`)
  over the route `start/endAnchor` (a door snapped to the corridor edge). The
  polyline ends at the door; the pin sits on the unit. Anchor is the no-Location
  fallback. Door-less units snap the anchor to the centroid so the two coincide —
  the divergence (and any "pin floats in the corridor" regression) only shows for
  units that have a door. Don't flip `#resolveNode` back to anchor-first.
  **The route LINE matches:** `NavigationLayer.setPath` extends the flattened
  polyline with a terminal leg from the door to that same shop anchor (start
  prepend / end append) so the line meets the pin — the navmesh `segments` stay
  door-to-door for distance/funnel; only the drawn line gets the cosmetic leg.
- **Connector-bubble hits are self-describing.** `NavMarkerLayer.hitTest` returns
  `{type:'floor-transition', targetFloor}` (never a bare level string — that gets
  misread as a unit id and the tap silently no-ops). `HitTestManager.#classifyHit`
  short-circuits on `result.type === 'floor-transition'` **before** unit-id
  extraction. Don't collapse `hitTest` back to a plain code.
- **Label font is screen-space `max(minFontSize·dpr, fontSize·√scale·dpr)`**,
  applied once to `ctx.font` then counter-scaled by `1/scale` — a `minFontSize·dpr`
  FLOOR with √scale growth above it. There is **no `_fitScale` unit-shrink** (the
  font is independent of the unit polygon; `labelFit.js` is unused by the layer).
  The overlap-thinning rect width is the **measured screen box** at the active
  font — never `box.width/scale`. Visibility thinning is **cached on
  (scale, rotation)**; `beginZoom()` freezes it and `endZoom()` schedules an idle
  recompute (setTimeout fallback under fake timers) that calls the render
  context's `invalidate`.
