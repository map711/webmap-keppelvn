# map-labels

## Purpose

`LocationLayer` draws the shop-name labels for labelable units on the active
floor — anchored at each unit's pre-resolved `label_point`/`label_rotation`,
drawn at a **constant, legible screen size** that grows gently as you zoom in
(never microscopic, never ballooning), and thinned by screen-rect overlap
suppression so labels read cleanly rather than colliding.

## Behavior

- A label is emitted **only** for a labelable placement — a tenant-kind unit
  carrying ≥1 tenancy, while the layer is visible (`labelsVisible`). A vacant
  `shop`-kind unit (no tenancy) and an `escalator` unit each emit **no** label; a
  tenanted shop unit emits its tenancy name. (Unchanged by the re-work — a
  regression guard pins it.)
- The label anchor equals `unit.label_point` and the angle equals
  `unit.label_rotation` **converted degrees → radians** — done once in the
  catalog at `DisplayNode` build time; the layer does **no** polylabel/OBB
  recompute. A net-rotation **flip** (`+π` when the net angle falls in the
  left half-plane) keeps text upright.
- **Label orientation is locked to its unit, not double-rotated by the map.** The
  per-label `ctx.save()` frame already inherits the **global** canvas `rotate(θ)`
  (the map rotation), so the layer's own contribution is `rotate(nodeRot + flip)`
  **only** — it must NOT re-add `θ`. (The earlier `rotate(rotation + nodeRot + flip)`
  spun every label at `2θ`, visibly rotating it against the unit it names.) The
  `flip` is still keyed on the **net screen** orientation `θ + nodeRot` (so text
  never reads upside-down), matching the orientation `#screenRect` measures for
  overlap thinning.
- **Zoom-responsive screen-space font (the re-work).** The drawn font px is
  `max(minFontSize·dpr, fontSize·√scale·dpr)` — a `minFontSize·dpr` **floor**
  with a **√scale** growth curve above it — applied once to `ctx.font`, then
  counter-scaled by `1/scale` in `#drawLabel` so the on-screen size is constant
  regardless of world zoom and grows only gently as you zoom in. Below the floor
  scale the font pins to `minFontSize·dpr`; both floor and size scale with `dpr`.
  The font is **independent of the owning unit's polygon size** — there is no
  `_fitScale` unit-shrink (a tiny unit and a huge unit with identical text/scale/
  dpr draw at the **same** px).
- **Overlap suppression** reduces each candidate to a screen-space rect whose
  width/height match the **measured screen footprint** at the active font (the
  natural box itself — **not** `box.width/scale`, **not** multiplied by any
  unit-fit < 1) and feeds them through the shared `computeVisibleRects`
  (RectVisibility/rbush) path; when two boxes overlap the lower-priority (later)
  one is dropped. Candidates are ordered shorter-label-first, ties broken by unit
  id for determinism. Survivors are exposed via `visibleLabels` (a node-id set).
- **Visibility caching + idle recompute (ported from the upstream shell).** The thinning
  runs **only** when the `(scale, rotation)` cache key changed or a dirty flag is
  set — a repeat render at the same view is a **cache hit** (no recompute). A zoom
  gesture **freezes** the set: `beginZoom()` marks dirty and cancels any pending
  idle work; `endZoom()` schedules an idle recompute (`requestIdleCallback`, with
  a `setTimeout(…, 0)` fallback) that re-thins from the **last render snapshot**
  (measured rects captured at render time, so no live `ctx` is needed) and calls
  the render context's `invalidate` to repaint. `setStyle`, `setFloor`, and
  `setLocationStore` reset/dirty the cache; `dispose` cancels pending idle work.

## Interfaces & contracts

- `class LocationLayer extends Layer` — `setLocationStore(store)`,
  `setFloor(levelCode)`, `setStyle(style)`, `renderWithContext(renderContext)`,
  `beginZoom()`, `endZoom()`, `get visibleLabels → Set<string|number>`,
  `dispose()`. Reads `Location.displayNodes` filtered by active level +
  `node.labelable`.
- `renderContext` consumed: `{ ctx, scale, rotation, dpr, invalidate }` — all
  already passed by the engine; `invalidate` is captured for the idle recompute.
  `beginZoom`/`endZoom` implement the previously no-op hooks
  `MapEngine` already calls around a zoom gesture.
- `#style` carries `fontSize` (base, default 8), `minFontSize` (floor, default 8),
  `padding` (4), and the color/family fields. `labelFontSize` config wiring beyond
  this `#style` block is out of scope.
- `_fitScale(...)` (`src/layers/labelFit.js`) remains an importable pure util but
  is **no longer used by this layer** (dropped from the render path).

## Data model

- Consumes **DisplayNode** (from `destination-catalog`): `point`, `rotation`
  (radians), `text`, `labelable`. `unitWidth`/`unitHeight` are **no longer read**
  by the layer (the `_fitScale` shrink is gone) but remain on the node. Owns no
  new persistent entities — `#visibleLabels` and the `(scale, rotation)` cache /
  last-render snapshot are per-render/per-view state only.

## Decisions & constraints

- **Decision:** port the upstream screen-space zoom-responsive font
  (`base·√scale·dpr` floored at `minFontSize·dpr`) drawn under the existing
  `1/scale` counter-scale. *Rejected:* keep the fixed world-space font and only
  raise the constant — still scales 1:1 with zoom and still has no floor (the
  actual bug).
- **Decision:** drop `_fitScale` from the render path — label size is independent
  of unit polygon extents. *Rejected:* a hybrid that keeps the unit-shrink (tiny
  units still get tiny labels; doesn't match the upstream shell).
- **Decision:** port the upstream visibility caching + idle recompute + measured-rect
  snapshot — recompute thinning only on scale/rotation change, freeze during a
  gesture, re-thin on idle via `invalidate`. *Rejected:* keep keppel's inline
  per-frame thinning (fine today, but the user wants headroom for growing label
  counts).
- **Decision:** re-work in place, reusing the `map-labels` slug. *Rejected:* a new
  slug (fragments one capability across two records).
- **Invariant (behavior-changing):** the prior `_fitScale` shrink-to-fit promise
  is **replaced** by a `minFontSize·dpr` **floor** promise — labels never shrink
  to the unit, they hold a min screen size and grow by √scale. The thinning rect
  width is the **measured screen box** at the active font, never `box.width/scale`.
- **Invariant:** rotation is stored/consumed in **radians** (deg→rad converted in
  the catalog); the layer applies a net-rotation `+π` flip for upright text but
  never re-derives label geometry.
- **Invariant (bug fix):** the label's local `ctx.rotate` is `nodeRot + flip` —
  the global map `rotate(θ)` is already applied by the canvas transform, so the
  layer must never re-add `θ` (doing so double-rotates labels to `2θ`). The flip
  is still computed from the net `θ + nodeRot` screen orientation.

## UX & accessibility

- **Layout & hierarchy:** shop names sit centered on their unit at the
  pre-resolved anchor/rotation, drawn at a constant legible screen size (the
  `1/scale` counter-scale undoes world zoom) over a light translucent halo for
  contrast against floor fills — the floor geometry stays the hero. Empty state =
  no labelable units (nothing drawn); no loading/error state for labels.
- **Interaction:** labels track their unit during pan/zoom and grow gently
  (√scale) as you zoom in — never ballooning, never collapsing to nothing. During
  an active zoom gesture the visible set holds steady (no flicker); it re-thins
  once motion settles. Overlapping labels thin out, the shorter/higher-priority
  one surviving.
- **Responsive:** crisp at DPR>1 (font and floor both scale by dpr); the
  `minFontSize·dpr` floor keeps labels readable on mobile and at the fit zoom.
- **Accessibility:** the canvas is decorative — label text mirrors the searchable
  `title`, the accessible path to every destination.
- **Owed:** a live-browser smoke pass on the rendered labels — QA this cycle was
  code-only (chrome-devtools-mcp was locked during the run). Run `/tars:review
  --ui` once the browser tool is free.

## Tests

- `test/layers/MapLabels.test.js` (node-env Vitest, mocked 2D canvas shim) —
  min-size floor (`parseFloat(ctx.font) >= minFontSize·dpr` at `scale=0.05`),
  √scale ordering (`font(0.25)==floor < font(1) < font(4)`), dpr doubles the px,
  unit-size independence (tiny vs huge unit → same px), thinning rect ≈ measured
  box (not `/scale`) at `scale=0.1`, visibility cache (one thin across two
  identical renders, recompute on scale change), zoom-gesture freeze +
  `endZoom`→idle `invalidate` exactly once after advancing fake timers, and the
  labelable-gate regression (tenanted shop labelled, vacant shop / escalator not).
  **Criterion 9 (rotation lock):** the canvas shim now tracks a cumulative
  `_rotStack` mirroring the scale stack and records each glyph's `netRotation`;
  the test renders the same label at map rotation `0` and `0.4` and asserts the
  layer's own recorded rotation is invariant (no double-`θ`).
