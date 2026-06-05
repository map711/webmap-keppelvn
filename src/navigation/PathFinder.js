import { MinHeap } from './MinHeap.js';

/**
 * A* pathfinder with vertical connector preferences.
 */
export class PathFinder {
  static PREFERRED_PENALTY = 0;
  static NON_PREFERRED_PENALTY = 100;
  static CROSS_LEVEL_BASE_PENALTY = 200;

  #locationStore;
  #routeMode = 'escalator';
  #cache = new Map();
  #rawLocationsMap = new Map();

  /**
   * @param {import('../data/LocationModel.js').LocationStore} locationStore
   */
  constructor(locationStore) {
    this.#locationStore = locationStore;
    this.#buildRawLocationsMap();
  }

  #buildRawLocationsMap() {
    for (const node of this.#locationStore.nodes) {
      if (node.location && typeof node.location === 'object') {
        this.#rawLocationsMap.set(node.location.id, node.location);
      }
    }
  }

  /**
   * Set the preferred vertical connector mode.
   * @param {'escalator'|'lift'} mode
   */
  setRouteMode(mode) {
    const normalized = (mode || '').toLowerCase();
    if (normalized !== 'escalator' && normalized !== 'lift') {
      console.warn(`PathFinder: invalid route mode "${mode}", keeping "${this.#routeMode}"`);
      return;
    }
    if (this.#routeMode !== normalized) {
      this.#routeMode = normalized;
      this.#cache.clear();
    }
  }

  /**
   * Get current route mode.
   * @returns {'escalator'|'lift'}
   */
  getRouteMode() {
    return this.#routeMode;
  }

  /**
   * Find shortest path between two locations.
   * @param {number} startLocationId
   * @param {number} endLocationId
   * @param {{avoidNodeIds?: number[], connectorConstraint?: 'lift-only'|'escalator-only'|null}} [options]
   * @returns {Object}
   */
  findPath(startLocationId, endLocationId, options = {}) {
    const startLocation = this.#locationStore.getLocation(startLocationId);
    if (!startLocation) {
      return this.#errorResult(`Start location ${startLocationId} not found`);
    }

    const endLocation = this.#locationStore.getLocation(endLocationId);
    if (!endLocation) {
      return this.#errorResult(`End location ${endLocationId} not found`);
    }

    const startNodes = startLocation.nodes || [];
    const endNodes = endLocation.nodes || [];
    const startLabel = startLocation.title || startLocation.label;
    const endLabel = endLocation.title || endLocation.label;

    if (!startNodes.length) {
      return this.#errorResult(`Start location "${startLabel}" has no navigation nodes`);
    }
    if (!endNodes.length) {
      return this.#errorResult(`End location "${endLabel}" has no navigation nodes`);
    }

    const cacheKey = this.#buildCacheKey(startLocationId, endLocationId, options);
    if (this.#cache.has(cacheKey)) {
      return this.#cache.get(cacheKey);
    }

    const best = this.#searchNodePairs(startNodes, endNodes, options);

    if (!best) {
      return this.#errorResult(
        `No path found between "${startLabel}" and "${endLabel}"`
      );
    }

    const result = {
      success: true,
      path: best.path,
      distance: best.distance,
      levelDistance: best.levelDistance,
      startLocation,
      endLocation,
      startNode: best.startNode,
      endNode: best.endNode
    };

    this.#cache.set(cacheKey, result);
    return result;
  }

  /**
   * Find shortest path from a raw node to a location.
   * Used when routing from a non-location node (e.g. "You are here").
   * @param {import('../data/LocationModel.js').Node} startNode
   * @param {number} endLocationId
   * @param {{avoidNodeIds?: number[], connectorConstraint?: 'lift-only'|'escalator-only'|null}} [options]
   * @returns {Object}
   */
  findPathFromNode(startNode, endLocationId, options = {}) {
    if (!startNode) {
      return this.#errorResult('Start node not provided');
    }

    const endLocation = this.#locationStore.getLocation(endLocationId);
    if (!endLocation) {
      return this.#errorResult(`End location ${endLocationId} not found`);
    }

    const endNodes = endLocation.nodes || [];
    if (!endNodes.length) {
      return this.#errorResult(
        `End location "${endLocation.title || endLocation.label}" has no navigation nodes`
      );
    }

    const best = this.#searchNodePairs([startNode], endNodes, options);
    if (!best) {
      return this.#errorResult(
        `No path found from node ${startNode.id} to "${endLocation.title || endLocation.label}"`
      );
    }

    return {
      success: true,
      path: best.path,
      distance: best.distance,
      levelDistance: best.levelDistance,
      startLocation: null,
      endLocation,
      startNode: best.startNode,
      endNode: best.endNode
    };
  }

  /**
   * Clear the path cache.
   */
  clearCache() {
    this.#cache.clear();
  }

  #astar(startNode, endNode, options = {}) {
    if (!startNode || !endNode) {
      return { success: false, path: [], distance: 0, levelDistance: 0 };
    }

    if (startNode.id === endNode.id) {
      return {
        success: true,
        path: [startNode],
        distance: 0,
        levelDistance: 0,
        weightedCost: 0
      };
    }

    const avoidSet = new Set(options.avoidNodeIds || []);
    const allNodes = this.#locationStore.nodeById;

    const gScore = new Map();
    const fScore = new Map();
    const cameFrom = new Map();
    const closedSet = new Set();

    for (const node of this.#locationStore.nodes) {
      gScore.set(node.id, Infinity);
      fScore.set(node.id, Infinity);
    }
    gScore.set(startNode.id, 0);
    fScore.set(startNode.id, this.#heuristic(startNode, endNode));

    const openSet = new MinHeap((a, b) => fScore.get(a) - fScore.get(b));
    openSet.insert(startNode.id);

    while (!openSet.isEmpty) {
      const currentId = openSet.extractMin();

      if (currentId === endNode.id) {
        const path = this.#reconstructPath(cameFrom, currentId, allNodes);
        return {
          success: true,
          path,
          distance: this.#computeGeometricDistance(path),
          levelDistance: this.#computeLevelDelta(path),
          weightedCost: gScore.get(currentId)
        };
      }

      closedSet.add(currentId);
      const current = allNodes.get(currentId);

      for (const neighbor of (current.peers || [])) {
        const neighborId = neighbor.id;

        if (closedSet.has(neighborId) || avoidSet.has(neighborId)) {
          continue;
        }

        const stepCost = this.#edgeCost(current, neighbor, options);
        if (stepCost === Infinity) continue;

        const tentativeG = gScore.get(currentId) + stepCost;

        if (tentativeG < gScore.get(neighborId)) {
          cameFrom.set(neighborId, currentId);
          gScore.set(neighborId, tentativeG);
          fScore.set(neighborId, tentativeG + this.#heuristic(neighbor, endNode));

          if (openSet.has(neighborId)) {
            openSet.updatePriority(neighborId);
          } else {
            openSet.insert(neighborId);
          }
        }
      }
    }

    return { success: false, path: [], distance: 0, levelDistance: 0 };
  }

  #searchNodePairs(startNodes, endNodes, options) {
    let best = null;
    let bestWeightedCost = Infinity;

    for (const startNode of startNodes) {
      for (const endNode of endNodes) {
        const result = this.#astar(startNode, endNode, options);

        if (result.success && result.weightedCost < bestWeightedCost) {
          bestWeightedCost = result.weightedCost;
          best = {
            ...result,
            startNode,
            endNode
          };
        }
      }
    }

    return best;
  }

  #heuristic(a, b) {
    return this.#distance(a, b);
  }

  #edgeCost(from, to, options = {}) {
    const base = this.#distance(from, to);

    const fromLevelId = this.#getLevelId(from);
    const toLevelId = this.#getLevelId(to);
    const isCrossLevel = fromLevelId && toLevelId && fromLevelId !== toLevelId;

    if (!isCrossLevel) return base;

    const isEscalator = this.#isNodeKind(from, 'ESCALATOR') || this.#isNodeKind(to, 'ESCALATOR');
    const isLift = this.#isNodeKind(from, 'LIFT') || this.#isNodeKind(to, 'LIFT');
    const connectorConstraint = this.#normalizeConnectorConstraint(options.connectorConstraint);

    if (connectorConstraint === 'lift-only') {
      return isLift ? base + PathFinder.CROSS_LEVEL_BASE_PENALTY : Infinity;
    }

    if (connectorConstraint === 'escalator-only') {
      return isEscalator ? base + PathFinder.CROSS_LEVEL_BASE_PENALTY : Infinity;
    }

    if (!isEscalator && !isLift) {
      return base + PathFinder.CROSS_LEVEL_BASE_PENALTY;
    }

    const preferredPenalty = PathFinder.PREFERRED_PENALTY;
    const nonPreferredPenalty = PathFinder.NON_PREFERRED_PENALTY;

    if (this.#routeMode === 'escalator') {
      return base + PathFinder.CROSS_LEVEL_BASE_PENALTY +
        (isEscalator ? preferredPenalty : nonPreferredPenalty);
    }

    return base + PathFinder.CROSS_LEVEL_BASE_PENALTY +
      (isLift ? preferredPenalty : nonPreferredPenalty);
  }

  #isNodeKind(node, kind) {
    if (!node) return false;

    const location = node.location;
    if (location && typeof location === 'object') {
      return location.kind === kind;
    }

    if (typeof location === 'number') {
      const rawLoc = this.#rawLocationsMap.get(location);
      return rawLoc?.kind === kind;
    }

    return false;
  }

  #distance(a, b) {
    const dx = a.point.x - b.point.x;
    const dy = a.point.y - b.point.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  #reconstructPath(cameFrom, endId, allNodes) {
    const path = [];
    let current = endId;

    while (current !== undefined) {
      path.push(allNodes.get(current));
      current = cameFrom.get(current);
    }

    return path.reverse();
  }

  #computeGeometricDistance(path) {
    if (path.length < 2) return 0;

    let total = 0;
    for (let i = 1; i < path.length; i++) {
      total += this.#distance(path[i - 1], path[i]);
    }
    return total;
  }

  #computeLevelDelta(path) {
    if (path.length < 2) return 0;

    const startLevel = path[0]?.level;
    const endLevel = path[path.length - 1]?.level;
    const startOrdinal = typeof startLevel === 'object' ? startLevel.ordinal : undefined;
    const endOrdinal = typeof endLevel === 'object' ? endLevel.ordinal : undefined;

    if (startOrdinal === undefined || endOrdinal === undefined) {
      return 0;
    }

    return (endOrdinal || 0) - (startOrdinal || 0);
  }

  #getLevelId(node) {
    const level = node?.level;
    if (!level) return null;
    return typeof level === 'object' ? level.id : level;
  }

  #buildCacheKey(startId, endId, options) {
    const avoidStr = options.avoidNodeIds?.length
      ? `;avoid=${[...options.avoidNodeIds].sort((a, b) => a - b).join(',')}`
      : '';
    const connectorConstraint = this.#normalizeConnectorConstraint(options.connectorConstraint) ?? 'none';
    return `${startId}->${endId};mode=${this.#routeMode};constraint=${connectorConstraint}${avoidStr}`;
  }

  #normalizeConnectorConstraint(value) {
    return value === 'lift-only' || value === 'escalator-only' ? value : null;
  }

  #errorResult(message) {
    return {
      success: false,
      error: message,
      path: [],
      distance: 0,
      levelDistance: 0
    };
  }
}
