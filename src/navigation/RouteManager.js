/**
 * RouteManager handles route state, lifecycle, and events.
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
   * Find and set a route between two locations.
   * @param {number} startLocationId
   * @param {number} endLocationId
   * @param {Object} [options]
   * @returns {Object}
   */
  navigateTo(startLocationId, endLocationId, options = {}) {
    const result = this.#pathFinder.findPath(startLocationId, endLocationId, options);

    if (result.success) {
      this.#currentRoute = result;
      this.#eventBus.emit('route:found', {
        path: result.path,
        distance: result.distance,
        levelDistance: result.levelDistance,
        startLocation: result.startLocation,
        endLocation: result.endLocation,
        startNode: result.startNode,
        endNode: result.endNode
      });
    } else {
      this.#eventBus.emit('route:error', {
        error: result.error,
        startLocationId,
        endLocationId
      });
    }

    return result;
  }

  /**
   * Find and set a route from a raw node to a location.
   * Used when routing from a non-location node (e.g. "You are here").
   * @param {import('../data/LocationModel.js').Node} startNode
   * @param {number} endLocationId
   * @param {Object} [options]
   * @returns {Object}
   */
  navigateFromNode(startNode, endLocationId, options = {}) {
    const result = this.#pathFinder.findPathFromNode(startNode, endLocationId, options);

    if (result.success) {
      this.#currentRoute = result;
      this.#eventBus.emit('route:found', {
        path: result.path,
        distance: result.distance,
        levelDistance: result.levelDistance,
        startLocation: result.startLocation,
        endLocation: result.endLocation,
        startNode: result.startNode,
        endNode: result.endNode
      });
    } else {
      this.#eventBus.emit('route:error', {
        error: result.error,
        startNodeId: startNode?.id,
        endLocationId
      });
    }

    return result;
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
   * Set the preferred connector mode.
   * @param {'escalator'|'lift'} mode
   */
  setRouteMode(mode) {
    const previousMode = this.#pathFinder.getRouteMode();
    this.#pathFinder.setRouteMode(mode);
    const effectiveMode = this.#pathFinder.getRouteMode();
    const changed = effectiveMode !== previousMode;

    if (changed && this.#currentRoute?.success) {
      const { startLocation, endLocation, startNode } = this.#currentRoute;
      if (startLocation) {
        this.navigateTo(startLocation.id, endLocation.id);
      } else if (startNode) {
        this.navigateFromNode(startNode, endLocation.id);
      }
    }

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
   * Get path nodes for a specific floor.
   * @param {string} floorCode
   * @returns {Array}
   */
  getPathOnFloor(floorCode) {
    if (!this.#currentRoute?.success) return [];

    return this.#currentRoute.path.filter((node) =>
      node.level?.code === floorCode
    );
  }

  /**
   * Get floors that the current route passes through.
   * @returns {string[]}
   */
  getRouteFloors() {
    if (!this.#currentRoute?.success) return [];

    const floors = [];
    let lastFloor = null;

    for (const node of this.#currentRoute.path) {
      const floorCode = node.level?.code;
      if (floorCode && floorCode !== lastFloor) {
        floors.push(floorCode);
        lastFloor = floorCode;
      }
    }

    return floors;
  }

  /**
   * Get transition points (where floor changes).
   * @returns {Array<{node: Object, fromFloor: string, toFloor: string, index: number}>}
   */
  getFloorTransitions() {
    if (!this.#currentRoute?.success) return [];

    const transitions = [];
    const path = this.#currentRoute.path;

    for (let i = 0; i < path.length - 1; i++) {
      const current = path[i];
      const next = path[i + 1];

      if (current.level?.code !== next.level?.code) {
        transitions.push({
          node: next,
          fromFloor: current.level?.code,
          toFloor: next.level?.code,
          index: i + 1
        });
      }
    }

    return transitions;
  }

  /**
   * Clear path cache (call when data changes).
   */
  clearCache() {
    this.#pathFinder.clearCache();
  }
}
