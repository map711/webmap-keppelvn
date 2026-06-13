# Run — Rewards-on-route markers
Started:  2026-06-13 13:21:42
Status:   ✓ complete · resume — `reward-markers` redesign re-driven green (1 capability)

<!-- Roster agents append their own ### <slug> subsections + per-gate ticker lines as the run crosses each gate.
Ticker line format:  HH:MM  <gate>  <symbol> <note>   ·   gates in loop order: RED · integrity · GREEN · review · QA -->

## Progress

Legend: `✓` pass · `⤺` remediation iter · `✗` fail/blocked · `⚠` highlight · `ⓘ` note.

### reward-data ✓
- test-writer: RED tests for Reward data passthrough (BundleModel.rewards + rewardsByShopId).
  13:24  RED        ✓ 5 tests written, fail on assertion (model.rewards / rewardsByShopId absent)
  13:25  integrity  ✓ pins all 5 criteria (C1/C2/C4 RED on assertion; C3/C5 faithful guards)
  13:26  GREEN      ✓ passing (impl 1/4)
  13:28  review     ✓ no findings ≥80
  13:30  QA         ✓ code-only · criteria 1–5 verified (independent BundleLoader split-load; rewards passthrough + shopId index + optional/no-rewards)
  13:31  complete   ✓ capability passed all gates

### reward-catalog ✓
- test-writer: RED tests for Reward catalog (RewardStore active-window store).
  13:33  RED        ✓ 12 tests written, fail on assertion (src/data/RewardStore.js absent)
  13:35  integrity  ✓ pins all 4 criteria (12 tests, all RED on meaningful assertion; no gameable patterns)
  13:37  GREEN      ✓ passing (impl 1/4) · RewardStore active-window catalog, 12/12; full suite 269/269
  13:39  review     ✗ 1 warning: dead rewards[]-grouping fallback in #deriveRewardsByShopId (unreachable; BundleModel always supplies the Map)
  13:40  review     ✓ fixed (dead model.rewards fallback removed)
  13:41  review     ✓ finding #1 resolved; no findings ≥80
  13:44  QA         ✓ code-only · criteria 1-4 verified (28 indep assertions; inclusive edges, multi-shop dangling ref, no-now case)
  13:45  complete   ✓ capability passed all gates

### reward-route-matching ✓
- test-writer: RED tests for Reward route matching (pure rewardRouteMatch near-path selection).
  13:47  RED        ✓ 12 tests written, fail on assertion (src/navigation rewardRouteMatch absent)
  13:49  integrity  ✓ pins all 5 criteria
  13:51  GREEN      ✓ passing (impl 1/4)
  13:53  review     ✓ no findings ≥80 (1 info: speculative multi-shape arg handling)
  13:56  QA         ✓ code-only · criteria 1–5 verified (independent harness; active-window gating, call-shape parity, distance correctness)
  13:57  complete   ✓ capability passed all gates

### reward-markers ✓
- test-writer: RED tests for Reward markers layer (RewardMarkerLayer seal+pill, z-order, route/floor/clear selection).
  14:04  RED        ✓ 7 tests written, fail on assertion (RewardMarkerLayer / ICON_SEAL_PERCENT absent)
  14:06  integrity  ✓ pins all 4 criteria (z-order, route/floor/clear selection, seal-per-shop, pill caption)
  14:12  GREEN      ✓ passing (impl 1/4)
  14:15  review     ✓ no findings ≥80 (2 info: dead fields)
  14:24  QA         ✓ browser+code · criteria 1–4 verified independently (live seal+pill rendered, route/floor/clear selection, z-order above LocationLayer below pin/nav)
  14:25  complete   ✓ capability passed all gates
  20:07  GREEN      ✓ passing (impl 1/4) · refinement 5–7: seal-before-label inline bubble offset above point w/ downward tail; hit box reaches tail tip (10/10, full suite 313 green)
  20:17  complete   ✓ capability passed all gates (post-refinement)

### reward-tap ✓
  14:30  RED        ✓ 10 tests written (4 criteria), fail on assertion vs pristine HEAD (reward-tap wiring absent)
  14:32  integrity  ✓ pins all 4 criteria (10 tests; 9 RED on meaningful assertion vs pristine, 1 correct pre-impl negative guard; no gameable patterns)
  14:34  GREEN      ✓ passing (impl 1/4)
  14:37  review     ✗ 1 warning: tap:reward double-emit (generic #onTap emit + handler re-emit) → reward-tap fires twice, first detail wrong-shape
  14:39  review     ✓ fixed (double tap:reward emit removed; 10/10 gated + 298 full pass)
  14:42  review     ⤺ #1 resolved in src; new warning — criterion-2 self-wired re-emit masks #onTap payload (mutation proves regression stays GREEN)
  14:44  review     ✓ fixed (criterion-2 self-wired re-emit removed; #onTap emit now bound — mutation goes RED; 10/10 + 298 full pass)
  14:46  review     ✓ finding #2 resolved (mutation-verified); no new findings ≥80
  14:52  QA         ✓ code-only · criteria 1–4 verified (real layer hitTest + manager short-circuit + component eventMap CustomEvent + demo hook; dist bundle carries the wiring)
  14:53  complete   ✓ capability passed all gates

Ended:    2026-06-13 14:54:25
Duration: 1h 32m 43s · 5/5 green · 0 blocked · 0 errored

## Highlights  ← for the human · to improve the agents

- ✓ **Clean cycle — all 5 capabilities green on impl 1/4**, zero integrity rewrites, zero
  integrity exhaustion, nothing blocked/skipped/errored. The plan's acceptance criteria
  translated into faithful RED tests with no gaming, and the design (RewardStore mirrors
  `LocationStore`, `RewardMarkerLayer` mirrors `PinMarkerLayer`/`NavMarkerLayer`, tap
  short-circuit mirrors `floor-transition`) followed existing precedent end-to-end. Full
  suite grew to **298 passing** with no regressions.
- ⚠ **`reward-tap` — review backstop earned its keep, twice.** First it caught a `tap:reward`
  **double-emit** (generic `#onTap` emit + handler re-emit → `reward-tap` fired twice, first
  detail wrong-shape). Then a deeper weak-test catch: the criterion-2 test **self-wired its
  own re-emit**, masking the real `#onTap` payload binding — a mutation stayed GREEN.
  Remediation removed the self-wired re-emit (mutation now goes RED) and bound `#onTap`
  properly. This is the green-but-wrong class the gate exists for — worth a **test-writer
  nudge: a test must never re-wire the production behavior it's meant to verify.**
- ✓ **`reward-catalog` — dead-code catch.** Review flagged an unreachable `rewards[]`-grouping
  fallback in `#deriveRewardsByShopId` (the `BundleModel` always supplies the Map) and it was
  removed — kept the store honest to its single hydration path.
- ⓘ **`reward-markers` `(ui)` got real browser QA** (chrome-devtools-mcp present, not skipped):
  live seal+pill render verified, z-order confirmed above `LocationLayer` / below
  `PinMarkerLayer`+`NavMarkerLayer`, and route/floor/clear selection exercised in a real browser.

Legend: `✓` pass · `⤺` remediation iter · `✗` fail/blocked · `⚠` highlight · `ⓘ` note.

---

### ↻ resumed 2026-06-13 19:59:09 — fold-in fix: `reward-markers` redesign

Re-driving `reward-markers` after `/tars:fix` folded three refinement criteria into the
plan: seal-percent drawn **inline before the label**, the marker reshaped as a START/END-style
speech bubble **offset above** the shop's display point (so it no longer blocks the shop label),
and a guard that the offset bubble stays tappable. The other four capabilities stay `[x]` and
are skipped.

#### 20:03 — RED (test-writer)
  20:03  RED        ⤺ 3 refinement tests added to TARS cap:reward-markers block; crit 5+6 fail on assertion (seal cx 0≮0; seal bottom 24≮0), crit 7 guards tappable-at-point
  20:05  integrity  ✓ pins all 7 criteria (refinement: 5/6 RED on meaningful y/x assertions, 7 tappability guard green; no gameable patterns)
  20:10  review     ✓ no findings ≥80 (3 info: dead fields)
  20:16  QA         ⓘ code-only (browser-QA skipped: chrome-devtools-mcp could not attach) · criteria 1–7 re-verified independently post-refinement: z-order Floor<Nav<Loc<Reward<Pin<NavMarker (real engine), navigateTo/setFloor/clearRoute selection via real routing stack, 1 ICON_SEAL_PERCENT/shop, caption=title|<n> offers, seal-before-label inline row, whole marker above point + tail tip at (0,0), hitTest(0,0)→reward across all size buckets; 313/313 green

Ended:    2026-06-13 20:18:07
Duration: 18m 58s · 1/1 green · 0 blocked · 0 errored  (resume segment; 5/5 cycle total)

## Highlights (resume)  ← for the human · to improve the agents

- ✓ **`reward-markers` redesign green on impl 1/4**, zero integrity rewrites, zero review
  residue, zero QA residue. The three folded-in refinement criteria (5 = seal-percent inline
  **before** the label; 6 = START/END-style speech bubble **offset above** the display point
  with a downward tail tip at the anchor, so the marker stops covering the shop label; 7 =
  the offset bubble stays tappable at the point) translated into faithful RED tests — crit 5+6
  went RED on meaningful x/y assertions (`seal cx 0 ≮ 0`; `seal bottom 24 ≮ 0`), crit 7 a
  tappability guard. The redesign was purely additive to criteria 1–4 (world-anchor translate,
  one `ICON_SEAL_PERCENT`/shop, caption text all preserved) and to `reward-tap` — **full suite
  grew 298 → 313 with no regressions.**
- ⓘ **`(ui)` browser-QA skipped — chrome-devtools-mcp could not attach**, so the offset-bubble
  redesign was QA'd **code-only** (criteria 1–7 re-verified independently across every responsive
  size bucket: seal-before-label inline row, whole marker above the point with the tail tip at
  (0,0), `hitTest(0,0) → reward`). **Live-browser smoke is owed** for the visual refinement — run
  `/tars:review --ui` once the browser tool is free (this joins the Phase-2 `(ui)` smokes already
  owed per `overview.md`).
