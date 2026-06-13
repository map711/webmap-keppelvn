# reward-route-matching

## Purpose

Select the reward-shops that lie **along a drawn route** — the pure geometry join
between a `RouteResult`, the placed-shop catalog, and the active-reward store —
plus the auto-derived near-path buffer that gates "near". `rewardRouteMatch()`
produces the selection the `RewardMarkerLayer` renders; `deriveRewardBuffer()`
picks the proximity threshold. Both are pure; the engine wires them in
`MapEngine`.

## Behavior

`rewardRouteMatch(route, locationStore, rewardStore, buffer)` returns one entry
per qualifying shop — `{shopId, levelCode, rewards, location}` — applying, in
order:

- **route-gated** — a shop whose only near placements are on floors **not** in
  `route.segments` is excluded; a placement on a traversed floor near the line is
  included, carrying the `levelCode` it was matched on.
- **near-path** — a display point within `buffer` (world units) of that floor's
  route polyline qualifies the shop (shortest point-to-polyline distance over the
  segment set).
- **endpoint-suppressed** — the route's own `startLocation`/`endLocation` shops
  are dropped even when they carry active rewards and sit within the buffer.
- **reward-gated** — only shops with ≥1 **currently-active** reward (from
  `RewardStore.getRewardsByShopId`) qualify.
- **deduped per shop** — a shop with several near placements yields exactly **one**
  entry (the first match wins; matching stops there).
- **empty** — a null / `success:false` / empty-`segments` / absent-store route
  yields `[]`.

`deriveRewardBuffer(locationStore, {factor, override, envelope})` resolves the one
global near-path threshold, in order: (1) an absolute `override` (finite ≥ 0) wins
verbatim; (2) else `factor × median(placed-shop mean unit extent)` over display
nodes with a **positive** extent (so meshless/extent-0 units don't drag the median
to zero); (3) else `envelopeFraction × the cross-floor envelope diagonal`
(degenerate data — never silently "show everything"); (4) else `Infinity`.

`MapEngine` resolves `#rewardBuffer` **once at load** via `deriveRewardBuffer`
(reading `rewardBufferFactor` / `rewardBuffer` config + the cross-floor envelope),
then `#updateRewardSelection(result)` recomputes the full selection on every route
set/clear and pushes it to the layer (which filters to the active floor at render
time). Coordinates are raw CMS units with `renderScale === 1`, so the buffer and
the display points share **one** coordinate space.

## Interfaces & contracts

- `rewardRouteMatch(arg1, arg2, arg3, arg4) → Array<{shopId, levelCode, rewards, location}>`
  — tolerant call shapes: `({route, locationStore, rewardStore, buffer})`,
  `(route, {locationStore, rewardStore, buffer})`, or positional
  `(route, locationStore, rewardStore, buffer)`. A `buffer` of `0` is a valid
  (degenerate) threshold; missing/`NaN` → `Infinity`.
- `deriveRewardBuffer(locationStore, { factor = 1, override = null, envelope = null,
  envelopeFraction = 0.04 }) → number`.
- Both re-exported from `src/navigation/index.js`.
- Config keys: `rewardBuffer` (number, default `null` = relative path wins;
  absolute override; `responsive`) and `rewardBufferFactor` (number, default `1`;
  `responsive`).

## Data model

- Consumes **RouteResult**: `segments: Map<levelCode,[x,y][]>` (the route gate +
  the polylines) and `startLocation`/`endLocation` (endpoint suppression).
- Consumes **LocationStore**: `locations` (filtered to `shop:<id>` ids), each
  carrying `displayNodes` with `point`, `levelCode`, and `unitWidth`/`unitHeight`
  (the buffer-derivation extent).
- Consumes **RewardStore**: `getRewardsByShopId(shopId)` (the reward gate +
  payload).

## Decisions & constraints

- **Decision:** match = near-path buffer, route-gated, start/end suppressed, one
  per shop — rejected: "every deal on the floor" (pins where you aren't walking)
  and "endpoints only" (misses the path).
- **Decision:** the buffer is **relative** — `factor × median placed-shop extent`,
  resolved once at load — so the proximity gate tracks the bundle's coordinate
  scale; an absolute `rewardBuffer` override wins (mirrors absolute `maxZoom`
  beating the relative `maxZoomFactor`). Rejected: a guessed constant.
- **Decision:** pure matcher, **no PathFinder dependency** — the route is consumed
  purely as geometry; reuses the inherited raw-coords / `renderScale = 1` decision
  so buffer + display points need no transform.
- **Invariant:** one entry per shop (deduped across display nodes); no route →
  `[]`; the matcher never mutates the route or the stores.

## Tests

- `test/navigation/RewardRouteMatch.test.js` — near vs beyond buffer, route-gating
  by traversed floor, start/end suppression, multi-node dedupe to one entry, and
  the empty/absent-route case; call-shape parity; distance correctness.
- `test/navigation/RewardBuffer.test.js` — `deriveRewardBuffer` resolution order
  (override wins, `factor × median` extent, positive-extent-only median, envelope
  fallback, `Infinity` floor).
