# map-labels

## Purpose

`LocationLayer` draws the shop-name labels for labelable units on the active
floor — anchored at each unit's pre-resolved `label_point`/`label_rotation`,
shrunk to fit the unit polygon, and thinned by screen-rect overlap suppression so
labels read cleanly rather than colliding.

## Behavior

- A label is emitted **only** for a labelable placement — a tenant-kind unit
  carrying ≥1 tenancy, while the layer is visible (`labelsVisible`). A vacant
  `shop`-kind unit (no tenancy) and an `escalator` unit each emit **no** label; a
  tenanted shop unit emits its tenancy name.
- The label anchor equals `unit.label_point` and the angle equals
  `unit.label_rotation` **converted degrees → radians** — done once in the
  catalog at `DisplayNode` build time; the layer does **no** polylabel/OBB
  recompute.
- `_fitScale(labelW, labelH, unitW, unitH) = min(1, unitW/labelW, unitH/labelH)`
  returns `<1` for a long label in a small polygon (so the rotated text box fits
  the unit) and is **clamped at 1** — never upscales a label that already fits.
  Degenerate inputs (zero/negative dimension) fall back to 1.
- Overlap suppression: each candidate label is reduced to a screen-space rect and
  fed through the shared `computeVisibleRects` (RectVisibility/rbush) path; when
  two boxes overlap the lower-priority (later) one is dropped, so one survives.
  Candidates are ordered shorter-label-first (more likely to fit), ties broken by
  unit id for determinism. Survivors are exposed via `visibleLabels`.

## Interfaces & contracts

- `_fitScale(...)` — accepts `(lw,lh,uw,uh)` or `({width,height},{width,height})`
  or `({labelWidth,...})`; returns a finite scalar in `(0,1]`. Aliased as
  `fitScale` / `computeFitScale`.
- `class LocationLayer extends Layer` — `setLocationStore(store)`,
  `setFloor(levelCode)`, `setStyle(style)`, `renderWithContext(ctx)`,
  `get visibleLabels → Set`, `dispose()`. Reads `Location.displayNodes` filtered
  by active level + `node.labelable`.

## Data model

- Consumes **DisplayNode** (from `destination-catalog`): `point`, `rotation`
  (radians), `text`, `labelable`, `unitWidth`/`unitHeight` (the shrink-to-fit
  box). Owns no new persistent entities — `#visibleLabels` is per-render only.

## Decisions & constraints

- **Decision:** `label_point`/`label_rotation` are taken pre-resolved from the
  bundle (rotation converted deg→rad in the catalog). Rejected: recomputing
  anchor via polylabel/OBB at render time (redundant; the CMS already resolved it).
- **Decision:** `_fitScale` clamped at 1. Rejected: allowing upscale (would blow
  a small label past its unit extents).
- **Invariant:** rotation is stored/consumed in **radians** — reconciled with the
  catalog's deg→rad conversion during the build (a mismatch was caught and fixed
  at GREEN). Never re-derive label geometry in the layer.

## UX & accessibility

- **Layout & hierarchy:** shop names sit centered on their unit at the
  pre-resolved anchor/rotation, drawn at a fixed screen size (the `1/scale`
  transform undoes world zoom) with a light translucent background for contrast
  over fills; overlaps thin out gracefully.
- **Interaction:** labels track their unit during pan/zoom; suppressed labels
  reappear when zoom relieves the collision.
- **Responsive:** never upscales beyond the unit (`_fitScale ≤ 1`).
- **Accessibility:** label text mirrors the searchable `title`.
- **As built:** the component mounts its host DOM in `connectedCallback` (not the
  constructor) and no longer gates on `map-url` — a green-but-wrong QA catch where
  the component never mounted so labels rendered nothing; fixed so labels paint.

## Tests

- `test/layers/MapLabels.test.js` — labelable gate (vacant shop / escalator emit
  none, tenanted unit emits its name), anchor==`label_point` &
  angle==deg→rad, `_fitScale` <1 in a tight unit and clamped at 1, overlap
  suppression keeps one of two colliding labels.
