// >>> TARS cap:search-to-route
//
// search-to-route — the (ui) "from/to search + connector toggles drive
// engine.navigateTo" contract.
//
// RED TARGET (the one genuinely-unbuilt seam in this capability). Almost the
// whole from/to + summary + clearRoute + route:error->route-error nav UI is
// already carried in the Phase-2 scaffolding and runs green. The ONE behavior
// this capability still owes is the production connector-toggle path:
//
//     [click lift/escalator toggle] -> #setNavConnectorConstraint({reroute:true})
//       -> navigateTo({connectorConstraint:'lift-only'|'escalator-only'})
//       -> engine.navigateTo(from,to,{connectorConstraint})
//       -> RouteManager.navigateTo -> PathFinder.findPath(...,{connectorConstraint})
//
// Today PathFinder.#resolveOptions reads ONLY `stepFree`; `connectorConstraint`
// is dropped on the floor, so a `lift-only` request still returns the cheaper
// ESCALATOR connector. The acceptance criterion is "the lift/escalator toggle
// ... drives a re-route (a subsequent route reflects the chosen connector
// kind)" — so the binding assertion is: after the lift toggle, the ACTIVE
// route's transition kind is `elevator` (the lift), not `escalator`. That is
// the assertion that is RED against the current tree.
//
// In the synthetic routing fixture (test/navigation/routingFixture.js) the two
// cross-floor connectors joining F1<->F2 are: an `escalator` group (cost 1.0,
// is_accessible:false, the DEFAULT/cheaper pick) and an `elevator`/lift group
// (cost 2.0, is_accessible:true). Default routing picks the escalator; only an
// honored `connectorConstraint:'lift-only'` flips the chosen connector to the
// elevator — which is exactly what the lift toggle must achieve.
//
// What is REAL vs mocked:
//   - Every test mounts the REAL WayfinderMapElement over the REAL MapEngine
//     (no MapEngine doMock for the toggle/route tests): the from/to selection,
//     the connector toggles, and the public `element.navigateTo(...)` all flow
//     through the genuine production wiring into the genuine router, and the
//     resulting route (its connector kind, its success/failure) is read off the
//     genuine RouteManager via `engine.getCurrentRoute()` / the returned
//     RouteResult. Only the canvas/DOM-bound collaborators are mocked: Renderer
//     (inert camera), GestureRecognizer (inert), and the three nav layers
//     (NavigationLayer / NavMarkerLayer / PinMarkerLayer) as RECORDING stubs so
//     "a polyline is / isn't drawn" is genuinely observed via setPath/clearPath.
//   - The route:error -> DOM `route-error` re-emit is captured as a genuine DOM
//     event off the real element via a bus-only engine stub.
//
// A minimal DOM shim (mirroring the destination-search / destination-focus
// suites) stands in for the browser this node-env Vitest lacks; it exposes a
// controllable `matchMedia` so a test can force the mobile layout under which
// the summary panel renders, and `Element` globally so the component's
// `instanceof Element` locate-control guard accepts shim nodes (the lift/
// escalator toggles live on the locate rail). Modules are imported LAZILY so
// the suite COLLECTS cleanly; a missing module is a message-bearing assertion
// failure, not a file-level resolution crash.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRoutingBundle, SHOP_A_ID, SHOP_B_ID } from '../navigation/routingFixture.js';

// ─────────────────────────────────────────────────────────────────────────────
// Renderer mock — inert shell. transform.getViewState().scale === 1 baseline;
// animateTo/fitToBounds are inert recorders the engine pokes during a nav pan.
// ─────────────────────────────────────────────────────────────────────────────
vi.mock('../../src/renderer/Renderer.js', () => {
  class MockTransform {
    setScaleBounds() {}
    getScaleBounds() { return { min: 0.1, max: 8 }; }
    fitToBounds() {}
    getViewState() { return { scale: 1, panX: 0, panY: 0, rotation: 0 }; }
    setViewState() {}
    pan() {} zoom() {} centerOn() {} resetRotation() {}
    screenToWorld() { return { x: 0, y: 0 }; }
    getCanvasCenter() { return { x: 0, y: 0 }; }
  }
  return {
    Renderer: class {
      constructor() {
        this.transform = new MockTransform();
        this.layers = { add: () => {} };
        this.animator = { cancel() {} };
      }
      fitToBounds() {}
      animateTo() {}
      requestRender() {}
      resize() {}
      dispose() {}
    }
  };
});

vi.mock('../../src/interaction/GestureRecognizer.js', () => ({
  GestureRecognizer: class { dispose() {} }
}));

// NavigationLayer mock that RECORDS the engine's path calls — "a polyline is
// drawn" (success) vs "no polyline drawn" (failure) and the clear on
// browse-return are observables, so they flow through a capturing stub.
const navLayerState = vi.hoisted(() => ({ setPaths: [], clearPaths: 0 }));
vi.mock('../../src/layers/NavigationLayer.js', () => ({
  NavigationLayer: class {
    name = 'NavigationLayer';
    setFloor() {}
    setPath(result) { navLayerState.setPaths.push(result); }
    clearPath() { navLayerState.clearPaths += 1; }
    stopAnimation() {}
  }
}));

const navMarkerState = vi.hoisted(() => ({ setPaths: [], clears: 0 }));
vi.mock('../../src/layers/NavMarkerLayer.js', () => ({
  NavMarkerLayer: class {
    name = 'NavMarkerLayer';
    setFloor() {} setStyle() {} setLevelOrdinals() {}
    setPath(result) { navMarkerState.setPaths.push(result); }
    clear() { navMarkerState.clears += 1; }
  }
}));

const pinLayerState = vi.hoisted(() => ({ setPaths: [], clears: 0 }));
vi.mock('../../src/layers/PinMarkerLayer.js', () => ({
  PinMarkerLayer: class {
    name = 'PinMarkerLayer';
    setFloor() {} setStyle() {} setIconSources() {} setYouAreHereNode() {}
    setYouAreHereVisible() {} setManualEndLocation() {}
    setPath(result) { pinLayerState.setPaths.push(result); }
    clear() { pinLayerState.clears += 1; }
  }
}));

// ─────────────────────────────────────────────────────────────────────────────
// Minimal DOM shim (same model the destination-search / -focus suites use).
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
    while (node) {
      const arr = node._listeners?.get(event.type);
      if (arr) for (const fn of [...arr]) fn.call(node, event);
      if (!event.bubbles) break;
      node = node.parentNode;
    }
    return !event.defaultPrevented;
  }
  closest(selector) {
    let node = this;
    while (node) { if (node.matches?.(selector)) return node; node = node.parentNode; }
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
  contains(node) { let n = node; while (n) { if (n === this) return true; n = n.parentNode; } return false; }
  getBoundingClientRect() { return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 }; }
  scrollTo() {}
  focus() {}
  blur() {}
  select() {}
  getRootNode() { let n = this; while (n.parentNode) n = n.parentNode; return n._root ?? n; }
}
class FakeShadowRoot extends FakeElement {
  constructor(host) { super('#shadow-root'); this.host = host; this._root = this; this._activeElement = null; }
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
  composedPath() { return []; }
}
// The engine requires its canvas to be `instanceof HTMLCanvasElement`; the
// component builds its canvas via `document.createElement('canvas')`, so the
// shim document must mint a real HTMLCanvasElement instance for that tag.
class FakeCanvasElement extends FakeElement {
  constructor() { super('canvas'); }
  getContext() { return {}; }
}
function makeDocument() {
  const doc = new FakeElement('#document');
  doc.documentElement = new FakeElement('html');
  doc.body = new FakeElement('body');
  doc.createElement = (tag) =>
    String(tag).toLowerCase() === 'canvas' ? new FakeCanvasElement() : new FakeElement(tag);
  doc.createTextNode = (t) => { const n = new FakeElement('#text'); n._textContent = String(t); return n; };
  doc.addEventListener = () => {};
  doc.removeEventListener = () => {};
  return doc;
}

let savedGlobals;
// `mobile` toggles the matchMedia('(max-width:768px)') match so a test can force
// the mobile layout the summary panel renders under.
function installDom({ mobile = false } = {}) {
  savedGlobals = {
    document: globalThis.document,
    window: globalThis.window,
    HTMLElement: globalThis.HTMLElement,
    HTMLCanvasElement: globalThis.HTMLCanvasElement,
    Element: globalThis.Element,
    Node: globalThis.Node,
    customElements: globalThis.customElements,
    CustomEvent: globalThis.CustomEvent,
    Event: globalThis.Event
  };

  const doc = makeDocument();
  class HTMLElementBase extends FakeElement {
    constructor() { super('wayfinder-map'); this._root = this; this.ownerDocument = doc; }
    attachShadow() { const root = new FakeShadowRoot(this); this.shadowRoot = root; return root; }
  }
  const registry = new Map();
  const win = {
    location: { href: 'http://localhost/' },
    innerWidth: mobile ? 390 : 1280,
    innerHeight: mobile ? 800 : 800,
    addEventListener: () => {},
    removeEventListener: () => {},
    requestAnimationFrame: (fn) => { fn(0); return 1; },
    cancelAnimationFrame: () => {},
    matchMedia: (q) => ({
      matches: mobile
        ? /max-width:\s*768px|pointer:\s*coarse/.test(q)
        : false,
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {}
    })
  };

  globalThis.document = doc;
  globalThis.window = win;
  globalThis.HTMLElement = HTMLElementBase;
  globalThis.HTMLCanvasElement = FakeCanvasElement;
  globalThis.Element = FakeElement;
  globalThis.Node = FakeElement;
  globalThis.customElements = { define: (n, c) => registry.set(n, c), get: (n) => registry.get(n) };
  globalThis.CustomEvent = FakeCustomEvent;
  globalThis.Event = FakeCustomEvent;
}
function restoreDom() {
  if (!savedGlobals) return;
  for (const [k, v] of Object.entries(savedGlobals)) {
    if (v === undefined) delete globalThis[k];
    else globalThis[k] = v;
  }
  savedGlobals = null;
}

// Make BundleLoader's single fetch resolve the routing-fixture bundle.
function jsonResponse(obj) {
  return {
    ok: true, status: 200,
    headers: { get: () => 'application/json' },
    clone() { return jsonResponse(obj); },
    json: () => Promise.resolve(obj)
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Mount the REAL WayfinderMapElement over the REAL MapEngine (no MapEngine
// doMock), hydrated from a (possibly customized) routing-fixture bundle via the
// one-fetch BundleLoader. The component's REAL init() builds the genuine engine
// + router + nav UI; search is enabled so the from/to nav fields resolve catalog
// ids. Returns the element, its real engine, the search nav DOM nodes, and — the
// crux of this capability — the connector toggle buttons on the locate rail.
// ─────────────────────────────────────────────────────────────────────────────
async function mountRealEngineComponent({ mobile = false, bundle } = {}) {
  installDom({ mobile });
  globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(bundle ?? makeRoutingBundle()));

  vi.resetModules();
  vi.doUnmock('../../src/core/MapEngine.js');

  let mod = null;
  try {
    mod = await import('../../src/component/WayfinderMap.js');
  } catch {
    mod = null;
  }
  expect(mod, 'src/component/WayfinderMap.js must exist and export WayfinderMapElement').not.toBeNull();
  expect(mod.WayfinderMapElement, 'WayfinderMap.js must export WayfinderMapElement').toBeTypeOf('function');

  const el = new mod.WayfinderMapElement();
  el.setAttribute('maps-url', '/maps_bundle.json.gz');
  el.setAttribute('datas-url', '/datas_bundle.json.gz');
  el.setAttribute('search-control', '');
  el.setAttribute('default-floor', 'F1');
  await el.init();
  expect(el.isInitialized, 'the component must initialize so the nav UI + router are live').toBe(true);

  const shadow = el.shadowRoot;
  const navFields = shadow.querySelectorAll('.wayfinder-search-nav-field');
  const fromField = navFields.find((f) => f.dataset.field === 'from') ?? null;
  const toField = navFields.find((f) => f.dataset.field === 'to') ?? null;
  const inputIn = (field) => (field ? field.children.find((c) => c.tagName === 'INPUT') ?? null : null);
  const allButtons = shadow.querySelectorAll('button');
  const nodes = {
    el,
    engine: el.engine,
    shadow,
    fromInput: inputIn(fromField),
    toInput: inputIn(toField),
    fromField,
    toField,
    summary: shadow.querySelector('.wayfinder-search-nav-summary'),
    summaryFrom: null,
    summaryTo: null,
    liftToggle: allButtons.find((b) => b.dataset.action === 'nav-connector-lift') ?? null,
    escalatorToggle: allButtons.find((b) => b.dataset.action === 'nav-connector-escalator') ?? null,
    directionButton: shadow.querySelector('.wayfinder-search-direction')
  };
  if (nodes.summary) {
    const rows = nodes.summary.querySelectorAll('.wayfinder-search-nav-summary-row');
    nodes.summaryFrom = rows[0]?.querySelector('span') ?? null;
    nodes.summaryTo = rows[1]?.querySelector('span') ?? null;
  }
  return nodes;
}

// Drive the nav UI exactly as a user does: open directions, type a query into
// the active field, then click the rendered result whose title matches.
function searchResultButtons(shadow) {
  const results = shadow.querySelector('.wayfinder-search-results');
  return results ? results.children.filter((c) => c.tagName === 'BUTTON') : [];
}
function selectNavField(field) {
  field.dispatchEvent(new FakeCustomEvent('click', { bubbles: true }));
}
function typeInto(input, value) {
  input.value = value;
  input.dispatchEvent(new FakeCustomEvent('input', { bubbles: true }));
}
function clickResultTitled(shadow, title) {
  const btn = searchResultButtons(shadow).find((b) => b.textContent === title);
  expect(btn, `a result button titled "${title}" must be rendered to click`).toBeTruthy();
  btn.dispatchEvent(new FakeCustomEvent('click', { bubbles: true }));
  return btn;
}
function clickButton(btn) {
  expect(btn, 'the button must exist to click').toBeTruthy();
  btn.dispatchEvent(new FakeCustomEvent('click', { bubbles: true }));
}

// Read the connector kind off the engine's ACTIVE route (a cross-floor route
// carries exactly one transition).
function activeConnectorKind(engine) {
  const route = engine.getCurrentRoute();
  expect(route, 'an active route must exist to read its connector kind').toBeTruthy();
  expect(route.transitions.length, 'a cross-floor route carries one transition').toBe(1);
  return route.transitions[0].kind;
}

// ─────────────────────────────────────────────────────────────────────────────
// A stub engine carrying a GENUINE on/emit bus, for the pure engine->DOM re-emit
// half of criterion 3 (route:error -> DOM route-error). Only the bus + the inert
// lifecycle surface init() pokes are present.
// ─────────────────────────────────────────────────────────────────────────────
const wiredEngineRef = vi.hoisted(() => ({ current: null }));
function makeBusEngineStub() {
  const events = new Map();
  return {
    isInitialized: true,
    init: () => Promise.resolve(),
    on(name, cb) {
      if (!events.has(name)) events.set(name, []);
      events.get(name).push(cb);
      return () => {};
    },
    once() { return () => {}; },
    off() {},
    emit(name, detail) { for (const cb of [...(events.get(name) ?? [])]) cb(detail); },
    getLocations() { return []; },
    getLocation() { return undefined; },
    getCurrentFloor() { return 'F1'; },
    getFloors() { return ['F1']; },
    getLevels() { return []; },
    setFloor() {}, resize() {},
    hasRoute() { return false; },
    hasYouAreHere() { return false; },
    getRouteMode() { return 'escalator'; },
    setViewState() {}, resetView() {},
    navigateTo() { return { success: false }; },
    focusLocation() { return { success: false }; },
    clearRoute() {},
    dispose() {}
  };
}
async function mountBusComponent() {
  installDom({ mobile: false });
  wiredEngineRef.current = makeBusEngineStub();
  vi.resetModules();
  vi.doMock('../../src/core/MapEngine.js', () => ({
    MapEngine: class { constructor() { return wiredEngineRef.current; } }
  }));
  let mod = null;
  try {
    mod = await import('../../src/component/WayfinderMap.js');
  } catch { mod = null; }
  expect(mod, 'src/component/WayfinderMap.js must exist and export WayfinderMapElement').not.toBeNull();
  const el = new mod.WayfinderMapElement();
  el.setAttribute('maps-url', '/maps_bundle.json.gz');
  el.setAttribute('datas-url', '/datas_bundle.json.gz');
  await el.init();
  return { el, engine: wiredEngineRef.current };
}

describe('search-to-route: from/to search + connector toggles drive navigateTo', () => {
  beforeEach(() => {
    navLayerState.setPaths = []; navLayerState.clearPaths = 0;
    navMarkerState.setPaths = []; navMarkerState.clears = 0;
    pinLayerState.setPaths = []; pinLayerState.clears = 0;
    wiredEngineRef.current = null;
  });

  afterEach(() => {
    delete globalThis.fetch;
    restoreDom();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Criterion 1 — choose from + to -> engine.navigateTo(fromId,toId) with the
  //   namespaced STRING ids; on success map mode -> navigation + summary shows
  //   the resolved from/to titles.
  // ───────────────────────────────────────────────────────────────────────────
  describe('criterion 1: choosing from + to triggers navigateTo and populates the summary', () => {
    it('calls engine.navigateTo with the STRING-namespaced from/to ids (shop:1, shop:3)', async () => {
      const { el, engine, shadow, fromField, fromInput, toField, toInput, directionButton } =
        await mountRealEngineComponent();
      const spy = vi.spyOn(engine, 'navigateTo');

      directionButton.dispatchEvent(new FakeCustomEvent('click', { bubbles: true }));
      selectNavField(fromField);
      typeInto(fromInput, 'Shop A');
      clickResultTitled(shadow, 'Shop A');
      selectNavField(toField);
      typeInto(toInput, 'Shop B');
      clickResultTitled(shadow, 'Shop B');

      expect(spy).toHaveBeenCalled();
      const call = spy.mock.calls[spy.mock.calls.length - 1];
      // the engine must receive the namespaced catalog ids, as STRINGS — never NaN
      // or a numeric pk (the ghost of the old numeric-id contract).
      expect(call[0]).toBe(SHOP_A_ID); // 'shop:1'
      expect(call[1]).toBe(SHOP_B_ID); // 'shop:3'
      expect(typeof call[0]).toBe('string');
      expect(typeof call[1]).toBe('string');
      // a real route was produced for this pair (sanity that the ids resolve).
      expect(el.engine.hasRoute()).toBe(true);
    });

    it('sets the map mode to "navigation" on a successful from->to selection', async () => {
      const { el, shadow, fromField, fromInput, toField, toInput, directionButton } =
        await mountRealEngineComponent();

      directionButton.dispatchEvent(new FakeCustomEvent('click', { bubbles: true }));
      selectNavField(fromField);
      typeInto(fromInput, 'Shop A');
      clickResultTitled(shadow, 'Shop A');
      selectNavField(toField);
      typeInto(toInput, 'Shop B');
      clickResultTitled(shadow, 'Shop B');

      expect(shadow.querySelector('.wayfinder-search').dataset.mode).toBe('navigation');
      expect(el.hasRoute).toBe(true);
    });

    it('populates the summary panel with the resolved from/to titles (mobile layout)', async () => {
      const { shadow, fromField, fromInput, toField, toInput, directionButton, summaryFrom, summaryTo } =
        await mountRealEngineComponent({ mobile: true });

      directionButton.dispatchEvent(new FakeCustomEvent('click', { bubbles: true }));
      selectNavField(fromField);
      typeInto(fromInput, 'Shop A');
      clickResultTitled(shadow, 'Shop A');
      selectNavField(toField);
      typeInto(toInput, 'Shop B');
      clickResultTitled(shadow, 'Shop B');

      const summary = shadow.querySelector('.wayfinder-search-nav-summary');
      expect(summary.dataset.visible).toBe('true');
      expect(summaryFrom.textContent).toBe('Shop A');
      expect(summaryTo.textContent).toBe('Shop B');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Criterion 2 (THE RED HEART) — the lift / escalator toggle BUTTON drives a
  //   re-route. Activating the lift toggle on an active route re-routes so the
  //   chosen connector kind flips to the lift (`elevator`); the escalator toggle
  //   re-routes to the escalator. The step-free option re-routes over the
  //   accessible (lift) connector.
  //
  //   These click the REAL `nav-connector-lift` / `nav-connector-escalator`
  //   buttons on the locate rail — exercising #setNavConnectorConstraint(
  //   {reroute:true}) -> navigateTo({connectorConstraint}) -> the router. Today
  //   the router IGNORES connectorConstraint (PathFinder.#resolveOptions reads
  //   only stepFree), so the lift toggle leaves the route on the cheaper
  //   ESCALATOR — the assertion below is RED until the constraint is honored.
  // ───────────────────────────────────────────────────────────────────────────
  describe('criterion 2: lift/escalator toggle + step-free drive a re-route', () => {
    it('clicking the lift toggle on an active route re-routes onto the lift (elevator) connector and marks the button active', async () => {
      const { el, engine, liftToggle } = await mountRealEngineComponent();

      // Establish the default cross-floor route shop:1 (F1) -> shop:3 (F2). With
      // no constraint the cheaper ESCALATOR group is chosen.
      const base = el.navigateTo({ from: SHOP_A_ID, to: SHOP_B_ID });
      expect(base.success).toBe(true);
      expect(activeConnectorKind(engine)).toBe('escalator');

      // Click the REAL lift toggle. #setNavConnectorConstraint({reroute:true})
      // must re-route with connectorConstraint:'lift-only'.
      clickButton(liftToggle);

      // (a) the active route now uses the LIFT (elevator) connector — RED today.
      expect(activeConnectorKind(engine)).toBe('elevator');
      expect(engine.getCurrentRoute().transitions[0].is_accessible).toBe(true);
      // (b) the lift button reflects its pressed/active state.
      expect(liftToggle.dataset.active).toBe('true');
    });

    it('clicking the escalator toggle (after lift) re-routes back onto the escalator connector and marks it active', async () => {
      const { el, engine, liftToggle, escalatorToggle } = await mountRealEngineComponent();

      el.navigateTo({ from: SHOP_A_ID, to: SHOP_B_ID });
      // Force lift first so the escalator click is a real state change, not a no-op.
      clickButton(liftToggle);
      expect(activeConnectorKind(engine)).toBe('elevator');

      clickButton(escalatorToggle);

      expect(activeConnectorKind(engine)).toBe('escalator');
      expect(escalatorToggle.dataset.active).toBe('true');
      // turning on escalator-only clears the lift-only pressed state.
      expect(liftToggle.dataset.active).toBe('false');
    });

    it('a route:found emitted after the lift toggle reflects the elevator-kind connector', async () => {
      const { el, engine, liftToggle } = await mountRealEngineComponent();

      el.navigateTo({ from: SHOP_A_ID, to: SHOP_B_ID });

      const found = [];
      engine.on('route:found', (detail) => found.push(detail));

      clickButton(liftToggle);

      const last = found[found.length - 1];
      expect(last, 'the re-route must emit a fresh route:found').toBeTruthy();
      // the emitted payload carries the lift transition the toggle selected.
      expect(last.transitions[0].kind).toBe('elevator');
    });

    it('the public connectorConstraint:"lift-only" option forces the lift connector for a cross-floor route', async () => {
      const { el } = await mountRealEngineComponent();

      // Same seam, exercised directly through the public option the toggle drives.
      const result = el.navigateTo({ from: SHOP_A_ID, to: SHOP_B_ID, connectorConstraint: 'lift-only' });
      expect(result.success).toBe(true);
      expect(result.transitions.length).toBe(1);
      expect(result.transitions[0].kind).toBe('elevator'); // RED: constraint ignored today
      expect(result.transitions[0].is_accessible).toBe(true);
    });

    it('the step-free option re-routes over the accessible (lift) connector, avoiding the inaccessible escalator', async () => {
      const { el } = await mountRealEngineComponent();

      // The escalator group is inaccessible; demanding step-free must drop it and
      // use the accessible lift instead.
      const result = el.navigateTo({ from: SHOP_A_ID, to: SHOP_B_ID, stepFree: true });
      expect(result.success).toBe(true);
      expect(result.transitions.length).toBe(1);
      expect(result.transitions[0].kind).toBe('elevator');
      expect(result.transitions[0].is_accessible).toBe(true);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Criterion 3 — a failed route surfaces the error in the UI (route-error DOM
  //   event), the router reports no active route, and NO polyline is drawn.
  // ───────────────────────────────────────────────────────────────────────────
  describe('criterion 3: a failed route surfaces an error and draws no polyline', () => {
    it('routing to a meshless-level destination dispatches a DOM `route-error` and reports no route', async () => {
      // F0 (id 30) is meshless -> any destination resolving only to F0 is unroutable.
      const bundle = makeRoutingBundle();
      bundle.units.push({
        id: 399, level_id: 30, layer_id: 1, kind: 'shop', name: '',
        geometry: { type: 'Polygon', coordinates: [[[0, 0], [8, 0], [8, 8], [0, 8], [0, 0]]] },
        display_point: [4, 4], label_point: [4, 4], label_rotation: 0, position: 0,
        is_active: true, hidden: false, locked: false, opacity: 1.0,
        stroke_color: '', stroke_width: null, fill_color: '', doors: [],
        connector_group_id: null, tenancies: [{ shop_id: 9, name: 'Meshless Shop' }]
      });
      bundle.shops.push({
        id: 9, mall: 700, name: 'Meshless Shop', slug: 'meshless', logo: null,
        description: 'on a meshless floor', category: 1, unit_number: 'X',
        contact_phone: '', contact_email: '', website: '', operating_hours: {}, is_active: true
      });

      const { el } = await mountRealEngineComponent({ bundle });

      const errors = [];
      el.addEventListener('route-error', (ev) => errors.push(ev));

      navLayerState.setPaths = [];
      const result = el.engine.navigateTo(SHOP_A_ID, 'shop:9');

      // typed failure, never a throw.
      expect(result.success).toBe(false);
      expect(typeof result.code).toBe('string');
      // surfaced to the DOM as a `route-error` CustomEvent.
      expect(errors.length, 'a failed route must dispatch a route-error DOM event').toBeGreaterThan(0);
      expect(errors[errors.length - 1].type).toBe('route-error');
      // router reports no active route, and NO polyline was drawn for the failure.
      expect(el.engine.hasRoute()).toBe(false);
      expect(navLayerState.setPaths.length).toBe(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Criterion 3 (re-emit half) — the component must re-emit the engine's
  //   `route:error` bus event to the DOM as `route-error` via #wireEvents.
  // ───────────────────────────────────────────────────────────────────────────
  describe('criterion 3 (re-emit): the component forwards route:error to the DOM', () => {
    it("re-emits the engine's route:error as a DOM `route-error` event carrying the failure code", async () => {
      const { el, engine } = await mountBusComponent();

      const received = [];
      el.addEventListener('route-error', (ev) => received.push(ev));

      engine.emit('route:error', { error: 'No path', code: 'meshless-level', fromId: SHOP_A_ID, toId: 'shop:9' });

      expect(received.length, 'the component must forward route:error to the DOM').toBe(1);
      expect(received[0].type).toBe('route-error');
      expect(received[0].detail.code).toBe('meshless-level');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Criterion 4 — clearRoute from the UI returns to browse mode (summary hidden,
  //   route layers cleared).
  // ───────────────────────────────────────────────────────────────────────────
  describe('criterion 4: clearRoute returns to browse + clears route layers', () => {
    it('clearRoute() after an active route restores browse mode and hides the nav summary', async () => {
      const { el, shadow } = await mountRealEngineComponent({ mobile: true });

      const result = el.navigateTo({ from: SHOP_A_ID, to: SHOP_B_ID });
      expect(result.success).toBe(true);
      expect(el.hasRoute).toBe(true);

      el.clearRoute();

      expect(shadow.querySelector('.wayfinder-search').dataset.mode).toBe('browse');
      expect(shadow.querySelector('.wayfinder-search-nav-summary').dataset.visible).toBe('false');
      expect(el.hasRoute).toBe(false);
    });

    it('clearRoute() clears the navigation route layers (clearPath + nav-marker clear)', async () => {
      const { el } = await mountRealEngineComponent();

      el.navigateTo({ from: SHOP_A_ID, to: SHOP_B_ID });
      const clearsBefore = navLayerState.clearPaths;
      const markerClearsBefore = navMarkerState.clears;

      el.clearRoute();

      expect(navLayerState.clearPaths).toBeGreaterThan(clearsBefore);
      expect(navMarkerState.clears).toBeGreaterThan(markerClearsBefore);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Criterion 5 — element.navigateTo({from,to}) returns the RouteResult and
  //   drives the SAME rendering as the built-in UI. The connector-constrained
  //   form must also drive the same constrained route the toggle produces.
  // ───────────────────────────────────────────────────────────────────────────
  describe('criterion 5: the public navigateTo({from,to}) API returns RouteResult + renders', () => {
    it('returns a success RouteResult carrying the resolved start/end Locations', async () => {
      const { el } = await mountRealEngineComponent();

      const result = el.navigateTo({ from: SHOP_A_ID, to: SHOP_B_ID });
      expect(result.success).toBe(true);
      expect(result.segments instanceof Map || typeof result.segments === 'object').toBe(true);
      expect(result.transitions.length).toBe(1);
      expect(result.startLocation.id).toBe(SHOP_A_ID);
      expect(result.endLocation.id).toBe(SHOP_B_ID);
    });

    it('drives the same rendering as the UI: the nav layer receives the successful path', async () => {
      const { el } = await mountRealEngineComponent();

      navLayerState.setPaths = [];
      const result = el.navigateTo({ from: SHOP_A_ID, to: SHOP_B_ID });
      expect(result.success).toBe(true);

      expect(navLayerState.setPaths.length).toBeGreaterThan(0);
      const drawn = navLayerState.setPaths[navLayerState.setPaths.length - 1];
      expect(drawn.success).toBe(true);
      expect(drawn.transitions.length).toBe(1);
    });

    it('the constrained public navigateTo draws the SAME lift route the toggle produces', async () => {
      const { el, engine, liftToggle } = await mountRealEngineComponent();

      // Path 1: the public connectorConstraint option.
      navLayerState.setPaths = [];
      const apiResult = el.navigateTo({ from: SHOP_A_ID, to: SHOP_B_ID, connectorConstraint: 'lift-only' });
      expect(apiResult.success).toBe(true);
      const apiDrawn = navLayerState.setPaths[navLayerState.setPaths.length - 1];
      expect(apiDrawn.transitions[0].kind).toBe('elevator'); // RED today

      // Path 2: the built-in lift toggle, starting from a default route.
      el.clearRoute();
      el.navigateTo({ from: SHOP_A_ID, to: SHOP_B_ID });
      navLayerState.setPaths = [];
      clickButton(liftToggle);
      const uiDrawn = navLayerState.setPaths[navLayerState.setPaths.length - 1];
      expect(uiDrawn, 'the toggle re-route must hand a fresh path to the nav layer').toBeTruthy();

      // Both routes select the same (lift) connector — public API == built-in UI.
      expect(uiDrawn.transitions[0].kind).toBe(apiDrawn.transitions[0].kind);
      expect(activeConnectorKind(engine)).toBe('elevator');
    });

    it('a failed public navigateTo returns a non-success result without drawing a polyline', async () => {
      const { el } = await mountRealEngineComponent();

      navLayerState.setPaths = [];
      const result = el.navigateTo({ from: SHOP_A_ID, to: 'shop:does-not-exist' });
      expect(result.success).toBe(false);
      expect(navLayerState.setPaths.length).toBe(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Regression — the locate-rail "walk" (locate-start) and "pin" (locate-focus)
  // buttons recenter the camera on the route's start / destination shop. The
  // route RESULT carries no start/end Node (only anchors + the start/end
  // Location), so #centerOnTarget resolves the shop's node from the Location.
  // The SGC catalog populates `displayNodes`, NOT the legacy `nodes` array;
  // reading the empty legacy array left BOTH buttons inert in navigation mode
  // (the live bug). These drive the REAL buttons over the REAL engine and assert
  // the camera recenters on the shop's display-node point.
  // ───────────────────────────────────────────────────────────────────────────
  describe('locate rail: start/destination recenter buttons', () => {
    function locateButton(shadow, action) {
      const btn = shadow.querySelectorAll('button').find((b) => b.dataset.action === action);
      expect(btn, `a "${action}" button must exist on the locate rail`).toBeTruthy();
      return btn;
    }
    function displayPoint(el, id, levelCode) {
      const loc = el.getLocation(id);
      expect(loc, `location ${id} must resolve from the catalog`).toBeTruthy();
      const nodes = Array.isArray(loc.displayNodes) ? loc.displayNodes : [];
      const node = nodes.find((n) => n.levelCode === levelCode) ?? nodes[0];
      expect(node?.point, `location ${id} must carry a display-node point`).toBeTruthy();
      return node.point;
    }

    it('locate-start recenters the camera on the start shop display node', async () => {
      const { el, engine, shadow } = await mountRealEngineComponent();
      expect(el.navigateTo({ from: SHOP_A_ID, to: SHOP_B_ID }).success).toBe(true);

      const centerSpy = vi.spyOn(engine, 'centerOn');
      clickButton(locateButton(shadow, 'locate-start'));

      expect(centerSpy, 'locate-start must drive a camera recenter').toHaveBeenCalled();
      const [x, y] = centerSpy.mock.calls[centerSpy.mock.calls.length - 1];
      const p = displayPoint(el, SHOP_A_ID, 'F1');
      expect(x).toBeCloseTo(p.x, 3);
      expect(y).toBeCloseTo(p.y, 3);
    });

    it('locate-focus recenters the camera on the destination shop display node', async () => {
      const { el, engine, shadow } = await mountRealEngineComponent();
      expect(el.navigateTo({ from: SHOP_A_ID, to: SHOP_B_ID }).success).toBe(true);

      const centerSpy = vi.spyOn(engine, 'centerOn');
      clickButton(locateButton(shadow, 'locate-focus'));

      expect(centerSpy, 'locate-focus must drive a camera recenter').toHaveBeenCalled();
      const [x, y] = centerSpy.mock.calls[centerSpy.mock.calls.length - 1];
      const p = displayPoint(el, SHOP_B_ID, 'F2');
      expect(x).toBeCloseTo(p.x, 3);
      expect(y).toBeCloseTo(p.y, 3);
    });
  });
});
// <<< TARS cap:search-to-route
