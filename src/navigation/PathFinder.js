import { triangleAStar, findNearestTriangle } from './TriangleAStar.js';
import { funnelPath } from './FunnelPath.js';

/**
 * Failure codes carried on a non-success {@link RouteResult}. The router never
 * throws — callers branch on `result.success` and may read `result.code`.
 */
export const RouteError = Object.freeze({
  // Destination-resolution failures (the typed-failure contract). A destination
  // that cannot be routed to carries exactly one of these — the router never
  // throws and callers branch on `result.success` / `result.code`.
  UNKNOWN_DESTINATION: 'UNKNOWN_DESTINATION', // id is not in the catalog
  MESHLESS_LEVEL: 'MESHLESS_LEVEL',           // resolves to a level with NO navmesh
  SNAP_FAILED: 'SNAP_FAILED',                 // meshed level, but no door/centroid to snap to
  // Planning failures.
  NO_MESH: 'no-mesh',
  NO_PATH: 'no-path',
  NO_TRANSITION: 'no-transition'
});

function dist(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

function polylineLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += dist(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]);
  }
  return total;
}

/**
 * The navmesh-aware route planner.
 *
 * `findPath(startId, endId)` resolves both destination ids to a snapped anchor
 * (level + world point + nearest triangle), runs triangle A* + funnel string-pull
 * per floor, and stitches floors via the cheapest connector group — returning a
 * typed {@link RouteResult}:
 *
 *   {
 *     success: boolean,
 *     segments: Map<levelCode, [x,y][]>,   // per-floor polylines
 *     transitions: RouteTransitionStep[],  // floor-change steps (from/to)
 *     distance: number,                    // summed polyline length
 *     startAnchor: { levelCode, x, y },
 *     endAnchor:   { levelCode, x, y },
 *     code?: string                        // failure code when !success
 *   }
 */
export class PathFinder {
  #navGraph;
  #locationStore;
  #routeMode = 'escalator';
  #stepFree = false;

  /**
   * @param {{levelGraphs: Map, transitions: Array}} navGraph
   * @param {import('../data/LocationModel.js').LocationStore} locationStore
   */
  constructor(navGraph, locationStore) {
    this.#navGraph = navGraph ?? { levelGraphs: new Map(), transitions: [] };
    this.#locationStore = locationStore;
  }

  /**
   * Set the preferred vertical connector mode.
   * @param {'escalator'|'lift'} mode
   */
  setRouteMode(mode) {
    const normalized = (mode || '').toLowerCase();
    if (normalized !== 'escalator' && normalized !== 'lift') return;
    if (this.#routeMode !== normalized) {
      this.#routeMode = normalized;
    }
  }

  /** @returns {'escalator'|'lift'} */
  getRouteMode() {
    return this.#routeMode;
  }

  /**
   * Set the step-free (accessible-only) hard gate. When true, only
   * `is_accessible` connector groups may be used; inaccessible connectors are
   * gated to Infinity (never used). Symmetric with {@link setRouteMode} so a
   * stateful caller can flip it and re-`findPath` for a fresh answer.
   * @param {boolean} value
   */
  setStepFree(value) {
    this.#stepFree = !!value;
  }

  /** @returns {boolean} */
  getStepFree() {
    return this.#stepFree;
  }

  /**
   * Lifecycle hook retained for RouteManager/engine callers.
   * Routes are not memoised in this phase, so this is a safe no-op.
   */
  clearCache() {
    // no-op: routes are not memoised in this phase
  }

  /**
   * Plan a route between two catalog destination ids.
   * @param {string} startId
   * @param {string} endId
   * @param {{stepFree?: boolean}} [options] - per-call overrides; `stepFree`
   *   applies the accessible-only hard gate for this call (falls back to the
   *   stateful {@link setStepFree} value when omitted).
   * @returns {Object} RouteResult
   */
  findPath(startId, endId, options = {}) {
    const start = this.#resolveDestination(startId);
    if (!start.anchor) return this.#fail(start.code, start.message);
    const end = this.#resolveDestination(endId);
    if (!end.anchor) return this.#fail(end.code, end.message);

    return this.#planBetweenAnchors(start.anchor, end.anchor, this.#resolveOptions(options), {
      startLocation: start.location ?? null,
      endLocation: end.location ?? null
    });
  }

  /**
   * Resolve effective routing preferences for one call:
   *   - `stepFree` — a per-call value overrides the stateful flag; a HARD
   *     accessibility gate (only `is_accessible` connectors are usable).
   *   - `connectorConstraint` — a per-call HARD kind gate that pins the vertical
   *     connector to exactly one kind (`'lift-only'` => elevator, `'escalator-only'`
   *     => escalator). Distinct from the SOFT `routeMode` preference: a constraint
   *     forbids the non-matching kind outright, so a `'lift-only'` request can
   *     never fall back to the cheaper escalator. `null`/absent means unconstrained.
   * @param {{stepFree?: boolean, connectorConstraint?: ('lift-only'|'escalator-only'|null)}} options
   * @returns {{stepFree: boolean, connectorKind: (string|null)}}
   */
  #resolveOptions(options = {}) {
    const stepFree = options.stepFree != null ? !!options.stepFree : this.#stepFree;
    const connectorKind = this.#constraintToKind(options.connectorConstraint);
    return { stepFree, connectorKind };
  }

  /**
   * Map a UI connector constraint to the catalog connector kind slug it pins to.
   * @param {('lift-only'|'escalator-only'|null|undefined)} constraint
   * @returns {string|null} the required connector kind, or null when unconstrained
   */
  #constraintToKind(constraint) {
    if (constraint === 'lift-only') return 'elevator';
    if (constraint === 'escalator-only') return 'escalator';
    return null;
  }

  /**
   * Plan a route from a catalog destination id to a raw connector/unit anchor
   * (level code + unit id). Used to reach a placement that is not a catalog
   * Location — e.g. an unoccupied-floor connector member.
   * @param {string} startId
   * @param {{levelCode:string, unitId:(number|string)}} target
   * @returns {Object} RouteResult
   */
  findPathToAnchor(startId, target, options = {}) {
    const start = this.#resolveDestination(startId);
    if (!start.anchor) return this.#fail(start.code, start.message);

    const endAnchor = this.#anchorForUnit(target?.levelCode, target?.unitId);
    if (!endAnchor) {
      const code = this.#navGraph.levelGraphs.has(target?.levelCode)
        ? RouteError.SNAP_FAILED
        : RouteError.MESHLESS_LEVEL;
      return this.#fail(code, `Anchor unit ${target?.unitId} not snappable on ${target?.levelCode}`);
    }

    return this.#planBetweenAnchors(start.anchor, endAnchor, this.#resolveOptions(options), {
      startLocation: start.location ?? null,
      endLocation: null
    });
  }

  // ---- Planning -----------------------------------------------------------

  #planBetweenAnchors(startAnchor, endAnchor, options = { stepFree: false, connectorKind: null }, locations = {}) {
    // Carry the resolved catalog Locations onto every success result so callers
    // (PinMarkerLayer) can title the start/end pins. The pins themselves are
    // gated on the anchors, not on these — they are optional metadata.
    const withLocations = (result) =>
      result && result.success
        ? { ...result, startLocation: locations.startLocation ?? null, endLocation: locations.endLocation ?? null }
        : result;

    // Degenerate: same point => single-point segment, distance 0.
    if (
      startAnchor.levelCode === endAnchor.levelCode &&
      startAnchor.x === endAnchor.x &&
      startAnchor.y === endAnchor.y
    ) {
      const segments = new Map();
      segments.set(startAnchor.levelCode, [[startAnchor.x, startAnchor.y]]);
      return withLocations({
        success: true,
        segments,
        transitions: [],
        distance: 0,
        startAnchor: this.#anchorView(startAnchor),
        endAnchor: this.#anchorView(endAnchor)
      });
    }

    if (startAnchor.levelCode === endAnchor.levelCode) {
      return withLocations(this.#planSameFloor(startAnchor, endAnchor));
    }
    return withLocations(this.#planCrossFloor(startAnchor, endAnchor, options));
  }

  #planSameFloor(startAnchor, endAnchor) {
    const graph = this.#navGraph.levelGraphs.get(startAnchor.levelCode);
    const mesh = graph?.navmesh;
    if (!mesh) return this.#fail(RouteError.NO_MESH, `Level ${startAnchor.levelCode} has no mesh`);

    const poly = this.#floorPolyline(mesh, startAnchor, endAnchor);
    if (!poly) return this.#fail(RouteError.NO_PATH, 'No triangle path on floor');

    const segments = new Map();
    segments.set(startAnchor.levelCode, poly);
    return {
      success: true,
      segments,
      transitions: [],
      distance: polylineLength(poly),
      startAnchor: this.#anchorView(startAnchor),
      endAnchor: this.#anchorView(endAnchor)
    };
  }

  #planCrossFloor(startAnchor, endAnchor, options = { stepFree: false, connectorKind: null }) {
    const candidates = this.#connectorsBetween(startAnchor.levelCode, endAnchor.levelCode);
    if (!candidates.length) {
      return this.#fail(RouteError.NO_TRANSITION, `No connector between ${startAnchor.levelCode} and ${endAnchor.levelCode}`);
    }

    let best = null;
    for (const transition of candidates) {
      // Step-free is a HARD gate: an inaccessible connector is gated to Infinity
      // (never used). When step-free is requested and the group is not
      // accessible, skip it entirely so it cannot leak into the result.
      if (options.stepFree && !this.#isAccessible(transition)) continue;

      // connectorConstraint is a HARD kind gate (distinct from the soft routeMode
      // penalty): pin the vertical connector to exactly the requested kind, so a
      // 'lift-only' request can never fall back to the cheaper escalator.
      if (options.connectorKind && transition.kind !== options.connectorKind) continue;

      const plan = this.#planViaConnector(startAnchor, endAnchor, transition);
      if (!plan) continue;
      const score = plan.distance + this.#connectorPenalty(transition);
      if (!best || score < best.score) {
        best = { ...plan, score };
      }
    }

    // With every candidate gated out (or none routable) there is no path.
    if (!best) return this.#fail(RouteError.NO_PATH, 'No cross-floor path');
    return best.result;
  }

  #planViaConnector(startAnchor, endAnchor, transition) {
    const fromMember = transition.memberOnLevel(startAnchor.levelCode);
    const toMember = transition.memberOnLevel(endAnchor.levelCode);
    if (!fromMember || !toMember) return null;

    const startGraph = this.#navGraph.levelGraphs.get(startAnchor.levelCode);
    const endGraph = this.#navGraph.levelGraphs.get(endAnchor.levelCode);
    const startMesh = startGraph?.navmesh;
    const endMesh = endGraph?.navmesh;
    if (!startMesh || !endMesh) return null;

    const fromConn = this.#snapPoint(startMesh, fromMember.x, fromMember.y);
    const toConn = this.#snapPoint(endMesh, toMember.x, toMember.y);
    if (!fromConn || !toConn) return null;

    const startSeg = this.#floorPolyline(startMesh, startAnchor, fromConn);
    const endSeg = this.#floorPolyline(endMesh, toConn, endAnchor);
    if (!startSeg || !endSeg) return null;

    const segments = new Map();
    segments.set(startAnchor.levelCode, startSeg);
    segments.set(endAnchor.levelCode, endSeg);

    const distance = polylineLength(startSeg) + polylineLength(endSeg);

    const step = {
      kind: transition.kind,
      fromLevelCode: startAnchor.levelCode,
      toLevelCode: endAnchor.levelCode,
      levelCodes: [startAnchor.levelCode, endAnchor.levelCode],
      from: { x: fromMember.x, y: fromMember.y },
      to: { x: toMember.x, y: toMember.y },
      // Flat connector coordinates the NavMarkerLayer draws the transition
      // bubble at directly (the per-floor `segments` endpoints can diverge from
      // the connector point, so the bubble must use the connector's own coords).
      fromX: fromMember.x,
      fromY: fromMember.y,
      toX: toMember.x,
      toY: toMember.y,
      cost: transition.cost,
      is_accessible: this.#isAccessible(transition)
    };

    return {
      distance,
      result: {
        success: true,
        segments,
        transitions: [step],
        distance,
        startAnchor: this.#anchorView(startAnchor),
        endAnchor: this.#anchorView(endAnchor)
      }
    };
  }

  /**
   * Triangle A* + funnel between two snapped anchors on the SAME mesh.
   * Returns a `[x,y][]` polyline, or `null` when no triangle path exists.
   */
  #floorPolyline(mesh, fromAnchor, toAnchor) {
    const triPath = triangleAStar(mesh, fromAnchor.triIndex, toAnchor.triIndex);
    if (!triPath.length) return null;
    const poly = funnelPath(
      triPath,
      mesh,
      { x: fromAnchor.x, y: fromAnchor.y },
      { x: toAnchor.x, y: toAnchor.y }
    );
    return poly.map((p) => [p.x, p.y]);
  }

  // ---- Destination resolution (typed-failure contract) --------------------

  /**
   * Resolve a catalog destination id to a snapped anchor, OR to a typed failure
   * code (the router never throws). The three failure codes are distinct and
   * checked in precedence order:
   *
   *   - {@link RouteError.UNKNOWN_DESTINATION}: the id is not in the catalog.
   *   - {@link RouteError.MESHLESS_LEVEL}: the destination resolves, but NONE of
   *     its placement levels carries a navmesh (the level is unroutable).
   *   - {@link RouteError.SNAP_FAILED}: at least one placement level HAS a mesh,
   *     but the unit has neither a `doors_by_unit` nor a `centroids_by_unit`
   *     entry — there is no snappable navmesh point.
   *
   * @param {string} id
   * @returns {{anchor: Object, location: Object}|{anchor: null, code: string, message: string}}
   */
  #resolveDestination(id) {
    const location = this.#locationStore?.getLocation(id);
    if (!location) {
      return {
        anchor: null,
        code: RouteError.UNKNOWN_DESTINATION,
        message: `Destination ${id} is not in the catalog`
      };
    }

    const anchor = this.#anchorForLocation(location);
    if (anchor) return { anchor, location };

    // No anchor: classify WHY. If any placement level is meshed, the failure is
    // a snap failure on that meshed floor; otherwise every level is meshless.
    const onAMeshedLevel = (location.levelCodes || []).some((code) =>
      this.#navGraph.levelGraphs.has(code)
    );
    if (onAMeshedLevel) {
      return {
        anchor: null,
        code: RouteError.SNAP_FAILED,
        message: `Destination ${id} has no snappable navmesh point (no door or centroid)`
      };
    }
    return {
      anchor: null,
      code: RouteError.MESHLESS_LEVEL,
      message: `Destination ${id} is on a level with no navmesh`
    };
  }

  // ---- Anchors & snapping -------------------------------------------------

  /**
   * Snap a Location to a `{levelCode, x, y, triIndex, unitId}` anchor. Picks the
   * first unit on a routable (meshed) floor; snap order is the unit's first door
   * (carries `triangle_index`) then its centroid + nearest-triangle search
   * (architect decision (c)). Returns `null` when no unit on any meshed floor
   * has a snappable door/centroid — the caller classifies the failure.
   * @param {import('../data/LocationModel.js').Location} location
   * @returns {Object|null}
   */
  #anchorForLocation(location) {
    for (const unitId of location.unitIds || []) {
      // Determine the unit's floor from its display node (carries levelCode).
      const node = (location.displayNodes || []).find((n) => n.unitId === unitId);
      const levelCode = node?.levelCode;
      if (!levelCode) continue;
      const anchor = this.#anchorForUnit(levelCode, unitId);
      if (anchor) return anchor;
    }
    return null;
  }

  /**
   * Snap a specific unit on a level to its anchor via the level mesh's
   * door/centroid indices.
   * @param {string} levelCode
   * @param {number|string} unitId
   * @returns {Object|null}
   */
  #anchorForUnit(levelCode, unitId) {
    const graph = this.#navGraph.levelGraphs.get(levelCode);
    const mesh = graph?.navmesh;
    if (!mesh) return null;

    // 1. First door of the unit (carries an explicit triangle_index).
    const door = this.#firstDoor(mesh, unitId);
    if (door) {
      let triIndex = door.triangle_index;
      if (!(typeof triIndex === 'number' && triIndex >= 0 && triIndex < mesh.triangles.length)) {
        triIndex = findNearestTriangle(mesh, door.x, door.y);
      }
      if (triIndex >= 0) return { levelCode, x: door.x, y: door.y, triIndex, unitId };
    }

    // 2. Unit centroid + nearest-triangle search.
    const centroid = this.#unitCentroid(mesh, unitId);
    if (centroid) {
      const snapped = this.#snapPoint(mesh, centroid[0], centroid[1]);
      if (snapped) return { levelCode, ...snapped, unitId };
    }
    return null;
  }

  #firstDoor(mesh, unitId) {
    const doors = mesh.doors_by_unit?.[unitId] ?? mesh.doors_by_unit?.[String(unitId)];
    if (Array.isArray(doors) && doors.length > 0) {
      const d = doors[0];
      const x = Array.isArray(d) ? d[0] : d?.x;
      const y = Array.isArray(d) ? d[1] : d?.y;
      if (typeof x === 'number' && typeof y === 'number') {
        return { x, y, triangle_index: d?.triangle_index };
      }
    }
    return null;
  }

  #unitCentroid(mesh, unitId) {
    const c = mesh.centroids_by_unit?.[unitId] ?? mesh.centroids_by_unit?.[String(unitId)];
    if (Array.isArray(c) && c.length >= 2) return c;
    if (c && typeof c.x === 'number') return [c.x, c.y];
    return null;
  }

  /** Snap an arbitrary world point to its containing/nearest triangle. */
  #snapPoint(mesh, x, y) {
    const triIndex = findNearestTriangle(mesh, x, y);
    if (triIndex < 0) return null;
    return { x, y, triIndex };
  }

  // ---- Connectors ---------------------------------------------------------

  #connectorsBetween(fromCode, toCode) {
    return (this.#navGraph.transitions || []).filter((t) => {
      const codes = t.levelCodes || [];
      return codes.includes(fromCode) && codes.includes(toCode);
    });
  }

  /**
   * Whether a connector group is step-free / accessible. Reads the
   * {@link RouteTransition} `isAccessible` flag, tolerating a raw
   * `is_accessible` spelling for robustness.
   */
  #isAccessible(transition) {
    return !!(transition?.isAccessible ?? transition?.is_accessible);
  }

  /**
   * A small preference penalty so the route mode's connector kind (and the
   * cheaper group) is favoured when several connect the same floors.
   */
  #connectorPenalty(transition) {
    const preferredKind = this.#routeMode === 'lift' ? 'elevator' : 'escalator';
    const modePenalty = transition.kind === preferredKind ? 0 : 1000;
    return (transition.cost || 0) * 100 + modePenalty;
  }

  // ---- Result helpers -----------------------------------------------------

  #anchorView(anchor) {
    return { levelCode: anchor.levelCode, x: anchor.x, y: anchor.y };
  }

  #fail(code, message) {
    return {
      success: false,
      code,
      error: message,
      segments: new Map(),
      transitions: [],
      distance: 0,
      startAnchor: null,
      endAnchor: null
    };
  }
}
