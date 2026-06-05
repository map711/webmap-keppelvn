import { TransformPipeline } from './TransformPipeline.js';
import { LayerStack } from './LayerStack.js';
import { AnimationScheduler } from './AnimationScheduler.js';

/**
 * Renderer manages the canvas lifecycle, render loop, and layer coordination.
 */
export class Renderer {
  #canvas;
  #ctx;
  #dpr = 1;

  #transform;
  #layerStack;
  #animator;
  #eventBus;

  #rafId = null;
  #renderScheduled = false;
  #lastFrameTime = 0;
  #fps = 0;
  #fpsSmoothing = 0.9;

  #showFps = false;

  /**
   * @param {HTMLCanvasElement} canvas
   * @param {import('../core/EventBus.js').EventBus} eventBus
   * @param {Object} [options]
   */
  constructor(canvas, eventBus, options = {}) {
    this.#canvas = canvas;
    this.#ctx = canvas.getContext('2d');
    this.#eventBus = eventBus;
    this.#showFps = options.showFps ?? false;

    this.#transform = new TransformPipeline();
    this.#layerStack = new LayerStack();
    this.#animator = new AnimationScheduler(
      (state) => this.#onAnimationUpdate(state),
      () => this.#onAnimationComplete()
    );

    this.#dpr = window.devicePixelRatio || 1;
    this.#applyDprScaling();
  }

  /**
   * Get the transform pipeline.
   * @returns {TransformPipeline}
   */
  get transform() {
    return this.#transform;
  }

  /**
   * Get the layer stack.
   * @returns {LayerStack}
   */
  get layers() {
    return this.#layerStack;
  }

  /**
   * Get the animation scheduler.
   * @returns {AnimationScheduler}
   */
  get animator() {
    return this.#animator;
  }

  /**
   * Get current FPS.
   * @returns {number}
   */
  get fps() {
    return this.#fps;
  }

  /**
   * Resize the canvas to match container.
   * @param {number} width
   * @param {number} height
   */
  resize(width, height) {
    this.#canvas.width = width * this.#dpr;
    this.#canvas.height = height * this.#dpr;
    this.#canvas.style.width = `${width}px`;
    this.#canvas.style.height = `${height}px`;

    this.#transform.setCanvasSize(width, height);
    this.#applyDprScaling();
    this.requestRender();
  }

  /**
   * Request a render on next animation frame.
   */
  requestRender() {
    if (this.#renderScheduled) return;
    this.#renderScheduled = true;
    this.#rafId = requestAnimationFrame((ts) => this.#onFrame(ts));
  }

  /**
   * Immediate synchronous render.
   */
  renderNow() {
    this.#draw();
  }

  /**
   * Set current floor on all layers.
   * @param {string} floorCode
   */
  setFloor(floorCode) {
    this.#layerStack.setFloor(floorCode);
    this.requestRender();
  }

  /**
   * Fit view to bounds.
   * @param {Object} bounds
   * @param {number} [padding]
   */
  fitToBounds(bounds, padding) {
    this.#transform.fitToBounds(bounds, padding);
    this.#emitViewChange();
    this.requestRender();
  }

  /**
   * Animate to a target view state.
   * @param {Object} target
   */
  animateTo(target) {
    const current = this.#transform.getViewState();
    this.#animator.animateTo(current, target, { duration: target.duration });
  }

  /**
   * Cancel any running animation.
   */
  cancelAnimation() {
    this.#animator.cancel();
  }

  /**
   * Perform hit test at screen coordinates.
   * @param {number} screenX
   * @param {number} screenY
   * @returns {any}
   */
  hitTest(screenX, screenY) {
    const world = this.#transform.screenToWorld(screenX, screenY);
    return this.#layerStack.hitTest(world.x, world.y);
  }

  /**
   * Clean up resources.
   */
  dispose() {
    if (this.#rafId) {
      cancelAnimationFrame(this.#rafId);
    }
    this.#layerStack.clear();
    this.#animator.cancel();
  }

  #applyDprScaling() {
    this.#ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.#ctx.scale(this.#dpr, this.#dpr);
  }

  #onFrame(timestamp) {
    this.#renderScheduled = false;

    const delta = timestamp - this.#lastFrameTime;
    const instantFps = delta > 0 ? 1000 / delta : 0;
    this.#fps = this.#fps
      ? this.#fps * this.#fpsSmoothing + instantFps * (1 - this.#fpsSmoothing)
      : instantFps;
    this.#lastFrameTime = timestamp;

    this.#draw();
  }

  #draw() {
    const ctx = this.#ctx;
    const width = this.#canvas.width / this.#dpr;
    const height = this.#canvas.height / this.#dpr;

    ctx.clearRect(0, 0, width, height);

    ctx.save();

    this.#transform.applyTransform(ctx);

    const renderContext = this.#layerStack.createRenderContext(
      ctx,
      this.#transform,
      this.#dpr,
      () => this.requestRender()
    );
    this.#layerStack.render(renderContext);

    ctx.restore();

    if (this.#showFps) {
      this.#drawFpsOverlay();
    }
  }

  #drawFpsOverlay() {
    const ctx = this.#ctx;
    const text = `FPS: ${this.#fps.toFixed(1)}`;
    const padding = 8;
    const x = padding;
    const y = (this.#canvas.height / this.#dpr) - padding;

    ctx.save();
    ctx.font = '12px monospace';
    ctx.textBaseline = 'bottom';

    const metrics = ctx.measureText(text);
    const boxWidth = metrics.width + padding * 2;
    const boxHeight = 14 + padding * 2;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(x - padding, y - 14 - padding, boxWidth, boxHeight);

    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  #onAnimationUpdate(state) {
    this.#transform.setViewState(state);
    this.#emitViewChange();
    this.requestRender();
  }

  #onAnimationComplete() {
    // reserved for future events
  }

  #emitViewChange() {
    const state = this.#transform.getViewState();
    this.#eventBus.emit('view:changed', state);
  }
}
