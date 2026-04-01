/**
 * nonmap.js — Search/input workflow for ZIPs not displayed as map polygons.
 * Rewritten for flat master JSON with 5 statuses.
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

  var input = document.getElementById("nonMapInput");
  var suggestions = document.getElementById("nonMapSuggestions");
  var addBtn = document.getElementById("btnAddNonMapZips");
  var chips = document.getElementById("nonMapChips");

  if (!input || !addBtn) return;

  container.style.display = "block";

  var debounce = null;
  input.addEventListener("input", function () {
    clearTimeout(debounce);
    debounce = setTimeout(function () {
      renderSuggestions(input.value.trim(), suggestions);
    }, 150);
  });

  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      addZipsFromInput(input, suggestions);
    }
  });

  addBtn.addEventListener("click", function () {
    addZipsFromInput(input, suggestions);
  });

  suggestions.addEventListener("click", function (e) {
    var item = e.target.closest(".nonmap-suggestion");
    if (!item) return;
    var zip = item.dataset.zip;
    if (zip) {
      state.selectedZips[zip] = true;
      refreshStyles();
      updateSelectionTray();
      renderNonMapChips();
      item.remove();
      if (suggestions.children.length === 0) {
        suggestions.style.display = "none";
      }
    }
  });

  chips.addEventListener("click", function (e) {
    var removeBtn = e.target.closest(".chip-remove");
    if (removeBtn) {
      var zip = removeBtn.dataset.zip;
      delete state.selectedZips[zip];
      refreshStyles();
      updateSelectionTray();
      renderNonMapChips();
    }
  });

  renderNonMapChips();
}

// ==================== Render Suggestions ====================
function renderSuggestions(query, container) {
  container.innerHTML = "";
  if (!query) {
    container.style.display = "none";
    return;
  }

  var ql = stripDiacritics(query.toLowerCase());
  var isZipQuery = /^\d+$/.test(query);
  var matches = [];

  var nonMapKeys = Object.keys(state.nonMapZips);
  for (var i = 0; i < nonMapKeys.length; i++) {
    var zip = nonMapKeys[i];
    var entry = state.zipDataMap[zip];
    var city = entry ? (entry.official_city || "") : "";
    var cityNorm = stripDiacritics(city.toLowerCase());

    var match = false;
    if (isZipQuery) {
      match = zip.indexOf(ql) >= 0;
    } else {
      match = cityNorm.indexOf(ql) >= 0 || zip.indexOf(ql) >= 0;
    }

    if (match && entry) {
      if (isFiltered(entry) && (state.filterManagers.length > 0 || state.filterTerritory || state.filterStatus)) {
        continue;
      }
    }

    if (match) {
      matches.push({ zip: zip, city: city, entry: entry });
    }
    if (matches.length >= 50) break;
  }

  if (matches.length === 0) {
    container.style.display = "none";
    return;
  }

  matches.sort(function (a, b) { return a.zip.localeCompare(b.zip); });

  matches.forEach(function (m) {
    var div = document.createElement("div");
    div.className = "nonmap-suggestion";
    div.dataset.zip = m.zip;

    var eff = m.entry ? getEffectiveStatus(m.entry) : "unmatched";
    var isSelected = !!state.selectedZips[m.zip];
    var statusLabel = {
      covered: "Covered", "covered new": "Covered New", potential: "Potential",
      prospect: "Prospect", excluded: "Excluded", identified: "Identified", unmatched: "No data",
    }[eff] || eff;

    div.innerHTML =
      '<span class="nonmap-zip">' + m.zip + '</span>' +
      '<span class="nonmap-city">' + escapeHTML(m.city) + '</span>' +
      '<span class="nonmap-status nonmap-status-' + eff.replace(" ", "-") + '">' + statusLabel + '</span>' +
      (isSelected ? '<span class="nonmap-selected-badge">Selected</span>' : '');

    if (isSelected) div.classList.add("nonmap-suggestion-selected");

    container.appendChild(div);
  });

  container.style.display = "block";
}

// ==================== Add ZIPs from Input ====================
function addZipsFromInput(input, suggestionsContainer) {
  var raw = input.value.trim();
  if (!raw) return;

  var parts = raw.split(/[,;\s]+/).filter(Boolean);
  var added = 0;

  parts.forEach(function (part) {
    var z = part.replace(/[^\d]/g, "");
    if (!z) return;
    while (z.length < 4) z = "0" + z;
    if (z.length !== 4) return;

    var isKnownNonMap = !!state.nonMapZips[z] && !!state.zipDataMap[z];

    if (isKnownNonMap) {
      state.selectedZips[z] = true;
      added++;
    }
  });

  if (added > 0) {
    refreshStyles();
    updateSelectionTray();
    renderNonMapChips();
  }

  input.value = "";
  suggestionsContainer.innerHTML = "";
  suggestionsContainer.style.display = "none";

  var feedback = document.getElementById("nonMapFeedback");
  if (feedback) {
    if (added > 0) {
      feedback.textContent = added + " ZIP" + (added > 1 ? "s" : "") + " added to selection.";
      feedback.className = "nonmap-feedback nonmap-feedback-success";
    } else {
      feedback.textContent = "No valid non-map ZIPs found in input.";
      feedback.className = "nonmap-feedback nonmap-feedback-warn";
    }
    feedback.style.display = "block";
    setTimeout(function () { feedback.style.display = "none"; }, 3000);
  }
}

// ==================== Render Non-Map Chips ====================
export function renderNonMapChips() {
  var chips = document.getElementById("nonMapChips");
  var countEl = document.getElementById("nonMapCount");
  if (!chips) return;

  var selectedNonMap = [];
  var selectedKeys = Object.keys(state.selectedZips);
  for (var i = 0; i < selectedKeys.length; i++) {
    if (state.nonMapZips[selectedKeys[i]]) {
      selectedNonMap.push(selectedKeys[i]);
    }
  }

  if (countEl) {
    countEl.textContent = Object.keys(state.nonMapZips).length;
  }

  if (selectedNonMap.length === 0) {
    chips.innerHTML = '<span class="nonmap-empty">No non-map ZIPs selected. Use the search above or enter ZIPs manually.</span>';
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
