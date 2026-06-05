import { Layer } from './Layer.js';

/**
 * FloorLayer renders the active level's per-unit polygons and resolves a tap to
 * the owning unit id.
 *
 * Drawing and hit-testing both walk the level's drawable {@link UnitPolygon}s so
 * each polygon keeps its unit identity — `hitTest` returns the `unitId` of the
 * unit polygon containing the point (or `null` for empty space), which
 * {@link HitTestManager} maps to a Location or a bare floor tap.
 */
export class FloorLayer extends Layer {
  name = 'FloorLayer';

  #mapLevel = null;

  /**
   * @param {import('../data/MapGeometryModel.js').MapLevel} [mapLevel]
   */
  constructor(mapLevel = null) {
    super();
    this.#mapLevel = mapLevel;
  }

  /**
   * Set the active level's geometry to render.
   * @param {import('../data/MapGeometryModel.js').MapLevel} mapLevel
   */
  setMapLevel(mapLevel) {
    this.#mapLevel = mapLevel;
  }

  /**
   * Alias for {@link setMapLevel} (setter-seam compatibility).
   * @param {import('../data/MapGeometryModel.js').MapLevel} mapLevel
   */
  setLevel(mapLevel) {
    this.#mapLevel = mapLevel;
  }

  /**
   * Get world-space bounding box for fit-to-view.
   * @returns {Object|null}
   */
  getBounds() {
    if (!this.#mapLevel) return null;
    return this.#mapLevel.getBounds();
  }

  #drawables() {
    if (!this.#mapLevel) return [];
    if (typeof this.#mapLevel.getDrawables === 'function') {
      return this.#mapLevel.getDrawables() ?? [];
    }
    return this.#mapLevel.drawables ?? [];
  }

  renderWithContext(renderContext) {
    const { ctx } = renderContext;
    if (!this.visible || !this.#mapLevel) return;

    ctx.save();
    for (const drawable of this.#drawables()) {
      this.#renderPolygon(ctx, drawable);
    }
    ctx.restore();
  }

  /**
   * Hit test against the active level's unit polygons.
   *
   * Returns the `unitId` of the containing unit polygon (a bare id — string or
   * number), or `null` when the point lands in empty space. The owning
   * {@link LayerStack} wraps this into `{ unitId }` for the
   * {@link HitTestManager} classifier.
   * @param {number} worldX
   * @param {number} worldY
   * @returns {(string|number)|null}
   */
  hitTest(worldX, worldY) {
    const id = this.hitTestUnitId(worldX, worldY);
    return id == null ? null : id;
  }

  /**
   * Resolve the unit id whose polygon contains the point, or `null`.
   * @param {number} worldX
   * @param {number} worldY
   * @returns {(string|number)|null}
   */
  hitTestUnitId(worldX, worldY) {
    const drawables = this.#drawables();
    // Top-most (last-drawn) polygon wins on overlap.
    for (let i = drawables.length - 1; i >= 0; i--) {
      const d = drawables[i];
      if (this.#isPointInPolygon(worldX, worldY, d.points)) {
        return d.unitId;
      }
    }
    return null;
  }

  #renderPolygon(ctx, drawable) {
    const points = drawable.points;
    if (!points || points.length < 3) return;

    ctx.save();
    ctx.strokeStyle = drawable.strokeColor || '#000';
    ctx.fillStyle = drawable.fillColor || '#ccc';
    ctx.lineWidth = drawable.strokeWidth || 1;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  #isPointInPolygon(x, y, points) {
    if (!points || points.length < 3) return false;
    let inside = false;

    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const xi = points[i].x;
      const yi = points[i].y;
      const xj = points[j].x;
      const yj = points[j].y;

      const intersect =
        ((yi > y) !== (yj > y)) &&
        (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);

      if (intersect) inside = !inside;
    }

    return inside;
  }
}
