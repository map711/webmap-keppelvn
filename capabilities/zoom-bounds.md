# zoom-bounds

## Purpose

Resolve the map's zoom-in ceiling **relative to the data** rather than as a fixed
world scale, so every floor shares **one** global "you can't zoom past this"
limit no matter how big or small the individual floor is. The largest floor (the
one that fits smallest) sets the reference; the ceiling is a configurable factor
above it. Without this a fixed `maxZoom` either over-restricts a big floor or lets
a small floor zoom into a blur.

## Behavior

- **Cross-floor envelope.** On `data:loaded`, the engine reduces every floor's
  bounds (`MapGeometryStore.getLevelByCode(code).getBounds()`) to a single
  per-axis-maximum box via `computeEnvelope`. Fitting that one worst-case box
  yields the **smallest fit scale of any floor** — the "largest fitted view". The
  envelope is `null` when no floor has finite positive dims.
- **Relative ceiling, re-derived on every refit.** `#restoreConfiguredScaleBounds`
  (which runs after every `fitToBounds`, since a fit lowers `minScale` to the
  floor's fit scale) resolves the max as `maxZoomFactor × computeFitScale(envelope)`
  at the **live canvas size** — so the ceiling tracks canvas resizes — via
  `transform.setMaxScaleFromFit(envelope, factor)`. The min is restored to the
  configured min when numeric (via `setMinScale`).
- **Absolute override still wins.** A non-null `maxZoom` config is an absolute
  world-scale cap that bypasses the relative path entirely (both at init and in
  `#restoreConfiguredScaleBounds`). Default `maxZoom` is `null` → the relative
  `maxZoomFactor` path (default factor `5`) wins.
- **Provisional bounds before data.** At construction the data (and thus the
  envelope) isn't loaded yet, so the engine sets provisional bounds: the
  configured min (or `0.1`) and either the absolute `maxZoom` or
  `PROVISIONAL_MAX_SCALE = 8`. The first fit replaces the max with the resolved
  global ceiling.
- **Animated focus clamps to the live ceiling.** `MapEngine`'s animated
  center-on path clamps a caller's requested `scale` to the current
  `transform.getScaleBounds()` `{min,max}` before animating — so e.g.
  search/focus asking for scale `3` never animates past the resolved global
  ceiling (it would otherwise overshoot then snap back).
- **Degenerate-safe.** `setMaxScaleFromFit` ignores a non-finite or non-positive
  fit scale (zero-area canvas/envelope) and leaves the existing max untouched;
  `computeFitScale` guards zero-width/height bounds with a `|| 1` denominator.
  Setting a new max below the current scale **clamps the current scale down**.

## Interfaces & contracts

- `computeEnvelope(boundsList) → {width,height}|null` (`src/core/zoomBounds.js`) —
  per-axis maxima across a list of `{width,height}` (skips `null`/non-finite/≤0);
  `null` when none usable.
- `TransformPipeline.computeFitScale(bounds, padding=0) → number` — scale at which
  `bounds` exactly fits the usable canvas (limiting axis); the fit math
  `fitToBounds` now also calls (extracted, single source).
- `TransformPipeline.setMinScale(min)` / `setMaxScale(max)` — set one bound and
  re-clamp the current scale.
- `TransformPipeline.setMaxScaleFromFit(bounds, factor, padding=0)` — set
  `max = computeFitScale(bounds,padding) × factor`; no-op on a degenerate fit.
- `MapEngine` config keys consumed: `maxZoom` (number|null), `maxZoomFactor`
  (number), `minZoom` (number|'fit').

## Data model

- Owns `MapEngine.#zoomEnvelope` (`{width,height}|null`, computed once per load),
  `#configuredMaxZoom`, `#configuredMaxZoomFactor`, `#configuredMinZoom`. No
  persistent entities. Reads `Level.getBounds()` from `MapGeometryStore`.
- Config schema (`src/core/Config.js`): `maxZoom` default `null` (was `2.5`),
  new `maxZoomFactor` default `5`, both `responsive`.

## Decisions & constraints

- **Decision:** max zoom is **relative** — `factor × the largest floor's fit
  scale` — computed in `TransformPipeline` (it owns the fit math) from the
  cross-floor envelope. Rejected: a fixed absolute `maxZoom` for all floors
  (over-restricts the big floor / blurs the small one).
- **Decision:** keep the absolute `maxZoom` as an **opt-in override** (non-null
  wins) rather than removing it — hosts with normalized data or a hard cap need
  it. Rejected: drop absolute mode entirely.
- **Decision:** re-derive the ceiling inside `#restoreConfiguredScaleBounds` (post
  every fit) so it tracks canvas resizes. Rejected: compute once at load (goes
  stale after a resize).
- **Decision:** clamp the animated-focus requested scale to live bounds in the
  engine. Rejected: let focus overshoot and rely on the transform's own clamp
  (causes a visible animate-past-then-snap-back).
- **Invariant:** a fit lowers `minScale` to the floor's fit scale, so the
  max/min **must** be re-resolved after each fit — don't move the restore out of
  the post-fit path or a stale bound blocks/over-permits zoom.
- **Invariant:** `computeEnvelope` takes per-axis **maxima** (the worst-case
  box), not per-floor fit-then-min — fitting the union box is what yields the
  single smallest fit scale shared across floors.

## Tests

- `test/core/zoomBounds.test.js` — `computeEnvelope` per-axis maxima, skips
  non-finite/≤0/null entries, `null` when none usable.
- `test/renderer/TransformPipeline.maxZoom.test.js` — `computeFitScale` limiting
  axis; `setMaxScaleFromFit` = factor × fit; clamps current scale down when the
  new max is below it; preserves the existing min; degenerate (zero-area) leaves
  max untouched.
