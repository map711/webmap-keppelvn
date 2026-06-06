const CONFIG_SCHEMA = {
  // Data source: the single self-contained webmap bundle URL (required).
  dataUrl: { type: 'string', required: true },
  // Legacy geometry URL — no longer fetched (the bundle is self-contained).
  // Accepted for backward-compatible config but optional and unused.
  mapUrl: { type: 'string', required: false },

  // Rendering
  // The bundle authors all geometry — unit polygons, navmesh, label points — in
  // one raw world-coordinate space, so the catalog must NOT be rescaled relative
  // to the mesh (default 1 = identity). A non-1 default (a holdover from the
  // forked shell's normalized coords) throws labels/pins/focus anchors into a
  // different space than the floor, so focusing a shop pans the camera off the
  // mesh and the floor renders blank. Hosts whose data IS normalized can still
  // override via the `render-scale` attribute.
  renderScale: { type: 'number', default: 1, responsive: true },
  maxZoom: { type: 'number', default: 2.5, responsive: true },
  minZoom: { type: 'number|string', default: 'fit', responsive: true },
  labelFontSize: { type: 'number', default: 5, responsive: true },
  labelMinFontSize: { type: 'number', default: 5, responsive: true },
  mapLabelFontFamily: { type: 'string', default: null },
  mapLabelFontColor: { type: 'string', default: null },
  mapLabelBackgroundColor: { type: 'string', default: null },
  controlFgColor: { type: 'string', default: null },
  controlBgColor: { type: 'string', default: null },
  controlActiveFgColor: { type: 'string', default: null },
  controlActiveBgColor: { type: 'string', default: null },
  mapMarkerStartFgColor: { type: 'string', default: null },
  mapMarkerStartBgColor: { type: 'string', default: null },
  mapMarkerEndFgColor: { type: 'string', default: null },
  mapMarkerEndBgColor: { type: 'string', default: null },
  mapMarkerConnectorFgColor: { type: 'string', default: null },
  mapMarkerConnectorBgColor: { type: 'string', default: null },
  iconWalk: { type: 'string', default: null },
  iconStand: { type: 'string', default: null },
  iconPin: { type: 'string', default: null },
  iconWheelchair: { type: 'string', default: null },
  iconEscalator: { type: 'string', default: null },
  enableRotation: { type: 'boolean', default: true },

  // Navigation
  defaultFloor: { type: 'string', default: null },
  youAreHereNodeId: { type: 'number', default: null },
  focusNodeId: { type: 'number', default: null },
  routeMode: { type: 'string', default: 'escalator', enum: ['escalator', 'lift'] },

  // Locale
  locale: { type: 'string', default: 'en' },

  // Debug
  debug: { type: 'boolean', default: false },
  showFps: { type: 'boolean', default: false }
};

/**
 * Configuration validation and defaults.
 */
export class Config {
  #values;

  /**
   * @param {Object} userConfig
   */
  constructor(userConfig = {}) {
    const defaults = Config.defaults();
    const merged = { ...defaults, ...userConfig };
    this.#values = Config.#resolveResponsiveValues(merged, defaults);
    this.validate();
  }

  /**
   * Get a config value.
   * @param {string} key
   * @returns {any}
   */
  get(key) {
    return this.#values[key];
  }

  /**
   * Get a shallow copy of all config values.
   * @returns {Object}
   */
  getAll() {
    return { ...this.#values };
  }

  /**
   * Validate configuration against schema.
   * @throws {Error} when invalid
   */
  validate() {
    for (const [key, schema] of Object.entries(CONFIG_SCHEMA)) {
      const value = this.#values[key];

      if (schema.required && (value === undefined || value === null)) {
        throw new Error(`Config: "${key}" is required`);
      }

      if (value === undefined || value === null) {
        continue;
      }

      if (schema.type && !this.#isType(value, schema.type)) {
        throw new Error(`Config: "${key}" must be of type ${schema.type}`);
      }

      if (schema.enum && !schema.enum.includes(value)) {
        throw new Error(`Config: "${key}" must be one of: ${schema.enum.join(', ')}`);
      }
    }
  }

  /**
   * Get default config values.
   * @returns {Object}
   */
  static defaults() {
    const defaults = {};
    for (const [key, schema] of Object.entries(CONFIG_SCHEMA)) {
      if (Object.prototype.hasOwnProperty.call(schema, 'default')) {
        defaults[key] = schema.default;
      }
    }
    return defaults;
  }

  static #resolveResponsiveValues(values, defaults) {
    const resolved = { ...values };
    const device = Config.#getDeviceMode();

    for (const [key, schema] of Object.entries(CONFIG_SCHEMA)) {
      if (!schema.responsive) continue;
      const value = resolved[key];
      if (!Config.#isResponsiveObject(value)) continue;

      const picked = value[device] ?? value.desktop ?? value.mobile;
      resolved[key] = picked ?? defaults[key];
    }

    return resolved;
  }

  static #getDeviceMode() {
    if (typeof window === 'undefined') return 'desktop';

    const matchMedia = window.matchMedia?.bind(window);
    const isNarrow = matchMedia?.('(max-width: 768px)')?.matches ?? false;
    const isCoarse = matchMedia?.('(pointer: coarse)')?.matches ?? false;
    const hasTouch = (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0);

    return (isNarrow || isCoarse || hasTouch) ? 'mobile' : 'desktop';
  }

  static #isResponsiveObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    return Object.prototype.hasOwnProperty.call(value, 'mobile')
      || Object.prototype.hasOwnProperty.call(value, 'desktop');
  }

  #isType(value, typeSpec) {
    if (typeSpec.includes('|')) {
      return typeSpec.split('|').some((type) => this.#isType(value, type));
    }

    if (typeSpec === 'array') {
      return Array.isArray(value);
    }

    return typeof value === typeSpec;
  }
}

export { CONFIG_SCHEMA };
