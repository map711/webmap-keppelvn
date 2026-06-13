# reward-markers (ui)

## Purpose

Draw a gold **seal-percent** badge with a small caption pill at each matched
reward-shop on the **active** floor — the visible surface of the rewards-on-route
feature. `RewardMarkerLayer` renders the `rewardRouteMatch()` selection as a
START/END-style speech bubble offset above the shop, and owns the hit bookkeeping
that makes a seal tappable.

## Behavior

- `setSelection(selection)` stores the `rewardRouteMatch()` output; `clear()`
  empties it; `setFloor(levelCode)` sets the active floor. The engine recomputes
  the selection on every route set/clear (`#updateRewardSelection`) and calls
  `setFloor` on floor change, so the markers track the route and the active level.
- `renderWithContext` draws, for each selection entry that has a display node on
  the **active** floor, a rounded **speech bubble offset above** that node's
  projected display point, with a **downward tail whose tip lands at the anchor
  `(0,0)`** — the display point (where the shop label draws) is left clear. Inside
  the bubble the content is one inline row: **`[seal][gap][caption]`**
  (seal-before-label), the seal vertically centered, the caption to its right.
- The caption is the primary reward's `title` truncated to `MAX_PILL_LENGTH` (24,
  with an ellipsis) when the shop has **one** active reward, or `"<n> offers"` when
  it has **n ≥ 2**.
- Screen-space and counter-scaled (`withScreenSpaceTransform`): the marker keeps a
  constant on-screen size across map zoom. A responsive size bucket (by shortest
  viewport edge + DPR, clamped `0.95–1.8`) scales the geometry; the seal uses a
  shared **static icon cache** that calls the render context's `invalidate` on
  image load.
- Per render it rebuilds `#hitMarkers`: each marker's hit box is the bubble body
  **plus the tail down to `y = 0`**, so a tap at the shop's display point (the tail
  tip) still hits. `hitTest(worldX, worldY)` un-rotates/un-scales into the anchor
  frame and returns `{type:'reward', shopId, rewards, location}` on a hit, `null`
  off any marker.
- **z-order:** registered in `MapEngine.#createLayers` **above** `LocationLayer`
  (labels) and **below** `PinMarkerLayer` + `NavMarkerLayer`, so the wayfinding
  start/end + connector bubbles always draw on top and the seals sit above the unit
  labels.

The offset-above bubble + seal-before-label layout is a refinement folded in via a
`/tars:fix` resume; the earlier build drew the seal centered on the anchor with the
caption stacked above it, which covered the shop label.

## Interfaces & contracts

- `class RewardMarkerLayer extends Layer` — `constructor(levelCode = null)`,
  `setSelection(selection)`, `clear()`, `setFloor(levelCode)`,
  `renderWithContext(renderContext)`, `hitTest(worldX, worldY)` →
  `{type:'reward', shopId, rewards, location}|null`, `dispose()`. Static
  `MAX_PILL_LENGTH = 24`.
- `ICON_SEAL_PERCENT` (`src/assets/icons.js`) — an inline `data:image/svg+xml`
  gold scalloped seal with a white `%`, like the other icons.

## Data model

- Renders selection entries `{shopId, levelCode, rewards:[{title,…}], location}`,
  where `location.displayNodes[]` carry `point` (`{x,y}` or `[x,y]`) + `levelCode`.
  Only entries with a display node on the active floor draw. No persistence.

## Decisions & constraints

- **Decision:** marker = gold seal + small caption pill, `"N offers"` aggregate for
  ≥2 rewards — the design intent; amber accent (`rgba(212,160,23,0.95)` bg, white
  text) deliberately distinct from the dark START/END bubbles.
- **Decision:** z-order **above labels, below the start/end + connector bubbles** —
  so wayfinding chrome stays on top and the seals don't compete with it.
- **Decision (refinement):** a START/END-style speech bubble **offset above** the
  display point with a downward tail tip at the anchor, content as a
  **seal-before-label** inline row — rejected: the original seal-on-anchor /
  caption-stacked layout, which straddled `y = 0` and covered the shop label.
- **Invariant:** the hit box reaches the **tail tip at `(0,0)`**, so the offset
  bubble stays tappable at the shop — this protects the `reward-tap` pipeline (the
  tap still lands at the display point).
- **Invariant:** only entries with a display node on the **active** floor draw;
  the layer filters the full (all-floors) selection at render time.

## UX & accessibility

- **Layout & hierarchy:** a gold seal-percent badge + white caption pill drawn as a
  compact speech bubble above the shop, its tail meeting the display point; clearly
  subordinate to the dark START/END and floor-transition bubbles (which draw on
  top) and sitting above the unit labels. **Empty/loading/error:** no route or no
  matches → nothing is drawn (no idle pins); `rewards` data absent → silently no
  pins, map otherwise unchanged.
- **Interaction:** the seal + pill form one tap target; tapping fires `reward-tap`.
  No built-in popover — the host renders the deal detail. Touch-first; no hover
  dependency.
- **Responsive:** screen-space and counter-scaled like the other marker layers; a
  viewport+DPR size bucket keeps the pill legible when zoomed out and bounds the
  badge so it doesn't upscale unboundedly when zoomed in.
- **Accessibility:** canvas-rendered, consistent with the existing markers (no DOM
  a11y surface added); the amber-on-white pill keeps legible contrast, and the
  emitted `reward-tap` event lets the host expose an accessible deal list outside
  the canvas.
- **As built / owed:** criteria 1–4 (z-order, route/floor/clear selection, one
  seal per shop, caption text) got **real-browser** QA; the offset-bubble
  refinement (seal-before-label inline row, whole marker above the point with the
  tail tip at `(0,0)`, still-tappable) was QA'd **code-only** across every
  responsive size bucket because chrome-devtools-mcp could not attach — a
  **live-browser smoke pass is still owed** (run `/tars:review --ui`; this joins
  the Phase-2 `(ui)` smokes already owed in `overview.md`).

## Tests

- `test/layers/RewardMarkers.test.js` — z-order (`Loc < Reward < Pin/Nav`),
  route/`setFloor`/clear selection via the real routing stack, one
  `ICON_SEAL_PERCENT` per selected shop at its projected point, caption =
  `title`|`"<n> offers"`, seal-before-label inline row, whole marker above the
  point with the tail tip at `(0,0)`, and `hitTest(0,0) → reward` across size
  buckets.
