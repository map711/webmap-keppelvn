// >>> TARS cap:destination-search
//
// destination-search — the built-in search control filters the REAL destination
// CATALOG by title/`search_tokens` (case-insensitive substring), renders matching
// results, and on selection opens an info card exposing the Location's
// title / venue / logo / description. Facilities are searchable; connectors and
// unplaced shops are not.
//
// These tests drive the REAL `WayfinderMapElement` web component over its REAL
// search DOM (the user-facing affordance for this `(ui)` capability): we set the
// search input's value + dispatch the `input` event the browser would, read back
// the result <button> list the component renders, click a result the way a user
// taps it, and read the info-card text/img the component populates. The data the
// search indexes is the REAL catalog built by the REAL BundleLoader + LocationStore
// from the real SGC fixture (5 placed shops, namespaced `shop:<id>` ids) and a
// synthetic mini-bundle (a placed `unit:<id>` toilet + an escalator connector) —
// so the assertions pin observable search BEHAVIOUR, not an internal method.
//
// Only the heavy `MapEngine` (canvas/renderer/fetch) is mocked: it is a thin stub
// that returns the REAL catalog from `getLocations()`/`getLocation(id)` and a
// success `focusLocation(id)`, so `#buildSearchIndex`/`#filterSearchResults`/
// `#renderSearchResults`/`#handleSearchClick`/`#updateSearchInfo` are the genuine
// production code under test. A minimal DOM shim stands in for the browser (no
// jsdom in this repo's node-env Vitest); the component guards every optional
// browser API (`ResizeObserver`/`matchMedia`/`visualViewport`) behind `typeof`
// checks, so the shim only needs the element/event surface the search path touches.
//
// Three test targets, one per acceptance criterion:
//   1. Query over title/search_tokens (case-insensitive substring) returns the
//      matching placed shop's Location; a no-match query returns an EMPTY result
//      set; an UNPLACED shop (no Location) is never searchable.
//   2. Selecting a result opens the info card with the Location's title, venue,
//      logo (when present), and description.
//   3. A facility Location is searchable ("toilet" -> the `unit:<id>` facility);
//      a connector unit never appears in results.
//
// The module is imported LAZILY (after the DOM shim is installed) so the suite
// COLLECTS cleanly; a missing module surfaces as a message-bearing assertion
// failure, not a file-level resolution crash.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BundleLoader } from '../../src/data/BundleLoader.js';
import { LocationStore } from '../../src/data/LocationModel.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');
const sgcFixturePath = join(repoRoot, 'test', 'fixtures', 'SGC_v001.json');

function loadSgcRaw() {
  return JSON.parse(readFileSync(sgcFixturePath, 'utf8'));
}

// --- Synthetic mini-bundle: a placed toilet facility + an escalator connector.
// Mirrors the destination-catalog fixture so "toilet" yields a `unit:<id>`
// facility Location and the escalator yields none. (The real SGC seed has zero
// facility units, so this is the only witness for criterion 3.) ---
function makeMiniBundle() {
  const square = (x, y) => ({
    type: 'Polygon',
    coordinates: [[[x, y], [x + 10, y], [x + 10, y + 10], [x, y + 10], [x, y]]]
  });
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
      { id: 10, name: 'M1', code: 'M1', position: 100, hidden: false, locked: false, opacity: 1.0 }
    ],
    layers: [
      { id: 1, level_id: 10, parent_id: null, name: 'L', position: 0, stroke_color: '', stroke_width: null, fill_color: '' }
    ],
    kinds: [
      { id: 1, slug: 'shop', label: 'Shop', position: 0, stroke_color: '#1e40af', stroke_width: 1.5, fill_color: '#dbeafe', is_system: true, is_tenant: true, is_routable: true, is_connector: false, is_accessible: false },
      { id: 2, slug: 'toilet', label: 'Toilet', position: 1, stroke_color: '#000', stroke_width: 1.0, fill_color: '#eee', is_system: true, is_tenant: false, is_routable: true, is_connector: false, is_accessible: true },
      { id: 3, slug: 'escalator', label: 'Escalator', position: 2, stroke_color: '#000', stroke_width: 1.0, fill_color: '#eee', is_system: true, is_tenant: false, is_routable: true, is_connector: true, is_accessible: false }
    ],
    units: [
      unit({ id: 201, level_id: 10, layer_id: 1, kind: 'shop', label_point: [5, 5], tenancies: [{ shop_id: 1, name: 'Dual Diner' }] }),
      unit({ id: 204, level_id: 10, layer_id: 1, kind: 'toilet', geometry: square(60, 0), label_point: [65, 5], tenancies: [] }),
      unit({ id: 205, level_id: 10, layer_id: 1, kind: 'escalator', geometry: square(80, 0), label_point: [85, 5], connector_group_id: 7, tenancies: [] })
    ],
    shops: [
      { id: 1, mall: 99, name: 'Dual Diner', slug: 'dual-diner', logo: '/media/dual.png', description: 'two floors of food', category: 1, unit_number: 'M-DUAL', contact_phone: '', contact_email: '', website: '', operating_hours: {}, is_active: true }
    ],
    categories: [{ id: 1, name: 'Food', slug: 'food', icon: null }],
    navmesh_by_level: {
      10: { vertices: [[0, 0]], triangles: [], adjacency: [], doors_by_unit: {}, centroids_by_unit: {}, envelope_dims: [140, 10] }
    },
    transitions: [
      { group_id: 7, name: 'mini-connector', direction: 'bidirectional', cost: 2.0, is_accessible: false, members: [{ unit_id: 205, level_id: 10, centroid: [85, 5], position: 100 }] }
    ]
  };
}

// Build the REAL destination catalog from a raw bundle via the REAL loader+store.
async function buildCatalog(rawBundle) {
  const loader = new BundleLoader({ load: () => Promise.resolve(structuredClone(rawBundle)) });
  const model = await loader.load('/bundle.json');
  const store = new LocationStore();
  store.hydrate(model, { renderScale: 1 });
  return store;
}

// ─────────────────────────────────────────────────────────────────────────────
// Minimal DOM shim. A single generic Element model serves every node the
// component builds; the component pokes dataset/style/textContent/className and
// dispatches input/click events, all of which this absorbs uniformly. Installed
// onto globals in beforeEach and torn down in afterEach.
// ─────────────────────────────────────────────────────────────────────────────
class ClassList {
  constructor() { this._set = new Set(); }
  add(...cs) { for (const c of cs) this._set.add(c); }
  remove(...cs) { for (const c of cs) this._set.delete(c); }
  toggle(c, force) {
    const has = this._set.has(c);
    const want = force === undefined ? !has : force;
    if (want) this._set.add(c); else this._set.delete(c);
    return want;
  }
  contains(c) { return this._set.has(c); }
  get value() { return [...this._set].join(' '); }
  toString() { return this.value; }
}

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = String(tagName).toUpperCase();
    this.nodeType = 1;
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.dataset = {};
    this.style = makeStyle();
    this.classList = new ClassList();
    this._listeners = new Map();
    this._textContent = '';
    this._innerHTML = '';
    this.hidden = false;
    this.value = '';
    this.type = '';
    this.placeholder = '';
    this.autocomplete = '';
    this.spellcheck = false;
    this.src = '';
    this.alt = '';
  }

  get className() { return this.classList.value; }
  set className(v) {
    this.classList = new ClassList();
    for (const c of String(v).split(/\s+/).filter(Boolean)) this.classList.add(c);
  }

  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); }

  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  removeChild(child) {
    const i = this.children.indexOf(child);
    if (i >= 0) this.children.splice(i, 1);
    child.parentNode = null;
    return child;
  }
  insertBefore(child, ref) {
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i < 0) return this.appendChild(child);
    child.parentNode = this;
    this.children.splice(i, 0, child);
    return child;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }

  get textContent() { return this._textContent; }
  set textContent(v) { this._textContent = String(v); this.children = []; }

  get innerHTML() { return this._innerHTML; }
  set innerHTML(v) { this._innerHTML = String(v); if (v === '') this.children = []; }

  get firstChild() { return this.children[0] ?? null; }
  get lastChild() { return this.children[this.children.length - 1] ?? null; }

  addEventListener(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(fn);
  }
  removeEventListener(type, fn) {
    const arr = this._listeners.get(type);
    if (arr) { const i = arr.indexOf(fn); if (i >= 0) arr.splice(i, 1); }
  }
  dispatchEvent(event) {
    event.target = event.target || this;
    let node = this;
    // bubble up the parent chain
    while (node) {
      const arr = node._listeners?.get(event.type);
      if (arr) for (const fn of [...arr]) fn.call(node, event);
      if (!event.bubbles) break;
      node = node.parentNode;
    }
    return !event.defaultPrevented;
  }

  // closest(): walk up matching a `.class`, `tag`, or `[data-attr]` selector.
  closest(selector) {
    let node = this;
    while (node) {
      if (node.matches?.(selector)) return node;
      node = node.parentNode;
    }
    return null;
  }
  matches(selector) {
    if (!selector) return false;
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
    if (selector.startsWith('[') && selector.endsWith(']')) {
      const key = selector.slice(1, -1);
      return this.dataset[camel(key.replace(/^data-/, ''))] !== undefined || this.attributes.has(key);
    }
    return this.tagName === selector.toUpperCase();
  }

  // Depth-first descendant queries over class / tag selectors.
  querySelector(selector) { return this._query(selector, false)[0] ?? null; }
  querySelectorAll(selector) { return this._query(selector, true); }
  _query(selector, all) {
    const out = [];
    const want = (el) => el.matches?.(selector);
    const walk = (el) => {
      for (const c of el.children) {
        if (want(c)) { out.push(c); if (!all) return true; }
        if (walk(c)) return true;
      }
      return false;
    };
    walk(this);
    return out;
  }

  contains(node) {
    let n = node;
    while (n) { if (n === this) return true; n = n.parentNode; }
    return false;
  }

  getBoundingClientRect() {
    return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };
  }
  scrollTo() {}
  focus() { if (this.getRootNode?.()) this.getRootNode()._activeElement = this; }
  blur() {}
  select() {}
  getRootNode() { let n = this; while (n.parentNode) n = n.parentNode; return n._root ?? n; }
}

function camel(s) { return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase()); }
function makeStyle() {
  const props = new Map();
  return {
    setProperty(k, v) { props.set(k, v); },
    removeProperty(k) { props.delete(k); },
    getPropertyValue(k) { return props.get(k) ?? ''; },
    display: '', maxHeight: ''
  };
}

class FakeShadowRoot extends FakeElement {
  constructor(host) {
    super('#shadow-root');
    this.host = host;
    this._root = this;
    this._activeElement = null;
  }
  get activeElement() { return this._activeElement; }
}

class FakeCustomEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail ?? null;
    this.bubbles = !!init.bubbles;
    this.composed = !!init.composed;
    this.defaultPrevented = false;
    this.target = null;
  }
  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() {}
}

function makeDocument() {
  const doc = new FakeElement('#document');
  doc.documentElement = new FakeElement('html');
  doc.body = new FakeElement('body');
  doc.createElement = (tag) => new FakeElement(tag);
  doc.createTextNode = (t) => { const n = new FakeElement('#text'); n._textContent = String(t); return n; };
  doc.addEventListener = () => {};
  doc.removeEventListener = () => {};
  return doc;
}

let savedGlobals;

function installDom() {
  savedGlobals = {
    document: globalThis.document,
    window: globalThis.window,
    HTMLElement: globalThis.HTMLElement,
    customElements: globalThis.customElements,
    CustomEvent: globalThis.CustomEvent,
    Event: globalThis.Event
  };

  const doc = makeDocument();

  class HTMLElementBase extends FakeElement {
    constructor() {
      super('wayfinder-map');
      this._root = this;
      this.ownerDocument = doc;
    }
    attachShadow() {
      const root = new FakeShadowRoot(this);
      this.shadowRoot = root;
      return root;
    }
  }

  const registry = new Map();
  const customElements = {
    define: (name, ctor) => registry.set(name, ctor),
    get: (name) => registry.get(name)
  };

  const win = {
    location: { href: 'http://localhost/' },
    innerWidth: 1280,
    innerHeight: 800,
    addEventListener: () => {},
    removeEventListener: () => {},
    requestAnimationFrame: (fn) => { fn(0); return 1; },
    cancelAnimationFrame: () => {}
    // intentionally NO matchMedia / visualViewport / ResizeObserver:
    // the component guards each behind a typeof check -> desktop defaults.
  };

  globalThis.document = doc;
  globalThis.window = win;
  globalThis.HTMLElement = HTMLElementBase;
  globalThis.customElements = customElements;
  globalThis.CustomEvent = FakeCustomEvent;
  globalThis.Event = FakeCustomEvent;
}

function restoreDom() {
  for (const [k, v] of Object.entries(savedGlobals)) {
    if (v === undefined) delete globalThis[k];
    else globalThis[k] = v;
  }
}

// A thin MapEngine stub backed by the REAL catalog. The component's search code
// reads `getLocations()`/`getLocation(id)` and calls `focusLocation(id)` on
// selection; everything else is an inert no-op so the lifecycle runs DOM-light.
function makeEngineStub(store) {
  const events = new Map();
  return {
    isInitialized: true,
    focusedId: null,
    init: () => Promise.resolve(),
    on(name, cb) {
      if (!events.has(name)) events.set(name, []);
      events.get(name).push(cb);
      return () => {};
    },
    once() { return () => {}; },
    off() {},
    emit(name, detail) { for (const cb of events.get(name) ?? []) cb(detail); },
    getLocations() { return store.locations; },
    getLocation(id) { return store.getLocation(id); },
    getLocationsByUnitId(unitId) { return store.getLocationsByUnitId(unitId); },
    focusLocation(id) {
      const location = store.getLocation(id);
      if (!location) return { success: false };
      this.focusedId = id;
      return { success: true, location, node: null, floor: location.levelCodes?.[0] ?? null };
    },
    clearRoute() { this.focusedId = null; },
    getCurrentFloor() { return 'L3'; },
    getFloors() { return store.levels.map((l) => l.code); },
    getLevels() { return store.levels; },
    setFloor() {},
    resize() {},
    hasRoute() { return false; },
    hasYouAreHere() { return false; },
    getRouteMode() { return 'escalator'; },
    setViewState() {},
    resetView() {},
    dispose() {}
  };
}

// Stand up a REAL WayfinderMapElement wired to a stub engine carrying `store`,
// with the search control enabled and indexed. Returns the element + the search
// DOM nodes the criteria observe.
async function mountSearch(store) {
  let mod = null;
  try {
    mod = await import('../../src/component/WayfinderMap.js');
  } catch {
    mod = null;
  }
  expect(mod, 'src/component/WayfinderMap.js must exist and export WayfinderMapElement').not.toBeNull();
  expect(mod.WayfinderMapElement, 'WayfinderMap.js must export WayfinderMapElement').toBeTypeOf('function');
  const WayfinderMapElement = mod.WayfinderMapElement;

  const el = new WayfinderMapElement();
  el.setAttribute('data-url', '/bundle.json');
  el.setAttribute('search-control', '');

  // Inject the stub engine + mark initialized via the real init seam: replace the
  // engine the element would build with our catalog-backed stub, then trigger the
  // real search-control enable path (the same path attributeChangedCallback uses).
  const engine = makeEngineStub(store);
  installEngine(el, engine);

  const shadow = el.shadowRoot;
  const searchContainer = shadow.querySelector('.wayfinder-search');
  const input = shadow.querySelector('input');
  const results = shadow.querySelector('.wayfinder-search-results');
  const info = shadow.querySelector('.wayfinder-search-info');
  expect(searchContainer, 'the component must build a .wayfinder-search container').toBeTruthy();
  expect(input, 'the search panel must contain an <input>').toBeTruthy();
  expect(results, 'the search panel must contain a .wayfinder-search-results list').toBeTruthy();
  expect(info, 'the search panel must contain a .wayfinder-search-info card').toBeTruthy();

  return { el, engine, shadow, searchContainer, input, results, info };
}

// Wire the stub engine into the element and enable search through the REAL
// lifecycle. We drive `init()` (MapEngine is mocked to our stub class below) so
// `#engine`/`#initialized` and the search control are set by production code.
function installEngine(el, engine) {
  __engineRef.current = engine;
  // init() builds the engine from the (mocked) MapEngine class, wires events, and
  // calls #syncSearchControl() -> #enableSearchControl() -> #buildSearchIndex().
  return el.init();
}

// Shared handle the mocked MapEngine constructor hands back our prepared stub.
const __engineRef = vi.hoisted(() => ({ current: null }));

vi.mock('../../src/core/MapEngine.js', () => ({
  MapEngine: class {
    constructor() { return __engineRef.current; }
  }
}));

// The result-button titles the component currently renders (criterion 1/3 obs).
function renderedResultTitles(results) {
  return results.children
    .filter((c) => c.tagName === 'BUTTON')
    .map((b) => b.textContent);
}
function renderedResultIds(results) {
  return results.children
    .filter((c) => c.tagName === 'BUTTON')
    .map((b) => b.dataset.locationId);
}

// Type a query into the search input the way a user does: set value + fire the
// `input` event the component listens for. Returns the rendered result titles.
function typeQuery(input, results, query) {
  input.value = query;
  input.dispatchEvent(new FakeCustomEvent('input', { bubbles: true }));
  return renderedResultTitles(results);
}

// Click the rendered result whose title matches, the way a user taps it.
function clickResult(results, title) {
  const button = results.children.find((c) => c.tagName === 'BUTTON' && c.textContent === title);
  expect(button, `a result button titled "${title}" must be rendered to click`).toBeTruthy();
  button.dispatchEvent(new FakeCustomEvent('click', { bubbles: true }));
  return button;
}

describe('destination-search: built-in search over the real catalog', () => {
  beforeEach(() => {
    installDom();
    __engineRef.current = null;
  });

  afterEach(() => {
    restoreDom();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Criterion 1 — case-insensitive substring filter; no-match -> empty; an
  //               unplaced shop is not searchable.
  // ───────────────────────────────────────────────────────────────────────────
  describe('criterion 1: query filters the catalog by title / search_tokens', () => {
    it('a query matching a placed shop name returns that shop\'s Location (by id) in results', async () => {
      const store = await buildCatalog(loadSgcRaw());
      const { input, results } = await mountSearch(store);

      const titles = typeQuery(input, results, 'starbucks'); // lowercase query
      expect(titles).toContain('Starbucks');
      // the rendered result carries the namespaced Location id (string), proving it
      // is the catalogued shop:10 Location, not a stray label.
      expect(renderedResultIds(results)).toContain('shop:10');
    });

    it('the substring match is case-insensitive and spans search_tokens (unit_number L1-01)', async () => {
      const store = await buildCatalog(loadSgcRaw());
      const { input, results } = await mountSearch(store);

      // "ABC" (uppercase) matches "ABC Mart Grand Stage" by name.
      expect(typeQuery(input, results, 'ABC')).toContain('ABC Mart Grand Stage');
      // a substring of the unit_number search token matches the same Location.
      expect(typeQuery(input, results, 'l1-01')).toContain('ABC Mart Grand Stage');
    });

    it('a query matching nothing returns an EMPTY result set (no result buttons; list hidden)', async () => {
      const store = await buildCatalog(loadSgcRaw());
      const { input, results } = await mountSearch(store);

      const titles = typeQuery(input, results, 'zzzznotashop');
      expect(titles).toEqual([]);
      expect(results.hidden).toBe(true);
    });

    it('an UNPLACED shop (in shops[] but no Location) is never searchable', async () => {
      const store = await buildCatalog(loadSgcRaw());
      const { input, results } = await mountSearch(store);

      // "adidas" is in shops[] (id 2) but referenced by no tenancy -> no Location.
      expect(store.getLocation('shop:2')).toBeFalsy();
      const titles = typeQuery(input, results, 'adidas');
      expect(titles).toEqual([]);
      expect(renderedResultIds(results)).not.toContain('shop:2');
    });

    it('the empty query surfaces exactly the 5 placed shops and none of the 20 raw shops', async () => {
      const raw = loadSgcRaw();
      const store = await buildCatalog(raw);
      const { input, results } = await mountSearch(store);

      // Open browse: empty query lists the whole searchable catalog.
      input.value = '';
      input.dispatchEvent(new FakeCustomEvent('focus', { bubbles: true }));
      const ids = renderedResultIds(results);
      expect(ids.sort()).toEqual(['shop:1', 'shop:10', 'shop:11', 'shop:4', 'shop:7'].sort());
      expect(ids.length).toBe(5);
      expect(raw.shops.length).toBe(20);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Criterion 2 — selecting a result opens an info card with title/venue/logo/
  //               description.
  // ───────────────────────────────────────────────────────────────────────────
  describe('criterion 2: selecting a result opens the info card', () => {
    it('makes the info card visible (data-visible="true") on selection', async () => {
      const store = await buildCatalog(loadSgcRaw());
      const { input, results, info } = await mountSearch(store);

      typeQuery(input, results, 'starbucks');
      clickResult(results, 'Starbucks');

      expect(info.dataset.visible).toBe('true');
    });

    it('exposes the Location title and venue in the info card', async () => {
      const store = await buildCatalog(loadSgcRaw());
      const { input, results, info } = await mountSearch(store);

      typeQuery(input, results, 'starbucks');
      clickResult(results, 'Starbucks');

      const title = info.querySelector('.wayfinder-search-info-title');
      const venue = info.querySelector('.wayfinder-search-info-venue');
      expect(title.textContent).toBe('Starbucks');
      expect(venue.textContent).toBe('Saigon Centre'); // mall name carried as venue
    });

    it('exposes the Location description in the info card', async () => {
      const raw = loadSgcRaw();
      const store = await buildCatalog(raw);
      const { input, results, info } = await mountSearch(store);

      typeQuery(input, results, 'starbucks');
      clickResult(results, 'Starbucks');

      const shop = raw.shops.find((s) => s.id === 10);
      const desc = info.querySelector('.wayfinder-search-info-description');
      expect(shop.description.length).toBeGreaterThan(0); // sanity: there IS a description
      expect(desc.textContent).toBe(shop.description);
    });

    it('shows the logo image (its src) in the info card when the shop has a logo', async () => {
      const raw = loadSgcRaw();
      const store = await buildCatalog(raw);
      const { input, results, info } = await mountSearch(store);

      typeQuery(input, results, 'starbucks');
      clickResult(results, 'Starbucks');

      const shop = raw.shops.find((s) => s.id === 10);
      expect(shop.logo).toBeTruthy(); // sanity: Starbucks has a logo
      const logoWrap = info.querySelector('.wayfinder-search-info-logo');
      const logoImg = logoWrap.querySelector('img') || logoWrap.children.find((c) => c.tagName === 'IMG');
      expect(logoImg.src).toBe(shop.logo);
      // the logo container is shown (not display:none) because a logo is present.
      expect(logoWrap.style.display).not.toBe('none');
    });

    it('routes the selection through engine.focusLocation with the namespaced string id', async () => {
      const store = await buildCatalog(loadSgcRaw());
      const { input, results, engine } = await mountSearch(store);
      const spy = vi.spyOn(engine, 'focusLocation');

      typeQuery(input, results, 'asics');
      clickResult(results, 'ASICS');

      // the click must focus the REAL catalogued Location id (a string), not NaN.
      expect(spy).toHaveBeenCalledWith('shop:7', expect.anything());
      expect(engine.focusedId).toBe('shop:7');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Criterion 3 — facilities are searchable; connectors never appear.
  // ───────────────────────────────────────────────────────────────────────────
  describe('criterion 3: facilities searchable, connectors excluded (mini-bundle)', () => {
    it('querying "toilet" returns the unit:<id> facility Location', async () => {
      const store = await buildCatalog(makeMiniBundle());
      const { input, results } = await mountSearch(store);

      // sanity: the catalog DID produce the facility Location.
      expect(store.getLocation('unit:204')).toBeTruthy();

      const titles = typeQuery(input, results, 'toilet');
      expect(titles).toContain('Toilet');
      expect(renderedResultIds(results)).toContain('unit:204');
    });

    it('a connector unit (escalator) never appears in search results', async () => {
      const store = await buildCatalog(makeMiniBundle());
      const { input, results } = await mountSearch(store);

      // sanity: the escalator produced NO Location at all.
      expect(store.getLocation('unit:205')).toBeFalsy();

      // neither a name query nor a browse-all listing surfaces the connector.
      expect(typeQuery(input, results, 'escalator')).toEqual([]);

      input.value = '';
      input.dispatchEvent(new FakeCustomEvent('focus', { bubbles: true }));
      const allIds = renderedResultIds(results);
      expect(allIds).not.toContain('unit:205');
      // browse-all lists exactly the placed shop + the toilet facility.
      expect(allIds.sort()).toEqual(['shop:1', 'unit:204'].sort());
    });
  });
});
// <<< TARS cap:destination-search
