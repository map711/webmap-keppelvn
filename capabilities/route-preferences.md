# route-preferences

## Purpose

Let a visitor bias a cross-floor route by **connector kind** (escalator vs lift)
and demand a **step-free** route, without ever silently returning *no route* when
a softer outcome exists. Preference is a soft cost penalty; step-free is a hard
accessibility gate.

## Behavior

- **Soft connector preference.** The preferred connector kind keeps its
  `transition.cost`; a non-preferred kind costs `cost + 100`. With
  `routeMode='escalator'` (default) the cross-floor route picks the escalator
  group; with `routeMode='lift'` it picks the lift group (a `lift` cost of 2.0
  beats an escalator gated to `2.0 + 100`).
- **Soft fallback.** When only the *non-preferred* connector exists between two
  floors, the route **still succeeds** over it — preference penalises, it never
  filters a connector out.
- **Step-free hard gate.** With `stepFree=true` the route uses **only
  `is_accessible` transitions**: a cross-floor route takes the accessible (lift)
  group even when the escalator is cheaper. When **no** accessible connector
  exists between the floors, `findPath` returns a typed failure (the inaccessible
  connector is gated to `Infinity`, not used) rather than a step route.
- **Hard per-call kind gate.** A per-call `connectorConstraint`
  (`'lift-only'` → elevator, `'escalator-only'` → escalator, `null` =
  unconstrained) is a **hard** gate distinct from the soft `routeMode`: it forbids
  the non-matching connector kind outright, so a `'lift-only'` request never falls
  back to the cheaper escalator (unlike the soft preference, which always can).
- **No memoisation.** Routes are not cached — every `findPath` re-plans, so a
  flipped `routeMode`/`stepFree` takes effect on the very next call without any
  invalidation step. `clearCache()` is a retained no-op lifecycle hook.
- **Connector kind source.** Kind is derived from the connector group
  (`is_accessible ? 'elevator' : 'escalator'`) / the member unit's `kind` slug —
  not inferred from `cost` magic numbers.

## Interfaces & contracts

- `PathFinder.setRouteMode('escalator'|'lift')` — sets the sticky preferred kind; a no-op for an unknown value.
- `PathFinder.setStepFree(boolean)` — toggles the sticky hard accessibility gate.
- `PathFinder.getRouteMode()` / `getStepFree()` → current sticky values.
- `RouteManager.setRouteMode(mode)` / `getRouteMode()` — thin pass-through that re-routes the current pair.
- `PathFinder.findPath(startId, endId, { stepFree, connectorConstraint })` — per-call overrides for one route: `stepFree` (bool) overrides the sticky gate; `connectorConstraint` (`'lift-only'`/`'escalator-only'`/`null`) is the hard kind gate. Internally resolved to `{ stepFree, connectorKind }`.

## Data model

- Consumes **RouteTransition** (`navmesh-routing`): `kind`, `cost`, `is_accessible`. The soft penalty and hard gate are applied at edge-cost time inside `PathFinder`; no new persistent entity.

## Decisions & constraints

- **Decision:** soft connector penalty + hard step-free gate (inherited from the epic). Rejected: hard-filter by kind (returns *no route* on a single-connector floor).
- **Decision:** kind from the member unit/group, `is_accessible` from the transition. Rejected: inferring kind from `cost` magic numbers (fragile).
- **Invariant:** preference must never make a reachable destination unreachable — only `stepFree` (an explicit accessibility demand) may gate a connector to `Infinity`.
- **Note (data):** the real bundle's accessible connector kind slug is **`'elevator'`**, not `'lift'`; the `routeMode='lift'` toggle maps to it. Callers must not assert `'lift'` as the emitted kind.

## Tests

- `test/navigation/NavmeshRouting.test.js` — escalator-default vs lift-mode pick, soft-penalty fallback when only the non-preferred connector exists, step-free route-exists (accessible-only) and step-free no-route (typed `NO_PATH`-class failure), mode/step-free flip reflected on the next `findPath` (no memoisation). Driven by the two-connector synthetic fixture (escalator `is_accessible:false` cost 1.0, lift `is_accessible:true` cost 2.0).
