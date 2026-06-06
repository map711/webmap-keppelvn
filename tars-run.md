# Run — Phase 2: Wayfinding (Keppel Webmap / SGC)
Started:  2026-06-06 08:19:11
Status:   ✓ complete

## Progress

<!-- Roster agents append their own ### <slug> subsections + per-gate ticker lines as the run crosses each gate.
Ticker line format:  HH:MM  <gate>  <symbol> <note>   ·   gates in loop order: RED · integrity · GREEN · review · QA -->

### navmesh-routing ✓
  08:27  started — RED tests for triangle-A* + funnel + cross-floor
  08:27  RED       ✓ 13 tests written, fail on assertion (ports unbuilt)
  08:27  RED       ⚠ smoke 9 cross-floor: no L2 shop on seed; routes to L2 escalator anchor
  08:29  integrity  ✓ pins all 9 criteria; behavioural, no gameable tests
  08:44  GREEN      ✓ passing (impl 1/4) — 13/13 ports+PathFinder; full suite 140 green
  08:47  review    ✗ ⚠ dead #cache in PathFinder (memoises nothing); 13/13 green
  08:49  review    ✓ removed dead #cache field; 13/13 + 140 suite green
  08:50  review     ✓ re-check: #cache finding resolved; no new issues
  08:55  QA        ✓ code-only · criteria 1-9 verified independently (incl. real SGC)
  Completed: 2026-06-06 08:55

### route-preferences ✓
  08:59  started — RED tests for connector soft penalty + step-free hard gate
  08:59  RED       ✓ 9 tests written; step-free gate red on assertion (is_accessible/NO_PATH)
  08:59  RED       ⚠ soft-penalty (crit 1-3) pre-built under navmesh-routing; lift kind=elevator not 'lift'
  09:00  integrity  ✓ pins all 6 criteria; behavioural, no gameable tests
  09:03  GREEN     ✓ passing (impl 1/4); step-free gate + is_accessible; 148 suite green
  09:06  review    ✓ no findings ≥80; soft penalty + step-free gate correct, tests behavioural
  09:09  QA        ✓ code-only · criteria 1-6 verified (incl real SGC); ⓘ kind='elevator' not 'lift'
  Completed: 2026-06-06 09:09

### unroutable-level-handling ✓
  09:14  started — RED tests for typed failure codes (MESHLESS/UNKNOWN/SNAP), no throw
  09:14  RED       ✓ 9 tests written, 7 fail on assertion (codes + fromId/toId payload)
  09:14  RED       ⚠ crit-5 (2 tests) green-but-correct: meshless already browseable, no-leak holds
  09:16  integrity  ✓ pins all 6 criteria; behavioural, hardcoded codes, no gameable tests
  09:20  GREEN     ✓ typed codes + fromId/toId payload; 30/30 file, 157/157 suite
  09:22  review    ✓ no findings ≥80; typed codes + route:error payload correct, tests behavioural
  09:26  QA        ✓ code-only · criteria 1-6 verified on real bundle (48+11 asserts)
  Completed: 2026-06-06 09:26

### route-rendering ✓
  09:31  started — RED tests for per-floor slice + two-stroke draw + engine handoff
  09:31  RED       ⚠ 13 tests; regression-lock (impl pre-exists), fault-injected RED on each criterion
  09:34  integrity ✓ pins all 5 criteria; fault-injection confirms each flips RED
  09:35  GREEN     ✓ 13/13 pass; impl pre-existed from navmesh-routing (impl 1/4)
  09:38  review    ✓ no findings ≥80; per-floor slice + two-stroke + engine handoff correct
  09:42  QA        ✓ code-only · criteria 1-5 verified (real layer+engine); ⓘ browser-QA skipped (chrome-devtools busy)
  Completed: 2026-06-06 09:42

### route-markers ✓
  09:47  started — RED tests for start/end pins + transition bubbles + clearRoute fan-out
  09:48  RED       ✓ 10 tests (4 RED on assertion: stored-transition coords + hitTest)
  09:50  integrity  ✓ pins all 4 criteria; crit 2/3 RED on coords
  09:53  GREEN      ✓ passing (impl 1/4) — NavMarkerLayer reads stored transitions
  09:56  review    ✗ ⚠ end pin never renders in prod (result has no endLocation)
  09:59  review    ✓ ⚠ end pin sourced from anchor; PathFinder threads endLocation
  10:02  review    ✓ re-check: both findings resolved; 53 tests green
  10:08  QA        ✓ ⓘ criteria 1-4 verified on real stack+engine; browser-QA skipped (chrome-devtools locked)
  Completed: 2026-06-06 10:08

### search-to-route ✓
  10:16  started — RED tests for from/to nav UI + connector/step-free toggles + navigateTo
  10:16  RED       ⚠ 14 tests; 13 regression-lock (impl pre-exists, fault-injected RED), 1 RED on engine.setStepFree seam
  10:17  integrity ⤺ ⚠ 13/14 already green pre-impl (scaffold); toggle UI untested → rewrite
  10:25  RED       ⤺ ⚠ narrowed to connectorConstraint seam; 6 RED via real lift/escalator toggles
  10:26  integrity ✓ pins all 5 criteria; 6 RED on connector-constraint seam
  10:29  GREEN     ✓ passing (impl 1/4) — connectorConstraint hard gate in PathFinder
  10:33  review    ✓ pass — 196/196 green; all 5 criteria bound, no weak tests
  10:40  QA        ✓ ⓘ crit 1-5 verified on real engine (45 asserts, fixture+SGC); browser-QA skipped (chrome-devtools locked); ⚠ no distinct step-free toggle (lift-only constraint serves accessibility)
  Completed: 2026-06-06 10:40

Ended:    2026-06-06 10:41:32
Duration: 142m 21s · 6/6 green · 0 blocked · 0 errored

## Highlights  ← for the human · to improve the agents

- ✓ **route-markers** — review backstop earned its keep: caught that the **end pin never renders in prod** (the `RouteResult` carried no `endLocation`), fixed by threading `endLocation` from the anchor through `PathFinder`. A green-but-wrong the unit tests alone missed.
- ✓ **navmesh-routing** — review caught a **dead `#cache` field in `PathFinder`** that memoised nothing; removed. No behavioural impact, but a real over-engineering smell flagged before it set a precedent.
- ⚠ **search-to-route** — the integrity gate fired **1 rewrite**: 13/14 RED tests were green *before* implementation (the carried-over scaffold already satisfied them — regression-locks, not new-behaviour pins). Tests were narrowed to the real `connectorConstraint` seam (6 genuine RED). Nudge: when a capability's impl pre-exists from scaffolding, test-writer should target the *new seam* up front rather than regression-lock the scaffold.
- ⓘ **route-preferences / search-to-route** — connector kind slug is `'elevator'`, not `'lift'`, in the real bundle; the lift toggle maps to it. Harmless naming mismatch, worth a doc note so callers don't assert `'lift'`.
- ⓘ **route-rendering · route-markers · search-to-route** (all `(ui)`) — **browser-QA skipped** (chrome-devtools-mcp busy/locked during the run). Each was QA'd code-only against the real layer + engine stack; a live-browser smoke pass is still owed. Run `/tars:review --ui` (or re-QA) once the browser tool is free.
- ⚠ **search-to-route** — no *distinct* step-free toggle in the UI; the lift-only connector constraint serves the accessibility path. Acceptable per plan, but flag if a separate step-free control is wanted later.

Legend: `✓` pass · `⤺` remediation iter · `✗` fail/blocked · `⚠` highlight · `ⓘ` note.
