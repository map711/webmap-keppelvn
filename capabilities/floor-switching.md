# floor-switching

## Purpose

Let a visitor switch between SGC's 5 floors. The engine's floor selection swaps
the active level's geometry + labels; the level selector lists the floors in
physical order. A user-initiated switch **preserves the current view** (zoom /
pan / rotation) so spatial context carries across levels; only the initial load
(and explicit programmatic calls) refit. Every floor is selectable — including
the empty L1 and the sparse B2/B1.

## Behavior

- `getFloors()` / the level selector lists all **5** level codes ordered by
  `Level.position` (B2 lowest … L3 highest). Ordering is computed by
  `sortFloorCodesByPosition(floorCodes, levels)` (`controls/levelOrder.js`),
  falling back to input order when `position` is absent.
- `setFloor(code)` makes `code` the active rendered level: it pushes the level's
  `MapLevel` into the floor layer and calls `setFloor(code)` on the location /
  navigation / pin / nav-marker layers, sets `currentFloor === code`, conditionally
  refits the view to the new level's bounds, and emits `floor:changed`
  `{floor: code}` — re-emitted by the component as the `floor-changed` DOM event.
- **Refit policy.** The engine refits on the **initial load** (`!previousFloor`)
  or on an explicit `{fitToBounds:true}` floor change; `{fitToBounds:false}`
  always suppresses it. The two **user-facing** switch paths — the level-selector
  tap (`WayfinderMap.#handleLevelSelectorClick`) and the connector-pin
  (floor-transition) tap — both pass `{fitToBounds:false}` to **keep the current
  view**, joining the navigation/focus pan paths. The engine's own default
  (refit on a real floor change) is unchanged; only those call sites opt out.
- On load, `default-floor` (if set) is the active floor; unset → the first floor
  by the engine's priority. Selecting **L1** activates it without error and
  renders its (empty, 0-unit) geometry, still framing sensibly via the
  `getBounds()` fallback; B2/B1 (1 unit each) likewise activate and render
  cleanly.

## Interfaces & contracts

- `MapEngine.getFloors() → string[]` (position order) / `getLevels()` /
  `getCurrentFloor() → string`.
- `MapEngine.setFloor(code, {fitToBounds=true}?)` — swaps active level + refits +
  emits `floor:changed {floor}`.
- Bus event `floor:changed {floor}` → DOM event `floor-changed`.
- `sortFloorCodesByPosition(floorCodes, levels) → string[]`
  (`src/component/controls/levelOrder.js`).

## Data model

- Reads `MapLevel` (from `floor-rendering`) and `Level.position` (from the
  catalog/geometry stores). Owns `MapEngine.#currentFloor` (the active-floor
  pointer). No new persistent entities.

## Decisions & constraints

- **Decision:** user-facing floor switches **preserve the view** (`{fitToBounds:false}`
  at the level-selector and connector-pin call sites). Rejected: refit on every
  user switch (loses spatial context when stepping between levels — the original
  forked-shell behavior). Earlier-rejected variant: refit only on first load
  (UI floor-taps never reframed) — superseded; the engine still defaults to
  refit-on-change, only the call sites opt out.
- **Decision:** L1 is selectable and renders empty (browse/search work; only
  routing to/from it is a Phase-2 error). Rejected: hiding L1 from the selector.
- **Invariant:** the selector lists all 5 levels ordered by `Level.position`;
  every floor — empty or sparse — activates without error.
- **Invariant:** a user-initiated floor switch never refits — the active level
  changes but zoom/pan/rotation are held. Only `!previousFloor` (initial load)
  or an explicit `{fitToBounds:true}` triggers a refit.

## UX & accessibility

- **Layout & hierarchy:** a vertical floor-button stack, highest floor on top,
  the active floor clearly marked, ordered by `Level.position`.
- **Interaction:** one tap switches floors while **holding the current view**
  (no refit jump) so the visitor keeps their bearings; the selection state is
  obvious; L1 is selectable like any floor.
- **Responsive:** comfortable tap targets on mobile/kiosk.
- **Accessibility:** ARIA-labelled, keyboard-navigable buttons with a visible
  focus ring; the current floor is marked.
- **As built:** brownfield — the forked shell already implemented the floor API,
  so this capability was pinned with a fault-injection-verified regression-lock
  (5 mutations flip RED) rather than classic RED, plus the refit fix above.

## Tests

- `test/core/FloorSwitching.test.js` — 5 codes in `position` order, `setFloor`
  swaps geometry+labels + `floor:changed` event, default-floor vs priority on
  load, empty L1 + sparse B2/B1 activate and render without error. Refit policy:
  a plain `setFloor` (no options) still refits (programmatic/initial-load
  contract); a **connector-pin (floor-transition) tap preserves the view** (fires
  the registered handler, switches the active level, **no** refit); an explicit
  `{fitToBounds:false}` opts the level-selector / navigation / focus paths out.
