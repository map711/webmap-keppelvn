# destination-focus

## Purpose

Focus a single destination — from a search result or a direct tap on its shop
polygon. Focusing switches floor if needed, zooms in, and drops an end pin at the
shop; clearing returns to browse. This is the capstone of Phase 1's "browse the
map": every other capability feeds into it.

## Behavior

- `focusLocation('shop:<id>')` resolves the Location, switches to a floor the
  shop occupies if not already there (`setFloor(floor, {fitToBounds:false})`),
  animates a zoom-in, and places an end pin at the shop's `displayNode` point;
  the focused Location is reflected by the engine.
- Tapping a shop polygon resolves `unitId → Location(s)` through the catalog's
  one-to-many index: a **single-tenant** unit focuses that one Location and emits
  `tap:location` (DOM `location-tap`) carrying it; a **multi-tenant** unit (≥2
  Locations, e.g. unit 121) emits `tap:disambiguate` (DOM `location-disambiguate`)
  rather than silently picking one, so both shops stay reachable.
- Cross-floor focus switches the floor first. For a multi-unit shop, focus
  targets the unit on the current floor when present, else the shop's first
  unit/floor (`#pickLocationNode` chooses the on-current-floor candidate).
- A host page can focus a shop **declaratively** at startup via the
  `focus-shop-id` attribute on `<wayfinder-map>`: on `ready` (and on later
  attribute change) the component resolves `shop:<id>` and delegates to the same
  `focusLocation` path, then enters `focus` map mode. This is the bundle-honest
  sibling of `focus-node-id` — `focus-node-id` targets a flat graph node (Phase-2
  routing), which the published bundle does not carry, whereas `focus-shop-id`
  works against the Phase-1 catalog.
- `clearRoute()` (return to browse) removes the pin and restores browse mode.

## Interfaces & contracts

- `MapEngine.focusLocation(locationId, {clearRoute=true, scale?, ...}?)` —
  switch floor + zoom + drop end pin; returns the focused Location.
- `MapEngine.focusNode(nodeId, opts?)` — resolves the node's parent Location and
  delegates to `focusLocation`.
- `MapEngine.clearRoute()` — removes the pin, restores browse.
- Attribute `focus-shop-id="<n>"` on `<wayfinder-map>` — declarative startup
  focus; `#applyInitialFocusShop(animate=true)` resolves `shop:<n>` and calls
  `focusLocation(..., {animate, duration:900})`, setting `focus` map mode on
  success. Observed in `attributeChangedCallback` so it re-applies on change.
- Bus `tap:location` → DOM `location-tap`; bus `tap:disambiguate` → DOM
  `location-disambiguate` (both via the component's `#wireEvents` re-emit map).
- Pin drawn by `PinMarkerLayer` (end marker) at the resolved `displayNode` point.

## Data model

- Reads `Location` + `DisplayNode` (catalog) and `MapLevel` (geometry). Owns the
  transient focus state (`#focusedLocationId`, the rendered end pin) and the
  camera target. No persistent entities.

## Decisions & constraints

- **Decision:** a multi-tenant unit tap disambiguates (emits
  `tap:disambiguate` with both Locations) rather than auto-selecting. Rejected:
  silently focusing one tenant of a shared polygon.
- **Decision:** focus from search and focus from polygon-tap behave identically
  (both route through `focusLocation`). Rejected: divergent focus paths.
- **Invariant:** the end pin renders at the focused `displayNode` point — a
  green-but-wrong where the mock hid the pin was fixed with a render fallback.
- **Invariant:** `minScale` must be re-derived on each refit — a stale `minScale`
  left after fitting a tiny floor (B2/B1) blocked the focus zoom-in (stuck at
  2.5×); the QA fix refits to ~0.17 after a tiny floor so focus can zoom past it.

## UX & accessibility

- **Layout & hierarchy:** the focused destination is centered and zoomed with a
  single end pin (speech-bubble style) showing its name; the rest of the floor
  recedes.
- **Interaction:** focusing from search or from a polygon tap behaves
  identically; a cross-floor focus switches floors first; clear removes the pin
  and returns to browse.
- **Responsive:** focus zoom level + pin sizing scale per device/DPR.
- **Accessibility:** the pin's information (destination name) is available as
  text, not color alone.
- **As built:** live-browser-verified — focus zooms + drops its pin after the
  `minScale` refit fix; clear restores browse.

## Tests

- `test/core/DestinationFocus.test.js` — `focusLocation` switch-floor + zoom +
  end-pin at `displayNode`; single-tenant tap → `location-tap`, multi-tenant
  (unit 121) → disambiguate; cross-floor + multi-unit unit selection;
  `clearRoute` removes pin / restores browse; real-component `#wireEvents`
  forwarders (forwarder-disable flips RED).
