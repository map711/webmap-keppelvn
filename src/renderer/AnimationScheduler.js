/**
 * AnimationScheduler manages smooth view state transitions.
 */
export class AnimationScheduler {
  #currentAnimation = null;
  #onUpdate;
  #onComplete;

  /**
   * @param {Function} onUpdate
   * @param {Function} [onComplete]
   */
  constructor(onUpdate, onComplete) {
    this.#onUpdate = onUpdate;
    this.#onComplete = onComplete;
  }

  /**
   * Check if animation is in progress.
   * @returns {boolean}
   */
  get isAnimating() {
    return this.#currentAnimation !== null;
  }

  /**
   * Cancel any running animation.
   */
  cancel() {
    if (this.#currentAnimation) {
      this.#currentAnimation.cancelled = true;
      this.#currentAnimation = null;
    }
  }

  /**
   * Animate to target view state.
   * @param {Object} from - {scale, panX, panY, rotation}
   * @param {Object} to - {scale?, panX?, panY?, rotation?}
   * @param {Object} [options]
   * @param {number} [options.duration=600]
   * @param {Function} [options.easing]
   */
  animateTo(from, to, options = {}) {
    const duration = options.duration ?? 600;
    const easing = options.easing ?? AnimationScheduler.easeInOutCubic;

    const target = {
      scale: to.scale ?? from.scale,
      panX: to.panX ?? from.panX,
      panY: to.panY ?? from.panY,
      rotation: to.rotation ?? from.rotation
    };

    const epsilon = 0.0001;
    const isClose = (a, b) => Math.abs(a - b) < epsilon;
    if (isClose(from.scale, target.scale) &&
      isClose(from.panX, target.panX) &&
      isClose(from.panY, target.panY) &&
      isClose(from.rotation, target.rotation)) {
      this.#onUpdate(target);
      return;
    }

    this.cancel();

    const animation = {
      startTime: performance.now(),
      duration,
      from: { ...from },
      to: target,
      easing,
      cancelled: false
    };

    this.#currentAnimation = animation;
    this.#tick(animation);
  }

  #tick(animation) {
    if (animation.cancelled) return;

    const now = performance.now();
    const elapsed = now - animation.startTime;
    const rawT = Math.min(1, elapsed / animation.duration);
    const t = animation.easing(rawT);

    const state = {
      scale: this.#lerp(animation.from.scale, animation.to.scale, t),
      panX: this.#lerp(animation.from.panX, animation.to.panX, t),
      panY: this.#lerp(animation.from.panY, animation.to.panY, t),
      rotation: this.#lerp(animation.from.rotation, animation.to.rotation, t)
    };

    this.#onUpdate(state);

    if (rawT < 1 && !animation.cancelled) {
      requestAnimationFrame(() => this.#tick(animation));
    } else {
      this.#currentAnimation = null;
      if (this.#onComplete && !animation.cancelled) {
        this.#onComplete();
      }
    }
  }

  #lerp(a, b, t) {
    return a + (b - a) * t;
  }

  static easeInOutCubic(t) {
    return t < 0.5
      ? 4 * t * t * t
      : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  static easeOutQuad(t) {
    return 1 - (1 - t) * (1 - t);
  }

  static linear(t) {
    return t;
  }
}
