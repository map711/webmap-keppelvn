import { Layer } from './Layer.js';
import { computeVisibleRects } from '../renderer/RectVisibility.js';

/**
 * LocationLayer — draws the labels for LABELABLE units on the active level.
 *
 * A label is emitted only for a labelable placement (a tenant-kind unit carrying
 * a tenancy; see {@link DisplayNode#labelable}) while the layer is visible
 * (`labelsVisible`). Each placement is anchored at its pre-resolved `label_point`
 * with its `label_rotation` (already converted degrees → radians by the catalog —
 * NO polylabel/OBB recompute here).
 *
 * SIZING: the label is drawn at a ZOOM-RESPONSIVE
 * screen-space font px = `max(minFontSize·dpr, fontSize·√scale·dpr)` — a √scale
 * growth curve clamped to a `minFontSize·dpr` FLOOR — applied once to `ctx.font`,
 * then counter-scaled by `1/scale` so the on-screen size is constant regardless
 * of world zoom. There is NO per-label `_fitScale` unit-shrink: the font is
 * independent of the owning unit's polygon size.
 *
 * THINNING: overlap suppression runs through the shared {@link computeVisibleRects}
 * (RectVisibility/rbush) path over screen-space rects whose width/height match the
 * MEASURED screen footprint (the natural box at the active font — NOT box/scale).
 * The recompute is CACHED on unchanged scale/rotation (a repeat render is a cache
 * hit); a zoom gesture FREEZES the set (`beginZoom`) and `endZoom` schedules an
 * idle recompute that re-thins and calls the render context's `invalidate`.
 *
 * Reads `Location.displayNodes` filtered by active level; the public Layer seam
 * (`renderWithContext`/`setFloor`/`dispose`, `visible`) is preserved.
 */
export class LocationLayer extends Layer {
  name = 'LocationLayer';

  #style = {
    fontSize: 8,
    fontFamily: 'Arial, sans-serif',
    textColor: '#111111',
    backgroundColor: 'rgba(255, 255, 255, 0.65)',
    borderColor: 'transparent',
    borderWidth: 1,
    padding: 4,
    borderRadius: 3,
    lineHeight: 1.2,
    minFontSize: 8
  };

  #locationStore = null;
  #levelCode = null;

  // --- Visibility cache (keyed on scale/rotation) ---------------------------
  #lastScale = null;
  #lastRotation = null;
  #visibilityDirty = true;
  /** @type {Set<string|number>} ids of the labels drawn on the last render */
  #visibleLabels = new Set();

  // --- Zoom-gesture freeze / idle-recompute --------------------------------
  #isZooming = false;
  #idleHandle = null;
  #idleHandleType = null;
  /** @type {Object|null} last render snapshot used by the idle recompute */
  #lastSnapshot = null;
  /** @type {Function|null} invalidate captured from the render context */
  #invalidate = null;

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
    this.#resetVisibility();
  }

  /**
   * Make `levelCode` the active level whose labels are drawn.
   * @param {string} levelCode
   */
  setFloor(levelCode) {
    this.#levelCode = levelCode ?? null;
    this.#resetVisibility();
  }

  /**
   * Update typography/style knobs.
   * @param {Object} style
   */
  setStyle(style) {
    this.#style = { ...this.#style, ...style };
    this.#visibilityDirty = true;
    if (!this.#isZooming) this.#scheduleIdleRecompute();
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

    // `labelsVisible` gate: a hidden layer draws nothing, even for labelable units.
    if (!this.visible || !this.#locationStore || !ctx) return;

    const scale = this.#safeNumber(renderContext.scale, 1);
    const rotation = this.#safeNumber(renderContext.rotation, 0);
    const dpr = this.#safeNumber(renderContext.dpr, 1);
    if (renderContext.invalidate) this.#invalidate = renderContext.invalidate;

    const nodes = this.#labelableNodesOnLevel();
    if (!nodes.length) {
      this.#visibleLabels = new Set();
      return;
    }

    // Zoom-responsive screen-space font px (√scale growth above a minFontSize·dpr
    // floor), applied once so measureText/fillText see the active size.
    const fontSize = this.#computeFontSize(scale, dpr);
    this.#applyFont(ctx, fontSize);

    // Screen-space transform of the active canvas (identity under the test shim).
    const t = (typeof ctx.getTransform === 'function' && ctx.getTransform())
      || { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    const invDpr = dpr ? 1 / dpr : 1;
    const transform = {
      a: t.a * invDpr, b: t.b * invDpr,
      c: t.c * invDpr, d: t.d * invDpr,
      e: t.e * invDpr, f: t.f * invDpr
    };

    // Recompute the overlap thinning only when needed (cached on scale/rotation,
    // FROZEN mid-zoom). The cache key is (scale, rotation) + an explicit dirty
    // flag. Rects are measured against the live ctx here; the idle recompute
    // reuses the snapshot's measured rects so it needs no ctx.
    this.#computeLabelVisibility(nodes, ctx, fontSize, transform, scale, rotation);

    ctx.save();
    for (const node of nodes) {
      if (!this.#visibleLabels.has(node.id)) continue;
      this.#drawLabel(ctx, node, fontSize, scale, rotation);
    }
    ctx.restore();
  }

  /**
   * The screen-space font px for the active zoom: a √scale growth curve clamped
   * to a `minFontSize·dpr` floor, both scaled by dpr.
   * @param {number} scale
   * @param {number} dpr
   * @returns {number}
   */
  #computeFontSize(scale, dpr) {
    const d = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
    const base = this.#style.fontSize;
    const min = this.#style.minFontSize * d;
    const safeScale = (scale > 0 && Number.isFinite(scale)) ? scale : 1;
    const size = base * Math.sqrt(safeScale) * d;
    return Math.max(min, size);
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
   * Recompute (or reuse) the survivor set of the overlap thinning. The work runs
   * only when the scale/rotation changed since the last compute or the dirty flag
   * is set; mid-zoom the set is FROZEN (no recompute). On recompute, one
   * screen-rect per candidate is thinned via {@link computeVisibleRects}.
   */
  #computeLabelVisibility(nodes, ctx, fontSize, transform, scale, rotation, force = false) {
    if (this.#isZooming && !force) return; // frozen mid-gesture

    const epsilon = 1e-4;
    const scaleChanged = this.#lastScale === null || Math.abs(this.#lastScale - scale) > epsilon;
    const rotationChanged = this.#lastRotation === null || Math.abs(this.#lastRotation - rotation) > epsilon;
    const needsRecompute = force || this.#visibilityDirty || scaleChanged || rotationChanged;
    if (!needsRecompute) return;

    this.#lastScale = scale;
    this.#lastRotation = rotation;
    this.#visibilityDirty = false;

    const rects = [];
    const nodeIds = [];
    for (const node of nodes) {
      rects.push(this.#screenRect(ctx, node, fontSize, transform, rotation));
      nodeIds.push(node.id);
    }

    // Snapshot the measured rects so the idle recompute (which has no live ctx)
    // can re-thin from the settled view.
    this.#lastSnapshot = { rects, nodeIds, fontSize, transform, scale, rotation };

    this.#visibleLabels = this.#thin(rects, nodeIds);
  }

  /**
   * Thin a set of measured screen-rects via the shared overlap suppression and
   * return the surviving node-id set.
   * @returns {Set<string|number>}
   */
  #thin(rects, nodeIds) {
    const survivors = new Set();
    const visibleIndices = computeVisibleRects(rects);
    for (const index of visibleIndices) survivors.add(nodeIds[index]);
    return survivors;
  }

  /**
   * The natural text-box size of a label at the current (already-applied) font.
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
   * The screen-space oriented rect of a label for the overlap suppression. The
   * width/height match the MEASURED screen footprint at the active font — the
   * label is drawn at a fixed screen size, so its footprint is the natural box
   * itself (NOT box/scale, and NOT shrunk by any unit-fit < 1).
   * @returns {{cx:number,cy:number,width:number,height:number,rotation:number}}
   */
  #screenRect(ctx, node, fontSize, transform, rotation) {
    const box = this.#labelBox(ctx, node.text, fontSize);

    const wx = node.point.x;
    const wy = node.point.y;
    const cx = wx * transform.a + wy * transform.c + transform.e;
    const cy = wx * transform.b + wy * transform.d + transform.f;

    const mapRot = Math.atan2(transform.b, transform.a);
    const nodeRot = node.rotation || 0;
    const twoPI = Math.PI * 2;
    const net = ((mapRot + nodeRot) % twoPI + twoPI) % twoPI;
    const flip = (net > Math.PI / 2 && net < 3 * Math.PI / 2) ? Math.PI : 0;

    return {
      cx,
      cy,
      width: box.width,
      height: box.height,
      rotation: rotation + nodeRot + flip
    };
  }

  #drawLabel(ctx, node, fontSize, scale, rotation) {
    const text = node.text;
    if (!text) return;

    const wx = node.point.x;
    const wy = node.point.y;

    ctx.save();
    ctx.translate(wx, wy);

    // The global canvas transform already applied rotate(θ) (the map rotation);
    // this frame is in world space. So the label's OWN rotation must add only its
    // node rotation (+ a readability flip) — NOT θ again, or the label spins at
    // 2θ and rotates relative to the unit it names. `flip` is keyed on the net
    // SCREEN orientation (θ + nodeRot) so text never reads upside-down; this
    // matches the orientation `#screenRect` measures for overlap thinning.
    const nodeRot = node.rotation || 0;
    const twoPI = Math.PI * 2;
    const net = ((rotation + nodeRot) % twoPI + twoPI) % twoPI;
    const flip = (net > Math.PI / 2 && net < 3 * Math.PI / 2) ? Math.PI : 0;
    ctx.rotate(nodeRot + flip);

    // Counter-scale by 1/scale so the screen-space font stays constant across
    // world zoom. NO _fitScale unit-shrink — the size is unit-independent.
    const safeScale = scale > 0 ? scale : 1;
    ctx.scale(1 / safeScale, 1 / safeScale);

    const box = this.#labelBox(ctx, text, fontSize);
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

  // --- Zoom-gesture freeze / idle-recompute --------------------------------

  /** Mark the visibility set dirty and FREEZE recompute for the gesture. */
  beginZoom() {
    if (this.#isZooming) return;
    this.#isZooming = true;
    this.#visibilityDirty = true;
    this.#clearIdleRecompute();
  }

  /** End the gesture and schedule an idle recompute that invalidates the frame. */
  endZoom() {
    if (!this.#isZooming) return;
    this.#isZooming = false;
    this.#scheduleIdleRecompute();
  }

  #scheduleIdleRecompute() {
    this.#visibilityDirty = true;
    if (!this.#lastSnapshot) return;
    this.#clearIdleRecompute();

    const run = () => {
      this.#idleHandle = null;
      this.#idleHandleType = null;
      if (this.#isZooming || !this.#lastSnapshot) return;
      this.#recomputeFromSnapshot(this.#lastSnapshot);
    };

    if (typeof requestIdleCallback === 'function') {
      this.#idleHandle = requestIdleCallback(run, { timeout: 250 });
      this.#idleHandleType = 'idle';
    } else {
      this.#idleHandle = setTimeout(run, 0);
      this.#idleHandleType = 'timeout';
    }
  }

  #recomputeFromSnapshot(snapshot) {
    const { rects, nodeIds, scale, rotation } = snapshot;
    // Re-thin from the settled view using the measured rects captured at render
    // time (no live ctx needed), then mark the cache as matching that view.
    this.#visibleLabels = this.#thin(rects, nodeIds);
    this.#lastScale = scale;
    this.#lastRotation = rotation;
    this.#visibilityDirty = false;
    this.#invalidate?.();
  }

  #clearIdleRecompute() {
    if (this.#idleHandle == null) return;
    if (this.#idleHandleType === 'idle' && typeof cancelIdleCallback === 'function') {
      cancelIdleCallback(this.#idleHandle);
    } else {
      clearTimeout(this.#idleHandle);
    }
    this.#idleHandle = null;
    this.#idleHandleType = null;
  }

  #resetVisibility() {
    this.#lastScale = null;
    this.#lastRotation = null;
    this.#visibilityDirty = true;
    this.#visibleLabels = new Set();
    this.#lastSnapshot = null;
    this.#clearIdleRecompute();
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
    this.#clearIdleRecompute();
    this.#locationStore = null;
    this.#visibleLabels = new Set();
    this.#lastSnapshot = null;
    this.#invalidate = null;
  }
}
