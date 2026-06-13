# Plan — Rewards-on-route markers

> **Mode:** standard (auto) — a new render layer + store + bundle data-passthrough + tap event spanning `BundleLoader`, `LocationModel`, the layer stack, `HitTestManager`, `MapEngine`, and the web component; one cohesive cycle with a `(ui)` marker capability.

<!-- Mid-epic feature insert. NOT one of the epic's predicted Phase-3 capabilities
(kiosk-here / deep-link-state / qr-share / brand-theming); it is a standalone cycle that
INHERITS the epic's cross-cutting decisions (split maps_/datas_ bundle behind the BundleModel
firewall; per-floor route `segments`; Canvas-2D layer/store architecture; synthetic-mini-bundle
testing; port 5010). At /tars:cleanup decide whether to record it as new capabilities under the
epic or as its own feature — do not re-litigate the inherited decisions here. -->

## What & why            (PM ↔ client)

- **Intent:** When a route is drawn, shops that carry an active reward **and** lie
  along the route get a gold **seal-percent** pin (seal glyph + a small label pill).
  This surfaces deals/offers in the user's path of travel — e.g. on the
  ABC Mart → ALDO route, **B-Store** (which carries the mall-wide voucher) shows a
  seal. Tapping a seal emits a `reward-tap` event carrying the reward records so the
  host app renders its own deal UI.
- **Constraints:**
  - **Rewards ride inside the existing `datas` half** (`datas.rewards[]`) — **no new
    URL, no new component attribute.** The `BundleModel` firewall and everything
    downstream stay byte-shape-identical except the added `rewards` field.
  - **Existing fixtures must keep loading (loader robustness, *not* product back-compat):**
    none of the test fixtures carry `rewards` — the pinned Phase-1 fixture, the synthetic
    mini-bundle, and the self-contained `load(string)` shape all lack it, and ~14 test
    files load them. So `rewards` stays **optional** (defaults to `[]`, **not** a
    required/validated key) purely so the existing suite and the `BundleModel` firewall
    don't break. Making it required buys nothing (production `datas` always carries
    `rewards`) and would force editing the frozen fixture — explicitly out of scope.
  - **Tests stay offline** — fetch mocked, fixtures from disk, no port bound. Assert
    data-driven *rules*; concrete counts live only in the synthetic mini-bundle (the
    pinned fixture's asserted counts must not change).
  - Markers must not compete with existing chrome: drawn **beneath** START/END
    speech-bubbles and floor-transition bubbles, **above** unit labels.
- **Decisions:**
  - **Source = `datas.rewards[]` passthrough** — rejected: a separate `deals-url` /
    component attribute (the data already lives in the `datas` half).
  - **Naming = `reward(s)`** throughout (store/layer/event/icon) — the data array is
    `rewards` and `type` may be `"deals"` *or* `"rewards"`.
  - **Both reward `type`s qualify** (`"deals"` + `"rewards"`) — rejected: `"deals"`-only
    (would drop B-Store, which only carries the mall-wide `"rewards"` voucher).
  - **Active-window filter on** — only rewards with `start_date ≤ now ≤ end_date` pin;
    `now` injectable for deterministic tests.
  - **Match = near-path buffer, route-gated** — a reward-shop pins when its display
    point is within a tunable buffer of the per-floor route polyline; **start/end shops
    suppressed**; **one pin per shop**; no route → no pins. Rejected: "every deal on the
    floor" (pins where you aren't walking); "endpoints only" (misses the path).
  - **Tap = event only** — emit `reward-tap` (`{shopId, rewards, location}`); host owns
    the deal UI. Rejected: a built-in callout (bakes deal-UI opinions into the component).
  - **Marker = seal + small label pill** — pill shows the primary reward `title`
    (truncated, small font) or `"N offers"` when a shop has ≥2 active rewards.

## How                   (tech lead — grounded in the codebase)

- **Module map:**
  - `src/data/BundleLoader.js` — carry `rewards` across the `#loadSplit` merge
    ([BundleLoader.js:231-241](src/data/BundleLoader.js#L231-L241)); `BundleModel`
    gains `this.rewards` + derived `this.rewardsByShopId` (mirrors `shopsById`,
    [BundleLoader.js:109-113](src/data/BundleLoader.js#L109-L113)).
  - `src/data/RewardStore.js` *(new)* — hydrates from the model; active-window +
    type-inclusive filter; `getRewardsByShopId(shopId)` (placed-shop aware via the
    existing catalog).
  - `src/navigation/` (or alongside the matcher) — a pure `rewardRouteMatch()` selecting
    reward-shops near the route polylines (reuses per-floor `segments` + a small
    point-to-segment distance helper).
  - `src/layers/RewardMarkerLayer.js` *(new)* — screen-space seal+pill renderer + `hitTest`,
    modeled on `PinMarkerLayer` (transform/icon cache) and `NavMarkerLayer` (hit-bubble
    bookkeeping).
  - `src/assets/icons.js` — add `ICON_SEAL_PERCENT`.
  - `src/interaction/HitTestManager.js` — short-circuit `type === 'reward'` in
    `#classifyHit` before unit-id extraction ([HitTestManager.js:93-98](src/interaction/HitTestManager.js#L93-L98)).
  - `src/core/MapEngine.js` — instantiate + register the layer in `#createLayers`
    (z-order above `LocationLayer`, below `PinMarkerLayer`/`NavMarkerLayer`); recompute the
    selection on route set/clear and on `setFloor`; register the `reward` hit handler →
    emit `tap:reward`.
  - `src/component/WayfinderMap.js` — add `'tap:reward': 'reward-tap'` to the `eventMap`
    ([WayfinderMap.js:1445-1460](src/component/WayfinderMap.js#L1445-L1460)).
  - `demo/basic.html` — add a `reward-tap` listener that `console.log`s `e.detail` (the
    built-in manual test hook).
- **Patterns:** new store mirrors `LocationStore` (engine hydrates it from the parsed
  model; the store never fetches). New layer mirrors `PinMarkerLayer`/`NavMarkerLayer`
  (screen-space counter-scaled draw; self-describing `hitTest` result). Tap classification
  mirrors the `floor-transition` short-circuit. Event surfacing mirrors the existing
  `tap:* → *-tap` `eventMap` re-dispatch.
- **Integration seams:** `BundleModel.rewards` (data in); `RewardStore` (active join);
  `rewardRouteMatch()` (route + catalog + buffer → selection); `RewardMarkerLayer.setSelection`/
  `setFloor` (render); `hitTest → {type:'reward'}` → `HitTestManager` → `tap:reward` →
  `reward-tap` (out). Matcher reads a shop's placements via `LocationStore.getLocation('shop:'+id).displayNodes` and start/end suppression via `route.startLocation`/`route.endLocation` ids.
- **Reuse:** `PinMarkerLayer` screen-space transform + icon cache/tint; `NavMarkerLayer`
  hit bookkeeping; `shopsById`-style indexing; per-floor `segments`; `LocationStore` shop→displayNodes join; `EventBus`/`eventMap`.
- **Cross-cutting tech-stack decisions:** inherited from `tars-epic.md` (Canvas-2D
  renderer; split-bundle behind `BundleModel`; route `segments` shape; raw CMS coords with
  `renderScale = 1`, so buffer + display points share one coordinate space; Vitest synthetic
  mini-bundle). No new cross-cutting decision → **no design panel** (single clear design,
  every piece follows an existing precedent).

## Capability breakdown

- [x] `reward-data` — `rewards` survives the split-bundle merge into `BundleModel` (array + `rewardsByShopId` index), and is optional/back-compatible. · depends on: none
- [x] `reward-catalog` — `RewardStore` surfaces only currently-active rewards (both types) for a placed shop. · depends on: `reward-data`
- [x] `reward-route-matching` — pure matcher selects reward-shops within a buffer of the per-floor route, route-gated, start/end suppressed, one per shop. · depends on: `reward-catalog`
- [x] `reward-markers` `(ui)` — `RewardMarkerLayer` draws a gold seal + small label pill at each matched shop on the active floor, at the correct z-order, recomputed on route/floor change. · depends on: `reward-route-matching`
- [x] `reward-tap` — tapping a seal emits `tap:reward`/`reward-tap` with the reward payload; demo logs it. · depends on: `reward-markers`

## How to test           (the binding acceptance criteria)

### `reward-data`
- Loading the split halves where the `datas` half has `rewards: [{id:9, shops:[3,477], …}]` yields a `BundleModel` whose `rewards` array deep-equals the input `datas.rewards`.
- `model.rewardsByShopId.get(3)` and `.get(477)` each include reward `9` (a reward listing multiple shops is indexed under every one of its `shops[]`).
- A shop id with no reward returns `undefined`/empty from `rewardsByShopId`.
- Loading a `datas` half **with no `rewards` key** succeeds (no `BundleLoadError`); the model's `rewards` is `[]` and `rewardsByShopId` is empty.
- The split validation does **not** list `rewards` as required: a `datas` half missing `rewards` but carrying `shops`+`categories` still validates.

### `reward-catalog`
- With injected `now` inside `[start_date, end_date]`, `getRewardsByShopId(shopId)` returns that reward; with `now` after `end_date` (or before `start_date`), it is excluded.
- A reward with `type:"deals"` and a reward with `type:"rewards"` are **both** returned when active (no type filtering).
- A placed shop with two active rewards returns both (length 2); a placed shop with none returns `[]`.
- A reward whose `shops[]` references an unplaced/unknown shop id does not throw and is simply not returned for any placed shop.

### `reward-route-matching`
- Given a synthetic route with a per-floor polyline and a reward-shop whose display point is within `buffer` of that polyline, the shop is in the selection; a reward-shop whose display point is beyond `buffer` is excluded.
- A reward-shop on a floor **not** present in `route.segments` is excluded; the same shop on a traversed floor near the line is included (`levelCode` carried on each selected entry).
- The route's start shop and end shop are **excluded** from the selection even when they carry active rewards and sit within the buffer.
- A shop with multiple display points near the line produces exactly **one** selection entry (deduped per shop), carrying that shop's active rewards.
- An empty/absent route produces an empty selection.

### `reward-markers` `(ui)`
- In `MapEngine`'s layer stack, the `RewardMarkerLayer` index is **greater than** `LocationLayer`'s and **less than** both `PinMarkerLayer`'s and `NavMarkerLayer`'s.
- After `navigateTo(start,end)` on a mini-bundle carrying rewards, the layer's selection reflects the matched shops on the active floor; after `setFloor` to another traversed floor the selection updates to that floor's matches; clearing the route empties it.
- `renderWithContext` on a mock 2D context draws one seal icon (`ICON_SEAL_PERCENT`) per selected shop at that shop's projected display point.
- The pill text drawn equals the primary reward's `title` truncated to the configured max length when the shop has one active reward, and `"<n> offers"` when it has `n ≥ 2`.
- *(refinement — seal-before-label + START/END-style bubble that clears the shop label)* The seal-percent badge is drawn **inline before (left of)** the caption text: in the recording context the seal's `drawImage` horizontal centre is **less than** the caption's `fillText` x, and the two share roughly the same vertical band — the marker reads as one row (`⊛ <title>`), not a vertical seal-under-pill stack. (Fails today: the seal centres on the anchor at x≈0, the caption centres above it at x≈0 — same x, stacked.)
- *(refinement)* The marker renders as a START/END-style speech bubble **offset above** the shop's display point: every drawn glyph of the marker (the seal `drawImage` **and** the caption `fillText`) sits at **negative** screen-space y in the anchor frame, so the display point (y≈0, where the shop label draws) is left **clear** — the marker no longer overlaps the shop label. The bubble carries a downward tail whose tip meets the display point (modelled on `PinMarkerLayer.#drawBubblePath`). (Fails today: the seal straddles y=0, covering the label.)
- *(refinement — protect the tap pipeline)* The offset bubble stays tappable at the shop: after `renderWithContext`, `hitTest` at the shop's display point still returns `{type:'reward', shopId, …}` (the hit target reaches the tail tip at the display point), so the existing reward-tap pipeline (`test/interaction/RewardTap.test.js`) is unaffected.

### `reward-tap`
- `RewardMarkerLayer.hitTest(x,y)` over a drawn seal returns `{type:'reward', shopId, rewards:[…]}`; a point off any marker returns `null`.
- A `reward`-typed hit short-circuits in `HitTestManager.#classifyHit` (no unit-id extraction) and causes the manager to emit `tap:reward` with `{shopId, rewards, location}` — and **not** `tap:location` or `tap:floor`.
- `WayfinderMap`'s `eventMap` maps `tap:reward → reward-tap`: emitting `tap:reward` on the engine bus dispatches a `reward-tap` `CustomEvent` on the element whose `detail` deep-equals `{shopId, rewards, location}`.
- `demo/basic.html` registers a `reward-tap` listener that calls `console.log` with the event detail (asserted by reading the demo file).

## Design intent         (UI-facing `(ui)` capabilities only — guidance, not a gate)

### `reward-markers`
- **Layout & hierarchy:** a gold/amber **seal-percent** badge (Phosphor `seal-percent` style — scalloped seal with a white `%`) anchored at the shop's display point, with a small white rounded pill beside/above it carrying the reward title in a **small** font (one short truncated line) or `"N offers"` for multiples. The badge reads as a compact accent — clearly subordinate to the dark START/END speech-bubbles and the floor-transition bubbles (which draw on top), and sitting above the unit labels. **Empty/loading/error:** no route or no matches → nothing is drawn (no idle pins); `rewards` data absent → silently no pins, map otherwise unchanged.
- **Interaction:** the seal + pill form one tap target; tapping fires `reward-tap`. No built-in popover — the host renders detail. Standard tap feedback only (touch-first; no hover dependency).
- **Responsive:** screen-space and counter-scaled like the existing marker layers; a min-font floor keeps the pill legible when zoomed out, and the badge does not upscale unboundedly when zoomed in.
- **Accessibility:** canvas-rendered, consistent with the existing markers (no DOM a11y surface added); the pill must keep legible contrast (amber border / dark text on white); the emitted event lets the host expose an accessible deal list outside the canvas.
- **Reference:** reuse `PinMarkerLayer`'s screen-space transform + icon cache/tint and `NavMarkerLayer`'s hit bookkeeping; amber accent (≈ `#E8B423`) deliberately distinct from the dark START/END bubbles; add `ICON_SEAL_PERCENT` to `src/assets/icons.js` as an inline data-URI like the other icons.
