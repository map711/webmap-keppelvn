import { MapEngine } from '../core/MapEngine.js';
import QRCode from 'qrcode-generator';
import { sortFloorCodesByPosition } from './controls/levelOrder.js';
import { buildShareUrl, captureMapShareState, parseShareUrl } from './controls/deepLinkState.js';
import { styles } from './styles.js';
import {
  ICON_WALK,
  ICON_STAND,
  ICON_PIN,
  ICON_SEARCH,
  ICON_CLOSE,
  ICON_EXPAND,
  ICON_COLLAPSE,
  ICON_QR,
  ICON_WHEELCHAIR,
  ICON_ESCALATOR
} from '../assets/icons.js';

const DEFAULT_ICON_SET = Object.freeze({
  walk: ICON_WALK,
  stand: ICON_STAND,
  pin: ICON_PIN,
  search: ICON_SEARCH,
  close: ICON_CLOSE,
  expand: ICON_EXPAND,
  collapse: ICON_COLLAPSE,
  qr: ICON_QR,
  wheelchair: ICON_WHEELCHAIR,
  escalator: ICON_ESCALATOR
});

const ICON_ATTR_TO_KEY = Object.freeze({
  'icon-walk': 'walk',
  'icon-stand': 'stand',
  'icon-pin': 'pin',
  'icon-qr': 'qr',
  'icon-wheelchair': 'wheelchair',
  'icon-escalator': 'escalator'
});

const DATA_IMAGE_ICON_PATTERN = /^data:image\//i;
const HTTP_ICON_PATTERN = /^https?:\/\//i;
const URL_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;
const COLOR_TOKEN_NONE = 'none';
const DEFAULT_CONTROL_FG = '#000000';
const DEFAULT_CONTROL_BG = '#ffffff';
const DEFAULT_CONTROL_ACTIVE_FG = '#ffffff';
const DEFAULT_CONTROL_ACTIVE_BG = '#000000';
const DEFAULT_MARKER_START_FG = '#ffffff';
const DEFAULT_MARKER_END_FG = '#ffffff';
const DEFAULT_MARKER_CONNECTOR_FG = '#ffffff';
const DEFAULT_MARKER_START_BG = 'rgba(0,0,0,0.7)';
const DEFAULT_MARKER_END_BG = 'rgba(0,0,0,0.7)';
const DEFAULT_MARKER_CONNECTOR_BG = 'rgba(109, 151, 254, 0.93)';

/**
 * <wayfinder-map> Custom Element
 */
class WayfinderMapElement extends HTMLElement {
  static get observedAttributes() {
    return [
      'data-url',
      'map-url',
      'default-floor',
      'you-are-here-node-id',
      'focus-node-id',
      'focus-shop-id',
      'route-mode',
      'render-scale',
      'desktop-render-scale',
      'mobile-render-scale',
      'max-zoom',
      'desktop-max-zoom',
      'mobile-max-zoom',
      'min-zoom',
      'desktop-min-zoom',
      'mobile-min-zoom',
      'label-font-size',
      'desktop-label-font-size',
      'mobile-label-font-size',
      'label-min-font-size',
      'desktop-label-min-font-size',
      'mobile-label-min-font-size',
      'map-label-font-family',
      'map-label-font-color',
      'map-label-background-color',
      'control-fg-color',
      'control-bg-color',
      'control-active-fg-color',
      'control-active-bg-color',
      'map-marker-start-fg-color',
      'map-marker-start-bg-color',
      'map-marker-end-fg-color',
      'map-marker-end-bg-color',
      'map-marker-connector-fg-color',
      'map-marker-connector-bg-color',
      'locale',
      'show-fps',
      'enable-rotation',
      'disable-rotation',
      'level-selector',
      'search-control',
      'icon-walk',
      'icon-stand',
      'icon-pin',
      'icon-qr',
      'icon-wheelchair',
      'icon-escalator'
    ];
  }

  #engine = null;
  #canvas = null;
  #shadowRoot = null;
  #resizeObserver = null;
  #initialized = false;
  #pendingInit = false;
  #levelSelectorEl = null;
  #levelSelectorEnabled = false;
  #levelSelectorClickHandler = null;
  #levelSelectorUnsubFloor = null;
  #levelSelectorUnsubData = null;
  #controlRailEl = null;
  #locateControlsEl = null;
  #locateHereButton = null;
  #locateStartButton = null;
  #locateFocusButton = null;
  #locateLiftButton = null;
  #locateEscalatorButton = null;
  #searchQrButton = null;
  #locateClickHandler = null;
  #locateUnsubRouteFound = null;
  #locateUnsubRouteCleared = null;
  #qrModalEl = null;
  #qrModalCodeEl = null;
  #qrModalCopyButton = null;
  #qrModalClickHandler = null;
  #qrModalKeydownHandler = null;
  #qrModalOpen = false;
  #qrShareUrl = '';
  #qrCopyResetTimer = null;
  #searchContainerEl = null;
  #searchPanelEl = null;
  #searchHeaderEl = null;
  #searchInputWrapper = null;
  #searchInputEl = null;
  #searchClearButton = null;
  #searchSelectedEl = null;
  #searchSelectedText = null;
  #searchResultsEl = null;
  #searchInfoEl = null;
  #searchInfoHeaderActionsEl = null;
  #searchInfoExpandButton = null;
  #searchInfoExpandIconEl = null;
  #searchInfoCloseButton = null;
  #searchInfoMediaEl = null;
  #searchInfoMediaTrackEl = null;
  #searchInfoPagerEl = null;
  #searchInfoPagerButtons = [];
  #searchInfoMediaScrollHandler = null;
  #searchInfoBodyEl = null;
  #searchInfoMetaEl = null;
  #searchInfoLogoEl = null;
  #searchInfoLogoImgEl = null;
  #searchInfoTextEl = null;
  #searchInfoTitleEl = null;
  #searchInfoVenueEl = null;
  #searchInfoDescriptionEl = null;
  #searchInfoDescriptionToggleEl = null;
  #searchDirectionButton = null;
  #searchToggleButton = null;
  #searchBackButton = null;
  #searchControlEnabled = false;
  #searchOpen = false;
  #searchQuery = '';
  #searchIndex = [];
  #selectedLocationId = null;
  #searchClickHandler = null;
  #searchInputHandler = null;
  #searchKeydownHandler = null;
  #searchUnsubData = null;
  #searchUnsubRouteFound = null;
  #searchOutsidePointerHandler = null;
  #searchOutsideFocusHandler = null;
  #searchInfoResizeObserver = null;
  #searchLayoutResizeHandler = null;
  #viewportInsetHandler = null;
  #visualViewportRef = null;
  #isSearchDescriptionExpanded = false;
  #isSearchInfoExpanded = false;
  #mapMode = 'browse';
  #syncInProgress = false;
  #previousDeviceMode = null;
  #focusedLocationId = null;
  #startLocationId = null;
  #endLocationId = null;
  #focusedNode = null;
  #startNode = null;
  #endNode = null;
  #searchNavMode = false;
  #navActiveField = null;
  #navFromLocationId = null;
  #navToLocationId = null;
  #searchNavHeaderEl = null;
  #searchNavBackButton = null;
  #searchNavFieldsEl = null;
  #searchNavFromFieldEl = null;
  #searchNavToFieldEl = null;
  #searchNavFromValueEl = null;
  #searchNavFromIconEl = null;
  #searchNavToValueEl = null;
  #searchNavFromClearButton = null;
  #searchNavToClearButton = null;
  #navPreSelectedLocationId = null;
  #searchNavSummaryEl = null;
  #searchNavSummaryFromEl = null;
  #searchNavSummaryToEl = null;
  #navConnectorConstraint = null;
  #navUsesHereStart = false;
  #icons = { ...DEFAULT_ICON_SET };
  #controlTintCache = new Map();

  constructor() {
    super();

    this.#shadowRoot = this.attachShadow({ mode: 'open' });
    this.#createShadowDOM();
    this.#setupResizeObserver();
  }

  connectedCallback() {
    // Host-attribute/style mutations (setProperty) and attribute syncing are
    // deferred out of the constructor: mutating the host during the synchronous
    // createElement upgrade reaction violates the Custom Elements spec
    // ("must not have attributes/children") and throws NotSupportedError,
    // leaving the element as HTMLUnknownElement.
    this.#applyControlThemeFromAttributes();
    this.#syncIconsFromAttributes();
    this.#setupViewportInsetTracking();
    if (this.hasAttribute('data-url')) {
      this.#scheduleInit();
    }
  }

  disconnectedCallback() {
    this.#cleanup();
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue === newValue) return;

    switch (name) {
      case 'data-url':
      case 'map-url':
        if (this.#initialized) {
          this.#reinitialize();
        } else if (this.hasAttribute('data-url')) {
          this.#scheduleInit();
        }
        break;

      case 'default-floor':
        if (this.#engine?.isInitialized) {
          this.#engine.setFloor(newValue);
        }
        break;

      case 'route-mode':
        if (this.#syncInProgress) break;
        if (this.#engine?.isInitialized) {
          this.#engine.setRouteMode(newValue);
        }
        break;

      case 'label-font-size':
      case 'label-min-font-size':
      case 'desktop-label-font-size':
      case 'mobile-label-font-size':
      case 'desktop-label-min-font-size':
      case 'mobile-label-min-font-size':
      case 'map-label-font-family':
      case 'map-label-font-color':
      case 'map-label-background-color':
        this.#applyLabelStyleFromAttributes();
        break;

      case 'control-fg-color':
      case 'control-bg-color':
      case 'control-active-fg-color':
      case 'control-active-bg-color':
        this.#applyControlThemeFromAttributes();
        break;

      case 'map-marker-start-fg-color':
      case 'map-marker-start-bg-color':
      case 'map-marker-end-fg-color':
      case 'map-marker-end-bg-color':
      case 'map-marker-connector-fg-color':
      case 'map-marker-connector-bg-color':
        this.#applyMarkerStyleFromAttributes();
        break;

      case 'focus-node-id':
        if (this.#engine?.isInitialized) {
          this.#applyInitialFocusNode(true);
        }
        break;

      case 'focus-shop-id':
        if (this.#engine?.isInitialized) {
          this.#applyInitialFocusShop(true);
        }
        break;

      case 'show-fps':
      case 'disable-rotation':
      case 'enable-rotation':
        if (this.#initialized) {
          this.#reinitialize();
        }
        break;

      case 'level-selector':
        this.#syncLevelSelector();
        break;
      case 'search-control':
        this.#syncSearchControl();
        break;
      case 'icon-walk':
      case 'icon-stand':
      case 'icon-pin':
      case 'icon-qr':
      case 'icon-wheelchair':
      case 'icon-escalator':
        this.#syncIconsFromAttributes();
        break;

      default:
        break;
    }
  }

  get engine() {
    return this.#engine;
  }

  get isInitialized() {
    return this.#initialized;
  }

  get currentFloor() {
    return this.#engine?.getCurrentFloor() ?? null;
  }

  set currentFloor(value) {
    this.#engine?.setFloor(value);
  }

  get floors() {
    return this.#engine?.getFloors() ?? [];
  }

  get levels() {
    return this.#engine?.getLevels?.() ?? [];
  }

  get routeMode() {
    if (this.#engine?.isInitialized) {
      return this.#engine.getRouteMode?.() ?? (this.getAttribute('route-mode') || 'escalator');
    }
    return this.getAttribute('route-mode') || 'escalator';
  }

  set routeMode(value) {
    this.setAttribute('route-mode', value);
  }

  get hasRoute() {
    return this.#engine?.hasRoute() ?? false;
  }

  async init() {
    if (this.#initialized || this.#pendingInit) return;
    this.#pendingInit = true;

    try {
      this.#setupResizeObserver();
      const config = this.#buildConfig();

      if (!config.dataUrl) {
        throw new Error('wayfinder-map: data-url attribute is required');
      }

      this.#engine = new MapEngine(this.#canvas, config);
      this.#wireEvents();

      await this.#engine.init();
      this.#initialized = true;
      this.#pendingInit = false;

      this.#handleResize();

      this.#bindLocateControls();
      this.#bindQrModalEvents();
      this.#setMapMode('browse');
      this.#syncLevelSelector();
      this.#syncSearchControl();
      this.#applyMarkerStyleFromAttributes();
      this.#applyInitialFocusNode();
      this.#applyInitialFocusShop();
      this.#restoreShareStateFromUrl();

      this.#dispatchEvent('ready', {});
    } catch (error) {
      this.#pendingInit = false;
      this.#dispatchEvent('error', { error });
      throw error;
    }
  }

  /**
   * Enter navigation mode: display route between two locations.
   * @param {{from: number, to: number, mode?: 'escalator'|'lift', animate?: boolean, duration?: number, scale?: number, connectorConstraint?: 'lift-only'|'escalator-only'|null}} options
   * @returns {Object} Path result
   */
  navigateTo({ from, to, mode, animate, duration, scale, connectorConstraint }) {
    if (!this.#engine?.isInitialized) {
      throw new Error('wayfinder-map: Not initialized');
    }

    if (mode) {
      this.routeMode = mode;
    }

    const result = this.#engine.navigateTo(from, to, { animate, duration, scale, connectorConstraint });
    if (result?.success) {
      this.#startLocationId = result.startLocation?.id ?? null;
      this.#endLocationId = result.endLocation?.id ?? null;
      this.#startNode = result.startNode ?? null;
      this.#endNode = result.endNode ?? null;
      this.#focusedLocationId = null;
      this.#focusedNode = null;
      this.#setMapMode('navigation');
      this.#resetSearchSelection();
    }
    return result;
  }

  /**
   * Enter focus mode: highlight a single location with pin marker (no route).
   * @param {number} id - Location ID to focus on
   * @param {Object} [options] - Focus options (clearRoute, switchFloor, animate, duration, scale)
   * @returns {Object} Focus result with success, location, node, floor
   */
  focusLocation(id, options) {
    if (!this.#engine?.isInitialized) {
      throw new Error('wayfinder-map: Not initialized');
    }

    const result = this.#engine.focusLocation(id, options);
    if (result?.success) {
      this.#focusedLocationId = id;
      this.#focusedNode = result.node ?? null;
      this.#startLocationId = null;
      this.#endLocationId = null;
      this.#startNode = null;
      this.#endNode = null;
      this.#setMapMode('focus');
    }
    return result;
  }

  /**
   * Return to browse mode: clear route and markers.
   */
  clearRoute() {
    this.#engine?.clearRoute();
    this.#focusedLocationId = null;
    this.#startLocationId = null;
    this.#endLocationId = null;
    this.#focusedNode = null;
    this.#startNode = null;
    this.#endNode = null;
    this.#setMapMode('browse');
    this.#resetSearchSelection();
  }

  setFloor(floorCode) {
    this.#engine?.setFloor(floorCode);
  }

  resetView() {
    this.#engine?.resetView();
  }

  resetRotation() {
    this.#engine?.resetRotation();
  }

  getLocations() {
    return this.#engine?.getLocations() ?? [];
  }

  getLocation(id) {
    return this.#engine?.getLocation(id);
  }

  getViewState() {
    return this.#engine?.getViewState() ?? { scale: 1, panX: 0, panY: 0, rotation: 0 };
  }

  centerOn(x, y, options) {
    this.#engine?.centerOn(x, y, options);
  }

  zoom(factor) {
    this.#engine?.zoom(factor);
  }

  #createShadowDOM() {
    const styleSheet = document.createElement('style');
    styleSheet.textContent = styles;
    this.#shadowRoot.appendChild(styleSheet);

    const container = document.createElement('div');
    container.className = 'wayfinder-container';

    this.#canvas = document.createElement('canvas');
    this.#canvas.className = 'wayfinder-canvas';

    container.appendChild(this.#canvas);

    this.#levelSelectorEl = document.createElement('div');
    this.#levelSelectorEl.className = 'wayfinder-level-selector';
    this.#levelSelectorEl.dataset.enabled = 'false';
    this.#levelSelectorEl.setAttribute('role', 'group');
    this.#levelSelectorEl.setAttribute('aria-label', 'Level selector');

    this.#locateControlsEl = document.createElement('div');
    this.#locateControlsEl.className = 'wayfinder-locate-controls';
    this.#locateControlsEl.dataset.mode = 'browse';
    this.#locateControlsEl.dataset.hasHere = 'false';
    this.#locateControlsEl.setAttribute('role', 'group');
    this.#locateControlsEl.setAttribute('aria-label', 'Locate controls');

    this.#locateHereButton = document.createElement('button');
    this.#locateHereButton.type = 'button';
    this.#locateHereButton.className = 'wayfinder-locate-button wayfinder-locate-button--here';
    this.#locateHereButton.dataset.action = 'locate-here';
    this.#locateHereButton.setAttribute('aria-label', 'Locate you are here');
    const hereIcon = document.createElement('img');
    hereIcon.src = this.#icons.stand;
    hereIcon.dataset.wayfinderIcon = 'stand';
    hereIcon.alt = '';
    hereIcon.setAttribute('aria-hidden', 'true');
    this.#locateHereButton.appendChild(hereIcon);
    this.#locateControlsEl.appendChild(this.#locateHereButton);

    this.#locateStartButton = document.createElement('button');
    this.#locateStartButton.type = 'button';
    this.#locateStartButton.className = 'wayfinder-locate-button';
    this.#locateStartButton.dataset.action = 'locate-start';
    this.#locateStartButton.setAttribute('aria-label', 'Locate start');
    const startIcon = document.createElement('img');
    startIcon.src = this.#icons.walk;
    startIcon.dataset.wayfinderIcon = 'walk';
    startIcon.alt = '';
    startIcon.setAttribute('aria-hidden', 'true');
    this.#locateStartButton.appendChild(startIcon);
    this.#locateControlsEl.appendChild(this.#locateStartButton);

    this.#locateFocusButton = document.createElement('button');
    this.#locateFocusButton.type = 'button';
    this.#locateFocusButton.className = 'wayfinder-locate-button';
    this.#locateFocusButton.dataset.action = 'locate-focus';
    this.#locateFocusButton.setAttribute('aria-label', 'Locate destination');
    const focusIcon = document.createElement('img');
    focusIcon.src = this.#icons.pin;
    focusIcon.dataset.wayfinderIcon = 'pin';
    focusIcon.alt = '';
    focusIcon.setAttribute('aria-hidden', 'true');
    this.#locateFocusButton.appendChild(focusIcon);
    this.#locateControlsEl.appendChild(this.#locateFocusButton);

    this.#locateLiftButton = document.createElement('button');
    this.#locateLiftButton.type = 'button';
    this.#locateLiftButton.className = 'wayfinder-locate-button wayfinder-locate-button--connector';
    this.#locateLiftButton.dataset.action = 'nav-connector-lift';
    this.#locateLiftButton.dataset.active = 'false';
    this.#locateLiftButton.setAttribute('aria-label', 'Accessibility route: lift only');
    const liftIcon = document.createElement('img');
    liftIcon.src = this.#icons.wheelchair;
    liftIcon.dataset.wayfinderIcon = 'wheelchair';
    liftIcon.alt = '';
    liftIcon.setAttribute('aria-hidden', 'true');
    this.#locateLiftButton.appendChild(liftIcon);
    this.#locateControlsEl.appendChild(this.#locateLiftButton);

    this.#locateEscalatorButton = document.createElement('button');
    this.#locateEscalatorButton.type = 'button';
    this.#locateEscalatorButton.className = 'wayfinder-locate-button wayfinder-locate-button--connector';
    this.#locateEscalatorButton.dataset.action = 'nav-connector-escalator';
    this.#locateEscalatorButton.dataset.active = 'false';
    this.#locateEscalatorButton.setAttribute('aria-label', 'Escalator route: escalator only');
    const escalatorIcon = document.createElement('img');
    escalatorIcon.src = this.#icons.escalator;
    escalatorIcon.dataset.wayfinderIcon = 'escalator';
    escalatorIcon.alt = '';
    escalatorIcon.setAttribute('aria-hidden', 'true');
    this.#locateEscalatorButton.appendChild(escalatorIcon);
    this.#locateControlsEl.appendChild(this.#locateEscalatorButton);

    this.#controlRailEl = document.createElement('div');
    this.#controlRailEl.className = 'wayfinder-control-rail';
    this.#controlRailEl.appendChild(this.#locateControlsEl);
    this.#controlRailEl.appendChild(this.#levelSelectorEl);
    container.appendChild(this.#controlRailEl);

    this.#qrModalEl = document.createElement('div');
    this.#qrModalEl.className = 'wayfinder-qr-modal';
    this.#qrModalEl.dataset.open = 'false';
    this.#qrModalEl.setAttribute('aria-hidden', 'true');

    const qrDialog = document.createElement('div');
    qrDialog.className = 'wayfinder-qr-dialog';
    qrDialog.setAttribute('role', 'dialog');
    qrDialog.setAttribute('aria-modal', 'true');
    qrDialog.setAttribute('aria-label', 'Map sharing QR code');

    const qrTitle = document.createElement('h2');
    qrTitle.className = 'wayfinder-qr-title';
    qrTitle.textContent = 'Bring this Map to your Phone';

    const qrHint = document.createElement('p');
    qrHint.className = 'wayfinder-qr-hint';
    qrHint.textContent = 'Scan with your phone camera';

    this.#qrModalCodeEl = document.createElement('div');
    this.#qrModalCodeEl.className = 'wayfinder-qr-code';
    this.#qrModalCodeEl.setAttribute('aria-hidden', 'true');

    this.#qrModalCopyButton = document.createElement('button');
    this.#qrModalCopyButton.type = 'button';
    this.#qrModalCopyButton.className = 'wayfinder-qr-copy';
    this.#qrModalCopyButton.dataset.action = 'copy-qr-url';
    this.#qrModalCopyButton.textContent = 'Copy Link';

    qrDialog.appendChild(qrTitle);
    qrDialog.appendChild(qrHint);
    qrDialog.appendChild(this.#qrModalCodeEl);
    qrDialog.appendChild(this.#qrModalCopyButton);
    this.#qrModalEl.appendChild(qrDialog);
    container.appendChild(this.#qrModalEl);

    this.#searchContainerEl = document.createElement('div');
    this.#searchContainerEl.className = 'wayfinder-search';
    this.#searchContainerEl.dataset.enabled = 'false';
    this.#searchContainerEl.dataset.open = 'false';
    this.#searchContainerEl.dataset.selected = 'false';

    this.#searchToggleButton = document.createElement('button');
    this.#searchToggleButton.type = 'button';
    this.#searchToggleButton.className = 'wayfinder-search-toggle';
    this.#searchToggleButton.dataset.action = 'open-search';
    this.#searchToggleButton.setAttribute('aria-label', 'Open search');
    const toggleIcon = document.createElement('img');
    toggleIcon.src = this.#icons.search;
    toggleIcon.dataset.wayfinderIcon = 'search';
    toggleIcon.alt = '';
    toggleIcon.setAttribute('aria-hidden', 'true');
    this.#searchToggleButton.appendChild(toggleIcon);

    this.#searchQrButton = document.createElement('button');
    this.#searchQrButton.type = 'button';
    this.#searchQrButton.className = 'wayfinder-search-share';
    this.#searchQrButton.dataset.action = 'show-qr';
    this.#searchQrButton.setAttribute('aria-label', 'Show share QR code');
    const searchQrIcon = document.createElement('img');
    searchQrIcon.src = this.#icons.qr;
    searchQrIcon.dataset.wayfinderIcon = 'qr';
    searchQrIcon.alt = '';
    searchQrIcon.setAttribute('aria-hidden', 'true');
    this.#searchQrButton.appendChild(searchQrIcon);

    this.#searchPanelEl = document.createElement('div');
    this.#searchPanelEl.className = 'wayfinder-search-panel';

    this.#searchHeaderEl = document.createElement('div');
    this.#searchHeaderEl.className = 'wayfinder-search-header';

    this.#searchBackButton = document.createElement('button');
    this.#searchBackButton.type = 'button';
    this.#searchBackButton.className = 'wayfinder-search-back';
    this.#searchBackButton.dataset.action = 'close-search';
    this.#searchBackButton.textContent = 'Back';

    this.#searchInputWrapper = document.createElement('div');
    this.#searchInputWrapper.className = 'wayfinder-search-field';
    const inputIcon = document.createElement('img');
    inputIcon.src = this.#icons.search;
    inputIcon.dataset.wayfinderIcon = 'search';
    inputIcon.alt = '';
    inputIcon.setAttribute('aria-hidden', 'true');
    this.#searchInputEl = document.createElement('input');
    this.#searchInputEl.type = 'search';
    this.#searchInputEl.placeholder = 'Search';
    this.#searchInputEl.autocomplete = 'off';
    this.#searchInputEl.spellcheck = false;
    this.#searchInputEl.setAttribute('aria-label', 'Search for shop');
    this.#searchInputWrapper.appendChild(inputIcon);
    this.#searchInputWrapper.appendChild(this.#searchInputEl);

    this.#searchClearButton = document.createElement('button');
    this.#searchClearButton.type = 'button';
    this.#searchClearButton.className = 'wayfinder-search-field-clear';
    this.#searchClearButton.dataset.action = 'clear-search';
    this.#searchClearButton.setAttribute('aria-label', 'Clear search');
    const clearIcon = document.createElement('img');
    clearIcon.src = this.#icons.close;
    clearIcon.dataset.wayfinderIcon = 'close';
    clearIcon.alt = '';
    clearIcon.setAttribute('aria-hidden', 'true');
    this.#searchClearButton.appendChild(clearIcon);
    this.#searchInputWrapper.appendChild(this.#searchClearButton);

    this.#searchSelectedEl = document.createElement('div');
    this.#searchSelectedEl.className = 'wayfinder-search-selected';
    const selectedIcon = document.createElement('img');
    selectedIcon.src = this.#icons.search;
    selectedIcon.dataset.wayfinderIcon = 'search';
    selectedIcon.alt = '';
    selectedIcon.setAttribute('aria-hidden', 'true');
    this.#searchSelectedText = document.createElement('span');
    const selectedClearButton = document.createElement('button');
    selectedClearButton.type = 'button';
    selectedClearButton.className = 'wayfinder-search-info-action wayfinder-search-info-close wayfinder-search-selected-close';
    selectedClearButton.dataset.action = 'resume-search';
    selectedClearButton.setAttribute('aria-label', 'Close');
    const selectedCloseIcon = document.createElement('img');
    selectedCloseIcon.src = this.#icons.close;
    selectedCloseIcon.dataset.wayfinderIcon = 'close';
    selectedCloseIcon.alt = '';
    selectedCloseIcon.setAttribute('aria-hidden', 'true');
    selectedClearButton.appendChild(selectedCloseIcon);
    this.#searchSelectedEl.appendChild(selectedIcon);
    this.#searchSelectedEl.appendChild(this.#searchSelectedText);
    this.#searchSelectedEl.appendChild(selectedClearButton);

    this.#searchHeaderEl.appendChild(this.#searchBackButton);
    this.#searchHeaderEl.appendChild(this.#searchInputWrapper);
    this.#searchHeaderEl.appendChild(this.#searchSelectedEl);

    this.#searchResultsEl = document.createElement('div');
    this.#searchResultsEl.className = 'wayfinder-search-results';
    this.#searchResultsEl.hidden = true;
    this.#searchResultsEl.setAttribute('role', 'listbox');

    // Navigation header (hidden by default)
    this.#searchNavHeaderEl = document.createElement('div');
    this.#searchNavHeaderEl.className = 'wayfinder-search-nav-header';
    this.#searchNavHeaderEl.style.display = 'none';

    this.#searchNavBackButton = document.createElement('button');
    this.#searchNavBackButton.type = 'button';
    this.#searchNavBackButton.className = 'wayfinder-search-nav-back';
    this.#searchNavBackButton.dataset.action = 'exit-navigation';
    this.#searchNavBackButton.textContent = '← Back to search';

    this.#searchNavHeaderEl.appendChild(this.#searchNavBackButton);

    // Navigation fields container
    this.#searchNavFieldsEl = document.createElement('div');
    this.#searchNavFieldsEl.className = 'wayfinder-search-nav-fields';
    this.#searchNavFieldsEl.style.display = 'none';

    // From field
    this.#searchNavFromFieldEl = document.createElement('div');
    this.#searchNavFromFieldEl.className = 'wayfinder-search-nav-field';
    this.#searchNavFromFieldEl.dataset.field = 'from';
    this.#searchNavFromFieldEl.dataset.state = 'inactive';

    this.#searchNavFromValueEl = document.createElement('input');
    this.#searchNavFromValueEl.type = 'search';
    this.#searchNavFromValueEl.placeholder = 'From';
    this.#searchNavFromValueEl.autocomplete = 'off';
    this.#searchNavFromValueEl.spellcheck = false;
    this.#searchNavFromValueEl.setAttribute('aria-label', 'Search from location');

    const fromIconImg = document.createElement('img');
    fromIconImg.src = this.#icons.walk;
    fromIconImg.alt = '';
    fromIconImg.setAttribute('aria-hidden', 'true');
    this.#searchNavFromIconEl = fromIconImg;

    this.#searchNavFromClearButton = document.createElement('button');
    this.#searchNavFromClearButton.type = 'button';
    this.#searchNavFromClearButton.className = 'wayfinder-search-nav-field-clear';
    this.#searchNavFromClearButton.dataset.action = 'clear-nav-from';
    this.#searchNavFromClearButton.setAttribute('aria-label', 'Clear from location');
    const fromClearIcon = document.createElement('img');
    fromClearIcon.src = this.#icons.close;
    fromClearIcon.dataset.wayfinderIcon = 'close';
    fromClearIcon.alt = '';
    fromClearIcon.setAttribute('aria-hidden', 'true');
    this.#searchNavFromClearButton.appendChild(fromClearIcon);

    this.#searchNavFromFieldEl.appendChild(fromIconImg);
    this.#searchNavFromFieldEl.appendChild(this.#searchNavFromValueEl);
    this.#searchNavFromFieldEl.appendChild(this.#searchNavFromClearButton);

    // To field
    this.#searchNavToFieldEl = document.createElement('div');
    this.#searchNavToFieldEl.className = 'wayfinder-search-nav-field';
    this.#searchNavToFieldEl.dataset.field = 'to';
    this.#searchNavToFieldEl.dataset.state = 'inactive';

    this.#searchNavToValueEl = document.createElement('input');
    this.#searchNavToValueEl.type = 'search';
    this.#searchNavToValueEl.placeholder = 'To';
    this.#searchNavToValueEl.autocomplete = 'off';
    this.#searchNavToValueEl.spellcheck = false;
    this.#searchNavToValueEl.setAttribute('aria-label', 'Search to location');

    const toIconImg = document.createElement('img');
    toIconImg.src = this.#icons.pin;
    toIconImg.dataset.wayfinderIcon = 'pin';
    toIconImg.alt = '';
    toIconImg.setAttribute('aria-hidden', 'true');

    this.#searchNavToClearButton = document.createElement('button');
    this.#searchNavToClearButton.type = 'button';
    this.#searchNavToClearButton.className = 'wayfinder-search-nav-field-clear';
    this.#searchNavToClearButton.dataset.action = 'clear-nav-to';
    this.#searchNavToClearButton.setAttribute('aria-label', 'Clear to location');
    const toClearIcon = document.createElement('img');
    toClearIcon.src = this.#icons.close;
    toClearIcon.dataset.wayfinderIcon = 'close';
    toClearIcon.alt = '';
    toClearIcon.setAttribute('aria-hidden', 'true');
    this.#searchNavToClearButton.appendChild(toClearIcon);

    this.#searchNavToFieldEl.appendChild(toIconImg);
    this.#searchNavToFieldEl.appendChild(this.#searchNavToValueEl);
    this.#searchNavToFieldEl.appendChild(this.#searchNavToClearButton);

    // Assemble fields container
    this.#searchNavFieldsEl.appendChild(this.#searchNavFromFieldEl);
    this.#searchNavFieldsEl.appendChild(this.#searchNavToFieldEl);

    this.#searchPanelEl.appendChild(this.#searchHeaderEl);
    this.#searchPanelEl.appendChild(this.#searchNavHeaderEl);
    this.#searchPanelEl.appendChild(this.#searchNavFieldsEl);
    this.#searchPanelEl.appendChild(this.#searchResultsEl);

    this.#searchInfoEl = document.createElement('div');
    this.#searchInfoEl.className = 'wayfinder-search-info';
    this.#searchInfoEl.dataset.visible = 'false';
    this.#searchInfoEl.dataset.mobileExpanded = 'false';
    this.#searchInfoEl.dataset.descriptionExpanded = 'false';

    this.#searchInfoHeaderActionsEl = document.createElement('div');
    this.#searchInfoHeaderActionsEl.className = 'wayfinder-search-info-header-actions';

    this.#searchInfoExpandButton = document.createElement('button');
    this.#searchInfoExpandButton.type = 'button';
    this.#searchInfoExpandButton.className = 'wayfinder-search-info-action wayfinder-search-info-expand';
    this.#searchInfoExpandButton.dataset.action = 'expand-search-info';
    this.#searchInfoExpandButton.setAttribute('aria-label', 'Expand panel');
    this.#searchInfoExpandIconEl = document.createElement('img');
    this.#searchInfoExpandIconEl.dataset.wayfinderIcon = 'expand';
    this.#searchInfoExpandIconEl.dataset.wayfinderIconBaseSrc = this.#icons.expand;
    this.#searchInfoExpandIconEl.src = this.#icons.expand;
    this.#searchInfoExpandIconEl.alt = '';
    this.#searchInfoExpandIconEl.setAttribute('aria-hidden', 'true');
    this.#searchInfoExpandButton.appendChild(this.#searchInfoExpandIconEl);

    this.#searchInfoCloseButton = document.createElement('button');
    this.#searchInfoCloseButton.type = 'button';
    this.#searchInfoCloseButton.className = 'wayfinder-search-info-action wayfinder-search-info-close';
    this.#searchInfoCloseButton.dataset.action = 'clear-search';
    this.#searchInfoCloseButton.setAttribute('aria-label', 'Close');
    const closeIcon = document.createElement('img');
    closeIcon.src = this.#icons.close;
    closeIcon.dataset.wayfinderIcon = 'close';
    closeIcon.alt = '';
    closeIcon.setAttribute('aria-hidden', 'true');
    this.#searchInfoCloseButton.appendChild(closeIcon);

    this.#searchInfoMediaEl = document.createElement('div');
    this.#searchInfoMediaEl.className = 'wayfinder-search-info-media';
    this.#searchInfoMediaTrackEl = document.createElement('div');
    this.#searchInfoMediaTrackEl.className = 'wayfinder-search-info-media-track';
    this.#searchInfoMediaEl.appendChild(this.#searchInfoMediaTrackEl);
    this.#searchInfoPagerEl = document.createElement('div');
    this.#searchInfoPagerEl.className = 'wayfinder-search-info-pager';
    this.#searchInfoMediaEl.appendChild(this.#searchInfoPagerEl);

    this.#searchInfoBodyEl = document.createElement('div');
    this.#searchInfoBodyEl.className = 'wayfinder-search-info-body';

    this.#searchInfoMetaEl = document.createElement('div');
    this.#searchInfoMetaEl.className = 'wayfinder-search-info-meta';

    this.#searchInfoLogoEl = document.createElement('div');
    this.#searchInfoLogoEl.className = 'wayfinder-search-info-logo';
    this.#searchInfoLogoImgEl = document.createElement('img');
    this.#searchInfoLogoImgEl.alt = '';
    this.#searchInfoLogoImgEl.setAttribute('aria-hidden', 'true');
    this.#searchInfoLogoEl.appendChild(this.#searchInfoLogoImgEl);

    this.#searchInfoTextEl = document.createElement('div');
    this.#searchInfoTextEl.className = 'wayfinder-search-info-text';

    this.#searchInfoTitleEl = document.createElement('div');
    this.#searchInfoTitleEl.className = 'wayfinder-search-info-title';
    this.#searchInfoVenueEl = document.createElement('div');
    this.#searchInfoVenueEl.className = 'wayfinder-search-info-venue';
    this.#searchInfoDescriptionEl = document.createElement('div');
    this.#searchInfoDescriptionEl.className = 'wayfinder-search-info-description';

    const infoActions = document.createElement('div');
    infoActions.className = 'wayfinder-search-info-actions';
    this.#searchDirectionButton = document.createElement('button');
    this.#searchDirectionButton.type = 'button';
    this.#searchDirectionButton.className = 'wayfinder-search-direction';
    this.#searchDirectionButton.textContent = 'Direction';

    infoActions.appendChild(this.#searchDirectionButton);

    this.#searchInfoDescriptionToggleEl = document.createElement('button');
    this.#searchInfoDescriptionToggleEl.type = 'button';
    this.#searchInfoDescriptionToggleEl.className = 'wayfinder-search-info-description-toggle';
    this.#searchInfoDescriptionToggleEl.dataset.action = 'toggle-description';
    this.#searchInfoDescriptionToggleEl.setAttribute('aria-expanded', 'false');
    this.#searchInfoDescriptionToggleEl.textContent = 'Read more';

    this.#searchInfoTextEl.appendChild(this.#searchInfoTitleEl);
    this.#searchInfoTextEl.appendChild(this.#searchInfoVenueEl);

    this.#searchInfoMetaEl.appendChild(this.#searchInfoLogoEl);
    this.#searchInfoMetaEl.appendChild(this.#searchInfoTextEl);

    this.#searchInfoBodyEl.appendChild(this.#searchInfoMetaEl);
    this.#searchInfoBodyEl.appendChild(infoActions);
    this.#searchInfoBodyEl.appendChild(this.#searchInfoDescriptionToggleEl);
    this.#searchInfoBodyEl.appendChild(this.#searchInfoDescriptionEl);

    this.#searchInfoHeaderActionsEl.appendChild(this.#searchInfoExpandButton);
    this.#searchInfoHeaderActionsEl.appendChild(this.#searchInfoCloseButton);
    this.#searchInfoEl.appendChild(this.#searchInfoHeaderActionsEl);
    this.#searchInfoEl.appendChild(this.#searchInfoMediaEl);
    this.#searchInfoEl.appendChild(this.#searchInfoBodyEl);

    // Navigation summary panel (mobile bottom card)
    this.#searchNavSummaryEl = document.createElement('div');
    this.#searchNavSummaryEl.className = 'wayfinder-search-nav-summary';
    this.#searchNavSummaryEl.dataset.visible = 'false';

    const navSummaryBody = document.createElement('div');
    navSummaryBody.className = 'wayfinder-search-nav-summary-body';
    navSummaryBody.addEventListener('click', () => {
      this.#openSearchOverlay();
    });

    const navSummaryFromRow = document.createElement('div');
    navSummaryFromRow.className = 'wayfinder-search-nav-summary-row';
    const navSummaryFromIcon = document.createElement('img');
    navSummaryFromIcon.src = this.#icons.walk;
    navSummaryFromIcon.dataset.wayfinderIcon = 'walk';
    navSummaryFromIcon.alt = '';
    navSummaryFromIcon.setAttribute('aria-hidden', 'true');
    this.#searchNavSummaryFromEl = document.createElement('span');
    navSummaryFromRow.appendChild(navSummaryFromIcon);
    navSummaryFromRow.appendChild(this.#searchNavSummaryFromEl);

    const navSummaryToRow = document.createElement('div');
    navSummaryToRow.className = 'wayfinder-search-nav-summary-row';
    const navSummaryToIcon = document.createElement('img');
    navSummaryToIcon.src = this.#icons.pin;
    navSummaryToIcon.dataset.wayfinderIcon = 'pin';
    navSummaryToIcon.alt = '';
    navSummaryToIcon.setAttribute('aria-hidden', 'true');
    this.#searchNavSummaryToEl = document.createElement('span');
    navSummaryToRow.appendChild(navSummaryToIcon);
    navSummaryToRow.appendChild(this.#searchNavSummaryToEl);

    navSummaryBody.appendChild(navSummaryFromRow);
    navSummaryBody.appendChild(navSummaryToRow);

    const navSummaryClose = document.createElement('button');
    navSummaryClose.type = 'button';
    navSummaryClose.className = 'wayfinder-search-nav-summary-close';
    navSummaryClose.dataset.action = 'exit-navigation';
    navSummaryClose.setAttribute('aria-label', 'Close navigation');
    const navSummaryCloseIcon = document.createElement('img');
    navSummaryCloseIcon.src = this.#icons.close;
    navSummaryCloseIcon.dataset.wayfinderIcon = 'close';
    navSummaryCloseIcon.alt = '';
    navSummaryCloseIcon.setAttribute('aria-hidden', 'true');
    navSummaryClose.appendChild(navSummaryCloseIcon);

    this.#searchNavSummaryEl.appendChild(navSummaryBody);
    this.#searchNavSummaryEl.appendChild(navSummaryClose);

    this.#searchContainerEl.appendChild(this.#searchToggleButton);
    this.#searchContainerEl.appendChild(this.#searchQrButton);
    this.#searchContainerEl.appendChild(this.#searchPanelEl);
    this.#searchContainerEl.appendChild(this.#searchInfoEl);
    this.#searchContainerEl.appendChild(this.#searchNavSummaryEl);
    container.appendChild(this.#searchContainerEl);

    const slot = document.createElement('slot');
    container.appendChild(slot);

    this.#shadowRoot.appendChild(container);
  }

  #scheduleInit() {
    queueMicrotask(() => {
      if (!this.#initialized && !this.#pendingInit) {
        this.init().catch((e) => console.error('wayfinder-map init error:', e));
      }
    });
  }

  async #reinitialize() {
    this.#cleanup();
    this.#initialized = false;
    await this.init();
  }

  #buildConfig() {
    const config = {
      dataUrl: this.getAttribute('data-url'),
      mapUrl: this.getAttribute('map-url')
    };

    const defaultFloor = this.getAttribute('default-floor');
    if (defaultFloor !== null) config.defaultFloor = defaultFloor;

    const youAreHereNodeId = this.#getNumberAttr('you-are-here-node-id');
    if (Number.isFinite(youAreHereNodeId)) {
      config.youAreHereNodeId = Math.trunc(youAreHereNodeId);
    }

    const focusNodeId = this.#getNumberAttr('focus-node-id');
    if (Number.isFinite(focusNodeId)) {
      config.focusNodeId = Math.trunc(focusNodeId);
    }

    const routeMode = this.getAttribute('route-mode');
    if (routeMode !== null) config.routeMode = routeMode;

    const renderScale = this.#getResponsiveNumberAttr('render-scale');
    if (renderScale !== undefined) {
      config.renderScale = renderScale;
    } else {
      const fallbackRenderScale = this.#getNumberAttr('render-scale');
      if (fallbackRenderScale !== undefined) config.renderScale = fallbackRenderScale;
    }

    const maxZoom = this.#getResponsiveNumberAttr('max-zoom');
    if (maxZoom !== undefined) {
      config.maxZoom = maxZoom;
    } else {
      const fallbackMaxZoom = this.#getNumberAttr('max-zoom');
      if (fallbackMaxZoom !== undefined) config.maxZoom = fallbackMaxZoom;
    }

    const minZoom = this.#getResponsiveMinZoomAttr();
    if (minZoom !== undefined) {
      config.minZoom = minZoom;
    } else {
      const fallbackMinZoom = this.#getMinZoomAttr('min-zoom');
      if (fallbackMinZoom !== undefined) config.minZoom = fallbackMinZoom;
    }

    const labelFontSize = this.#getResponsiveNumberAttr('label-font-size');
    if (labelFontSize !== undefined) {
      config.labelFontSize = labelFontSize;
    } else {
      const fallbackLabelFontSize = this.#getNumberAttr('label-font-size');
      if (fallbackLabelFontSize !== undefined) config.labelFontSize = fallbackLabelFontSize;
    }

    const labelMinFontSize = this.#getResponsiveNumberAttr('label-min-font-size');
    if (labelMinFontSize !== undefined) {
      config.labelMinFontSize = labelMinFontSize;
    } else {
      const fallbackLabelMinFontSize = this.#getNumberAttr('label-min-font-size');
      if (fallbackLabelMinFontSize !== undefined) {
        config.labelMinFontSize = fallbackLabelMinFontSize;
      }
    }

    const labelFontFamily = this.#getStringAttr('map-label-font-family');
    if (labelFontFamily !== undefined) config.mapLabelFontFamily = labelFontFamily;

    const labelFontColor = this.#getStringAttr('map-label-font-color');
    if (labelFontColor !== undefined) config.mapLabelFontColor = labelFontColor;

    const labelBackgroundColor = this.#getStringAttr('map-label-background-color');
    if (labelBackgroundColor !== undefined) config.mapLabelBackgroundColor = labelBackgroundColor;

    const controlFgColor = this.#getStringAttr('control-fg-color');
    if (controlFgColor !== undefined) {
      config.controlFgColor = controlFgColor;
    }

    const controlBgColor = this.#getStringAttr('control-bg-color');
    if (controlBgColor !== undefined) {
      config.controlBgColor = controlBgColor;
    }

    const controlActiveFgColor = this.#getStringAttr('control-active-fg-color');
    if (controlActiveFgColor !== undefined) {
      config.controlActiveFgColor = controlActiveFgColor;
    }

    const controlActiveBgColor = this.#getStringAttr('control-active-bg-color');
    if (controlActiveBgColor !== undefined) {
      config.controlActiveBgColor = controlActiveBgColor;
    }

    const mapMarkerStartFgColor = this.#getStringAttr('map-marker-start-fg-color');
    if (mapMarkerStartFgColor !== undefined) {
      config.mapMarkerStartFgColor = mapMarkerStartFgColor;
    }

    const mapMarkerStartBgColor = this.#getStringAttr('map-marker-start-bg-color');
    if (mapMarkerStartBgColor !== undefined) {
      config.mapMarkerStartBgColor = mapMarkerStartBgColor;
    }

    const mapMarkerEndFgColor = this.#getStringAttr('map-marker-end-fg-color');
    if (mapMarkerEndFgColor !== undefined) {
      config.mapMarkerEndFgColor = mapMarkerEndFgColor;
    }

    const mapMarkerEndBgColor = this.#getStringAttr('map-marker-end-bg-color');
    if (mapMarkerEndBgColor !== undefined) {
      config.mapMarkerEndBgColor = mapMarkerEndBgColor;
    }

    const mapMarkerConnectorFgColor = this.#getStringAttr('map-marker-connector-fg-color');
    if (mapMarkerConnectorFgColor !== undefined) {
      config.mapMarkerConnectorFgColor = mapMarkerConnectorFgColor;
    }

    const mapMarkerConnectorBgColor = this.#getStringAttr('map-marker-connector-bg-color');
    if (mapMarkerConnectorBgColor !== undefined) {
      config.mapMarkerConnectorBgColor = mapMarkerConnectorBgColor;
    }

    if (this.hasAttribute('icon-walk')) config.iconWalk = this.#icons.walk;
    if (this.hasAttribute('icon-stand')) config.iconStand = this.#icons.stand;
    if (this.hasAttribute('icon-pin')) config.iconPin = this.#icons.pin;
    if (this.hasAttribute('icon-qr')) config.iconQr = this.#icons.qr;
    if (this.hasAttribute('icon-wheelchair')) config.iconWheelchair = this.#icons.wheelchair;
    if (this.hasAttribute('icon-escalator')) config.iconEscalator = this.#icons.escalator;

    const locale = this.getAttribute('locale');
    if (locale !== null) config.locale = locale;

    if (this.hasAttribute('show-fps')) config.showFps = true;

    if (this.hasAttribute('disable-rotation')) {
      config.enableRotation = false;
    } else if (this.hasAttribute('enable-rotation')) {
      config.enableRotation = true;
    }

    return config;
  }

  #applyLabelStyleFromAttributes() {
    if (!this.#engine?.isInitialized) return;

    const style = {};
    const fontSize = this.#getResolvedNumberAttr('label-font-size');
    const minFontSize = this.#getResolvedNumberAttr('label-min-font-size');
    if (fontSize !== undefined) style.fontSize = fontSize;
    if (minFontSize !== undefined) style.minFontSize = minFontSize;

    const fontFamily = this.#getStringAttr('map-label-font-family');
    if (fontFamily !== undefined) style.fontFamily = fontFamily;

    const fontColor = this.#getStringAttr('map-label-font-color');
    if (fontColor !== undefined) style.textColor = fontColor;

    const backgroundColor = this.#getStringAttr('map-label-background-color');
    if (backgroundColor !== undefined) style.backgroundColor = backgroundColor;

    if (fontSize === undefined) {
      const defaultFontSize = this.#engine.getConfigValue?.('labelFontSize');
      if (Number.isFinite(defaultFontSize)) style.fontSize = defaultFontSize;
    }

    if (minFontSize === undefined) {
      const defaultMinFontSize = this.#engine.getConfigValue?.('labelMinFontSize');
      if (Number.isFinite(defaultMinFontSize)) style.minFontSize = defaultMinFontSize;
    }

    if (fontFamily === undefined) {
      const defaultFontFamily = this.#engine.getConfigValue?.('mapLabelFontFamily');
      if (typeof defaultFontFamily === 'string' && defaultFontFamily.trim()) {
        style.fontFamily = defaultFontFamily;
      }
    }

    if (fontColor === undefined) {
      const defaultFontColor = this.#engine.getConfigValue?.('mapLabelFontColor');
      if (typeof defaultFontColor === 'string' && defaultFontColor.trim()) {
        style.textColor = defaultFontColor;
      }
    }

    if (backgroundColor === undefined) {
      const defaultBackgroundColor = this.#engine.getConfigValue?.('mapLabelBackgroundColor');
      if (typeof defaultBackgroundColor === 'string' && defaultBackgroundColor.trim()) {
        style.backgroundColor = defaultBackgroundColor;
      }
    }

    if (Object.keys(style).length) {
      this.#engine.setLocationLabelStyle(style);
    }
  }

  #applyControlThemeFromAttributes() {
    const normalFg = this.#resolveColorToken('control-fg-color', DEFAULT_CONTROL_FG, true);
    const activeFg = this.#resolveColorToken('control-active-fg-color', DEFAULT_CONTROL_ACTIVE_FG, true);
    const normalBg = this.#resolveColorToken('control-bg-color', DEFAULT_CONTROL_BG, false);
    const activeBg = this.#resolveColorToken('control-active-bg-color', DEFAULT_CONTROL_ACTIVE_BG, false);

    this.style.setProperty('--wayfinder-control-icon-color', normalFg.color);
    this.style.setProperty('--wayfinder-control-icon-active-color', activeFg.color);
    this.style.setProperty('--wayfinder-control-button-bg', normalBg.color);
    this.style.setProperty('--wayfinder-control-button-bg-active', activeBg.color);

    this.#applyControlIconColorState();
  }

  #applyMarkerStyleFromAttributes() {
    if (!this.#engine?.isInitialized) return;

    const startFg = this.#resolveColorToken(
      'map-marker-start-fg-color',
      DEFAULT_MARKER_START_FG,
      true
    );
    const startBg = this.#resolveColorToken(
      'map-marker-start-bg-color',
      DEFAULT_MARKER_START_BG,
      false
    );
    const endFg = this.#resolveColorToken(
      'map-marker-end-fg-color',
      DEFAULT_MARKER_END_FG,
      false
    );
    const endBg = this.#resolveColorToken(
      'map-marker-end-bg-color',
      DEFAULT_MARKER_END_BG,
      false
    );
    const connectorFg = this.#resolveColorToken(
      'map-marker-connector-fg-color',
      DEFAULT_MARKER_CONNECTOR_FG,
      false
    );
    const connectorBg = this.#resolveColorToken(
      'map-marker-connector-bg-color',
      DEFAULT_MARKER_CONNECTOR_BG,
      false
    );

    this.#engine.setPinMarkerStyle?.({
      startForegroundColor: startFg.color,
      startForegroundMode: startFg.mode === COLOR_TOKEN_NONE ? 'original' : 'tint',
      startBackgroundColor: startBg.color,
      endForegroundColor: endFg.color,
      endBackgroundColor: endBg.color,
      connectorForegroundColor: connectorFg.color,
      connectorBackgroundColor: connectorBg.color
    });
  }

  #syncIconsFromAttributes() {
    const next = { ...DEFAULT_ICON_SET };
    for (const [attr, key] of Object.entries(ICON_ATTR_TO_KEY)) {
      const value = this.#resolveIconAttr(attr, DEFAULT_ICON_SET[key]);
      if (value !== undefined) next[key] = value;
    }

    this.#icons = next;
    this.#applyStaticIconSources();
    this.#applyHereStartNavUiState();
    this.#engine?.setPinMarkerIcons?.({
      iconWalk: this.#icons.walk,
      iconStand: this.#icons.stand
    });
  }

  #resolveIconAttr(attr, fallback) {
    const raw = this.getAttribute(attr);
    if (raw === null) return undefined;
    const src = raw.trim();
    if (!src) {
      console.warn(`wayfinder-map: "${attr}" is empty, using default icon`);
      return fallback;
    }

    if (WayfinderMapElement.#isAllowedIconSrc(src)) {
      return src;
    }

    console.warn(`wayfinder-map: "${attr}" must be a data:image URI, http(s) URL, or local/relative path, using default icon`);
    return fallback;
  }

  static #isAllowedIconSrc(src) {
    if (DATA_IMAGE_ICON_PATTERN.test(src) || HTTP_ICON_PATTERN.test(src)) {
      return true;
    }

    if (src.startsWith('//')) return false;
    return !URL_SCHEME_PATTERN.test(src);
  }

  #applyStaticIconSources() {
    if (!this.#shadowRoot) return;
    const iconElements = this.#shadowRoot.querySelectorAll('img[data-wayfinder-icon]');
    for (const element of iconElements) {
      const key = element.dataset.wayfinderIcon;
      if (!key) continue;
      const src = this.#icons[key];
      if (!src) continue;
      element.dataset.wayfinderIconBaseSrc = src;
      element.src = src;
    }

    if (this.#searchInfoExpandIconEl) {
      const nextKey = this.#isSearchInfoExpanded ? 'collapse' : 'expand';
      this.#searchInfoExpandIconEl.dataset.wayfinderIcon = nextKey;
      this.#searchInfoExpandIconEl.dataset.wayfinderIconBaseSrc = this.#icons[nextKey];
      this.#searchInfoExpandIconEl.src = this.#icons[nextKey];
    }
    this.#applyControlIconColorState();
  }

  #resolveColorToken(attr, fallbackColor, allowNone) {
    const raw = this.#getStringAttr(attr);
    if (raw === undefined) {
      return { mode: 'color', color: fallbackColor };
    }
    if (allowNone && raw.toLowerCase() === COLOR_TOKEN_NONE) {
      return { mode: COLOR_TOKEN_NONE, color: fallbackColor };
    }
    return { mode: 'color', color: raw };
  }

  #applyControlIconColorState() {
    if (!this.#shadowRoot) return;
    const icons = this.#shadowRoot.querySelectorAll('img[data-wayfinder-icon]');
    for (const icon of icons) {
      const baseSrc = icon.dataset.wayfinderIconBaseSrc;
      if (!baseSrc) continue;

      const isActive = Boolean(icon.closest("[data-active='true']"));
      const fg = this.#resolveColorToken(
        isActive ? 'control-active-fg-color' : 'control-fg-color',
        isActive ? DEFAULT_CONTROL_ACTIVE_FG : DEFAULT_CONTROL_FG,
        true
      );
      if (fg.mode === COLOR_TOKEN_NONE) {
        icon.src = baseSrc;
        continue;
      }

      icon.src = this.#getTintedIconSrc(baseSrc, fg.color);
    }
  }

  #getTintedIconSrc(baseSrc, color) {
    if (!baseSrc || !color || typeof document === 'undefined' || typeof Image === 'undefined') {
      return baseSrc;
    }

    const cacheKey = `${baseSrc}|${color}`;
    const cached = this.#controlTintCache.get(cacheKey);
    if (typeof cached === 'string') {
      return cached;
    }
    if (cached === null) {
      return baseSrc;
    }

    this.#controlTintCache.set(cacheKey, null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const width = img.naturalWidth || img.width;
        const height = img.naturalHeight || img.height;
        if (!width || !height) {
          this.#controlTintCache.set(cacheKey, baseSrc);
          this.#applyControlIconColorState();
          return;
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          this.#controlTintCache.set(cacheKey, baseSrc);
          this.#applyControlIconColorState();
          return;
        }

        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        ctx.globalCompositeOperation = 'source-in';
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, width, height);

        this.#controlTintCache.set(cacheKey, canvas.toDataURL());
      } catch {
        this.#controlTintCache.set(cacheKey, baseSrc);
      }
      this.#applyControlIconColorState();
    };
    img.onerror = () => {
      this.#controlTintCache.set(cacheKey, baseSrc);
      this.#applyControlIconColorState();
    };
    img.src = baseSrc;
    return baseSrc;
  }

  #getNumberAttr(attr) {
    const value = this.getAttribute(attr);
    if (value === null) return undefined;
    const num = parseFloat(value);
    return Number.isNaN(num) ? undefined : num;
  }

  #getStringAttr(attr) {
    const value = this.getAttribute(attr);
    if (value === null) return undefined;
    const text = value.trim();
    return text ? text : undefined;
  }

  #getMinZoomAttr(attr) {
    const value = this.getAttribute(attr);
    if (value === null) return undefined;
    const num = parseFloat(value);
    return Number.isNaN(num) ? value : num;
  }

  #getResponsiveNumberAttr(baseName) {
    const desktop = this.#getNumberAttr(`desktop-${baseName}`);
    const mobile = this.#getNumberAttr(`mobile-${baseName}`);
    if (desktop === undefined && mobile === undefined) return undefined;

    const value = {};
    if (desktop !== undefined) value.desktop = desktop;
    if (mobile !== undefined) value.mobile = mobile;
    return value;
  }

  #getResponsiveMinZoomAttr() {
    const desktop = this.#getMinZoomAttr('desktop-min-zoom');
    const mobile = this.#getMinZoomAttr('mobile-min-zoom');
    if (desktop === undefined && mobile === undefined) return undefined;

    const value = {};
    if (desktop !== undefined) value.desktop = desktop;
    if (mobile !== undefined) value.mobile = mobile;
    return value;
  }

  #getResolvedNumberAttr(baseName) {
    const responsive = this.#getResponsiveNumberAttr(baseName);
    if (responsive !== undefined) {
      return this.#resolveResponsiveValue(responsive);
    }
    return this.#getNumberAttr(baseName);
  }

  #resolveResponsiveValue(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const device = this.#getDeviceMode();
    return value[device] ?? value.desktop ?? value.mobile;
  }

  #getDeviceMode() {
    if (typeof window === 'undefined') return 'desktop';

    const matchMedia = window.matchMedia?.bind(window);
    const isNarrow = matchMedia?.('(max-width: 768px)')?.matches ?? false;
    const isCoarse = matchMedia?.('(pointer: coarse)')?.matches ?? false;
    const hasTouch = (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0);

    return (isNarrow || isCoarse || hasTouch) ? 'mobile' : 'desktop';
  }

  #wireEvents() {
    if (!this.#engine) return;

    const eventMap = {
      'engine:ready': 'ready',
      'engine:error': 'error',
      'floor:changed': 'floor-changed',
      'view:changed': 'view-changed',
      'route:found': 'route-found',
      'route:cleared': 'route-cleared',
      'route:modeChanged': 'route-mode-changed',
      'data:loaded': 'data-loaded',
      'tap:floor-transition': 'floor-transition-tap',
      'tap:location': 'location-tap',
      'tap:disambiguate': 'location-disambiguate',
      'tap:floor': 'floor-tap',
      'tap:empty': 'empty-tap'
    };

    for (const [engineEvent, customEvent] of Object.entries(eventMap)) {
      this.#engine.on(engineEvent, (detail) => {
        if (engineEvent === 'route:modeChanged') {
          this.#syncRouteModeAttribute(detail);
        }
        this.#dispatchEvent(customEvent, detail);
      });
    }
  }

  #syncRouteModeAttribute(detail) {
    const mode = detail?.mode;
    if (mode !== 'escalator' && mode !== 'lift') return;
    if (this.getAttribute('route-mode') === mode) return;

    this.#syncInProgress = true;
    try {
      this.setAttribute('route-mode', mode);
    } finally {
      this.#syncInProgress = false;
    }
  }

  #dispatchEvent(name, detail) {
    this.dispatchEvent(new CustomEvent(name, {
      detail,
      bubbles: true,
      composed: true
    }));
  }

  #setupResizeObserver() {
    if (typeof ResizeObserver === 'undefined') return;
    if (this.#resizeObserver) return;

    this.#resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === this) {
          this.#handleResize();
        }
      }
    });
    this.#resizeObserver.observe(this);
  }

  #handleResize() {
    if (!this.#engine || !this.#initialized) return;

    const rect = this.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      this.#engine.resize(rect.width, rect.height);
    }
  }

  #setupViewportInsetTracking() {
    if (typeof window === 'undefined') return;
    if (this.#viewportInsetHandler) return;

    this.#viewportInsetHandler = () => this.#updateViewportInset();
    this.#visualViewportRef = window.visualViewport || null;

    if (this.#visualViewportRef) {
      this.#visualViewportRef.addEventListener('resize', this.#viewportInsetHandler);
      this.#visualViewportRef.addEventListener('scroll', this.#viewportInsetHandler);
    }

    window.addEventListener('orientationchange', this.#viewportInsetHandler);
    this.#updateViewportInset();
  }

  #cleanupViewportInsetTracking() {
    if (typeof window === 'undefined') return;
    if (!this.#viewportInsetHandler) return;

    if (this.#visualViewportRef) {
      this.#visualViewportRef.removeEventListener('resize', this.#viewportInsetHandler);
      this.#visualViewportRef.removeEventListener('scroll', this.#viewportInsetHandler);
    }

    window.removeEventListener('orientationchange', this.#viewportInsetHandler);
    this.#viewportInsetHandler = null;
    this.#visualViewportRef = null;
    this.style.removeProperty('--wayfinder-viewport-inset-bottom');
  }

  #updateViewportInset() {
    if (typeof window === 'undefined') return;

    const viewport = window.visualViewport;
    if (!viewport) {
      this.style.setProperty('--wayfinder-viewport-inset-bottom', '0px');
      this.#updateLevelSelectorMaxHeight();
      return;
    }

    const hostHeight = this.getBoundingClientRect?.().height ?? 0;
    const layoutHeight = Math.max(
      hostHeight,
      document.documentElement?.clientHeight ?? 0,
      window.innerHeight ?? 0
    );
    const bottomInset = Math.max(0, layoutHeight - viewport.height - viewport.offsetTop);
    this.style.setProperty('--wayfinder-viewport-inset-bottom', `${bottomInset}px`);
    this.#updateLevelSelectorMaxHeight();
  }

  #applyInitialFocusNode(animate = true) {
    const focusNodeId = this.#getNumberAttr('focus-node-id');
    if (!Number.isFinite(focusNodeId) || !this.#engine?.isInitialized) return;
    const result = this.#engine.focusNode(Math.trunc(focusNodeId), { animate, duration: 900 });
    if (result?.success) {
      this.#focusedLocationId = result.location?.id ?? null;
      this.#focusedNode = result.node ?? null;
      this.#setMapMode('focus');
    }
  }

  /**
   * Declarative startup focus on a shop by id (`focus-shop-id` attribute).
   * The Phase-1-honest sibling of `#applyInitialFocusNode`: resolves the shop's
   * catalog Location (`shop:<id>`) and delegates to the shipped focus path
   * (`MapEngine.focusLocation`). Unlike `focus-node-id` (graph node, Phase-2),
   * this works against the published bundle, which carries no flat node graph.
   * @param {boolean} [animate=true]
   */
  #applyInitialFocusShop(animate = true) {
    const focusShopId = this.#getNumberAttr('focus-shop-id');
    if (!Number.isFinite(focusShopId) || !this.#engine?.isInitialized) return;
    const result = this.#engine.focusLocation(`shop:${Math.trunc(focusShopId)}`, {
      animate,
      duration: 900
    });
    if (result?.success) {
      this.#focusedLocationId = result.location?.id ?? null;
      this.#focusedNode = result.node ?? null;
      this.#setMapMode('focus');
    }
  }

  #restoreShareStateFromUrl() {
    if (!this.#engine?.isInitialized || typeof window === 'undefined') return;

    const state = parseShareUrl(window.location.href);
    if (!state) return;

    try {
      if (state.m === 'focus') {
        const restored = this.focusLocation(state.focus, { animate: false });
        if (!restored?.success) return;
      } else if (state.m === 'navigation') {
        const restored = this.navigateTo({
          from: state.from,
          to: state.to,
          animate: false
        });
        if (!restored?.success) return;
      } else {
        return;
      }

      if (state.rm) {
        this.routeMode = state.rm;
      }

      if (state.f) {
        const floors = this.#engine.getFloors?.() ?? [];
        if (floors.includes(state.f)) {
          this.setFloor(state.f);
        }
      }

      if (state.view) {
        this.#engine.setViewState({
          scale: state.view.s,
          panX: state.view.x,
          panY: state.view.y,
          rotation: state.view.r
        });
      }

      this.#restoreSearchUiStateFromShare(state.ui);
    } catch (error) {
      console.warn('wayfinder-map: failed to restore shared state', error);
    }
  }

  #captureSearchUiShareState() {
    if (!this.#searchControlEnabled) return null;

    return {
      searchOpen: this.#searchOpen,
      searchQuery: this.#searchInputEl?.value ?? this.#searchQuery ?? '',
      selectedLocationId: this.#selectedLocationId,
      infoExpanded: this.#isSearchInfoExpanded,
      descriptionExpanded: this.#isSearchDescriptionExpanded,
      searchNavMode: this.#searchNavMode,
      navActiveField: this.#navActiveField,
      navFromLocationId: this.#navFromLocationId,
      navToLocationId: this.#navToLocationId,
      navFromText: this.#searchNavFromValueEl?.value ?? '',
      navToText: this.#searchNavToValueEl?.value ?? ''
    };
  }

  #restoreSearchUiStateFromShare(uiState) {
    if (!this.#searchControlEnabled || !uiState) return;

    if (this.#searchInputEl && typeof uiState.searchQuery === 'string') {
      this.#searchInputEl.value = uiState.searchQuery;
      this.#searchQuery = uiState.searchQuery;
    }

    if (typeof uiState.selectedLocationId === 'number') {
      const location = this.#engine?.getLocation?.(uiState.selectedLocationId);
      if (location) {
        this.#selectedLocationId = uiState.selectedLocationId;
        this.#updateSearchInfo(location);
      } else {
        this.#selectedLocationId = null;
      }
    } else {
      this.#selectedLocationId = null;
    }
    if (this.#searchContainerEl) {
      this.#searchContainerEl.dataset.selected = 'false';
    }

    if (typeof uiState.descriptionExpanded === 'boolean') {
      this.#isSearchDescriptionExpanded = uiState.descriptionExpanded;
      if (this.#searchInfoEl) {
        this.#searchInfoEl.dataset.descriptionExpanded = uiState.descriptionExpanded ? 'true' : 'false';
      }
      if (this.#searchInfoDescriptionToggleEl) {
        this.#searchInfoDescriptionToggleEl.setAttribute('aria-expanded', uiState.descriptionExpanded ? 'true' : 'false');
        this.#searchInfoDescriptionToggleEl.textContent = uiState.descriptionExpanded ? 'Read less' : 'Read more';
      }
    }

    const searchNavMode = uiState.searchNavMode === true;
    this.#searchNavMode = searchNavMode;
    if (searchNavMode) {
      this.#navUsesHereStart = this.#engine?.hasYouAreHere?.() ?? false;
      this.#navActiveField = uiState.navActiveField === 'to'
        ? 'to'
        : (uiState.navActiveField === 'from' ? 'from' : null);
      this.#navFromLocationId = this.#navUsesHereStart
        ? null
        : (Number.isFinite(uiState.navFromLocationId) ? uiState.navFromLocationId : null);
      this.#navToLocationId = Number.isFinite(uiState.navToLocationId) ? uiState.navToLocationId : null;
      this.#navPreSelectedLocationId = this.#selectedLocationId;

      if (this.#searchContainerEl) this.#searchContainerEl.dataset.navMode = 'true';
      if (this.#searchHeaderEl) this.#searchHeaderEl.style.display = 'none';
      if (this.#searchNavHeaderEl) this.#searchNavHeaderEl.style.display = 'flex';
      if (this.#searchNavFieldsEl) this.#searchNavFieldsEl.style.display = 'flex';

      const fromEntry = this.#searchIndex.find((entry) => entry.id === this.#navFromLocationId);
      const toEntry = this.#searchIndex.find((entry) => entry.id === this.#navToLocationId);
      if (this.#searchNavFromValueEl) {
        this.#searchNavFromValueEl.value = this.#navUsesHereStart
          ? 'Your location'
          : (typeof uiState.navFromText === 'string'
          ? uiState.navFromText
          : (fromEntry?.title ?? ''));
      }
      if (this.#searchNavToValueEl) {
        this.#searchNavToValueEl.value = typeof uiState.navToText === 'string'
          ? uiState.navToText
          : (toEntry?.title ?? '');
      }
      if (this.#navUsesHereStart) {
        this.#navActiveField = 'to';
      }
      this.#applyHereStartNavUiState();
      this.#updateNavFieldStates();
    } else {
      this.#navActiveField = null;
      this.#navFromLocationId = null;
      this.#navToLocationId = null;
      this.#navPreSelectedLocationId = null;
      this.#navUsesHereStart = false;
      this.#applyHereStartNavUiState();
      if (this.#searchContainerEl) this.#searchContainerEl.dataset.navMode = 'false';
      if (this.#searchHeaderEl) this.#searchHeaderEl.style.display = 'flex';
      if (this.#searchNavHeaderEl) this.#searchNavHeaderEl.style.display = 'none';
      if (this.#searchNavFieldsEl) this.#searchNavFieldsEl.style.display = 'none';
    }

    const showInfo = this.#selectedLocationId != null && this.#mapMode === 'focus' && !searchNavMode;
    this.#setSearchInfoVisible(showInfo);
    this.#setSearchInfoExpanded(showInfo && uiState.infoExpanded === true);

    const shouldOpen = uiState.searchOpen === true;
    this.#searchOpen = shouldOpen;
    if (this.#searchContainerEl) {
      this.#searchContainerEl.dataset.open = shouldOpen ? 'true' : 'false';
    }
    if (!shouldOpen) {
      this.#searchInputEl?.blur();
    }

    if (searchNavMode) {
      if (shouldOpen && this.#navActiveField === 'to') {
        this.#searchNavToValueEl?.focus();
      } else if (shouldOpen) {
        this.#searchNavFromValueEl?.focus();
      }
      if (this.#navActiveField != null || shouldOpen) {
        this.#showNavFilteredResults();
      } else {
        this.#hideSearchResults();
      }
    } else {
      if (shouldOpen) {
        this.#handleSearchInput();
      } else {
        this.#hideSearchResults();
        this.#updateClearButtonVisibility();
      }
    }

    this.#updateNavSummary();
    this.#updateLevelSelectorMaxHeight();
  }

  #buildShareState() {
    return captureMapShareState({
      mode: this.#mapMode,
      currentFloor: this.#engine?.getCurrentFloor?.() ?? null,
      routeMode: this.routeMode,
      focusedLocationId: this.#focusedLocationId,
      startLocationId: this.#startLocationId,
      endLocationId: this.#endLocationId,
      viewState: this.getViewState(),
      searchUiState: this.#captureSearchUiShareState()
    });
  }

  #showShareQrModal() {
    if (!this.#engine?.isInitialized || typeof window === 'undefined') return;

    const state = this.#buildShareState();
    if (!state) return;

    const shareUrl = buildShareUrl(window.location.href, state);
    if (!shareUrl) return;

    try {
      const qr = QRCode(0, 'M');
      qr.addData(shareUrl, 'Byte');
      qr.make();
      const qrSvg = qr.createSvgTag({ cellSize: 7, margin: 2, scalable: true });
      this.#openQrModal(qrSvg, shareUrl);
    } catch (error) {
      console.warn('wayfinder-map: failed to generate qr code', error);
    }
  }

  #openQrModal(qrSvg, shareUrl) {
    if (!this.#qrModalEl || !this.#qrModalCodeEl || !this.#qrModalCopyButton) return;

    this.#qrModalCodeEl.innerHTML = qrSvg;
    this.#qrShareUrl = shareUrl;
    this.#qrModalCopyButton.textContent = 'Copy Link';
    this.#qrModalEl.dataset.open = 'true';
    this.#qrModalEl.setAttribute('aria-hidden', 'false');
    this.#qrModalOpen = true;

    if (!this.#qrModalKeydownHandler) {
      this.#qrModalKeydownHandler = (event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        this.#closeQrModal();
      };
      document.addEventListener('keydown', this.#qrModalKeydownHandler);
    }

    this.#qrModalCopyButton.focus();
  }

  #closeQrModal() {
    if (!this.#qrModalEl || !this.#qrModalCodeEl || !this.#qrModalCopyButton) return;
    if (!this.#qrModalOpen && this.#qrModalEl.dataset.open !== 'true') return;

    this.#qrModalEl.dataset.open = 'false';
    this.#qrModalEl.setAttribute('aria-hidden', 'true');
    this.#qrModalCodeEl.innerHTML = '';
    this.#qrModalCopyButton.textContent = 'Copy Link';
    this.#qrModalOpen = false;
    this.#qrShareUrl = '';

    if (this.#qrCopyResetTimer) {
      clearTimeout(this.#qrCopyResetTimer);
      this.#qrCopyResetTimer = null;
    }

    if (this.#qrModalKeydownHandler) {
      document.removeEventListener('keydown', this.#qrModalKeydownHandler);
      this.#qrModalKeydownHandler = null;
    }
  }

  async #copyQrShareUrl() {
    if (!this.#qrShareUrl || !this.#qrModalCopyButton) return;

    const text = this.#qrShareUrl;
    let copied = false;

    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        copied = true;
      }
    } catch {
      copied = false;
    }

    if (!copied && typeof document !== 'undefined' && document.body) {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        copied = document.execCommand('copy');
      } catch {
        copied = false;
      } finally {
        document.body.removeChild(textarea);
      }
    }

    this.#qrModalCopyButton.textContent = copied ? 'Copied' : 'Copy failed';
    if (this.#qrCopyResetTimer) clearTimeout(this.#qrCopyResetTimer);
    this.#qrCopyResetTimer = setTimeout(() => {
      if (this.#qrModalCopyButton && this.#qrModalOpen) {
        this.#qrModalCopyButton.textContent = 'Copy Link';
      }
      this.#qrCopyResetTimer = null;
    }, 1200);
  }

  #bindQrModalEvents() {
    if (!this.#qrModalEl || this.#qrModalClickHandler) return;

    this.#qrModalClickHandler = (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const actionButton = target.closest('button');
      if (actionButton?.dataset.action === 'copy-qr-url') {
        void this.#copyQrShareUrl();
        return;
      }

      if (target === this.#qrModalEl) {
        this.#closeQrModal();
      }
    };

    this.#qrModalEl.addEventListener('click', this.#qrModalClickHandler);
  }

  #unbindQrModalEvents() {
    if (!this.#qrModalEl || !this.#qrModalClickHandler) return;
    this.#qrModalEl.removeEventListener('click', this.#qrModalClickHandler);
    this.#qrModalClickHandler = null;
  }

  #cleanup() {
    this.#disableLevelSelector();
    this.#disableSearchControl();
    this.#unbindLocateControls();
    this.#closeQrModal();
    this.#unbindQrModalEvents();
    this.#cleanupViewportInsetTracking();
    if (this.#resizeObserver) {
      this.#resizeObserver.disconnect();
      this.#resizeObserver = null;
    }
    this.#focusedLocationId = null;
    this.#startLocationId = null;
    this.#endLocationId = null;
    this.#setMapMode('browse');
    if (this.#engine) {
      this.#engine.dispose();
      this.#engine = null;
    }
    this.#initialized = false;
  }

  #syncLevelSelector() {
    if (this.hasAttribute('level-selector')) {
      this.#enableLevelSelector();
    } else {
      this.#disableLevelSelector();
    }
  }

  #enableLevelSelector() {
    this.#levelSelectorEnabled = true;
    if (this.#engine?.isInitialized) {
      if (this.#levelSelectorEl) {
        this.#levelSelectorEl.dataset.enabled = 'true';
      }
      this.#bindLevelSelectorEvents();
      this.#renderLevelSelector();
    } else if (this.#levelSelectorEl) {
      this.#levelSelectorEl.dataset.enabled = 'false';
    }
  }

  #disableLevelSelector() {
    this.#levelSelectorEnabled = false;
    this.#unbindLevelSelectorEvents();
    if (this.#levelSelectorEl) {
      this.#levelSelectorEl.dataset.enabled = 'false';
      this.#levelSelectorEl.innerHTML = '';
    }
  }

  #bindLevelSelectorEvents() {
    if (!this.#engine || !this.#levelSelectorEl) return;

    if (!this.#levelSelectorClickHandler) {
      this.#levelSelectorClickHandler = (event) => this.#handleLevelSelectorClick(event);
      this.#levelSelectorEl.addEventListener('click', this.#levelSelectorClickHandler);
    }

    if (!this.#levelSelectorUnsubFloor) {
      this.#levelSelectorUnsubFloor = this.#engine.on('floor:changed', (detail) => {
        const floor = detail?.floor ?? this.#engine?.getCurrentFloor?.();
        this.#updateLevelSelectorActive(floor);
      });
    }

    if (!this.#levelSelectorUnsubData) {
      this.#levelSelectorUnsubData = this.#engine.on('data:loaded', () => {
        this.#renderLevelSelector();
      });
    }
  }

  #unbindLevelSelectorEvents() {
    if (this.#levelSelectorClickHandler && this.#levelSelectorEl) {
      this.#levelSelectorEl.removeEventListener('click', this.#levelSelectorClickHandler);
      this.#levelSelectorClickHandler = null;
    }
    if (this.#levelSelectorUnsubFloor) {
      this.#levelSelectorUnsubFloor();
      this.#levelSelectorUnsubFloor = null;
    }
    if (this.#levelSelectorUnsubData) {
      this.#levelSelectorUnsubData();
      this.#levelSelectorUnsubData = null;
    }
  }

  #renderLevelSelector() {
    if (!this.#levelSelectorEnabled || !this.#engine || !this.#levelSelectorEl) return;

    const floorCodes = this.#engine.getFloors?.() ?? [];
    const levels = this.#engine.getLevels?.() ?? [];
    const sorted = sortFloorCodesByPosition(floorCodes, levels);

    this.#levelSelectorEl.innerHTML = '';

    for (const code of sorted) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'wayfinder-level-button';
      button.dataset.floor = code;
      button.textContent = code;
      button.setAttribute('aria-label', `Level ${code}`);
      this.#levelSelectorEl.appendChild(button);
    }

    this.#levelSelectorEl.dataset.enabled = 'true';
    this.#updateLevelSelectorActive(this.#engine.getCurrentFloor?.() ?? null);
    this.#updateLevelSelectorMaxHeight();
  }

  #updateLevelSelectorActive(floorCode) {
    if (!this.#levelSelectorEl) return;
    const buttons = this.#levelSelectorEl.querySelectorAll('button');
    for (const button of buttons) {
      const isActive = button.dataset.floor === floorCode;
      button.dataset.active = isActive ? 'true' : 'false';
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    }
  }

  #handleLevelSelectorClick(event) {
    if (!this.#engine) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest('button');
    if (!button || !this.#levelSelectorEl?.contains(button)) return;
    const floorCode = button.dataset.floor;
    if (floorCode) {
      this.#engine.setFloor(floorCode);
    }
  }

  #syncSearchControl() {
    if (this.hasAttribute('search-control')) {
      this.#enableSearchControl();
    } else {
      this.#disableSearchControl();
    }
  }

  #enableSearchControl() {
    this.#searchControlEnabled = true;
    if (this.#searchContainerEl) {
      this.#searchContainerEl.dataset.enabled = this.#engine?.isInitialized ? 'true' : 'false';
    }
    if (!this.#engine?.isInitialized) return;
    this.#bindSearchEvents();
    this.#buildSearchIndex();
    this.#handleSearchInput();
    this.#updateSearchMode();
    this.#setupSearchLayoutObservers();
    this.#updateLevelSelectorMaxHeight();
  }

  #disableSearchControl() {
    this.#searchControlEnabled = false;
    this.#unbindSearchEvents();
    this.#cleanupSearchLayoutObservers();
    this.#searchIndex = [];
    this.#searchQuery = '';
    this.#selectedLocationId = null;
    this.#searchOpen = false;
    this.#setSearchInfoExpanded(false);
    if (this.#searchContainerEl) {
      this.#searchContainerEl.dataset.enabled = 'false';
      this.#searchContainerEl.dataset.open = 'false';
      this.#searchContainerEl.dataset.selected = 'false';
    }
    if (this.#searchResultsEl) {
      this.#searchResultsEl.innerHTML = '';
      this.#searchResultsEl.hidden = true;
    }
    if (this.#searchInputEl) {
      this.#searchInputEl.value = '';
    }
    this.#setSearchInfoVisible(false);
    this.#clearLevelSelectorMaxHeight();
    if (this.#searchNavSummaryEl) {
      this.#searchNavSummaryEl.dataset.visible = 'false';
    }
  }

  #setupSearchLayoutObservers() {
    if (typeof window === 'undefined') return;

    if (!this.#searchLayoutResizeHandler) {
      this.#searchLayoutResizeHandler = () => this.#handleViewTransition();
      window.addEventListener('resize', this.#searchLayoutResizeHandler);
    }

    if (typeof ResizeObserver !== 'undefined' && this.#searchInfoEl && !this.#searchInfoResizeObserver) {
      this.#searchInfoResizeObserver = new ResizeObserver(() => {
        this.#updateLevelSelectorMaxHeight();
      });
      this.#searchInfoResizeObserver.observe(this.#searchInfoEl);
    }
  }

  #cleanupSearchLayoutObservers() {
    if (this.#searchLayoutResizeHandler && typeof window !== 'undefined') {
      window.removeEventListener('resize', this.#searchLayoutResizeHandler);
      this.#searchLayoutResizeHandler = null;
    }
    if (this.#searchInfoResizeObserver) {
      this.#searchInfoResizeObserver.disconnect();
      this.#searchInfoResizeObserver = null;
    }
  }

  #clearLevelSelectorMaxHeight() {
    if (this.#levelSelectorEl) {
      this.#levelSelectorEl.style.maxHeight = '';
    }
  }

  #updateLevelSelectorMaxHeight() {
    if (!this.#levelSelectorEl || !this.#controlRailEl || !this.#searchInfoEl) return;
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      this.#clearLevelSelectorMaxHeight();
      return;
    }
    if (!window.matchMedia('(max-width: 768px)').matches) {
      this.#clearLevelSelectorMaxHeight();
      return;
    }

    const isInfoVisible = this.#searchInfoEl.dataset.visible === 'true';
    if (!isInfoVisible) {
      this.#clearLevelSelectorMaxHeight();
      return;
    }

    const railRect = this.#controlRailEl.getBoundingClientRect();
    const infoRect = this.#searchInfoEl.getBoundingClientRect();
    const gap = 16;
    const available = Math.max(0, infoRect.top - railRect.top - gap);
    this.#levelSelectorEl.style.maxHeight = `${available}px`;
  }

  #bindSearchEvents() {
    if (!this.#engine || !this.#searchContainerEl) return;

    if (!this.#searchClickHandler) {
      this.#searchClickHandler = (event) => this.#handleSearchClick(event);
      this.#searchContainerEl.addEventListener('click', this.#searchClickHandler);
    }

    if (!this.#searchInputHandler && this.#searchInputEl) {
      this.#searchInputHandler = (event) => this.#handleSearchInput(event);
      this.#searchInputEl.addEventListener('input', this.#searchInputHandler);
      this.#searchInputEl.addEventListener('focus', this.#searchInputHandler);
    }

    if (!this.#searchKeydownHandler && this.#searchInputEl) {
      this.#searchKeydownHandler = (event) => this.#handleSearchKeydown(event);
      this.#searchInputEl.addEventListener('keydown', this.#searchKeydownHandler);
    }

    if (!this.#searchUnsubData) {
      this.#searchUnsubData = this.#engine.on('data:loaded', () => {
        this.#buildSearchIndex();
        this.#handleSearchInput();
      });
    }

    if (!this.#searchUnsubRouteFound) {
      this.#searchUnsubRouteFound = this.#engine.on('route:found', () => {
        this.#resetSearchSelection();
      });
    }

    if (!this.#searchOutsidePointerHandler) {
      this.#searchOutsidePointerHandler = (event) => this.#handleSearchOutsideInteraction(event);
      this.#shadowRoot?.addEventListener('pointerdown', this.#searchOutsidePointerHandler, true);
      document.addEventListener('pointerdown', this.#searchOutsidePointerHandler, true);
    }

    if (!this.#searchOutsideFocusHandler) {
      this.#searchOutsideFocusHandler = (event) => this.#handleSearchOutsideInteraction(event);
      this.#shadowRoot?.addEventListener('focusin', this.#searchOutsideFocusHandler, true);
      document.addEventListener('focusin', this.#searchOutsideFocusHandler, true);
    }

    if (this.#searchDirectionButton && !this.#searchDirectionButton._navBound) {
      this.#searchDirectionButton.addEventListener('click', () => {
        this.#enterNavigationMode();
      });
      this.#searchDirectionButton._navBound = true;
    }

    if (this.#searchNavFieldsEl && !this.#searchNavFieldsEl._navBound) {
      this.#searchNavFieldsEl.addEventListener('click', (event) => {
        const field = event.target.closest('.wayfinder-search-nav-field');
        if (!field) return;

        const fieldType = field.dataset.field;
        if (fieldType === 'from' || fieldType === 'to') {
          this.#selectNavField(fieldType);
        }
      });
      this.#searchNavFieldsEl._navBound = true;
    }

    if (this.#searchNavFromValueEl && !this.#searchNavFromValueEl._navBound) {
      const handleFromInput = () => this.#handleNavFieldInput('from');
      this.#searchNavFromValueEl.addEventListener('input', handleFromInput);
      this.#searchNavFromValueEl.addEventListener('focus', () => {
        this.#selectNavField('from');
      });
      this.#searchNavFromValueEl._navBound = true;
    }

    if (this.#searchNavToValueEl && !this.#searchNavToValueEl._navBound) {
      const handleToInput = () => this.#handleNavFieldInput('to');
      this.#searchNavToValueEl.addEventListener('input', handleToInput);
      this.#searchNavToValueEl.addEventListener('focus', () => {
        this.#selectNavField('to');
      });
      this.#searchNavToValueEl._navBound = true;
    }
  }

  #unbindSearchEvents() {
    if (this.#searchClickHandler && this.#searchContainerEl) {
      this.#searchContainerEl.removeEventListener('click', this.#searchClickHandler);
      this.#searchClickHandler = null;
    }
    if (this.#searchInputHandler && this.#searchInputEl) {
      this.#searchInputEl.removeEventListener('input', this.#searchInputHandler);
      this.#searchInputEl.removeEventListener('focus', this.#searchInputHandler);
      this.#searchInputHandler = null;
    }
    if (this.#searchKeydownHandler && this.#searchInputEl) {
      this.#searchInputEl.removeEventListener('keydown', this.#searchKeydownHandler);
      this.#searchKeydownHandler = null;
    }
    if (this.#searchUnsubData) {
      this.#searchUnsubData();
      this.#searchUnsubData = null;
    }
    if (this.#searchUnsubRouteFound) {
      this.#searchUnsubRouteFound();
      this.#searchUnsubRouteFound = null;
    }
    if (this.#searchOutsidePointerHandler) {
      this.#shadowRoot?.removeEventListener('pointerdown', this.#searchOutsidePointerHandler, true);
      document.removeEventListener('pointerdown', this.#searchOutsidePointerHandler, true);
      this.#searchOutsidePointerHandler = null;
    }
    if (this.#searchOutsideFocusHandler) {
      this.#shadowRoot?.removeEventListener('focusin', this.#searchOutsideFocusHandler, true);
      document.removeEventListener('focusin', this.#searchOutsideFocusHandler, true);
      this.#searchOutsideFocusHandler = null;
    }
  }

  #isMobileSearchLayout() {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(max-width: 768px)').matches;
  }

  /**
   * Handles view transitions between desktop and mobile layouts.
   * Detects when viewport crosses the 768px breakpoint and performs a full reset
   * to ensure clean, independent UI state for each view mode.
   */
  #handleViewTransition() {
    if (!this.#searchControlEnabled) return;

    const currentMode = this.#isMobileSearchLayout() ? 'mobile' : 'desktop';

    // Initialize on first call
    if (this.#previousDeviceMode === null) {
      this.#previousDeviceMode = currentMode;
      return;
    }

    // Check if mode changed (desktop ↔ mobile transition)
    if (this.#previousDeviceMode !== currentMode) {
      // View transition detected - perform full reset

      // 1. Clear all route, focus, and search state
      // This handles: focus mode, route, search selection, map mode -> browse
      this.clearRoute();

      // 2. Exit navigation mode if active
      if (this.#searchNavMode) {
        // Manually reset nav state (don't call #exitNavigationMode to avoid restoring selection)
        this.#searchNavMode = false;
        this.#navActiveField = null;
        this.#navFromLocationId = null;
        this.#navToLocationId = null;
        this.#navPreSelectedLocationId = null;

        if (this.#searchNavFromValueEl) this.#searchNavFromValueEl.value = '';
        if (this.#searchNavToValueEl) this.#searchNavToValueEl.value = '';

        if (this.#searchContainerEl) {
          this.#searchContainerEl.dataset.navMode = 'false';
        }

        if (this.#searchHeaderEl) {
          this.#searchHeaderEl.style.display = 'flex';
        }

        if (this.#searchNavHeaderEl) {
          this.#searchNavHeaderEl.style.display = 'none';
        }
        if (this.#searchNavFieldsEl) {
          this.#searchNavFieldsEl.style.display = 'none';
        }
      }

      // 3. Clear search query and input field (clearRoute already cleared selection)
      if (this.#searchInputEl) {
        this.#searchInputEl.value = '';
      }
      this.#searchQuery = '';

      // 4. Reset UI states
      this.#isSearchDescriptionExpanded = false;
      this.#isSearchInfoExpanded = false;

      // 5. Close overlay (will reopen if needed via sync)
      if (this.#searchOpen) {
        this.#searchOpen = false;
        if (this.#searchContainerEl) {
          this.#searchContainerEl.dataset.open = 'false';
        }
        this.#searchInputEl?.blur();
      }

      // 6. Hide info panel and results (clearRoute already hid info panel)
      this.#hideSearchResults();

      // 7. Update clear button visibility
      this.#updateClearButtonVisibility();

      // Update tracked mode
      this.#previousDeviceMode = currentMode;

      // 8. Now let sync apply fresh defaults for new view
      this.#syncMobileSearchState();
    } else {
      // No transition, just update tracked mode
      this.#previousDeviceMode = currentMode;
    }
  }

  /**
   * Unified state synchronization - ensures UI consistency across mode and layout changes.
   * This is the single source of truth for validating and enforcing search UI state.
   *
   * Call this method whenever:
   * - Map mode changes (browse/focus/navigation)
   * - Layout changes (mobile ↔ desktop resize)
   * - Overlay state changes (open/close)
   * - Navigation mode entered/exited
   */
  #syncMobileSearchState() {
    if (!this.#searchControlEnabled) return;

    // Prevent infinite recursion
    if (this.#syncInProgress) return;
    this.#syncInProgress = true;

    try {
      const isMobile = this.#isMobileSearchLayout();
      const mode = this.#mapMode;
      const hasSelection = this.#selectedLocationId != null;
      const inNavMode = this.#searchNavMode;

      // RULE 1: Browse mode - info panel hidden (overlay managed by explicit user actions)
      if (mode === 'browse' && !inNavMode) {
        this.#setSearchInfoVisible(false);
        this.#setSearchInfoExpanded(false);
      }

      // RULE 2: Focus mode - different mobile vs desktop behavior
      if (mode === 'focus' && hasSelection) {
        const shouldShowInfo = true;
        this.#setSearchInfoVisible(shouldShowInfo);

        if (isMobile) {
          // Mobile: auto-close overlay, show info at bottom (collapsed)
          if (this.#searchOpen) {
            this.#closeSearchOverlay();
          }
          this.#setSearchInfoExpanded(false);
        }
        // Desktop: keep overlay/panel visible, info panel stacked
      }

      // RULE 3: Navigation mode - overlay open on mobile only when fields need input
      if (mode === 'navigation' || inNavMode) {
        const navFieldsNeedInput = inNavMode && ((!this.#navFromLocationId && !this.#navUsesHereStart) || !this.#navToLocationId);
        if (isMobile && !this.#searchOpen && navFieldsNeedInput) {
          this.#openSearchOverlay();
        }
        // Info panel always hidden in nav mode
        this.#setSearchInfoVisible(false);
        this.#setSearchInfoExpanded(false);
      }

      // RULE 4: Level selector max-height adjustment
      this.#updateLevelSelectorMaxHeight();

      this.#updateNavSummary();
    } finally {
      this.#syncInProgress = false;
    }
  }

  #isSearchResultsVisible() {
    return Boolean(this.#searchResultsEl && !this.#searchResultsEl.hidden);
  }

  #hideSearchResults() {
    if (!this.#searchResultsEl) return;
    this.#searchResultsEl.hidden = true;
  }

  #enterNavigationMode() {
    this.#setNavConnectorConstraint(null);
    this.#searchNavMode = true;
    this.#navUsesHereStart = this.#engine?.hasYouAreHere?.() ?? false;
    this.#navActiveField = this.#navUsesHereStart ? 'to' : 'from';
    this.#navFromLocationId = null;
    this.#navToLocationId = null;

    this.#navPreSelectedLocationId = this.#selectedLocationId;

    if (this.#selectedLocationId != null) {
      this.#navToLocationId = this.#selectedLocationId;
      const entry = this.#searchIndex.find(e => e.id === this.#selectedLocationId);
      if (entry && this.#searchNavToValueEl) {
        this.#searchNavToValueEl.value = entry.title;
      }
    }

    if (this.#searchNavFromValueEl) {
      this.#searchNavFromValueEl.value = this.#navUsesHereStart ? 'Your location' : '';
    }
    this.#applyHereStartNavUiState();

    if (this.#searchContainerEl) {
      this.#searchContainerEl.dataset.navMode = 'true';
    }

    if (this.#searchHeaderEl) {
      this.#searchHeaderEl.style.display = 'none';
    }

    if (this.#searchInfoEl) {
      this.#searchInfoEl.dataset.visible = 'false';
    }

    if (this.#searchNavHeaderEl) {
      this.#searchNavHeaderEl.style.display = 'flex';
    }
    if (this.#searchNavFieldsEl) {
      this.#searchNavFieldsEl.style.display = 'flex';
    }

    this.#updateNavFieldStates();
    this.#showNavFilteredResults();
    this.#syncMobileSearchState();
    if (this.#navUsesHereStart) {
      this.#searchNavToValueEl?.focus();
      if (this.#navToLocationId != null) {
        this.#triggerNavigation();
      }
    } else {
      this.#searchNavFromValueEl?.focus();
    }
  }

  #exitNavigationMode() {
    this.#setNavConnectorConstraint(null);
    this.#searchNavMode = false;
    this.#navActiveField = null;
    this.#navFromLocationId = null;
    this.#navToLocationId = null;
    this.#navUsesHereStart = false;

    if (this.#searchNavFromValueEl) this.#searchNavFromValueEl.value = '';
    if (this.#searchNavToValueEl) this.#searchNavToValueEl.value = '';
    this.#applyHereStartNavUiState();

    if (this.#searchContainerEl) {
      this.#searchContainerEl.dataset.navMode = 'false';
    }

    if (this.#searchHeaderEl) {
      this.#searchHeaderEl.style.display = 'flex';
    }

    if (this.#searchNavHeaderEl) {
      this.#searchNavHeaderEl.style.display = 'none';
    }
    if (this.#searchNavFieldsEl) {
      this.#searchNavFieldsEl.style.display = 'none';
    }

    this.clearRoute();
    this.#hideSearchResults();

    const preSelectedId = this.#navPreSelectedLocationId;
    this.#navPreSelectedLocationId = null;

    if (preSelectedId != null) {
      const location = this.#engine?.getLocation?.(preSelectedId);
      if (location) {
        this.#selectSearchLocation(location);
      }
    }
    this.#syncMobileSearchState();
    this.#updateNavSummary();
  }

  #updateNavFieldStates() {
    if (!this.#searchNavFromFieldEl || !this.#searchNavToFieldEl) return;

    if (this.#navFromLocationId || this.#navUsesHereStart) {
      this.#searchNavFromFieldEl.dataset.state = 'filled';
    } else if (this.#navActiveField === 'from') {
      this.#searchNavFromFieldEl.dataset.state = 'active';
    } else {
      this.#searchNavFromFieldEl.dataset.state = 'inactive';
    }

    if (this.#navToLocationId) {
      this.#searchNavToFieldEl.dataset.state = 'filled';
    } else if (this.#navActiveField === 'to') {
      this.#searchNavToFieldEl.dataset.state = 'active';
    } else {
      this.#searchNavToFieldEl.dataset.state = 'inactive';
    }
  }

  #selectNavField(field) {
    if (field === 'from' && this.#navUsesHereStart) {
      return;
    }

    if (field === 'from') {
      this.#navActiveField = 'from';
      this.#updateNavFieldStates();
      this.#showNavFilteredResults();
      this.#searchNavFromValueEl?.focus();
    } else if (field === 'to') {
      this.#navActiveField = 'to';
      this.#updateNavFieldStates();
      this.#showNavFilteredResults();
      this.#searchNavToValueEl?.focus();
    }
  }

  #selectNavLocation(locationId) {
    if (!this.#searchNavMode || !this.#navActiveField) return;

    const location = this.#searchIndex.find(entry => entry.id === locationId);
    if (!location) return;

    const title = location.title || location.location?.label || 'Selected';

    if (this.#navActiveField === 'from') {
      this.#navFromLocationId = locationId;
      if (this.#searchNavFromValueEl) {
        this.#searchNavFromValueEl.value = title;
      }

      this.#navActiveField = 'to';
      this.#updateNavFieldStates();

      if (this.#navToLocationId) {
        this.#triggerNavigation();
        this.#hideSearchResults();
      } else {
        this.#showNavFilteredResults();
        if (this.#searchNavToValueEl) {
          this.#searchNavToValueEl.focus();
        }
      }
    } else if (this.#navActiveField === 'to') {
      this.#navToLocationId = locationId;
      if (this.#searchNavToValueEl) {
        this.#searchNavToValueEl.value = title;
      }

      this.#navActiveField = null;
      this.#updateNavFieldStates();
      this.#hideSearchResults();

      if (this.#navFromLocationId || this.#navUsesHereStart) {
        this.#triggerNavigation();
      }
    }
  }

  #triggerNavigation() {
    if (!this.#navToLocationId) return;
    if (!this.#navUsesHereStart && !this.#navFromLocationId) return;

    let result;
    if (this.#navUsesHereStart) {
      result = this.#engine.navigateFromYouAreHere(this.#navToLocationId, {
        connectorConstraint: this.#navConnectorConstraint
      });
      if (result?.success) {
        this.#startLocationId = null;
        this.#endLocationId = result.endLocation?.id ?? null;
        this.#startNode = result.startNode ?? null;
        this.#endNode = result.endNode ?? null;
        this.#focusedLocationId = null;
        this.#focusedNode = null;
        this.#setMapMode('navigation');
        this.#resetSearchSelection();
      }
    } else {
      result = this.navigateTo({
        from: this.#navFromLocationId,
        to: this.#navToLocationId,
        connectorConstraint: this.#navConnectorConstraint
      });
    }

    if (result?.success && this.#isMobileSearchLayout()) {
      this.#closeSearchOverlay();
    }
    this.#updateNavSummary();
  }

  #handleNavFieldInput(field) {
    if (!this.#searchNavMode) return;
    if (field === 'from' && this.#navUsesHereStart) return;

    if (this.#navActiveField !== field) {
      this.#navActiveField = field;
      this.#updateNavFieldStates();
    }

    // Clear selection when user edits the field
    if (field === 'from' && this.#navFromLocationId) {
      this.#navFromLocationId = null;
      this.clearRoute();
      this.#updateNavFieldStates();
    } else if (field === 'to' && this.#navToLocationId) {
      this.#navToLocationId = null;
      this.clearRoute();
      this.#updateNavFieldStates();
    }

    this.#showNavFilteredResults();
  }

  #showNavFilteredResults() {
    if (!this.#searchResultsEl || !this.#searchIndex) return;

    if (this.#navUsesHereStart && this.#navActiveField === 'from') {
      this.#searchResultsEl.hidden = true;
      return;
    }

    const activeInput = this.#navActiveField === 'from'
      ? this.#searchNavFromValueEl
      : this.#searchNavToValueEl;

    const query = activeInput?.value?.trim() ?? '';
    const results = this.#filterSearchResults(query);

    this.#renderSearchResults(results);
  }

  #updateNavSummary() {
    if (!this.#searchNavSummaryEl) return;

    const isMobile = this.#isMobileSearchLayout();
    const shouldShow = this.#searchNavMode
      && isMobile
      && !this.#searchOpen
      && (this.#navUsesHereStart || this.#navFromLocationId != null)
      && this.#navToLocationId != null;

    this.#searchNavSummaryEl.dataset.visible = shouldShow ? 'true' : 'false';

    if (shouldShow) {
      const fromEntry = this.#searchIndex?.find(e => e.id === this.#navFromLocationId);
      const toEntry = this.#searchIndex?.find(e => e.id === this.#navToLocationId);
      if (this.#searchNavSummaryFromEl) {
        this.#searchNavSummaryFromEl.textContent = this.#navUsesHereStart
          ? 'Your location'
          : (fromEntry?.title ?? 'From');
      }
      if (this.#searchNavSummaryToEl) {
        this.#searchNavSummaryToEl.textContent = toEntry?.title ?? 'To';
      }
    }
  }

  #isSearchPanelInteraction(event) {
    const path = event.composedPath?.() ?? [];
    if (path.length) {
      return path.includes(this.#searchPanelEl);
    }

    const target = event.target;
    return target instanceof Node && Boolean(this.#searchPanelEl?.contains(target));
  }

  #handleSearchOutsideInteraction(event) {
    if (this.#searchNavMode) return;
    if (!this.#isSearchResultsVisible()) return;
    if (!(event.target instanceof Node)) return;

    if (event.currentTarget === document) {
      if (event.target === this || this.contains(event.target)) return;
      this.#hideSearchResults();
      return;
    }

    if (this.#isSearchPanelInteraction(event)) return;
    this.#hideSearchResults();
  }

  #buildSearchIndex() {
    if (!this.#engine) return;
    const locations = this.#engine.getLocations?.() ?? [];
    const entries = [];

    for (const location of locations) {
      if (!location) continue;
      // The catalog is already the searchable destination set (placed shops +
      // routable non-connector facilities; unplaced shops and connectors are
      // excluded upstream by LocationStore). Index every Location it yields —
      // identity is the namespaced string id (`shop:<id>` / `unit:<id>`), not a
      // numeric pk, and `kind` carries the source slug, not a SHOP/FACILITY tag.
      const rawTokens = Array.isArray(location.search_tokens)
        ? location.search_tokens
        : (typeof location.search_tokens === 'string' ? [location.search_tokens] : []);
      const title = location.title || location.label || 'Untitled';
      const tokens = [title, ...rawTokens]
        .map((token) => String(token).trim().toLowerCase())
        .filter(Boolean);
      if (!tokens.length) continue;
      entries.push({
        id: location.id,
        title,
        tokens,
        location
      });
    }

    this.#searchIndex = entries;
  }

  #filterSearchResults(query) {
    const normalized = query.trim().toLowerCase();
    const terms = normalized.split(/\s+/).filter(Boolean);
    let results = this.#searchIndex;
    if (terms.length) {
      results = results.filter((entry) =>
        terms.every((term) => entry.tokens.some((token) => token.includes(term)))
      );
    }
    return [...results].sort((a, b) =>
      a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
    );
  }

  #renderSearchResults(results) {
    if (!this.#searchResultsEl) return;
    this.#searchResultsEl.innerHTML = '';

    // Simplified guard: only hide if no results
    if (!results.length) {
      this.#searchResultsEl.hidden = true;
      return;
    }

    // In nav mode, hide results if both fields are filled and overlay is not open
    if (this.#searchNavMode && this.#navActiveField == null && !this.#searchOpen) {
      this.#searchResultsEl.hidden = true;
      return;
    }

    for (const entry of results) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'wayfinder-search-result';
      button.dataset.locationId = String(entry.id);
      button.setAttribute('role', 'option');
      button.textContent = entry.title;
      this.#searchResultsEl.appendChild(button);
    }

    this.#searchResultsEl.hidden = false;
  }

  #handleSearchInput(event) {
    if (!this.#searchInputEl || !this.#searchControlEnabled) return;

    const isInputEvent = event?.type === 'input';
    const isFocusEvent = event?.type === 'focus';

    // Use case 2: If user is typing while a shop is selected, clear the selection
    if (isInputEvent && this.#selectedLocationId != null) {
      this.#clearSearchSelection();
    }

    this.#searchQuery = this.#searchInputEl.value;
    const hasQuery = this.#searchQuery.trim().length > 0;
    // Receiving a `focus` event IS the authoritative signal the input just became
    // focused — don't depend solely on `activeElement` (host shims may not update
    // it synchronously on a dispatched focus). An empty query while focused opens
    // the browse-all listing.
    const isFocused = isFocusEvent
      || this.#shadowRoot?.activeElement === this.#searchInputEl;
    const shouldShow = hasQuery || this.#searchOpen || isFocused;

    if (!shouldShow) {
      this.#renderSearchResults([]);
      this.#updateClearButtonVisibility();
      return;
    }

    // Use case 1: If focused with a selection, show all results (browsing mode)
    if (this.#selectedLocationId != null && isFocusEvent) {
      // Select the text so user can easily type to replace
      this.#searchInputEl.select();
      const results = this.#filterSearchResults(''); // Empty query = all results
      this.#renderSearchResults(results);
      this.#updateClearButtonVisibility();
      return;
    }

    const results = this.#filterSearchResults(this.#searchQuery);
    this.#renderSearchResults(results);
    this.#updateClearButtonVisibility();
  }

  #handleSearchKeydown(event) {
    // Escape key: hide dropdown only, keep info panel visible
    if (event.key === 'Escape') {
      if (this.#isSearchResultsVisible()) {
        this.#hideSearchResults();
        event.preventDefault();
      }
    }
  }

  #handleSearchClick(event) {
    const target = event.target;
    // Duck-typed element guard: a real DOM EventTarget exposes `closest`. We avoid
    // a bare `target instanceof Element` because `Element` is not a guaranteed
    // global in every host (node-env tests / SSR) and would throw a ReferenceError.
    if (!target || typeof target.closest !== 'function') return;
    const button = target.closest('button');
    if (!button || !this.#searchContainerEl?.contains(button)) return;

    const action = button.dataset.action;
    if (action === 'exit-navigation') {
      this.#exitNavigationMode();
      return;
    }
    if (action === 'open-search') {
      this.#openSearchOverlay();
      return;
    }
    if (action === 'close-search') {
      this.#closeSearchOverlay();
      return;
    }
    if (action === 'show-qr') {
      this.#showShareQrModal();
      return;
    }
    if (action === 'clear-search') {
      // Use case 3: Clear everything and show full shop list
      this.clearRoute();
      this.#selectedLocationId = null;
      if (this.#searchContainerEl) {
        this.#searchContainerEl.dataset.selected = 'false';
      }
      if (this.#searchInputEl) {
        this.#searchInputEl.value = '';
      }
      this.#searchQuery = '';
      this.#setSearchInfoExpanded(false);
      this.#setSearchInfoVisible(false);
      this.#updateClearButtonVisibility();

      // Show all results (full shop list)
      this.#searchInputEl?.focus();
      const results = this.#filterSearchResults('');
      this.#renderSearchResults(results);
      return;
    }
    if (action === 'clear-nav-from') {
      if (this.#navUsesHereStart) return;
      // Clear the From field in navigation mode
      if (this.#searchNavFromValueEl) {
        this.#searchNavFromValueEl.value = '';
      }
      this.#navFromLocationId = null;
      this.clearRoute();
      this.#updateNavFieldStates();
      this.#showNavFilteredResults();
      this.#searchNavFromValueEl?.focus();
      return;
    }
    if (action === 'clear-nav-to') {
      // Clear the To field in navigation mode
      if (this.#searchNavToValueEl) {
        this.#searchNavToValueEl.value = '';
      }
      this.#navToLocationId = null;
      this.clearRoute();
      this.#updateNavFieldStates();
      this.#showNavFilteredResults();
      this.#searchNavToValueEl?.focus();
      return;
    }
    if (action === 'resume-search') {
      this.clearRoute();
      this.#openSearchOverlay();
      return;
    }
    if (action === 'expand-search-info') {
      this.#setSearchInfoExpanded(true);
      return;
    }
    if (action === 'collapse-search-info') {
      this.#setSearchInfoExpanded(false);
      return;
    }

    if (action === 'toggle-description') {
      this.#isSearchDescriptionExpanded = !this.#isSearchDescriptionExpanded;
      if (this.#searchInfoEl && this.#searchInfoDescriptionToggleEl) {
        this.#searchInfoEl.dataset.descriptionExpanded = this.#isSearchDescriptionExpanded ? 'true' : 'false';
        this.#searchInfoDescriptionToggleEl.setAttribute('aria-expanded', this.#isSearchDescriptionExpanded ? 'true' : 'false');
        this.#searchInfoDescriptionToggleEl.textContent = this.#isSearchDescriptionExpanded ? 'Read less' : 'Read more';
      }
      return;
    }

    const pagerIndex = button.dataset.pagerIndex;
    if (pagerIndex != null) {
      const index = Number(pagerIndex);
      if (!Number.isFinite(index) || !this.#searchInfoMediaTrackEl) return;
      const width = this.#searchInfoMediaTrackEl.clientWidth || 0;
      this.#searchInfoMediaTrackEl.scrollTo({ left: width * index, behavior: 'smooth' });
      this.#setSearchPagerIndex(index);
      return;
    }

    const locationId = button.dataset.locationId;
    if (locationId) {
      // Location ids are namespaced strings (`shop:<id>` / `unit:<id>`); thread the
      // raw string id through — do NOT coerce to Number (that yields NaN here).
      if (this.#searchNavMode) {
        this.#selectNavLocation(locationId);
      } else {
        const location = this.#engine?.getLocation?.(locationId);
        if (location) {
          this.#selectSearchLocation(location);
        }
      }
    }
  }

  #openSearchOverlay() {
    if (!this.#searchContainerEl) return;
    this.#searchOpen = true;
    this.#searchContainerEl.dataset.open = 'true';

    // In navigation mode, focus the From field; otherwise focus search input
    if (this.#searchNavMode) {
      if (this.#navUsesHereStart) {
        this.#searchNavToValueEl?.focus();
      } else {
        this.#searchNavFromValueEl?.focus();
      }
      // Use navigation-specific results display
      this.#showNavFilteredResults();
    } else {
      this.#searchInputEl?.focus();
      // Use regular search input handler
      this.#handleSearchInput();
    }

    this.#updateNavSummary();
  }

  #closeSearchOverlay() {
    if (!this.#searchContainerEl) return;
    const wasOpen = this.#searchOpen;
    this.#searchOpen = false;
    this.#searchContainerEl.dataset.open = 'false';
    this.#searchInputEl?.blur();

    // Only sync if state actually changed (prevent infinite loop)
    if (wasOpen) {
      this.#syncMobileSearchState();
    }
    this.#updateNavSummary();
  }

  #selectSearchLocation(location) {
    // A user-driven search selection focuses the destination with an animated
    // zoom (the engine switches floors if needed). Pass explicit focus options so
    // the engine receives the selection intent, not a bare id.
    const result = this.focusLocation(location.id, { animate: true });
    if (!result?.success) return;
    this.#selectedLocationId = location.id;

    // Don't set data-selected='true' - keep search input visible
    if (this.#searchContainerEl) {
      this.#searchContainerEl.dataset.selected = 'false';
    }

    // Don't update selected pill text (we're not using the pill anymore)
    // if (this.#searchSelectedText) {
    //   this.#searchSelectedText.textContent = location.title || location.label || 'Selected';
    // }

    // Set input to show the selected shop name
    if (this.#searchInputEl) {
      this.#searchInputEl.value = location.title || location.label || '';
    }

    this.#searchQuery = this.#searchInputEl?.value || '';
    this.#renderSearchResults([]);
    this.#updateSearchInfo(location);
    // Selecting a result IS the focus action: show the info card. (Map focus mode
    // is driven by engine route events; the user's explicit selection is the
    // authoritative trigger for the destination info card.)
    this.#setSearchInfoVisible(true);
    this.#closeSearchOverlay();
    this.#updateClearButtonVisibility();
  }

  #resetSearchSelection() {
    this.#selectedLocationId = null;
    if (this.#searchContainerEl) {
      this.#searchContainerEl.dataset.selected = 'false';
    }
    if (this.#searchSelectedText) {
      this.#searchSelectedText.textContent = '';
    }
    // Clear input text
    if (this.#searchInputEl) {
      this.#searchInputEl.value = '';
    }
    this.#searchQuery = '';
    this.#setSearchInfoExpanded(false);
    this.#setSearchInfoVisible(false);

    // Only close overlay on desktop, not on mobile
    if (!this.#isMobileSearchLayout()) {
      this.#closeSearchOverlay();
    }

    this.#handleSearchInput();
    this.#updateClearButtonVisibility();
  }

  #clearSearchSelection() {
    // Clears the selection and hides info panel without clearing input or closing overlay
    this.#selectedLocationId = null;
    if (this.#searchContainerEl) {
      this.#searchContainerEl.dataset.selected = 'false';
    }
    this.#setSearchInfoExpanded(false);
    this.#setSearchInfoVisible(false);
    this.#updateClearButtonVisibility();
  }

  #updateClearButtonVisibility() {
    // Clear button is now always visible - no need to toggle visibility
  }

  #updateSearchInfo(location) {
    if (!this.#searchInfoEl) return;
    if (!location) {
      this.#setSearchInfoExpanded(false);
      this.#setSearchInfoVisible(false);
      return;
    }

    if (this.#searchInfoTitleEl) {
      this.#searchInfoTitleEl.textContent = location.title || location.label || '';
    }

    if (this.#searchInfoVenueEl) {
      const venue = location.venue ?? '';
      this.#searchInfoVenueEl.textContent = venue;
      this.#searchInfoVenueEl.style.display = venue ? 'block' : 'none';
    }

    const description = location.description ?? '';
    const hasDescription = Boolean(description);

    if (this.#searchInfoDescriptionEl) {
      this.#searchInfoDescriptionEl.textContent = description;
      this.#searchInfoDescriptionEl.style.display = hasDescription ? '' : 'none';
    }

    if (this.#searchInfoDescriptionToggleEl && this.#searchInfoEl) {
      this.#isSearchDescriptionExpanded = false;
      this.#searchInfoEl.dataset.descriptionExpanded = 'false';
      this.#searchInfoDescriptionToggleEl.setAttribute('aria-expanded', 'false');
      this.#searchInfoDescriptionToggleEl.textContent = 'Read more';
      this.#searchInfoDescriptionToggleEl.style.display = hasDescription ? 'inline-flex' : 'none';
    }
    this.#setSearchInfoExpanded(false);

    if (this.#searchInfoLogoImgEl && this.#searchInfoLogoEl) {
      const logoUrl = location.logo ?? '';
      if (logoUrl) {
        this.#searchInfoLogoImgEl.src = logoUrl;
        this.#searchInfoLogoEl.style.display = 'flex';
      } else {
        this.#searchInfoLogoImgEl.removeAttribute('src');
        this.#searchInfoLogoEl.style.display = 'none';
      }
    }

    if (this.#searchInfoMediaEl && this.#searchInfoMediaTrackEl) {
      const rawImages = Array.isArray(location.images) ? location.images : (location.images ? [location.images] : []);
      const imageList = rawImages.filter(Boolean);
      if (!imageList.length) {
        const fallbackUrl = location.image_url ?? '';
        if (fallbackUrl) imageList.push(fallbackUrl);
      }

      this.#searchInfoMediaTrackEl.innerHTML = '';
      if (imageList.length) {
        for (const imageUrl of imageList) {
          const imageEl = document.createElement('img');
          imageEl.src = imageUrl;
          imageEl.alt = '';
          imageEl.setAttribute('aria-hidden', 'true');
          this.#searchInfoMediaTrackEl.appendChild(imageEl);
        }
        this.#searchInfoMediaEl.style.display = 'block';
        this.#searchInfoMediaTrackEl.scrollTo({ left: 0, behavior: 'auto' });
        this.#renderSearchPager(imageList.length);
        if (!this.#searchInfoMediaScrollHandler) {
          this.#searchInfoMediaScrollHandler = () => this.#updateSearchPagerFromScroll();
          this.#searchInfoMediaTrackEl.addEventListener('scroll', this.#searchInfoMediaScrollHandler, { passive: true });
        }
      } else {
        this.#searchInfoMediaEl.style.display = 'none';
        this.#renderSearchPager(0);
      }
    }

    this.#updateLevelSelectorMaxHeight();
  }

  #renderSearchPager(count) {
    if (!this.#searchInfoPagerEl) return;
    this.#searchInfoPagerButtons = [];
    this.#searchInfoPagerEl.innerHTML = '';
    if (count <= 1) {
      this.#searchInfoPagerEl.style.display = 'none';
      return;
    }

    this.#searchInfoPagerEl.style.display = 'flex';
    for (let i = 0; i < count; i += 1) {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'wayfinder-search-info-pager-dot';
      dot.dataset.pagerIndex = String(i);
      dot.dataset.active = i === 0 ? 'true' : 'false';
      dot.setAttribute('aria-label', `Image ${i + 1}`);
      this.#searchInfoPagerEl.appendChild(dot);
      this.#searchInfoPagerButtons.push(dot);
    }
  }

  #setSearchPagerIndex(index) {
    if (!this.#searchInfoPagerButtons.length) return;
    const clamped = Math.max(0, Math.min(index, this.#searchInfoPagerButtons.length - 1));
    this.#searchInfoPagerButtons.forEach((button, i) => {
      button.dataset.active = i === clamped ? 'true' : 'false';
    });
  }

  #updateSearchPagerFromScroll() {
    if (!this.#searchInfoMediaTrackEl || !this.#searchInfoPagerButtons.length) return;
    const width = this.#searchInfoMediaTrackEl.clientWidth || 1;
    const index = Math.round(this.#searchInfoMediaTrackEl.scrollLeft / width);
    this.#setSearchPagerIndex(index);
  }

  #setSearchInfoVisible(visible) {
    if (!this.#searchInfoEl) return;
    this.#searchInfoEl.dataset.visible = visible ? 'true' : 'false';
    if (!visible) {
      this.#setSearchInfoExpanded(false);
    }
    this.#updateLevelSelectorMaxHeight();
  }

  #setSearchInfoExpanded(expanded) {
    // Only allow expansion on mobile
    const isMobile = this.#isMobileSearchLayout();
    if (!isMobile && expanded) {
      return;  // Desktop doesn't use expanded state
    }

    this.#isSearchInfoExpanded = Boolean(expanded);

    if (this.#searchInfoEl) {
      this.#searchInfoEl.dataset.mobileExpanded = this.#isSearchInfoExpanded ? 'true' : 'false';
    }

    if (this.#searchInfoExpandButton && this.#searchInfoExpandIconEl) {
      if (this.#isSearchInfoExpanded) {
        this.#searchInfoExpandButton.dataset.action = 'collapse-search-info';
        this.#searchInfoExpandButton.setAttribute('aria-label', 'Collapse panel');
      } else {
        this.#searchInfoExpandButton.dataset.action = 'expand-search-info';
        this.#searchInfoExpandButton.setAttribute('aria-label', 'Expand panel');
      }
      const nextKey = this.#isSearchInfoExpanded ? 'collapse' : 'expand';
      this.#searchInfoExpandIconEl.dataset.wayfinderIcon = nextKey;
      this.#searchInfoExpandIconEl.dataset.wayfinderIconBaseSrc = this.#icons[nextKey];
      this.#searchInfoExpandIconEl.src = this.#icons[nextKey];
      this.#applyControlIconColorState();
    }

    this.#updateLevelSelectorMaxHeight();
  }

  #bindLocateControls() {
    if (!this.#engine || !this.#locateControlsEl || this.#locateClickHandler) return;
    this.#locateClickHandler = (event) => this.#handleLocateClick(event);
    this.#locateControlsEl.addEventListener('click', this.#locateClickHandler);

    if (!this.#locateUnsubRouteFound) {
      this.#locateUnsubRouteFound = this.#engine.on('route:found', (detail) => {
      this.#startLocationId = detail?.startLocation?.id ?? null;
      this.#endLocationId = detail?.endLocation?.id ?? null;
      this.#startNode = detail?.startNode ?? null;
      this.#endNode = detail?.endNode ?? null;
      this.#focusedLocationId = null;
      this.#focusedNode = null;
      this.#setMapMode('navigation');
      });
    }

    if (!this.#locateUnsubRouteCleared) {
      this.#locateUnsubRouteCleared = this.#engine.on('route:cleared', () => {
        if (this.#mapMode === 'navigation') {
          this.#setMapMode('browse');
        }
        this.#startLocationId = null;
        this.#endLocationId = null;
        this.#startNode = null;
        this.#endNode = null;
      });
    }
  }

  #unbindLocateControls() {
    if (this.#locateClickHandler && this.#locateControlsEl) {
      this.#locateControlsEl.removeEventListener('click', this.#locateClickHandler);
      this.#locateClickHandler = null;
    }
    if (this.#locateUnsubRouteFound) {
      this.#locateUnsubRouteFound();
      this.#locateUnsubRouteFound = null;
    }
    if (this.#locateUnsubRouteCleared) {
      this.#locateUnsubRouteCleared();
      this.#locateUnsubRouteCleared = null;
    }
  }

  #handleLocateClick(event) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest('button');
    if (!button || !this.#locateControlsEl?.contains(button)) return;
    const action = button.dataset.action;
    if (action === 'locate-here') {
      this.#engine?.centerOnYouAreHere?.({
        animate: true,
        duration: 700,
        scale: 3
      });
    } else if (action === 'locate-start') {
      this.#centerOnTarget(this.#startNode, this.#startLocationId);
    } else if (action === 'locate-focus') {
      if (this.#mapMode === 'focus' && this.#focusedLocationId != null) {
        this.#centerOnTarget(this.#focusedNode, this.#focusedLocationId);
      } else if (this.#mapMode === 'navigation' && this.#endLocationId != null) {
        this.#centerOnTarget(this.#endNode, this.#endLocationId);
      }
    } else if (action === 'nav-connector-lift') {
      const next = this.#navConnectorConstraint === 'lift-only' ? null : 'lift-only';
      this.#setNavConnectorConstraint(next, { reroute: true });
    } else if (action === 'nav-connector-escalator') {
      const next = this.#navConnectorConstraint === 'escalator-only' ? null : 'escalator-only';
      this.#setNavConnectorConstraint(next, { reroute: true });
    }
  }

  #setMapMode(mode) {
    this.#mapMode = mode;
    this.#updateLocateControls();
    this.#updateSearchMode();
    this.#syncMobileSearchState();
  }

  #updateLocateControls() {
    if (!this.#locateControlsEl) return;
    this.#locateControlsEl.dataset.mode = this.#mapMode;
    this.#locateControlsEl.dataset.hasHere = this.#engine?.hasYouAreHere?.() ? 'true' : 'false';
  }

  #setNavConnectorConstraint(constraint, { reroute = false } = {}) {
    this.#navConnectorConstraint = constraint === 'lift-only' || constraint === 'escalator-only'
      ? constraint
      : null;
    this.#updateNavConnectorButtons();

    if (reroute) {
      this.#rerouteWithActiveNavigationState();
    }
  }

  #updateNavConnectorButtons() {
    if (this.#locateLiftButton) {
      this.#locateLiftButton.dataset.active = this.#navConnectorConstraint === 'lift-only' ? 'true' : 'false';
    }
    if (this.#locateEscalatorButton) {
      this.#locateEscalatorButton.dataset.active = this.#navConnectorConstraint === 'escalator-only' ? 'true' : 'false';
    }
    this.#applyControlIconColorState();
  }

  #rerouteWithActiveNavigationState() {
    if (this.#mapMode !== 'navigation') return;

    if (this.#navUsesHereStart) {
      if (this.#navToLocationId) this.#triggerNavigation();
      return;
    }

    const from = this.#navFromLocationId ?? this.#startLocationId;
    const to = this.#navToLocationId ?? this.#endLocationId;
    if (!from || !to) return;

    if (this.#navFromLocationId == null) this.#navFromLocationId = from;
    if (this.#navToLocationId == null) this.#navToLocationId = to;

    this.#triggerNavigation();
  }

  #updateSearchMode() {
    if (!this.#searchControlEnabled) return;
    if (this.#searchContainerEl) {
      this.#searchContainerEl.dataset.mode = this.#mapMode;
    }
    const showInfo = this.#selectedLocationId != null && this.#mapMode === 'focus';
    this.#setSearchInfoVisible(showInfo);
    // Removed redundant mobile close logic - now handled by #syncMobileSearchState()
  }

  #pickLocationNode(location) {
    if (!location?.nodes?.length) return null;
    const currentFloor = this.#engine?.getCurrentFloor?.();
    const onCurrent = currentFloor
      ? location.nodes.find((n) => n.level?.code === currentFloor)
      : null;
    return onCurrent || location.nodes[0] || null;
  }

  #centerOnTarget(node, locationId) {
    if (!this.#engine) return;
    let targetNode = node;
    if (!targetNode && locationId != null) {
      const location = this.#engine.getLocation?.(locationId);
      if (!location) return;
      targetNode = this.#pickLocationNode(location);
    }
    if (!targetNode?.point) return;

    const floorCode = targetNode.level?.code;
    const currentFloor = this.#engine.getCurrentFloor?.();
    if (floorCode && floorCode !== currentFloor) {
      // centerOn pans to the target below; skip the floor-switch refit.
      this.#engine.setFloor(floorCode, { fitToBounds: false });
    }

    const maxScale = this.#engine?.getConfigValue?.('maxZoom');
    const safeMaxScale = Number.isFinite(maxScale) ? maxScale : 3;
    const targetScale = Math.min(safeMaxScale, 3);

    this.#engine.centerOn(targetNode.point.x, targetNode.point.y, {
      animate: true,
      duration: 600,
      scale: targetScale
    });
  }

  #resolveHereStartLocationId() {
    if (!this.#engine?.hasYouAreHere?.()) return null;
    const startId = this.#engine.getYouAreHereStartLocationId?.();
    return Number.isFinite(startId) ? startId : null;
  }

  #applyHereStartNavUiState() {
    if (this.#searchNavFromIconEl) {
      const key = this.#navUsesHereStart ? 'stand' : 'walk';
      this.#searchNavFromIconEl.dataset.wayfinderIcon = key;
      this.#searchNavFromIconEl.dataset.wayfinderIconBaseSrc = this.#icons[key];
      this.#searchNavFromIconEl.src = this.#icons[key];
      this.#applyControlIconColorState();
    }
    if (this.#searchNavFromFieldEl) {
      this.#searchNavFromFieldEl.dataset.locked = this.#navUsesHereStart ? 'true' : 'false';
    }
    if (this.#searchNavFromValueEl) {
      this.#searchNavFromValueEl.readOnly = this.#navUsesHereStart;
      this.#searchNavFromValueEl.setAttribute('aria-readonly', this.#navUsesHereStart ? 'true' : 'false');
    }
    if (this.#searchNavFromClearButton) {
      this.#searchNavFromClearButton.disabled = this.#navUsesHereStart;
      this.#searchNavFromClearButton.setAttribute('aria-hidden', this.#navUsesHereStart ? 'true' : 'false');
    }
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('wayfinder-map')) {
  customElements.define('wayfinder-map', WayfinderMapElement);
}

export { WayfinderMapElement };
