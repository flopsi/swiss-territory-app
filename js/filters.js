/**
 * filters.js — Filter controls, stats, legend, AM buttons.
 * Rewritten for flat master JSON with 5 statuses.
 */

import {
  state, getActiveData, getEffectiveStatus,
  hasActiveFilters, isFiltered, coverageColors,
} from "./state.js";
import { escapeHTML, animateNumber } from "./utils.js";
import { refreshStyles, renderTerritoryBorders } from "./map.js";

// Strip diacritics for fuzzy city search (Zürich → Zurich, Genève → Geneve)
function _stripDiacritics(str) {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// ==================== Populate Selects ====================
export function populateSelects() {
  var data = getActiveData();

  // Manager multi-select
  var managerSelect = document.getElementById("filterManager");
  data.managers.forEach(function (m) {
    var opt = document.createElement("option");
    opt.value = m;
    opt.textContent = m;
    managerSelect.appendChild(opt);
  });

  // Territory select
  var territorySelect = document.getElementById("filterTerritory");
  data.territories.forEach(function (t) {
    var opt = document.createElement("option");
    opt.value = t;
    opt.textContent = t.replace("CMD_EMEA_CH_AM_", "AM ");
    territorySelect.appendChild(opt);
  });

  // Status select — all 5 master statuses + identified (user override)
  var statusSelect = document.getElementById("filterStatus");
  var statuses = [
    { value: "covered", label: "Covered" },
    { value: "covered new", label: "Covered New" },
    { value: "potential", label: "Potential" },
    { value: "prospect", label: "Prospect" },
    { value: "excluded", label: "Excluded" },
    { value: "identified", label: "Identified (new targets)" },
  ];
  statuses.forEach(function (s) {
    var opt = document.createElement("option");
    opt.value = s.value;
    opt.textContent = s.label;
    statusSelect.appendChild(opt);
  });
}

export function clearSelectOptions(id) {
  var sel = document.getElementById(id);
  // Keep first "All" option, remove rest
  while (sel.options.length > 1) {
    sel.remove(1);
  }
  sel.selectedIndex = 0;
}

// ==================== AM Buttons ====================
export function populateAMButtons() {
  var data = getActiveData();
  var container = document.getElementById("amButtons");
  data.managers.forEach(function (m) {
    var btn = document.createElement("button");
    btn.className = "am-btn";
    btn.dataset.manager = m;
    var color = data.manager_colors[m];
    btn.innerHTML =
      '<span class="color-dot" style="background:' + color + '"></span>' +
      escapeHTML(m.split(" ")[0]);
    container.appendChild(btn);
  });
}

// ==================== Sync AM Buttons ====================
export function syncAMButtons() {
  var btns = document.querySelectorAll("#amButtons .am-btn");
  btns.forEach(function (btn) {
    var mgr = btn.dataset.manager;
    if (state.filterManagers.indexOf(mgr) >= 0) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });
}

// ==================== Filter Change ====================
export function onFilterChange() {
  updateStats();
  updateLegend();
  refreshStyles();
}

// ==================== Search Feedback ====================
export function onSearchChange() {
  var fb = document.getElementById("searchFeedback");
  if (!fb) return;

  var q = state.filterSearch;
  if (!q) {
    fb.style.display = "none";
    state.searchMatchedZips = {};
    if (state.geoLayer && state.map) {
      state.map.fitBounds(state.geoLayer.getBounds(), { padding: [16, 16] });
    }
    return;
  }

  var ql = _stripDiacritics(q.toLowerCase());
  var isZipQuery = /^\d+$/.test(q);

  var matchedZips = [];
  var allZips = Object.keys(state.zipDataMap);
  for (var i = 0; i < allZips.length; i++) {
    var entry = state.zipDataMap[allZips[i]];
    if (!entry) continue;
    var zip = (entry.postcode || "").toLowerCase();
    var city = _stripDiacritics((entry.official_city || "").toLowerCase());
    if (zip.indexOf(ql) >= 0 || city.indexOf(ql) >= 0) {
      matchedZips.push(allZips[i]);
    }
  }

  state.searchMatchedZips = {};
  for (var si = 0; si < matchedZips.length; si++) {
    state.searchMatchedZips[matchedZips[si]] = true;
  }

  var html = "";
  if (matchedZips.length > 0) {
    html += '<span class="search-match-count">' + matchedZips.length + ' ZIP' + (matchedZips.length > 1 ? 's' : '') + ' matched</span>';

    var matchBounds = [];
    for (var mi = 0; mi < matchedZips.length; mi++) {
      var feat = state.topoFeaturesById[matchedZips[mi]];
      if (feat) {
        var layer = L.geoJSON(feat);
        var b = layer.getBounds();
        matchBounds.push(b);
      }
    }
    if (matchBounds.length > 0) {
      var combined = matchBounds[0];
      for (var bi = 1; bi < matchBounds.length; bi++) {
        combined.extend(matchBounds[bi]);
      }
      state.map.fitBounds(combined, { padding: [40, 40], maxZoom: 13 });
    }
  } else {
    html += '<span class="search-no-match">No matching ZIPs found</span>';
  }

  if (!isZipQuery && matchedZips.length === 0) {
    html += '<span class="search-anomaly-hint">No city match found in dataset</span>';
  }

  fb.innerHTML = html;
  fb.style.display = html ? "block" : "none";
}

// ==================== Stats ====================
export function updateStats() {
  var data = getActiveData();

  var filtered = data.merged.filter(function (e) {
    var entry = state.zipDataMap[e.postcode];
    return entry && !isFiltered(entry);
  });

  var covered = 0, coveredNew = 0, potential = 0, prospect = 0, excluded = 0, identified = 0;
  filtered.forEach(function (e) {
    var entry = state.zipDataMap[e.postcode];
    if (!entry) return;
    var eff = getEffectiveStatus(entry);
    if (eff === "covered") covered++;
    else if (eff === "covered new") coveredNew++;
    else if (eff === "potential") potential++;
    else if (eff === "prospect") prospect++;
    else if (eff === "excluded") excluded++;
    else if (eff === "identified") identified++;
  });

  var total = filtered.length;

  // Main stat cards
  animateNumber("statTotal", total);
  animateNumber("statCovered", covered);
  animateNumber("statCoveredNew", coveredNew);
  animateNumber("statPotential", potential);
  animateNumber("statProspect", prospect);
  animateNumber("statExcluded", excluded);

  // Identified in advanced tools
  var idEl = document.getElementById("statIdentified");
  if (idEl) idEl.textContent = identified;
}

// ==================== Legend ====================
export function updateLegend() {
  var data = getActiveData();
  var container = document.getElementById("legendContainer");
  container.innerHTML = "";
  var filtersActive = hasActiveFilters();

  if (state.colorMode === "coverage") {
    addLegendItem(container, coverageColors.covered, "Covered");
    addLegendItem(container, coverageColors["covered new"], "Covered New");
    addLegendItem(container, coverageColors.potential, "Potential");
    addLegendItem(container, coverageColors.prospect, "Prospect");
    addLegendItem(container, coverageColors.excluded, "Excluded");
    addLegendItem(container, coverageColors.identified, "Identified (new targets)");
    if (!filtersActive) {
      addLegendItem(container, "#e8ecf0", "Unmatched");
    }
  } else if (state.colorMode === "manager") {
    data.managers.forEach(function (m) {
      addLegendItem(container, data.manager_colors[m], m);
    });
    addLegendItem(container, coverageColors.identified, "Identified (new targets)");
    addLegendItem(container, coverageColors.excluded, "Excluded");
  } else if (state.colorMode === "territory") {
    data.territories.forEach(function (t) {
      addLegendItem(container, data.territory_colors[t], t.replace("CMD_EMEA_CH_AM_", "AM "));
    });
    addLegendItem(container, coverageColors.identified, "Identified (new targets)");
    addLegendItem(container, coverageColors.excluded, "Excluded");
  }
}

function addLegendItem(container, color, label) {
  var div = document.createElement("div");
  div.className = "legend-item";
  div.innerHTML =
    '<span class="legend-swatch" style="background:' + color + '"></span>' +
    '<span>' + escapeHTML(label) + '</span>';
  container.appendChild(div);
}
