# floor-switching

## Purpose

Let a visitor switch between SGC's 5 floors. The engine's floor selection swaps
the active level's geometry + labels and refits the view; the level selector
lists the floors in physical order. Every floor is selectable — including the
empty L1 and the sparse B2/B1.

## Behavior

- `getFloors()` / the level selector lists all **5** level codes ordered by
  `Level.position` (B2 lowest … L3 highest). Ordering is computed by
  `sortFloorCodesByPosition(floorCodes, levels)` (`controls/levelOrder.js`),
  falling back to input order when `position` is absent.
- `setFloor(code)` makes `code` the active rendered level: it pushes the level's
  `MapLevel` into the floor layer and calls `setFloor(code)` on the location /
  navigation / pin / nav-marker layers, sets `currentFloor === code`, **refits**
  the view to the new level's bounds, and emits `floor:changed` `{floor: code}`
  — re-emitted by the component as the `floor-changed` DOM event.
- Refit happens by default on a floor change (`options.fitToBounds !== false`);
  internal pan paths opt out with `{fitToBounds:false}`. This fixed a
  green-but-wrong where `setFloor` only refit on first load, so a UI floor-tap
  never refit.
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

- **Decision:** `setFloor` refits by default; pan paths opt out. Rejected: refit
  only on first load (UI floor-taps never reframed — the green-but-wrong review
  catch).
- **Decision:** L1 is selectable and renders empty (browse/search work; only
  routing to/from it is a Phase-2 error). Rejected: hiding L1 from the selector.
- **Invariant:** the selector lists all 5 levels ordered by `Level.position`;
  every floor — empty or sparse — activates without error.

## UX & accessibility

- **Layout & hierarchy:** a vertical floor-button stack, highest floor on top,
  the active floor clearly marked, ordered by `Level.position`.
- **Interaction:** one tap switches floors with a quick refit; the selection
  state is obvious; L1 is selectable like any floor.
- **Responsive:** comfortable tap targets on mobile/kiosk.
- **Accessibility:** ARIA-labelled, keyboard-navigable buttons with a visible
  focus ring; the current floor is marked.
- **As built:** brownfield — the forked shell already implemented the floor API,
  so this capability was pinned with a fault-injection-verified regression-lock
  (5 mutations flip RED) rather than classic RED, plus the refit fix above.

## Tests

- `test/core/FloorSwitching.test.js` — 5 codes in `position` order, `setFloor`
  swaps geometry+labels + refit + `floor:changed` event, default-floor vs
  priority on load, empty L1 + sparse B2/B1 activate and render without error.
