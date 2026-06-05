/**
 * HitTestManager coordinates hit testing across layers and classifies a tap.
 *
 * A tap resolves through the LayerStack to a hit result; the FloorLayer's hit
 * result carries a `unitId`, which the manager maps via the LocationStore's
 * one-to-many `getLocationsByUnitId`:
 *   - exactly one Location owns the unit  -> `tap:location`
 *   - two or more Locations (multi-tenant) -> `tap:disambiguate`
 *   - no Location owns the unit            -> `tap:floor`
 */
export class HitTestManager {
  #layerStack;
  #eventBus;
  #locationStore = null;
  #handlers = new Map();

  /**
   * @param {import('../renderer/LayerStack.js').LayerStack} layerStack
   * @param {import('../core/EventBus.js').EventBus} eventBus
   * @param {import('../data/LocationModel.js').LocationStore} [locationStore]
   */
  constructor(layerStack, eventBus, locationStore = null) {
    this.#layerStack = layerStack;
    this.#eventBus = eventBus;
    this.#locationStore = locationStore;

    this.#eventBus.on('gesture:tap', (e) => this.#onTap(e));
  }

  /**
   * Provide (or replace) the LocationStore used to resolve unit ids -> Locations.
   * @param {import('../data/LocationModel.js').LocationStore} locationStore
   */
  setLocationStore(locationStore) {
    this.#locationStore = locationStore;
  }

  /**
   * Register a handler for a specific hit type.
   * @param {string} type
   * @param {Function} handler
   */
  registerHandler(type, handler) {
    this.#handlers.set(type, handler);
  }

  /**
   * Unregister a handler.
   * @param {string} type
   */
  unregisterHandler(type) {
    this.#handlers.delete(type);
  }

  /**
   * Perform hit test at world coordinates.
   * @param {number} worldX
   * @param {number} worldY
   * @returns {any}
   */
  hitTest(worldX, worldY) {
    return this.#layerStack.hitTest(worldX, worldY);
  }

  #onTap(tapEvent) {
    const { worldX, worldY, screenX, screenY } = tapEvent;

    const result = this.#layerStack.hitTest(worldX, worldY);

    if (result == null) {
      this.#eventBus.emit('tap:empty', { worldX, worldY, screenX, screenY });
      return;
    }

    const { type, locations } = this.#classifyHit(result);
    this.#eventBus.emit(`tap:${type}`, {
      ...tapEvent,
      hitResult: result,
      locations
    });

    const handler = this.#handlers.get(type);
    if (handler) {
      handler(result, tapEvent);
    }
  }

  /**
   * Classify a raw hit result into a tap type (and any resolved Locations).
   * @param {any} result
   * @returns {{type:string, locations:Array}}
   */
  #classifyHit(result) {
    const unitId = this.#extractUnitId(result);

    if (unitId != null) {
      const locations = this.#locationsForUnit(unitId);
      if (locations.length === 1) return { type: 'location', locations };
      if (locations.length >= 2) return { type: 'disambiguate', locations };
      // A real unit polygon that no Location catalogs -> a bare floor tap.
      return { type: 'floor', locations: [] };
    }

    if (result && result.location) {
      return { type: 'location', locations: [result.location] };
    }

    return { type: 'unknown', locations: [] };
  }

  #extractUnitId(result) {
    if (result == null) return null;
    if (typeof result === 'number' || typeof result === 'string') return result;
    if (result.unitId != null) return result.unitId;
    if (result.unit_id != null) return result.unit_id;
    return null;
  }

  #locationsForUnit(unitId) {
    if (
      this.#locationStore &&
      typeof this.#locationStore.getLocationsByUnitId === 'function'
    ) {
      return this.#locationStore.getLocationsByUnitId(unitId) ?? [];
    }
    return [];
  }
}
