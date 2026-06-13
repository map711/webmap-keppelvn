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

    const { type, locations, payload } = this.#classifyHit(result);
    // A self-describing hit (e.g. reward) carries its own clean payload — emit
    // that verbatim so the single generic emit is canonical; the handler then
    // performs only a side-effect and never re-emits (the floor-transition
    // pattern). Otherwise emit the standard tap envelope.
    this.#eventBus.emit(
      `tap:${type}`,
      payload ?? {
        ...tapEvent,
        hitResult: result,
        locations
      }
    );

    const handler = this.#handlers.get(type);
    if (handler) {
      handler(result, tapEvent);
    }
  }

  /**
   * Classify a raw hit result into a tap type (and any resolved Locations).
   * A self-describing hit may also carry a `payload` — the clean detail to emit
   * verbatim as the tap event (so #onTap fires it exactly once, no re-emit).
   * @param {any} result
   * @returns {{type:string, locations:Array, payload?:object}}
   */
  #classifyHit(result) {
    // A connector-bubble hit is self-describing — route it to the
    // floor-transition handler before the unit-id path (a bare floor-code
    // string would otherwise be misread as a unit id).
    if (result && result.type === 'floor-transition') {
      return { type: 'floor-transition', locations: [] };
    }

    // A reward-marker hit is likewise self-describing — short-circuit before
    // the unit-id path so the reward payload isn't misread as a unit id. It
    // carries its own clean {shopId, rewards, location} payload so #onTap emits
    // exactly ONE tap:reward with the documented shape (no handler re-emit).
    if (result && result.type === 'reward') {
      return {
        type: 'reward',
        locations: [],
        payload: {
          shopId: result.shopId,
          rewards: result.rewards,
          location: result.location
        }
      };
    }

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
