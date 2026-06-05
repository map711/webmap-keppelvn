/**
 * LayerStack manages an ordered collection of layers.
 */
export class LayerStack {
  #layers = [];

  /**
   * Add a layer to the top of the stack.
   * @param {Object} layer
   */
  add(layer) {
    this.#layers.push(layer);
  }

  /**
   * Insert a layer at a specific index.
   * @param {Object} layer
   * @param {number} index
   */
  insert(layer, index) {
    this.#layers.splice(index, 0, layer);
  }

  /**
   * Remove a layer from the stack.
   * @param {Object} layer
   * @returns {boolean}
   */
  remove(layer) {
    const index = this.#layers.indexOf(layer);
    if (index > -1) {
      this.#layers.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Remove all layers.
   */
  clear() {
    for (const layer of this.#layers) {
      if (typeof layer.dispose === 'function') {
        layer.dispose();
      }
    }
    this.#layers = [];
  }

  /**
   * Get layer at index.
   * @param {number} index
   * @returns {Object|undefined}
   */
  get(index) {
    return this.#layers[index];
  }

  /**
   * Get layer count.
   * @returns {number}
   */
  get count() {
    return this.#layers.length;
  }

  /**
   * Iterate over all layers.
   * @param {Function} callback
   */
  forEach(callback) {
    this.#layers.forEach(callback);
  }

  /**
   * Create a render context for this frame.
   * @param {CanvasRenderingContext2D} ctx
   * @param {import('./TransformPipeline.js').TransformPipeline} transform
   * @param {number} dpr
   * @param {Function} invalidate
   * @returns {Object}
   */
  createRenderContext(ctx, transform, dpr, invalidate) {
    const viewState = transform.getViewState();
    return {
      ctx,
      dpr,
      scale: viewState.scale,
      panX: viewState.panX,
      panY: viewState.panY,
      rotation: viewState.rotation,
      invalidate
    };
  }

  /**
   * Render all layers with given context.
   * @param {Object} renderContext
   */
  render(renderContext) {
    for (const layer of this.#layers) {
      if (!layer || !layer.visible) continue;

      if (typeof layer.renderWithContext === 'function') {
        layer.renderWithContext(renderContext);
      } else if (typeof layer.render === 'function') {
        layer.render(renderContext.ctx);
      }
    }
  }

  /**
   * Set current floor on all layers.
   * @param {string} floorCode
   */
  setFloor(floorCode) {
    for (const layer of this.#layers) {
      if (typeof layer.setFloor === 'function') {
        layer.setFloor(floorCode);
      } else if (typeof layer.setCurrentLevel === 'function') {
        layer.setCurrentLevel(floorCode);
      }
    }
  }

  /**
   * Hit test all layers (top to bottom).
   * @param {number} worldX
   * @param {number} worldY
   * @returns {any}
   */
  hitTest(worldX, worldY) {
    for (let i = this.#layers.length - 1; i >= 0; i--) {
      const layer = this.#layers[i];
      if (!layer || !layer.visible) continue;

      if (typeof layer.hitTest === 'function') {
        const result = layer.hitTest(worldX, worldY);
        if (result) return result;
      }
    }
    return null;
  }
}
