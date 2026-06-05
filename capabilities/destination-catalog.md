# destination-catalog

## Purpose

`LocationStore` builds the searchable/routable destination catalog from the
parsed bundle. It is the data spine for search and focus: it turns the bundle's
shops + tenancies + facility units into namespaced `Location` records and the
`unitId → Location(s)` index that polygon taps resolve through.

## Behavior

- **Catalog = placed shops + routable facilities only.** One `shop:<id>`
  Location per **distinct `shop_id` referenced by any unit tenancy** — so the
  count equals the number of distinct tenancy `shop_id`s, **not** `shops[].length`.
  On the SGC seed that is **5** (Starbucks, ABC Mart Grand Stage, ASICS,
  Basta Hiro, Armani Exchange — from 4 tenanted units, all on L3); the 15 shops
  in `shops[]` referenced by no tenancy yield **no** Location.
- **Multi-unit shop:** a shop occupying several units lists every unit in
  `unitIds[]` and every spanned floor in `levelCodes[]` (no such shop on the real
  seed — verified on the mini-bundle).
- **Multi-tenant unit:** one polygon with ≥2 tenancies produces **one
  `shop:<id>` Location per tenancy**, each listing that shared `unitId`. Real
  seed: unit 121 → both `shop:7` (ASICS) and `shop:11` (Basta Hiro), so
  `getLocationsByUnitId(121)` returns **both**. The index is genuinely
  one-to-many.
- **Facility Locations:** a unit whose kind is `is_routable && !is_connector &&
  !is_tenant` becomes one `unit:<id>` Location (mini-bundle: a `toilet` unit). On
  the real SGC seed this set is **empty** — no facility units placed.
- **Excluded:** connector units (escalator/elevator), non-routable units
  (entrance/parking/other), and vacant shop-kind units (149 of 153 on this seed)
  produce **no** Location.
- Each Location carries `title` (shop name), `search_tokens` (de-duped:
  name + `unit_number` + category name), `logo`/`description`/`venue`, and
  `displayNodes` — one thin placement record per owned unit, with `point` =
  the unit's `label_point`, `rotation` from `label_rotation`, `levelCode`
  derived from `unit.level_id`.

## Interfaces & contracts

- `LocationStore.hydrate(bundle, {renderScale}?)` — build the catalog from an
  already-parsed `BundleModel` (or a legacy `{locations,levels,nodes}` payload,
  auto-discriminated). `load(url, opts?)` is the fetch-then-hydrate variant.
- `getLocation(id) → Location|undefined` — by namespaced id (`shop:<id>` /
  `unit:<id>`).
- `getLocationsByUnitId(unitId) → Location[]` — **one-to-many**: `[]` for a
  connector/vacant unit, one for single-tenant, ≥2 for multi-tenant.
- `getLevelByCode(code)` / `getLevel(id)` / `getLocationsOnLevel(code)` —
  preserved shell seam. `locations` / `levels` public arrays preserved.
- `class Location` — `{ id, title, label, kind, search_tokens, venue, logo,
  description, category, unitIds[], levelCodes[], displayNodes[] }`;
  `isOnLevel(code)`, `getNodesOnLevel(code)`.
- `class DisplayNode` — `{ id, unitId, levelCode, point:Point, rotation (rad),
  fitScale, text, labelable, unitWidth, unitHeight, location }`.

## Data model

- **Location** — one per placed shop (`shop:<id>`) or routable facility
  (`unit:<id>`). Owns `unitIds[]` / `levelCodes[]` / `displayNodes[]`.
- **DisplayNode** — a per-unit placement; back-references its owning Location.
  `rotation` is stored in **radians** (`label_rotation` deg → rad at build time).
- **Index:** `locationsByUnitId: Map<unitId, Location[]>` (one-to-many).

## Decisions & constraints

- **Decision:** catalog is placed-shops-only — a shop with no tenancy yields no
  Location. Rejected: one Location per `shops[]` entry (would surface 15
  unplaceable destinations).
- **Decision:** `unitId → Location` is one-to-many; a multi-tenant unit yields
  one Location per tenancy and a polygon tap disambiguates. Rejected: silently
  picking one tenant for a shared unit.
- **Decision:** string-namespaced ids `shop:<id>` / `unit:<id>` (inherited from
  the epic). Rejected: numeric `+1e6` facility offsets (fragile, silent
  collisions).
- **Invariant:** `shop:<id>` count == distinct tenancy `shop_id` count (5 on the
  seed), never `shops[].length`. Connectors are never Locations.
- **Invariant:** `getLocationsByUnitId` always returns a list (possibly empty),
  never a scalar — the HitTestManager classifier depends on `.length`.

## Tests

- `test/data/LocationCatalog.test.js` — placed-shop-only count (=5 vs real SGC),
  multi-tenant unit 121 → both Locations, multi-unit shop (mini-bundle), facility
  `unit:<id>` (mini-bundle) / empty on real seed, connector & vacant exclusion,
  one-to-many `getLocationsByUnitId`, `displayNodes` anchor/rotation/level.
