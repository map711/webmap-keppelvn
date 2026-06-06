import { Layer } from './Layer.js';

/**
 * NavigationLayer renders the navigation path with animation.
 */
export class NavigationLayer extends Layer {
  name = 'NavigationLayer';

  #fullPath = [];
  #filteredPath = [];
  #currentLevelCode = null;
  #pathResult = null;

  #segmentLengths = [];
  #totalLength = 0;

  #bottomColor = '#999999';
  #bottomWidth = 16;
  #topColor = '#000000';
  #topWidth = 8;

  #progress = 0;
  #speed = 0.0025;
  #isAnimating = false;
  #shouldLoop = true;
  #animationFrameId = null;
  #loopResetTimeoutId = null;
  #invalidate = null;

  constructor(levelCode = null) {
    super();
    this.#currentLevelCode = levelCode;
  }

  /**
   * Set the navigation path.
   * @param {Object} pathResult
   */
  setPath(pathResult) {
    this.#pathResult = pathResult?.success ? pathResult : null;
    this.#fullPath = NavigationLayer.flattenSegments(this.#pathResult);
    this.#extendToShopAnchors();
    this.#filterPathForFloor();

    if (this.#filteredPath.length > 0) {
      this.startAnimation();
    }
  }

  /**
   * Extend the flattened polyline so it reaches the SHOP anchor (the display
   * node / `label_point`) at each end, matching where {@link import('./PinMarkerLayer.js').PinMarkerLayer}
   * draws the start/end pin. The navmesh path itself terminates at the routing
   * DOOR (a corridor-edge point); this prepends/appends the cosmetic "into the
   * shop" leg so the line meets the pin instead of stopping at the door.
   *
   * Door-less units snap their anchor to the centroid (≈ the display point), so
   * the dedup guard makes this a no-op there — the leg only appears for units
   * that have a door (where door ≠ shop anchor). No leg is added for routes that
   * omit Location metadata.
   */
  #extendToShopAnchors() {
    const result = this.#pathResult;
    if (!result || this.#fullPath.length === 0) return;

    const startFloor = result.startAnchor?.levelCode;
    const endFloor = result.endAnchor?.levelCode;
    const startPt = NavigationLayer.#shopAnchorOnFloor(result.startLocation, startFloor);
    const endPt = NavigationLayer.#shopAnchorOnFloor(result.endLocation, endFloor);

    if (startPt && startFloor) {
      const head = this.#fullPath[0];
      if (head.level?.code === startFloor && !NavigationLayer.#samePoint(head.point, startPt)) {
        this.#fullPath.unshift({ point: startPt, level: { code: startFloor } });
      }
    }
    if (endPt && endFloor) {
      const tail = this.#fullPath[this.#fullPath.length - 1];
      if (tail.level?.code === endFloor && !NavigationLayer.#samePoint(tail.point, endPt)) {
        this.#fullPath.push({ point: endPt, level: { code: endFloor } });
      }
    }
  }

  /**
   * Resolve a Location's SHOP anchor on a given floor — the same point the pin
   * uses: legacy navigation nodes (`level.code`) first, then bundle `displayNodes`
   * (`levelCode`). Returns `{x,y}` or `null`.
   */
  static #shopAnchorOnFloor(location, levelCode) {
    if (!location || !levelCode) return null;
    const legacy = location.nodes?.find?.((n) => n.level?.code === levelCode);
    if (legacy?.point) return { x: legacy.point.x, y: legacy.point.y };
    const display = location.displayNodes?.find?.((n) => n.levelCode === levelCode);
    if (display?.point) return { x: display.point.x, y: display.point.y };
    return null;
  }

  static #samePoint(a, b) {
    return Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;
  }

  /**
   * Flatten a navmesh {@link import('../navigation/PathFinder.js').PathFinder}
   * result's per-floor `segments` (`Map<levelCode, [x,y][]>`) into the flat
   * `{point:{x,y}, level:{code}}` node list this layer's draw/animation paths
   * consume. Returns `[]` for a failed/empty result.
   * @param {Object|null} result
   * @returns {Array<{point:{x:number,y:number}, level:{code:string}}>}
   */
  static flattenSegments(result) {
    if (!result?.success) return [];
    const segs = result.segments;
    if (!segs) return [];
    const entries = segs instanceof Map ? [...segs.entries()] : Object.entries(segs);
    const out = [];
    for (const [levelCode, poly] of entries) {
      for (const p of poly || []) {
        const x = Array.isArray(p) ? p[0] : p.x;
        const y = Array.isArray(p) ? p[1] : p.y;
        out.push({ point: { x, y }, level: { code: levelCode } });
      }
    }
    return out;
  }

  /**
   * Clear the current path.
   */
  clearPath() {
    this.#fullPath = [];
    this.#filteredPath = [];
    this.#pathResult = null;
    this.#resetMetrics();
    this.stopAnimation();
  }

  /**
   * Get the path result.
   * @returns {Object|null}
   */
  getPathResult() {
    return this.#pathResult;
  }

  /**
   * Check if there's an active path.
   * @returns {boolean}
   */
  hasPath() {
    return this.#filteredPath.length > 0;
  }

  /**
   * Get full path (all floors).
   * @returns {Array}
   */
  getFullPath() {
    return this.#fullPath;
  }

  setFloor(levelCode) {
    this.#currentLevelCode = levelCode;
    this.#filterPathForFloor();

    if (this.#filteredPath.length > 0) {
      this.startAnimation();
    } else {
      this.stopAnimation();
    }
  }

  /**
   * Start the path animation.
   */
  startAnimation() {
    this.#clearLoopResetTimeout();
    if (this.#animationFrameId != null) {
      cancelAnimationFrame(this.#animationFrameId);
      this.#animationFrameId = null;
    }
    this.#progress = 0;
    this.#isAnimating = true;
    this.#animationLoop();
  }

  /**
   * Stop the animation.
   */
  stopAnimation() {
    this.#isAnimating = false;
    this.#progress = 0;
    this.#clearLoopResetTimeout();
    if (this.#animationFrameId) {
      cancelAnimationFrame(this.#animationFrameId);
      this.#animationFrameId = null;
    }
  }

  dispose() {
    this.stopAnimation();
    this.#invalidate = null;
  }

  /**
   * Set animation speed.
   * @param {number} speed
   */
  setAnimationSpeed(speed) {
    this.#speed = Math.max(0.001, Math.min(0.1, speed));
  }

  /**
   * Set whether animation should loop.
   * @param {boolean} loop
   */
  setLooping(loop) {
    this.#shouldLoop = loop;
  }

  /**
   * Get animation status.
   * @returns {{isAnimating:boolean,progress:number,speed:number,looping:boolean}}
   */
  getAnimationStatus() {
    return {
      isAnimating: this.#isAnimating,
      progress: this.#progress,
      speed: this.#speed,
      looping: this.#shouldLoop
    };
  }

  /**
   * Identify floor transitions in the full path.
   * @returns {Array<{fromFloor:string,toFloor:string,nodeIndex:number,node:Object}>}
   */
  getFloorTransitions() {
    const transitions = [];
    let currentFloor = null;

    for (let i = 0; i < this.#fullPath.length; i++) {
      const node = this.#fullPath[i];
      const floor = node.level?.code;

      if (floor && floor !== currentFloor) {
        if (currentFloor !== null) {
          transitions.push({
            fromFloor: currentFloor,
            toFloor: floor,
            nodeIndex: i,
            node
          });
        }
        currentFloor = floor;
      }
    }

    return transitions;
  }

  renderWithContext(renderContext) {
    const { ctx, invalidate } = renderContext;
    if (invalidate) this.#invalidate = invalidate;
    if (!this.visible || this.#filteredPath.length < 2) return;

    ctx.save();

    this.#advanceAnimation();

    this.#drawBottomPath(ctx);
    this.#drawTopPath(ctx);

    ctx.restore();
  }

  #filterPathForFloor() {
    if (!this.#fullPath.length) {
      this.#filteredPath = [];
      this.#resetMetrics();
      return;
    }

    this.#filteredPath = this.#currentLevelCode
      ? this.#fullPath.filter((n) => n.level?.code === this.#currentLevelCode)
      : [...this.#fullPath];

    this.#computeMetrics();
  }

  #resetMetrics() {
    this.#segmentLengths = [];
    this.#totalLength = 0;
  }

  #computeMetrics() {
    this.#resetMetrics();
    if (this.#filteredPath.length < 2) return;

    let total = 0;
    const segments = [];

    for (let i = 1; i < this.#filteredPath.length; i++) {
      const len = this.#distance(this.#filteredPath[i - 1], this.#filteredPath[i]);
      segments.push(len);
      total += len;
    }

    this.#segmentLengths = segments;
    this.#totalLength = total;
  }

  #distance(a, b) {
    const dx = b.point.x - a.point.x;
    const dy = b.point.y - a.point.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  #animationLoop() {
    if (!this.#isAnimating) return;

    this.#requestRender();
    this.#animationFrameId = requestAnimationFrame(() => this.#animationLoop());
  }

  #advanceAnimation() {
    if (!this.#isAnimating) return;

    this.#progress += this.#speed;

    if (this.#progress >= 1) {
      this.#progress = 1;

      if (this.#shouldLoop) {
        if (this.#loopResetTimeoutId == null) {
          this.#loopResetTimeoutId = setTimeout(() => {
            this.#loopResetTimeoutId = null;
            if (this.#isAnimating && this.#shouldLoop) {
              this.#progress = 0;
            }
          }, 500);
        }
      } else {
        this.#isAnimating = false;
        this.#clearLoopResetTimeout();
        if (this.#animationFrameId) {
          cancelAnimationFrame(this.#animationFrameId);
          this.#animationFrameId = null;
        }
      }
    }
  }

  #requestRender() {
    if (typeof this.#invalidate === 'function') {
      this.#invalidate();
    }
  }

  #clearLoopResetTimeout() {
    if (this.#loopResetTimeoutId == null) return;
    clearTimeout(this.#loopResetTimeoutId);
    this.#loopResetTimeoutId = null;
  }

  #drawBottomPath(ctx) {
    ctx.strokeStyle = this.#bottomColor;
    ctx.lineWidth = this.#bottomWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    const first = this.#filteredPath[0];
    ctx.moveTo(first.point.x, first.point.y);

    for (let i = 1; i < this.#filteredPath.length; i++) {
      const node = this.#filteredPath[i];
      ctx.lineTo(node.point.x, node.point.y);
    }

    ctx.stroke();
  }

  #drawTopPath(ctx) {
    if (this.#progress === 0 || !this.#totalLength) return;

    ctx.strokeStyle = this.#topColor;
    ctx.lineWidth = this.#topWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const targetLength = this.#totalLength * this.#progress;

    ctx.beginPath();
    const first = this.#filteredPath[0];
    ctx.moveTo(first.point.x, first.point.y);

    let traversed = 0;

    for (let i = 1; i < this.#filteredPath.length; i++) {
      const segLen = this.#segmentLengths[i - 1] || 0;
      const prev = this.#filteredPath[i - 1];
      const curr = this.#filteredPath[i];

      if (traversed + segLen <= targetLength) {
        ctx.lineTo(curr.point.x, curr.point.y);
        traversed += segLen;
        continue;
      }

      const remain = targetLength - traversed;
      if (remain > 0) {
        const ratio = remain / segLen;
        const px = prev.point.x + (curr.point.x - prev.point.x) * ratio;
        const py = prev.point.y + (curr.point.y - prev.point.y) * ratio;
        ctx.lineTo(px, py);
      }
      break;
    }

    ctx.stroke();
  }
}
