import { EventBus } from './EventBus.js';
import { Config } from './Config.js';
import { DataLoader } from '../data/DataLoader.js';
import { BundleLoader } from '../data/BundleLoader.js';
import { LocationStore } from '../data/LocationModel.js';
import { MapGeometryStore } from '../data/MapGeometryModel.js';
import { PathFinder } from '../navigation/PathFinder.js';
import { RouteManager } from '../navigation/RouteManager.js';
import { buildNavGraph } from '../navigation/NavGraph.js';
import { Renderer } from '../renderer/Renderer.js';
import { FloorLayer } from '../layers/FloorLayer.js';
import { LocationLayer } from '../layers/LocationLayer.js';
import { NavigationLayer } from '../layers/NavigationLayer.js';
import { PinMarkerLayer } from '../layers/PinMarkerLayer.js';
import { NavMarkerLayer } from '../layers/NavMarkerLayer.js';
import { GestureRecognizer } from '../interaction/GestureRecognizer.js';
import { HitTestManager } from '../interaction/HitTestManager.js';

/**
 * MapEngine is the central orchestrator for the wayfinder map.
 */
export class MapEngine {
  #canvas;
  #config;
  #eventBus;
  #initialized = false;
  #initializing = false;
  #disposed = false;

  #dataLoader;
  #bundleLoader;
  #locationStore;
  #mapGeometryStore;
  #bundleModel = null;

  #pathFinder;
  #routeManager;

  #renderer;

  #floorLayer;
  #locationLayer;
  #navigationLayer;
  #pinMarkerLayer;
  #navMarkerLayer;

  #gestureRecognizer;
  #hitTestManager;

  #currentFloor = null;
  #pendingFloorCode = null;
  #floors = [];
  #youAreHereNode = null;
  #configuredMinZoom;
  #configuredMaxZoom;

  #isZooming = false;
  #zoomDebounceId = null;
  #zoomDebounceMs = 150;
  #zoomEpsilon = 0.01;

  /**
   * @param {HTMLCanvasElement} canvas
   * @param {Object} config
   */
  constructor(canvas, config) {
    if (!canvas || !(canvas instanceof HTMLCanvasElement)) {
      throw new Error('MapEngine: canvas element is required');
    }

    this.#canvas = canvas;
    this.#config = new Config(config);
    this.#eventBus = new EventBus();

    this.#dataLoader = new DataLoader();
    this.#bundleLoader = new BundleLoader(this.#dataLoader);
    this.#locationStore = new LocationStore(this.#dataLoader);
    this.#mapGeometryStore = new MapGeometryStore(this.#dataLoader);

    this.#renderer = new Renderer(canvas, this.#eventBus, {
      showFps: this.#config.get('showFps')
    });

    this.#configuredMaxZoom = this.#config.get('maxZoom');
    this.#configuredMinZoom = this.#config.get('minZoom');

    if (typeof this.#configuredMinZoom === 'number') {
      this.#renderer.transform.setScaleBounds(this.#configuredMinZoom, this.#configuredMaxZoom);
    } else {
      this.#renderer.transform.setScaleBounds(0.1, this.#configuredMaxZoom);
    }
  }

  /**
   * Initialize the map engine (load data, create layers).
   * @returns {Promise<void>}
   */
  async init() {
    if (this.#initialized) return;
    if (this.#disposed) throw new Error('MapEngine: Cannot init after dispose');

    this.#initializing = true;
    try {
      await this.#loadData();
      this.#createNavigationSystem();
      this.#createLayers();
      this.#createInteractionSystem();
      this.#wireEvents();
      this.#configureYouAreHereNode();

      const initialFloor = this.#pendingFloorCode
        || this.#youAreHereNode?.level?.code
        || this.#config.get('defaultFloor')
        || this.#floors[0];
      this.#pendingFloorCode = null;

      if (initialFloor) {
        this.#currentFloor = null;
        this.setFloor(initialFloor, { fitToBounds: true });
      }

      this.#applyInitialYouAreHereView();

      this.#initialized = true;
      this.#initializing = false;
      this.#eventBus.emit('engine:ready', {});
    } catch (error) {
      this.#initializing = false;
      this.#eventBus.emit('engine:error', { error });
      throw error;
    }
  }

  /**
   * Dispose of the engine and release resources.
   */
  dispose() {
    if (this.#disposed) return;

    this.#renderer?.animator?.cancel();
    this.#navigationLayer?.stopAnimation?.();

    this.#gestureRecognizer?.dispose?.();

    if (this.#zoomDebounceId) {
      clearTimeout(this.#zoomDebounceId);
      this.#zoomDebounceId = null;
    }
    this.#isZooming = false;

    this.#renderer?.dispose();
    this.#eventBus.removeAllListeners();

    this.#disposed = true;
    this.#initialized = false;
  }

  /**
   * Check if engine is initialized.
   * @returns {boolean}
   */
  get isInitialized() {
    return this.#initialized;
  }

  /**
   * Get available floor codes.
   * @returns {string[]}
   */
  getFloors() {
    return [...this.#floors];
  }

  /**
   * Get available levels with metadata.
   * @returns {import('../data/LocationModel.js').Level[]}
   */
  getLevels() {
    return [...this.#locationStore.levels];
  }

  /**
   * Get current floor code.
   * @returns {string|null}
   */
  getCurrentFloor() {
    return this.#currentFloor;
  }

  /**
   * Switch to a different floor.
   * @param {string} floorCode
   * @param {Object} [options]
   */
  setFloor(floorCode, options = {}) {
    if (!this.#initialized && !this.#initializing) {
      console.warn('MapEngine: Not initialized');
      return;
    }

    const mapLevel = this.#mapGeometryStore.getLevelByCode(floorCode);
    if (!mapLevel) {
      console.warn(`MapEngine: Floor "${floorCode}" not found`);
      return;
    }

    if (!this.#hasRenderableLayers()) {
      this.#pendingFloorCode = floorCode;
      this.#currentFloor = floorCode;
      return;
    }

    const previousFloor = this.#currentFloor;
    this.#currentFloor = floorCode;

    this.#floorLayer.setMapLevel(mapLevel);
    this.#locationLayer.setFloor(floorCode);
    this.#navigationLayer.setFloor(floorCode);
    this.#pinMarkerLayer.setFloor(floorCode);
    this.#navMarkerLayer.setFloor(floorCode);

    // Fit the view on the INITIAL load only. A user-initiated floor switch — the
    // level selector and connector-pin (floor-transition) taps — preserves the
    // current zoom/pan/rotation so the user keeps spatial context across levels;
    // those call sites, like the navigation/focus pan paths, pass
    // { fitToBounds: false }. An explicit { fitToBounds: true } still refits.
    if (!previousFloor || (options.fitToBounds !== false && previousFloor !== floorCode)) {
      const bounds = this.#floorLayer.getBounds();
      if (bounds) {
        this.#renderer.fitToBounds(bounds);
        this.#restoreConfiguredScaleBounds();
      }
    }

    this.#renderer.requestRender();

    this.#eventBus.emit('floor:changed', {
      floor: floorCode,
      previousFloor
    });
  }

  /**
   * Enter navigation mode: display route between two locations.
   * Shows start marker (walk icon), end marker, and animated route polyline.
   * @param {number} startLocationId
   * @param {number} endLocationId
   * @param {Object} [options]
   * @param {boolean} [options.animate=true] - Animate camera to start node
   * @param {number} [options.duration=600] - Camera animation duration
   * @param {number} [options.scale=3] - Preferred target scale before clamp
   * @returns {Object}
   */
  navigateTo(startLocationId, endLocationId, options = {}) {
    if (!this.#initialized) {
      throw new Error('MapEngine: Not initialized');
    }

    const result = this.#routeManager.navigateTo(startLocationId, endLocationId, options);

    if (result.success) {
      this.#navigationLayer.setPath(result);
      this.#pinMarkerLayer.setPath(result);
      this.#pinMarkerLayer.setYouAreHereVisible(false);
      this.#navMarkerLayer.setPath(result);

      const startAnchor = result.startAnchor;
      const startFloor = startAnchor?.levelCode;
      if (startFloor && startFloor !== this.#currentFloor) {
        // Navigation pans to the start anchor below; skip the floor-switch refit.
        this.setFloor(startFloor, { fitToBounds: false });
      }

      if (startAnchor) {
        const transform = this.#renderer.transform;
        const { min, max } = transform.getScaleBounds();
        const desiredScale = Number.isFinite(options.scale) ? options.scale : 3;
        const targetScale = Math.max(min, Math.min(max, desiredScale));

        this.centerOn(startAnchor.x, startAnchor.y, {
          animate: options.animate ?? true,
          duration: options.duration ?? 600,
          scale: targetScale
        });
      }

      this.#renderer.requestRender();
    }

    return result;
  }

  /**
   * Navigate from the "You are here" node directly to a destination location,
   * bypassing the location lookup for the start point.
   * @param {number} endLocationId
   * @param {Object} [options]
   * @param {boolean} [options.animate=true]
   * @param {number} [options.duration=600]
   * @param {number} [options.scale=3]
   * @param {string|null} [options.connectorConstraint]
   * @returns {Object}
   */
  navigateFromYouAreHere(endLocationId, options = {}) {
    if (!this.#initialized) {
      throw new Error('MapEngine: Not initialized');
    }

    const node = this.#youAreHereNode;
    if (!node?.point) {
      return { success: false, error: 'You-are-here node not available' };
    }

    const result = this.#routeManager.navigateFromNode(node, endLocationId, options);

    if (result.success) {
      this.#navigationLayer.setPath(result);
      this.#pinMarkerLayer.setPath(result);
      this.#pinMarkerLayer.setYouAreHereVisible(false);
      this.#navMarkerLayer.setPath(result);

      const startAnchor = result.startAnchor;
      const startFloor = startAnchor?.levelCode;
      if (startFloor && startFloor !== this.#currentFloor) {
        // Navigation pans to the start anchor below; skip the floor-switch refit.
        this.setFloor(startFloor, { fitToBounds: false });
      }

      if (startAnchor) {
        const transform = this.#renderer.transform;
        const { min, max } = transform.getScaleBounds();
        const desiredScale = Number.isFinite(options.scale) ? options.scale : 3;
        const targetScale = Math.max(min, Math.min(max, desiredScale));

        this.centerOn(startAnchor.x, startAnchor.y, {
          animate: options.animate ?? true,
          duration: options.duration ?? 600,
          scale: targetScale
        });
      }

      this.#renderer.requestRender();
    }

    return result;
  }

  /**
   * Enter focus mode: highlight a single location with pin marker (no route).
   * Clears any existing route by default and shows end marker at the location.
   * @param {number} locationId
   * @param {Object} [options]
   * @param {boolean} [options.clearRoute=true] - Clear existing route before focusing
   * @param {boolean} [options.switchFloor=true] - Switch to location's floor
   * @param {boolean} [options.animate=true] - Animate the camera transition
   * @param {number} [options.duration=600] - Animation duration in ms
   * @param {number} [options.scale] - Target zoom scale
   * @returns {{success:boolean,location?:Object,node?:Object,floor?:string,error?:string}}
   */
  focusLocation(locationId, options = {}) {
    if (!this.#initialized) {
      throw new Error('MapEngine: Not initialized');
    }

    const location = this.#locationStore?.getLocation(locationId);
    if (!location) {
      return { success: false, error: 'Location not found' };
    }

    const shouldClearRoute = options.clearRoute ?? true;
    if (shouldClearRoute) {
      this.clearRoute();
    }

    this.#pinMarkerLayer.setManualEndLocation(location);

    const picked = this.#pickLocationNode(location);
    if (!picked) {
      this.#pinMarkerLayer.clear();
      return { success: false, error: 'Location has no nodes' };
    }

    const { node, floorCode } = picked;
    const shouldSwitchFloor = options.switchFloor ?? true;
    if (shouldSwitchFloor && floorCode && floorCode !== this.#currentFloor) {
      // Focus pans to the located node below; skip the floor-switch refit.
      this.setFloor(floorCode, { fitToBounds: false });
    }

    const transform = this.#renderer.transform;
    const { min, max } = transform.getScaleBounds();

    let targetScale;
    if (Number.isFinite(options.scale)) {
      targetScale = Math.max(min, Math.min(max, options.scale));
    } else {
      const desiredScale = 3;
      targetScale = Math.max(min, Math.min(max, desiredScale));
    }

    this.centerOn(node.point.x, node.point.y, {
      animate: options.animate ?? true,
      duration: options.duration ?? 600,
      scale: targetScale
    });

    const isSameAsHere = Boolean(this.#youAreHereNode?.id && node?.id === this.#youAreHereNode.id);
    this.#pinMarkerLayer.setYouAreHereVisible(!isSameAsHere);

    return { success: true, location, node, floor: node.level?.code ?? floorCode };
  }

  /**
   * Focus on a specific graph node by its node ID.
   * Resolves the node's parent location and delegates to focusLocation().
   * @param {number} nodeId - Graph node ID
   * @param {Object} [options] - Same options as focusLocation()
   * @returns {{success:boolean,location?:Object,node?:Object,floor?:string,error?:string}}
   */
  focusNode(nodeId, options = {}) {
    if (!this.#initialized) {
      throw new Error('MapEngine: Not initialized');
    }

    const node = this.#locationStore.getNode(nodeId);
    if (!node) {
      return { success: false, error: `Node "${nodeId}" not found` };
    }

    const location = node.location;
    if (!location?.id) {
      return { success: false, error: `Node "${nodeId}" has no associated location` };
    }

    return this.focusLocation(location.id, options);
  }

  /**
   * Return to browse mode: clear route, markers, and navigation state.
   * Removes start/end markers and route polyline, returning to default map view.
   */
  clearRoute() {
    if (!this.#initialized) return;

    this.#routeManager.clearRoute();
    this.#navigationLayer.clearPath();
    this.#pinMarkerLayer.clear();
    this.#pinMarkerLayer.setYouAreHereVisible(true);
    this.#navMarkerLayer.clear();

    this.#renderer.requestRender();
  }

  /**
   * Check whether a valid "You are here" node is available.
   * @returns {boolean}
   */
  hasYouAreHere() {
    return Boolean(this.#youAreHereNode?.point);
  }

  /**
   * Get routable start location id for the configured "You are here" node.
   * @returns {number|null}
   */
  getYouAreHereStartLocationId() {
    const node = this.#youAreHereNode;
    if (!node) return null;

    const nodeLocation = node.location;
    if (typeof nodeLocation === 'number' && Number.isFinite(nodeLocation)) {
      return nodeLocation;
    }
    if (nodeLocation && typeof nodeLocation === 'object' && Number.isFinite(nodeLocation.id)) {
      return nodeLocation.id;
    }

    return null;
  }

  /**
   * Center and zoom to the configured "You are here" node.
   * @param {Object} [options]
   * @param {boolean} [options.switchFloor=true] - Switch to marker floor first
   * @param {boolean} [options.animate=true] - Animate the camera transition
   * @param {number} [options.duration=600] - Animation duration in ms
   * @param {number} [options.scale=3] - Target zoom scale before clamp
   * @returns {{success:boolean,node?:Object,floor?:string,error?:string}}
   */
  centerOnYouAreHere(options = {}) {
    if (!this.#initialized) {
      throw new Error('MapEngine: Not initialized');
    }

    const node = this.#youAreHereNode;
    if (!node?.point) {
      return { success: false, error: 'You-are-here node not available' };
    }

    const floorCode = node.level?.code ?? null;
    const shouldSwitchFloor = options.switchFloor ?? true;
    if (shouldSwitchFloor && floorCode && floorCode !== this.#currentFloor) {
      // Focus pans to the you-are-here node below; skip the floor-switch refit.
      this.setFloor(floorCode, { fitToBounds: false });
    }

    const transform = this.#renderer.transform;
    const { min, max } = transform.getScaleBounds();
    const desiredScale = Number.isFinite(options.scale) ? options.scale : 3;
    const targetScale = Math.max(min, Math.min(max, desiredScale));

    this.centerOn(node.point.x, node.point.y, {
      animate: options.animate ?? true,
      duration: options.duration ?? 600,
      scale: targetScale
    });

    return { success: true, node, floor: floorCode };
  }

  /**
   * Check if there's an active route.
   * @returns {boolean}
   */
  hasRoute() {
    return this.#routeManager?.hasRoute() ?? false;
  }

  /**
   * Get the current route result.
   * @returns {Object|null}
   */
  getCurrentRoute() {
    return this.#routeManager?.getCurrentRoute() ?? null;
  }

  /**
   * Set the preferred route mode.
   * @param {'escalator'|'lift'} mode
   */
  setRouteMode(mode) {
    if (!this.#initialized) return;
    this.#routeManager.setRouteMode(mode);
  }

  /**
   * Get the current route mode.
   * @returns {'escalator'|'lift'}
   */
  getRouteMode() {
    return this.#routeManager?.getRouteMode() ?? 'escalator';
  }

  /**
   * Read a config value.
   * @param {string} key
   * @returns {any}
   */
  getConfigValue(key) {
    return this.#config.get(key);
  }

  /**
   * Update location label styling.
   * @param {{
   *   fontSize?: number,
   *   minFontSize?: number,
   *   fontFamily?: string,
   *   textColor?: string,
   *   backgroundColor?: string
   * }} style
   */
  setLocationLabelStyle(style) {
    if (!style || typeof style !== 'object') return;
    this.#locationLayer?.setStyle?.(style);
    this.#renderer?.requestRender?.();
  }

  /**
   * Update pin marker icon sources.
   * @param {{iconWalk?: string, iconStand?: string}} icons
   */
  setPinMarkerIcons(icons) {
    if (!icons || typeof icons !== 'object') return;
    const nextIcons = {};
    if (Object.prototype.hasOwnProperty.call(icons, 'iconWalk')) {
      nextIcons.iconWalk = icons.iconWalk;
    }
    if (Object.prototype.hasOwnProperty.call(icons, 'iconStand')) {
      nextIcons.iconStand = icons.iconStand;
    }
    this.#pinMarkerLayer?.setIconSources?.(nextIcons);
    this.#renderer?.requestRender?.();
  }

  /**
   * Update pin marker styling.
   * @param {{
   *   startForegroundColor?: string,
   *   startForegroundMode?: 'tint'|'original',
   *   startBackgroundColor?: string,
   *   endForegroundColor?: string,
   *   endBackgroundColor?: string,
   *   connectorForegroundColor?: string,
   *   connectorBackgroundColor?: string
   * }} style
   */
  setPinMarkerStyle(style) {
    if (!style || typeof style !== 'object') return;
    const pinStyle = {};
    if (Object.prototype.hasOwnProperty.call(style, 'startForegroundColor')) {
      pinStyle.startForegroundColor = style.startForegroundColor;
    }
    if (Object.prototype.hasOwnProperty.call(style, 'startForegroundMode')) {
      pinStyle.startForegroundMode = style.startForegroundMode;
    }
    if (Object.prototype.hasOwnProperty.call(style, 'startBackgroundColor')) {
      pinStyle.startBackgroundColor = style.startBackgroundColor;
    }
    if (Object.prototype.hasOwnProperty.call(style, 'endForegroundColor')) {
      pinStyle.endForegroundColor = style.endForegroundColor;
    }
    if (Object.prototype.hasOwnProperty.call(style, 'endBackgroundColor')) {
      pinStyle.endBackgroundColor = style.endBackgroundColor;
    }

    const navStyle = {};
    if (Object.prototype.hasOwnProperty.call(style, 'connectorForegroundColor')) {
      navStyle.foregroundColor = style.connectorForegroundColor;
    }
    if (Object.prototype.hasOwnProperty.call(style, 'connectorBackgroundColor')) {
      navStyle.backgroundColor = style.connectorBackgroundColor;
    }

    this.#pinMarkerLayer?.setStyle?.(pinStyle);
    this.#navMarkerLayer?.setStyle?.(navStyle);
    this.#renderer?.requestRender?.();
  }

  /**
   * Center the view on a world coordinate.
   * @param {number} worldX
   * @param {number} worldY
   * @param {Object} [options]
   */
  centerOn(worldX, worldY, options = {}) {
    if (!this.#initialized) return;

    const transform = this.#renderer.transform;

    if (options.animate) {
      const current = transform.getViewState();
      const target = {
        scale: options.scale ?? current.scale,
        ...this.#computePanForCenter(worldX, worldY, options.scale ?? current.scale)
      };
      this.#renderer.animateTo({
        ...target,
        duration: options.duration ?? 600
      });
    } else {
      transform.centerOn(worldX, worldY);
      this.#emitViewChange();
      this.#renderer.requestRender();
    }
  }

  /**
   * Reset the view to fit the current floor.
   */
  resetView() {
    if (!this.#initialized) return;

    const bounds = this.#floorLayer.getBounds();
    if (bounds) {
      this.#renderer.fitToBounds(bounds);
      this.#restoreConfiguredScaleBounds();
    }
  }

  /**
   * Reset rotation to zero.
   */
  resetRotation() {
    if (!this.#initialized) return;

    this.#renderer.transform.resetRotation();
    this.#emitViewChange();
    this.#renderer.requestRender();
  }

  /**
   * Zoom by a factor.
   * @param {number} factor
   * @param {number} [anchorX]
   * @param {number} [anchorY]
   */
  zoom(factor, anchorX, anchorY) {
    if (!this.#initialized) return;

    this.#renderer.transform.zoom(factor, anchorX, anchorY);
    this.#emitViewChange();
    this.#renderer.requestRender();
  }

  /**
   * Get current view state.
   * @returns {{scale:number,panX:number,panY:number,rotation:number}}
   */
  getViewState() {
    return this.#renderer?.transform?.getViewState() ?? {
      scale: 1,
      panX: 0,
      panY: 0,
      rotation: 0
    };
  }

  /**
   * Set view state directly.
   * @param {Object} state
   */
  setViewState(state) {
    if (!this.#initialized) return;

    this.#renderer.transform.setViewState(state);
    this.#emitViewChange();
    this.#renderer.requestRender();
  }

  /**
   * Get all navigable locations.
   * @returns {Array}
   */
  getLocations() {
    return this.#locationStore?.locations ?? [];
  }

  /**
   * Get a location by ID.
   * @param {number} id
   * @returns {Object|undefined}
   */
  getLocation(id) {
    return this.#locationStore?.getLocation(id);
  }

  /**
   * Get locations on a specific floor.
   * @param {string} floorCode
   * @returns {Array}
   */
  getLocationsOnFloor(floorCode) {
    return this.#locationStore?.getLocationsOnLevel(floorCode) ?? [];
  }

  /**
   * Subscribe to an event.
   * @param {string} event
   * @param {Function} callback
   * @returns {Function}
   */
  on(event, callback) {
    return this.#eventBus.on(event, callback);
  }

  /**
   * Subscribe to an event once.
   * @param {string} event
   * @param {Function} callback
   * @returns {Function}
   */
  once(event, callback) {
    return this.#eventBus.once(event, callback);
  }

  /**
   * Unsubscribe from an event.
   * @param {string} event
   * @param {Function} callback
   */
  off(event, callback) {
    this.#eventBus.off(event, callback);
  }

  /**
   * Handle canvas resize.
   * @param {number} width
   * @param {number} height
   */
  resize(width, height) {
    if (!this.#initialized) return;

    this.#renderer.resize(width, height);

    if (!this.hasRoute()) {
      this.resetView();
    }
  }

  async #loadData() {
    const mapsUrl = this.#config.get('mapsUrl');
    const datasUrl = this.#config.get('datasUrl');
    const renderScale = this.#config.get('renderScale');

    // Two parallel fetches of the CMS-split halves (`maps_…` geometry +
    // `datas_…` directory) — the legacy single `data-url` / parallel `map-url`
    // path is gone. BundleLoader validates each half and rejects (no model) when
    // a required key is missing, so a structurally broken half never reaches the
    // stores (and `data:loaded` is never emitted for it).
    const bundle = await this.#bundleLoader.load({ mapsUrl, datasUrl });
    this.#bundleModel = bundle;

    // Both stores hydrate from the one parsed bundle object.
    this.#hydrateStore(this.#locationStore, bundle, { renderScale });
    this.#hydrateStore(this.#mapGeometryStore, bundle, { renderScale });

    this.#floors = this.#mapGeometryStore.getFloorCodes();

    this.#eventBus.emit('data:loaded', {
      locationCount: this.#locationStore.locations.length,
      floorCount: this.#floors.length
    });
  }

  /**
   * Thread the parsed bundle into a store, preferring the synchronous
   * `hydrate(bundle, options)` contract and falling back to the legacy async
   * `load(bundle, options)` if a store only exposes the latter.
   * @param {Object} store
   * @param {Object} bundle
   * @param {Object} options
   * @returns {void|Promise<void>}
   */
  #hydrateStore(store, bundle, options) {
    if (typeof store.hydrate === 'function') {
      return store.hydrate(bundle, options);
    }
    return store.load(bundle, options);
  }

  #createNavigationSystem() {
    // Build the routing graph from the already-parsed bundle (one-fetch
    // hydration): meshed level graphs + parsed connector transitions. The
    // PathFinder snaps catalog ids to mesh anchors via the LocationStore.
    const transitions = this.#bundleModel?.transitions ?? [];
    const navGraph = typeof this.#mapGeometryStore.buildNavGraph === 'function'
      ? this.#mapGeometryStore.buildNavGraph(transitions)
      : buildNavGraph(this.#mapGeometryStore.levels ?? [], transitions, {
        navmeshByLevel: this.#bundleModel?.navmesh_by_level ?? null,
        unitsById: this.#unitsByIdFromModel()
      });

    this.#pathFinder = new PathFinder(navGraph, this.#locationStore);
    this.#pathFinder.setRouteMode(this.#config.get('routeMode'));

    this.#routeManager = new RouteManager(this.#pathFinder, this.#eventBus);
  }

  /** Index the bundle model's units by id (for the nav-graph connector kinds). */
  #unitsByIdFromModel() {
    const map = new Map();
    for (const unit of this.#bundleModel?.units ?? []) {
      if (unit && unit.id != null) map.set(unit.id, unit);
    }
    return map;
  }

  #createLayers() {
    this.#floorLayer = new FloorLayer();
    this.#locationLayer = new LocationLayer(this.#locationStore);
    this.#navigationLayer = new NavigationLayer();
    this.#pinMarkerLayer = new PinMarkerLayer();
    this.#navMarkerLayer = new NavMarkerLayer();

    const locationStyle = {
      fontSize: this.#config.get('labelFontSize'),
      minFontSize: this.#config.get('labelMinFontSize')
    };
    const labelFontFamily = this.#config.get('mapLabelFontFamily');
    if (typeof labelFontFamily === 'string' && labelFontFamily.trim()) {
      locationStyle.fontFamily = labelFontFamily;
    }
    const labelFontColor = this.#config.get('mapLabelFontColor');
    if (typeof labelFontColor === 'string' && labelFontColor.trim()) {
      locationStyle.textColor = labelFontColor;
    }
    const labelBackgroundColor = this.#config.get('mapLabelBackgroundColor');
    if (typeof labelBackgroundColor === 'string' && labelBackgroundColor.trim()) {
      locationStyle.backgroundColor = labelBackgroundColor;
    }
    this.#locationLayer.setStyle(locationStyle);

    this.#pinMarkerLayer.setIconSources({
      iconWalk: this.#config.get('iconWalk'),
      iconStand: this.#config.get('iconStand')
    });
    const mapMarkerStartFgColor = this.#config.get('mapMarkerStartFgColor');
    const startForegroundMode = typeof mapMarkerStartFgColor === 'string'
      && mapMarkerStartFgColor.trim().toLowerCase() === 'none'
      ? 'original'
      : 'tint';
    this.#pinMarkerLayer.setStyle({
      startForegroundColor: mapMarkerStartFgColor,
      startForegroundMode,
      startBackgroundColor: this.#config.get('mapMarkerStartBgColor'),
      endForegroundColor: this.#config.get('mapMarkerEndFgColor'),
      endBackgroundColor: this.#config.get('mapMarkerEndBgColor')
    });
    this.#navMarkerLayer.setStyle({
      foregroundColor: this.#config.get('mapMarkerConnectorFgColor'),
      backgroundColor: this.#config.get('mapMarkerConnectorBgColor')
    });

    const ordinals = new Map();
    for (const level of this.#mapGeometryStore.levels) {
      ordinals.set(level.code, level.ordinal);
    }
    this.#navMarkerLayer.setLevelOrdinals(ordinals);

    const layers = this.#renderer.layers;
    layers.add(this.#floorLayer);
    layers.add(this.#navigationLayer);
    layers.add(this.#locationLayer);
    layers.add(this.#pinMarkerLayer);
    layers.add(this.#navMarkerLayer);
  }

  #configureYouAreHereNode() {
    const nodeId = this.#config.get('youAreHereNodeId');
    if (!Number.isFinite(nodeId)) {
      this.#youAreHereNode = null;
      this.#pinMarkerLayer?.setYouAreHereNode?.(null);
      return;
    }

    const node = this.#locationStore.getNode(nodeId);
    if (!node) {
      console.warn(`MapEngine: You-are-here node "${nodeId}" not found`);
      this.#youAreHereNode = null;
      this.#pinMarkerLayer?.setYouAreHereNode?.(null);
      return;
    }

    this.#youAreHereNode = node;
    this.#pinMarkerLayer?.setYouAreHereNode?.(node);
    this.#pinMarkerLayer?.setYouAreHereVisible?.(true);
  }

  #applyInitialYouAreHereView() {
    const node = this.#youAreHereNode;
    if (!node?.point) return;
    if (node.level?.code !== this.#currentFloor) return;

    const transform = this.#renderer.transform;
    const { min, max } = transform.getScaleBounds();
    const targetScale = Math.max(min, Math.min(max, 3));
    const pan = this.#computePanForCenter(node.point.x, node.point.y, targetScale);
    this.#renderer.animateTo({
      scale: targetScale,
      panX: pan.panX,
      panY: pan.panY,
      duration: 900
    });
  }

  #createInteractionSystem() {
    this.#gestureRecognizer = new GestureRecognizer(
      this.#canvas,
      this.#eventBus,
      this.#renderer.transform
    );

    this.#hitTestManager = new HitTestManager(
      this.#renderer.layers,
      this.#eventBus,
      this.#locationStore
    );

    this.#hitTestManager.registerHandler('floor-transition', (result) => {
      // Tapping a connector bubble switches levels but KEEPS the current view
      // (zoom/pan/rotation) so the user doesn't lose spatial context — same opt-out
      // the navigation/focus pan paths use.
      this.setFloor(result.targetFloor, { fitToBounds: false });
    });
  }

  #wireEvents() {
    this.#eventBus.on('gesture:pan', (e) => {
      this.#renderer.animator.cancel();
      this.#renderer.transform.pan(e.deltaX, e.deltaY);
      this.#emitViewChange();
      this.#renderer.requestRender();
    });

    this.#eventBus.on('gesture:zoom', (e) => {
      this.#renderer.animator.cancel();
      this.#renderer.transform.zoom(e.factor, e.anchorX, e.anchorY);
      this.#emitViewChange();
      this.#markZoomActivity();
      this.#renderer.requestRender();
    });

    this.#eventBus.on('gesture:multitouch', (e) => {
      this.#renderer.animator.cancel();
      this.#applyMultitouch(e);
      this.#emitViewChange();
      const zoomDelta = Math.abs((e.zoomFactor ?? 1) - 1);
      if (zoomDelta > this.#zoomEpsilon) {
        this.#markZoomActivity();
      }
      this.#renderer.requestRender();
    });
  }

  #applyMultitouch(e) {
    const transform = this.#renderer.transform;
    const state = transform.getViewState();

    const focusWorld = transform.screenToWorld(e.focusX, e.focusY);

    let newScale = state.scale * e.zoomFactor;
    const { min: minScale, max: maxScale } = transform.getScaleBounds();
    newScale = Math.max(minScale, Math.min(maxScale, newScale));

    const enableRotation = this.#config.get('enableRotation');
    const newRotation = enableRotation ? state.rotation + e.rotationDelta : state.rotation;

    const center = transform.getCanvasCenter();
    const cos = Math.cos(newRotation);
    const sin = Math.sin(newRotation);
    const sx = focusWorld.x * newScale;
    const sy = focusWorld.y * newScale;
    const rx = sx * cos - sy * sin;
    const ry = sx * sin + sy * cos;
    let newPanX = e.focusX - center.x - rx;
    let newPanY = e.focusY - center.y - ry;

    newPanX += e.panDeltaX;
    newPanY += e.panDeltaY;

    transform.setViewState({
      scale: newScale,
      rotation: newRotation,
      panX: newPanX,
      panY: newPanY
    });
  }

  #computePanForCenter(worldX, worldY, scale, rotation = this.#renderer.transform.getViewState().rotation) {
    const sx = worldX * scale;
    const sy = worldY * scale;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const rx = sx * cos - sy * sin;
    const ry = sx * sin + sy * cos;
    return { panX: -rx, panY: -ry };
  }

  #emitViewChange() {
    const state = this.#renderer.transform.getViewState();
    this.#eventBus.emit('view:changed', state);
  }

  #hasRenderableLayers() {
    return Boolean(
      this.#floorLayer
      && this.#locationLayer
      && this.#navigationLayer
      && this.#pinMarkerLayer
      && this.#navMarkerLayer
    );
  }

  #restoreConfiguredScaleBounds() {
    if (typeof this.#configuredMinZoom !== 'number') return;
    this.#renderer.transform.setScaleBounds(this.#configuredMinZoom, this.#configuredMaxZoom);
  }

  #markZoomActivity() {
    if (!this.#isZooming) {
      this.#isZooming = true;
      this.#locationLayer?.beginZoom?.();
    }

    if (this.#zoomDebounceId) {
      clearTimeout(this.#zoomDebounceId);
    }

    this.#zoomDebounceId = setTimeout(() => {
      this.#endZooming();
    }, this.#zoomDebounceMs);
  }

  #endZooming() {
    if (!this.#isZooming) return;
    this.#isZooming = false;

    if (this.#zoomDebounceId) {
      clearTimeout(this.#zoomDebounceId);
      this.#zoomDebounceId = null;
    }

    this.#locationLayer?.endZoom?.();
    this.#renderer.requestRender();
  }

  #pickLocationNode(location) {
    // Prefer the destination-catalog placements (`displayNodes`); fall back to
    // the legacy `nodes` array only when a Location carries no displayNodes.
    // Bundle-built Locations populate `displayNodes` and leave `nodes` empty,
    // so reading `nodes` alone would make focusLocation report "has no nodes".
    const candidates = location?.displayNodes?.length
      ? location.displayNodes
      : location?.nodes;
    if (!candidates?.length) return null;

    const floorOf = (n) => n?.levelCode ?? n?.level?.code ?? null;

    const currentFloor = this.#currentFloor;
    const onCurrent = currentFloor
      ? candidates.find((n) => floorOf(n) === currentFloor)
      : null;
    const node = onCurrent || candidates[0];
    if (!node) return null;

    return { node, floorCode: floorOf(node) };
  }
}
