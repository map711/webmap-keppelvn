import { Layer } from './Layer.js';
import { computeVisibleRects } from '../renderer/RectVisibility.js';
import { _fitScale } from './labelFit.js';

/**
 * LocationLayer — draws the labels for LABELABLE units on the active level.
 *
 * A label is emitted only for a labelable placement (a tenant-kind unit carrying
 * a tenancy; see {@link DisplayNode#labelable}) while the layer is visible
 * (`labelsVisible`). Each placement is anchored at its pre-resolved `label_point`
 * with its `label_rotation` (already converted degrees → radians by the catalog —
 * NO polylabel/OBB recompute here), shrunk to the unit's extents via
 * {@link _fitScale} (clamped at 1), and thinned by screen-rect overlap
 * suppression through the shared {@link computeVisibleRects} (RectVisibility/rbush)
 * path: when two label boxes overlap, the lower-priority (later) one is dropped.
 *
 * Reads `Location.displayNodes` filtered by active level; the public Layer seam
 * (`renderWithContext`/`setFloor`/`dispose`, `visible`) is preserved.
 */
export class LocationLayer extends Layer {
  name = 'LocationLayer';

  #style = {
    fontSize: 12,
    fontFamily: 'Arial, sans-serif',
    textColor: '#111111',
    backgroundColor: 'rgba(255, 255, 255, 0.65)',
    borderColor: 'transparent',
    borderWidth: 1,
    padding: 2,
    borderRadius: 3,
    lineHeight: 1.2
  };

  #locationStore = null;
  #levelCode = null;

  /** @type {Set<string|number>} ids of the labels drawn on the last render */
  #visibleLabels = new Set();

  /**
   * @param {import('../data/LocationModel.js').LocationStore} [locationStore]
   * @param {string} [levelCode]
   */
  constructor(locationStore = null, levelCode = null) {
    super();
    this.#locationStore = locationStore;
    if (levelCode) this.setFloor(levelCode);
  }

  /**
   * Set the catalog store.
   * @param {import('../data/LocationModel.js').LocationStore} store
   */
  setLocationStore(store) {
    this.#locationStore = store;
  }

  /**
   * Make `levelCode` the active level whose labels are drawn.
   * @param {string} levelCode
   */
  setFloor(levelCode) {
    this.#levelCode = levelCode ?? null;
  }

  /**
   * Update typography/style knobs.
   * @param {Object} style
   */
  setStyle(style) {
    this.#style = { ...this.#style, ...style };
  }

  /**
   * The ids of the labels actually drawn on the last render (survivors of the
   * overlap suppression). Exposed for diagnostics/tests.
   * @returns {Set<string|number>}
   */
  get visibleLabels() {
    return this.#visibleLabels;
  }

  renderWithContext(renderContext) {
    const { ctx } = renderContext;
    this.#visibleLabels = new Set();

    // `labelsVisible` gate: a hidden layer draws nothing, even for labelable units.
    if (!this.visible || !this.#locationStore || !ctx) return;

    const scale = this.#safeNumber(renderContext.scale, 1);
    const rotation = this.#safeNumber(renderContext.rotation, 0);
    const dpr = this.#safeNumber(renderContext.dpr, 1);

    const nodes = this.#labelableNodesOnLevel();
    if (!nodes.length) return;

    // Screen-space transform of the active canvas (identity under the test shim).
    const t = (typeof ctx.getTransform === 'function' && ctx.getTransform())
      || { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    const invDpr = dpr ? 1 / dpr : 1;
    const transform = {
      a: t.a * invDpr, b: t.b * invDpr,
      c: t.c * invDpr, d: t.d * invDpr,
      e: t.e * invDpr, f: t.f * invDpr
    };

    const fontSize = this.#style.fontSize;
    this.#applyFont(ctx, fontSize);

    // --- Build one screen-rect per candidate, then thin by overlap. ----------
    const rects = [];
    for (const node of nodes) {
      rects.push(this.#screenRect(ctx, node, fontSize, transform, scale, rotation));
    }

    const visibleIndices = computeVisibleRects(rects);
    const survivors = new Set(visibleIndices);

    ctx.save();
    for (let i = 0; i < nodes.length; i++) {
      if (!survivors.has(i)) continue;
      const node = nodes[i];
      this.#drawLabel(ctx, node, fontSize, scale, rotation);
      this.#visibleLabels.add(node.id);
    }
    ctx.restore();
  }

  /**
   * The labelable display nodes placed on the active level, ordered so the
   * overlap suppression keeps the higher-priority label: shorter labels (more
   * likely to fit) first, ties broken by unit id for determinism.
   * @returns {import('../data/LocationModel.js').DisplayNode[]}
   */
  #labelableNodesOnLevel() {
    const store = this.#locationStore;
    if (!store || !this.#levelCode) return [];
    const out = [];
    for (const loc of store.locations || []) {
      for (const node of (loc.displayNodes || [])) {
        if (!node.labelable) continue;
        if (node.levelCode !== this.#levelCode) continue;
        if (!node.text) continue;
        out.push(node);
      }
    }
    out.sort((a, b) => {
      const d = (a.text?.length ?? 0) - (b.text?.length ?? 0);
      if (d !== 0) return d;
      return String(a.unitId ?? a.id).localeCompare(String(b.unitId ?? b.id));
    });
    return out;
  }

  /**
   * The label's natural text-box size at the current font (before shrink-to-fit).
   * @returns {{width:number,height:number}}
   */
  #labelBox(ctx, text, fontSize) {
    const pad = this.#style.padding;
    let textWidth = String(text).length * fontSize * 0.6;
    if (typeof ctx.measureText === 'function') {
      const m = ctx.measureText(text);
      if (m && Number.isFinite(m.width)) textWidth = m.width;
    }
    const textHeight = fontSize * this.#style.lineHeight;
    return { width: textWidth + pad * 2, height: textHeight + pad * 2 };
  }

  /**
   * The screen-space oriented rect of a label for the overlap suppression.
   * @returns {{cx:number,cy:number,width:number,height:number,rotation:number}}
   */
  #screenRect(ctx, node, fontSize, transform, scale, rotation) {
    const box = this.#labelBox(ctx, node.text, fontSize);
    const fit = this.#fitScaleFor(node, box);

    const wx = node.point.x;
    const wy = node.point.y;
    const cx = wx * transform.a + wy * transform.c + transform.e;
    const cy = wx * transform.b + wy * transform.d + transform.f;

    // The label is drawn at a fixed screen size (1/scale undoes the world zoom),
    // so its screen footprint is the fitted natural box, oriented by the map
    // rotation plus the node's own label angle.
    const safeScale = scale > 0 ? scale : 1;
    return {
      cx,
      cy,
      width: (box.width * fit) / safeScale,
      height: (box.height * fit) / safeScale,
      rotation: rotation + (node.rotation || 0)
    };
  }

  /**
   * Shrink-to-fit scalar for a node's label box inside its unit extents (clamped
   * at 1). When the unit carries no usable extents, no shrink is applied.
   * @returns {number}
   */
  #fitScaleFor(node, box) {
    const uw = node.unitWidth || 0;
    const uh = node.unitHeight || 0;
    if (!(uw > 0) || !(uh > 0)) return 1;
    return _fitScale(box.width, box.height, uw, uh);
  }

  #drawLabel(ctx, node, fontSize, scale, rotation) {
    const text = node.text;
    if (!text) return;

    const wx = node.point.x;
    const wy = node.point.y;

    ctx.save();
    ctx.translate(wx, wy);
    ctx.rotate(rotation + (node.rotation || 0));

    const safeScale = scale > 0 ? scale : 1;
    ctx.scale(1 / safeScale, 1 / safeScale);

    const box = this.#labelBox(ctx, text, fontSize);
    const fit = this.#fitScaleFor(node, box);
    if (fit !== 1) ctx.scale(fit, fit);

    const w = box.width;
    const h = box.height;
    const left = -w / 2;
    const top = -h / 2;

    ctx.fillStyle = this.#style.backgroundColor;
    ctx.strokeStyle = this.#style.borderColor;
    ctx.lineWidth = this.#style.borderWidth;
    this.#roundedRect(ctx, left, top, w, h, this.#style.borderRadius);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = this.#style.textColor;
    ctx.fillText(text, 0, 0);

    ctx.restore();
  }

  #applyFont(ctx, fontSize) {
    ctx.font = `${fontSize}px ${this.#style.fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
  }

  #roundedRect(ctx, x, y, w, h, r) {
    const rad = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.lineTo(x + w - rad, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
    ctx.lineTo(x + w, y + h - rad);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
    ctx.lineTo(x + rad, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
    ctx.lineTo(x, y + rad);
    ctx.quadraticCurveTo(x, y, x + rad, y);
    ctx.closePath();
  }

  #safeNumber(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
  }

  dispose() {
    this.#locationStore = null;
    this.#visibleLabels = new Set();
  }
}
