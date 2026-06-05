/**
 * TransformPipeline manages view state and coordinate conversion.
 */
export class TransformPipeline {
  #scale = 1;
  #panX = 0;
  #panY = 0;
  #rotation = 0;

  #minScale = 0.1;
  #maxScale = 2.0;

  #canvasWidth = 0;
  #canvasHeight = 0;

  #padding = { left: 0, right: 0, top: 0, bottom: 0 };

  /**
   * Set canvas dimensions (CSS pixels).
   * @param {number} width
   * @param {number} height
   */
  setCanvasSize(width, height) {
    this.#canvasWidth = width;
    this.#canvasHeight = height;
  }

  /**
   * Set content area padding.
   * @param {{left?: number, right?: number, top?: number, bottom?: number}} padding
   */
  setPadding(padding) {
    this.#padding = { ...this.#padding, ...padding };
  }

  /**
   * Set scale constraints.
   * @param {number} min
   * @param {number} max
   */
  setScaleBounds(min, max) {
    this.#minScale = min;
    this.#maxScale = max;
    this.#clampScale();
  }

  /**
   * Get current scale constraints.
   * @returns {{min:number,max:number}}
   */
  getScaleBounds() {
    return { min: this.#minScale, max: this.#maxScale };
  }

  /**
   * Get current view state.
   * @returns {{scale:number,panX:number,panY:number,rotation:number}}
   */
  getViewState() {
    return {
      scale: this.#scale,
      panX: this.#panX,
      panY: this.#panY,
      rotation: this.#rotation
    };
  }

  /**
   * Set view state directly.
   * @param {{scale?:number,panX?:number,panY?:number,rotation?:number}} state
   */
  setViewState(state) {
    if (state.scale !== undefined) this.#scale = state.scale;
    if (state.panX !== undefined) this.#panX = state.panX;
    if (state.panY !== undefined) this.#panY = state.panY;
    if (state.rotation !== undefined) this.#rotation = state.rotation;
    this.#clampScale();
  }

  /**
   * Get the canvas center point (accounting for padding).
   * @returns {{x:number,y:number}}
   */
  getCanvasCenter() {
    const usableWidth = this.#canvasWidth - this.#padding.left - this.#padding.right;
    const usableHeight = this.#canvasHeight - this.#padding.top - this.#padding.bottom;
    return {
      x: this.#padding.left + usableWidth / 2,
      y: this.#padding.top + usableHeight / 2
    };
  }

  /**
   * Apply the view transform to a canvas context.
   * @param {CanvasRenderingContext2D} ctx
   */
  applyTransform(ctx) {
    const center = this.getCanvasCenter();
    ctx.translate(this.#panX + center.x, this.#panY + center.y);
    ctx.rotate(this.#rotation);
    ctx.scale(this.#scale, this.#scale);
  }

  /**
   * Convert screen coordinates to world coordinates.
   * @param {number} screenX
   * @param {number} screenY
   * @returns {{x:number,y:number}}
   */
  screenToWorld(screenX, screenY) {
    const center = this.getCanvasCenter();

    let x = screenX - (this.#panX + center.x);
    let y = screenY - (this.#panY + center.y);

    const cos = Math.cos(-this.#rotation);
    const sin = Math.sin(-this.#rotation);
    const rotX = x * cos - y * sin;
    const rotY = x * sin + y * cos;

    return {
      x: rotX / this.#scale,
      y: rotY / this.#scale
    };
  }

  /**
   * Convert world coordinates to screen coordinates.
   * @param {number} worldX
   * @param {number} worldY
   * @returns {{x:number,y:number}}
   */
  worldToScreen(worldX, worldY) {
    let x = worldX * this.#scale;
    let y = worldY * this.#scale;

    const cos = Math.cos(this.#rotation);
    const sin = Math.sin(this.#rotation);
    const rotX = x * cos - y * sin;
    const rotY = x * sin + y * cos;

    const center = this.getCanvasCenter();
    return {
      x: rotX + center.x + this.#panX,
      y: rotY + center.y + this.#panY
    };
  }

  /**
   * Pan by delta amounts.
   * @param {number} deltaX
   * @param {number} deltaY
   */
  pan(deltaX, deltaY) {
    this.#panX += deltaX;
    this.#panY += deltaY;
  }

  /**
   * Zoom by factor, optionally anchored to a screen point.
   * @param {number} factor
   * @param {number} [anchorX]
   * @param {number} [anchorY]
   */
  zoom(factor, anchorX, anchorY) {
    if (anchorX === undefined || anchorY === undefined) {
      const center = this.getCanvasCenter();
      anchorX = center.x;
      anchorY = center.y;
    }

    const worldPoint = this.screenToWorld(anchorX, anchorY);

    const newScale = Math.max(this.#minScale, Math.min(this.#maxScale, this.#scale * factor));
    this.#scale = newScale;

    const newScreenPoint = this.worldToScreen(worldPoint.x, worldPoint.y);

    this.#panX += anchorX - newScreenPoint.x;
    this.#panY += anchorY - newScreenPoint.y;
  }

  /**
   * Rotate by delta radians.
   * @param {number} deltaRadians
   */
  rotate(deltaRadians) {
    this.#rotation += deltaRadians;
  }

  /**
   * Fit view to content bounds.
   * @param {{width:number,height:number,centerX?:number,centerY?:number}} bounds
   * @param {number} [padding=0]
   */
  fitToBounds(bounds, padding = 0) {
    this.#rotation = 0;

    const usableWidth = this.#canvasWidth - this.#padding.left - this.#padding.right - (padding * 2);
    const usableHeight = this.#canvasHeight - this.#padding.top - this.#padding.bottom - (padding * 2);

    const scaleX = usableWidth / (bounds.width || 1);
    const scaleY = usableHeight / (bounds.height || 1);
    const fitScale = Math.min(scaleX, scaleY);

    // Lower the minScale floor to the natural fit scale (capped at maxScale) so
    // this fit isn't re-clamped UP by a stale minScale left behind by a previous
    // fit to a tiny-bounds floor. The fitted view becomes the zoom-out limit.
    this.#minScale = Math.min(fitScale, this.#maxScale);
    this.#scale = Math.max(this.#minScale, Math.min(this.#maxScale, fitScale));

    const centerX = bounds.centerX ?? bounds.width / 2;
    const centerY = bounds.centerY ?? bounds.height / 2;
    const pan = this.#computePanForCenter(centerX, centerY);
    this.#panX = pan.x;
    this.#panY = pan.y;
  }

  /**
   * Center view on a world point.
   * @param {number} worldX
   * @param {number} worldY
   */
  centerOn(worldX, worldY) {
    const pan = this.#computePanForCenter(worldX, worldY);
    this.#panX = pan.x;
    this.#panY = pan.y;
  }

  /**
   * Reset rotation to zero.
   */
  resetRotation() {
    this.#rotation = 0;
  }

  #computePanForCenter(worldX, worldY) {
    const sx = worldX * this.#scale;
    const sy = worldY * this.#scale;
    const cos = Math.cos(this.#rotation);
    const sin = Math.sin(this.#rotation);
    const rx = sx * cos - sy * sin;
    const ry = sx * sin + sy * cos;
    return { x: -rx, y: -ry };
  }

  #clampScale() {
    this.#scale = Math.max(this.#minScale, Math.min(this.#maxScale, this.#scale));
  }
}
