/**
 * RouteManager — thin route state, lifecycle, and events over the navmesh
 * {@link import('./PathFinder.js').PathFinder} result.
 *
 * A successful route carries per-floor `segments` (a `Map<levelCode, [x,y][]>`),
 * the ordered floor-change `transitions`, the summed `distance`, and the snapped
 * `startAnchor`/`endAnchor`. The manager re-emits these on the bus
 * (`route:found` / `route:cleared` / `route:error`) without re-deriving geometry.
 */
export class RouteManager {
  #pathFinder;
  #eventBus;
  #currentRoute = null;

  /**
   * @param {import('./PathFinder.js').PathFinder} pathFinder
   * @param {import('../core/EventBus.js').EventBus} eventBus
   */
  constructor(pathFinder, eventBus) {
    this.#pathFinder = pathFinder;
    this.#eventBus = eventBus;
  }

  /**
   * Get the current active route.
   * @returns {Object|null}
   */
  getCurrentRoute() {
    return this.#currentRoute;
  }

  /**
   * Check if a route is active.
   * @returns {boolean}
   */
  hasRoute() {
    return this.#currentRoute !== null && this.#currentRoute.success;
  }

  /**
   * Find and set a route between two catalog destination ids.
   * @param {string} startLocationId
   * @param {string} endLocationId
   * @param {Object} [options]
   * @returns {Object}
   */
  navigateTo(startLocationId, endLocationId, options = {}) {
    const result = this.#pathFinder.findPath(startLocationId, endLocationId, options);
    this.#dispatch(result, { fromId: startLocationId, toId: endLocationId });
    return result;
  }

  /**
   * Find and set a route from a catalog id to a raw connector/unit anchor.
   * @param {string} startLocationId
   * @param {{levelCode:string, unitId:(number|string)}} target
   * @returns {Object}
   */
  navigateToAnchor(startLocationId, target) {
    const result = this.#pathFinder.findPathToAnchor(startLocationId, target);
    this.#dispatch(result, { fromId: startLocationId, target });
    return result;
  }

  /**
   * Route from a raw "you are here" node. Deferred to a later phase: the
   * navmesh router snaps catalog ids, not free nodes, so this reports an error
   * rather than crashing if invoked early.
   * @param {Object} startNode
   * @param {string} endLocationId
   * @returns {Object}
   */
  navigateFromNode(startNode, endLocationId) {
    const result = {
      success: false,
      code: 'unsupported-start',
      error: 'Routing from a free node is not supported in this phase',
      segments: new Map(),
      transitions: [],
      distance: 0,
      startAnchor: null,
      endAnchor: null
    };
    this.#eventBus.emit('route:error', {
      error: result.error,
      code: result.code,
      startNodeId: startNode?.id,
      endLocationId
    });
    return result;
  }

  #dispatch(result, context) {
    if (result.success) {
      this.#currentRoute = result;
      this.#eventBus.emit('route:found', {
        segments: result.segments,
        transitions: result.transitions,
        distance: result.distance,
        startAnchor: result.startAnchor,
        endAnchor: result.endAnchor
      });
    } else {
      this.#eventBus.emit('route:error', {
        error: result.error,
        code: result.code,
        ...context
      });
    }
  }

  /**
   * Clear the current route.
   */
  clearRoute() {
    if (this.#currentRoute) {
      this.#currentRoute = null;
      this.#eventBus.emit('route:cleared', {});
    }
  }

  /**
   * Set the preferred connector mode (re-routes the active route if it changes).
   * @param {'escalator'|'lift'} mode
   */
  setRouteMode(mode) {
    const previousMode = this.#pathFinder.getRouteMode();
    this.#pathFinder.setRouteMode(mode);
    const effectiveMode = this.#pathFinder.getRouteMode();
    const changed = effectiveMode !== previousMode;

    this.#eventBus.emit('route:modeChanged', {
      mode: effectiveMode,
      requestedMode: mode,
      changed
    });
  }

  /**
   * Get current route mode.
   * @returns {'escalator'|'lift'}
   */
  getRouteMode() {
    return this.#pathFinder.getRouteMode();
  }

  /**
   * The per-floor polyline of the active route on a given floor (world `[x,y]`).
   * @param {string} floorCode
   * @returns {Array<[number,number]>}
   */
  getPathOnFloor(floorCode) {
    if (!this.#currentRoute?.success) return [];
    const segs = this.#currentRoute.segments;
    if (segs instanceof Map) return segs.get(floorCode) || [];
    return (segs && segs[floorCode]) || [];
  }

  /**
   * Floor codes the active route passes through, in travel order.
   * @returns {string[]}
   */
  getRouteFloors() {
    if (!this.#currentRoute?.success) return [];
    const floors = [];
    if (this.#currentRoute.startAnchor?.levelCode) {
      floors.push(this.#currentRoute.startAnchor.levelCode);
    }
    for (const t of this.#currentRoute.transitions || []) {
      if (t.toLevelCode && !floors.includes(t.toLevelCode)) floors.push(t.toLevelCode);
    }
    if (
      this.#currentRoute.endAnchor?.levelCode &&
      !floors.includes(this.#currentRoute.endAnchor.levelCode)
    ) {
      floors.push(this.#currentRoute.endAnchor.levelCode);
    }
    return floors;
  }

  /**
   * The ordered floor-change steps of the active route.
   * @returns {Array}
   */
  getFloorTransitions() {
    if (!this.#currentRoute?.success) return [];
    return this.#currentRoute.transitions || [];
  }

  /**
   * Clear path cache (call when data changes).
   */
  clearCache() {
    this.#pathFinder.clearCache();
  }
}
