/**
 * nonmap.js — Table-based display and selection for ZIPs without map polygons.
 * Shows a filterable, scrollable table with checkboxes. Selected ZIPs feed
 * into the same selectedZips state used by map selections.
 */

import {
  state, getEffectiveStatus, isFiltered,
} from "./state.js";
import { escapeHTML } from "./utils.js";
import { toggleZipSelection, updateSelectionTray, refreshStyles } from "./map.js";

function stripDiacritics(str) {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// ==================== Setup ====================
export function setupNonMapPanel() {
  var container = document.getElementById("nonMapSection");
  if (!container) return;

  var filterInput = document.getElementById("nonMapFilter");
  var selectAllCb = document.getElementById("nonMapSelectAll");

  container.style.display = "block";

  // Render full table on init
  renderNonMapTable();

  // Filter input
  if (filterInput) {
    var debounce = null;
    filterInput.addEventListener("input", function () {
      clearTimeout(debounce);
      debounce = setTimeout(function () {
        filterNonMapTable(filterInput.value.trim());
      }, 150);
    });
  }

  // Select-all checkbox
  if (selectAllCb) {
    selectAllCb.addEventListener("change", function () {
      toggleSelectAllVisible(selectAllCb.checked);
    });
  }

  // Delegated click on table body checkboxes
  var tbody = document.getElementById("nonMapBody");
  if (tbody) {
    tbody.addEventListener("change", function (e) {
      if (e.target.classList.contains("nonmap-row-cb")) {
        var zip = e.target.dataset.zip;
        if (e.target.checked) {
          state.selectedZips[zip] = true;
        } else {
          delete state.selectedZips[zip];
        }
        refreshStyles();
        updateSelectionTray();
        updateNonMapSelectAllState();
        renderNonMapChips();
      }
    });
  }

  // Chips removal
  var chips = document.getElementById("nonMapChips");
  if (chips) {
    chips.addEventListener("click", function (e) {
      var removeBtn = e.target.closest(".chip-remove");
      if (removeBtn) {
        var zip = removeBtn.dataset.zip;
        delete state.selectedZips[zip];
        // Uncheck the table row
        var cb = document.querySelector('.nonmap-row-cb[data-zip="' + zip + '"]');
        if (cb) cb.checked = false;
        refreshStyles();
        updateSelectionTray();
        updateNonMapSelectAllState();
        renderNonMapChips();
      }
    });
  }

  renderNonMapChips();
}

// ==================== Render Table ====================
export function renderNonMapTable() {
  var tbody = document.getElementById("nonMapBody");
  var countEl = document.getElementById("nonMapCount");
  if (!tbody) return;

  var nonMapKeys = Object.keys(state.nonMapZips).sort();
  if (countEl) countEl.textContent = nonMapKeys.length;

  tbody.innerHTML = "";

  if (nonMapKeys.length === 0) {
    var tr = document.createElement("tr");
    tr.innerHTML = '<td colspan="5" class="nonmap-empty-cell">No non-map ZIPs found.</td>';
    tbody.appendChild(tr);
    return;
  }

  for (var i = 0; i < nonMapKeys.length; i++) {
    var zip = nonMapKeys[i];
    var entry = state.zipDataMap[zip];
    var city = entry ? (entry.official_city || "") : "";
    var canton = entry ? (entry.canton || "") : "";
    var eff = entry ? getEffectiveStatus(entry) : "unmatched";
    var isSelected = !!state.selectedZips[zip];

    var statusLabel = {
      covered: "Covered", "covered new": "Covered New", potential: "Potential",
      prospect: "Prospect", excluded: "Excluded", identified: "Identified", unmatched: "No data",
    }[eff] || eff;

    var tr = document.createElement("tr");
    tr.className = "nonmap-row";
    tr.dataset.zip = zip;
    tr.dataset.city = stripDiacritics(city.toLowerCase());
    tr.dataset.status = eff;

    tr.innerHTML =
      '<td class="nonmap-cb-cell"><input type="checkbox" class="nonmap-row-cb" data-zip="' + zip + '"' + (isSelected ? " checked" : "") + '></td>' +
      '<td class="nonmap-zip-cell">' + zip + '</td>' +
      '<td class="nonmap-city-cell">' + escapeHTML(city) + '</td>' +
      '<td class="nonmap-canton-cell">' + escapeHTML(canton) + '</td>' +
      '<td class="nonmap-status-cell"><span class="nonmap-status nonmap-status-' + eff.replace(" ", "-") + '">' + statusLabel + '</span></td>';

    tbody.appendChild(tr);
  }

  updateNonMapSelectAllState();
}

// ==================== Filter Table ====================
function filterNonMapTable(query) {
  var tbody = document.getElementById("nonMapBody");
  if (!tbody) return;
  var rows = tbody.querySelectorAll(".nonmap-row");
  var ql = stripDiacritics(query.toLowerCase());
  var isZipQuery = /^\d+$/.test(query);
  var visibleCount = 0;

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var zip = row.dataset.zip;
    var city = row.dataset.city;
    var match = true;

    if (ql) {
      if (isZipQuery) {
        match = zip.indexOf(ql) >= 0;
      } else {
        match = city.indexOf(ql) >= 0 || zip.indexOf(ql) >= 0;
      }
    }

    row.style.display = match ? "" : "none";
    if (match) visibleCount++;
  }

  var filterCount = document.getElementById("nonMapFilterCount");
  if (filterCount) {
    if (ql) {
      filterCount.textContent = visibleCount + "/" + rows.length + " shown";
      filterCount.style.display = "inline";
    } else {
      filterCount.textContent = "";
      filterCount.style.display = "none";
    }
  }

  updateNonMapSelectAllState();
}

// ==================== Select All (visible rows) ====================
function toggleSelectAllVisible(checked) {
  var tbody = document.getElementById("nonMapBody");
  if (!tbody) return;
  var rows = tbody.querySelectorAll(".nonmap-row");

  for (var i = 0; i < rows.length; i++) {
    if (rows[i].style.display === "none") continue;
    var cb = rows[i].querySelector(".nonmap-row-cb");
    if (!cb) continue;
    var zip = cb.dataset.zip;
    cb.checked = checked;
    if (checked) {
      state.selectedZips[zip] = true;
    } else {
      delete state.selectedZips[zip];
    }
  }
  refreshStyles();
  updateSelectionTray();
  renderNonMapChips();
}

function updateNonMapSelectAllState() {
  var selectAllCb = document.getElementById("nonMapSelectAll");
  if (!selectAllCb) return;
  var tbody = document.getElementById("nonMapBody");
  if (!tbody) return;

  var visibleCbs = [];
  var rows = tbody.querySelectorAll(".nonmap-row");
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].style.display === "none") continue;
    var cb = rows[i].querySelector(".nonmap-row-cb");
    if (cb) visibleCbs.push(cb);
  }

  if (visibleCbs.length === 0) {
    selectAllCb.checked = false;
    selectAllCb.indeterminate = false;
    return;
  }

  var allChecked = visibleCbs.every(function (cb) { return cb.checked; });
  var someChecked = visibleCbs.some(function (cb) { return cb.checked; });

  selectAllCb.checked = allChecked;
  selectAllCb.indeterminate = !allChecked && someChecked;
}

// ==================== Render Chips (selected non-map ZIPs) ====================
export function renderNonMapChips() {
  var chips = document.getElementById("nonMapChips");
  if (!chips) return;

  var selectedNonMap = [];
  var selectedKeys = Object.keys(state.selectedZips);
  for (var i = 0; i < selectedKeys.length; i++) {
    if (state.nonMapZips[selectedKeys[i]]) {
      selectedNonMap.push(selectedKeys[i]);
    }
  }

  if (selectedNonMap.length === 0) {
    chips.innerHTML = "";
    return;
  }

  chips.innerHTML = "";
  selectedNonMap.sort().forEach(function (zip) {
    var entry = state.zipDataMap[zip];
    var city = entry ? (entry.official_city || "") : "";
    var eff = entry ? getEffectiveStatus(entry) : "unmatched";

    var chip = document.createElement("div");
    chip.className = "tray-chip tray-chip-" + eff.replace(" ", "-");
    chip.innerHTML =
      '<span class="chip-zip">' + zip + '</span>' +
      (city ? '<span class="chip-city">' + escapeHTML(city) + '</span>' : '') +
      '<button class="chip-remove" data-zip="' + zip + '" title="Remove ' + zip + '">&times;</button>';
    chips.appendChild(chip);
  });
}
