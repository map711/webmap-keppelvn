import { Layer } from './Layer.js';

/**
 * NavMarkerLayer renders tap-able floor transition bubbles.
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
  #fullPath = [];

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
   * Set the path for transition markers.
   * @param {Object} pathResult
   */
  setPath(pathResult) {
    this.#pathResult = pathResult?.success ? pathResult : null;
    this.#fullPath = this.#pathResult?.path || [];
  }

  /**
   * Clear path state.
   */
  clear() {
    this.#pathResult = null;
    this.#fullPath = [];
    this.#hitBubbles = [];
  }

  /**
   * Set level ordinal lookup for direction arrows.
   * @param {Map<string, number>} ordinals
   */
  setLevelOrdinals(ordinals) {
    this.#levelOrdinals = ordinals;
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
   * Hit test at world coordinates.
   * @param {number} worldX
   * @param {number} worldY
   * @returns {string|null}
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
        return bubble.targetLevel;
      }
    }

    return null;
  }

  renderWithContext(renderContext) {
    const { ctx, invalidate } = renderContext;
    if (invalidate) this.#invalidate = invalidate;
    if (!this.visible || !this.#pathResult || !this.#currentLevelCode) return;
    if (this.#fullPath.length < 2) return;

    const transitions = this.#identifyTransitions();
    if (!transitions.length) return;

    const { scale, rotation } = this.#extractTransform(ctx);
    this.#lastScale = scale;
    this.#lastRotation = rotation;
    this.#hitBubbles = [];

    ctx.save();

    for (const transition of transitions) {
      const anchor = this.#resolveAnchor(transition);
      if (!anchor) continue;
      if (anchor.node.level?.code !== this.#currentLevelCode) continue;

      const worldX = anchor.node.point.x;
      const worldY = anchor.node.point.y;

      this.#renderBubble(ctx, worldX, worldY, scale, rotation, anchor.label);

      const metrics = this.#getBubbleMetrics(ctx, anchor.label);
      this.#hitBubbles.push({
        anchorX: worldX,
        anchorY: worldY,
        width: metrics.width,
        height: metrics.height + this.#geom.tailHeight,
        offsetY: metrics.offsetY,
        targetLevel: anchor.targetLevel
      });
    }

    ctx.restore();
  }

  #identifyTransitions() {
    const transitions = [];
    let currentLevel = null;

    for (let i = 0; i < this.#fullPath.length; i++) {
      const node = this.#fullPath[i];
      const level = node.level?.code;

      if (level && level !== currentLevel) {
        if (currentLevel !== null) {
          transitions.push({
            fromLevel: currentLevel,
            toLevel: level,
            nodeIndex: i
          });
        }
        currentLevel = level;
      }
    }

    return transitions;
  }

  #resolveAnchor(transition) {
    const { fromLevel, toLevel, nodeIndex } = transition;

    if (this.#currentLevelCode === fromLevel) {
      const idx = Math.max(0, nodeIndex - 1);
      const node = this.#fullPath[idx];
      const arrow = this.#getArrow(fromLevel, toLevel);
      return {
        node,
        label: `${arrow} Tap to ${toLevel}`,
        targetLevel: toLevel
      };
    }

    if (this.#currentLevelCode === toLevel) {
      const node = this.#fullPath[nodeIndex];
      const arrow = this.#getArrow(toLevel, fromLevel);
      return {
        node,
        label: `${arrow} Tap to ${fromLevel}`,
        targetLevel: fromLevel
      };
    }

    return null;
  }

  #getArrow(fromCode, toCode) {
    const fromOrd = this.#levelOrdinals.get(fromCode) ?? 0;
    const toOrd = this.#levelOrdinals.get(toCode) ?? 0;
    return toOrd > fromOrd ? '⬆' : (toOrd < fromOrd ? '⬇' : '→');
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
    if (!this.#measureCtx) {
      const canvas = document.createElement('canvas');
      this.#measureCtx = canvas.getContext('2d');
    }

    this.#measureCtx.font = `${this.#geom.fontSize}px ${this.#fontFamily}`;
    const textWidth = this.#measureCtx.measureText(label).width;
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
