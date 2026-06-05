# destination-search

## Purpose

The built-in search control filters the destination catalog by name/tokens and
opens an info card for the chosen destination. It is the accessible path to every
shop — the keyboard/text alternative to the decorative canvas.

## Behavior

- A query does a case-insensitive substring match over each Location's `title` +
  `search_tokens` (name + `unit_number` + category). A matching placed shop's
  Location appears in the results dropdown; a query matching nothing returns an
  empty result set. An **unplaced** shop (no Location in the catalog) is **not**
  searchable.
- Selecting a result opens the info card exposing the Location's `title`,
  `venue`, `logo` (when present), and `description`, and (via `destination-focus`)
  frames it on the map. This fixed a green-but-wrong where result-select never
  opened the info card because focus resolution failed — `#pickLocationNode` now
  reads `displayNodes`.
- A facility Location is searchable (mini-bundle: querying "toilet" returns the
  `unit:<id>`); connector units (escalator/elevator), never being Locations,
  never appear in results. Search is in-memory over the catalog index, so it is
  effectively instant.

## Interfaces & contracts

- Driven through `<wayfinder-map>`'s built-in search control (the `search-control`
  attribute); the search index is built from `LocationStore.locations` on the
  `data:loaded` event.
- Reads the catalog via `destination-catalog`'s `Location` fields (`title`,
  `search_tokens`, `venue`, `logo`, `description`); selecting a result calls
  `MapEngine.focusLocation(id)`.

## Data model

- Consumes `Location` (from `destination-catalog`). Owns the per-component search
  index `#searchIndex` (built from `locations`) and transient UI state
  (`#searchQuery`, `#searchOpen`, selected location). No persistent entities.

## Decisions & constraints

- **Decision:** search over the in-memory catalog index (placed shops +
  facilities). Rejected: searching raw `shops[]` (would surface unplaceable
  destinations).
- **Invariant:** only catalogued Locations are searchable — unplaced shops and
  connector units never appear. Result-select must resolve a `displayNode` to
  focus (the green-but-wrong fix).

## UX & accessibility

- **Layout & hierarchy:** desktop = top-left search panel with results dropdown +
  info card; mobile (≤768px) = fullscreen overlay with an expand/collapse info
  panel. Results show name + venue (+ logo when present).
- **Interaction:** type-to-filter with responsive results; selecting a result
  opens the info card and frames it on the map; clear/close returns to browse;
  empty state shows "no matches"; load is instant (in-memory index).
- **Responsive:** distinct desktop-panel vs mobile-fullscreen layouts at the
  768px breakpoint.
- **Accessibility:** labelled input, keyboard-navigable results, Esc closes,
  outside-pointer/focus handlers dismiss the panel.
- **As built:** result-select → info-card was live-browser-verified after the
  focus fix.

## Tests

- `test/component/DestinationSearch.test.js` — name/token substring match,
  empty-result query, unplaced shop not searchable, result-select opens info card
  (title/venue/logo/description), facility searchable + connector excluded.
