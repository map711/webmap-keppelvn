// >>> TARS cap:floor-rendering
//
// floor-rendering — the unit-aware FloorLayer. This capability has five distinct
// test targets, one per acceptance criterion:
//
//   1. resolveStyle(unit, layersById, kindsBySlug) — the indoorcms cascade
//      (unit || layer || kind || default; `""`/`null` = inherit; fallbacks
//      #000 / #ccc / width 1).
//   2. geometryToPoints — a closed GeoJSON ring of N+1 coords -> N points
//      (the closing duplicate vertex is dropped).
//   3. per active level: exactly one drawable polygon per unit ON that level and
//      none from other levels; switching levels changes the set; editor
//      hidden/locked/opacity flags do NOT affect output; an empty level (L1, 0
//      units) -> zero polygons without error.
//   4. MapLevel.getBounds() fallback chain: navmesh -> envelope_dims; meshless
//      with units -> finite bbox union; meshless + unit-less (L1) -> a neutral,
//      finite, non-degenerate default extent (never empty/NaN).
//   5. FloorLayer.hitTest(x,y) -> unitId (null for empty space); and
//      HitTestManager.#classifyHit (exercised via the public gesture:tap path)
//      turns a catalogued unitId into `tap:location` and a non-catalogued one
//      into `tap:floor`.
//
// Pure Node/Vitest. The to-be-built modules are imported LAZILY so the suite
// COLLECTS cleanly and each test fails on its own behavioural assertion (not a
// module-resolution crash); a missing module surfaces as a message-bearing
// assertion failure (assertion-shaped RED). The real SGC_v001 fixture is the
// ground truth; a hand-written mini-bundle pins the edge cases the seed lacks.

import { describe, it, expect, vi, beforeEach } from 'vitest';
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

// resolveStyle lives in src/data/StyleResolver.js per the plan's module map.
async function importResolveStyle() {
  const mod = await importModule('../../src/data/StyleResolver.js', 'src/data/StyleResolver.js');
  const fn = mod.resolveStyle ?? mod.default;
  expect(fn, 'StyleResolver.js must export a resolveStyle function').toBeTypeOf('function');
  return fn;
}

// geometryToPoints is a ported pure helper; the plan places it with the geometry
// model. Resolve across the few plausible export sites so the test pins the
// BEHAVIOUR (ring -> points), not one module path.
async function importGeometryToPoints() {
  const candidates = [
    '../../src/data/MapGeometryModel.js',
    '../../src/data/StyleResolver.js',
    '../../src/data/geometry.js',
    '../../src/utils/geometry.js'
  ];
  for (const rel of candidates) {
    let mod = null;
    try {
      mod = await import(rel);
    } catch {
      mod = null;
    }
    if (mod && typeof mod.geometryToPoints === 'function') return mod.geometryToPoints;
  }
  // Force an assertion-shaped failure naming the contract, not an import crash.
  expect(
    null,
    'geometryToPoints must be exported from a data/util module (MapGeometryModel.js or a geometry util)'
  ).toBeTypeOf('function');
}

async function importMapGeometryStore() {
  const mod = await importModule('../../src/data/MapGeometryModel.js', 'src/data/MapGeometryModel.js');
  expect(mod.MapGeometryStore, 'MapGeometryModel.js must export MapGeometryStore').toBeTypeOf('function');
  return mod.MapGeometryStore;
}

async function importFloorLayer() {
  const mod = await importModule('../../src/layers/FloorLayer.js', 'src/layers/FloorLayer.js');
  expect(mod.FloorLayer, 'FloorLayer.js must export FloorLayer').toBeTypeOf('function');
  return mod.FloorLayer;
}

async function importHitTestManager() {
  const mod = await importModule('../../src/interaction/HitTestManager.js', 'src/interaction/HitTestManager.js');
  expect(mod.HitTestManager, 'HitTestManager.js must export HitTestManager').toBeTypeOf('function');
  return mod.HitTestManager;
}

async function importEventBus() {
  const mod = await importModule('../../src/core/EventBus.js', 'src/core/EventBus.js');
  expect(mod.EventBus, 'EventBus.js must export EventBus').toBeTypeOf('function');
  return mod.EventBus;
}

// --- Tolerant accessors over the (rebuilt) MapLevel / FloorLayer ------------

// Build the geometry store from a raw bundle via the real BundleLoader, then
// hydrate. Mirrors the engine seam: BundleLoader.load(url) -> model -> store.hydrate(model).
async function buildGeometry(rawBundle) {
  const MapGeometryStore = await importMapGeometryStore();
  const loader = new BundleLoader({
    load: () => Promise.resolve(structuredClone(rawBundle))
  });
  const model = await loader.load('/bundle.json');
  const store = new MapGeometryStore();
  store.hydrate(model, { renderScale: 1 });
  return { store, model };
}

function levelByCode(store, code) {
  if (typeof store.getLevelByCode === 'function') return store.getLevelByCode(code);
  return (store.levels || []).find((l) => l.code === code);
}

// The active-level drawable set, however the rebuilt MapLevel/FloorLayer expose
// it. The criterion is "one drawable polygon per unit on the active level"; this
// resolves that collection across the small set of accessor shapes so the test
// pins the SET (count + unit ids + point geometry), not one method name.
function drawablesOf(level) {
  if (!level) return null;
  const candidates = [
    () => (typeof level.getDrawables === 'function' ? level.getDrawables() : undefined),
    () => (typeof level.getDrawablePolygons === 'function' ? level.getDrawablePolygons() : undefined),
    () => (typeof level.getUnitPolygons === 'function' ? level.getUnitPolygons() : undefined),
    () => (typeof level.getPolygons === 'function' ? level.getPolygons() : undefined),
    () => level.drawables,
    () => level.unitPolygons,
    () => level.polygons
  ];
  for (const get of candidates) {
    const v = get();
    if (Array.isArray(v)) return v;
  }
  return null;
}

// The unit id carried by a drawable, across the shapes a drawable record may take.
function drawableUnitId(d) {
  if (d == null) return undefined;
  return d.unitId ?? d.unit_id ?? d.id ?? (d.unit && (d.unit.id ?? d.unit.unitId));
}

// The polygon points of a drawable, normalized to {x,y}. Handles {points:[{x,y}]},
// {points:[[x,y]]}, or a bare points array.
function drawablePoints(d) {
  if (d == null) return [];
  let pts = d.points ?? d.polygon?.points ?? (Array.isArray(d) ? d : null);
  if (!Array.isArray(pts)) return [];
  return pts.map((p) => (Array.isArray(p) ? { x: p[0], y: p[1] } : { x: p.x, y: p.y }));
}

// --- Mini-bundle: a 2-level world with a meshed M1 and a MESHLESS M2. --------
// Counts diverge from SGC so a hard-coded layer would fail. M1 carries one shop
// unit (with editor flags FLIPPED to prove they are ignored) and one escalator;
// M2 carries one shop unit. M2 is meshless but unit-bearing (the bbox-union
// fallback witness).
function square(x, y, s = 10) {
  return {
    type: 'Polygon',
    coordinates: [[[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]]
  };
}

function makeMiniBundle() {
  const unit = (over) => ({
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
      { id: 10, name: 'M1', code: 'M1', position: 100, hidden: false, locked: false, opacity: 1.0 },
      { id: 20, name: 'M2', code: 'M2', position: 200, hidden: false, locked: false, opacity: 1.0 }
    ],
    layers: [
      { id: 1, level_id: 10, parent_id: null, name: 'L', position: 0, stroke_color: '', stroke_width: null, fill_color: '' },
      { id: 2, level_id: 20, parent_id: null, name: 'L', position: 0, stroke_color: '', stroke_width: null, fill_color: '' }
    ],
    kinds: [
      { id: 1, slug: 'shop', label: 'Shop', position: 0, stroke_color: '#1e40af', stroke_width: 1.5, fill_color: '#dbeafe', is_system: true, is_tenant: true, is_routable: true, is_connector: false, is_accessible: false },
      { id: 2, slug: 'escalator', label: 'Escalator', position: 1, stroke_color: '#92400e', stroke_width: 1.5, fill_color: '#fde68a', is_system: true, is_tenant: false, is_routable: true, is_connector: true, is_accessible: false }
    ],
    units: [
      // M1: a shop with hidden/locked TRUE and opacity 0 — editor flags must be ignored.
      unit({ id: 301, level_id: 10, layer_id: 1, kind: 'shop', geometry: square(0, 0),
             hidden: true, locked: true, opacity: 0,
             tenancies: [{ shop_id: 1, name: 'Mini Cafe' }] }),
      // M1: an escalator (still a drawable polygon — facility units render too).
      unit({ id: 302, level_id: 10, layer_id: 1, kind: 'escalator', geometry: square(20, 0),
             connector_group_id: 7, tenancies: [] }),
      // M2 (meshless level): a shop unit -> exercises the bbox-union bounds fallback.
      unit({ id: 303, level_id: 20, layer_id: 2, kind: 'shop', geometry: square(40, 40),
             label_point: [45, 45], tenancies: [{ shop_id: 2, name: 'Mini Shop' }] })
    ],
    shops: [
      { id: 1, mall: 99, name: 'Mini Cafe', slug: 'mini-cafe', logo: null, description: '', category: 1, unit_number: 'M1-01', contact_phone: '', contact_email: '', website: '', operating_hours: {}, is_active: true },
      { id: 2, mall: 99, name: 'Mini Shop', slug: 'mini-shop', logo: null, description: '', category: 1, unit_number: 'M2-01', contact_phone: '', contact_email: '', website: '', operating_hours: {}, is_active: true }
    ],
    categories: [{ id: 1, name: 'Food', slug: 'food', icon: null }],
    // Only M1 (id 10) has a mesh; M2 (id 20) is MESHLESS (key absent).
    navmesh_by_level: {
      10: {
        vertices: [[0, 0], [10, 0], [10, 10]],
        triangles: [[0, 1, 2]],
        adjacency: [[-1, -1, -1]],
        doors_by_unit: {},
        centroids_by_unit: {},
        envelope_dims: [123, 77]
      }
    },
    transitions: [
      { group_id: 7, name: 'mini-connector', direction: 'bidirectional', cost: 2.0, is_accessible: false,
        members: [{ unit_id: 302, level_id: 10, centroid: [25, 5], position: 100 }] }
    ]
  };
}

// =============================================================================
// Criterion 1 — resolveStyle cascade
// =============================================================================
describe('floor-rendering: resolveStyle cascade (unit || layer || kind || default)', () => {
  // A kind with full style, a layer that inherits, and a unit we vary.
  const kind = {
    slug: 'shop', stroke_color: '#1e40af', stroke_width: 1.5, fill_color: '#dbeafe'
  };
  const inheritLayer = { id: 1, level_id: 10, stroke_color: '', stroke_width: null, fill_color: '' };

  function baseUnit(over) {
    return {
      id: 1, level_id: 10, layer_id: 1, kind: 'shop',
      stroke_color: '', stroke_width: null, fill_color: '', ...over
    };
  }

  async function resolve(unit, { layersById, kindsBySlug } = {}) {
    const resolveStyle = await importResolveStyle();
    const layers = layersById ?? new Map([[1, inheritLayer]]);
    const kinds = kindsBySlug ?? new Map([['shop', kind]]);
    return resolveStyle(unit, layers, kinds);
  }

  it('inherits the kind stroke_color when the unit stroke_color is "" (empty string)', async () => {
    const style = await resolve(baseUnit({ stroke_color: '' }));
    expect(style.strokeColor ?? style.stroke_color).toBe('#1e40af');
  });

  it('inherits the kind stroke_width when the unit stroke_width is null', async () => {
    const style = await resolve(baseUnit({ stroke_width: null }));
    expect(style.strokeWidth ?? style.stroke_width).toBe(1.5);
  });

  it('lets an explicit unit fill_color override the kind fill_color', async () => {
    const style = await resolve(baseUnit({ fill_color: '#ff00aa' }));
    expect(style.fillColor ?? style.fill_color).toBe('#ff00aa');
    // and it is NOT the kind's fill.
    expect(style.fillColor ?? style.fill_color).not.toBe('#dbeafe');
  });

  it('uses the kind style verbatim when neither unit nor layer override anything', async () => {
    const style = await resolve(baseUnit({}));
    expect(style.strokeColor ?? style.stroke_color).toBe('#1e40af');
    expect(style.strokeWidth ?? style.stroke_width).toBe(1.5);
    expect(style.fillColor ?? style.fill_color).toBe('#dbeafe');
  });

  it('prefers an explicit unit value over the kind (unit wins the cascade)', async () => {
    const style = await resolve(baseUnit({ stroke_color: '#123456', stroke_width: 9 }));
    expect(style.strokeColor ?? style.stroke_color).toBe('#123456');
    expect(style.strokeWidth ?? style.stroke_width).toBe(9);
  });

  it('falls back to #000 / #ccc / width 1 when unit, layer, and kind all under-specify', async () => {
    // A kind with all-inherit values; nothing supplies a concrete style.
    const emptyKind = { slug: 'ghost', stroke_color: '', stroke_width: null, fill_color: '' };
    const style = await resolve(
      baseUnit({ kind: 'ghost', stroke_color: '', stroke_width: null, fill_color: '' }),
      {
        layersById: new Map([[1, { id: 1, stroke_color: '', stroke_width: null, fill_color: '' }]]),
        kindsBySlug: new Map([['ghost', emptyKind]])
      }
    );
    expect(style.strokeColor ?? style.stroke_color).toBe('#000');
    expect(style.fillColor ?? style.fill_color).toBe('#ccc');
    expect(style.strokeWidth ?? style.stroke_width).toBe(1);
  });
});

// =============================================================================
// Criterion 2 — geometryToPoints drops the closing ring vertex
// =============================================================================
describe('floor-rendering: geometryToPoints drops the closing ring duplicate', () => {
  it('returns N points for a closed ring of N+1 coordinates (4 distinct + 1 closer -> 4)', async () => {
    const geometryToPoints = await importGeometryToPoints();
    const closedRing = {
      type: 'Polygon',
      coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] // 5 coords, ring closes
    };
    const pts = geometryToPoints(closedRing);
    expect(Array.isArray(pts)).toBe(true);
    expect(pts.length).toBe(4); // closing duplicate dropped

    // the points are the four distinct corners (order preserved), as {x,y} or [x,y].
    const norm = pts.map((p) => (Array.isArray(p) ? { x: p[0], y: p[1] } : { x: p.x, y: p.y }));
    expect(norm).toEqual([
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }
    ]);
  });

  it('drops exactly one vertex on a real SGC unit ring (7 coords -> 6 points)', async () => {
    const geometryToPoints = await importGeometryToPoints();
    const raw = loadSgcRaw();
    const unit = raw.units.find(
      (u) => u.geometry && u.geometry.type === 'Polygon' && u.geometry.coordinates[0].length === 7
    );
    expect(unit, 'the SGC seed has a 7-coordinate ring to test against').toBeTruthy();

    const ring = unit.geometry.coordinates[0];
    // sanity: this ring really is closed (first === last).
    expect(ring[0]).toEqual(ring[ring.length - 1]);

    const pts = geometryToPoints(unit.geometry);
    expect(pts.length).toBe(6);
  });
});

// =============================================================================
// Criterion 3 — per-active-level drawable set
// =============================================================================
describe('floor-rendering: per-active-level drawable polygons', () => {
  it('produces exactly one drawable per unit on a level and NONE from other levels (SGC L2 vs L3)', async () => {
    const { store } = await buildGeometry(loadSgcRaw());
    const l2 = levelByCode(store, 'L2');
    const l3 = levelByCode(store, 'L3');
    expect(l2, 'L2 must resolve').toBeTruthy();
    expect(l3, 'L3 must resolve').toBeTruthy();

    const l2Draw = drawablesOf(l2);
    const l3Draw = drawablesOf(l3);
    expect(l2Draw, 'L2 must expose a drawable polygon set').not.toBeNull();
    expect(l3Draw, 'L3 must expose a drawable polygon set').not.toBeNull();

    // Ground truth on the seed: 74 active units on L2 (id 4), 82 on L3 (id 5).
    expect(l2Draw.length).toBe(74);
    expect(l3Draw.length).toBe(82);

    // The drawables' unit ids are exactly the level-4 / level-5 unit ids — no cross-level leakage.
    const raw = loadSgcRaw();
    const l2UnitIds = new Set(raw.units.filter((u) => u.level_id === 4).map((u) => u.id));
    const l3UnitIds = new Set(raw.units.filter((u) => u.level_id === 5).map((u) => u.id));

    const drawnL2 = new Set(l2Draw.map(drawableUnitId));
    const drawnL3 = new Set(l3Draw.map(drawableUnitId));

    expect(drawnL2).toEqual(l2UnitIds);
    expect(drawnL3).toEqual(l3UnitIds);
    // No L3 unit appears in the L2 set (and vice-versa).
    for (const id of drawnL3) expect(l2UnitIds.has(id)).toBe(false);
  });

  it('switching the active level changes the produced drawable set (mini M1 -> M2)', async () => {
    const { store } = await buildGeometry(makeMiniBundle());
    const m1 = levelByCode(store, 'M1');
    const m2 = levelByCode(store, 'M2');

    const m1Ids = new Set(drawablesOf(m1).map(drawableUnitId));
    const m2Ids = new Set(drawablesOf(m2).map(drawableUnitId));

    // M1 holds units 301 (shop) + 302 (escalator); M2 holds unit 303 (shop).
    expect([...m1Ids].sort()).toEqual([301, 302]);
    expect([...m2Ids].sort()).toEqual([303]);
    // disjoint sets — switching levels swaps the whole drawable set.
    expect([...m1Ids].some((id) => m2Ids.has(id))).toBe(false);
  });

  it('renders a drawable for a unit whose editor hidden/locked flags are true and opacity is 0', async () => {
    const { store } = await buildGeometry(makeMiniBundle());
    const m1 = levelByCode(store, 'M1');
    const drawables = drawablesOf(m1);

    // unit 301 has hidden:true, locked:true, opacity:0 in the mini-bundle — yet it draws.
    const hiddenUnit = drawables.find((d) => drawableUnitId(d) === 301);
    expect(hiddenUnit, 'unit 301 must still produce a drawable despite editor flags').toBeTruthy();

    // its polygon is the four-corner ring of square(0,0,10) (closing vertex dropped).
    const pts = drawablePoints(hiddenUnit);
    expect(pts.length).toBe(4);
  });

  it('produces ZERO drawables for the empty L1 (0 units) without throwing', async () => {
    const { store } = await buildGeometry(loadSgcRaw());
    const l1 = levelByCode(store, 'L1');
    expect(l1, 'L1 must resolve as a selectable (empty) level').toBeTruthy();

    let drawables;
    expect(() => { drawables = drawablesOf(l1); }).not.toThrow();
    expect(drawables, 'L1 must expose an (empty) drawable set, not null').not.toBeNull();
    expect(drawables.length).toBe(0);
  });
});

// =============================================================================
// Criterion 4 — MapLevel.getBounds() fallback chain
// =============================================================================
describe('floor-rendering: MapLevel.getBounds() fallback chain', () => {
  function isFiniteBounds(b) {
    return b
      && Number.isFinite(b.minX) && Number.isFinite(b.minY)
      && Number.isFinite(b.maxX) && Number.isFinite(b.maxY);
  }
  function spanOf(b) {
    const w = (b.width != null) ? b.width : (b.maxX - b.minX);
    const h = (b.height != null) ? b.height : (b.maxY - b.minY);
    return { w, h };
  }

  it('a level WITH a navmesh frames to its envelope_dims (SGC L2 -> [4363.33, 4478.25])', async () => {
    const { store } = await buildGeometry(loadSgcRaw());
    const l2 = levelByCode(store, 'L2');
    const bounds = l2.getBounds();
    expect(isFiniteBounds(bounds)).toBe(true);

    // envelope_dims for level id 4 (L2) from the seed.
    const { w, h } = spanOf(bounds);
    expect(w).toBeCloseTo(4363.32642610794, 2);
    expect(h).toBeCloseTo(4478.24524562068, 2);
  });

  it('a MESHLESS level WITH units frames to the finite bbox union of its unit polygons (mini M2)', async () => {
    const { store } = await buildGeometry(makeMiniBundle());
    const m2 = levelByCode(store, 'M2');
    const bounds = m2.getBounds();
    expect(isFiniteBounds(bounds)).toBe(true);

    // M2's single unit (303) is square(40,40,10): bbox covers [40,40]..[50,50].
    expect(bounds.minX).toBeCloseTo(40, 6);
    expect(bounds.minY).toBeCloseTo(40, 6);
    expect(bounds.maxX).toBeCloseTo(50, 6);
    expect(bounds.maxY).toBeCloseTo(50, 6);
    const { w, h } = spanOf(bounds);
    expect(w).toBeCloseTo(10, 6);
    expect(h).toBeCloseTo(10, 6);
  });

  it('a MESHLESS, UNIT-LESS level (SGC L1) frames to a finite, non-degenerate neutral default (not NaN/empty)', async () => {
    const { store } = await buildGeometry(loadSgcRaw());
    const l1 = levelByCode(store, 'L1');

    let bounds;
    expect(() => { bounds = l1.getBounds(); }).not.toThrow();
    expect(isFiniteBounds(bounds)).toBe(true);

    const { w, h } = spanOf(bounds);
    // neutral default extent: finite and non-degenerate (a real, positive area).
    expect(Number.isFinite(w)).toBe(true);
    expect(Number.isFinite(h)).toBe(true);
    expect(w).toBeGreaterThan(0);
    expect(h).toBeGreaterThan(0);
  });
});

// =============================================================================
// Criterion 5 — FloorLayer.hitTest -> unitId; HitTestManager classification
// =============================================================================
describe('floor-rendering: FloorLayer.hitTest returns the containing unitId', () => {
  async function buildFloorLayer(rawBundle, levelCode) {
    const FloorLayer = await importFloorLayer();
    const { store } = await buildGeometry(rawBundle);
    const level = levelByCode(store, levelCode);
    expect(level, `${levelCode} must resolve`).toBeTruthy();
    const layer = new FloorLayer();
    // The layer is fed the active MapLevel; support either constructor-arg or setter seam.
    if (typeof layer.setMapLevel === 'function') layer.setMapLevel(level);
    else if (typeof layer.setLevel === 'function') layer.setLevel(level);
    return { layer, level };
  }

  it('returns the unitId of the polygon containing the point (mini M1 unit 301 at [5,5])', async () => {
    const { layer } = await buildFloorLayer(makeMiniBundle(), 'M1');
    // unit 301 is square(0,0,10); (5,5) is interior.
    const hit = layer.hitTest(5, 5);
    expect(hit).toBe(301);
  });

  it('returns the OTHER unit id when the point lands inside the escalator polygon (unit 302 at [25,5])', async () => {
    const { layer } = await buildFloorLayer(makeMiniBundle(), 'M1');
    // unit 302 is square(20,0,10); (25,5) is interior to it, not to 301.
    const hit = layer.hitTest(25, 5);
    expect(hit).toBe(302);
  });

  it('returns null for a point in empty space (no unit polygon contains it)', async () => {
    const { layer } = await buildFloorLayer(makeMiniBundle(), 'M1');
    // Tie the null to a POPULATED layer: it must hit a real unit interior first,
    // so a geometry-blind layer (returns null for everything) does NOT pass here.
    expect(layer.hitTest(5, 5)).toBe(301);
    // (1000,1000) is far outside every M1 unit -> genuine empty-space miss.
    expect(layer.hitTest(1000, 1000)).toBeNull();
  });
});

describe('floor-rendering: HitTestManager classifies a unit hit (via the gesture:tap seam)', () => {
  let EventBus;
  let HitTestManager;

  beforeEach(async () => {
    EventBus = await importEventBus();
    HitTestManager = await importHitTestManager();
  });

  // A LayerStack stub whose hitTest returns whatever the test stages — so the
  // classification is driven by the FloorLayer's unitId contract, not by the
  // manager mocking itself.
  function makeLayerStack(hitResult) {
    return { hitTest: () => hitResult };
  }

  // A LocationStore stub: unit ids in `cataloguedUnitIds` own one Location;
  // anything else owns none. Mirrors getLocationsByUnitId's one-to-many contract.
  function makeLocationStore(cataloguedUnitIds) {
    const set = new Set(cataloguedUnitIds);
    return {
      getLocationsByUnitId(unitId) {
        return set.has(unitId) ? [{ id: `shop:${unitId}`, title: `Shop ${unitId}` }] : [];
      }
    };
  }

  function collectTapEvents(bus) {
    const events = [];
    for (const type of ['tap:location', 'tap:floor', 'tap:empty', 'tap:unknown']) {
      bus.on(type, (detail) => events.push({ type, detail }));
    }
    return events;
  }

  it('turns a CATALOGUED unitId into a tap:location event', async () => {
    const bus = new EventBus();
    const layerStack = makeLayerStack({ unitId: 108 }); // 108 is catalogued below
    const locationStore = makeLocationStore([108]);

    // The manager needs the LocationStore to resolve unitId -> Location(s); pass it
    // through whichever constructor seam the rebuilt manager exposes.
    let manager;
    try {
      manager = new HitTestManager(layerStack, bus, locationStore);
    } catch {
      manager = new HitTestManager(layerStack, bus);
    }
    if (typeof manager.setLocationStore === 'function') manager.setLocationStore(locationStore);

    const events = collectTapEvents(bus);
    bus.emit('gesture:tap', { worldX: 5, worldY: 5, screenX: 0, screenY: 0 });

    const types = events.map((e) => e.type);
    expect(types).toContain('tap:location');
    expect(types).not.toContain('tap:floor');
  });

  it('turns a NON-catalogued unitId into a tap:floor event', async () => {
    const bus = new EventBus();
    const layerStack = makeLayerStack({ unitId: 999 }); // not catalogued
    const locationStore = makeLocationStore([108]); // 999 absent

    let manager;
    try {
      manager = new HitTestManager(layerStack, bus, locationStore);
    } catch {
      manager = new HitTestManager(layerStack, bus);
    }
    if (typeof manager.setLocationStore === 'function') manager.setLocationStore(locationStore);

    const events = collectTapEvents(bus);
    bus.emit('gesture:tap', { worldX: 5, worldY: 5, screenX: 0, screenY: 0 });

    const types = events.map((e) => e.type);
    expect(types).toContain('tap:floor');
    expect(types).not.toContain('tap:location');
  });
});
// <<< TARS cap:floor-rendering
