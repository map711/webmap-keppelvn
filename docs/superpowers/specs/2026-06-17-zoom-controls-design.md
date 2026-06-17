# Zoom Controls — Design

**Date:** 2026-06-17
**Status:** Approved (design); pending implementation plan

## Summary

Add `+` / `−` zoom buttons to the map control rail, below the level selector,
separated by a slightly larger vertical gap. The buttons drive the existing
`engine.zoom(factor)` API (anchored at canvas center, clamped to the live scale
bounds) and disable + grey out when the map reaches its zoom ceiling/floor.

## Decisions

- **Gating:** a new boolean attribute **`zoom-control`**, independent of
  `level-selector`, mirroring how `level-selector` is gated. The zoom group can
  be shown with or without the floor switcher.
- **Button style:** two separate 44×44 rounded-square buttons matching the
  existing level/locate buttons. Text glyphs `+` and `−` (U+2212 MINUS SIGN, not
  a hyphen). `aria-label`s "Zoom in" / "Zoom out", wrapped in a
  `role="group"` element labelled "Zoom controls".
- **At limits:** `+` becomes `disabled` + dimmed when current scale ≈
  `getScaleBounds().max`; `−` becomes `disabled` when current scale ≈
  `getScaleBounds().min`. Compared with an epsilon.
- **Spacing:** ~16px gap above the zoom group (double the rail's 8px), satisfying
  the "slightly bigger vertical gap".
- **Zoom step:** `ZOOM_STEP = 1.4` per tap (`+` → `zoom(1.4)`, `−` →
  `zoom(1/1.4)`). The wheel uses 1.1 per tick; a discrete button tap should feel
  more decisive.

## Layout approach (chosen: A — right-column wrapper)

The control rail (`.wayfinder-control-rail`) is a flex **row** —
`[locate-controls] [level-selector]`. To place zoom buttons *below* the level
selector they must share a vertical column.

**A — Right-column wrapper (chosen).** A new flex-column wrapper
(`.wayfinder-rail-column`) takes the rail's rightmost slot and contains the
level selector + the new zoom group. The level selector becomes a shrinking flex
child (`flex: 1 1 auto; min-height: 0`) so it scrolls within the leftover space;
the zoom group is `flex: 0 0 auto` so it stays pinned and visible at the bottom.
The column's `gap: 16px` provides the larger spacing and collapses automatically
when either child is hidden (flex `gap` ignores `display:none` children), so
there is no phantom gap when only one control is enabled.

Rejected alternatives:

- **B — Render zoom buttons inside the level-selector element.** Simplest DOM,
  but the buttons would scroll away with a long floor list and inherit
  level-button semantics.
- **C — Restructure the rail with wrap/order tricks.** More CSS for no gain.

Approach A also coexists cleanly with the existing `#updateLevelSelectorMaxHeight`
mobile path (which sets a `max-height` on the level selector when the search-info
panel is visible): with the selector as a shrinking flex child, the zoom group
remains pinned below it regardless of that max-height.

## Components & changes

### `src/component/WayfinderMap.js`
- Add `'zoom-control'` to `observedAttributes`; route it through
  `attributeChangedCallback` → `#syncZoomControl()`.
- In `#createShadowDOM`: build `#zoomControlsEl` (the `role="group"` container)
  with child `#zoomInButton` and `#zoomOutButton`. Introduce the
  `.wayfinder-rail-column` wrapper holding `#levelSelectorEl` + `#zoomControlsEl`,
  and append that wrapper to the rail where `#levelSelectorEl` is currently
  appended.
- Add `#syncZoomControl` / `#enableZoomControl` / `#disableZoomControl` mirroring
  the level-selector trio: gate on `engine.isInitialized`, toggle the group's
  `data-enabled`, bind/unbind events.
- Click handler → `this.zoom(ZOOM_STEP)` for `+`, `this.zoom(1 / ZOOM_STEP)` for
  `−` (delegated listener on the group, like the level selector's).
- Subscribe to the engine `view:changed` event → `#updateZoomButtonsDisabled()`:
  read current scale + `engine.getScaleBounds()`, set `disabled` + a
  `data-disabled` attribute on each button using an epsilon comparison. Also call
  it from `#enableZoomControl` and on `data:loaded`.
- Unsubscribe/teardown in `#disableZoomControl` (and existing disconnect path),
  matching the level-selector cleanup.

### `src/core/MapEngine.js`
- Add a small public `getScaleBounds()` that returns
  `this.#renderer?.transform?.getScaleBounds()` (with a safe default when
  uninitialized). The component already receives `view:changed`; it needs the
  min/max to compare against for the disable logic.

### `src/component/styles.js`
- `.wayfinder-rail-column` — `display: flex; flex-direction: column; gap: 16px;
  min-height: 0;` (takes the rail's rightmost slot).
- Adjust `.wayfinder-level-selector` to be a shrinking flex child
  (`flex: 1 1 auto; min-height: 0;`) while keeping its scroll behavior.
- `.wayfinder-zoom-controls` — column, `gap: 8px`, `display: none` until
  `data-enabled='true'` (then `display: flex`); `flex: 0 0 auto`.
- `.wayfinder-zoom-button` — reuse the level/locate button look (44×44, radius,
  border, background, shadow, focus-visible outline). Text-glyph friendly
  (centered, weight ~600).
- `.wayfinder-zoom-button[disabled]` — reduced opacity, `cursor: default`, no
  hover/active affordance.

## Data flow

```
tap "+"
  → WayfinderMap.zoom(1.4)
  → engine.zoom(1.4)
  → transform.zoom(1.4, centerX, centerY)   // clamped to live scale bounds
  → engine emits view:changed { scale, panX, panY, rotation }
  → component reads new scale + engine.getScaleBounds()
  → #updateZoomButtonsDisabled() toggles disabled on each button
```

No new state is introduced; `TransformPipeline` remains the single source of
truth for scale and bounds. The buttons are a pure view over it.

## Testing

A new `zoom-control` capability, jsdom component tests asserting **rules** (not
pixel values), consistent with the project's data-driven test convention:

- `zoom-control` attribute present → two zoom buttons render in the rail's right
  column; absent → none.
- Clicking `+` calls `engine.zoom` with a factor > 1; clicking `−` with a factor
  < 1.
- When `getScaleBounds().max` ≈ current scale, `+` is `disabled`; at min, `−` is
  `disabled`; mid-range, both enabled. Driven by a faked / mini engine exposing
  `getScaleBounds()` and `getViewState()` and emitting `view:changed`.
- `zoom-control` and `level-selector` toggle independently (each controls its own
  group; the right-column wrapper hosts both).
- Demo: add `zoom-control` to a gallery page (e.g. `demo/basic.html`) so the
  control is exercised live.

## Out of scope (YAGNI)

- Configurable zoom step.
- Custom SVG icons for the buttons (text glyphs only).
- Animated zoom transitions on button tap.
- Horizontal / alternate-position layouts for the zoom group.
