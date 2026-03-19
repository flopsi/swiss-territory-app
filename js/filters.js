/**
 * filters.js — Filter controls, stats, legend, AM buttons, and exception table.
 */

import {
  state, getActiveData, getEffectiveStatus,
  hasActiveFilters, isFiltered, getExceptionInfo, coverageColors,
} from "./state.js";
import { escapeHTML, animateNumber } from "./utils.js";
import { refreshStyles, renderTerritoryBorders, FALLBACK_ZIP_COORDS } from "./map.js";

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
    opt.textContent = t.replace("CMD_EMEA_CH_AM_", "AM ").replace("CMD_EMEA_CHAM_", "AM ");
    territorySelect.appendChild(opt);
  });

  // Status select
  var statusSelect = document.getElementById("filterStatus");
  var statuses = [
    { value: "covered", label: "Covered" },
    { value: "potential", label: "Potential" },
    { value: "identified", label: "Identified (new targets)" },
    { value: "anomaly", label: "Exception (SFDC only)" },
    { value: "excluded", label: "Excluded" },
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
// Called after filterSearch changes to provide visible feedback on the map and sidebar.
export function onSearchChange() {
  var fb = document.getElementById("searchFeedback");
  if (!fb) return;

  var q = state.filterSearch;
  if (!q) {
    fb.style.display = "none";
    state.searchMatchedZips = {};
    // Reset map zoom to full extent
    if (state.geoLayer && state.map) {
      state.map.fitBounds(state.geoLayer.getBounds(), { padding: [16, 16] });
    }
    // Clear any search-injected anomaly rows
    renderAnomalyTable();
    return;
  }

  var ql = q.toLowerCase();
  var isZipQuery = /^\d+$/.test(q);

  // Count matching ZIPs in the dataset
  var matchedZips = [];
  var allZips = Object.keys(state.zipDataMap);
  for (var i = 0; i < allZips.length; i++) {
    var entry = state.zipDataMap[allZips[i]];
    if (!entry) continue;
    var zip = (entry.postcode || "").toLowerCase();
    var city = (entry.official_city || "").toLowerCase();
    if (zip.indexOf(ql) >= 0 || city.indexOf(ql) >= 0) {
      matchedZips.push(allZips[i]);
    }
  }

  // Update search highlight state
  state.searchMatchedZips = {};
  for (var si = 0; si < matchedZips.length; si++) {
    state.searchMatchedZips[matchedZips[si]] = true;
  }

  // Build feedback message
  var html = "";
  if (matchedZips.length > 0) {
    html += '<span class="search-match-count">' + matchedZips.length + ' ZIP' + (matchedZips.length > 1 ? 's' : '') + ' matched</span>';

    // Zoom to matched results on the map
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

  // Detect unmatched ZIP and surface it in the anomaly section
  var unmatchedSearchZips = [];
  if (isZipQuery && q.length >= 4) {
    var exactZip = q.padStart(4, "0");
    if (!state.zipDataMap[exactZip]) {
      unmatchedSearchZips.push(exactZip);
      html += '<span class="search-anomaly-hint">See Exceptions panel below</span>';
    }
  }

  // If there's an unmatched city search with zero results, add a hint
  if (!isZipQuery && matchedZips.length === 0) {
    html += '<span class="search-anomaly-hint">No city match found in dataset</span>';
  }

  fb.innerHTML = html;
  fb.style.display = html ? "block" : "none";

  // Re-render anomaly table with any search-unmatched ZIPs injected
  renderAnomalyTable(unmatchedSearchZips.length > 0 ? unmatchedSearchZips : undefined);

  // Auto-open the anomaly panel if there are unmatched ZIPs
  if (unmatchedSearchZips.length > 0) {
    var anomalyPanel = document.getElementById("anomalySection");
    var bar = document.getElementById("anomalyBar");
    if (anomalyPanel && anomalyPanel.style.display !== "flex") {
      anomalyPanel.style.display = "flex";
      if (bar) bar.classList.add("expanded");
    }
  }
}

// ==================== Stats ====================
export function updateStats() {
  var data = getActiveData();
  var allEntries = data.merged.concat(
    data.sfdc_only.filter(function (r) { return state.zipDataMap[r.postcode] && state.zipDataMap[r.postcode]._anomaly; })
  );

  var filtered = allEntries.filter(function (e) {
    var entry = state.zipDataMap[e.postcode];
    return entry && !isFiltered(entry);
  });

  var covered = 0, potential = 0, exceptions = 0, excluded = 0, identified = 0, accounts = 0;
  filtered.forEach(function (e) {
    var entry = state.zipDataMap[e.postcode];
    if (!entry) return;
    var eff = getEffectiveStatus(entry);
    if (eff === "covered") covered++;
    else if (eff === "potential") potential++;
    else if (eff === "exception") exceptions++;
    else if (eff === "excluded") excluded++;
    else if (eff === "identified") identified++;
    accounts += entry.sfdc_account_count || 0;
  });

  var total = filtered.length;

  // V1 stat cards (4 main stats)
  animateNumber("statTotal", total);
  animateNumber("statCovered", covered);
  animateNumber("statPotential", potential);
  animateNumber("statAccounts", accounts);

  // Tucked-away advanced stats
  var anomEl = document.getElementById("statExceptions");
  if (anomEl) anomEl.textContent = exceptions;
  var exclEl = document.getElementById("statExcluded");
  if (exclEl) exclEl.textContent = excluded;
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
    addLegendItem(container, coverageColors.covered, "Covered (in SFDC)");
    addLegendItem(container, coverageColors.potential, "Potential (not in SFDC)");
    addLegendItem(container, coverageColors.identified, "Identified (new targets)");
    if (!filtersActive) {
      addLegendItem(container, "#e8ecf0", "Unmatched");
    }
  } else if (state.colorMode === "manager") {
    data.managers.forEach(function (m) {
      addLegendItem(container, data.manager_colors[m], m);
    });
    addLegendItem(container, coverageColors.identified, "Identified (new targets)");
    addLegendItem(container, coverageColors.exception, "Exception (SFDC only)");
    addLegendItem(container, coverageColors.excluded, "Excluded");
  } else if (state.colorMode === "territory") {
    data.territories.forEach(function (t) {
      addLegendItem(container, data.territory_colors[t], t.replace("CMD_EMEA_CH_AM_", "AM ").replace("CMD_EMEA_CHAM_", "AM "));
    });
    addLegendItem(container, coverageColors.identified, "Identified (new targets)");
    addLegendItem(container, coverageColors.exception, "Exception (SFDC only)");
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

// ==================== Exception (Anomaly) Table ====================
// searchUnmatchedZips: optional array of ZIP strings from search that have no dataset entry
export function renderAnomalyTable(searchUnmatchedZips) {
  var data = getActiveData();
  var unmatchedArr = searchUnmatchedZips || [];
  var sfdcCount = data.sfdc_only.length;
  var totalCount = sfdcCount + unmatchedArr.length;

  var countEl = document.getElementById("anomalyCount");
  if (countEl) countEl.textContent = totalCount;
  var barCount = document.getElementById("anomalyBarCount");
  if (barCount) barCount.textContent = totalCount;

  var tbody = document.getElementById("anomalyBody");
  tbody.innerHTML = "";

  // Render search-unmatched ZIPs at the top with a distinct style
  unmatchedArr.forEach(function (zip) {
    var hasPolygon = !!state.topoFeaturesById[zip];
    var tr = document.createElement("tr");
    tr.className = "anomaly-search-row";
    tr.innerHTML =
      "<td><strong>" + escapeHTML(zip) + "</strong></td>" +
      '<td colspan="4" class="anomaly-search-note">' +
        '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" style="vertical-align:-2px;margin-right:3px;"><circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.5"/><path d="M11 11l3.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' +
        'Searched ZIP — not in territory or SFDC data' +
      '</td>' +
      '<td>Search result</td>' +
      '<td><span class="badge ' + (hasPolygon ? 'badge-yes' : 'badge-no') + '">' + (hasPolygon ? 'Yes' : 'No') + '</span></td>';
    tbody.appendChild(tr);
  });

  // Render standard SFDC-only exception rows
  data.sfdc_only.forEach(function (row) {
    var hasPolygon = !!state.topoFeaturesById[row.postcode];
    // ZIPs without their own polygon are shown as circle markers via FALLBACK_ZIP_COORDS
    var hasMarker = !hasPolygon && !!FALLBACK_ZIP_COORDS[row.postcode];
    var onMap = hasPolygon || hasMarker;
    var tr = document.createElement("tr");
    var accountNames = row.sfdc_accounts
      .map(function (a) { return escapeHTML(a.name); })
      .join(", ");

    // Determine exception reason
    var pseudoEntry = state.zipDataMap[row.postcode] || { sfdc_accounts: row.sfdc_accounts };
    var excInfo = getExceptionInfo(pseudoEntry);
    var reasonText = excInfo ? excInfo.category : "Not in territory file";

    var mapLabel = hasPolygon ? "Polygon" : (hasMarker ? "Marker" : "No");
    var badgeClass = onMap ? "badge-yes" : "badge-no";

    tr.innerHTML =
      "<td><strong>" + row.postcode + "</strong></td>" +
      "<td>" + escapeHTML(row.sfdc_territories.join(", ").replace(/CMD_EMEA_CH_AM_/g, "AM ").replace(/CMD_EMEA_CHAM_/g, "AM ")) + "</td>" +
      "<td>" + escapeHTML(row.sfdc_managers.join(", ")) + "</td>" +
      "<td>" + row.sfdc_account_count + "</td>" +
      "<td>" + accountNames + "</td>" +
      "<td>" + escapeHTML(reasonText) + "</td>" +
      '<td><span class="badge ' + badgeClass + '">' + mapLabel + '</span></td>';
    tbody.appendChild(tr);
  });
}
