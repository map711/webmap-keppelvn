# Webmap Bundle Data Structure — `media/webmap/<CODE>_v001.json`

Field-by-field reference for the consumer map bundle the CMS publishes, e.g.
`media/webmap/SGC_v001.json`. Every shape below was read off the producing
serializers **and** verified against the live SGC seed file.

This is the *implementation* reference for the produced file. The higher-level
consumer contract (how the webmap normalizes/assembles these structures) lives
in [webmap.md](webmap.md) §5; the capability records are
[capabilities/webmap-map-payload.md](capabilities/webmap-map-payload.md) and
[capabilities/webmap-publish-integration.md](capabilities/webmap-publish-integration.md).

## Where it comes from

| | |
|---|---|
| **Path** | `media/webmap/<CODE>_v001.json` (+ a gzipped sibling `<CODE>_v001.json.gz`) |
| **Producer** | [task/jobs.py:128](task/jobs.py#L128) `run_publish()` → `build_webmap_payload(mall, base_url)` → `_replace_json_files("webmap/<CODE>_v001", bundle)` |
| **Builder** | [task/webmap/payload.py:19](task/webmap/payload.py#L19) `build_webmap_payload()` |
| **Encoding** | `json.dumps(data, indent=2, ensure_ascii=False)`, UTF-8; `.gz` is gzip of the same bytes ([task/jobs.py:36](task/jobs.py#L36)) |
| **One file per mall** | written behind the same `Publish` record as the CMS `datas/` files, so a webmap-build error fails the whole publish atomically |
| **Measured (SGC seed)** | ~2.0 MB raw / ~0.29 MB gzipped; 158 units, 5 levels, 10 kinds, 20 shops, 10 categories, 2 transitions |

Coordinates are **raw CMS map units** (no 0–1 normalization). All polygons are
GeoJSON `Polygon` with a closed outer ring (first point repeated as last);
`[x, y]` order throughout.

## Top-level shape

```jsonc
{
  "mall":            { … },        // object
  "levels":          [ … ],        // array, ordered by (position, id)
  "layers":          [ … ],        // array, ordered by id
  "kinds":           [ … ],        // array, ordered by (position, id)
  "units":           [ … ],        // array, ordered by id  (is_active only)
  "shops":           [ … ],        // array, ordered by id
  "categories":      [ … ],        // array, ordered by id  (GLOBAL, not mall-scoped)
  "navmesh_by_level":{ … },        // object keyed by stringified level id
  "transitions":     [ … ]         // array, cross-floor connector links
}
```

Producer: [task/webmap/payload.py:41](task/webmap/payload.py#L41). Serializers
are reused verbatim from the editor/CMS layers; only `units[]` is re-shaped (see
[serialize.serialize_webmap_unit](task/webmap/serialize.py#L18)).

---

## `mall`

`{id, name, code}` — the mall identity. `code` is the bundle filename stem
(`SGC` → `SGC_v001.json`).

```json
{ "id": 1, "name": "Saigon Centre", "code": "SGC" }
```

## `levels[]`

Serialized Level ([map/serializers.py:23](map/serializers.py#L23)). One floor.

| field | type | notes |
|---|---|---|
| `id` | int | PK; the key used by `navmesh_by_level` and `*_by_unit`/`level_id` references |
| `name` | str | display name, e.g. `"B2"` |
| `code` | str | short code, e.g. `"L3"` |
| `position` | int | sort key; **higher = higher floor** (SGC: B2=50, B1=100, L1=150, L2=200, L3=250) |
| `hidden` `locked` `opacity` | bool/bool/float | editor view-state — **consumer ignores these** (the viewer renders its own visibility) |

```json
{ "id": 1, "name": "B2", "code": "B2", "position": 50,
  "hidden": true, "locked": true, "opacity": 1.0 }
```

## `layers[]`

Serialized Layer ([map/serializers.py:54](map/serializers.py#L54)) — z-order /
style grouping within a level.

| field | type | notes |
|---|---|---|
| `id` | int | PK; referenced by `units[].layer_id` |
| `level_id` | int | owning Level |
| `parent_id` | int \| null | nesting parent layer, or `null` at top level |
| `name` | str | e.g. `"Layer 1"` |
| `position` | int | order within its parent |
| `hidden` `locked` `opacity` | bool/bool/float | editor view-state |
| `stroke_color` | str | hex, or `""` = inherit |
| `stroke_width` | float \| null | `null` = inherit |
| `fill_color` | str | hex, or `""` = inherit |

## `kinds[]`

Serialized Kind ([map/serializers.py:117](map/serializers.py#L117)) — the style
default + capability flags a unit's `kind` slug resolves to.

| field | type | notes |
|---|---|---|
| `id` | int | PK |
| `slug` | str | the value `units[].kind` carries (`"shop"`, `"escalator"`, `"elevator"`, `"stairs"`, …) |
| `label` | str | display name |
| `position` | int | sort key |
| `stroke_color` / `fill_color` | str | hex style defaults |
| `stroke_width` | float | style default |
| `is_system` | bool | seeded/locked kind |
| `is_tenant` | bool | **gates `units[].tenancies`** — a non-tenant kind emits `tenancies: []` |
| `is_routable` | bool | participates in routing |
| `is_connector` | bool | escalator/lift/stairs — eligible for cross-floor `transitions` |
| `is_accessible` | bool | step-free; feeds each transition's `is_accessible` aggregate |

```json
{ "id": 1, "slug": "shop", "label": "Shop", "position": 0,
  "stroke_color": "#1e40af", "stroke_width": 1.5, "fill_color": "#dbeafe",
  "is_system": true, "is_tenant": true, "is_routable": true,
  "is_connector": false, "is_accessible": false }
```

## `units[]`

The geometry + tenancy source. Base shape is
[map/serializers.py:71](map/serializers.py#L71) `serialize_unit`, re-shaped by
[task/webmap/serialize.py:18](task/webmap/serialize.py#L18)
`serialize_webmap_unit` with two deltas (active-tenancy gate, resolved label
placement). **Only `is_active = true` units are in the bundle** (filtered in
[payload.py:34](task/webmap/payload.py#L34)).

| field | type | notes |
|---|---|---|
| `id` | int | PK; referenced by `doors_by_unit` / `centroids_by_unit` keys, transition `members[].unit_id` |
| `level_id` | int | derived via `unit.layer.level_id` (Units have no direct level FK) |
| `layer_id` | int | owning Layer |
| `kind` | str | the Kind **slug** (join to `kinds[].slug` for style/flags) |
| `name` | str | often `""` (label comes from tenancies for shops) |
| `geometry` | object | GeoJSON `Polygon`, `{type, coordinates: [[ [x,y], … ]]}`, closed ring |
| `display_point` | [x,y] \| null | polygon bbox centroid, flattened from GeoJSON Point |
| `position` | int | draw/z order |
| `is_active` | bool | always `true` in the bundle (inactive units are excluded) |
| `hidden` `locked` `opacity` | bool/bool/float | editor view-state — viewer ignores |
| `stroke_color` | str | hex, or `""` = inherit from kind |
| `stroke_width` | float \| null | `null` = inherit from kind |
| `fill_color` | str | hex, or `""` = inherit from kind |
| `doors` | array | door **spans** on polygon edges (authoring form): `[{edge_index, t_start, t_end}]` — `edge_index` is the 0-based ring edge, `t_start`/`t_end` are the parametric span (0–1) along that edge. `[]` if none |
| `connector_group_id` | int \| null | ConnectorGroup membership (cross-floor link); `null` for non-connectors |
| `label_rotation` | float | **resolved label angle in DEGREES**, normalized into (-90, 90]. The stored `0` auto-sentinel is resolved to the min-area-OBB longer-axis angle ([labels.py:34](task/webmap/labels.py#L34)) |
| `label_point` | [x,y] | **resolved label anchor**. Auto (`label_offset` `[]`/`[0,0]`) → polygon pole-of-inaccessibility (`shapely.ops.polylabel`); explicit offset → `display_point + label_offset` ([labels.py:95](task/webmap/labels.py#L95)) |
| `tenancies` | array | `[{shop_id, name}]` — the shops occupying this unit. **Gated: emitted only when `kind.is_tenant`** is true; otherwise `[]` (DB rows are retained but inactive) |

> **`label_offset` is NOT present** on webmap units — it is dropped after being
> folded into `label_point`. (The editor bootstrap keeps the raw `label_offset`
> + sentinels; the webmap is the pre-resolved consumer form.) Do not look for it.

```jsonc
{
  "id": 108, "level_id": 5, "layer_id": 17, "kind": "shop", "name": "",
  "geometry": { "type": "Polygon", "coordinates": [[ [2376.7,2650.7], … ]] },
  "display_point": [2558.6, 2814.2],
  "position": 32, "is_active": true, "hidden": false, "locked": false, "opacity": 1.0,
  "stroke_color": "", "stroke_width": null, "fill_color": "",
  "doors": [ { "edge_index": 0, "t_start": 0.25, "t_end": 0.75 } ],
  "connector_group_id": null,
  "label_rotation": 0.0,
  "label_point": [2571.5, 2725.7],
  "tenancies": [ { "shop_id": 10, "name": "Starbucks" } ]
}
```

## `shops[]`

Serialized Shop ([task/serializers.py:35](task/serializers.py#L35)) — the
search/info source. `created_at`/`updated_at` excluded.

| field | type | notes |
|---|---|---|
| `id` | int | PK; join target for `units[].tenancies[].shop_id` |
| `mall` | int | mall id (FK) |
| `name` | str | |
| `slug` | str | |
| `logo` | str \| null | absolute URL under `base_url`, or `null` |
| `description` | str | long text |
| `category` | int \| null | category id (FK) — **a bare id**, join to `categories[]` |
| `unit_number` | str | e.g. `"L1-01"` |
| `contact_phone` `contact_email` `website` | str | may be `""` |
| `operating_hours` | object | e.g. `{open_time, close_time}` (whatever was stored) |
| `is_active` | bool | |

## `categories[]`

Serialized ShopCategory ([task/serializers.py:25](task/serializers.py#L25)).
**Global — not mall-scoped** (all categories are emitted).

| field | type | notes |
|---|---|---|
| `id` | int | join target for `shops[].category` |
| `name` | str | |
| `slug` | str | |
| `icon` | str \| null | absolute URL under `base_url`, or `null` |

## `navmesh_by_level`

An **object keyed by stringified level id** (`"1"`, `"2"`, …; JSON turns the
int keys into strings). One walkable-region triangulation per level, built fresh
via `routing.navmesh._build_walkable_uncached` (cold path, never the cache) and
trimmed to six of its eight tuple fields ([serialize.py:41](task/webmap/serialize.py#L41)).

> **A level with no buildable mesh is ABSENT from this object** — not present
> with empty arrays at the top level. Its geometry still publishes via `units[]`
> and `levels[]` (geometry never depends on routing). On the SGC seed, **L1
> (id 3) is absent**; the navmesh keys are `["1","2","4","5"]`.
>
> A level *can* be present with **empty** `vertices`/`triangles`/`adjacency`
> (e.g. a single unit filling the whole envelope) — present-but-empty ≠ absent.

Each mesh value:

| field | type | notes |
|---|---|---|
| `vertices` | `[[x,y], …]` | mesh vertex coordinates |
| `triangles` | `[[i,j,k], …]` | each is 3 indices into `vertices` |
| `adjacency` | `[[n0,n1,n2], …]` | **parallel to `triangles`**; each entry is the neighbor triangle index across that edge, or `-1` at a boundary |
| `doors_by_unit` | `{ "<unit_id>": [ {x, y, triangle_index}, … ] }` | door **midpoints projected into the mesh** (routing form) — `x,y` is the door point, `triangle_index` indexes `triangles`. Keyed by stringified unit id; `[]` if a unit reserves the key but no door projected |
| `centroids_by_unit` | `{ "<unit_id>": [x, y] }` | per-unit reachable centroid in mesh space, keyed by stringified unit id |
| `envelope_dims` | `[width, height]` | the level's walkable envelope extent (consumer normalization input) |

> **Two distinct "doors":** `units[].doors` are parametric edge spans
> `{edge_index, t_start, t_end}` (authoring form, on the polygon ring); a
> level's `navmesh_by_level[<lvl>].doors_by_unit` are those doors' **midpoints
> resolved into navmesh triangles** `{x, y, triangle_index}` (routing form).
> They are not interchangeable.

```jsonc
"4": {
  "vertices":  [ [283.1, 391.1], [283.1, 698.4], … ],   // 1624 verts
  "triangles": [ [7,5,0], [11,9,6], [5,7,12], … ],       // 2392 tris
  "adjacency": [ [-1,4,2], [10,9,14], [11,6,0], … ],     // 2392 rows, parallel
  "doors_by_unit":     { "10": [ {"x":1219.2,"y":4301.8,"triangle_index":1678} ], "2": [] },
  "centroids_by_unit": { "1": [1214.3, 1494.9], … },
  "envelope_dims": [4363.33, 4478.25]
}
```

## `transitions[]`

Cross-floor connector links from
[routing/navmesh_transitions.py:53](routing/navmesh_transitions.py#L53)
`build_transitions(mall)`. **One per ConnectorGroup that spans ≥2 distinct
levels** (a group with <2 members, or all members on one level, yields nothing).

| field | type | notes |
|---|---|---|
| `group_id` | int | ConnectorGroup PK (matches `units[].connector_group_id`) |
| `name` | str | group name |
| `direction` | str | `"bidirectional"` \| `"up"` \| `"down"` |
| `cost` | float | traversal cost = **MAX** over member kinds of `CONNECTOR_COSTS` (`escalator 1.0`, `elevator 2.0`, `stairs 3.0`; default `1.0`); order-independent |
| `is_accessible` | bool | `true` if **any** member kind `is_accessible` (step-free aggregate) |
| `members` | array | the connector units, `[{unit_id, level_id, centroid: [x,y], position}]` where `position` is the member's `Level.position` |

```json
{ "group_id": 1, "name": "elevator-grp", "direction": "bidirectional",
  "cost": 1.0, "is_accessible": false,
  "members": [
    { "unit_id": 67,  "level_id": 4, "centroid": [2127.6, 1647.5], "position": 200 },
    { "unit_id": 113, "level_id": 5, "centroid": [2124.5, 1649.6], "position": 250 }
  ] }
```

---

## Cross-reference quick-join map

- `units[].kind` → `kinds[].slug` (style + capability flags)
- `units[].layer_id` → `layers[].id`; `units[].level_id` → `levels[].id`
- `units[].tenancies[].shop_id` → `shops[].id` (a shop spanning many units = one destination)
- `shops[].category` → `categories[].id`
- `units[].connector_group_id` → `transitions[].group_id`
- `navmesh_by_level["<id>"]` / `transitions[].members[].level_id` → `levels[].id`
- `doors_by_unit` / `centroids_by_unit` keys (stringified) → `units[].id`

## Notes / gotchas

- **Stringified keys.** `navmesh_by_level`, `doors_by_unit`, and
  `centroids_by_unit` are JSON objects, so their integer ids serialize as
  strings (`"4"`, `"108"`). Parse back to int when joining to `units[].id` /
  `levels[].id`.
- **Editor view-state is advisory.** `hidden` / `locked` / `opacity` on
  levels/layers/units reflect the *editor*; the consumer renders its own
  visibility and should not honor them.
- **Inherit sentinels.** `""` (color) and `null` (`stroke_width`) on a unit mean
  "inherit from `kind`"; resolve by merging the unit override over its kind.
- **Labels are pre-resolved** — no auto sentinels to interpret: `label_rotation`
  is finite **degrees** and `label_point` is a concrete `[x,y]`. (Note: this is
  degrees, not radians.)
- **Coordinates are raw CMS units**, `[x, y]`, un-normalized; use
  `navmesh_by_level[<lvl>].envelope_dims` (or the units' bbox) to normalize.
