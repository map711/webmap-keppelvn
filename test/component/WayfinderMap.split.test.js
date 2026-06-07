// >>> TARS cap:split-data-loading
//
// split-data-loading (component half) — `<wayfinder-map>` exposes the split data
// attributes: `observedAttributes` ADDS `maps-url` + `datas-url` and DROPS the
// legacy `data-url` / `map-url`; `init()` is gated on BOTH split urls being
// present — exactly one present rejects/throws the both-required error.
//
// Pure Node/Vitest (no jsdom): a compact DOM shim stands up the REAL
// WayfinderMapElement so `observedAttributes` (a static read off the real class)
// and the real `init()` URL gate are the production code under test. The shim
// omits matchMedia/visualViewport/ResizeObserver — the component guards each
// behind a `typeof` check — so construction reaches the init gate DOM-light.
//
// The module is imported LAZILY (after the shim is installed) so the suite
// COLLECTS cleanly; a missing/renamed export surfaces as a message-bearing
// assertion failure, not a file-level resolution crash.
//
// Target: criterion 7.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// ── Compact DOM shim (element/event/shadow surface the component lifecycle touches) ──
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

function makeStyle() {
  const props = new Map();
  return {
    setProperty: (k, v) => props.set(k, v),
    getPropertyValue: (k) => props.get(k) ?? '',
    removeProperty: (k) => props.delete(k)
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
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  get textContent() { return this._textContent; }
  set textContent(v) { this._textContent = String(v); this.children = []; }
  querySelectorAll() { return []; }
  querySelector() { return null; }
  addEventListener(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(fn);
  }
  removeEventListener(type, fn) {
    const arr = this._listeners.get(type);
    if (arr) { const i = arr.indexOf(fn); if (i >= 0) arr.splice(i, 1); }
  }
  dispatchEvent(event) { event.target = event.target || this; return true; }
}

class FakeShadowRoot extends FakeElement {
  constructor(host) { super('#shadow-root'); this.host = host; }
}

class FakeCustomEvent {
  constructor(type, init = {}) { this.type = type; this.detail = init.detail; this.target = null; }
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

  const doc = new FakeElement('#document');
  doc.createElement = (tag) => new FakeElement(tag);
  doc.createTextNode = (t) => { const n = new FakeElement('#text'); n._textContent = String(t); return n; };
  doc.addEventListener = () => {};
  doc.removeEventListener = () => {};

  class HTMLElementBase extends FakeElement {
    constructor() {
      super('wayfinder-map');
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
    // intentionally NO matchMedia / visualViewport / ResizeObserver.
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

describe('split-data-loading: <wayfinder-map> split data attributes', () => {
  beforeEach(() => {
    installDom();
  });

  afterEach(() => {
    restoreDom();
  });

  // ---- Criterion 7a: observedAttributes adds maps-url/datas-url, drops data-url/map-url ----
  it('observedAttributes includes maps-url and datas-url', async () => {
    const WayfinderMapElement = await importComponent();
    const observed = WayfinderMapElement.observedAttributes;
    expect(observed).toContain('maps-url');
    expect(observed).toContain('datas-url');
  });

  it('observedAttributes EXCLUDES the legacy data-url and map-url', async () => {
    const WayfinderMapElement = await importComponent();
    const observed = WayfinderMapElement.observedAttributes;
    expect(observed).not.toContain('data-url');
    expect(observed).not.toContain('map-url');
  });

  // ---- Criterion 7b: init() requires BOTH urls; exactly one present rejects ----
  it('init() rejects with the both-required error when only maps-url is present', async () => {
    const WayfinderMapElement = await importComponent();
    const el = new WayfinderMapElement();
    el.setAttribute('maps-url', '/datas/maps_SGC_v001.json.gz');
    // datas-url intentionally absent.
    await expect(el.init()).rejects.toThrow(
      'wayfinder-map: maps-url and datas-url attributes are required'
    );
  });

  it('init() rejects with the both-required error when only datas-url is present', async () => {
    const WayfinderMapElement = await importComponent();
    const el = new WayfinderMapElement();
    el.setAttribute('datas-url', '/datas/datas_SGC_v001.json.gz');
    // maps-url intentionally absent.
    await expect(el.init()).rejects.toThrow(
      'wayfinder-map: maps-url and datas-url attributes are required'
    );
  });

  it('init() rejects with the both-required error when neither url is present', async () => {
    const WayfinderMapElement = await importComponent();
    const el = new WayfinderMapElement();
    await expect(el.init()).rejects.toThrow(
      'wayfinder-map: maps-url and datas-url attributes are required'
    );
  });
});
// <<< TARS cap:split-data-loading
