import { Layer } from './Layer.js';
import { ICON_STAND, ICON_WALK } from '../assets/icons.js';

const DATA_IMAGE_ICON_PATTERN = /^data:image\//i;
const HTTP_ICON_PATTERN = /^https?:\/\//i;
const URL_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;
const DEFAULT_START_BACKGROUND = 'rgba(0,0,0,0.7)';
const DEFAULT_END_BACKGROUND = 'rgba(0,0,0,0.7)';
const DEFAULT_START_FOREGROUND = '#ffffff';
const DEFAULT_END_FOREGROUND = '#ffffff';

/**
 * PinMarkerLayer renders start/end speech bubble markers.
 */
export class PinMarkerLayer extends Layer {
  name = 'PinMarkerLayer';

  #fontFamily = 'Arial, sans-serif';
  #startBg = DEFAULT_START_BACKGROUND;
  #startBorder = '#000000';
  #endBg = DEFAULT_END_BACKGROUND;
  #endBorder = '#000000';
  #startFg = DEFAULT_START_FOREGROUND;
  #startFgMode = 'tint';
  #endFg = DEFAULT_END_FOREGROUND;

  #baseGeom = {
    startSize: 64,
    endFontSize: 32,
    paddingX: 32,
    paddingY: 32,
    cornerRadius: 32,
    tailHeight: 26,
    tailWidth: 34,
    borderWidth: 0.75
  };

  #sizeScale = 1;
  #geom = { ...this.#baseGeom };

  #currentLevelCode = null;
  #pathResult = null;
  #startLocation = null;
  #endLocation = null;
  #startNode = null;
  #endNode = null;
  #manualEndLocation = null;
  #youAreHereNode = null;
  #youAreHereVisible = true;
  #invalidate = null;

  static #iconCache = new Map();
  static #tintedIconCache = new Map();

  #walkIconSrc = ICON_WALK;
  #standIconSrc = ICON_STAND;
  #walkIcon = null;
  #standIcon = null;
  #resizeHandler = null;

  constructor(levelCode = null) {
    super();
    this.#currentLevelCode = levelCode;
    this.#applyResponsiveSizing();
    this.setIconSources({
      iconWalk: this.#walkIconSrc,
      iconStand: this.#standIconSrc
    });

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
    this.#invalidate = null;
  }

  /**
   * Set path result for marker placement.
   * @param {Object} pathResult
   */
  setPath(pathResult) {
    const ok = pathResult?.success;
    this.#pathResult = ok ? pathResult : null;
    this.#startLocation = ok ? (pathResult.startLocation ?? null) : null;
    this.#endLocation = ok ? (pathResult.endLocation ?? null) : null;
    // Build start/end marker nodes from the snapped anchors of the navmesh
    // result (`{levelCode, x, y}`), in the `{point, level}` shape the marker
    // renderer/resolver consume.
    this.#startNode = ok ? PinMarkerLayer.nodeFromAnchor(pathResult.startAnchor) : null;
    this.#endNode = ok ? PinMarkerLayer.nodeFromAnchor(pathResult.endAnchor) : null;
    this.#manualEndLocation = null;
  }

  /**
   * Convert a route anchor (`{levelCode, x, y}`) into a `{point, level}` marker
   * node, or `null` when the anchor is absent.
   * @param {{levelCode:string, x:number, y:number}|null|undefined} anchor
   * @returns {{point:{x:number,y:number}, level:{code:string}}|null}
   */
  static nodeFromAnchor(anchor) {
    if (!anchor || typeof anchor.x !== 'number' || typeof anchor.y !== 'number') return null;
    return { point: { x: anchor.x, y: anchor.y }, level: { code: anchor.levelCode } };
  }

  /**
   * Clear markers.
   */
  clear() {
    this.#pathResult = null;
    this.#startLocation = null;
    this.#endLocation = null;
    this.#startNode = null;
    this.#endNode = null;
    this.#manualEndLocation = null;
  }

  /**
   * Set end location manually (without a route).
   * Used for single-location focus pins.
   * @param {Object} location
   */
  setManualEndLocation(location) {
    this.#pathResult = null;
    this.#startLocation = null;
    this.#endLocation = location || null;
    this.#manualEndLocation = location || null;
  }

  /**
   * Set "You are here" marker node.
   * @param {Object|null} node
   */
  setYouAreHereNode(node) {
    this.#youAreHereNode = node || null;
  }

  /**
   * Toggle "You are here" marker visibility.
   * @param {boolean} visible
   */
  setYouAreHereVisible(visible) {
    this.#youAreHereVisible = Boolean(visible);
  }

  /**
   * Set the walking icon source.
   * @param {string} src
   */
  setWalkIconSrc(src) {
    this.setIconSources({ iconWalk: src });
  }

  /**
   * Set the stand icon source.
   * @param {string} src
   */
  setStandIconSrc(src) {
    this.setIconSources({ iconStand: src });
  }

  /**
   * Set marker icon sources.
   * @param {{iconWalk?: string, iconStand?: string}} icons
   */
  setIconSources(icons = {}) {
    const hasWalk = Object.prototype.hasOwnProperty.call(icons, 'iconWalk');
    const hasStand = Object.prototype.hasOwnProperty.call(icons, 'iconStand');
    if (!hasWalk && !hasStand) return;

    if (hasWalk) {
      this.#walkIconSrc = this.#resolveIconSrc(icons.iconWalk, ICON_WALK, 'iconWalk');
    }
    if (hasStand) {
      this.#standIconSrc = this.#resolveIconSrc(icons.iconStand, ICON_STAND, 'iconStand');
    }

    this.#walkIcon = this.#getCachedIcon(this.#walkIconSrc);
    this.#standIcon = this.#getCachedIcon(this.#standIconSrc);
    this.#invalidate?.();
  }

  /**
   * Set pin marker style overrides.
   * @param {{
   *   startForegroundColor?: string,
   *   startForegroundMode?: 'tint'|'original',
   *   startBackgroundColor?: string,
   *   endForegroundColor?: string,
   *   endBackgroundColor?: string
   * }} style
   */
  setStyle(style = {}) {
    if (!style || typeof style !== 'object') return;

    let changed = false;
    if (Object.prototype.hasOwnProperty.call(style, 'startForegroundColor')) {
      const color = this.#normalizeColor(style.startForegroundColor);
      const next = (color && color.toLowerCase() !== 'none') ? color : DEFAULT_START_FOREGROUND;
      if (next !== this.#startFg) {
        this.#startFg = next;
        changed = true;
      }
    }

    if (Object.prototype.hasOwnProperty.call(style, 'startForegroundMode')) {
      const next = style.startForegroundMode === 'original' ? 'original' : 'tint';
      if (next !== this.#startFgMode) {
        this.#startFgMode = next;
        changed = true;
      }
    }

    if (Object.prototype.hasOwnProperty.call(style, 'startBackgroundColor')) {
      const color = this.#normalizeColor(style.startBackgroundColor);
      const next = color ?? DEFAULT_START_BACKGROUND;
      if (next !== this.#startBg) {
        this.#startBg = next;
        changed = true;
      }
    }

    if (Object.prototype.hasOwnProperty.call(style, 'endForegroundColor')) {
      const color = this.#normalizeColor(style.endForegroundColor);
      const next = (color && color.toLowerCase() !== 'none') ? color : DEFAULT_END_FOREGROUND;
      if (next !== this.#endFg) {
        this.#endFg = next;
        changed = true;
      }
    }

    if (Object.prototype.hasOwnProperty.call(style, 'endBackgroundColor')) {
      const color = this.#normalizeColor(style.endBackgroundColor);
      const next = color ?? DEFAULT_END_BACKGROUND;
      if (next !== this.#endBg) {
        this.#endBg = next;
        changed = true;
      }
    }

    if (changed) {
      this.#invalidate?.();
    }
  }

  setFloor(levelCode) {
    this.#currentLevelCode = levelCode;
  }

  renderWithContext(renderContext) {
    const { ctx, invalidate } = renderContext;
    if (invalidate) this.#invalidate = invalidate;
    if (!this.visible) return;

    const hasRouteOrFocus = Boolean(this.#pathResult || this.#manualEndLocation);
    const startNode = this.#resolveNode(this.#startNode, this.#startLocation);
    const endNode = this.#resolveNode(this.#endNode, this.#endLocation);
    const youAreHereNode = this.#resolveYouAreHereNode();

    if (!hasRouteOrFocus && !youAreHereNode) return;
    if (!startNode && !endNode && !youAreHereNode) return;

    const { scale, rotation } = this.#extractTransform(ctx);

    ctx.save();

    if (startNode) {
      this.#renderStartMarker(ctx, startNode, scale, rotation);
    }
    if (endNode) {
      this.#renderEndMarker(ctx, endNode, scale, rotation);
    }
    if (youAreHereNode) {
      this.#renderYouAreHereMarker(ctx, youAreHereNode, scale, rotation);
    }

    ctx.restore();
  }

  #resolveNode(explicitNode, location) {
    // The pin marks the SHOP, so prefer the Location's display anchor (the unit
    // centroid / label_point) over the route's snapped DOOR anchor. The route
    // polyline still terminates at the door — only the marker sits on the unit.
    // The route anchor is a fallback for routes that omit Location metadata.
    if (location) {
      // Legacy navigation nodes expose `level.code`.
      const legacy = location.nodes?.find?.((n) => n.level?.code === this.#currentLevelCode);
      if (legacy) return legacy;
      // Bundle-built catalog Locations carry an empty `nodes` array and populate
      // `displayNodes` instead; DisplayNodes expose `levelCode` (not `level.code`).
      const display = location.displayNodes?.find?.((n) => n.levelCode === this.#currentLevelCode);
      if (display) return display;
    }
    if (explicitNode?.level?.code === this.#currentLevelCode) {
      return explicitNode;
    }
    // Nothing resolves to the active floor -> draw nothing. The pin must never
    // appear on a floor the shop/anchor doesn't occupy (the "pin shows on the
    // wrong level after switching floors" bug). Cross-floor focus switches the
    // floor FIRST, so by render time the active floor matches a display node.
    return null;
  }

  #extractTransform(ctx) {
    const t = ctx.getTransform?.() || { a: 1, b: 0 };
    return {
      scale: Math.hypot(t.a, t.b) || 1,
      rotation: Math.atan2(t.b, t.a)
    };
  }

  #resolveYouAreHereNode() {
    if (!this.#youAreHereVisible) return null;
    if (!this.#youAreHereNode) return null;
    if (this.#youAreHereNode.level?.code !== this.#currentLevelCode) return null;
    return this.#youAreHereNode;
  }

  #renderStartMarker(ctx, node, scale, rotation) {
    const worldX = node.point.x;
    const worldY = node.point.y;

    const iconSize = this.#geom.startSize;
    const paddingX = iconSize * 0.5;
    const paddingY = iconSize * 0.5;
    const bubbleWidth = iconSize + paddingX * 2;
    const bubbleHeight = iconSize + paddingY * 2;
    const offsetY = -(bubbleHeight + this.#geom.tailHeight);

    this.withScreenSpaceTransform(ctx, worldX, worldY, scale, rotation, () => {
      this.#drawBubblePath(ctx, -bubbleWidth / 2, offsetY, bubbleWidth, bubbleHeight);
      this.#fillAndStroke(ctx, this.#startBg, this.#startBorder);
      this.#drawWalkIcon(ctx, iconSize, offsetY, paddingY);
    });
  }

  #renderYouAreHereMarker(ctx, node, scale, rotation) {
    const worldX = node.point.x;
    const worldY = node.point.y;

    const iconSize = this.#geom.startSize;
    const paddingX = iconSize * 0.5;
    const paddingY = iconSize * 0.5;
    const bubbleWidth = iconSize + paddingX * 2;
    const bubbleHeight = iconSize + paddingY * 2;
    const offsetY = -(bubbleHeight + this.#geom.tailHeight);

    this.withScreenSpaceTransform(ctx, worldX, worldY, scale, rotation, () => {
      this.#drawBubblePath(ctx, -bubbleWidth / 2, offsetY, bubbleWidth, bubbleHeight);
      this.#fillAndStroke(ctx, this.#startBg, this.#startBorder);
      this.#drawStandIcon(ctx, iconSize, offsetY, paddingY);
    });
  }

  #renderEndMarker(ctx, node, scale, rotation) {
    const worldX = node.point.x;
    const worldY = node.point.y;
    // Render gates purely on `node` matching the active floor (resolved in
    // renderWithContext). The end Location is optional metadata for the caption
    // only — a route result carries the destination anchor but may omit the
    // Location, so source the label defensively and still draw the pin.
    const label = this.#endLocation?.title
      || this.#endLocation?.label
      || this.#pathResult?.endName
      || 'Destination';

    const textWidth = this.#measureText(ctx, label);
    const textHeight = this.#geom.endFontSize * 1.2;
    const bubbleWidth = textWidth + this.#geom.paddingX * 2;
    const bubbleHeight = textHeight + this.#geom.paddingY * 2;
    const offsetY = -(bubbleHeight + this.#geom.tailHeight);

    this.withScreenSpaceTransform(ctx, worldX, worldY, scale, rotation, () => {
      this.#drawBubblePath(ctx, -bubbleWidth / 2, offsetY, bubbleWidth, bubbleHeight);
      this.#fillAndStroke(ctx, this.#endBg, this.#endBorder);

      ctx.fillStyle = this.#endFg;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `${this.#geom.endFontSize}px ${this.#fontFamily}`;
      ctx.fillText(label, 0, offsetY + bubbleHeight / 2);
    });
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

  #fillAndStroke(ctx, fill, stroke) {
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = this.#geom.borderWidth;
    ctx.fill();
    ctx.stroke();
  }

  #drawWalkIcon(ctx, size, offsetY, padding) {
    const icon = this.#getStartIcon(this.#walkIconSrc, this.#walkIcon);
    if (!icon?.complete) return;

    ctx.drawImage(icon, -size / 2, offsetY + padding, size, size);
  }

  #drawStandIcon(ctx, size, offsetY, padding) {
    const icon = this.#getStartIcon(this.#standIconSrc, this.#standIcon);
    if (!icon?.complete) return;

    ctx.drawImage(icon, -size / 2, offsetY + padding, size, size);
  }

  #getStartIcon(src, fallbackIcon) {
    if (this.#startFgMode === 'original') {
      return fallbackIcon;
    }

    const tinted = this.#getTintedIcon(src, this.#startFg);
    return tinted?.complete ? tinted : fallbackIcon;
  }

  #measureText(ctx, text) {
    ctx.save();
    ctx.font = `${this.#geom.endFontSize}px ${this.#fontFamily}`;
    const width = ctx.measureText(text).width;
    ctx.restore();
    return width;
  }

  #getCachedIcon(src) {
    if (!src || typeof Image === 'undefined') return null;

    const cached = PinMarkerLayer.#iconCache.get(src);
    if (cached) return cached;

    const img = new Image();
    img.src = src;
    img.onload = () => {
      this.#invalidate?.();
    };
    PinMarkerLayer.#iconCache.set(src, img);
    return img;
  }

  #getTintedIcon(src, color) {
    if (!src || !color || typeof Image === 'undefined' || typeof document === 'undefined') {
      return null;
    }

    const key = `${src}|${color}`;
    const cached = PinMarkerLayer.#tintedIconCache.get(key);
    if (cached) return cached;

    const baseIcon = this.#getCachedIcon(src);
    if (!baseIcon?.complete) return null;

    const width = baseIcon.naturalWidth || baseIcon.width;
    const height = baseIcon.naturalHeight || baseIcon.height;
    if (!width || !height) return null;

    try {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(baseIcon, 0, 0, width, height);
      ctx.globalCompositeOperation = 'source-in';
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, width, height);

      const tinted = new Image();
      tinted.src = canvas.toDataURL();
      tinted.onload = () => this.#invalidate?.();
      PinMarkerLayer.#tintedIconCache.set(key, tinted);
      return tinted;
    } catch {
      return null;
    }
  }

  #resolveIconSrc(src, fallback, label) {
    if (typeof src !== 'string' || !src.trim()) return fallback;
    const value = src.trim();
    if (PinMarkerLayer.#isAllowedIconSrc(value)) return value;
    console.warn(`PinMarkerLayer: "${label}" must be a data:image URI, http(s) URL, or local/relative path, using default icon`);
    return fallback;
  }

  static #isAllowedIconSrc(src) {
    if (DATA_IMAGE_ICON_PATTERN.test(src) || HTTP_ICON_PATTERN.test(src)) {
      return true;
    }

    if (src.startsWith('//')) return false;
    return !URL_SCHEME_PATTERN.test(src);
  }

  #normalizeColor(value) {
    if (typeof value !== 'string') return null;
    const color = value.trim();
    return color || null;
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
      startSize: b.startSize * scale,
      endFontSize: b.endFontSize * scale * 0.8,
      paddingX: b.paddingX * scale,
      paddingY: b.paddingY * scale,
      cornerRadius: b.cornerRadius * scale,
      tailHeight: b.tailHeight * scale,
      tailWidth: b.tailWidth * scale,
      borderWidth: b.borderWidth * Math.min(scale, 1.3)
    };
  }
}
