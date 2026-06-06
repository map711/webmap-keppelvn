# Design: Port sunwaymalls label sizing + visibility into keppel

**Date:** 2026-06-06
**Status:** Approved (brainstorming)
**Reference implementation:** `/Users/kegan/projects/webmap-sunwaymalls/src/layers/LocationLayer.js`

## Problem

Two symptoms on the keppel webmap:

1. **Shop labels render too tiny / unreadable**, especially zoomed out.
2. **Zoom range/fit feels off.**

### Root cause

Keppel's `LocationLayer` sizes labels with a *fixed* world-space font shrunk to
fit the owning unit polygon:

- Font is a hardcoded `style.fontSize = 12` ([LocationLayer.js:108](../../../src/layers/LocationLayer.js#L108)) —
  **no zoom-responsive growth and no minimum-size floor.**
- `_fitScale` ([labelFit.js](../../../src/layers/labelFit.js)) multiplies the label
  *down* to fit inside the unit's extents ([LocationLayer.js:225](../../../src/layers/LocationLayer.js#L225)).
  Small units → microscopic labels.
- The overlap-thinning rect in `#screenRect` divides by `scale` and applies
  `fit`, so the rects used for thinning don't match the drawn label footprint.

The sunwaymalls webmap (same shell lineage) solves this with a **screen-space,
zoom-responsive** font plus a **visibility/caching system** that scales to many
labels. The keppel and sunway coordinate magnitudes are comparable (both in the
~1000–2000 range), so sunway's formulas transfer to keppel's regime.

The zoom *mechanism* (fit + min/max clamps) is already essentially identical
between the two projects (keppel's `fitToBounds` is a refinement of sunway's).
The "zoom feels off" symptom is dominated by unreadable labels, not the clamp;
`maxZoom` stays `2.5` and is tuned only if zoom-in still feels short after labels
are legible.

## Decision

**Port sunwaymalls' label handling in full** — font sizing *and* the
visibility/caching/idle-recompute machinery — because label density on keppel is
expected to grow. Drop keppel's `_fitScale` unit-shrink from the render path.

This was chosen over a minimal "responsive font, keep unit-fit" hybrid because
the host expects increasing label counts, and sunway's caching + idle-recompute
is exactly the machinery that keeps overlap-thinning cheap at high label counts.

## What changes

All changes are contained in `src/layers/LocationLayer.js` plus tests and one
CLAUDE.md note. **No engine/renderer wiring is required** — keppel's MapEngine
already calls `#locationLayer.beginZoom?.()` / `endZoom?.()`
([MapEngine.js:1077,1098](../../../src/core/MapEngine.js#L1077)) and
`renderContext` already carries `invalidate` + `dpr`
([LayerStack.js:83](../../../src/renderer/LayerStack.js#L83)). Today those hooks
are no-ops because the layer doesn't implement them.

### 1. Zoom-responsive font (the core fix)

Add sunway's `#computeFontSize(scale, dpr)`:

```js
#computeFontSize(scale, dpr) {
  const d = Number.isFinite(dpr) ? dpr : 1;
  const base = this.#style.fontSize;
  const min = this.#style.minFontSize * d;
  const safeScale = (scale > 0 && Number.isFinite(scale)) ? scale : 1;
  const size = base * Math.sqrt(safeScale) * d;
  return Math.max(min, size);
}
```

- Add `minFontSize` to the `#style` block.
- The existing counter-scale (`ctx.scale(1/scale)`, already at
  [LocationLayer.js:221](../../../src/layers/LocationLayer.js#L221)) keeps labels at
  constant screen size; `√scale` lets them grow gently when zooming in; the
  `minFontSize` floor is what eliminates "too tiny."
- Starting values: `fontSize` and `minFontSize` seeded to read well in keppel's
  raw-coord space (sunway uses `8`/`8`); final values tuned during verification
  against the real `SGC_v001.json`.

### 2. Drop `_fitScale` from the render path

- Remove the `fit` multiply in `#drawLabel` and the `fit` + `/scale` in
  `#screenRect`. The label's screen footprint becomes the measured text box
  directly (matching sunway's `#buildLabelRect`), so thinning rects finally match
  drawn labels.
- `labelFit.js` remains as a pure, unused util (no deletion needed); `node.unitWidth`
  / `node.unitHeight` become unused by the layer.

### 3. Port the visibility / caching system

Port these from sunway, **adapted to keppel's data model** (see "Data model
adaptation" below):

- `#computeLabelVisibility(...)` — recompute the visible/suppressed sets only when
  `scale` or `rotation` changed (or forced/dirty); cache `#lastScale` /
  `#lastRotation`. Uses keppel's existing `computeVisibleRects`
  ([RectVisibility.js](../../../src/renderer/RectVisibility.js), shared with sunway).
- `#buildLabelRect(...)` — screen-space oriented rect with the same map-rotation
  flip logic.
- `beginZoom()` / `endZoom()` — freeze visibility during a zoom gesture, then
  `#scheduleIdleRecompute()` (via `requestIdleCallback`, `setTimeout` fallback)
  re-thins once idle and calls `invalidate`.
- `#measureText` + `#quantizeFontSize` — cached canvas text metrics keyed by
  quantized font size, so per-frame measurement is cheap at high label counts.
- State: `#lastScale`, `#lastRotation`, `#visibleLabels`, `#suppressedLabels`,
  `#labelBounds`, `#isZooming`, `#visibilityDirty`, `#idleHandle`,
  `#idleHandleType`, `#lastSnapshot`, `#invalidate`, `#measureCtx`,
  `#textMetrics`.
- Reset all caches in `setFloor` / store changes (`#resetVisibility`).

**Faithful-port note:** in sunway the suppressed-label *fade* path
(`suppressedOpacity`) exists in `#renderLabel` but is latent — the render loop
draws only `#visibleLabels` (overlap survivors), the same visible set keppel
draws today. We port it as-is (capability present, not active in the loop).

### Data model adaptation (the main porting subtlety)

Sunway and keppel select/label nodes differently. **Keep keppel's accessors**,
port only the mechanism:

| Concern | Sunway | Keppel (keep) |
|---|---|---|
| Node list | `store.nodes` filtered by `n.location.kind` | `#labelableNodesOnLevel()` over `store.locations[].displayNodes` with `node.labelable` |
| Level match | `n.level.id === currentLevelId` | `node.levelCode === this.#levelCode` |
| Label text | `n.location.label` | `node.text` |
| Sort | by label length | already sorts by `node.text.length`, tie-break `unitId` |
| Position / angle | `node.point`, `node.rotation` | same (`node.point`, `node.rotation`) |

## Out of scope

- Wiring `labelFontSize` / `labelMinFontSize` config → layer `#style` (neither
  project does this today; both hardcode `#style`). Separate cleanup.
- Any structural change to the zoom fit/clamp mechanism. `maxZoom` value tuning
  only, and only if needed after labels are legible.
- Activating the suppressed-label fade in the render loop.

## Testing

- **`test/layers/MapLabels.test.js`** — rewrite shrink-to-fit (`_fitScale`)
  assertions into:
  - `√scale` growth: font at higher `scale` > font at lower `scale`.
  - `minFontSize` floor: font never drops below `minFontSize * dpr` at small scale.
  - thinning rect footprint matches drawn label (no `/scale`, no `fit`).
  - visibility caching: no recompute when `scale`/`rotation` unchanged.
- **`beginZoom`/`endZoom`** behavior: visibility frozen during zoom, recomputed on
  idle (fake timers).
- Audit `test/core/DestinationFocus.test.js`, `FloorSwitching.test.js`,
  `MapEngine.bootstrap.test.js`, `test/layers/RouteMarkers.test.js` for any
  assertion of old fixed-font / shrink behavior; adjust only where they break.
- TDD: failing tests for the new font model first, then the layer change.
- Vitest node-env; pure logic against the mini-bundle, real 2 MB bundle only in
  opt-in smoke tests (per CLAUDE.md). Dev/run on port 5080.

## Docs

- Update the CLAUDE.md `_fitScale` gotcha note — it no longer render-gates labels.
```
