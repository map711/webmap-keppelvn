# route-markers (ui)

## Purpose

Place the route's **start/end speech-bubble pins** and its **floor-transition
bubbles** ("↑ Tap to L3") on the map — each only on the floor it belongs to — and
make a transition bubble tappable to switch to the connected floor.
`PinMarkerLayer` owns the pins; `NavMarkerLayer` owns the transition bubbles and
their hit-testing.

## Behavior

- `PinMarkerLayer.setPath(routeResult)` renders the **start** pin only when the
  start belongs to the active floor, and the **end** pin only when the end does
  (verified by switching floors against a mock context).
- **The pin marks the SHOP, not the routing door.** A route anchor is snapped to
  the unit's **door** (a corridor-edge point the polyline can reach); the pin
  instead sits on the Location's **display anchor** (unit centroid /
  `label_point`). `#resolveNode` prefers the `startLocation`/`endLocation`
  display node on the active floor over the route anchor — the polyline still
  terminates at the door, but the bubble sits on the unit. The route anchor is a
  fallback only for routes that omit Location metadata. (Door-less units snap
  their anchor to the centroid, so anchor ≈ display node and the pin is unmoved;
  the divergence only shows for units that have a door, e.g. Basta Hiro.)
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

- `class PinMarkerLayer extends Layer` — `setPath(routeResult)`, `clear()`, `setFloor(levelCode)`, `renderWithContext(ctx)`, `dispose()`. Sources pins from the `startLocation`/`endLocation` display node (shop anchor), falling back to `startAnchor`/`endAnchor` when no Location metadata is present.
- `class NavMarkerLayer extends Layer` — `setPath(routeResult)`, `clear()`, `setFloor(levelCode)`, `hitTest(worldX, worldY)` → `levelCode|null`, `renderWithContext(ctx)`, `dispose()`. Stores `routeResult.transitions`.
- `RouteManager.getFloorTransitions()` — the transition list the marker layers render from.

## Data model

- Consumes **RouteResult**: `startLocation`/`endLocation` (catalog Locations carrying per-floor `displayNodes`) position the pins; `startAnchor`/`endAnchor` (`{levelCode,x,y}`) are the routing-door fallback and the polyline terminus; `transitions[]` (`fromX/fromY/toX/toY`, `fromLevelCode`/`toLevelCode`) drive bubbles. `PathFinder` threads `startLocation`/`endLocation` through the result so the pins can sit on the shop. No persistence.

## Decisions & constraints

- **Decision:** speech-bubble idiom reused from Phase-1 `destination-focus`; transition bubbles reuse the carried-over `NavMarkerLayer` draw + screen-space hit-test.
- **Invariant:** a pin/bubble renders **only on its own floor** — start on `startAnchor.levelCode`, end on `endAnchor.levelCode`, each transition bubble on its departure/arrival floor.
- **Invariant:** pins source from the **Location display node (shop anchor)**, with `startAnchor`/`endAnchor` (the routing door) as the no-Location fallback. A route still draws a pin when it carries no Location — sourced from the anchor.
- **Invariant (fixed earlier):** the destination must be identified from threaded `startLocation`/`endLocation` — a green-but-wrong the unit tests once missed (the end pin never rendered in prod); fixed by threading the Locations through `PathFinder`.
- **Correction (this cycle):** the pin previously sat on the **route door anchor**, so a shop with a door (e.g. Basta Hiro) drew its pin out in the corridor instead of on the unit. Fixed by preferring the display node in `#resolveNode`. The door is for routing; the pin marks the shop.

## UX & accessibility

- **Layout & hierarchy:** a "start" pin at the origin and an "end" pin at the destination, each only on its floor; floor-transition bubbles sit on the connector, clearly tappable.
- **Interaction:** tapping a transition bubble switches to the connected floor and re-centers on the arrival side; pins use the Phase-1 focus speech-bubble.
- **Responsive:** bubbles and arrows scale with DPR and shrink-to-fit on mobile; legible over the floor fill.
- **Accessibility:** the transition affordance is mirrored by the `tap:floor-transition` → `floor-transition-tap` DOM event; arrow direction encodes up/down by level ordinal.
- **As built / owed:** QA'd **code-only** on the real layer + engine stack; a **live-browser smoke pass is still owed** (chrome-devtools-mcp locked during the run).

## Tests

- `test/layers/RouteMarkers.test.js` — start/end pin per-floor visibility against a mock context; **pin-marks-the-shop** (display node preferred over a divergent door anchor, anchor-fallback when no Location); stored-transition bubble coords + up/down arrow, `hitTest` returns target level / `null`, `clearRoute` fan-out clears all three layers.
