# Plan — Label legibility & zoom-responsive sizing

<!-- Single-cycle refinement of the shipped Phase-1 `map-labels` capability. NOT an
epic phase — the epic marker stays on Phase 3 (Kiosk & share). At /tars:cleanup this
folds into capabilities/map-labels.md (fix/amend, same slug). -->

## What & why            (PM ↔ client)

- **Intent:** Shop labels on the SGC map currently render **microscopic and
  unreadable** — especially zoomed out — and the zoom range "feels off." Re-work
  the `map-labels` capability so labels stay **constant-readable** at any zoom,
  grow gently as you zoom in, and never depend on how small the unit polygon is —
  matching the proven label behavior the shell already provides. Also fold in the
  label **visibility-caching / idle-recompute**
  machinery, because label density on SGC is expected to grow and per-frame
  overlap thinning must stay cheap.
- **Constraints:**
  - **Re-work in place.** Change only `src/layers/LocationLayer.js` internals (+
    its tests + the doc note). Keep the layer's role and its place in the engine/
    render loop. `labelFit.js` stays as a pure util (no longer in the render path);
    `node.unitWidth/unitHeight` become unused by the layer but are not removed.
  - **No engine/renderer wiring changes.** `MapEngine` already calls
    `#locationLayer.beginZoom?.()` / `endZoom?.()` and `renderContext` already
    carries `invalidate` + `dpr` — the hooks are just unimplemented today.
  - **Behavior-changing** to `map-labels`: the documented `_fitScale`
    shrink-to-fit promise is replaced by a min-size-floor promise. (User confirmed
    via the fix-mode adherence gate → escalated here for planning rigor.)
  - **Zoom mechanism is NOT restructured.** The fit/min/max clamp path is already
    correct; `maxZoom: 2.5` stays the default. "Zoom feels off" is dominated
    by unreadable labels; re-evaluate the single `maxZoom` value only at
    verification time if zoom-in still feels short — it is not a gated criterion.
  - Canvas-2D, raw CMS coords (`renderScale = 1`), Vitest node-env with the mocked
    2D canvas shim, dev/run on port 5080. Public layer/engine API stays intact.
  - **Out of scope:** wiring `labelFontSize` config→layer beyond the `#style`
    block already in use; activating the suppressed-label *fade* in the render
    loop (ported as latent capability); any change to focus/route
    label behavior.
- **Decisions:**
  - **Adopt a screen-space, zoom-responsive font** — `fontSize =
    base · √scale · dpr`, floored at `minFontSize · dpr`, drawn under the existing
    `1/scale` counter-scale so the label is constant screen size and grows by
    √scale. *Rejected:* keep the fixed world-space font and only raise the
    constant (still scales 1:1 with zoom, still no floor — the actual bug).
  - **Drop `_fitScale` from the render path** — label size is independent of unit
    polygon extents. *Rejected:* a hybrid that keeps the unit-shrink (tiny units
    still get tiny labels).
  - **Adopt visibility caching + idle recompute + quantized text-metrics**
    — recompute the visible/suppressed sets only on scale/rotation change; freeze
    during a zoom gesture (`beginZoom`/`endZoom`) and re-thin on idle via
    `invalidate`. *Rejected:* keep keppel's inline per-frame thinning (fine today,
    but the user explicitly wants headroom for growing label counts).
  - **Reuse the `map-labels` slug** so cleanup amends the existing record.
    *Rejected:* a new slug (fragments one capability across two records).

## How                   (tech lead — grounded in the codebase)

- **Module map:** all substantive change in `src/layers/LocationLayer.js`. Tests in
  `test/layers/MapLabels.test.js`. Doc note in `CLAUDE.md`. The durable record
  `capabilities/map-labels.md` is amended at cleanup (not now).
- **Patterns:** implement the label mechanism in `src/layers/LocationLayer.js`
  **adapted to keppel's data
  model** — keep keppel's node accessors (`#labelableNodesOnLevel()` over
  `store.locations[].displayNodes`, `node.labelable`, `node.levelCode`,
  `node.text`).
- **Integration seams:** none new. `renderWithContext(renderContext)` consumes the
  already-passed `{ ctx, dpr, scale, rotation, invalidate }`. `beginZoom()` /
  `endZoom()` implement the no-op hooks the engine already calls
  (`MapEngine.js:1077`/`1098`).
- **Reuse:** the shared `computeVisibleRects` (`src/renderer/RectVisibility.js`) for
  overlap thinning; the existing `1/scale` counter-scale and
  rotation-flip logic already in `#drawLabel`; `labelFit.js` stays importable but
  unused by the layer.
- **Cross-cutting tech-stack decisions:** none new — inherits the epic's Canvas-2D /
  raw-coords / Vitest decisions. `--no-panel`: the design fork (full port vs
  hybrid vs tune-only) was resolved during brainstorming; the `code-explorer`
  diagnosis proved the root cause. A single grounded pass produced this *How*.

<!-- Decision log: no panel (design pre-settled in the approved design doc
docs/superpowers/specs/2026-06-06-label-sizing-and-zoom-design.md + code-explorer
diagnosis). Sub-decisions: (a) reuse map-labels slug; (b) keep keppel data
accessors, port only the mechanism; (c) zoom mechanism untouched, maxZoom tuned at
verification only; (d) suppressed-fade ported latent, not activated. -->

## Capability breakdown

- [x] `map-labels` `(ui)` — re-work LocationLayer label sizing: zoom-responsive
  screen-space font (`base·√scale·dpr` floored at `minFontSize·dpr`), drop the
  `_fitScale` unit-shrink, fix the `#screenRect` thinning-rect `/scale` mismatch,
  and add visibility caching / idle-recompute / quantized-text-metrics +
  `beginZoom`/`endZoom`. · depends on: Phase-1 `destination-catalog`,
  `floor-rendering` (shipped); re-works shipped Phase-1 `map-labels`

## How to test           (the binding acceptance criteria)

<!-- All criteria are node-env Vitest, driven through the existing mocked 2D canvas
shim in test/layers/MapLabels.test.js. The font a label is drawn at is observable
via the `ctx.font` string set in #applyFont; the overlap-thinning rects via the
layer's screen-rect path / `visibleLabels`. measureText in the shim is deterministic
(width ∝ char count), so font px and box widths are assertable. -->

### `map-labels` `(ui)`
- **Min-size floor (the core fix):** rendering at a small zoom (`scale = 0.05`,
  `dpr = 1`, `minFontSize = 8`) applies a font whose px size is **≥ 8** — never the
  pre-fix microscopic value. Assert `parseFloat(ctx.font) >= minFontSize * dpr`.
  (FAILS today: the fixed `style.fontSize` path emits the same small px at every
  scale with no floor.)
- **√scale growth above the floor:** with `fontSize = 8`, `minFontSize = 8`, the
  font at `scale = 4` is **strictly greater** than at `scale = 1`
  (`8·√4 = 16 > 8·√1 = 8`), and at `scale = 0.25` it equals the floor (`8`). Assert
  the ordering `font(0.25) == 8 < font(4)` and `font(4) > font(1)`. (FAILS today:
  font is constant across scales.)
- **dpr scales the floor and the size:** at the same small `scale = 0.25`,
  `font(dpr = 2) == 2 × font(dpr = 1)` (the floor is `minFontSize · dpr`). Assert
  the px doubles with dpr.
- **Independent of unit polygon size:** two labelable nodes with **identical text
  and identical scale/dpr** but very different `unitWidth/unitHeight` (e.g. 20×12 vs
  2000×2000) are drawn at the **same** font px — the `_fitScale` unit-shrink is
  gone. Assert the two emitted font sizes are equal. (FAILS today: the small unit's
  label is shrunk by `_fitScale`.)
- **Thinning rect matches the drawn footprint:** the overlap-suppression screen-rect
  for a label has width equal to its measured screen-space box (`box.width`, ±
  padding) at the active scale — **not** `box.width / scale` and **not** multiplied
  by a `fit` < 1. Assert the rect width ≈ the measured box width at `scale = 0.1`
  (i.e. it does **not** scale by `1/scale`). (FAILS today: `#screenRect` returns
  `(box.width · fit) / safeScale`.)
- **Visibility recompute is cached on unchanged scale/rotation:** two consecutive
  `renderWithContext` calls with the **same** `scale` and `rotation` run the overlap
  thinning **once** (second render is a cache hit); a third call with a **changed**
  `scale` recomputes. Assert via a spy/counter on the thinning computation (or an
  observable recompute count) that it is `1` after the repeat and `2` after the
  change.
- **Zoom gesture freezes then idle-recomputes:** after `beginZoom()` the visibility
  set is marked dirty and is **not** recomputed mid-gesture; after `endZoom()` an
  idle recompute is scheduled (via `setTimeout` fallback under fake timers) that,
  when it fires, calls the `invalidate` captured from `renderContext`. Assert
  `invalidate` is called exactly once after advancing timers post-`endZoom`, and not
  before.
- **Labelable gate unchanged (regression guard):** the existing selection still
  holds — a vacant `shop`-kind unit (no tenancy) and an `escalator` unit emit **no**
  label; a tenanted shop unit emits its tenancy name. (Guards that the port didn't
  break node selection.)

## Design intent         (UI-facing `(ui)` capabilities only — guidance, not a gate)

### `map-labels`
- **Layout & hierarchy:** shop names sit centered on their unit at the pre-resolved
  `label_point`/`label_rotation`, drawn at a **constant, legible screen size** (the
  `1/scale` counter-scale undoes world zoom) over a light translucent halo for
  contrast against floor fills. The floor geometry stays the hero; labels read
  cleanly without dominating. Empty state = no labelable units (nothing drawn);
  there is no loading/error state for labels.
- **Interaction:** labels track their unit during pan/zoom and grow gently (√scale)
  as you zoom in — never ballooning, never collapsing to nothing. During an active
  zoom gesture the visible set holds steady (no flicker); it re-thins once motion
  settles. Overlapping labels thin out, the shorter/higher-priority one surviving.
- **Responsive:** crisp at DPR>1 (font and floor both scale by dpr); the
  `minFontSize · dpr` floor keeps labels readable on mobile and at the fit zoom.
- **Accessibility:** the canvas is decorative — label text mirrors the searchable
  `title`, which is the accessible path to every destination.
- **Implementation:** add `#computeFontSize`, `#computeLabelVisibility`,
  `#scheduleIdleRecompute`, `#measureText`/`#quantizeFontSize`, `#renderLabel` to
  `LocationLayer.js`; reuse keppel's existing `computeVisibleRects` and counter-scale.
