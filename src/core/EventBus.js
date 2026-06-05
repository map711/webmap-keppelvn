/**
 * Simple pub/sub event bus for decoupled communication.
 */
export class EventBus {
  #listeners = new Map();

  /**
   * Subscribe to an event.
   * @param {string} event - Event name (e.g., 'floor:changed')
   * @param {Function} callback - Handler function receiving event data
   * @returns {Function} Unsubscribe function
   */
  on(event, callback) {
    if (!this.#listeners.has(event)) {
      this.#listeners.set(event, new Set());
    }
    this.#listeners.get(event).add(callback);
    return () => this.off(event, callback);
  }

  /**
   * Unsubscribe from an event.
   * @param {string} event
   * @param {Function} callback
   */
  off(event, callback) {
    const listeners = this.#listeners.get(event);
    if (!listeners) return;
    listeners.delete(callback);
    if (listeners.size === 0) {
      this.#listeners.delete(event);
    }
  }

  /**
   * Subscribe to an event for a single emission.
   * @param {string} event
   * @param {Function} callback
   * @returns {Function} Unsubscribe function
   */
  once(event, callback) {
    const wrapper = (data) => {
      this.off(event, wrapper);
      callback(data);
    };
    return this.on(event, wrapper);
  }

  /**
   * Emit an event with an optional payload.
   * @param {string} event
   * @param {any} data
   */
  emit(event, data) {
    const listeners = this.#listeners.get(event);
    if (!listeners) return;
    // Copy to prevent mutation during iteration
    [...listeners].forEach((callback) => callback(data));
  }

  /**
   * Remove all listeners for a specific event, or all events if omitted.
   * @param {string} [event]
   */
  removeAllListeners(event) {
    if (event) {
      this.#listeners.delete(event);
      return;
    }
    this.#listeners.clear();
  }
}
