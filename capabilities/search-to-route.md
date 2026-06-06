# search-to-route (ui)

## Purpose

Wire the built-in from/to search + connector toggles to the router: choosing a
*from* and a *to* drives `engine.navigateTo` with string-namespaced ids, live
toggles re-route, and route/error feedback lands in the summary panel — the
end-to-end "search → see the route" path, plus the equivalent public
`element.navigateTo({from, to})` API.

## Behavior

- With both `from` and `to` chosen, triggering navigation calls
  `engine.navigateTo(fromId, toId, …)` with the string-namespaced ids; on success
  the component enters `navigation` mode and the summary panel shows the resolved
  **from/to titles**.
- The **lift / escalator** toggle sets the route mode and **re-routes** (the next
  `route-found` reflects the chosen connector kind); the **step-free** constraint
  sets `stepFree` and re-routes.
- A **failed** route (e.g. a meshless destination) dispatches a `route-error` DOM
  event and surfaces the error in the summary — no polyline drawn.
- `clearRoute` from the UI returns the component to **browse** mode (nav summary
  hidden, route layers cleared).
- `element.navigateTo({from, to})` (public API) returns the `RouteResult` and
  drives the same rendering as the built-in UI.

## Interfaces & contracts

- `WayfinderMap.navigateTo({from, to})` (public element method) → `RouteResult` — string-namespaced ids (`shop:<id>` / `unit:<id>`).
- Bus → DOM re-emit (`WayfinderMap.#wireEvents`): `route:found`→`route-found`, `route:cleared`→`route-cleared`, `route:error`→`route-error`.
- Drives `engine.navigateTo(fromId, toId, options)` and the `RouteManager.setRouteMode` / step-free seam (`connectorConstraint`) for live re-routing.

## Data model

- Consumes the catalog **Location** ids (`shop:<shop_id>` / `unit:<unit_id>`) from `destination-search`, and **RouteResult** for the summary. UI state (mode `browse|navigation`, chosen from/to, toggle state) is component-local.

## Decisions & constraints

- **Decision:** reuse the scaffolded nav UI (from/to fields, connector toggles, summary panel) already present in `WayfinderMap`; only the `connectorConstraint` seam to the router is new. Rejected: a fresh nav panel.
- **Invariant:** navigation is **destination → destination** only this phase — you-are-here as a start is deferred to Phase-3 `kiosk-here`.
- **Note (as built):** there is **no distinct step-free toggle** in the UI — the lift-only connector constraint serves the accessibility path. Flag if a separate step-free control is wanted later.
- **Note (test integrity):** the carried-over scaffold already satisfied 13/14 first-draft RED tests (regression-locks, not new-behaviour pins); the integrity gate forced a rewrite narrowed to the real `connectorConstraint` seam (6 genuine RED). When an impl pre-exists from scaffolding, pin the **new seam**, not the scaffold.

## UX & accessibility

- **Layout & hierarchy:** the Phase-1 search panel reused — a from/to pair with connector toggles and a bottom **summary panel** (from → to, error inline). Desktop = top-left panel; mobile (≤768px) = fullscreen overlay + bottom summary card.
- **Interaction:** choosing a *to* (search result or polygon tap) and a *from* triggers routing; toggles re-route live; a back/clear control returns to browse.
- **Responsive:** 768px breakpoint inherited; summary is a bottom card on mobile, inline on desktop.
- **Accessibility:** labelled from/to inputs, keyboard-navigable results, Esc clears; ARIA-labelled connector toggles with visible focus; error text is readable, not color-only.
- **As built / owed:** QA'd **code-only** on the real engine (fixture + SGC); a **live-browser smoke pass is still owed** (chrome-devtools-mcp locked during the run).

## Tests

- `test/component/SearchToRoute.test.js` — from/to drives `navigateTo` with namespaced ids + summary titles, lift/escalator and step-free toggles re-route, failed route dispatches `route-error` + summary error with no polyline, `clearRoute` returns to browse, public `element.navigateTo({from,to})` returns `RouteResult` and renders.
