# reward-tap

## Purpose

Turn a tap on a reward seal into a single host-facing `reward-tap` DOM event
carrying the shop's reward records, so the host app can render its own deal UI.
Wires the `RewardMarkerLayer` hit through `HitTestManager` and the component's
`eventMap`; the component owns **no** built-in deal UI.

## Behavior

- `RewardMarkerLayer.hitTest(x,y)` over a drawn seal returns a self-describing
  `{type:'reward', shopId, rewards, location}`; a point off any marker returns
  `null`.
- `HitTestManager.#classifyHit` **short-circuits** on `result.type === 'reward'`
  **before** the unit-id extraction (so the reward payload isn't misread as a unit
  id), returning `{type:'reward', locations:[], payload:{shopId, rewards,
  location}}`.
- `#onTap` emits the **`payload` verbatim** as a **single** `tap:reward` (using
  `payload ?? {standard envelope}`); the engine registers **no** `reward` handler,
  so nothing re-emits. `reward-tap` therefore fires **exactly once** with the clean
  `{shopId, rewards, location}` detail — and **not** `tap:location` or `tap:floor`.
- `WayfinderMap`'s `eventMap` maps `tap:reward → reward-tap`, dispatching a
  `reward-tap` `CustomEvent` on the element whose `detail` deep-equals
  `{shopId, rewards, location}`.
- `demo/basic.html` registers a `reward-tap` listener that `console.log`s
  `event.detail` — the built-in manual-test hook.

## Interfaces & contracts

- `RewardMarkerLayer.hitTest` → `{type:'reward', shopId, rewards, location}|null`
  (see `reward-markers`).
- `HitTestManager.#classifyHit` → `{type, locations, payload?}` — a self-describing
  hit carries an optional `payload`, the clean detail `#onTap` emits verbatim
  (exactly once, no re-emit).
- `WayfinderMap` `eventMap` entry — `'tap:reward': 'reward-tap'`.
- Host-facing event — `reward-tap` `CustomEvent`, `detail = {shopId, rewards,
  location}`.

## Data model

- `detail` / `payload` = `{ shopId, rewards: Reward[], location }` — sourced from
  the `RewardMarkerLayer` hit marker (the `rewardRouteMatch()` entry). No
  persistence.

## Decisions & constraints

- **Decision:** tap = **event only** (`{shopId, rewards, location}`); the host owns
  the deal UI — rejected: a built-in callout/popover (bakes deal-UI opinions into
  the component).
- **Decision:** a self-describing hit carries its own clean `payload`, emitted
  verbatim by the **single** generic `#onTap` emit; the handler (if any) does a
  side-effect only and **never re-emits** — mirrors the `floor-transition` pattern.
- **Invariant (run remediation, twice):** exactly **one** `tap:reward` with the
  documented shape. A double-emit (generic `#onTap` emit + a handler re-emit) once
  fired `reward-tap` twice with a malformed first detail — the engine re-emit was
  removed. And a test must **never self-wire the re-emit it's verifying**: the
  criterion-2 test once did, masking the real `#onTap` payload binding so a
  mutation stayed GREEN; fixed so the mutation goes RED.
- **Invariant:** the `reward` hit short-circuits `#classifyHit` **before** unit-id
  extraction (else the payload is misread as a unit id) — keep it ahead of the
  unit path, like `floor-transition`.

## Tests

- `test/interaction/RewardTap.test.js` — real-layer `hitTest` over a drawn seal
  (and `null` off it); the `#classifyHit` short-circuit emits a single `tap:reward`
  with `{shopId, rewards, location}` (not `tap:location`/`tap:floor`); the
  component `eventMap` dispatches a `reward-tap` `CustomEvent` whose `detail`
  deep-equals the payload; and `demo/basic.html` carries the `console.log`
  listener (asserted by reading the demo file).
