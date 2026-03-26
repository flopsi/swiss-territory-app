/**
 * state.js — Centralized application state, color config, and business logic helpers.
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
  filterTerritory: "",      // single select (v1 style), "" = all
  filterStatus: "",         // single select (v1 style), "" = all
  filterSearch: "",         // ZIP/city search query
  selectedZips: {},
  excludedZips: {},
  identifiedZips: {},       // ZIPs where new target accounts were found via ZEFIX
  geoLayer: null,
  markerLayer: null,
  territoryBorderLayer: null,
  map: null,
  zipDataMap: {},
  anomalyZips: {},
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
export var coverageColors = {
  covered: "#16a34a",
  potential: "#f59e0b",
  exception: "#dc2626",
  anomaly: "#dc2626",  // alias kept for backward compat
  excluded: "#56555a",
  identified: "#d946ef",  // Fuchsia for processed ZIPs with new target accounts
  unmatched: "#cbd5e1",
};

// ==================== Business Exceptions ====================
// Philip Morris is handled country-wide by Daniel Grenno irrespective of ZIP.
export var EXCEPTION_RULES = [
  {
    id: "philip_morris_grenno",
    label: "Philip Morris – country-wide (Daniel Grenno)",
    reason: "Philip Morris accounts are managed country-wide by Daniel Grenno, regardless of ZIP assignment.",
    category: "Country-wide coverage",
    match: function (entry) {
      if (!entry || !entry.sfdc_accounts) return false;
      return entry.sfdc_accounts.some(function (a) {
        return /philip\s*morris/i.test(a.name);
      });
    },
  },
];

export function getExceptionInfo(entry) {
  for (var i = 0; i < EXCEPTION_RULES.length; i++) {
    if (EXCEPTION_RULES[i].match(entry)) return EXCEPTION_RULES[i];
  }
  return null;
}

export function getEffectiveStatus(entry) {
  if (!entry) return "unmatched";
  if (state.excludedZips[entry.postcode]) return "excluded";
  if (state.identifiedZips[entry.postcode]) return "identified";
  if (entry._anomaly) return "exception";
  return entry.status;
}

export function getZipColor(entry) {
  var data = getActiveData();
  if (!entry) return coverageColors.unmatched;

  var eff = getEffectiveStatus(entry);

  if (state.colorMode === "coverage") {
    if (eff === "excluded") return coverageColors.excluded;
    if (eff === "identified") return coverageColors.identified;
    if (eff === "exception") return coverageColors.exception;
    return eff === "covered" ? coverageColors.covered : coverageColors.potential;
  }
  if (state.colorMode === "manager") {
    if (eff === "excluded") return coverageColors.excluded;
    if (eff === "identified") return coverageColors.identified;
    if (eff === "exception") return coverageColors.exception;
    return data.manager_colors[entry.account_manager] || "#cbd5e1";
  }
  if (state.colorMode === "territory") {
    if (eff === "excluded") return coverageColors.excluded;
    if (eff === "identified") return coverageColors.identified;
    if (eff === "exception") return coverageColors.exception;
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
    for (var mi2 = 0; mi2 < state.filterManagers.length; mi2++) {
      if (entry.account_manager === state.filterManagers[mi2]) {
        managerFound = true;
        break;
      }
    }
    if (!managerFound && entry._anomaly) {
      for (var mi = 0; mi < (entry.sfdc_managers || []).length; mi++) {
        for (var mi3 = 0; mi3 < state.filterManagers.length; mi3++) {
          if (entry.sfdc_managers[mi] === state.filterManagers[mi3]) {
            managerFound = true;
            break;
          }
        }
        if (managerFound) break;
      }
    }
    if (!managerFound) return true;
  }

  // Territory filter (single select)
  if (state.filterTerritory && entry.territory_id !== state.filterTerritory) {
    if (entry._anomaly) {
      var terrMatch = false;
      for (var ti = 0; ti < (entry.sfdc_territories || []).length; ti++) {
        if (entry.sfdc_territories[ti] === state.filterTerritory) {
          terrMatch = true;
          break;
        }
      }
      if (!terrMatch) return true;
    } else {
      return true;
    }
  }

  // Status filter (single select) — map legacy "anomaly" filter value to "exception"
  if (state.filterStatus) {
    var filterEff = state.filterStatus === "anomaly" ? "exception" : state.filterStatus;
    if (eff !== filterEff) return true;
  }

  return false;
}

// ==================== Build ZIP Data Map ====================
export function buildZipDataMap() {
  var data = getActiveData();
  if (!data) return;
  data.merged.forEach(function (entry) {
    state.zipDataMap[entry.postcode] = entry;
  });
  data.sfdc_only.forEach(function (row) {
    state.anomalyZips[row.postcode] = true;
    if (!state.zipDataMap[row.postcode]) {
      state.zipDataMap[row.postcode] = {
        postcode: row.postcode,
        territory_id: (row.sfdc_territories && row.sfdc_territories[0]) || "",
        account_manager: (row.sfdc_managers && row.sfdc_managers[0]) || "",
        official_city: row.official_city || "",
        canton: row.canton || "",
        in_sfdc: true,
        sfdc_account_count: row.sfdc_account_count,
        sfdc_accounts: row.sfdc_accounts,
        sfdc_managers: row.sfdc_managers,
        sfdc_territories: row.sfdc_territories,
        status: "exception",
        _anomaly: true,
      };
    } else {
      if (!state.zipDataMap[row.postcode].official_city && row.official_city) {
        state.zipDataMap[row.postcode].official_city = row.official_city;
      }
      if (!state.zipDataMap[row.postcode].canton && row.canton) {
        state.zipDataMap[row.postcode].canton = row.canton;
      }
    }
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
