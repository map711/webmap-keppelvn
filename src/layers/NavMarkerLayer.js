import { Layer } from './Layer.js';

const ARROW_UP = '⬆';
const ARROW_DOWN = '⬇';
const ARROW_FLAT = '→';

/**
 * NavMarkerLayer renders tap-able floor-transition bubbles.
 *
 * It consumes the route result's stored `transitions[]` directly — each step
 * carries its OWN flat connector coordinates (`fromX/fromY` on the departure
 * floor, `toX/toY` on the arrival floor) plus `fromLevelCode`/`toLevelCode`.
 * The bubble is drawn at the connector point of the active floor, with an
 * up/down arrow derived from the level ordinals, and is tap-able to switch to
 * the OTHER floor of the transition.
 */
export class NavMarkerLayer extends Layer {
  name = 'NavMarkerLayer';

  #bgColor = 'rgba(109, 151, 254, 0.93)';
  #borderColor = 'transparent';
  #textColor = 'white';
  #fontFamily = 'Arial, sans-serif';

  #baseGeom = {
    fontSize: 32,
    paddingX: 32,
    paddingY: 32,
    cornerRadius: 48,
    tailHeight: 52,
    tailWidth: 34,
    borderWidth: 0.75
  };

  #sizeScale = 1;
  #geom = { ...this.#baseGeom };

  #currentLevelCode = null;
  #pathResult = null;
  #transitions = [];

  #hitBubbles = [];
  #lastScale = 1;
  #lastRotation = 0;

  #levelOrdinals = new Map();

  #measureCtx = null;
  #resizeHandler = null;
  #invalidate = null;

  constructor(levelCode = null) {
    super();
    this.#currentLevelCode = levelCode;
    this.#applyResponsiveSizing();

    if (typeof window !== 'undefined') {
      this.#resizeHandler = () => {
        this.#applyResponsiveSizing();
      };
      window.addEventListener('resize', this.#resizeHandler, { passive: true });
    }
  }

  dispose() {
    if (typeof window !== 'undefined' && this.#resizeHandler) {
      window.removeEventListener('resize', this.#resizeHandler);
    }
    this.#resizeHandler = null;
    this.#measureCtx = null;
    this.#invalidate = null;
  }

  /**
   * Set the path for transition markers. Stores `routeResult.transitions`
   * verbatim — bubbles are drawn from each step's own connector coordinates,
   * never re-derived from the flattened per-floor `segments`.
   * @param {Object} pathResult
   */
  setPath(pathResult) {
    this.#pathResult = pathResult?.success ? pathResult : null;
    this.#transitions = this.#pathResult ? (this.#pathResult.transitions || []) : [];
    this.#hitBubbles = [];
  }

  /**
   * Clear path state.
   */
  clear() {
    this.#pathResult = null;
    this.#transitions = [];
    this.#hitBubbles = [];
  }

  /**
   * Set level ordinal lookup for direction arrows.
   * @param {Map<string, number>} ordinals
   */
  setLevelOrdinals(ordinals) {
    this.#levelOrdinals = ordinals instanceof Map ? ordinals : new Map(Object.entries(ordinals || {}));
  }

  setFloor(levelCode) {
    this.#currentLevelCode = levelCode;
  }

  /**
   * Update connector marker style.
   * @param {{foregroundColor?: string, backgroundColor?: string}} style
   */
  setStyle(style = {}) {
    if (!style || typeof style !== 'object') return;
    let changed = false;

    if (Object.prototype.hasOwnProperty.call(style, 'foregroundColor')) {
      const color = this.#normalizeColor(style.foregroundColor);
      const next = (color && color.toLowerCase() !== 'none') ? color : 'white';
      if (next !== this.#textColor) {
        this.#textColor = next;
        changed = true;
      }
    }

    if (Object.prototype.hasOwnProperty.call(style, 'backgroundColor')) {
      const color = this.#normalizeColor(style.backgroundColor);
      const next = color ?? 'rgba(109, 151, 254, 0.93)';
      if (next !== this.#bgColor) {
        this.#bgColor = next;
        changed = true;
      }
    }

    if (changed) {
      this.#invalidate?.();
    }
  }

  /**
   * Hit test at world coordinates. Returns a self-describing floor-transition
   * hit (`{type:'floor-transition', targetFloor}`) when the tap lands on a
   * rendered bubble; `null` otherwise. The tag lets {@link HitTestManager} tell
   * a connector bubble apart from a bare unit-id hit (a plain floor-code string
   * would be misread as a unit id and never switch the floor).
   * @param {number} worldX
   * @param {number} worldY
   * @returns {{type:'floor-transition', targetFloor:string}|null}
   */
  hitTest(worldX, worldY) {
    if (!this.visible || !this.#pathResult || !this.#currentLevelCode) return null;
    if (!this.#hitBubbles.length) return null;

    const cos = Math.cos(this.#lastRotation);
    const sin = Math.sin(this.#lastRotation);
    const scale = this.#lastScale || 1;

    for (const bubble of this.#hitBubbles) {
      const dx = worldX - bubble.anchorX;
      const dy = worldY - bubble.anchorY;

      const localX = (dx * cos - dy * sin) * scale;
      const localY = (dx * sin + dy * cos) * scale;

      const bx = -bubble.width / 2;
      const by = bubble.offsetY;

      if (localX >= bx && localX <= bx + bubble.width &&
        localY >= by && localY <= by + bubble.height) {
        return { type: 'floor-transition', targetFloor: bubble.targetLevel };
      }
    }

    return null;
  }

  renderWithContext(renderContext) {
    const { ctx, invalidate } = renderContext;
    if (invalidate) this.#invalidate = invalidate;
    if (!this.visible || !this.#pathResult || !this.#currentLevelCode) return;
    if (!this.#transitions.length) return;

    const { scale, rotation } = this.#extractTransform(ctx);
    this.#lastScale = scale;
    this.#lastRotation = rotation;
    this.#hitBubbles = [];

    ctx.save();

    for (const transition of this.#transitions) {
      const bubble = this.#bubbleForTransition(transition);
      if (!bubble) continue;

      this.#renderBubble(ctx, bubble.anchorX, bubble.anchorY, scale, rotation, bubble.label);

      const metrics = this.#getBubbleMetrics(ctx, bubble.label);
      this.#hitBubbles.push({
        anchorX: bubble.anchorX,
        anchorY: bubble.anchorY,
        width: metrics.width,
        height: metrics.height + this.#geom.tailHeight,
        offsetY: metrics.offsetY,
        targetLevel: bubble.targetLevel
      });
    }

    ctx.restore();
  }

  /**
   * Resolve the bubble to draw for a transition on the active floor, or `null`
   * when the transition does not touch the active floor.
   *
   * - Active floor is the DEPARTURE floor (`fromLevelCode`): anchor at
   *   `(fromX, fromY)`, arrow from `fromLevelCode`→`toLevelCode`, tap target
   *   `toLevelCode`.
   * - Active floor is the ARRIVAL floor (`toLevelCode`): anchor at
   *   `(toX, toY)`, arrow from `toLevelCode`→`fromLevelCode`, tap target
   *   `fromLevelCode`.
   *
   * @param {Object} transition
   * @returns {{anchorX:number, anchorY:number, label:string, targetLevel:string}|null}
   */
  #bubbleForTransition(transition) {
    const fromLevel = transition.fromLevelCode;
    const toLevel = transition.toLevelCode;

    if (this.#currentLevelCode === fromLevel) {
      const from = this.#fromPoint(transition);
      if (!from) return null;
      const arrow = this.#getArrow(fromLevel, toLevel);
      return {
        anchorX: from.x,
        anchorY: from.y,
        label: `${arrow} Tap to ${toLevel}`,
        targetLevel: toLevel
      };
    }

    if (this.#currentLevelCode === toLevel) {
      const to = this.#toPoint(transition);
      if (!to) return null;
      const arrow = this.#getArrow(toLevel, fromLevel);
      return {
        anchorX: to.x,
        anchorY: to.y,
        label: `${arrow} Tap to ${fromLevel}`,
        targetLevel: fromLevel
      };
    }

    return null;
  }

  /**
   * The departure-floor connector point. Reads the flat `fromX/fromY` contract
   * first, tolerating a nested `from.{x,y}` spelling for robustness.
   */
  #fromPoint(transition) {
    if (typeof transition.fromX === 'number' && typeof transition.fromY === 'number') {
      return { x: transition.fromX, y: transition.fromY };
    }
    const f = transition.from;
    if (f && typeof f.x === 'number' && typeof f.y === 'number') return { x: f.x, y: f.y };
    return null;
  }

  /**
   * The arrival-floor connector point. Reads the flat `toX/toY` contract first,
   * tolerating a nested `to.{x,y}` spelling for robustness.
   */
  #toPoint(transition) {
    if (typeof transition.toX === 'number' && typeof transition.toY === 'number') {
      return { x: transition.toX, y: transition.toY };
    }
    const t = transition.to;
    if (t && typeof t.x === 'number' && typeof t.y === 'number') return { x: t.x, y: t.y };
    return null;
  }

  /**
   * Up/down/flat arrow derived from the level ordinals: travelling toward a
   * higher ordinal is UP, lower is DOWN.
   */
  #getArrow(fromCode, toCode) {
    const fromOrd = this.#levelOrdinals.get(fromCode) ?? 0;
    const toOrd = this.#levelOrdinals.get(toCode) ?? 0;
    if (toOrd > fromOrd) return ARROW_UP;
    if (toOrd < fromOrd) return ARROW_DOWN;
    return ARROW_FLAT;
  }

  #extractTransform(ctx) {
    const t = ctx.getTransform?.() || { a: 1, b: 0 };
    return {
      scale: Math.hypot(t.a, t.b) || 1,
      rotation: Math.atan2(t.b, t.a)
    };
  }

  #renderBubble(ctx, worldX, worldY, scale, rotation, label) {
    this.withScreenSpaceTransform(ctx, worldX, worldY, scale, rotation, () => {
      const metrics = this.#getBubbleMetrics(ctx, label);

      this.#drawBubblePath(ctx, -metrics.width / 2, metrics.offsetY, metrics.width, metrics.height);

      ctx.fillStyle = this.#bgColor;
      ctx.strokeStyle = this.#borderColor;
      ctx.lineWidth = this.#geom.borderWidth;
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = this.#textColor;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `${this.#geom.fontSize}px ${this.#fontFamily}`;
      ctx.fillText(label, 0, metrics.offsetY + metrics.height / 2);
    });
  }

  #getBubbleMetrics(ctx, label) {
    if (!this.#measureCtx && typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      this.#measureCtx = canvas.getContext('2d');
    }

    let textWidth = label.length * this.#geom.fontSize * 0.6;
    if (this.#measureCtx) {
      this.#measureCtx.font = `${this.#geom.fontSize}px ${this.#fontFamily}`;
      textWidth = this.#measureCtx.measureText(label).width;
    }
    const textHeight = this.#geom.fontSize * 1.2;

    const width = textWidth + this.#geom.paddingX * 2;
    const height = textHeight + this.#geom.paddingY * 2;
    const offsetY = -(height + this.#geom.tailHeight);

    return { width, height, offsetY };
  }

  #drawBubblePath(ctx, x, y, w, h) {
    const r = this.#geom.cornerRadius;
    const tailH = this.#geom.tailHeight;
    const tailW = this.#geom.tailWidth;
    const tailTopY = y + h;
    const tailBottomY = tailTopY + tailH;

    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(tailW / 2, tailTopY);
    ctx.lineTo(0, tailBottomY);
    ctx.lineTo(-tailW / 2, tailTopY);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  #applyResponsiveSizing() {
    if (typeof window === 'undefined') return;

    const dpr = window.devicePixelRatio || 1;
    const shortest = Math.min(window.innerWidth, window.innerHeight);

    let scale;
    if (shortest <= 430) scale = 1.5;
    else if (shortest <= 520) scale = 1.35;
    else if (shortest <= 680) scale = 1.25;
    else if (shortest <= 820) scale = 1.15;
    else scale = 1.0;

    if (dpr >= 3) scale += 0.15;
    else if (dpr >= 2.5) scale += 0.1;
    else if (dpr >= 2) scale += 0.05;

    scale = Math.max(0.95, Math.min(1.8, scale));

    if (Math.abs(scale - this.#sizeScale) < 0.01) return;
    this.#sizeScale = scale;

    const b = this.#baseGeom;
    this.#geom = {
      fontSize: b.fontSize * scale * 0.8,
      paddingX: b.paddingX * scale,
      paddingY: b.paddingY * scale,
      cornerRadius: b.cornerRadius * scale,
      tailHeight: b.tailHeight * scale,
      tailWidth: b.tailWidth * scale,
      borderWidth: b.borderWidth * Math.min(scale, 1.3)
    };
  }

  #normalizeColor(value) {
    if (typeof value !== 'string') return null;
    const color = value.trim();
    return color || null;
  }
}
