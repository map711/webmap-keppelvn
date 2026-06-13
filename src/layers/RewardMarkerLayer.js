import { Layer } from './Layer.js';
import { ICON_SEAL_PERCENT } from '../assets/icons.js';

const DEFAULT_PILL_BG = 'rgba(212, 160, 23, 0.95)';
const DEFAULT_PILL_BORDER = 'transparent';
const DEFAULT_PILL_TEXT = '#ffffff';

/**
 * RewardMarkerLayer — a screen-space "gold seal + caption pill" marker drawn at
 * each matched reward-shop on the active floor.
 *
 * Modeled on {@link PinMarkerLayer} (screen-space counter-scaled draw + a shared
 * icon cache for the seal) and {@link NavMarkerLayer} (self-describing `hitTest`
 * + per-render hit bookkeeping). The selection it renders is the output of
 * `rewardRouteMatch()` — one entry per qualifying shop:
 *
 *   { shopId, levelCode, rewards:[{id,title,...}], location:{ displayNodes:[...] } }
 *
 * Only entries with a display node on the ACTIVE floor draw, anchored at that
 * node's projected display point. The caption is the primary reward's `title`
 * (truncated to {@link RewardMarkerLayer.MAX_PILL_LENGTH}) for a single reward,
 * or the aggregate `"<n> offers"` for two or more.
 */
export class RewardMarkerLayer extends Layer {
  name = 'RewardMarkerLayer';

  /** Maximum drawn caption length (chars), including a trailing ellipsis. */
  static MAX_PILL_LENGTH = 24;

  #fontFamily = 'Arial, sans-serif';
  #pillBg = DEFAULT_PILL_BG;
  #pillBorder = DEFAULT_PILL_BORDER;
  #pillText = DEFAULT_PILL_TEXT;

  #baseGeom = {
    sealSize: 48,
    fontSize: 28,
    paddingX: 24,
    paddingY: 18,
    cornerRadius: 24,
    pillGap: 10,
    sealTextGap: 12,
    tailHeight: 22,
    tailWidth: 28,
    borderWidth: 0.75
  };

  #sizeScale = 1;
  #geom = { ...this.#baseGeom };

  #currentLevelCode = null;
  /** @type {Array} the rewardRouteMatch() selection */
  #selection = [];

  /** @type {Array} per-render hit bookkeeping (anchor + box + payload) */
  #hitMarkers = [];
  #lastScale = 1;
  #lastRotation = 0;

  static #iconCache = new Map();

  #sealIconSrc = ICON_SEAL_PERCENT;
  #sealIcon = null;
  #measureCtx = null;
  #resizeHandler = null;
  #invalidate = null;

  constructor(levelCode = null) {
    super();
    this.#currentLevelCode = levelCode;
    this.#applyResponsiveSizing();
    this.#sealIcon = this.#getCachedIcon(this.#sealIconSrc);

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
   * Set the reward-shop selection to render (the `rewardRouteMatch()` output).
   * @param {Array<{shopId:(number|string), levelCode:string, rewards:Array, location:Object}>} selection
   */
  setSelection(selection) {
    this.#selection = Array.isArray(selection) ? selection : [];
    this.#hitMarkers = [];
    this.#invalidate?.();
  }

  /**
   * Clear the selection (no markers draw).
   */
  clear() {
    this.#selection = [];
    this.#hitMarkers = [];
    this.#invalidate?.();
  }

  setFloor(levelCode) {
    this.#currentLevelCode = levelCode;
  }

  /**
   * Hit test at world coordinates. Returns a self-describing reward hit
   * (`{type:'reward', shopId, rewards, location}`) when the tap lands on a
   * rendered seal/pill; `null` otherwise. The tag lets {@link HitTestManager}
   * tell a reward marker apart from a bare unit-id hit.
   * @param {number} worldX
   * @param {number} worldY
   * @returns {{type:'reward', shopId:(number|string), rewards:Array, location:Object}|null}
   */
  hitTest(worldX, worldY) {
    if (!this.visible || !this.#hitMarkers.length) return null;

    const cos = Math.cos(this.#lastRotation);
    const sin = Math.sin(this.#lastRotation);
    const scale = this.#lastScale || 1;

    for (const marker of this.#hitMarkers) {
      const dx = worldX - marker.anchorX;
      const dy = worldY - marker.anchorY;

      const localX = (dx * cos - dy * sin) * scale;
      const localY = (dx * sin + dy * cos) * scale;

      if (localX >= marker.boxX && localX <= marker.boxX + marker.boxW &&
        localY >= marker.boxY && localY <= marker.boxY + marker.boxH) {
        return {
          type: 'reward',
          shopId: marker.shopId,
          rewards: marker.rewards,
          location: marker.location
        };
      }
    }

    return null;
  }

  renderWithContext(renderContext) {
    const { ctx, invalidate } = renderContext;
    if (invalidate) this.#invalidate = invalidate;
    this.#hitMarkers = [];
    if (!this.visible) return;
    if (!this.#selection.length) return;

    const { scale, rotation } = this.#extractTransform(ctx);
    this.#lastScale = scale;
    this.#lastRotation = rotation;

    ctx.save();

    for (const entry of this.#selection) {
      const node = this.#nodeOnActiveFloor(entry);
      if (!node) continue;

      const point = this.#pointOf(node);
      if (!point) continue;

      const caption = this.#captionFor(entry);
      this.#renderMarker(ctx, point.x, point.y, scale, rotation, caption, entry);
    }

    ctx.restore();
  }

  /**
   * The display node of a selection entry that sits on the ACTIVE floor, or
   * `null` when the entry has no placement on the active floor.
   * @param {Object} entry
   * @returns {Object|null}
   */
  #nodeOnActiveFloor(entry) {
    const nodes = entry?.location?.displayNodes;
    if (!Array.isArray(nodes) || nodes.length === 0) {
      // No display nodes: fall back to the entry's own levelCode only when it
      // matches the active floor (the entry still needs a point to draw).
      return null;
    }
    return nodes.find((n) => n?.levelCode === this.#currentLevelCode) ?? null;
  }

  /**
   * The world `{x,y}` of a display node, tolerating a `Point` (`.x/.y`) or an
   * `[x,y]` tuple.
   * @param {Object} node
   * @returns {{x:number,y:number}|null}
   */
  #pointOf(node) {
    const p = node?.point;
    if (!p) return null;
    if (Array.isArray(p)) {
      if (typeof p[0] !== 'number' || typeof p[1] !== 'number') return null;
      return { x: p[0], y: p[1] };
    }
    if (typeof p.x !== 'number' || typeof p.y !== 'number') return null;
    return { x: p.x, y: p.y };
  }

  /**
   * The pill caption for a selection entry: the primary reward's `title`
   * (truncated to {@link RewardMarkerLayer.MAX_PILL_LENGTH}) when the shop has a
   * single active reward, or `"<n> offers"` when it has n>=2.
   * @param {Object} entry
   * @returns {string}
   */
  #captionFor(entry) {
    const rewards = Array.isArray(entry?.rewards) ? entry.rewards : [];
    const n = rewards.length;
    if (n >= 2) return `${n} offers`;
    const title = rewards[0]?.title ?? rewards[0]?.name ?? '';
    return this.#truncate(String(title));
  }

  /**
   * Truncate to a bounded prefix of the original, appending an ellipsis only
   * when characters were dropped. A short title is returned verbatim.
   * @param {string} text
   * @returns {string}
   */
  #truncate(text) {
    const max = RewardMarkerLayer.MAX_PILL_LENGTH;
    if (text.length <= max) return text;
    const ellipsis = '…';
    return text.slice(0, max - ellipsis.length).trimEnd() + ellipsis;
  }

  #extractTransform(ctx) {
    const t = ctx.getTransform?.() || { a: 1, b: 0 };
    return {
      scale: Math.hypot(t.a, t.b) || 1,
      rotation: Math.atan2(t.b, t.a)
    };
  }

  #renderMarker(ctx, worldX, worldY, scale, rotation, caption, entry) {
    const sealSize = this.#geom.sealSize;
    const textWidth = this.#measureCaption(ctx, caption);

    // Inline content (one row): [seal][gap][text]. The bubble wraps the row with
    // symmetric padding, sized to the taller of the seal / text line.
    const contentWidth = sealSize + this.#geom.sealTextGap + textWidth;
    const lineHeight = Math.max(sealSize, this.#geom.fontSize * 1.2);
    const bubbleW = contentWidth + this.#geom.paddingX * 2;
    const bubbleH = lineHeight + this.#geom.paddingY * 2;

    // The WHOLE bubble sits ABOVE the display point: its bottom edge plus a
    // downward tail meet the anchor (0,0). So the bubble body is offset up by
    // (bubbleH + tailHeight); the tail tip lands at y≈0 (the shop label clears).
    const bubbleX = -bubbleW / 2;
    const bubbleY = -(bubbleH + this.#geom.tailHeight);

    // Inline layout inside the bubble (left-aligned content row).
    const contentLeft = bubbleX + this.#geom.paddingX;
    const rowCenterY = bubbleY + bubbleH / 2;
    // Seal: vertically centered on the row, hugging the left.
    const sealX = contentLeft;
    const sealY = rowCenterY - sealSize / 2;
    // Caption: drawn just RIGHT of the seal (seal-before-label inline), its
    // baseline on the row center so seal and text share one vertical band.
    const captionX = contentLeft + sealSize + this.#geom.sealTextGap;
    const captionY = rowCenterY;

    this.withScreenSpaceTransform(ctx, worldX, worldY, scale, rotation, () => {
      // Speech bubble with a downward tail to the display point.
      this.#drawBubblePath(ctx, bubbleX, bubbleY, bubbleW, bubbleH);
      ctx.fillStyle = this.#pillBg;
      ctx.strokeStyle = this.#pillBorder;
      ctx.lineWidth = this.#geom.borderWidth;
      ctx.fill();
      ctx.stroke();

      // Gold seal icon, inline at the LEFT of the row.
      this.#drawSeal(ctx, sealX, sealY, sealSize);

      // Caption text to the RIGHT of the seal.
      ctx.fillStyle = this.#pillText;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = `${this.#geom.fontSize}px ${this.#fontFamily}`;
      ctx.fillText(caption, captionX, captionY);
    });

    // Hit box: the bubble body PLUS the tail down to the display point, so a tap
    // at the anchor (0,0) — where the offset bubble's tail tip lands — still hits.
    const boxX = bubbleX;
    const boxY = bubbleY;
    const boxW = bubbleW;
    const boxH = -bubbleY; // from the bubble top down to y = 0 (the tail tip)
    this.#hitMarkers.push({
      anchorX: worldX,
      anchorY: worldY,
      boxX,
      boxY,
      boxW,
      boxH,
      shopId: entry?.shopId,
      rewards: Array.isArray(entry?.rewards) ? entry.rewards : [],
      location: entry?.location ?? null
    });
  }

  #drawSeal(ctx, x, y, size) {
    const icon = this.#getCachedIcon(this.#sealIconSrc);
    if (!icon?.complete) return;
    ctx.drawImage(icon, x, y, size, size);
  }

  #measureCaption(ctx, caption) {
    let textWidth = caption.length * this.#geom.fontSize * 0.6;
    if (typeof ctx?.measureText === 'function') {
      ctx.save();
      ctx.font = `${this.#geom.fontSize}px ${this.#fontFamily}`;
      const measured = ctx.measureText(caption)?.width;
      if (typeof measured === 'number' && Number.isFinite(measured)) textWidth = measured;
      ctx.restore();
    }
    return textWidth;
  }

  /**
   * A rounded speech bubble with a downward tail (modeled on
   * {@link PinMarkerLayer}'s bubble): the tail tip lands at the local origin
   * (0,0) — the shop's display point — while the body is offset above it.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x bubble top-left x
   * @param {number} y bubble top-left y (negative — above the anchor)
   * @param {number} w bubble width
   * @param {number} h bubble height
   */
  #drawBubblePath(ctx, x, y, w, h) {
    const r = Math.min(this.#geom.cornerRadius, h / 2, w / 2);
    const tailH = this.#geom.tailHeight;
    const tailW = this.#geom.tailWidth;
    const tailTopY = y + h;
    const tailBottomY = tailTopY + tailH; // == 0 (the display point)

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

  #getCachedIcon(src) {
    if (!src || typeof Image === 'undefined') return null;

    const cached = RewardMarkerLayer.#iconCache.get(src);
    if (cached) return cached;

    const img = new Image();
    img.src = src;
    img.onload = () => {
      this.#invalidate?.();
    };
    RewardMarkerLayer.#iconCache.set(src, img);
    return img;
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
      sealSize: b.sealSize * scale,
      fontSize: b.fontSize * scale * 0.8,
      paddingX: b.paddingX * scale,
      paddingY: b.paddingY * scale,
      cornerRadius: b.cornerRadius * scale,
      pillGap: b.pillGap * scale,
      sealTextGap: b.sealTextGap * scale,
      tailHeight: b.tailHeight * scale,
      tailWidth: b.tailWidth * scale,
      borderWidth: b.borderWidth * Math.min(scale, 1.3)
    };
  }
}
