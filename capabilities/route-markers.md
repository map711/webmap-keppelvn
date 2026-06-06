# route-markers (ui)

## Purpose

Place the route's **start/end speech-bubble pins** and its **floor-transition
bubbles** ("↑ Tap to L3") on the map — each only on the floor it belongs to — and
make a transition bubble tappable to switch to the connected floor.
`PinMarkerLayer` owns the pins; `NavMarkerLayer` owns the transition bubbles and
their hit-testing.

## Behavior

- `PinMarkerLayer.setPath(routeResult)` renders the **start** pin at
  `startAnchor.(x,y)` only when `startAnchor.levelCode` is the active floor, and
  the **end** pin at `endAnchor.(x,y)` only when `endAnchor.levelCode` is active
  (verified by switching floors against a mock context).
- `NavMarkerLayer.setPath` stores `routeResult.transitions`; with the
  **departure** floor active it draws a bubble at `(transition.fromX, fromY)` with
  an **up/down arrow** derived from level ordinals; with the **arrival** floor
  active it draws at `(transition.toX, toY)`.
- `NavMarkerLayer.hitTest(worldX, worldY)` over a rendered bubble returns the
  **target level code** to switch to (a departure bubble → `toLevelCode`); a miss
  returns `null`. The tap flows through the existing `tap:floor-transition` →
  `setFloor` interaction wiring.
- `clearRoute()` clears all three route layers — no start/end pin, no bubble, no
  polyline on any floor.

## Interfaces & contracts

- `class PinMarkerLayer extends Layer` — `setPath(routeResult)`, `clear()`, `setFloor(levelCode)`, `renderWithContext(ctx)`, `dispose()`. Sources pins from `startAnchor`/`endAnchor`.
- `class NavMarkerLayer extends Layer` — `setPath(routeResult)`, `clear()`, `setFloor(levelCode)`, `hitTest(worldX, worldY)` → `levelCode|null`, `renderWithContext(ctx)`, `dispose()`. Stores `routeResult.transitions`.
- `RouteManager.getFloorTransitions()` — the transition list the marker layers render from.

## Data model

- Consumes **RouteResult**: `startAnchor`/`endAnchor` (`{levelCode,x,y}`) for pins; `transitions[]` (`fromX/fromY/toX/toY`, `fromLevelCode`/`toLevelCode`) for bubbles. The **end pin is sourced from `endAnchor`**, and `PathFinder` threads `endLocation` through the result so the destination is identified. No persistence.

## Decisions & constraints

- **Decision:** speech-bubble idiom reused from Phase-1 `destination-focus`; transition bubbles reuse the carried-over `NavMarkerLayer` draw + screen-space hit-test.
- **Invariant:** a pin/bubble renders **only on its own floor** — start on `startAnchor.levelCode`, end on `endAnchor.levelCode`, each transition bubble on its departure/arrival floor.
- **Invariant (fixed at review):** the **end pin sources from `endAnchor`** (not a non-existent `endLocation` on the bare result) — a green-but-wrong the unit tests missed; the review backstop caught that the end pin never rendered in prod, fixed by threading `endLocation`/anchor through `PathFinder`.

## UX & accessibility

- **Layout & hierarchy:** a "start" pin at the origin and an "end" pin at the destination, each only on its floor; floor-transition bubbles sit on the connector, clearly tappable.
- **Interaction:** tapping a transition bubble switches to the connected floor and re-centers on the arrival side; pins use the Phase-1 focus speech-bubble.
- **Responsive:** bubbles and arrows scale with DPR and shrink-to-fit on mobile; legible over the floor fill.
- **Accessibility:** the transition affordance is mirrored by the `tap:floor-transition` → `floor-transition-tap` DOM event; arrow direction encodes up/down by level ordinal.
- **As built / owed:** QA'd **code-only** on the real layer + engine stack; a **live-browser smoke pass is still owed** (chrome-devtools-mcp locked during the run).

## Tests

- `test/layers/RouteMarkers.test.js` — start/end pin per-floor visibility against a mock context, stored-transition bubble coords + up/down arrow, `hitTest` returns target level / `null`, `clearRoute` fan-out clears all three layers.
