// >>> TARS cap:map-labels
//
// map-labels — the LocationLayer renders shop labels for LABELABLE units only,
// anchored at the unit's pre-resolved `label_point`/`label_rotation` (degrees->
// radians, NO polylabel/OBB), shrunk-to-fit by `_fitScale` (clamped at 1), and
// thinned by screen-rect overlap suppression (RectVisibility/rbush).
//
// Four test targets, one per acceptance criterion:
//   1. Labelable predicate `tenancies.length>0 && kind.is_tenant && labelsVisible`:
//      a vacant shop-kind unit and an escalator emit NO label; a tenanted shop
//      emits its tenancy name. Observable = the text passed to ctx.fillText.
//   2. anchor === unit.label_point; angle === label_rotation deg->rad (90 -> PI/2),
//      pre-resolved (no recompute). Observable = the DisplayNode point/rotation.
//   3. _fitScale < 1 for a long label in a small polygon; clamped at 1 (never
//      upscales) when the label already fits. Observable = the returned scalar.
//   4. Two overlapping label screen-rects -> exactly one survives (the lower-
//      priority one is suppressed). Observable = the emitted label count / the
//      visible-index set from the rbush path.
//
// Pure Node/Vitest. To-be-built/rebuilt modules are imported LAZILY so the suite
// COLLECTS cleanly and each test fails on its own behavioural assertion (not a
// module-resolution crash). The render path is exercised against a captured 2D
// context (fillText is the observable) under a tiny canvas/document shim.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BundleLoader } from '../../src/data/BundleLoader.js';

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

// `_fitScale` is a ported pure helper; the plan places it "under the labels
// layer/util". Resolve it across the plausible export sites + as a method on the
// LocationLayer, so the test pins the BEHAVIOUR (shrink<1 / clamp at 1), not one
// module path or one name. Surfaces as an assertion-shaped failure if absent.
async function importFitScale() {
  const candidates = [
    '../../src/layers/LocationLayer.js',
    '../../src/layers/labelFit.js',
    '../../src/layers/util/labelFit.js',
    '../../src/utils/labelFit.js',
    '../../src/data/labelFit.js'
  ];
  for (const rel of candidates) {
    let mod = null;
    try {
      mod = await import(rel);
    } catch {
      mod = null;
    }
    if (!mod) continue;
    const fn = mod._fitScale ?? mod.fitScale ?? mod.computeFitScale ?? mod.default;
    if (typeof fn === 'function') return fn;
  }
  // Last resort: a static method on the rebuilt LocationLayer.
  const layerMod = await import('../../src/layers/LocationLayer.js').catch(() => null);
  if (layerMod && typeof layerMod.LocationLayer?._fitScale === 'function') {
    return layerMod.LocationLayer._fitScale.bind(layerMod.LocationLayer);
  }
  expect(
    null,
    '_fitScale must be exported from the labels layer/util (LocationLayer.js or a labelFit util)'
  ).toBeTypeOf('function');
}

// computeVisibleRects is the rbush/SAT overlap path the suppression reuses.
async function importComputeVisibleRects() {
  const mod = await importModule('../../src/renderer/RectVisibility.js', 'src/renderer/RectVisibility.js');
  expect(mod.computeVisibleRects, 'RectVisibility.js must export computeVisibleRects').toBeTypeOf('function');
  return mod.computeVisibleRects;
}

// --- Canvas/document shim so the layer can measure + draw text in Node -------
// A fixed-width font metric (6px/char) keeps label box sizes deterministic.
function installCanvasShim() {
  const makeCtx = () => {
    const ctx = {
      font: '',
      textAlign: '',
      textBaseline: '',
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      _fillTexts: [],
      save() {},
      restore() {},
      translate() {},
      rotate() {},
      scale() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      quadraticCurveTo() {},
      closePath() {},
      fill() {},
      stroke() {},
      measureText(t) { return { width: String(t).length * 6 }; },
      getTransform() { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; },
      fillText(t) { ctx._fillTexts.push(String(t)); }
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

// Every DisplayNode the catalog placed (across all Locations), as a flat list.
function allDisplayNodes(store) {
  const out = [];
  for (const loc of store.locations) {
    for (const n of (loc.displayNodes || [])) out.push(n);
  }
  return out;
}

// Render the LocationLayer for a level and capture the texts passed to fillText.
// Supports the constructor-arg seam `new LocationLayer(store, levelCode)` plus a
// `setLocationStore`/`setFloor` setter seam, so the test pins the EMITTED LABEL
// SET, not one wiring shape.
function renderLabels(LocationLayer, store, levelCode, ctx, { scale = 1, rotation = 0, dpr = 1 } = {}) {
  let layer;
  try {
    layer = new LocationLayer(store, levelCode);
  } catch {
    layer = new LocationLayer();
  }
  if (typeof layer.setLocationStore === 'function') layer.setLocationStore(store);
  if (typeof layer.setFloor === 'function') layer.setFloor(levelCode);
  layer.renderWithContext({ ctx, dpr, scale, rotation, invalidate: () => {} });
  return ctx._fillTexts.slice();
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

// Two tenanted shops whose label anchors COINCIDE — their screen-rects fully
// overlap, so the overlap-suppression must keep exactly one.
function makeOverlapBundle() {
  const baseUnit = (over) => ({
    id: 0, level_id: 10, layer_id: 1, kind: 'shop', name: '',
    geometry: square(0, 0), display_point: [5, 5], position: 0, is_active: true,
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
      // Two big, overlapping shop polygons whose label anchors are IDENTICAL [50,50].
      baseUnit({ id: 401, kind: 'shop', geometry: square(0, 0, 100), label_point: [50, 50], label_rotation: 0,
                 tenancies: [{ shop_id: 1, name: 'AlphaShopName' }] }),
      baseUnit({ id: 402, kind: 'shop', geometry: square(0, 0, 100), label_point: [50, 50], label_rotation: 0,
                 tenancies: [{ shop_id: 2, name: 'BetaShopName' }] })
    ],
    shops: [
      { id: 1, mall: 99, name: 'AlphaShopName', slug: 'alpha', category: 1, unit_number: 'M1-01', is_active: true },
      { id: 2, mall: 99, name: 'BetaShopName', slug: 'beta', category: 1, unit_number: 'M1-02', is_active: true }
    ],
    categories: [{ id: 1, name: 'Food', slug: 'food' }],
    navmesh_by_level: { 10: { envelope_dims: [200, 200] } },
    transitions: []
  };
}

// =============================================================================
// Criterion 1 — labelable predicate (tenancies.length>0 && kind.is_tenant && labelsVisible)
// =============================================================================
describe('map-labels: a label is emitted only for a labelable (tenanted + tenant-kind) unit', () => {
  let shim;
  beforeEach(() => { shim = installCanvasShim(); });
  afterEach(() => { shim.restore(); });

  it('emits the tenancy name for a tenanted shop unit but NO label for a vacant shop or an escalator', async () => {
    const LocationLayer = await importLocationLayer();
    const { store } = await buildCatalog(makeMiniBundle());
    const ctx = shim.makeCtx();

    const texts = renderLabels(LocationLayer, store, 'M1', ctx);

    // The tenanted shop's tenancy name is drawn.
    expect(texts).toContain('Mini Cafe');
    // The vacant shop-kind unit (302) and the escalator (303) draw NOTHING:
    // neither their shop names nor any escalator label appear.
    expect(texts).not.toContain('Mini Shop');
    expect(texts.some((t) => /escalator/i.test(t))).toBe(false);
    // Exactly one label total on this level (only unit 301 is labelable).
    expect(texts.length).toBe(1);
  });

  it('emits NOTHING when labelsVisible is off (layer hidden), even for the tenanted shop', async () => {
    const LocationLayer = await importLocationLayer();
    const { store } = await buildCatalog(makeMiniBundle());
    const ctx = shim.makeCtx();

    let layer;
    try { layer = new LocationLayer(store, 'M1'); } catch { layer = new LocationLayer(); }
    if (typeof layer.setLocationStore === 'function') layer.setLocationStore(store);
    if (typeof layer.setFloor === 'function') layer.setFloor('M1');
    // labelsVisible off — the Layer interface gates draw via `visible`.
    layer.visible = false;

    layer.renderWithContext({ ctx, dpr: 1, scale: 1, rotation: 0, invalidate: () => {} });
    expect(ctx._fillTexts.length).toBe(0);
  });

  it('on the real SGC L3 seed, every emitted label is a placed tenancy name (no vacant/connector text)', async () => {
    const LocationLayer = await importLocationLayer();
    const raw = loadSgcRaw();
    const { store } = await buildCatalog(raw);
    const ctx = shim.makeCtx();

    const texts = renderLabels(LocationLayer, store, 'L3', ctx, { scale: 1, rotation: 0 });

    // The set of legitimate L3 tenancy names (the only thing that may be drawn).
    const l3LevelId = raw.levels.find((l) => l.code === 'L3')?.id;
    const placedNames = new Set();
    for (const u of raw.units) {
      if (u.level_id !== l3LevelId) continue;
      const k = raw.kinds.find((kk) => kk.slug === u.kind);
      if (!k || !k.is_tenant) continue;
      for (const t of (u.tenancies || [])) {
        const shop = raw.shops.find((s) => s.id === t.shop_id);
        if (shop) placedNames.add(shop.name);
      }
    }
    // At least one real shop is placed on L3 (the seed has Starbucks et al.).
    expect(placedNames.size).toBeGreaterThan(0);
    // Some labels were actually drawn (the layer is not inert).
    expect(texts.length).toBeGreaterThan(0);
    // and EVERY drawn label is one of the placed tenancy names.
    for (const t of texts) {
      expect(placedNames.has(t), `drawn label "${t}" must be a placed L3 tenancy name`).toBe(true);
    }
  });
});

// =============================================================================
// Criterion 2 — anchor = label_point; angle = label_rotation deg->rad; pre-resolved
// =============================================================================
describe('map-labels: label anchor = label_point and angle = label_rotation converted deg->rad', () => {
  it('places the DisplayNode at label_point with rotation = 90deg -> PI/2 rad (no recompute)', async () => {
    const { store } = await buildCatalog(makeMiniBundle());

    // unit 301 is the tenanted shop: label_point [5,5], label_rotation 90 (degrees).
    const loc = store.getLocation('shop:1');
    expect(loc, 'shop:1 Location must exist').toBeTruthy();
    const node = loc.displayNodes.find((n) => String(n.unitId ?? n.id) === '301') ?? loc.displayNodes[0];
    expect(node, 'shop:1 must carry a DisplayNode for unit 301').toBeTruthy();

    // Anchor === the unit's label_point, verbatim (renderScale 1, no polylabel/OBB).
    expect(node.point.x).toBeCloseTo(5, 9);
    expect(node.point.y).toBeCloseTo(5, 9);

    // Angle === label_rotation converted degrees -> radians: 90deg -> PI/2.
    expect(node.rotation).toBeCloseTo(Math.PI / 2, 9);
    // and explicitly NOT the raw degrees value (the deg->rad conversion happened).
    expect(node.rotation).not.toBeCloseTo(90, 6);
  });

  it('maps a real SGC unit (label_rotation 90) to PI/2 radians at its exact label_point', async () => {
    const raw = loadSgcRaw();
    const { store } = await buildCatalog(raw);

    // The seed's unit 119 is a tenanted shop with label_rotation 90.
    const seedUnit = raw.units.find((u) => u.id === 119);
    expect(seedUnit, 'SGC unit 119 must exist with label_rotation 90').toBeTruthy();
    expect(seedUnit.label_rotation).toBe(90);

    const node = allDisplayNodes(store).find((n) => String(n.unitId ?? n.id) === '119');
    expect(node, 'a DisplayNode must be placed for unit 119').toBeTruthy();

    const [lx, ly] = seedUnit.label_point;
    expect(node.point.x).toBeCloseTo(lx, 6);
    expect(node.point.y).toBeCloseTo(ly, 6);
    expect(node.rotation).toBeCloseTo(Math.PI / 2, 9);
  });

  it('keeps a 0deg label_rotation at 0 radians (deg->rad is exact at the origin)', async () => {
    const { store } = await buildCatalog(makeMiniBundle());
    // unit 301 we already rotated; assert a real 0-rotation seed node stays 0.
    const raw = loadSgcRaw();
    const { store: sgc } = await buildCatalog(raw);
    const zeroUnit = raw.units.find((u) => u.label_rotation === 0 && (u.tenancies || []).length > 0);
    expect(zeroUnit, 'the seed has a tenanted unit at label_rotation 0').toBeTruthy();
    const node = allDisplayNodes(sgc).find((n) => String(n.unitId ?? n.id) === String(zeroUnit.id));
    expect(node, 'a DisplayNode must exist for the 0-rotation tenanted unit').toBeTruthy();
    expect(node.rotation).toBeCloseTo(0, 9);
  });
});

// =============================================================================
// Criterion 3 — _fitScale shrinks (<1) for a too-long label, clamps at 1 otherwise
// =============================================================================
describe('map-labels: _fitScale shrinks an oversized label and clamps at 1', () => {
  let shim;
  beforeEach(() => { shim = installCanvasShim(); });
  afterEach(() => { shim.restore(); });

  // _fitScale's port takes the label's natural (text-box) dimensions and the
  // unit's available extents and returns min(1, fitX, fitY). We call it across
  // the few plausible argument shapes so the test pins the SCALAR contract, not
  // one signature: (labelW, labelH, unitW, unitH) or ({labelWidth,labelHeight},
  // {width,height}).
  function callFit(fn, labelW, labelH, unitW, unitH) {
    const attempts = [
      () => fn(labelW, labelH, unitW, unitH),
      () => fn({ width: labelW, height: labelH }, { width: unitW, height: unitH }),
      () => fn({ labelWidth: labelW, labelHeight: labelH, unitWidth: unitW, unitHeight: unitH }),
      () => fn({ textWidth: labelW, textHeight: labelH }, { width: unitW, height: unitH })
    ];
    for (const a of attempts) {
      let v;
      try { v = a(); } catch { v = undefined; }
      if (typeof v === 'number' && Number.isFinite(v)) return v;
    }
    return undefined;
  }

  it('returns a value < 1 for a long label inside a small polygon (the box is shrunk to fit)', async () => {
    const fitScale = await importFitScale();
    // A 400-wide label that must fit a 100-wide unit -> scale must drop below 1.
    const scale = callFit(fitScale, 400, 20, 100, 100);
    expect(typeof scale, '_fitScale must return a finite number').toBe('number');
    expect(scale).toBeGreaterThan(0);
    expect(scale).toBeLessThan(1);
    // and roughly the limiting ratio (100/400 = 0.25), not an arbitrary shrink.
    expect(scale).toBeLessThanOrEqual(0.25 + 1e-6);
  });

  it('clamps to exactly 1 (never upscales) when the label already fits the polygon', async () => {
    const fitScale = await importFitScale();
    // A tiny 10x10 label in a roomy 1000x1000 unit could scale up to 100x — but
    // _fitScale must NOT upscale; it returns exactly 1.
    const scale = callFit(fitScale, 10, 10, 1000, 1000);
    expect(typeof scale, '_fitScale must return a finite number').toBe('number');
    expect(scale).toBe(1);
  });

  it('limits by the tighter of the two axes (height-bound polygon shrinks below 1)', async () => {
    const fitScale = await importFitScale();
    // Label fits in width (50<=1000) but is too tall (200 in a 100-tall unit):
    // the height axis binds, so scale < 1 (~100/200 = 0.5).
    const scale = callFit(fitScale, 50, 200, 1000, 100);
    expect(typeof scale).toBe('number');
    expect(scale).toBeLessThan(1);
    expect(scale).toBeLessThanOrEqual(0.5 + 1e-6);
  });
});

// =============================================================================
// Criterion 4 — overlapping screen-rects: the lower-priority label is suppressed
// =============================================================================
describe('map-labels: overlapping label rects suppress all but one (RectVisibility/rbush)', () => {
  let shim;
  beforeEach(() => { shim = installCanvasShim(); });
  afterEach(() => { shim.restore(); });

  it('keeps exactly one label when two tenanted shops share the same screen anchor', async () => {
    const LocationLayer = await importLocationLayer();
    const { store } = await buildCatalog(makeOverlapBundle());
    const ctx = shim.makeCtx();

    // Both shops anchor at world [50,50]; at scale 1 their label boxes coincide,
    // so the overlap-suppression must keep ONE and drop the other.
    const texts = renderLabels(LocationLayer, store, 'M1', ctx, { scale: 1, rotation: 0 });

    // Both names are real candidates...
    const drawnAlpha = texts.includes('AlphaShopName');
    const drawnBeta = texts.includes('BetaShopName');
    // ...but exactly ONE is drawn (the other is suppressed by overlap).
    expect(drawnAlpha || drawnBeta, 'at least one of the overlapping labels must draw').toBe(true);
    expect(drawnAlpha && drawnBeta, 'overlapping labels must not BOTH draw').toBe(false);
    expect(texts.length).toBe(1);
  });

  it('the RectVisibility/rbush path keeps only the first of two coincident rects', async () => {
    const computeVisibleRects = await importComputeVisibleRects();
    // Two identical, fully-overlapping axis-aligned rects at the same center.
    const rects = [
      { cx: 100, cy: 100, width: 80, height: 20, rotation: 0 },
      { cx: 100, cy: 100, width: 80, height: 20, rotation: 0 }
    ];
    const visible = computeVisibleRects(rects);
    // Only the first survives; the overlapping second is suppressed.
    expect(visible).toEqual([0]);
  });

  it('does NOT suppress two labels whose rects are far apart (both survive)', async () => {
    const computeVisibleRects = await importComputeVisibleRects();
    const rects = [
      { cx: 0, cy: 0, width: 20, height: 10, rotation: 0 },
      { cx: 10000, cy: 10000, width: 20, height: 10, rotation: 0 }
    ];
    const visible = computeVisibleRects(rects);
    expect(visible.sort((a, b) => a - b)).toEqual([0, 1]);
  });
});
// <<< TARS cap:map-labels
