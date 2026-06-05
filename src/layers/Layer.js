/**
 * Base class for map layers.
 */
export class Layer {
  /** Whether this layer is visible */
  visible = true;

  /** Layer name (for debugging) */
  name = 'Layer';

  /**
   * Render this layer.
   * @param {Object} renderContext
   */
  renderWithContext(renderContext) {
    void renderContext;
  }

  /**
   * Set the current floor for this layer.
   * @param {string} floorCode
   */
  setFloor(floorCode) {
    void floorCode;
  }

  /**
   * Hit test at world coordinates.
   * @param {number} worldX
   * @param {number} worldY
   * @returns {any}
   */
  hitTest(worldX, worldY) {
    void worldX;
    void worldY;
    return null;
  }

  /**
   * Clean up resources.
   */
  dispose() {}

  /**
   * Helper: Apply inverse transform for screen-space rendering.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} worldX
   * @param {number} worldY
   * @param {number} scale
   * @param {number} rotation
   * @param {Function} drawFn
   */
  withScreenSpaceTransform(ctx, worldX, worldY, scale, rotation, drawFn) {
    ctx.save();
    ctx.translate(worldX, worldY);
    ctx.rotate(-rotation);
    ctx.scale(1 / scale, 1 / scale);
    drawFn();
    ctx.restore();
  }
}
