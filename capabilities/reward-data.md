# reward-data

## Purpose

Carry the CMS's loyalty **rewards** across the split-bundle load so everything
downstream can read them off the parsed model. The `datas_…` half may carry a
`rewards: [{id, shops:[…], …}]` list; this capability surfaces it on
`BundleModel` (verbatim array + a shop→rewards index) **optionally** — none of the
pinned test fixtures carry `rewards`, so a missing key must keep loading.

## Behavior

- `BundleModel` exposes `this.rewards` — `bundle.rewards` verbatim when it is an
  array, else `[]`. Downstream code always reads an array, never `undefined`.
- `BundleModel` derives `this.rewardsByShopId` — a `Map<shopId, reward[]>`. A
  reward listing N shops is indexed under **every** id in its `shops[]` (mirrors
  `shopsById`), so `.get(shopId)` returns the rewards touching that shop; a shop
  with no reward is **absent** (so `.get` yields `undefined`).
- `BundleLoader.#loadSplit` carries `rewards: datas.rewards` across the merge as an
  **optional** datas-half key — it is **not** in the required key-set, so a `datas`
  half missing `rewards` (but carrying `shops`+`categories`) still validates; the
  `BundleModel` then defaults it to `[]`. Extra `datas_` keys (banners/events/
  malls) remain ignored, never becoming model fields.
- The merge stays the firewall: `rewards` is the **only** added `BundleModel`
  field; the merged object is otherwise byte-shape-identical to the old single
  bundle, so nothing else downstream observes the change.

## Interfaces & contracts

- `BundleModel.rewards: Array` — the `datas.rewards` list verbatim, or `[]`.
- `BundleModel.rewardsByShopId: Map<number, Array>` — shop id → rewards touching
  it; absent for a shop with no reward.
- `BundleLoader.#loadSplit` merge — includes `rewards: datas.rewards` (optional;
  the model normalizes a missing value to `[]`).

## Data model

- **Reward** — `{ id, shops: number[], type: "deals"|"rewards", title,
  start_date, end_date, … }`. Owned by the CMS's `datas_…` half; carried verbatim.
  Indexed in `rewardsByShopId` under every id in `shops[]`.

## Decisions & constraints

- **Decision:** source = `datas.rewards[]` passthrough — rejected: a separate
  `deals-url` / component attribute (the data already rides the `datas` half, so
  no new URL and no new attribute).
- **Decision:** `rewards` is **optional / unvalidated** (defaults to `[]`), not a
  required key — rejected: required+validated (would force editing the frozen
  Phase-1 fixture and break the ~14 fixture-loading tests; production `datas`
  always carries `rewards`, so required buys nothing).
- **Invariant:** the merge is the firewall — `rewards` is the only new
  `BundleModel` field; everything else stays byte-shape-identical. Don't add a
  second `rewards` source or validate it.
- **Invariant:** a reward is indexed under **every** one of its `shops[]` (mirrors
  `shopsById`); a no-reward shop is absent from the index.

## Tests

- `test/data/BundleLoader.test.js` — the fenced `>>> TARS cap:reward-data` block:
  `model.rewards` deep-equals the input, a multi-shop reward is indexed under each
  `shops[]` id, an unknown shop id yields `undefined`, a `datas` half with **no**
  `rewards` key loads (`rewards === []`, empty index), and the split validation
  does not list `rewards` as required.
