// >>> TARS cap:zoom-control
//
// zoom-control — the built-in zoom control: a `zoom-control` attribute renders a
// pair of +/- buttons in a right-column wrapper that is a SIBLING after the
// level-selector (so it does not scroll with the floor list); each button drives
// the existing public `engine.zoom(factor)` seam (+ = 1.4, - = 1/1.4); a
// `view:changed` subscription toggles each button's `disabled` attribute by
// comparing the live `getViewState().scale` against `getScaleBounds()` min/max;
// and removing the attribute tears the buttons down and unsubscribes the listener
// (mirroring `#disableLevelSelector`). The only new engine seam is the
// `MapEngine.getScaleBounds()` passthrough exposing the transform's {min,max}.
//
// Most tests drive the REAL `WayfinderMapElement` over its REAL shadow DOM (this
// is a `(ui)` capability — the user-facing affordance is the contract): we count
// the buttons the component builds, read their aria-labels / disabled state, click
// them the way a user taps, and fire the `view:changed` event the engine emits to
// observe the disabled-state recompute. Only the heavy `MapEngine` is replaced —
// by a thin stub whose `zoom` is a spy, whose `getViewState`/`getScaleBounds` are
// staged per test, and whose `on('view:changed', cb)` returns a REAL unsubscribe
// so the teardown / no-leak criterion is honestly observable. The component code
// (`#syncZoomControl`/`#enableZoomControl`/`#disableZoomControl`, click delegation,
// the view:changed -> disabled subscription, the wrapper placement) is the genuine
// production code under test.
//
// Criterion 8 (the `MapEngine.getScaleBounds()` passthrough) is the exception: it
// exercises the REAL MapEngine over the real SGC fixture with a mocked Renderer
// whose transform reports a known {min,max}, so the passthrough (and its
// pre-init safe default) is the real method under test, not a stub.
//
// The modules are imported LAZILY (after the DOM shim is installed) so the suite
// COLLECTS cleanly; a missing module / export surfaces as a message-bearing
// assertion failure, not a file-level resolution crash.
//
// Test targets: one describe per acceptance criterion (1..9).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');
const sgcFixturePath = join(repoRoot, 'test', 'fixtures', 'SGC_v001.json');

function loadSgcRaw() {
  return JSON.parse(readFileSync(sgcFixturePath, 'utf8'));
}

// The +/- zoom factors the criteria pin EXACTLY (hardcoded, not imported from the
// implementation): zoom-in multiplies the scale by 1.4, zoom-out by its inverse.
const ZOOM_IN_FACTOR = 1.4;
const ZOOM_OUT_FACTOR = 1 / 1.4;

// ─────────────────────────────────────────────────────────────────────────────
// Minimal DOM shim (no jsdom in this repo's node-env Vitest). A single generic
// Element model serves every node the component builds; the component pokes
// dataset/style/textContent/className/attributes and dispatches click events,
// all absorbed uniformly. Installed onto globals in beforeEach.
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
    this.src = '';
    this.alt = '';
  }

  get className() { return this.classList.value; }
  set className(v) {
    this.classList = new ClassList();
    for (const c of String(v).split(/\s+/).filter(Boolean)) this.classList.add(c);
  }

  // `disabled` is a reflected property in the DOM; mirror it onto the attribute so
  // both `el.disabled` and `el.hasAttribute('disabled')` agree (the criteria read
  // the attribute form).
  get disabled() { return this.attributes.has('disabled'); }
  set disabled(v) {
    if (v) this.attributes.set('disabled', '');
    else this.attributes.delete('disabled');
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
    if (child.parentNode) child.parentNode.removeChild(child);
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
  get nextSibling() {
    if (!this.parentNode) return null;
    const i = this.parentNode.children.indexOf(this);
    return this.parentNode.children[i + 1] ?? null;
  }
  get previousSibling() {
    if (!this.parentNode) return null;
    const i = this.parentNode.children.indexOf(this);
    return this.parentNode.children[i - 1] ?? null;
  }

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
      const inner = selector.slice(1, -1);
      const eq = inner.indexOf('=');
      if (eq >= 0) {
        const key = inner.slice(0, eq);
        const raw = inner.slice(eq + 1).replace(/^["']|["']$/g, '');
        return this.getAttribute(key) === raw;
      }
      return this.dataset[camel(inner.replace(/^data-/, ''))] !== undefined || this.attributes.has(inner);
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

  contains(node) {
    let n = node;
    while (n) { if (n === this) return true; n = n.parentNode; }
    return false;
  }

  getBoundingClientRect() {
    return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };
  }
  scrollTo() {}
  focus() {}
  blur() {}
  select() {}
  getRootNode() { let n = this; while (n.parentNode) n = n.parentNode; return n._root ?? n; }
}

class FakeShadowRoot extends FakeElement {
  constructor(host) { super('#shadow-root'); this.host = host; this._root = this; }
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
    // intentionally NO matchMedia / visualViewport / ResizeObserver -> the
    // component guards each behind a typeof check (desktop defaults).
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

// ─────────────────────────────────────────────────────────────────────────────
// A thin MapEngine stub. `zoom` is a spy (criteria 2/3). `view:changed` is a REAL
// pub/sub (the `on` return value is a genuine unsubscribe) so the teardown / leak
// criterion (9) is observable: after teardown, emitting must reach no listeners.
// `getViewState`/`getScaleBounds` are staged via `setScale`/`setBounds` so a test
// can place the scale at min / max / mid-range and fire `view:changed`.
// ─────────────────────────────────────────────────────────────────────────────
function makeEngineStub() {
  const events = new Map();
  let scale = 1;
  let bounds = { min: 0.5, max: 4 };
  return {
    isInitialized: true,
    zoom: vi.fn(),
    init: () => Promise.resolve(),
    on(name, cb) {
      if (!events.has(name)) events.set(name, []);
      events.get(name).push(cb);
      return () => {
        const arr = events.get(name);
        if (arr) { const i = arr.indexOf(cb); if (i >= 0) arr.splice(i, 1); }
      };
    },
    once() { return () => {}; },
    off() {},
    emit(name, detail) { for (const cb of [...(events.get(name) ?? [])]) cb(detail); },
    listenerCount(name) { return (events.get(name) ?? []).length; },
    // staging helpers (test-only)
    setScale(s) { scale = s; },
    setBounds(b) { bounds = b; },
    getViewState() { return { scale, panX: 0, panY: 0, rotation: 0 }; },
    getScaleBounds() { return { ...bounds }; },
    // lifecycle surface the component touches during init / sync
    getCurrentFloor() { return 'L3'; },
    getFloors() { return ['B2', 'B1', 'L1', 'L2', 'L3']; },
    getLevels() {
      return [
        { code: 'B2', position: 50 }, { code: 'B1', position: 100 },
        { code: 'L1', position: 150 }, { code: 'L2', position: 200 },
        { code: 'L3', position: 250 }
      ];
    },
    getLocations() { return []; },
    getLocation() { return null; },
    getLocationsByUnitId() { return []; },
    setFloor() {},
    resize() {},
    hasRoute() { return false; },
    hasYouAreHere() { return false; },
    getRouteMode() { return 'escalator'; },
    setPinMarkerIcons() {},
    setPinMarkerStyle() {},
    setLocationLabelStyle() {},
    getConfigValue() { return undefined; },
    focusLocation() { return { success: false }; },
    focusNode() { return { success: false }; },
    clearRoute() {},
    setViewState() {},
    resetView() {},
    dispose() {}
  };
}

// Shared handle the mocked MapEngine constructor hands back our prepared stub.
const __engineRef = vi.hoisted(() => ({ current: null }));

vi.mock('../../src/core/MapEngine.js', () => ({
  MapEngine: class {
    constructor() { return __engineRef.current; }
  }
}));

async function importComponent() {
  let mod = null;
  try {
    mod = await import('../../src/component/WayfinderMap.js');
  } catch {
    mod = null;
  }
  expect(mod, 'src/component/WayfinderMap.js must exist and export WayfinderMapElement').not.toBeNull();
  expect(mod.WayfinderMapElement, 'WayfinderMap.js must export WayfinderMapElement').toBeTypeOf('function');
  return mod.WayfinderMapElement;
}

// Stand up a REAL WayfinderMapElement wired to a stub engine via the real init
// seam. `attrs` lets a test toggle zoom-control / level-selector before init.
async function mount(attrs = ['zoom-control']) {
  const WayfinderMapElement = await importComponent();
  const el = new WayfinderMapElement();
  el.setAttribute('maps-url', '/maps_bundle.json.gz');
  el.setAttribute('datas-url', '/datas_bundle.json.gz');
  for (const a of attrs) el.setAttribute(a, '');

  const engine = makeEngineStub();
  __engineRef.current = engine;
  await el.init(); // builds the (mocked) MapEngine -> our stub, runs the real sync*

  return { el, engine, shadow: el.shadowRoot };
}

// All zoom buttons the component currently renders, identified by aria-label
// (the criteria's stable handle). Returns { in, out, all }.
function zoomButtons(shadow) {
  const buttons = shadow.querySelectorAll('button');
  const labelled = buttons.filter((b) => {
    const l = b.getAttribute('aria-label');
    return l === 'Zoom in' || l === 'Zoom out';
  });
  return {
    in: labelled.find((b) => b.getAttribute('aria-label') === 'Zoom in') ?? null,
    out: labelled.find((b) => b.getAttribute('aria-label') === 'Zoom out') ?? null,
    all: labelled
  };
}

function clickButton(button) {
  expect(button, 'expected a button to click').toBeTruthy();
  button.dispatchEvent(new FakeCustomEvent('click', { bubbles: true }));
}

// Resolve both zoom buttons, asserting they exist first so a missing control
// fails on a clear presence assertion rather than a downstream null-deref.
function requireZoomButtons(shadow) {
  const { in: zoomIn, out: zoomOut } = zoomButtons(shadow);
  expect(zoomIn, 'a "Zoom in" button must be rendered').toBeTruthy();
  expect(zoomOut, 'a "Zoom out" button must be rendered').toBeTruthy();
  return { zoomIn, zoomOut };
}

// Fire the engine's `view:changed` event with the scale/bounds the test stages,
// the way `MapEngine.#emitViewChange` does (the seam the component subscribes to).
function fireViewChanged(engine, { scale, bounds }) {
  if (bounds) engine.setBounds(bounds);
  engine.setScale(scale);
  engine.emit('view:changed', engine.getViewState());
}

describe('zoom-control: built-in +/- zoom buttons on <wayfinder-map>', () => {
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
  // Criterion 1 — gating / presence: with the attribute, exactly two buttons
  //               (one "Zoom in", one "Zoom out"); without it, zero.
  // ───────────────────────────────────────────────────────────────────────────
  describe('criterion 1: presence gated on the zoom-control attribute', () => {
    it('renders exactly one "Zoom in" and one "Zoom out" button when zoom-control is set', async () => {
      const { shadow } = await mount(['zoom-control']);
      const { in: zoomIn, out: zoomOut, all } = zoomButtons(shadow);

      expect(all.length, 'exactly two zoom buttons').toBe(2);
      expect(zoomIn, 'a button with aria-label "Zoom in"').toBeTruthy();
      expect(zoomOut, 'a button with aria-label "Zoom out"').toBeTruthy();
    });

    it('renders NO zoom buttons when the zoom-control attribute is absent', async () => {
      const { shadow } = await mount([]); // level/zoom controls both off
      expect(zoomButtons(shadow).all.length).toBe(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Criterion 2 — zoom-in click calls engine.zoom once with factor 1.4 (> 1).
  // ───────────────────────────────────────────────────────────────────────────
  describe('criterion 2: zoom-in click -> engine.zoom(1.4)', () => {
    it('clicking the zoom-in button calls engine.zoom exactly once with 1.4', async () => {
      const { shadow, engine } = await mount(['zoom-control']);
      clickButton(zoomButtons(shadow).in);

      expect(engine.zoom).toHaveBeenCalledTimes(1);
      const factor = engine.zoom.mock.calls[0][0];
      expect(factor).toBeGreaterThan(1);
      expect(factor).toBeCloseTo(ZOOM_IN_FACTOR, 10);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Criterion 3 — zoom-out click calls engine.zoom once with factor 1/1.4 (< 1).
  // ───────────────────────────────────────────────────────────────────────────
  describe('criterion 3: zoom-out click -> engine.zoom(1/1.4)', () => {
    it('clicking the zoom-out button calls engine.zoom exactly once with 1/1.4', async () => {
      const { shadow, engine } = await mount(['zoom-control']);
      clickButton(zoomButtons(shadow).out);

      expect(engine.zoom).toHaveBeenCalledTimes(1);
      const factor = engine.zoom.mock.calls[0][0];
      expect(factor).toBeLessThan(1);
      expect(factor).toBeCloseTo(ZOOM_OUT_FACTOR, 10);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Criterion 4 — at max scale, zoom-in is disabled, zoom-out is not.
  // ───────────────────────────────────────────────────────────────────────────
  describe('criterion 4: disabled at max scale', () => {
    it('on a view:changed with scale ≈ max, zoom-in is disabled and zoom-out is not', async () => {
      const { shadow, engine } = await mount(['zoom-control']);
      const bounds = { min: 0.5, max: 4 };
      const { zoomIn, zoomOut } = requireZoomButtons(shadow);
      fireViewChanged(engine, { scale: 4, bounds }); // at the ceiling

      expect(zoomIn.hasAttribute('disabled'), 'zoom-in disabled at max').toBe(true);
      expect(zoomOut.hasAttribute('disabled'), 'zoom-out enabled at max').toBe(false);
    });

    it('the epsilon tolerance treats a scale just under max as still at max', async () => {
      const { shadow, engine } = await mount(['zoom-control']);
      const bounds = { min: 0.5, max: 4 };
      const { zoomIn } = requireZoomButtons(shadow);
      // a sub-epsilon undershoot of the ceiling still counts as "at max".
      fireViewChanged(engine, { scale: 4 - 1e-4, bounds });

      expect(zoomIn.hasAttribute('disabled')).toBe(true);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Criterion 5 — at min scale, zoom-out is disabled, zoom-in is not.
  // ───────────────────────────────────────────────────────────────────────────
  describe('criterion 5: disabled at min scale', () => {
    it('on a view:changed with scale ≈ min, zoom-out is disabled and zoom-in is not', async () => {
      const { shadow, engine } = await mount(['zoom-control']);
      const bounds = { min: 0.5, max: 4 };
      const { zoomIn, zoomOut } = requireZoomButtons(shadow);
      fireViewChanged(engine, { scale: 0.5, bounds }); // at the floor

      expect(zoomOut.hasAttribute('disabled'), 'zoom-out disabled at min').toBe(true);
      expect(zoomIn.hasAttribute('disabled'), 'zoom-in enabled at min').toBe(false);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Criterion 6 — mid-range: neither disabled; a later mid-range event re-enables
  //               a button disabled by an earlier boundary event.
  // ───────────────────────────────────────────────────────────────────────────
  describe('criterion 6: enabled mid-range + re-enable on later view:changed', () => {
    it('on a view:changed with min < scale < max, neither button is disabled', async () => {
      const { shadow, engine } = await mount(['zoom-control']);
      const bounds = { min: 0.5, max: 4 };
      const { zoomIn, zoomOut } = requireZoomButtons(shadow);
      fireViewChanged(engine, { scale: 2, bounds });

      expect(zoomIn.hasAttribute('disabled')).toBe(false);
      expect(zoomOut.hasAttribute('disabled')).toBe(false);
    });

    it('a mid-range view:changed RE-ENABLES the zoom-in button disabled by an earlier max event', async () => {
      const { shadow, engine } = await mount(['zoom-control']);
      const bounds = { min: 0.5, max: 4 };
      const { zoomIn } = requireZoomButtons(shadow);

      fireViewChanged(engine, { scale: 4, bounds }); // disables zoom-in
      expect(zoomIn.hasAttribute('disabled')).toBe(true);

      fireViewChanged(engine, { scale: 2, bounds }); // back to mid-range
      expect(zoomIn.hasAttribute('disabled')).toBe(false);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Criterion 7 — independence from level-selector & wrapper placement: zoom
  //               buttons render without level-selector; with both, the zoom group
  //               is a SIBLING AFTER the level-selector element (not a descendant).
  // ───────────────────────────────────────────────────────────────────────────
  describe('criterion 7: independent of level-selector; zoom group is a sibling after it', () => {
    it('zoom-control WITHOUT level-selector renders zoom buttons but NO level buttons', async () => {
      const { shadow } = await mount(['zoom-control']); // no level-selector
      expect(zoomButtons(shadow).all.length).toBe(2);

      const levelButtons = shadow.querySelectorAll('.wayfinder-level-button');
      expect(levelButtons.length, 'no level-selector buttons when only zoom-control is set').toBe(0);
    });

    it('with BOTH attributes, level buttons AND zoom buttons render', async () => {
      const { shadow } = await mount(['level-selector', 'zoom-control']);
      expect(zoomButtons(shadow).all.length).toBe(2);
      expect(shadow.querySelectorAll('.wayfinder-level-button').length).toBeGreaterThan(0);
    });

    it('the zoom group is a SIBLING positioned AFTER the level-selector (not its descendant)', async () => {
      const { shadow } = await mount(['level-selector', 'zoom-control']);

      const { zoomIn } = requireZoomButtons(shadow);
      const levelSelector = shadow.querySelector('.wayfinder-level-selector');
      expect(levelSelector, 'a .wayfinder-level-selector element').toBeTruthy();

      // The zoom group must NOT live inside the level-selector (so it does not
      // scroll with the floor list).
      expect(
        levelSelector.contains(zoomIn),
        'zoom button must not be a descendant of the level-selector'
      ).toBe(false);

      // The zoom group and the level-selector share a common parent, and the zoom
      // group comes AFTER the level-selector among that parent's children.
      const zoomGroup = zoomIn.closest('.wayfinder-zoom-controls') ?? zoomIn.parentNode;
      const parent = levelSelector.parentNode;
      expect(parent, 'level-selector has a parent').toBeTruthy();
      expect(parent.contains(zoomGroup), 'zoom group shares the level-selector parent subtree').toBe(true);

      // Resolve each to the direct child of `parent` and compare order.
      const directChildContaining = (node) => parent.children.find((c) => c === node || c.contains?.(node));
      const levelChild = directChildContaining(levelSelector);
      const zoomChild = directChildContaining(zoomGroup);
      expect(levelChild, 'level-selector resolves to a direct child of parent').toBeTruthy();
      expect(zoomChild, 'zoom group resolves to a direct child of parent').toBeTruthy();
      const li = parent.children.indexOf(levelChild);
      const zi = parent.children.indexOf(zoomChild);
      expect(zi).toBeGreaterThan(li);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Criterion 9 — teardown: removing the attribute removes the buttons and
  //               unsubscribes view:changed (no leak; mirrors #disableLevelSelector).
  // ───────────────────────────────────────────────────────────────────────────
  describe('criterion 9: teardown removes buttons and unsubscribes view:changed', () => {
    it('removing zoom-control removes the zoom buttons from the shadow DOM', async () => {
      const { el, shadow } = await mount(['zoom-control']);
      expect(zoomButtons(shadow).all.length).toBe(2);

      el.removeAttribute('zoom-control');
      el.attributeChangedCallback('zoom-control', '', null);

      expect(zoomButtons(shadow).all.length, 'buttons gone after attribute removal').toBe(0);
    });

    // The component's #wireEvents() ALWAYS subscribes a permanent `view:changed`
    // re-emit listener at init, independent of zoom-control — so the raw
    // listenerCount is non-zero before the zoom control ever subscribes. We
    // therefore isolate the zoom control's OWN subscription by a DELTA around
    // enable, never an absolute `before - 1`: this fails an impl that removes the
    // wrong listener (the re-emit) or never subscribes at all.
    it('enabling zoom-control adds exactly ONE view:changed listener over the re-emit baseline', async () => {
      // Mount WITHOUT zoom-control: the only `view:changed` subscriber is the
      // permanent #wireEvents re-emit listener. That count is the baseline.
      const { el, engine, shadow } = await mount([]);
      expect(zoomButtons(shadow).all.length, 'no zoom buttons before enabling').toBe(0);
      const baseline = engine.listenerCount('view:changed');

      // Enable zoom-control through the real attribute lifecycle.
      el.setAttribute('zoom-control', '');
      el.attributeChangedCallback('zoom-control', null, '');

      expect(zoomButtons(shadow).all.length, 'zoom buttons rendered on enable').toBe(2);
      expect(
        engine.listenerCount('view:changed'),
        'zoom control subscribes exactly one view:changed listener of its own'
      ).toBe(baseline + 1);
    });

    it('teardown returns the view:changed listener count to the pre-enable baseline (unsubscribes ITS OWN listener)', async () => {
      // Baseline = listeners present with zoom-control OFF (the re-emit only).
      const { el, engine } = await mount([]);
      const baseline = engine.listenerCount('view:changed');

      // Enable: count must rise by exactly one (the zoom control's subscription).
      el.setAttribute('zoom-control', '');
      el.attributeChangedCallback('zoom-control', null, '');
      expect(
        engine.listenerCount('view:changed'),
        'enable adds the zoom control listener'
      ).toBe(baseline + 1);

      // Teardown: count must drop back to EXACTLY the baseline — i.e. the zoom
      // control removed ITS OWN listener and left the re-emit intact. An impl
      // that removes the re-emit (or any wrong listener) would not land on
      // baseline; an impl that forgets to unsubscribe would stay at baseline + 1.
      el.removeAttribute('zoom-control');
      el.attributeChangedCallback('zoom-control', '', null);
      expect(
        engine.listenerCount('view:changed'),
        'teardown unsubscribes only the zoom control listener, restoring the baseline'
      ).toBe(baseline);

      // And the surviving baseline listener still fires (the re-emit was NOT
      // collateral damage): a later view:changed must not throw and must still be
      // dispatchable to the surviving listener.
      expect(() => fireViewChanged(engine, { scale: 2, bounds: { min: 0.5, max: 4 } }))
        .not.toThrow();
      expect(
        engine.listenerCount('view:changed'),
        'baseline listener survived teardown'
      ).toBe(baseline);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Criterion 8 — engine passthrough. The REAL MapEngine (NOT the stub) over the
// real SGC fixture, with a mocked Renderer whose transform reports a known
// {min,max}; getScaleBounds() must return those when initialized and a safe
// default (no throw) before init. Imported via importActual so the module-level
// MapEngine mock above does not shadow it.
// ─────────────────────────────────────────────────────────────────────────────

const BOUNDS_FIXTURE = { min: 0.3, max: 6.5 };

const renderState = vi.hoisted(() => ({}));

vi.mock('../../src/renderer/Renderer.js', () => {
  class MockTransform {
    setScaleBounds() {}
    getScaleBounds() { return { min: 0.3, max: 6.5 }; }
    fitToBounds() {}
    getViewState() { return { scale: 1, panX: 0, panY: 0, rotation: 0 }; }
    setViewState() {}
    setMaxScaleFromFit() {}
    pan() {}
    zoom() {}
    centerOn() {}
    resetRotation() {}
    screenToWorld() { return { x: 0, y: 0 }; }
    getCanvasCenter() { return { x: 0, y: 0 }; }
  }
  return {
    Renderer: class {
      constructor() {
        this.transform = new MockTransform();
        this.layers = { add() {} };
        this.animator = { cancel() {} };
      }
      fitToBounds() {}
      requestRender() {}
      resize() {}
      animateTo() {}
      dispose() {}
    }
  };
});
vi.mock('../../src/interaction/GestureRecognizer.js', () => ({
  GestureRecognizer: class { dispose() {} }
}));
vi.mock('../../src/interaction/HitTestManager.js', () => ({
  HitTestManager: class { registerHandler() {} }
}));
vi.mock('../../src/layers/PinMarkerLayer.js', () => ({
  PinMarkerLayer: class {
    setFloor() {} setStyle() {} setIconSources() {} setYouAreHereNode() {}
    setYouAreHereVisible() {} setManualEndLocation() {} setPath() {} clear() {}
  }
}));
vi.mock('../../src/layers/NavMarkerLayer.js', () => ({
  NavMarkerLayer: class {
    setFloor() {} setStyle() {} setLevelOrdinals() {} setPath() {} clear() {}
  }
}));
vi.mock('../../src/layers/NavigationLayer.js', () => ({
  NavigationLayer: class {
    setFloor() {} setPath() {} clearPath() {} stopAnimation() {}
  }
}));

function jsonResponse(obj) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    clone() { return jsonResponse(obj); },
    json: () => Promise.resolve(obj)
  };
}

async function importRealMapEngine() {
  let mod = null;
  try {
    mod = await vi.importActual('../../src/core/MapEngine.js');
  } catch {
    mod = null;
  }
  expect(mod, 'src/core/MapEngine.js must exist and export the MapEngine class').not.toBeNull();
  expect(mod.MapEngine, 'MapEngine.js must export a MapEngine class').toBeTypeOf('function');
  return mod.MapEngine;
}

describe('zoom-control criterion 8: MapEngine.getScaleBounds() passthrough', () => {
  beforeEach(() => {
    globalThis.HTMLCanvasElement = class HTMLCanvasElement {};
  });

  afterEach(() => {
    delete globalThis.HTMLCanvasElement;
    vi.restoreAllMocks();
  });

  it('returns the transform\'s { min, max } once the engine is initialized', async () => {
    const MapEngine = await importRealMapEngine();
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(loadSgcRaw()));
    const engine = new MapEngine(new globalThis.HTMLCanvasElement(), {
      mapsUrl: '/datas/maps_SGC_v001.json.gz',
      datasUrl: '/datas/datas_SGC_v001.json.gz',
      renderScale: 1
    });
    await engine.init();

    expect(typeof engine.getScaleBounds).toBe('function');
    const bounds = engine.getScaleBounds();
    expect(bounds).toEqual(BOUNDS_FIXTURE);
  });

  it('does NOT throw and returns a finite { min, max } when called before init', async () => {
    const MapEngine = await importRealMapEngine();
    const engine = new MapEngine(new globalThis.HTMLCanvasElement(), {
      mapsUrl: '/datas/maps_SGC_v001.json.gz',
      datasUrl: '/datas/datas_SGC_v001.json.gz'
    });

    let bounds;
    expect(() => { bounds = engine.getScaleBounds(); }).not.toThrow();
    expect(bounds, 'a safe default object').toBeTruthy();
    expect(Number.isFinite(bounds.min), 'min is finite').toBe(true);
    expect(Number.isFinite(bounds.max), 'max is finite').toBe(true);
    expect(bounds.max).toBeGreaterThanOrEqual(bounds.min);
  });
});
// <<< TARS cap:zoom-control
