# route-rendering (ui)

## Purpose

Draw the active route on the current floor as an animated walking polyline,
re-sliced per floor as the visitor switches floors. `NavigationLayer` owns the
canvas draw; the engine frames the start floor on a successful navigation.

## Behavior

- `NavigationLayer.setPath(routeResult)` for a 2-floor route ⇒ `hasPath()` is
  `true`; with floor `F1` active the layer's filtered points equal
  `segments.get('F1')`, and after `setFloor('F2')` they equal `segments.get('F2')`.
- `setFloor` to a floor **not** in `segments` ⇒ `hasPath()` is `false` and the
  layer draws nothing (no throw).
- `setPath` **starts** the walk animation (`getAnimationStatus().isAnimating`
  `true`); `clearPath()` **stops** it and drops the stored result.
- `renderWithContext` draws **two strokes** — a full grey path and a partial,
  animated black progress stroke — from `segment[i][0]/[1]` coordinates over the
  active floor's points.
- After `engine.navigateTo` success, the engine `setFloor`s to
  `startAnchor.levelCode` and `centerOn`s `(startAnchor.x, startAnchor.y)`,
  reusing the Phase-1 focus camera path.
- **The drawn line reaches the SHOP anchor, not just the routing door.** The
  navmesh `segments` terminate at the door (corridor edge); `setPath` extends the
  flattened polyline with a cosmetic leg to the start/end **shop anchor** (the
  Location display node — the same point the pin sits on), so the line meets the
  pin. Resolved like the pin (legacy `nodes` then `displayNodes`, by floor).
  Door-less units (anchor ≈ display point, dedup guard) get no leg; routes with
  no Location metadata get no leg (door endpoints drawn as-is).

## Interfaces & contracts

- `class NavigationLayer extends Layer` — `setPath(routeResult)`, `clearPath()`, `hasPath()` → `boolean`, `setFloor(levelCode)`, `getAnimationStatus()` → `{ isAnimating, … }`, `renderWithContext(ctx)`, `dispose()`.
- Consumes `RouteResult.segments` (`Map<levelCode,[x,y][]>`); filters to the active floor's polyline.
- `RouteManager.getPathOnFloor(levelCode)` / `getRouteFloors()` — the segment lookups the layer/engine drive from.

## Data model

- Consumes **RouteResult** (`navmesh-routing`): `segments` per floor, plus `start/endAnchor` and `start/endLocation` (to extend the line to the shop anchor). Owns only transient per-render animation state (RAF progress); no persistence.

## Decisions & constraints

- **Decision:** rebuild the animated walk (grey full path + animated black progress) over `segments`, reusing the carried-over RAF skeleton. Rejected: static-only polyline.
- **Invariant:** the layer renders **only the active floor's** slice of `segments`; a floor absent from `segments` draws nothing (never throws).
- **Invariant:** the navmesh `segments` are consumed as-is for the walkable path; the layer adds points ONLY as terminal shop-anchor legs (prepend start / append end) so the line meets the pin — it never re-derives the interior funnel geometry.
- **Correction (this cycle):** the line previously stopped at the routing door, leaving a gap to the pin (which sits on the shop). Fixed by extending the polyline to the shop anchor in `setPath`. Door is for routing; the line (like the pin) reaches the shop. See `route-markers` for the matching pin fix.

## UX & accessibility

- **Layout & hierarchy:** the route is the hero once active — a calm polyline tracing the walkable path on the current floor; empty state = browse (no route); error state = no polyline, message in the summary panel.
- **Interaction:** an animated "walk" (grey full path under, darker progress stroke advancing start→end, looping) implies travel direction; redraws to the per-floor slice on floor switch.
- **Responsive:** stroke width scales sensibly at DPR>1 across desktop/mobile; auto-fit framing keeps the active floor's route in view.
- **Accessibility:** the canvas is decorative — the searchable catalog + textual from/to summary are the accessible path; availability is announced via `route-found`/`route-error` DOM events.
- **As built / owed:** QA'd **code-only** against the real layer + engine stack; a **live-browser smoke pass is still owed** (chrome-devtools-mcp was locked during the run). Run `/tars:review --ui` once the browser tool is free.

## Tests

- `test/layers/RouteRendering.test.js` — per-floor slice equals `segments.get(floor)`, **line-reaches-the-shop-anchor** (door-divergent route prepends/appends the display-node leg; no leg without Location metadata), floor-not-in-segments ⇒ `hasPath()` false + no draw, `setPath`/`clearPath` animation start/stop, two-stroke draw asserted via a mock 2D context recording `moveTo`/`lineTo`, engine handoff to `startAnchor` floor + center.
