# reward-catalog

## Purpose

Surface, for a **placed** shop, only the rewards that are **currently active** —
the active-window join over the parsed `rewards` and the destination catalog.
`RewardStore` is to rewards what `LocationStore` is to destinations: the engine
hydrates it once from the already-parsed `BundleModel` plus the hydrated catalog;
the store never fetches.

## Behavior

- `hydrate(model, …)` builds the catalog from `model.rewardsByShopId` (restricted
  to the **placed** shops named by the catalog's `shop:<id>` Locations) plus the
  injected `now`. No fetch. Idempotent — a second `hydrate` is a no-op
  (`#loaded` guard).
- `getRewardsByShopId(shopId, now?)` returns the shop's **active** rewards (always
  an array — never `null`/`undefined`). A reward is active iff
  `start_date ≤ now ≤ end_date` (**inclusive**); a missing bound is treated as
  **open** on that side; with **no injected `now`** the window can't be evaluated,
  so nothing is active.
- **Type-inclusive:** both `type:"deals"` and `type:"rewards"` qualify — `type` is
  never consulted to drop a reward.
- **Placed-shop aware:** an unplaced/unknown shop id returns `[]` even if a
  dangling `reward.shops[]` names it; a dangling reference is never surfaced for
  any placed shop and never throws at hydrate.
- `now` is **injectable** four ways — constructor `{now}`, `hydrate` option,
  `setNow(v)` / `now=` setter, and a per-call `getRewardsByShopId(id, now)`
  override — so the active-window is deterministic in tests.
- Numeric-string shop ids are normalized, so a catalog `shop:1` (→ `1`) collates
  with a numeric `reward.shops[0]` (`1`).

## Interfaces & contracts

- `new RewardStore({ now } = {})` — optional injected reference instant.
- `hydrate(model, arg2?, arg3?)` — tolerant call shapes:
  `hydrate(model, {catalog|locationStore, now})`, `hydrate(model, catalog, {now})`,
  `hydrate(model, {now})`. A catalog-shaped arg has a `locations` array +
  `getLocation`.
- `getRewardsByShopId(shopId, now?) → Array` — the active rewards for a placed
  shop (always an array).
- `get/set now`, `setNow(value)` — inject/replace the reference instant.

## Data model

- Indexes `model.rewardsByShopId` filtered to **placed** shop ids. `placedShopIds`
  is derived from the catalog's `shop:<id>` Location ids. Active-window bounds read
  `reward.start_date` / `reward.end_date` (date-ish; unparseable → open).

## Decisions & constraints

- **Decision:** active-window filter on (`start_date ≤ now ≤ end_date`, inclusive;
  `now` injectable) — rejected: always-show (would pin expired/future offers).
- **Decision:** type-inclusive (both `"deals"` + `"rewards"`) — rejected:
  `"deals"`-only (drops B-Store, which carries only the mall-wide `"rewards"`
  voucher).
- **Decision:** store hydrates from the parsed model + catalog, **never fetches** —
  mirrors `LocationStore` (the engine owns the single data load).
- **Decision (run remediation):** dropped a dead `rewards[]`-grouping fallback in
  `#deriveRewardsByShopId` — the `BundleModel` always supplies the `Map`, so the
  store has a single hydration path.
- **Invariant:** `getRewardsByShopId` never throws and always returns an array;
  unplaced ids and dangling `shops[]` refs yield `[]`.

## Tests

- `test/data/RewardStore.test.js` — inclusive active-window edges (in-window,
  after-end, before-start), type-inclusivity, two-active vs none, dangling
  unplaced `shops[]` ref not surfaced, no-`now` case.
