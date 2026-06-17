# Plan — Zoom controls (+/- buttons)

> **Mode:** quick (auto) — one localized `(ui)` control added to the existing control rail via the established level-selector pattern; design already settled in the approved spec (`docs/superpowers/specs/2026-06-17-zoom-controls-design.md`).

## What & why            (PM ↔ client)

- **Intent:** Give visitors discrete on-screen zoom controls — a `+` and a `−`
  button — alongside the floor switcher, for devices/contexts without easy pinch
  or wheel zoom (kiosks, mouse-less touch, accessibility). The buttons sit below
  the level selector with a slightly larger vertical gap between the two groups.
- **Constraints:** Opt-in and independent of the existing level selector. Must
  reuse the existing `engine.zoom(factor)` path (anchored at canvas center,
  already clamped to the live scale bounds) — no new transform/zoom math. Must
  not break the existing control-rail layout, the level selector's scroll
  behavior, or the mobile `#updateLevelSelectorMaxHeight` path. Public
  component/engine API stays additive.
- **Decisions:**
  - **New `zoom-control` boolean attribute**, independent of `level-selector` —
    rejected coupling to `level-selector` (less flexible) and always-on (nothing
    to anchor "below" when the rail is otherwise empty).
  - **Two separate 44×44 buttons** matching the existing rail buttons (text
    glyphs `+` / `−`) — rejected a joined Google-Maps-style pill and custom SVG
    icons (YAGNI; text matches the level buttons).
  - **Disable + grey out at the zoom limit** (driven by `view:changed` +
    `getScaleBounds()`) — rejected always-tappable no-op (weaker feedback).
  - **Right-column wrapper** holding level-selector + zoom group — rejected
    rendering the buttons inside the level-selector element (they'd scroll away
    with a long floor list).
  - **`ZOOM_STEP = 1.4` per tap** — rejected reusing the wheel's 1.1/tick (too
    timid for a discrete tap).

## How                   (tech lead — grounded in the codebase)

- **Module map:**
  - `src/component/WayfinderMap.js` — new `zoom-control` attribute + the
    `#syncZoomControl`/`#enableZoomControl`/`#disableZoomControl` trio, the zoom
    button elements, the right-column wrapper, click delegation, and the
    `view:changed` → disabled-state subscription.
  - `src/core/MapEngine.js` — a small public `getScaleBounds()` passthrough.
  - `src/component/styles.js` — `.wayfinder-rail-column`, `.wayfinder-zoom-controls`,
    `.wayfinder-zoom-button` (+ `[disabled]`), and the level-selector flex-shrink
    tweak.
  - `demo/basic.html` — add `zoom-control` so the control is exercised live.
- **Patterns:** Mirror the **level-selector** control exactly — observed attribute
  → `#sync*` → `#enable*/#disable*` gated on `engine.isInitialized`, a `data-enabled`
  flag, delegated `click` listener, and `data:loaded` re-render/refresh. Reuse the
  **bus event → component listener** seam for `view:changed` (engine already emits
  it from `#emitViewChange`). Reuse the existing rail button visual tokens.
- **Integration seams:** Drives the existing public `WayfinderMap.zoom(factor)` →
  `MapEngine.zoom(factor)` → `TransformPipeline.zoom` (center-anchored, clamped).
  The only new seam is `MapEngine.getScaleBounds()` exposing
  `TransformPipeline.getScaleBounds()` so the component can compare current scale
  against the live min/max for the disabled state.
- **Reuse:** `engine.zoom`, `engine.getViewState`, `transform.getScaleBounds`,
  the rail flex layout, the 44×44 button styling, the level-selector lifecycle
  shape.
- **Cross-cutting tech-stack decisions:** none new — additive attribute + one
  passthrough method; no new dependency, store, layer, or build change.

## Capability breakdown

- [x] `zoom-control` `(ui)` — opt-in `+`/`−` zoom buttons below the level selector that drive `engine.zoom` and disable at the scale limits · depends on: none

## How to test           (the binding acceptance criteria)

### `zoom-control` `(ui)`

Tested via the established harness: a real `WayfinderMapElement` mounted with a
stub engine (carrying `on()`, `zoom()`, `getScaleBounds()`, `getViewState()`,
`isInitialized`, `getFloors/getLevels/getCurrentFloor`) injected through the
mocked `MapEngine` constructor, the same way `DestinationSearch.test.js` does.

- **Gating / presence:** With the `zoom-control` attribute set and the engine
  initialized, the shadow DOM contains exactly two zoom buttons — one zoom-in
  (`aria-label="Zoom in"`) and one zoom-out (`aria-label="Zoom out"`). Without the
  attribute, the shadow DOM contains **no** zoom buttons.
- **Zoom-in factor:** Clicking the zoom-in button calls `engine.zoom` exactly once
  with a factor `> 1` (specifically `1.4`).
- **Zoom-out factor:** Clicking the zoom-out button calls `engine.zoom` exactly
  once with a factor `< 1` (specifically `1 / 1.4`).
- **Disabled at max:** When `getScaleBounds()` reports `max` ≈ the current
  `getViewState().scale` (within an epsilon) on a `view:changed` event, the
  zoom-in button has the `disabled` attribute and the zoom-out button does not.
- **Disabled at min:** Symmetrically, when current scale ≈ `min`, the zoom-out
  button is `disabled` and the zoom-in button is not.
- **Enabled mid-range:** When current scale is strictly between `min` and `max`,
  neither button is `disabled`. The disabled state updates in response to
  `view:changed` (a later mid-range event re-enables a previously disabled
  button).
- **Independence from level-selector:** Setting `zoom-control` without
  `level-selector` renders the zoom buttons but no level buttons; setting both
  renders both groups, with the zoom group as a sibling element **after** the
  level-selector element (not a descendant of it, so it does not scroll with the
  floor list).
- **Engine passthrough:** `MapEngine.getScaleBounds()` returns the transform's
  `{ min, max }` when initialized, and does not throw (returns a safe default)
  when called before init.
- **Teardown:** Removing the `zoom-control` attribute removes the zoom buttons /
  marks the group disabled and unsubscribes the `view:changed` listener (no leak;
  mirrors `#disableLevelSelector`).

## Design intent         (UI-facing `(ui)` capabilities only — guidance, not a gate)

### `zoom-control`
- **Layout & hierarchy:** Vertical group in the control rail's right column,
  **below** the level selector. A `+` button above a `−` button, each a 44×44
  rounded-square matching the level/locate buttons. Inter-group gap **~16px**
  (double the 8px intra-rail gap) so the zoom group reads as distinct from the
  floor switcher; 8px between the two zoom buttons. When `level-selector` is off,
  the zoom group sits alone at the top of that column slot. No empty/loading/error
  states (pure control).
- **Interaction:** Tap `+` to zoom in, `−` to zoom out, centered on the canvas.
  At a zoom limit the relevant button greys out (reduced opacity, `cursor:default`,
  no hover/active affordance) and is non-interactive; it re-enables as soon as the
  view leaves the limit. The level selector remains scrollable and the zoom group
  stays pinned and visible below it regardless of floor count.
- **Responsive:** Works at both breakpoints. On mobile (≤768px) the level
  selector may be height-constrained (existing `#updateLevelSelectorMaxHeight`);
  the zoom group must remain visible below the (shrinking, scrollable) selector —
  achieved by making the selector a shrinking flex child and the zoom group
  `flex: 0 0 auto`.
- **Accessibility:** `role="group"` labelled "Zoom controls"; each button is a
  real `<button>` with an `aria-label` ("Zoom in"/"Zoom out"), keyboard-focusable
  with the same visible focus ring as the other rail buttons; `disabled` reflects
  the limit state to assistive tech.
- **Reference:** Reuse `.wayfinder-level-button` / `.wayfinder-locate-button`
  visual tokens (size, radius, border, background, shadow, `:focus-visible`
  outline) and the rail's existing flex layout. Aesthetic bar: indistinguishable
  in weight/finish from the existing rail controls.
