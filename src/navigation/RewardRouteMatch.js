/**
 * rewardRouteMatch — a PURE matcher that selects the reward-shops lying within a
 * tunable `buffer` of a drawn route's per-floor polylines.
 *
 * Given a {@link RouteResult}-shaped route (its per-floor `segments` polylines +
 * start/end {@link Location}s), the placed-shop catalog (a hydrated
 * {@link LocationStore}) and the active-reward store (a hydrated
 * {@link RewardStore}), it returns one selection entry per qualifying shop:
 *
 *   * route-GATED        — a shop whose only near placements are on floors NOT in
 *                          `route.segments` is excluded;
 *   * near-PATH          — a display point within `buffer` (world units) of that
 *                          floor's route polyline qualifies the shop;
 *   * endpoint-SUPPRESSED — the route's own `start/endLocation` shops are dropped;
 *   * reward-GATED       — only shops carrying >=1 currently-active reward qualify;
 *   * DEDUPED per shop   — a shop with several near placements yields ONE entry,
 *                          carrying that shop's active rewards + the `levelCode`
 *                          it was first matched on;
 *   * EMPTY              — a null / empty-segments / failed route yields `[]`.
 *
 * Coordinates are raw CMS units with `renderScale === 1`, so the buffer and the
 * display points share ONE coordinate space (the inherited tech-stack decision).
 * No PathFinder dependency — the route is consumed purely as geometry.
 *
 * Call shapes (behaviour, not a pinned signature):
 *   - `rewardRouteMatch({ route, locationStore, rewardStore, buffer, now })`
 *   - `rewardRouteMatch(route, { locationStore, rewardStore, buffer, now })`
 *   - `rewardRouteMatch(route, locationStore, rewardStore, buffer)`
 *
 * @returns {Array<{shopId:number, levelCode:string, rewards:Array, location:Object}>}
 */
export function rewardRouteMatch(arg1, arg2, arg3, arg4) {
  const { route, locationStore, rewardStore, buffer } = normalizeArgs(arg1, arg2, arg3, arg4);

  // --- Criterion 5: no / absent / failed / empty-segments route -> empty -----
  if (!route) return [];
  if (route.success === false) return [];
  const segments = route.segments;
  if (!(segments instanceof Map) || segments.size === 0) return [];
  if (!locationStore || !rewardStore) return [];

  // The route's own start/end shop ids (e.g. `shop:4` -> 4) are suppressed.
  const suppressed = new Set();
  for (const loc of [route.startLocation, route.endLocation]) {
    const shopId = shopIdOf(loc?.id);
    if (shopId != null) suppressed.add(shopId);
  }

  // The set of floor codes the route actually traverses (the route gate).
  const traversed = new Map(); // levelCode -> polyline [[x,y]|{x,y}, ...]
  for (const [code, poly] of segments) {
    if (Array.isArray(poly) && poly.length > 0) traversed.set(code, poly);
  }
  if (traversed.size === 0) return [];

  /** @type {Map<number, {shopId:number, levelCode:string, rewards:Array, location:Object}>} */
  const byShop = new Map();

  for (const location of locationStore.locations || []) {
    const shopId = shopIdOf(location?.id);
    if (shopId == null) continue;             // facility (unit:<id>) -> not a reward-shop
    if (suppressed.has(shopId)) continue;     // endpoint-suppressed
    if (byShop.has(shopId)) continue;         // already selected (dedupe across nodes)

    const rewards = rewardStore.getRewardsByShopId(shopId);
    if (!Array.isArray(rewards) || rewards.length === 0) continue; // reward-gated

    // Find the first display node on a traversed floor within `buffer` of that
    // floor's polyline. One entry per shop -> stop at the first match.
    for (const node of location.displayNodes || []) {
      const levelCode = node?.levelCode;
      const poly = traversed.get(levelCode);
      if (!poly) continue;                    // node on an untraversed floor
      const px = node.point?.x;
      const py = node.point?.y;
      if (typeof px !== 'number' || typeof py !== 'number') continue;
      if (distancePointToPolyline(px, py, poly) <= buffer) {
        byShop.set(shopId, {
          shopId,
          levelCode,
          rewards: rewards.slice(),
          location
        });
        break;
      }
    }
  }

  return Array.from(byShop.values());
}

/**
 * deriveRewardBuffer — pick a sensible near-path `buffer` (world units) from the
 * placed shops' OWN sizes, so the proximity gate auto-scales to the bundle's
 * coordinate space instead of a guessed constant. One global threshold (like the
 * relative zoom ceiling), computed once at load.
 *
 *   buffer = factor × median over PLACED-shop display nodes of the unit's mean
 *            extent ((unitWidth + unitHeight) / 2)
 *
 * Only nodes with a positive extent count, so meshless / geometry-less units
 * (extent 0) don't drag the median to zero. A shop's display point is its
 * centroid, sitting ~¼–½ an extent off the corridor it fronts, so a factor near
 * 1 catches the shops lining the route and excludes the row set back behind them.
 *
 * Resolution order:
 *   1. an absolute `override` (finite, >= 0) wins verbatim — the host's fixed cap
 *      (mirrors an absolute `maxZoom` beating the relative `maxZoomFactor`);
 *   2. else `factor × median(shop extent)` when any placed shop has geometry;
 *   3. else `envelopeFraction × the cross-floor envelope diagonal` (degenerate
 *      data — never silently revert to "show everything");
 *   4. else `Infinity` (no basis at all — the matcher's permissive default).
 *
 * @param {Object} locationStore - a hydrated {@link LocationStore} (its `locations`).
 * @param {Object} [opts] - { factor=1, override=null, envelope=null, envelopeFraction=0.04 }
 * @returns {number}
 */
export function deriveRewardBuffer(locationStore, opts = {}) {
  const override = opts?.override;
  if (override != null && typeof override === 'number' && Number.isFinite(override) && override >= 0) {
    return override;
  }

  const factor = numOr(opts?.factor, 1);
  const extents = [];
  for (const loc of locationStore?.locations || []) {
    if (!String(loc?.id ?? '').startsWith('shop:')) continue; // placed shops only
    for (const node of loc.displayNodes || []) {
      const w = Number(node?.unitWidth);
      const h = Number(node?.unitHeight);
      if (!Number.isFinite(w) || !Number.isFinite(h)) continue;
      const e = (w + h) / 2;
      if (e > 0) extents.push(e);
    }
  }

  if (extents.length > 0) return factor * median(extents);

  // Degenerate fallback: a small fraction of the cross-floor envelope diagonal.
  const env = opts?.envelope;
  if (env && Number.isFinite(env.width) && Number.isFinite(env.height)) {
    const diag = Math.hypot(env.width, env.height);
    if (diag > 0) return numOr(opts?.envelopeFraction, 0.04) * diag;
  }

  return Infinity;
}

/**
 * The median of a numeric list (the mean of the two middle samples for an even
 * count). Assumes a non-empty array.
 * @param {number[]} values
 * @returns {number}
 */
function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * `value` when it is a finite number, else `fallback` (so an absent/NaN option
 * degrades to its default).
 * @param {number|undefined|null} value
 * @param {number} fallback
 * @returns {number}
 */
function numOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Normalize the tolerated call shapes into one bag.
 * @returns {{route:Object, locationStore:Object, rewardStore:Object, buffer:number}}
 */
function normalizeArgs(arg1, arg2, arg3, arg4) {
  // Keyword-bag form: rewardRouteMatch({ route, locationStore, ... }).
  if (arg1 && typeof arg1 === 'object' && !(arg1 instanceof Map) && arg1.route !== undefined && arg2 === undefined) {
    const bag = arg1;
    return {
      route: bag.route,
      locationStore: bag.locationStore ?? bag.catalog ?? null,
      rewardStore: bag.rewardStore ?? null,
      buffer: resolveBuffer(bag.buffer)
    };
  }

  // route-then-options-bag form: rewardRouteMatch(route, { ... }).
  if (arg2 && typeof arg2 === 'object' && arg3 === undefined && arg4 === undefined
      && (arg2.locationStore !== undefined || arg2.catalog !== undefined
          || arg2.rewardStore !== undefined || arg2.buffer !== undefined)) {
    const opts = arg2;
    return {
      route: arg1,
      locationStore: opts.locationStore ?? opts.catalog ?? null,
      rewardStore: opts.rewardStore ?? null,
      buffer: resolveBuffer(opts.buffer)
    };
  }

  // Positional form: rewardRouteMatch(route, locationStore, rewardStore, buffer).
  return {
    route: arg1,
    locationStore: arg2 ?? null,
    rewardStore: arg3 ?? null,
    buffer: resolveBuffer(arg4)
  };
}

/**
 * A buffer of 0 is a valid (degenerate) threshold; only a missing/NaN buffer
 * falls back to a permissive default.
 * @param {number|undefined|null} value
 * @returns {number}
 */
function resolveBuffer(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : Infinity;
}

/**
 * Extract a numeric shop id from a `shop:<id>` Location id; `null` for a
 * non-shop id (`unit:<id>`) or an absent id.
 * @param {string|number|undefined|null} id
 * @returns {number|null}
 */
function shopIdOf(id) {
  if (id == null) return null;
  const s = String(id);
  if (!s.startsWith('shop:')) return null;
  const num = Number(s.slice('shop:'.length));
  return Number.isNaN(num) ? null : num;
}

/**
 * Shortest distance from a point to a polyline (the min over its segments). A
 * single-vertex polyline degenerates to point-to-point; an empty polyline is
 * unreachable (Infinity).
 * @param {number} px
 * @param {number} py
 * @param {Array<[number,number]|{x:number,y:number}>} poly
 * @returns {number}
 */
function distancePointToPolyline(px, py, poly) {
  if (!Array.isArray(poly) || poly.length === 0) return Infinity;
  const first = coord(poly[0]);
  if (poly.length === 1) return Math.hypot(px - first.x, py - first.y);

  let best = Infinity;
  let prev = first;
  for (let i = 1; i < poly.length; i++) {
    const cur = coord(poly[i]);
    const d = distancePointToSegment(px, py, prev.x, prev.y, cur.x, cur.y);
    if (d < best) best = d;
    prev = cur;
  }
  return best;
}

/**
 * Distance from point (px,py) to the line segment (ax,ay)->(bx,by).
 * @returns {number}
 */
function distancePointToSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const lenSq = abx * abx + aby * aby;
  let t = lenSq > 0 ? (apx * abx + apy * aby) / lenSq : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const cx = ax + t * abx;
  const cy = ay + t * aby;
  return Math.hypot(px - cx, py - cy);
}

/**
 * Normalize a polyline vertex (`[x,y]` or `{x,y}` / a Point) to `{x,y}`.
 * @param {[number,number]|{x:number,y:number}} v
 * @returns {{x:number,y:number}}
 */
function coord(v) {
  if (Array.isArray(v)) return { x: v[0], y: v[1] };
  return { x: v?.x ?? 0, y: v?.y ?? 0 };
}

export default rewardRouteMatch;
