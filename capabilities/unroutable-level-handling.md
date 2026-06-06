# unroutable-level-handling

## Purpose

Make every unroutable request fail **predictably and visibly** instead of
throwing: a meshless level, an unknown destination, an un-snappable unit, or a
genuine no-path each return a typed `{success:false, code}` result. The floor a
failed route touched stays fully browseable — no route state leaks onto it.

## Behavior

- Destination on a **meshless** level ⇒ `{success:false, code:'MESHLESS_LEVEL'}`,
  no throw.
- **Unknown** destination id ⇒ `{success:false, code:'UNKNOWN_DESTINATION'}`.
- A destination that resolves to a unit with **no snappable navmesh point** (no
  `doors_by_unit` and no `centroids_by_unit` entry) ⇒ `{success:false,
  code:'SNAP_FAILED'}`.
- A genuine disconnected/no-connector planning failure ⇒ a planning code
  (`no-path` / `no-mesh` / `no-transition`).
- `RouteManager.navigateTo` on any `!success` result **emits `route:error`** with
  `{code, error, fromId, toId}`, leaves `getCurrentRoute()` `null`, and populates
  no layer.
- The meshless level **remains selectable/browseable**: `setFloor(meshless)`
  after a failed route succeeds and the floor renders normally.

## Interfaces & contracts

- `export const RouteError` — frozen enum. Destination-resolution codes are
  UPPERCASE: `UNKNOWN_DESTINATION`, `MESHLESS_LEVEL`, `SNAP_FAILED`. Planning
  codes are lowercase-hyphenated: `NO_MESH:'no-mesh'`, `NO_PATH:'no-path'`,
  `NO_TRANSITION:'no-transition'`.
- `PathFinder.findPath(...)` / `findPathToAnchor(...)` — on failure return
  `{ success:false, code, message?, fromId?, toId? }`; never throw.
- `RouteManager.navigateTo(fromId, toId, options)` — on `!success` emits the bus
  event `route:error` (re-emitted to the DOM as `route-error`) and returns the
  failed result.

## Data model

- **RouteResult (failure variant)** — `{ success:false, code, error?, fromId?, toId? }`. Owns no persistence; produced per call by `PathFinder` and surfaced by `RouteManager`.

## Decisions & constraints

- **Decision:** typed failure result, router never throws. Rejected: throwing on unroutable input (forces every caller into try/catch; loses the code).
- **Decision:** meshless level renders/browses/searches normally — only *routing* to/from/through it fails. Rejected: hide the level or fake a detour transition.
- **Invariant:** a failed route must not mutate layer/route state — `getCurrentRoute()` stays `null` and the touched floor stays browseable (no leak).
- **Invariant:** the failure `code` is a stable enum value callers can switch on; resolution codes are UPPERCASE, planning codes lowercase-hyphenated.

## Tests

- `test/navigation/NavmeshRouting.test.js` — `MESHLESS_LEVEL` / `UNKNOWN_DESTINATION` / `SNAP_FAILED` no-throw, `route:error` payload `{code,error,fromId,toId}` with `getCurrentRoute()` null, and `setFloor(meshless)` after a failed route still renders.
- Opt-in real-bundle smoke: a destination on **L1** (id 3, no mesh) ⇒ `{success:false, code:'MESHLESS_LEVEL'}`.
