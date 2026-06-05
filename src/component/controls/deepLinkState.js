const SHARE_VERSION = 1;
const MODE_FOCUS = 'focus';
const MODE_NAVIGATION = 'navigation';
const ROUTE_MODE_ESCALATOR = 'escalator';
const ROUTE_MODE_LIFT = 'lift';
const NAV_FIELD_FROM = 'from';
const NAV_FIELD_TO = 'to';

function parseFiniteNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseInteger(value) {
  const parsed = parseFiniteNumber(value);
  if (parsed == null) return null;
  const integer = Math.trunc(parsed);
  return integer > 0 ? integer : null;
}

function parseBoolean(value) {
  return typeof value === 'boolean' ? value : null;
}

function normalizeFloorCode(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeRouteMode(value) {
  return value === ROUTE_MODE_LIFT || value === ROUTE_MODE_ESCALATOR ? value : null;
}

function normalizeText(value) {
  if (typeof value !== 'string') return null;
  if (value.length > 512) {
    return value.slice(0, 512);
  }
  return value;
}

function normalizeNavActiveField(value) {
  return value === NAV_FIELD_FROM || value === NAV_FIELD_TO ? value : null;
}

function roundViewValue(value) {
  return Math.round(value * 10000) / 10000;
}

function normalizeViewState(viewState) {
  if (!viewState || typeof viewState !== 'object') return null;
  const scale = parseFiniteNumber(viewState.scale ?? viewState.s);
  const panX = parseFiniteNumber(viewState.panX ?? viewState.x);
  const panY = parseFiniteNumber(viewState.panY ?? viewState.y);
  const rotation = parseFiniteNumber(viewState.rotation ?? viewState.r);
  if (scale == null || panX == null || panY == null || rotation == null) return null;

  return {
    s: roundViewValue(scale),
    x: roundViewValue(panX),
    y: roundViewValue(panY),
    r: roundViewValue(rotation)
  };
}

function normalizeSearchUiState(uiState) {
  if (!uiState || typeof uiState !== 'object') return null;

  const normalized = {};

  const searchOpen = parseBoolean(uiState.searchOpen);
  if (searchOpen != null) normalized.searchOpen = searchOpen;

  const searchQuery = normalizeText(uiState.searchQuery);
  if (searchQuery != null) normalized.searchQuery = searchQuery;

  const selectedLocationId = parseInteger(uiState.selectedLocationId);
  if (selectedLocationId != null) normalized.selectedLocationId = selectedLocationId;

  const infoExpanded = parseBoolean(uiState.infoExpanded);
  if (infoExpanded != null) normalized.infoExpanded = infoExpanded;

  const descriptionExpanded = parseBoolean(uiState.descriptionExpanded);
  if (descriptionExpanded != null) normalized.descriptionExpanded = descriptionExpanded;

  const searchNavMode = parseBoolean(uiState.searchNavMode);
  if (searchNavMode != null) normalized.searchNavMode = searchNavMode;

  const navActiveField = normalizeNavActiveField(uiState.navActiveField);
  if (navActiveField != null) normalized.navActiveField = navActiveField;

  const navFromLocationId = parseInteger(uiState.navFromLocationId);
  if (navFromLocationId != null) normalized.navFromLocationId = navFromLocationId;

  const navToLocationId = parseInteger(uiState.navToLocationId);
  if (navToLocationId != null) normalized.navToLocationId = navToLocationId;

  const navFromText = normalizeText(uiState.navFromText);
  if (navFromText != null) normalized.navFromText = navFromText;

  const navToText = normalizeText(uiState.navToText);
  if (navToText != null) normalized.navToText = navToText;

  return Object.keys(normalized).length ? normalized : null;
}

function sanitizeShareState(state) {
  if (!state || typeof state !== 'object') return null;

  const mode = state.m;
  if (mode !== MODE_FOCUS && mode !== MODE_NAVIGATION) return null;

  const sanitized = {
    v: SHARE_VERSION,
    m: mode
  };

  const floorCode = normalizeFloorCode(state.f);
  if (floorCode) sanitized.f = floorCode;

  const routeMode = normalizeRouteMode(state.rm);
  if (routeMode) sanitized.rm = routeMode;

  const view = normalizeViewState(state.view);
  if (view) sanitized.view = view;

  const ui = normalizeSearchUiState(state.ui);
  if (ui) sanitized.ui = ui;

  if (mode === MODE_FOCUS) {
    const focusId = parseInteger(state.focus);
    if (focusId == null) return null;
    sanitized.focus = focusId;
  } else if (mode === MODE_NAVIGATION) {
    const fromId = parseInteger(state.from);
    const toId = parseInteger(state.to);
    if (fromId == null || toId == null) return null;
    sanitized.from = fromId;
    sanitized.to = toId;
  }

  return sanitized;
}

function encodeBase64Url(text) {
  if (typeof globalThis !== 'undefined' && typeof globalThis.Buffer !== 'undefined') {
    return globalThis.Buffer.from(text, 'utf8').toString('base64url');
  }

  if (typeof btoa === 'function') {
    const utf8 = unescape(encodeURIComponent(text));
    return btoa(utf8).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  throw new Error('No base64 encoder available');
}

function decodeBase64Url(value) {
  if (typeof globalThis !== 'undefined' && typeof globalThis.Buffer !== 'undefined') {
    return globalThis.Buffer.from(value, 'base64url').toString('utf8');
  }

  if (typeof atob === 'function') {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padLength = (4 - (normalized.length % 4)) % 4;
    const padded = `${normalized}${'='.repeat(padLength)}`;
    const binary = atob(padded);
    return decodeURIComponent(escape(binary));
  }

  throw new Error('No base64 decoder available');
}

export function captureMapShareState({
  mode,
  currentFloor,
  routeMode,
  focusedLocationId,
  startLocationId,
  endLocationId,
  viewState,
  searchUiState
}) {
  if (mode !== MODE_FOCUS && mode !== MODE_NAVIGATION) return null;

  const candidate = {
    v: SHARE_VERSION,
    m: mode,
    f: currentFloor,
    rm: routeMode,
    view: normalizeViewState(viewState),
    ui: normalizeSearchUiState(searchUiState)
  };

  if (mode === MODE_FOCUS) {
    candidate.focus = focusedLocationId;
  }

  if (mode === MODE_NAVIGATION) {
    candidate.from = startLocationId;
    candidate.to = endLocationId;
  }

  return sanitizeShareState(candidate);
}

export function encodeMapShareState(state) {
  const normalized = sanitizeShareState(state);
  if (!normalized) return null;

  return encodeBase64Url(JSON.stringify(normalized));
}

export function decodeMapShareState(value) {
  if (typeof value !== 'string' || !value.trim()) return null;

  try {
    const decoded = decodeBase64Url(value.trim());
    const parsed = JSON.parse(decoded);
    return sanitizeShareState(parsed);
  } catch {
    return null;
  }
}

export function buildShareUrl(currentHref, state) {
  const encoded = encodeMapShareState(state);
  if (!encoded) return null;

  const currentUrl = new URL(currentHref, typeof window !== 'undefined' ? window.location.href : 'http://localhost/');
  const canonical = new URL(currentUrl.pathname, currentUrl.origin);
  canonical.search = `wf=${encoded}`;
  return canonical.toString();
}

export function parseShareUrl(currentHref) {
  try {
    const url = new URL(currentHref, typeof window !== 'undefined' ? window.location.href : 'http://localhost/');
    const encoded = url.searchParams.get('wf');
    if (!encoded) return null;
    return decodeMapShareState(encoded);
  } catch {
    return null;
  }
}
