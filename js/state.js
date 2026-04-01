/**
 * state.js — Centralized application state, color config, and business logic helpers.
 * Rewritten for flat master JSON with 5 statuses: covered, covered new, potential, prospect, excluded.
 */

// ==================== Active Data ====================
export var activeData = null;
export var _usingPersistedData = false;
export var _savedStateLoaded = false;
export var _savedUploadedAt = null;

export function setActiveData(d) { activeData = d; }
export function getActiveData() { return activeData; }
export function setUsingPersistedData(v) { _usingPersistedData = v; }
export function getUsingPersistedData() { return _usingPersistedData; }
export function setSavedStateLoaded(v) { _savedStateLoaded = v; }
export function setSavedUploadedAt(v) { _savedUploadedAt = v; }
export function getSavedUploadedAt() { return _savedUploadedAt; }

// ==================== State ====================
export var state = {
  colorMode: "coverage",
  filterManagers: [],       // multi-select array, [] = all
  filterTerritory: "",      // single select, "" = all
  filterStatus: "",         // single select, "" = all
  filterSearch: "",         // ZIP/city search query
  selectedZips: {},
  excludedZips: {},         // user-driven overrides (persisted)
  identifiedZips: {},       // ZIPs where new target accounts were found via ZEFIX
  geoLayer: null,
  markerLayer: null,
  territoryBorderLayer: null,
  map: null,
  zipDataMap: {},
  topoFeatures: [],
  topoFeaturesById: {},
  searchMatchedZips: {},
  zefixResults: [],
  zefixChecked: [],
  undoStack: [],
  anomalyMarkerLayer: null,
  nonMapZips: {},
};

// ==================== Color Helpers ====================
// 5 statuses from master + 2 user-driven overlays
export var coverageColors = {
  covered: "#16a34a",         // green
  "covered new": "#2563eb",   // blue
  potential: "#f59e0b",       // amber
  prospect: "#d946ef",        // fuchsia/purple
  excluded: "#56555a",        // gray
  identified: "#10b981",      // emerald (user override)
  unmatched: "#cbd5e1",       // light gray (no data)
};

// ==================== Effective Status ====================
// Priority: user override (excluded/identified) > master status
export function getEffectiveStatus(entry) {
  if (!entry) return "unmatched";
  if (state.excludedZips[entry.postcode]) return "excluded";
  if (state.identifiedZips[entry.postcode]) return "identified";
  return entry.status || "unmatched";
}

export function getZipColor(entry) {
  var data = getActiveData();
  if (!entry) return coverageColors.unmatched;

  var eff = getEffectiveStatus(entry);

  if (state.colorMode === "coverage") {
    if (eff === "excluded") return coverageColors.excluded;
    if (eff === "identified") return coverageColors.identified;
    return coverageColors[eff] || coverageColors.potential;
  }
  if (state.colorMode === "manager") {
    if (eff === "excluded") return coverageColors.excluded;
    if (eff === "identified") return coverageColors.identified;
    return data.manager_colors[entry.account_manager] || "#cbd5e1";
  }
  if (state.colorMode === "territory") {
    if (eff === "excluded") return coverageColors.excluded;
    if (eff === "identified") return coverageColors.identified;
    return data.territory_colors[entry.territory_id] || "#cbd5e1";
  }
  return "#cbd5e1";
}

export function hasActiveFilters() {
  return state.filterManagers.length > 0 || state.filterTerritory !== "" || state.filterStatus !== "";
}

export function isFiltered(entry) {
  if (!entry) return true;

  var eff = getEffectiveStatus(entry);

  // Manager filter (multi-select)
  if (state.filterManagers.length > 0) {
    var managerFound = false;
    for (var mi = 0; mi < state.filterManagers.length; mi++) {
      if (entry.account_manager === state.filterManagers[mi]) {
        managerFound = true;
        break;
      }
    }
    if (!managerFound) return true;
  }

  // Territory filter (single select)
  if (state.filterTerritory && entry.territory_id !== state.filterTerritory) {
    return true;
  }

  // Status filter (single select)
  if (state.filterStatus) {
    if (eff !== state.filterStatus) return true;
  }

  return false;
}

// ==================== Build ZIP Data Map ====================
export function buildZipDataMap() {
  var data = getActiveData();
  if (!data) return;
  state.zipDataMap = {};
  data.merged.forEach(function (entry) {
    state.zipDataMap[entry.postcode] = entry;
  });
}

// ==================== Build Non-Map ZIP Set ====================
// Call AFTER loadBoundaries() so topoFeaturesById is populated
export function buildNonMapZips() {
  state.nonMapZips = {};
  var allDataZips = Object.keys(state.zipDataMap);
  for (var i = 0; i < allDataZips.length; i++) {
    if (!state.topoFeaturesById[allDataZips[i]]) {
      state.nonMapZips[allDataZips[i]] = true;
    }
  }
}

// ==================== ZEFIX Column Config ====================
// Centralized column ordering for ZEFIX export/table. Change here to reorder everywhere.
export var ZEFIX_COLUMNS = [
  { key: "legalName", label: "Legal Name", csvHeader: "Legal_Name" },
  { key: "purpose", label: "Purpose", csvHeader: "Purpose" },
  { key: "postalCode", label: "ZIP", csvHeader: "ZIP" },
  { key: "locality", label: "Locality", csvHeader: "Locality" },
  { key: "uid", label: "UID", csvHeader: "UID" },
  { key: "org", label: "ZEFIX URI", csvHeader: "ZEFIX_URI", isLink: true },
];
