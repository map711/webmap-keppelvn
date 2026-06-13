// >>> TARS cap:reward-tap
//
// reward-tap — the full tap pipeline for a reward seal:
//
//   RewardMarkerLayer.hitTest  ->  {type:'reward', shopId, rewards, location}
//        -> HitTestManager.#classifyHit short-circuits the reward type
//        -> manager emits `tap:reward` {shopId, rewards, location} (NOT tap:location/floor)
//        -> WayfinderMap eventMap re-dispatches `tap:reward` -> `reward-tap` CustomEvent
//        -> demo/basic.html logs `e.detail`.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT MAKES THESE BINDING (read before judging RED state):
//   • Criterion 1 exercises the REAL RewardMarkerLayer: it first RENDERS one seal
//     (so the per-render hit bookkeeping is populated) through a recording 2D
//     context (identity transform => scale 1 / rotation 0), then hit-tests AT the
//     drawn shop's world anchor and FAR from any marker. The on-seal hit must be
//     the self-describing `{type:'reward', shopId, rewards}` (shopId + rewards are
//     the entry's verbatim values, not just "a truthy object"); the off-marker
//     point must be exactly `null`. A layer that returns a bare id, the wrong
//     shape, or a hit for an empty miss goes RED on a concrete equality.
//   • Criterion 2 drives the REAL HitTestManager over a REAL EventBus with a
//     LayerStack stub whose top hit IS the reward shape — with NO self-wired
//     handler, so the ONLY thing that can emit `tap:reward` is the manager's own
//     `#onTap` reading `#classifyHit`'s clean `{shopId,rewards,location}` payload
//     (MapEngine wires no reward handler; the reward tap is payload-driven, like
//     the side-effect-only floor-transition). It asserts exactly ONE `tap:reward`
//     fired whose detail deep-equals that clean object AND that `tap:location` /
//     `tap:floor` never fired (a reward unit id mis-routed to the unit-id path
//     would fire one of those). A null hit also must NOT fire `tap:reward`.
//   • Criterion 3 stands up the REAL WayfinderMapElement (DOM-light shim) with a
//     MOCKED MapEngine backed by a REAL EventBus, calls the real `init()` (which
//     runs the real `#wireEvents`), then emits `tap:reward` on the engine bus and
//     asserts a `reward-tap` CustomEvent was dispatched on the element whose
//     `detail` DEEP-EQUALS the emitted `{shopId, rewards, location}` — and that a
//     `tap:reward` does NOT surface as `location-tap`/`floor-tap`.
//   • Criterion 4 reads demo/basic.html off disk and asserts a `reward-tap`
//     listener whose body calls `console.log(...)` with the event detail.
// ─────────────────────────────────────────────────────────────────────────────
//
// Targets (one per acceptance criterion):
//   1. RewardMarkerLayer.hitTest over a drawn seal -> {type:'reward',shopId,rewards}; off -> null.
//   2. reward hit short-circuits the manager -> emits tap:reward {shopId,rewards,location}; not tap:location/floor.
//   3. WayfinderMap eventMap: tap:reward on the bus -> reward-tap CustomEvent, detail deep-equals payload.
//   4. demo/basic.html registers a reward-tap listener that console.log()s e.detail.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HitTestManager } from '../../src/interaction/HitTestManager.js';
import { EventBus } from '../../src/core/EventBus.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');

// The real EventBus the mocked MapEngine (criterion 3) is wired to, captured so a
// test can emit on it after the real #wireEvents has subscribed. Hoisted to the
// top level so vi.hoisted() runs in its declared place.
const engineState = vi.hoisted(() => ({ bus: null }));

// ─────────────────────────────────────────────────────────────────────────────
// Lazy layer resolution — the suite must COLLECT cleanly so each test fails on a
// behavioural assertion, never a module-resolution crash.
// ─────────────────────────────────────────────────────────────────────────────
async function importRewardMarkerLayer() {
  let mod = null;
  try { mod = await import('../../src/layers/RewardMarkerLayer.js'); } catch { mod = null; }
  expect(mod, 'src/layers/RewardMarkerLayer.js must exist').not.toBeNull();
  const Ctor = mod?.RewardMarkerLayer ?? mod?.default;
  expect(Ctor, 'RewardMarkerLayer.js must export a RewardMarkerLayer class').toBeTypeOf('function');
  return Ctor;
}

// A recording mock 2D context with an IDENTITY transform (scale 1, rotation 0),
// so a layer that captures #lastScale/#lastRotation off getTransform hit-tests in
// world == local space.
function makeRecordingCtx() {
  const calls = [];
  const ctx = {
    calls,
    save() {}, restore() {},
    beginPath() {}, moveTo() {}, lineTo() {},
    quadraticCurveTo() {}, arcTo() {}, arc() {}, closePath() {},
    fill() {}, stroke() {}, clip() {}, rect() {},
    translate() {}, rotate() {}, scale() {},
    fillText() {}, strokeText() {},
    measureText(t) { return { width: (typeof t === 'string' ? t.length : 4) * 8 }; },
    drawImage() {},
    getTransform() { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; },
    set fillStyle(_v) {}, set strokeStyle(_v) {}, set lineWidth(_v) {},
    set font(_v) {}, set textAlign(_v) {}, set textBaseline(_v) {}, set globalAlpha(_v) {}
  };
  return ctx;
}

// A synchronously "loaded" mock Image so the seal icon-cache draws immediately and
// the hit-box is recorded during render.
function installMockImage() {
  const prev = globalThis.Image;
  globalThis.Image = class {
    constructor() {
      this._src = '';
      this.complete = true;
      this.naturalWidth = 64; this.naturalHeight = 64;
      this.width = 64; this.height = 64;
      this.onload = null; this.onerror = null;
    }
    set src(v) { this._src = v; this.complete = true; if (typeof this.onload === 'function') this.onload(); }
    get src() { return this._src; }
  };
  return () => { if (prev === undefined) delete globalThis.Image; else globalThis.Image = prev; };
}

function installMeasureDocument() {
  const prev = globalThis.document;
  globalThis.document = {
    createElement: () => ({
      width: 0, height: 0,
      getContext: () => ({
        set font(_v) {}, set fillStyle(_v) {}, set globalCompositeOperation(_v) {},
        clearRect() {}, drawImage() {}, fillRect() {},
        measureText: (t) => ({ width: (typeof t === 'string' ? t.length : 4) * 8 })
      }),
      toDataURL: () => 'data:image/png;base64,seal'
    })
  };
  return () => { if (prev === undefined) delete globalThis.document; else globalThis.document = prev; };
}

// A selection entry in the rewardRouteMatch() shape, placed on `levelCode` at (x,y).
function selectionEntry({ shopId, levelCode, x, y, rewards }) {
  return {
    shopId,
    levelCode,
    rewards,
    location: {
      id: `shop:${shopId}`,
      title: `Shop ${shopId}`,
      displayNodes: [{ levelCode, unitId: 900 + shopId, point: { x, y } }]
    }
  };
}

function applySelection(layer, selection) {
  const fn = layer.setSelection ?? layer.setMatches ?? layer.setRewards;
  expect(typeof fn, 'RewardMarkerLayer must expose setSelection(selection)').toBe('function');
  fn.call(layer, selection);
}

describe('reward-tap: tap a reward seal -> tap:reward -> reward-tap', () => {
  // ───────────────────────────────────────────────────────────────────────────
  // Criterion 1 — RewardMarkerLayer.hitTest is self-describing on a seal, null off.
  // ───────────────────────────────────────────────────────────────────────────
  describe('criterion 1: RewardMarkerLayer.hitTest', () => {
    let restoreImage;
    let restoreDoc;
    beforeEach(() => { restoreImage = installMockImage(); restoreDoc = installMeasureDocument(); });
    afterEach(() => { restoreImage(); restoreDoc(); });

    it('returns {type:"reward", shopId, rewards} for a point over a drawn seal', async () => {
      const RewardMarkerLayer = await importRewardMarkerLayer();
      const layer = new RewardMarkerLayer('F1');

      const rewards = [{ id: 1, title: '20% off' }, { id: 2, title: 'Free tote' }];
      applySelection(layer, [
        selectionEntry({ shopId: 42, levelCode: 'F1', x: 30, y: 10, rewards })
      ]);

      // Render once so the per-render hit bookkeeping (anchor + box) is populated.
      const ctx = makeRecordingCtx();
      layer.renderWithContext({ ctx, invalidate() {} });

      // Hit AT the shop's world anchor — the seal/pill stack is centered there.
      const hit = layer.hitTest(30, 10);
      expect(hit, 'a tap on the drawn seal must hit').not.toBeNull();
      expect(hit.type, 'the hit must be self-describing as a reward hit').toBe('reward');
      expect(hit.shopId, 'the hit carries the matched shopId verbatim').toBe(42);
      expect(hit.rewards, 'the hit carries the shop active rewards verbatim').toEqual(rewards);
    });

    it('returns null for a point off every marker', async () => {
      const RewardMarkerLayer = await importRewardMarkerLayer();
      const layer = new RewardMarkerLayer('F1');

      applySelection(layer, [
        selectionEntry({ shopId: 42, levelCode: 'F1', x: 30, y: 10, rewards: [{ id: 1, title: '20% off' }] })
      ]);
      const ctx = makeRecordingCtx();
      layer.renderWithContext({ ctx, invalidate() {} });

      // Far from the only drawn seal.
      expect(layer.hitTest(10000, 10000), 'a tap nowhere near a seal must miss').toBeNull();
    });

    it('returns null when nothing is selected (no seal drawn)', async () => {
      const RewardMarkerLayer = await importRewardMarkerLayer();
      const layer = new RewardMarkerLayer('F1');
      applySelection(layer, []);
      const ctx = makeRecordingCtx();
      layer.renderWithContext({ ctx, invalidate() {} });

      expect(layer.hitTest(30, 10), 'no markers => no hit').toBeNull();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Criterion 2 — reward hit short-circuits the manager and #onTap emits the clean
  //   {shopId, rewards, location} as tap:reward; never tap:location / tap:floor.
  //   NO self-wired handler: the manager's own #onTap (reading #classifyHit's
  //   payload) is the only thing that can fire tap:reward, so a regression of the
  //   payload back to the {...tapEvent, hitResult, locations} envelope goes RED.
  // ───────────────────────────────────────────────────────────────────────────
  describe('criterion 2: HitTestManager classifies a reward hit -> tap:reward', () => {
    // A LayerStack stub whose top hit is whatever we pass (reward shape / null).
    const makeLayerStack = (hitResult) => ({ hitTest: () => hitResult });

    // A LocationStore that WOULD resolve a unit id to a location — proves the
    // reward short-circuit fires BEFORE any unit-id extraction (a misroute here
    // would surface as tap:location).
    const trapLocationStore = {
      getLocationsByUnitId: () => [{ id: 'shop:999', title: 'Trap' }]
    };

    it('emits exactly one tap:reward with the clean {shopId,rewards,location} payload', () => {
      const bus = new EventBus();
      const rewards = [{ id: 7, title: 'BOGO' }];
      const location = { id: 'shop:5', title: 'Coffee', displayNodes: [] };
      const hit = { type: 'reward', shopId: 5, rewards, location, unitId: 905 };
      const manager = new HitTestManager(makeLayerStack(hit), bus, trapLocationStore);

      // Collect EVERY tap:reward detail. With NO self-wired handler, the manager's
      // own #onTap is the sole emitter — so this is satisfied ONLY by
      // #classifyHit's clean payload. If #onTap reverted to emitting the
      // {...tapEvent, hitResult, locations} envelope, the deep-equal fails.
      const payloads = [];
      bus.on('tap:reward', (e) => { payloads.push(e); });

      bus.emit('gesture:tap', { worldX: 30, worldY: 10, screenX: 1, screenY: 1 });

      expect(payloads, 'a reward seal tap must emit tap:reward exactly once with the clean payload')
        .toEqual([{ shopId: 5, rewards, location }]);
    });

    it('does NOT emit tap:location or tap:floor for a reward hit (even with a unitId present)', () => {
      const bus = new EventBus();
      // The reward hit ALSO carries a unitId the location store would resolve —
      // the short-circuit must win, so neither tap:location nor tap:floor fires.
      const hit = { type: 'reward', shopId: 5, rewards: [{ id: 1, title: 'x' }], location: { id: 'shop:5' }, unitId: 905 };
      const manager = new HitTestManager(makeLayerStack(hit), bus, trapLocationStore);

      let rewardCount = 0;
      const unitIdTaps = [];
      bus.on('tap:reward', () => { rewardCount += 1; });
      bus.on('tap:location', () => unitIdTaps.push('location'));
      bus.on('tap:floor', () => unitIdTaps.push('floor'));
      bus.on('tap:disambiguate', () => unitIdTaps.push('disambiguate'));

      bus.emit('gesture:tap', { worldX: 30, worldY: 10, screenX: 1, screenY: 1 });

      // The short-circuit must classify the hit as a reward BEFORE the unit-id
      // path — so the trap LocationStore's unitId never resolves to a location.
      expect(rewardCount, 'a reward hit must classify as a reward tap').toBeGreaterThanOrEqual(1);
      expect(unitIdTaps, 'a reward hit must NEVER fall through to the unit-id tap types')
        .toEqual([]);
    });

    it('does NOT emit tap:reward when the tap misses every marker (null hit)', () => {
      const bus = new EventBus();
      const manager = new HitTestManager(makeLayerStack(null), bus, trapLocationStore);

      const fired = [];
      bus.on('tap:reward', () => fired.push('reward'));
      bus.on('tap:empty', () => fired.push('empty'));

      bus.emit('gesture:tap', { worldX: 5000, worldY: 5000, screenX: 1, screenY: 1 });

      expect(fired, 'an empty tap must not surface as a reward tap').toEqual(['empty']);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Criterion 3 — WayfinderMap eventMap: tap:reward (engine bus) -> reward-tap CE.
  // ───────────────────────────────────────────────────────────────────────────
  describe('criterion 3: WayfinderMap re-dispatches tap:reward as a reward-tap CustomEvent', () => {
    let savedGlobals;

    function makeStyle() {
      const props = new Map();
      return {
        setProperty: (k, v) => props.set(k, v),
        getPropertyValue: (k) => props.get(k) ?? '',
        removeProperty: (k) => props.delete(k)
      };
    }

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
        this.hidden = false;
        this.value = '';
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
      getBoundingClientRect() { return { width: 800, height: 600, top: 0, left: 0 }; }
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
      dispatchEvent(event) {
        event.target = event.target || this;
        const arr = this._listeners.get(event.type);
        if (arr) for (const fn of [...arr]) fn(event);
        return true;
      }
    }

    class FakeShadowRoot extends FakeElement {
      constructor(host) { super('#shadow-root'); this.host = host; }
    }

    class FakeCustomEvent {
      constructor(type, init = {}) { this.type = type; this.detail = init.detail; this.target = null; }
    }

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
        constructor() { super('wayfinder-map'); this.ownerDocument = doc; }
        attachShadow() { const root = new FakeShadowRoot(this); this.shadowRoot = root; return root; }
      }

      const registry = new Map();
      const customElements = { define: (n, c) => registry.set(n, c), get: (n) => registry.get(n) };

      const win = {
        location: { href: 'http://localhost/' },
        innerWidth: 1280, innerHeight: 800,
        addEventListener: () => {}, removeEventListener: () => {},
        requestAnimationFrame: (fn) => { fn(0); return 1; },
        cancelAnimationFrame: () => {}
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

    beforeEach(() => {
      installDom();
      engineState.bus = null;
    });
    afterEach(() => {
      restoreDom();
      vi.restoreAllMocks();
      vi.resetModules();
    });

    // Mock MapEngine: a real EventBus stands in for the engine bus so the REAL
    // #wireEvents subscribes its handlers to it; init() resolves immediately.
    async function importComponent() {
      const { EventBus: RealBus } = await import('../../src/core/EventBus.js');
      vi.doMock('../../src/core/MapEngine.js', () => ({
        MapEngine: class {
          constructor() {
            this._bus = new RealBus();
            engineState.bus = this._bus;
            this.isInitialized = false;
          }
          on(event, cb) { return this._bus.on(event, cb); }
          off(event, cb) { this._bus.off(event, cb); }
          emit(event, data) { this._bus.emit(event, data); }
          async init() { this.isInitialized = true; }
          resize() {}
          getCurrentFloor() { return null; }
          getFloors() { return []; }
          getLevels() { return []; }
          getLocations() { return []; }
          hasRoute() { return false; }
          getRouteMode() { return 'escalator'; }
          getConfigValue() { return undefined; }
          dispose() {}
        }
      }));
      vi.resetModules();
      let mod = null;
      try { mod = await import('../../src/component/WayfinderMap.js'); } catch { mod = null; }
      expect(mod, 'WayfinderMap.js must export WayfinderMapElement').not.toBeNull();
      expect(mod.WayfinderMapElement, 'WayfinderMap.js must export WayfinderMapElement').toBeTypeOf('function');
      return mod.WayfinderMapElement;
    }

    async function mountedElement() {
      const WayfinderMapElement = await importComponent();
      const el = new WayfinderMapElement();
      el.setAttribute('maps-url', '/maps.json.gz');
      el.setAttribute('datas-url', '/datas.json.gz');
      await el.init();
      expect(engineState.bus, 'the component must wire its engine bus').not.toBeNull();
      return el;
    }

    it('emits a reward-tap CustomEvent whose detail deep-equals the tap:reward payload', async () => {
      const el = await mountedElement();

      const detail = {
        shopId: 5,
        rewards: [{ id: 1, title: '20% off' }, { id: 2, title: 'Free tote' }],
        location: { id: 'shop:5', title: 'Coffee', displayNodes: [] }
      };

      const seen = [];
      el.addEventListener('reward-tap', (e) => seen.push(e));

      // Emit on the engine bus exactly as MapEngine's reward handler does.
      engineState.bus.emit('tap:reward', detail);

      expect(seen.length, 'tap:reward must re-dispatch a single reward-tap CustomEvent').toBe(1);
      expect(seen[0].type, 'the dispatched event is named reward-tap').toBe('reward-tap');
      expect(seen[0].detail, 'reward-tap detail must deep-equal {shopId, rewards, location}').toEqual(detail);
    });

    it('does NOT surface tap:reward as location-tap or floor-tap', async () => {
      const el = await mountedElement();

      const fired = [];
      el.addEventListener('reward-tap', () => fired.push('reward-tap'));
      el.addEventListener('location-tap', () => fired.push('location-tap'));
      el.addEventListener('floor-tap', () => fired.push('floor-tap'));

      engineState.bus.emit('tap:reward', { shopId: 9, rewards: [], location: null });

      expect(fired, 'tap:reward maps ONLY to reward-tap').toEqual(['reward-tap']);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Criterion 4 — demo/basic.html registers a reward-tap listener that logs detail.
  // ───────────────────────────────────────────────────────────────────────────
  describe('criterion 4: demo/basic.html reward-tap manual hook', () => {
    const demoSrc = readFileSync(resolve(REPO_ROOT, 'demo', 'basic.html'), 'utf8');

    it('registers a reward-tap listener', () => {
      // addEventListener("reward-tap" or addEventListener('reward-tap'
      expect(demoSrc, 'demo must addEventListener for reward-tap')
        .toMatch(/addEventListener\(\s*['"]reward-tap['"]/);
    });

    it('the listener body calls console.log with the event detail', () => {
      // Isolate the reward-tap listener registration through its arrow/function body.
      const idx = demoSrc.search(/addEventListener\(\s*['"]reward-tap['"]/);
      expect(idx, 'reward-tap listener must be present to inspect its body').toBeGreaterThanOrEqual(0);
      const body = demoSrc.slice(idx, idx + 400);

      // The named event param the handler logs (event/e/ev/evt).
      const paramMatch = body.match(/['"]reward-tap['"]\s*,\s*\(?\s*([A-Za-z_$][\w$]*)/);
      expect(paramMatch, 'the reward-tap listener must take an event parameter').not.toBeNull();
      const param = paramMatch[1];

      expect(body, 'the listener must call console.log').toMatch(/console\.log\s*\(/);
      // ...and pass the event detail (e.detail / event.detail) to it.
      const detailRef = new RegExp(`console\\.log\\([^)]*${param}\\.detail`);
      expect(body, 'console.log must be passed the event detail').toMatch(detailRef);
    });
  });
});
// <<< TARS cap:reward-tap
