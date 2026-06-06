# Epic — Keppel Webmap (Saigon Centre wayfinder)

## Intent

A standalone, browser-first indoor wayfinding map for **Saigon Centre (SGC)** — a Keppel mall — shipped as a `<wayfinder-map>` Web Component. It reuses a product *shell* (a polished Canvas-2D component + UI + build/deploy), but replaces its data/render/routing *guts* with logic ported from the `indoorcms-keppelvn` CMS (`static/map/` renderer + `static/routing/` navmesh wayfinding), because the engine must consume the CMS's published bundle `datas/SGC_v001.json` — GeoJSON-polygon units in raw coordinates + a navmesh triangulation + cross-floor transitions — which a node-graph engine cannot. The CMS is the *producer* of the bundle; this webmap is the *consumer*. The two meet only at `SGC_v001.json`.

## Cross-cutting decisions

Resolved once here (via the epic-scope design panel: reuse-first spine + clean-seam & pragmatic grafts) so each phase's `tars-plan.md` inherits them instead of re-litigating.

- **Renderer strategy** — keep the **Canvas-2D** renderer + component shell; port the indoorcms *logic* (style cascade, label placement, navmesh routing) into the existing layer/store classes by replacing their internals **in place**. Rejected: swap to **Konva** (re-plumbs the proven gesture/marker/animation shell); add parallel `Navmesh*Layer` files (dead-code clutter in a greenfield fork).
- **Engine** — keep `src/core/MapEngine.js`; rebuild only its `#loadData` / `#createLayers` / `#createNavigationSystem` internals. Rejected: a new `WayfinderEngine.js` (rewrites ~600 lines of proven dispose/resize/zoom-debounce/animateTo orchestration).
- **Data contract** — **single bundle**, one `data-url` → `SGC_v001.json` (retire `map-url`). Preserve the two-store split (`LocationStore` + `MapGeometryStore`) as the public seam; rebuild their internals from the bundle. Rejected: unify into one store (touches every layer/engine read site); keep `map-url` (there is no second file).
- **Destination identity** — **string-namespaced ids**: one `Location` per tenanted shop = `shop:<shop_id>` (a multi-unit shop carries all `unitIds[]` + spanned `levelCodes[]`); one `Location` per routable non-connector facility unit = `unit:<unit_id>`. Connectors (escalator/elevator/stairs) are **never** Locations — they are traversed, not targeted. `focus` / `you-are-here` re-key from node-id → these ids. Rejected: numeric ids with a `+1_000_000` facility offset (fragile, silent collisions).
- **Route result shape** — replace `PathResult.path: Node[]` with **per-floor polyline segments** `segments: Map<levelCode, [x,y][]>` + `transitions: RouteTransition[]` + `startAnchor`/`endAnchor`. Rejected: synthesize fake `Node[]` from polyline points (a lie that breaks any `node.peers`/`node.id` consumer and the cross-floor split).
- **Coordinate space** — keep **raw CMS units** throughout; `renderScale = 1` (identity). A level's `width`/`height` come from `navmesh_by_level[level].envelope_dims`, with a **unit-polygon bbox union** fallback for meshless levels (L1). Rejected: normalize to 0–1 × renderScale (FP drift, ambiguous for L1, forces coordination across store/router/labels).
- **Route preferences** — escalator/lift is a **soft penalty** (preferred connector kind = `transition.cost`; non-preferred = `cost + 100`) so a route still exists when only the non-preferred connector is available; **step-free** is a **hard gate** (`is_accessible` transitions only, else a structured error). Rejected: hard-filter by kind (returns *no route* on single-connector floors).
- **Floor hit-testing** — the floor layer is **unit-aware**: each unit polygon draws with its own resolved style and retains its `unitId`, so `hitTest` returns a `unitId` → enabling "tap a shop polygon to select it" (the indoorcms behavior). Rejected: style-grouped meshes (lose per-unit identity, no polygon tap-to-select).
- **Meshless level (L1)** — L1 renders, browses, and searches normally; only *routing* to/from/through it returns a structured error. The floor stays visible in the selector. Rejected: hide L1, or fake a detour transition.
- **Testing** — Vitest node-env. Drive deterministic unit tests of the pure ports (loader, style cascade, label fit, navmesh router) from a hand-authored **synthetic mini-bundle fixture** (2 levels incl. a meshless case, shops + escalator + elevator + 1 transition, a tiny navmesh with known triangles). The real 2 MB `SGC_v001.json` is exercised only in one opt-in/slow integration smoke test. Rejected: the real bundle in every test (slow, non-deterministic, hard to assert).
- **Dev / build / run** — dev server and local run on **port 5010** (the `concurrently` dev script's `http-server -p 5010`). Build stays Rollup → ESM/UMD/min; deploy config (DO Spaces) is inherited as-is, not a build target this epic.

## Phases

1. **Browse the map** ✓ — builds `map-bootstrap`, `destination-catalog`, `floor-rendering`, `map-labels`, `floor-switching`, `destination-search`, `destination-focus`
2. **Wayfinding** ✓ — builds `navmesh-routing`, `route-preferences`, `route-rendering`, `route-markers`, `search-to-route`, `unroutable-level-handling`
3. **Kiosk & share** ◀ — builds `kiosk-here`, `deep-link-state`, `qr-share`, `brand-theming`

## Dependency tree

```
map-bootstrap                         (fork shell + single-bundle load + index + engine init + run@5010)
├── destination-catalog               (shops+facilities → Location catalog)
│   └── destination-search (ui)       (depends on map-labels too)
├── floor-rendering (ui)              (per-unit polygons + style cascade + hit-test)
│   ├── map-labels (ui)              (depends on destination-catalog too)
│   ├── floor-switching (ui)
│   └── destination-focus (ui)       (depends on destination-search too)
│
├── navmesh-routing                  [P2]  (A* + funnel + cross-floor + transitions)
│   ├── route-preferences            [P2]  (escalator/lift soft penalty + step-free hard gate)
│   ├── route-rendering (ui)         [P2]  (depends on floor-switching)
│   │   └── route-markers (ui)       [P2]  (start/end pins + floor-transition bubbles)
│   ├── search-to-route (ui)         [P2]  (depends on destination-search)
│   └── unroutable-level-handling    [P2]  (L1 + no-path structured errors)
│
└── (P3)
    ├── kiosk-here (ui)              (depends on navmesh-routing, destination-focus)
    ├── deep-link-state             (depends on route + focus state)
    │   └── qr-share (ui)
    └── brand-theming (ui)          (Keppel palette/icons + SGC demo set)
```

## Current phase

**Kiosk & share** (Phase 3) — Phase 1 *Browse the map* (7/7 green) and Phase 2 *Wayfinding* (6/6 green, 0 blocked) shipped and are now in git history. A live-browser smoke pass is owed for Phase 2's three `(ui)` capabilities (`/tars:review --ui`). The next `/tars:plan` targets Phase 3.
