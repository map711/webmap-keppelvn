/**
 * GestureRecognizer unifies mouse, touch, and wheel input into semantic gestures.
 */
export class GestureRecognizer {
  #canvas;
  #eventBus;
  #transform;
  #pointerDownHandler;
  #pointerMoveHandler;
  #pointerUpHandler;
  #pointerCancelHandler;
  #wheelHandler;
  #touchStartHandler;
  #touchMoveHandler;
  #touchEndHandler;
  #touchCancelHandler;

  #isDragging = false;
  #lastMouseX = 0;
  #lastMouseY = 0;

  #touches = [];
  #gestureState = {
    type: 'none',
    lastCenter: { x: 0, y: 0 },
    lastDistance: 0,
    lastAngle: 0
  };

  #pointerDownTime = 0;
  #pointerDownPos = { x: 0, y: 0 };
  #tapThreshold = 10;
  #tapTimeout = 300;

  /**
   * @param {HTMLCanvasElement} canvas
   * @param {import('../core/EventBus.js').EventBus} eventBus
   * @param {import('../renderer/TransformPipeline.js').TransformPipeline} transform
   */
  constructor(canvas, eventBus, transform) {
    this.#canvas = canvas;
    this.#eventBus = eventBus;
    this.#transform = transform;

    this.#setupEventListeners();
  }

  /**
   * Clean up event listeners.
   */
  dispose() {
    const canvas = this.#canvas;
    if (!canvas) return;

    canvas.removeEventListener('pointerdown', this.#pointerDownHandler);
    canvas.removeEventListener('pointermove', this.#pointerMoveHandler);
    canvas.removeEventListener('wheel', this.#wheelHandler);
    canvas.removeEventListener('touchstart', this.#touchStartHandler);
    canvas.removeEventListener('touchmove', this.#touchMoveHandler);
    canvas.removeEventListener('touchend', this.#touchEndHandler);
    canvas.removeEventListener('touchcancel', this.#touchCancelHandler);

    if (typeof window !== 'undefined') {
      window.removeEventListener('pointerup', this.#pointerUpHandler);
      window.removeEventListener('pointercancel', this.#pointerCancelHandler);
    }

    this.#pointerDownHandler = null;
    this.#pointerMoveHandler = null;
    this.#pointerUpHandler = null;
    this.#pointerCancelHandler = null;
    this.#wheelHandler = null;
    this.#touchStartHandler = null;
    this.#touchMoveHandler = null;
    this.#touchEndHandler = null;
    this.#touchCancelHandler = null;

    this.#canvas = null;
    this.#eventBus = null;
    this.#transform = null;
  }

  #setupEventListeners() {
    const canvas = this.#canvas;

    this.#pointerDownHandler = (e) => this.#onPointerDown(e);
    this.#pointerMoveHandler = (e) => this.#onPointerMove(e);
    this.#pointerUpHandler = (e) => this.#onPointerUp(e);
    this.#pointerCancelHandler = (e) => this.#onPointerUp(e);
    this.#wheelHandler = (e) => this.#onWheel(e);
    this.#touchStartHandler = (e) => this.#onTouchStart(e);
    this.#touchMoveHandler = (e) => this.#onTouchMove(e);
    this.#touchEndHandler = (e) => this.#onTouchEnd(e);
    this.#touchCancelHandler = (e) => this.#onTouchEnd(e);

    canvas.addEventListener('pointerdown', this.#pointerDownHandler);
    canvas.addEventListener('pointermove', this.#pointerMoveHandler);

    if (typeof window !== 'undefined') {
      window.addEventListener('pointerup', this.#pointerUpHandler);
      window.addEventListener('pointercancel', this.#pointerCancelHandler);
    }

    canvas.addEventListener('wheel', this.#wheelHandler, { passive: false });

    canvas.addEventListener('touchstart', this.#touchStartHandler, { passive: false });
    canvas.addEventListener('touchmove', this.#touchMoveHandler, { passive: false });
    canvas.addEventListener('touchend', this.#touchEndHandler, { passive: false });
    canvas.addEventListener('touchcancel', this.#touchCancelHandler, { passive: false });
  }

  #onPointerDown(e) {
    if (e.pointerType === 'touch') return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    this.#isDragging = true;
    this.#canvas.setPointerCapture?.(e.pointerId);

    const pos = this.#getRelativePosition(e);
    this.#lastMouseX = pos.x;
    this.#lastMouseY = pos.y;

    this.#pointerDownTime = Date.now();
    this.#pointerDownPos = { x: pos.x, y: pos.y };

    this.#emit('gesture:start', { screenX: pos.x, screenY: pos.y });
  }

  #onPointerMove(e) {
    if (!this.#isDragging) return;
    if (e.pointerType === 'touch') return;

    const pos = this.#getRelativePosition(e);
    const deltaX = pos.x - this.#lastMouseX;
    const deltaY = pos.y - this.#lastMouseY;

    this.#lastMouseX = pos.x;
    this.#lastMouseY = pos.y;

    if (Math.abs(deltaX) > 0 || Math.abs(deltaY) > 0) {
      this.#emit('gesture:pan', {
        type: 'pan',
        deltaX,
        deltaY,
        screenX: pos.x,
        screenY: pos.y
      });
    }
  }

  #onPointerUp(e) {
    if (!this.#isDragging) return;

    const pos = this.#getRelativePosition(e);
    const elapsed = Date.now() - this.#pointerDownTime;
    const distance = Math.sqrt(
      Math.pow(pos.x - this.#pointerDownPos.x, 2) +
      Math.pow(pos.y - this.#pointerDownPos.y, 2)
    );

    if (elapsed < this.#tapTimeout && distance < this.#tapThreshold) {
      const world = this.#transform.screenToWorld(pos.x, pos.y);
      this.#emit('gesture:tap', {
        type: 'tap',
        screenX: pos.x,
        screenY: pos.y,
        worldX: world.x,
        worldY: world.y
      });
    }

    this.#isDragging = false;
    this.#emit('gesture:end', {});
  }

  #onWheel(e) {
    e.preventDefault();

    const pos = this.#getRelativePosition(e);
    const factor = e.deltaY > 0 ? 0.9 : 1.1;

    this.#emit('gesture:zoom', {
      type: 'zoom',
      factor,
      anchorX: pos.x,
      anchorY: pos.y
    });
  }

  #onTouchStart(e) {
    e.preventDefault();
    this.#updateTouches(e);

    if (this.#touches.length === 1) {
      this.#beginPan();
      this.#pointerDownTime = Date.now();
      this.#pointerDownPos = { x: this.#touches[0].x, y: this.#touches[0].y };
    } else if (this.#touches.length === 2) {
      this.#beginPinch();
    }

    this.#emit('gesture:start', {
      screenX: this.#touches[0]?.x ?? 0,
      screenY: this.#touches[0]?.y ?? 0
    });
  }

  #onTouchMove(e) {
    e.preventDefault();
    this.#updateTouches(e);

    if (this.#touches.length === 1 && this.#gestureState.type === 'pan') {
      this.#handlePanMove();
    } else if (this.#touches.length === 2 && this.#gestureState.type === 'pinch') {
      this.#handlePinchMove();
    }
  }

  #onTouchEnd(e) {
    e.preventDefault();

    if (this.#touches.length === 1 && this.#gestureState.type === 'pan') {
      const elapsed = Date.now() - this.#pointerDownTime;
      const pos = this.#touches[0];
      const distance = Math.sqrt(
        Math.pow(pos.x - this.#pointerDownPos.x, 2) +
        Math.pow(pos.y - this.#pointerDownPos.y, 2)
      );

      if (elapsed < this.#tapTimeout && distance < this.#tapThreshold) {
        const world = this.#transform.screenToWorld(pos.x, pos.y);
        this.#emit('gesture:tap', {
          type: 'tap',
          screenX: pos.x,
          screenY: pos.y,
          worldX: world.x,
          worldY: world.y
        });
      }
    }

    this.#updateTouches(e);

    if (this.#touches.length === 0) {
      this.#gestureState.type = 'none';
      this.#emit('gesture:end', {});
    } else if (this.#touches.length === 1 && this.#gestureState.type === 'pinch') {
      this.#beginPan();
    }
  }

  #beginPan() {
    this.#gestureState = {
      type: 'pan',
      lastCenter: { ...this.#touches[0] },
      lastDistance: 0,
      lastAngle: 0
    };
  }

  #beginPinch() {
    const metrics = this.#computeTwoFingerMetrics();
    this.#gestureState = {
      type: 'pinch',
      lastCenter: { ...metrics.center },
      lastDistance: metrics.distance,
      lastAngle: metrics.angle
    };
  }

  #handlePanMove() {
    const current = this.#touches[0];
    const deltaX = current.x - this.#gestureState.lastCenter.x;
    const deltaY = current.y - this.#gestureState.lastCenter.y;

    if (Math.abs(deltaX) > 0 || Math.abs(deltaY) > 0) {
      this.#emit('gesture:pan', {
        type: 'pan',
        deltaX,
        deltaY,
        screenX: current.x,
        screenY: current.y
      });
    }

    this.#gestureState.lastCenter = { ...current };
  }

  #handlePinchMove() {
    const metrics = this.#computeTwoFingerMetrics();

    const lastDistance = this.#gestureState.lastDistance || 1;
    const zoomFactor = metrics.distance / lastDistance;
    let rotationDelta = metrics.angle - this.#gestureState.lastAngle;
    rotationDelta = this.#normalizeAngle(rotationDelta);
    const panDeltaX = metrics.center.x - this.#gestureState.lastCenter.x;
    const panDeltaY = metrics.center.y - this.#gestureState.lastCenter.y;

    this.#emit('gesture:multitouch', {
      type: 'multitouch',
      zoomFactor,
      rotationDelta,
      panDeltaX,
      panDeltaY,
      focusX: metrics.center.x,
      focusY: metrics.center.y
    });

    this.#gestureState.lastCenter = { ...metrics.center };
    this.#gestureState.lastDistance = metrics.distance;
    this.#gestureState.lastAngle = metrics.angle;
  }

  #getRelativePosition(e) {
    const rect = this.#canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left - (this.#canvas.clientLeft || 0),
      y: e.clientY - rect.top - (this.#canvas.clientTop || 0)
    };
  }

  #updateTouches(e) {
    const rect = this.#canvas.getBoundingClientRect();
    const borderLeft = this.#canvas.clientLeft || 0;
    const borderTop = this.#canvas.clientTop || 0;

    this.#touches = [];
    for (const t of e.touches) {
      this.#touches.push({
        id: t.identifier,
        x: t.clientX - rect.left - borderLeft,
        y: t.clientY - rect.top - borderTop
      });
    }
  }

  #computeTwoFingerMetrics() {
    const [a, b] = this.#touches;
    const center = {
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2
    };
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx);
    return { center, distance, angle };
  }

  #normalizeAngle(delta) {
    if (delta > Math.PI) return delta - 2 * Math.PI;
    if (delta < -Math.PI) return delta + 2 * Math.PI;
    return delta;
  }

  #emit(event, data) {
    this.#eventBus.emit(event, data);
  }
}
