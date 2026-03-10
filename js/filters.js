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
    opt.textContent = t.replace("CMD_EMEA_CH_AM_", "AM ");
    territorySelect.appendChild(opt);
  });

  // Status select
  var statusSelect = document.getElementById("filterStatus");
  var statuses = [
    { value: "covered", label: "Covered" },
    { value: "potential", label: "Potential" },
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

export function syncAMButtons() {
  document.querySelectorAll(".am-btn").forEach(function (btn) {
    btn.classList.toggle("active", state.filterManagers.indexOf(btn.dataset.manager) >= 0);
  });
}

// ==================== Filter Change ====================
export function onFilterChange() {
  syncAMButtons();
  updateStats();
  updateLegend();
  refreshStyles();
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

  var covered = 0, potential = 0, exceptions = 0, excluded = 0, accounts = 0;
  filtered.forEach(function (e) {
    var entry = state.zipDataMap[e.postcode];
    if (!entry) return;
    var eff = getEffectiveStatus(entry);
    if (eff === "covered") covered++;
    else if (eff === "potential") potential++;
    else if (eff === "exception") exceptions++;
    else if (eff === "excluded") excluded++;
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
    if (!filtersActive) {
      addLegendItem(container, "#e8ecf0", "Unmatched");
    }
  } else if (state.colorMode === "manager") {
    data.managers.forEach(function (m) {
      addLegendItem(container, data.manager_colors[m], m);
    });
    addLegendItem(container, coverageColors.exception, "Exception (SFDC only)");
    addLegendItem(container, coverageColors.excluded, "Excluded");
  } else if (state.colorMode === "territory") {
    data.territories.forEach(function (t) {
      addLegendItem(container, data.territory_colors[t], t.replace("CMD_EMEA_CH_AM_", "AM "));
    });
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
export function renderAnomalyTable() {
  var data = getActiveData();
  var count = data.sfdc_only.length;
  var countEl = document.getElementById("anomalyCount");
  if (countEl) countEl.textContent = count;
  var barCount = document.getElementById("anomalyBarCount");
  if (barCount) barCount.textContent = count;

  var tbody = document.getElementById("anomalyBody");
  tbody.innerHTML = "";

  data.sfdc_only.forEach(function (row) {
    var hasPolygon = !!state.topoFeaturesById[row.postcode] || !!FALLBACK_ZIP_COORDS[row.postcode];
    var tr = document.createElement("tr");
    var accountNames = row.sfdc_accounts
      .map(function (a) { return escapeHTML(a.name); })
      .join(", ");

    // Determine exception reason
    var pseudoEntry = state.zipDataMap[row.postcode] || { sfdc_accounts: row.sfdc_accounts };
    var excInfo = getExceptionInfo(pseudoEntry);
    var reasonText = excInfo ? excInfo.category : "Not in territory file";

    tr.innerHTML =
      "<td><strong>" + row.postcode + "</strong></td>" +
      "<td>" + escapeHTML(row.sfdc_territories.join(", ").replace(/CMD_EMEA_CH_AM_/g, "AM ")) + "</td>" +
      "<td>" + escapeHTML(row.sfdc_managers.join(", ")) + "</td>" +
      "<td>" + row.sfdc_account_count + "</td>" +
      "<td>" + accountNames + "</td>" +
      "<td>" + escapeHTML(reasonText) + "</td>" +
      '<td><span class="badge ' + (hasPolygon ? 'badge-yes' : 'badge-no') + '">' + (hasPolygon ? 'Yes' : 'No') + '</span></td>';
    tbody.appendChild(tr);
  });
}
