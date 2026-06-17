# zoom-control

## Purpose

Give visitors discrete on-screen zoom controls — a `+` and a `−` button — for
devices/contexts without easy pinch or wheel zoom (kiosks, mouse-less touch,
accessibility). The buttons sit in the control rail below the level selector and
drive the existing center-anchored, bounds-clamped `engine.zoom(factor)` path; no
new zoom/transform math. Opt-in and fully independent of the level selector.

## Behavior

- **Gated on the `zoom-control` attribute + an initialized engine.** With
  `zoom-control` set, the shadow DOM renders exactly two buttons — one zoom-in
  (`aria-label="Zoom in"`, glyph `+`) and one zoom-out (`aria-label="Zoom out"`,
  glyph `−`). Without the attribute, no zoom buttons exist. `#enableZoomControl`
  defers rendering (leaves the group `data-enabled="false"`) until the engine is
  initialized, then renders + binds on the next sync; `#syncZoomControl` runs both
  during init (after `#syncLevelSelector`) and from `attributeChangedCallback`.
- **Zoom-in / zoom-out factors.** Clicking zoom-in calls `engine.zoom(1.4)` exactly
  once; zoom-out calls `engine.zoom(1/1.4)` exactly once. A delegated `click`
  listener on the group wrapper resolves the tapped `<button>` via `closest` and
  reads its `data-zoom` (`in`/`out`); a click on a `disabled` button is a no-op.
  `engine.zoom` is center-anchored and already clamped to the live scale bounds.
- **Disabled state driven by `view:changed` + `getScaleBounds()`.** On each
  `view:changed`, `#updateZoomControlDisabled` compares the live
  `getViewState().scale` against `getScaleBounds()` `{min,max}` within an epsilon
  (`ZOOM_DISABLED_EPSILON = 1e-3`): `scale ≥ max − ε` disables zoom-in (a
  sub-epsilon undershoot of the ceiling still counts as at-max); `scale ≤ min + ε`
  disables zoom-out; strictly mid-range enables both. The state recomputes on every
  event, so leaving a bound re-enables the previously-disabled button. Non-finite
  bounds leave the button enabled.
- **Independent of, and a sibling after, the level selector.** A new
  `.wayfinder-rail-column` wrapper holds the `.wayfinder-level-selector` then the
  `.wayfinder-zoom-controls` group; the wrapper replaces the level-selector as the
  rail's right-column child. The zoom group is therefore a **sibling positioned
  after** the level selector — never a descendant — so it stays pinned and does not
  scroll with a long floor list. `zoom-control` renders without `level-selector`;
  both together render both groups.
- **Teardown / no leak.** Removing the `zoom-control` attribute (or `#cleanup`)
  calls `#disableZoomControl`: it removes the delegated click listener, calls the
  stored `view:changed` unsubscribe (`#zoomUnsubViewChanged`), nulls the button
  refs, sets `data-enabled="false"`, and clears the group's `innerHTML` — mirroring
  `#disableLevelSelector`. It removes only its own subscription and leaves the
  permanent `#wireEvents` re-emit listener intact.
- **Engine passthrough.** `MapEngine.getScaleBounds()` returns the transform's
  live `{min,max}` when initialized, and a safe finite default (`{min:1,max:1}`)
  before init / when the transform is unavailable, so the disabled-state check
  never throws.

## Interfaces & contracts

- `<wayfinder-map zoom-control>` — boolean attribute; observed in
  `observedAttributes`, synced via `attributeChangedCallback` → `#syncZoomControl`.
- `MapEngine.getScaleBounds() → {min:number, max:number}` — passthrough to
  `TransformPipeline.getScaleBounds()`; safe finite default before init.
- Drives the existing `WayfinderMap.zoom(factor)` → `MapEngine.zoom(factor)` →
  `TransformPipeline.zoom` seam (center-anchored, clamped). No new public method on
  the component beyond the attribute.
- Constants (in `WayfinderMap.js`): `ZOOM_IN_FACTOR = 1.4`,
  `ZOOM_OUT_FACTOR = 1/1.4`, `ZOOM_DISABLED_EPSILON = 1e-3`.
- Consumes the engine bus event `view:changed {scale,…}` (emitted by
  `MapEngine.#emitViewChange`) to recompute the disabled state.

## Data model

No new persistent entities. Owns transient component state: `#railColumnEl`,
`#zoomControlsEl`, `#zoomInButton`, `#zoomOutButton`, `#zoomControlEnabled`,
`#zoomClickHandler`, `#zoomUnsubViewChanged`. Reads `getViewState().scale` and
`getScaleBounds()` from the transform pipeline.

## Decisions & constraints

- **Decision:** a new independent `zoom-control` boolean attribute — rejected
  coupling it to `level-selector` (less flexible) and always-on (nothing to anchor
  "below" when the rail is otherwise empty).
- **Decision:** two separate 44×44 text-glyph buttons matching the existing rail
  buttons — rejected a joined Google-Maps-style pill and custom SVG icons (YAGNI;
  text matches the level buttons).
- **Decision:** disable + grey out at the zoom limit (driven by `view:changed` +
  `getScaleBounds()`) — rejected an always-tappable no-op (weaker feedback).
- **Decision:** a right-column wrapper (`.wayfinder-rail-column`) holding the
  selector + zoom group — rejected rendering the buttons inside the level-selector
  element (they would scroll away with a long floor list).
- **Decision:** `ZOOM_STEP = 1.4` per tap — rejected reusing the wheel's 1.1/tick
  (too timid for a discrete tap).
- **Decision:** reuse the **level-selector lifecycle shape** wholesale (observed
  attribute → `#sync*` → `#enable*/#disable*` gated on `engine.isInitialized`, a
  `data-enabled` flag, delegated click, a stored unsubscribe) — no new pattern.
- **Invariant:** the zoom group is a **sibling after** the level selector, never a
  descendant — so it stays pinned while the floor list scrolls.
- **Invariant:** teardown unsubscribes **only** its own `view:changed` listener
  (tracked by delta, not an absolute count) and leaves the permanent `#wireEvents`
  re-emit listener intact.
- **Invariant:** the buttons drive `engine.zoom` only — no new zoom/transform math;
  the existing center-anchor + bounds clamp is the single source of truth.

## UX & accessibility

- **Layout & hierarchy:** vertical group in the control rail's right column,
  **below** the level selector. `+` above `−`, each a 44×44 rounded-square
  (`border-radius:12px`) matching the level/locate buttons. ~16px inter-group
  separation (the rail-column's 8px `gap` + the group's 8px `margin-top`, double the
  8px intra-rail gap) so the zoom group reads as distinct; 8px between the two zoom
  buttons. When `level-selector` is off, the zoom group sits alone in that column
  slot. Pure control — no empty/loading/error states.
- **Interaction:** tap `+`/`−` to zoom in/out, centered on the canvas. At a zoom
  limit the relevant button greys out (`opacity:0.4`, `cursor:not-allowed`) and is
  non-interactive; it re-enables as soon as the view leaves the limit. The level
  selector stays scrollable; the zoom group stays pinned and visible below it.
- **Responsive:** works at both breakpoints. The level selector is a shrinking
  flex child (`flex:0 1 auto; min-height:0`) and the zoom group is `flex:0 0 auto`,
  so on mobile (≤768px, existing `#updateLevelSelectorMaxHeight`) the selector
  shrinks/scrolls while the zoom group stays visible below it.
- **Accessibility:** the group is `role="group"` labelled "Zoom controls"; each
  button is a real `<button type="button">` with an `aria-label` ("Zoom in" /
  "Zoom out"), keyboard-focusable with the same `:focus-visible` outline as the
  other rail buttons; the `disabled` attribute reflects the limit state to
  assistive tech.
- **As built:** QA'd **code-only** against the real `TransformPipeline` (criteria
  1–9 verified). Live-browser smoke is **owed** (chrome-devtools-mcp profile lock
  during the run) — joins the `/tars:review --ui` list in `overview.md`.

## Tests

- `test/component/ZoomControl.test.js` — 17 tests, one describe per acceptance
  criterion (1–9). Drives the **real** `WayfinderMapElement` over its real shadow
  DOM (minimal node-env DOM shim, no jsdom) with a thin `MapEngine` stub whose
  `zoom` is a spy and whose `on('view:changed')` returns a **real** unsubscribe.
  Pins: presence gated on the attribute (2/0 buttons), `engine.zoom(1.4)` /
  `engine.zoom(1/1.4)` on click, disabled-at-max / disabled-at-min (incl. the
  epsilon undershoot), enabled mid-range + re-enable on a later `view:changed`,
  independence from `level-selector` + sibling-after placement, and teardown that
  removes the buttons and unsubscribes **only** its own `view:changed` listener
  (isolated by **delta** around enable — `baseline → +1 → baseline` — never an
  absolute `before − 1`). Criterion 8 exercises the **real** `MapEngine` over the
  SGC fixture with a mocked `Renderer` (transform reporting a known `{min,max}`)
  for the `getScaleBounds()` passthrough + its pre-init safe default.
