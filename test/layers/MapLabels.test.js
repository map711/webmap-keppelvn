// >>> TARS cap:map-labels
//
// map-labels (RE-WORK) — LocationLayer label sizing is ported from sunwaymalls:
// a ZOOM-RESPONSIVE screen-space font with a √scale growth curve and a
// `minFontSize·dpr` FLOOR, the `_fitScale` unit-shrink REMOVED, the overlap
// thinning rect matched to the drawn screen footprint (not box/scale), and
// visibility recompute CACHED on unchanged scale/rotation with a zoom
// freeze / idle-recompute pair (`beginZoom`/`endZoom`).
//
// Eight test targets, one per acceptance criterion:
//   1. min-size floor: parseFloat(ctx.font) >= minFontSize·dpr at scale=0.05.
//   2. √scale growth: font(0.25)==floor < font(1) < font(4); font(4)>font(1).
//   3. dpr scales floor+size: font(dpr=2) == 2·font(dpr=1) at the same scale.
//   4. independent of unit polygon size: identical text+scale+dpr -> identical
//      EFFECTIVE drawn font px regardless of unitWidth/unitHeight (no _fitScale).
//   5. thinning rect width ≈ measured screen box width (not box.width/scale).
//   6. visibility recompute cached: 1 thinning run on a repeat, 2 after a change.
//   7. zoom freeze + idle recompute: invalidate fires once after endZoom+timers.
//   8. labelable gate regression guard: vacant shop + escalator emit nothing;
//      a tenanted shop emits its tenancy name.
//
// Pure Node/Vitest. To-be-built/rebuilt modules are imported LAZILY so the suite
// COLLECTS cleanly and each test fails on its own behavioural assertion (not a
// module-resolution crash). The render path is exercised against an instrumented
// 2D context (font px + per-label scale stack + measureText are the observables)
// under a tiny canvas/document shim.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BundleLoader } from '../../src/data/BundleLoader.js';
import * as RectVisibilityModule from '../../src/renderer/RectVisibility.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');
const sgcFixturePath = join(repoRoot, 'test', 'fixtures', 'SGC_v001.json');

function loadSgcRaw() {
  return JSON.parse(readFileSync(sgcFixturePath, 'utf8'));
}

// --- Lazy module resolvers (collect-clean RED) ------------------------------

async function importModule(relPath, label) {
  let mod = null;
  try {
    mod = await import(relPath);
  } catch {
    mod = null;
  }
  expect(mod, `${label} must exist and be importable`).not.toBeNull();
  return mod;
}

async function importLocationStore() {
  const mod = await importModule('../../src/data/LocationModel.js', 'src/data/LocationModel.js');
  expect(mod.LocationStore, 'LocationModel.js must export LocationStore').toBeTypeOf('function');
  return mod.LocationStore;
}

async function importLocationLayer() {
  const mod = await importModule('../../src/layers/LocationLayer.js', 'src/layers/LocationLayer.js');
  expect(mod.LocationLayer, 'LocationLayer.js must export LocationLayer').toBeTypeOf('function');
  return mod.LocationLayer;
}

// --- Instrumented canvas/document shim --------------------------------------
// Fixed 6px/char text metric keeps box sizes deterministic. The shim tracks a
// scale stack (with save/restore) so each fillText records the EFFECTIVE drawn
// font px = (parsed font px) × (product of ctx.scale x-factors in the active
// frame). That isolates the per-label `_fitScale` shrink (criterion 4) from the
// shared `1/scale` counter-scale, and exposes the screen-space measured box.
function installCanvasShim() {
  const makeCtx = () => {
    const ctx = {
      font: '12px Arial, sans-serif',
      textAlign: '',
      textBaseline: '',
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      _fillTexts: [],
      // Per-fillText records: { text, fontPx, scaleX, scaleY, effFontPx }.
      _draws: [],
      _scaleStack: [{ x: 1, y: 1 }],
      _measureCalls: [],
      get _scaleX() { return ctx._scaleStack[ctx._scaleStack.length - 1].x; },
      get _scaleY() { return ctx._scaleStack[ctx._scaleStack.length - 1].y; },
      save() {
        const top = ctx._scaleStack[ctx._scaleStack.length - 1];
        ctx._scaleStack.push({ x: top.x, y: top.y });
      },
      restore() {
        if (ctx._scaleStack.length > 1) ctx._scaleStack.pop();
      },
      translate() {},
      rotate() {},
      scale(sx, sy) {
        const top = ctx._scaleStack[ctx._scaleStack.length - 1];
        top.x *= (Number.isFinite(sx) ? sx : 1);
        top.y *= (Number.isFinite(sy) ? sy : (Number.isFinite(sx) ? sx : 1));
      },
      beginPath() {},
      moveTo() {},
      lineTo() {},
      quadraticCurveTo() {},
      closePath() {},
      fill() {},
      stroke() {},
      measureText(t) {
        const fontPx = parseFloat(ctx.font) || 12;
        // Width scales with the active font px so a screen-space measure is
        // sensitive to the computed font (6px-per-char at the 12px reference).
        const width = String(t).length * 6 * (fontPx / 12);
        ctx._measureCalls.push({ text: String(t), fontPx, width });
        return { width };
      },
      getTransform() { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; },
      fillText(t) {
        const fontPx = parseFloat(ctx.font) || 0;
        const scaleX = ctx._scaleX;
        const scaleY = ctx._scaleY;
        ctx._fillTexts.push(String(t));
        ctx._draws.push({
          text: String(t),
          fontPx,
          scaleX,
          scaleY,
          effFontPx: fontPx * scaleX
        });
      }
    };
    return ctx;
  };
  const prevDoc = globalThis.document;
  globalThis.document = {
    createElement: () => ({ getContext: () => makeCtx() })
  };
  return { makeCtx, restore() { globalThis.document = prevDoc; } };
}

// --- Build the catalog from a raw bundle via the real BundleLoader seam ------
async function buildCatalog(rawBundle) {
  const LocationStore = await importLocationStore();
  const loader = new BundleLoader({ load: () => Promise.resolve(structuredClone(rawBundle)) });
  const model = await loader.load('/bundle.json');
  const store = new LocationStore();
  store.hydrate(model, { renderScale: 1 });
  return { store, model };
}

// Wire a layer with the store/level, applying the sizing style if the layer
// accepts it. Tolerant of the constructor-arg seam vs the setter seam, so the
// test pins BEHAVIOUR, not one wiring shape.
function makeLayer(LocationLayer, store, levelCode, style) {
  let layer;
  try {
    layer = new LocationLayer(store, levelCode);
  } catch {
    layer = new LocationLayer();
  }
  if (typeof layer.setLocationStore === 'function') layer.setLocationStore(store);
  if (typeof layer.setFloor === 'function') layer.setFloor(levelCode);
  if (style && typeof layer.setStyle === 'function') layer.setStyle(style);
  return layer;
}

function render(layer, ctx, { scale = 1, rotation = 0, dpr = 1, invalidate } = {}) {
  layer.renderWithContext({ ctx, dpr, scale, rotation, invalidate: invalidate ?? (() => {}) });
}

// --- Mini-bundle: one M1 floor carrying a tenanted shop, a VACANT shop, and an
// escalator — the three labelability cases on one level. -----------------------
function square(x, y, s = 10) {
  return {
    type: 'Polygon',
    coordinates: [[[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]]
  };
}

function makeMiniBundle() {
  const baseUnit = (over) => ({
    id: 0, level_id: 10, layer_id: 1, kind: 'shop', name: '',
    geometry: square(0, 0), display_point: [5, 5], position: 0, is_active: true,
    hidden: false, locked: false, opacity: 1.0,
    stroke_color: '', stroke_width: null, fill_color: '',
    doors: [], connector_group_id: null, label_rotation: 0.0, label_point: [5, 5],
    tenancies: [], ...over
  });
  return {
    mall: { id: 99, name: 'Mini Mall', code: 'MINI' },
    levels: [
      { id: 10, name: 'M1', code: 'M1', position: 100, hidden: false, locked: false, opacity: 1.0 }
    ],
    layers: [
      { id: 1, level_id: 10, parent_id: null, name: 'L', position: 0, stroke_color: '', stroke_width: null, fill_color: '' }
    ],
    kinds: [
      { id: 1, slug: 'shop', label: 'Shop', position: 0, stroke_color: '#1e40af', stroke_width: 1.5, fill_color: '#dbeafe', is_system: true, is_tenant: true, is_routable: true, is_connector: false, is_accessible: false },
      { id: 2, slug: 'escalator', label: 'Escalator', position: 1, stroke_color: '#92400e', stroke_width: 1.5, fill_color: '#fde68a', is_system: true, is_tenant: false, is_routable: true, is_connector: true, is_accessible: false }
    ],
    units: [
      // A TENANTED shop -> labelable; its label is the tenancy name 'Mini Cafe'.
      baseUnit({ id: 301, kind: 'shop', geometry: square(0, 0), label_point: [5, 5], label_rotation: 90,
                 tenancies: [{ shop_id: 1, name: 'Mini Cafe' }] }),
      // A VACANT shop-kind unit (no tenancy) -> NOT labelable.
      baseUnit({ id: 302, kind: 'shop', geometry: square(40, 0), label_point: [45, 5], label_rotation: 0,
                 tenancies: [] }),
      // An ESCALATOR (kind.is_tenant === false) -> NOT labelable.
      baseUnit({ id: 303, kind: 'escalator', geometry: square(80, 0), label_point: [85, 5], label_rotation: 0,
                 connector_group_id: 7, tenancies: [] })
    ],
    shops: [
      { id: 1, mall: 99, name: 'Mini Cafe', slug: 'mini-cafe', logo: null, description: '', category: 1, unit_number: 'M1-01', is_active: true }
    ],
    categories: [{ id: 1, name: 'Food', slug: 'food', icon: null }],
    navmesh_by_level: { 10: { vertices: [], triangles: [], adjacency: [], doors_by_unit: {}, centroids_by_unit: {}, envelope_dims: [200, 200] } },
    transitions: [
      { group_id: 7, name: 'mini-connector', direction: 'bidirectional', cost: 2.0, is_accessible: false,
        members: [{ unit_id: 303, level_id: 10, centroid: [85, 5], position: 100 }] }
    ]
  };
}

// One M1 floor with a SINGLE tenanted shop — a clean, deterministic single-label
// fixture for the sizing/thinning/caching criteria (no overlap interference).
function makeSingleShopBundle({ s = 100, name = 'Solo', label_rotation = 0 } = {}) {
  const baseUnit = (over) => ({
    id: 0, level_id: 10, layer_id: 1, kind: 'shop', name: '',
    geometry: square(0, 0), display_point: [50, 50], position: 0, is_active: true,
    hidden: false, locked: false, opacity: 1.0,
    stroke_color: '', stroke_width: null, fill_color: '',
    doors: [], connector_group_id: null, label_rotation: 0.0, label_point: [50, 50],
    tenancies: [], ...over
  });
  return {
    mall: { id: 99, name: 'Mini Mall', code: 'MINI' },
    levels: [{ id: 10, name: 'M1', code: 'M1', position: 100 }],
    layers: [{ id: 1, level_id: 10, parent_id: null, name: 'L', position: 0, stroke_color: '', stroke_width: null, fill_color: '' }],
    kinds: [
      { id: 1, slug: 'shop', label: 'Shop', position: 0, stroke_color: '#1e40af', stroke_width: 1.5, fill_color: '#dbeafe', is_tenant: true, is_routable: true, is_connector: false }
    ],
    units: [
      baseUnit({ id: 501, kind: 'shop', geometry: square(0, 0, s), label_point: [50, 50], label_rotation,
                 tenancies: [{ shop_id: 1, name }] })
    ],
    shops: [{ id: 1, mall: 99, name, slug: 'solo', category: 1, unit_number: 'M1-01', is_active: true }],
    categories: [{ id: 1, name: 'Food', slug: 'food' }],
    navmesh_by_level: { 10: { envelope_dims: [400, 400] } },
    transitions: []
  };
}

// Two tenanted shops with IDENTICAL text but very different polygon sizes
// (tiny 20x12 vs huge 2000x2000), anchored FAR APART so overlap suppression
// keeps both. The only difference is the would-be `_fitScale` shrink, which the
// re-work removes -> the two effective font px must be EQUAL.
function makeUnitSizeBundle() {
  const baseUnit = (over) => ({
    id: 0, level_id: 10, layer_id: 1, kind: 'shop', name: '',
    geometry: square(0, 0), display_point: [0, 0], position: 0, is_active: true,
    hidden: false, locked: false, opacity: 1.0,
    stroke_color: '', stroke_width: null, fill_color: '',
    doors: [], connector_group_id: null, label_rotation: 0.0, label_point: [0, 0],
    tenancies: [], ...over
  });
  return {
    mall: { id: 99, name: 'Mini Mall', code: 'MINI' },
    levels: [{ id: 10, name: 'M1', code: 'M1', position: 100 }],
    layers: [{ id: 1, level_id: 10, parent_id: null, name: 'L', position: 0, stroke_color: '', stroke_width: null, fill_color: '' }],
    kinds: [
      { id: 1, slug: 'shop', label: 'Shop', position: 0, stroke_color: '#1e40af', stroke_width: 1.5, fill_color: '#dbeafe', is_tenant: true, is_routable: true, is_connector: false }
    ],
    units: [
      // TINY unit: a 20x12 polygon. The label 'SameLabelText' is wider than 20,
      // so the OLD `_fitScale` path would shrink it below 1.
      baseUnit({ id: 601, kind: 'shop',
                 geometry: { type: 'Polygon', coordinates: [[[0, 0], [20, 0], [20, 12], [0, 12], [0, 0]]] },
                 label_point: [10, 6], label_rotation: 0,
                 tenancies: [{ shop_id: 1, name: 'SameLabelText' }] }),
      // HUGE unit: a 2000x2000 polygon far away. The same label fits easily, so
      // its `_fitScale` is 1 — different from the tiny unit under the old code.
      baseUnit({ id: 602, kind: 'shop',
                 geometry: { type: 'Polygon', coordinates: [[[5000, 5000], [7000, 5000], [7000, 7000], [5000, 7000], [5000, 5000]]] },
                 label_point: [6000, 6000], label_rotation: 0,
                 tenancies: [{ shop_id: 2, name: 'SameLabelText' }] })
    ],
    shops: [
      { id: 1, mall: 99, name: 'SameLabelText', slug: 'tiny', category: 1, unit_number: 'M1-01', is_active: true },
      { id: 2, mall: 99, name: 'SameLabelText', slug: 'huge', category: 1, unit_number: 'M1-02', is_active: true }
    ],
    categories: [{ id: 1, name: 'Food', slug: 'food' }],
    navmesh_by_level: { 10: { envelope_dims: [8000, 8000] } },
    transitions: []
  };
}

// The sizing style the criteria pin: fontSize 8, minFontSize 8.
const SIZE_STYLE = { fontSize: 8, minFontSize: 8 };

// =============================================================================
// Criterion 1 — min-size floor: font px >= minFontSize·dpr even at a tiny scale
// =============================================================================
describe('map-labels: a min-size floor keeps the font px >= minFontSize·dpr at tiny zoom', () => {
  let shim;
  beforeEach(() => { shim = installCanvasShim(); });
  afterEach(() => { shim.restore(); });

  it('applies font px >= minFontSize·dpr at scale=0.05 (never the microscopic pre-fix value)', async () => {
    const LocationLayer = await importLocationLayer();
    const { store } = await buildCatalog(makeSingleShopBundle());

    // dpr=1 (the criterion's literal scenario): floor = minFontSize·dpr = 8.
    const ctx1 = shim.makeCtx();
    render(makeLayer(LocationLayer, store, 'M1', SIZE_STYLE), ctx1, { scale: 0.05, dpr: 1, rotation: 0 });
    expect(ctx1._draws.length, 'a label must be drawn so the font is observable').toBeGreaterThan(0);
    const fontPxDpr1 = parseFloat(ctx1.font);
    expect(Number.isFinite(fontPxDpr1), 'ctx.font must carry a finite px size').toBe(true);
    expect(fontPxDpr1).toBeGreaterThanOrEqual(8 * 1);

    // dpr=2: the floor scales to minFontSize·dpr = 16. The binding assertion is
    // parseFloat(ctx.font) >= minFontSize·dpr. The pre-fix fixed-style path emits
    // a dpr-blind ~8px here, which is below the 16px floor -> this is where the
    // missing min-size floor bites.
    const ctx2 = shim.makeCtx();
    render(makeLayer(LocationLayer, store, 'M1', SIZE_STYLE), ctx2, { scale: 0.05, dpr: 2, rotation: 0 });
    expect(ctx2._draws.length, 'a label must be drawn at dpr=2').toBeGreaterThan(0);
    const fontPxDpr2 = parseFloat(ctx2.font);
    const minFontSize = 8;
    const dpr = 2;
    expect(fontPxDpr2).toBeGreaterThanOrEqual(minFontSize * dpr);
  });
});

// =============================================================================
// Criterion 2 — √scale growth above the floor
// =============================================================================
describe('map-labels: the font grows with √scale above the floor and pins to the floor below it', () => {
  let shim;
  beforeEach(() => { shim = installCanvasShim(); });
  afterEach(() => { shim.restore(); });

  function fontPxAtScale(LocationLayer, store, scale) {
    const ctx = shim.makeCtx();
    const layer = makeLayer(LocationLayer, store, 'M1', SIZE_STYLE);
    render(layer, ctx, { scale, dpr: 1, rotation: 0 });
    expect(ctx._draws.length, `a label must draw at scale=${scale}`).toBeGreaterThan(0);
    return parseFloat(ctx.font);
  }

  it('orders font(0.25) == floor < font(1) < font(4), with font(4) strictly > font(1)', async () => {
    const LocationLayer = await importLocationLayer();
    const { store } = await buildCatalog(makeSingleShopBundle());

    const f025 = fontPxAtScale(LocationLayer, store, 0.25);
    const f1 = fontPxAtScale(LocationLayer, store, 1);
    const f4 = fontPxAtScale(LocationLayer, store, 4);

    // At scale 0.25: 8·√0.25 = 4 < floor 8 -> pinned to the floor (8).
    expect(f025).toBeCloseTo(8, 6);
    // At scale 1: 8·√1 = 8 (== floor). At scale 4: 8·√4 = 16.
    expect(f1).toBeCloseTo(8, 6);
    expect(f4).toBeCloseTo(16, 6);

    // The binding orderings from the criterion.
    expect(f025).toBeLessThan(f4);
    expect(f4).toBeGreaterThan(f1);
    // and the floor case is NOT above scale=1 (it is the floor, not √-grown).
    expect(f025).toBeLessThanOrEqual(f1 + 1e-6);
  });
});

// =============================================================================
// Criterion 3 — dpr scales both the floor and the size (px doubles with dpr)
// =============================================================================
describe('map-labels: dpr scales the floor and the size (font px doubles at dpr=2)', () => {
  let shim;
  beforeEach(() => { shim = installCanvasShim(); });
  afterEach(() => { shim.restore(); });

  it('font(dpr=2) == 2 × font(dpr=1) at the same small scale=0.25 (the floor is minFontSize·dpr)', async () => {
    const LocationLayer = await importLocationLayer();
    const { store } = await buildCatalog(makeSingleShopBundle());

    const ctx1 = shim.makeCtx();
    const layer1 = makeLayer(LocationLayer, store, 'M1', SIZE_STYLE);
    render(layer1, ctx1, { scale: 0.25, dpr: 1, rotation: 0 });
    expect(ctx1._draws.length).toBeGreaterThan(0);
    const fontDpr1 = parseFloat(ctx1.font);

    const ctx2 = shim.makeCtx();
    const layer2 = makeLayer(LocationLayer, store, 'M1', SIZE_STYLE);
    render(layer2, ctx2, { scale: 0.25, dpr: 2, rotation: 0 });
    expect(ctx2._draws.length).toBeGreaterThan(0);
    const fontDpr2 = parseFloat(ctx2.font);

    // At scale 0.25 both are floored: floor(dpr=1)=8, floor(dpr=2)=16. The px
    // doubles with dpr.
    expect(fontDpr1).toBeCloseTo(8, 6);
    expect(fontDpr2).toBeCloseTo(2 * fontDpr1, 6);
  });
});

// =============================================================================
// Criterion 4 — font px is INDEPENDENT of the unit polygon size (no _fitScale)
// =============================================================================
describe('map-labels: identical text/scale/dpr draws at the same font px regardless of unit size', () => {
  let shim;
  beforeEach(() => { shim = installCanvasShim(); });
  afterEach(() => { shim.restore(); });

  it('draws a tiny-unit label and a huge-unit label at the SAME effective font px (the _fitScale shrink is gone)', async () => {
    const LocationLayer = await importLocationLayer();
    const { store } = await buildCatalog(makeUnitSizeBundle());
    const ctx = shim.makeCtx();

    const layer = makeLayer(LocationLayer, store, 'M1', SIZE_STYLE);
    // scale=1, dpr=1 -> the shared 1/scale counter-scale is identical for both;
    // the ONLY remaining per-label scale would be the old `_fitScale`.
    render(layer, ctx, { scale: 1, dpr: 1, rotation: 0 });

    // Both labels share the same text and must both draw (anchored far apart).
    const draws = ctx._draws.filter((d) => d.text === 'SameLabelText');
    expect(draws.length, 'both same-text labels must be drawn (far-apart anchors)').toBe(2);

    // The effective drawn font px (font × per-label scale, after removing the
    // shared 1/scale frame) must be EQUAL across the tiny and huge units. Under
    // the OLD code the tiny 20x12 unit shrinks via _fitScale (< 1) and the huge
    // unit does not, so the two diverge.
    const [a, b] = draws;
    expect(a.effFontPx).toBeGreaterThan(0);
    expect(b.effFontPx).toBeGreaterThan(0);
    expect(a.effFontPx).toBeCloseTo(b.effFontPx, 6);
  });
});

// =============================================================================
// Criterion 5 — thinning rect width ≈ measured screen box width (not box/scale)
// =============================================================================
describe('map-labels: the overlap-thinning rect matches the drawn screen footprint', () => {
  let shim;
  let spy;
  beforeEach(() => {
    shim = installCanvasShim();
    spy = vi.spyOn(RectVisibilityModule, 'computeVisibleRects');
  });
  afterEach(() => {
    spy.mockRestore();
    shim.restore();
  });

  it('builds a thinning rect whose width ≈ the measured screen box (NOT box.width / scale) at scale=0.1', async () => {
    const LocationLayer = await importLocationLayer();
    // Single labelled shop so exactly one rect is built.
    const { store } = await buildCatalog(makeSingleShopBundle({ name: 'WidthProbe', s: 400 }));
    const ctx = shim.makeCtx();

    const scale = 0.1;
    const layer = makeLayer(LocationLayer, store, 'M1', SIZE_STYLE);
    render(layer, ctx, { scale, dpr: 1, rotation: 0 });

    // computeVisibleRects is the shared thinning seam; capture the rects it saw.
    expect(spy, 'the layer must thin via computeVisibleRects').toHaveBeenCalled();
    const rects = spy.mock.calls[spy.mock.calls.length - 1][0];
    expect(Array.isArray(rects)).toBe(true);
    expect(rects.length, 'exactly one candidate rect for the single label').toBe(1);
    const rectWidth = rects[0].width;

    // The measured screen box for this label: the layer measures 'WidthProbe' at
    // the floored font (8px). The fixed-metric shim returns a width tied to that
    // font; reconstruct the same box the layer drew.
    const probe = ctx._measureCalls.find((m) => m.text === 'WidthProbe');
    expect(probe, 'the layer must measureText the label at the active font').toBeTruthy();

    // The thinning rect width matches the measured box (± padding ~ a few px).
    // It must NOT be box.width / scale (which at scale=0.1 would be ~10× larger).
    expect(rectWidth).toBeGreaterThan(0);
    expect(rectWidth).toBeLessThan(probe.width / scale * 0.5);
    // and it tracks the measured box width within a small padding margin.
    expect(Math.abs(rectWidth - probe.width)).toBeLessThanOrEqual(20);
  });
});

// =============================================================================
// Criterion 6 — visibility recompute is CACHED on unchanged scale/rotation
// =============================================================================
describe('map-labels: visibility thinning is cached across identical renders and recomputes on change', () => {
  let shim;
  let spy;
  beforeEach(() => {
    shim = installCanvasShim();
    spy = vi.spyOn(RectVisibilityModule, 'computeVisibleRects');
  });
  afterEach(() => {
    spy.mockRestore();
    shim.restore();
  });

  it('runs thinning once across two identical renders (cache hit) and recomputes when scale changes', async () => {
    const LocationLayer = await importLocationLayer();
    const { store } = await buildCatalog(makeSingleShopBundle());
    const ctx = shim.makeCtx();

    const layer = makeLayer(LocationLayer, store, 'M1', SIZE_STYLE);

    // First render at scale=1, rotation=0: thinning runs once.
    render(layer, ctx, { scale: 1, rotation: 0, dpr: 1 });
    // Second render at the SAME scale/rotation: cache hit, no recompute.
    render(layer, ctx, { scale: 1, rotation: 0, dpr: 1 });
    expect(spy, 'identical scale/rotation must not re-run the thinning').toHaveBeenCalledTimes(1);

    // Third render at a CHANGED scale: thinning recomputes (count -> 2).
    render(layer, ctx, { scale: 2, rotation: 0, dpr: 1 });
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

// =============================================================================
// Criterion 7 — zoom gesture freezes thinning; endZoom schedules an idle recompute
// =============================================================================
describe('map-labels: a zoom gesture freezes thinning and endZoom idle-recomputes via invalidate', () => {
  let shim;
  let spy;
  beforeEach(() => {
    shim = installCanvasShim();
    spy = vi.spyOn(RectVisibilityModule, 'computeVisibleRects');
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    spy.mockRestore();
    shim.restore();
  });

  it('calls the captured invalidate exactly once after endZoom + advancing timers, and not before', async () => {
    const LocationLayer = await importLocationLayer();
    const { store } = await buildCatalog(makeSingleShopBundle());
    const ctx = shim.makeCtx();
    const invalidate = vi.fn();

    const layer = makeLayer(LocationLayer, store, 'M1', SIZE_STYLE);
    expect(typeof layer.beginZoom, 'the layer must expose beginZoom()').toBe('function');
    expect(typeof layer.endZoom, 'the layer must expose endZoom()').toBe('function');

    // A render captures the `invalidate` from the render context + a snapshot.
    render(layer, ctx, { scale: 1, rotation: 0, dpr: 1, invalidate });

    // Gesture begins: mid-gesture renders must NOT trigger the idle invalidate.
    layer.beginZoom();
    render(layer, ctx, { scale: 1.5, rotation: 0, dpr: 1, invalidate });
    render(layer, ctx, { scale: 2.5, rotation: 0, dpr: 1, invalidate });
    vi.advanceTimersByTime(1000);
    expect(invalidate, 'no idle recompute may fire mid-gesture').not.toHaveBeenCalled();

    // Gesture ends: an idle recompute is scheduled (setTimeout fallback). It has
    // not fired yet (timers not advanced).
    layer.endZoom();
    expect(invalidate, 'invalidate must not fire before timers advance').not.toHaveBeenCalled();

    // Advancing timers fires the idle recompute exactly once -> invalidate once.
    vi.advanceTimersByTime(500);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });
});

// =============================================================================
// Criterion 8 — labelable gate regression guard (node selection unchanged)
// =============================================================================
describe('map-labels: the labelable gate still selects only tenanted tenant-kind units (regression)', () => {
  let shim;
  beforeEach(() => { shim = installCanvasShim(); });
  afterEach(() => { shim.restore(); });

  it('emits the tenancy name for a tenanted shop but NO label for a vacant shop or an escalator', async () => {
    const LocationLayer = await importLocationLayer();
    const { store } = await buildCatalog(makeMiniBundle());
    const ctx = shim.makeCtx();

    const layer = makeLayer(LocationLayer, store, 'M1', SIZE_STYLE);
    render(layer, ctx, { scale: 1, rotation: 0, dpr: 1 });
    const texts = ctx._fillTexts.slice();

    // The tenanted shop's tenancy name is drawn.
    expect(texts).toContain('Mini Cafe');
    // The vacant shop-kind unit (302) and the escalator (303) draw NOTHING.
    expect(texts.some((t) => /escalator/i.test(t))).toBe(false);
    // Exactly one label total on this level (only unit 301 is labelable).
    expect(texts.length).toBe(1);
  });
});
// <<< TARS cap:map-labels
