/**
 * uploads.js — Single master JSON upload and refresh-app-with-data.
 * Rewritten for flat master JSON with 5 statuses.
 */

import {
  state, getActiveData, setActiveData,
  setUsingPersistedData, getUsingPersistedData,
  setSavedUploadedAt, buildZipDataMap,
} from "./state.js";
import { saveDatasetToServer, clearPersistedDataset } from "./api.js";
import { renderGeoLayer, renderTerritoryBorders, updateSelectionTray, refreshStyles } from "./map.js";
import {
  populateSelects, populateAMButtons, clearSelectOptions,
  updateStats, updateLegend,
} from "./filters.js";
import { showNotionQueueStatus } from "./zefix.js";

// ==================== Client-Side Preprocessing ====================
// Convert raw master JSON array into the APP_DATA shape
function preprocessMasterJSON(entries) {
  var tPal = ["#e6194b","#3cb44b","#4363d8","#f58231","#911eb4","#42d4f4","#f032e6","#bfef45","#fabed4","#469990","#dcbeff","#9A6324","#fffac8","#800000","#aaffc3","#808000"];
  var mPal = ["#1b9e77","#d95f02","#7570b3","#e7298a","#66a61e","#e6ab02","#a6761d","#666666","#e41a1c","#377eb8","#4daf4a","#984ea3"];

  var territoriesSet = {};
  var managersSet = {};

  var merged = [];
  entries.forEach(function (e) {
    var z = String(e.zipcode || e.postcode || "").replace(/[^\d]/g, "");
    if (!z) return;
    while (z.length < 4) z = "0" + z;
    if (z.length !== 4) return;

    var entry = {
      postcode: z,
      territory_id: e.territoryID || e.territory_id || "",
      account_manager: e.cmdAccountManager || e.account_manager || "",
      official_city: e.place || e.official_city || "",
      canton: e.state_code || e.canton || "",
      state: e.state || "",
      province: e.province || "",
      community: e.community || "",
      latitude: e.latitude || "",
      longitude: e.longitude || "",
      excluded: e.excluded || false,
      status: e.status || "potential",
    };
    if (entry.territory_id) territoriesSet[entry.territory_id] = true;
    if (entry.account_manager) managersSet[entry.account_manager] = true;
    merged.push(entry);
  });

  merged.sort(function (a, b) { return a.postcode < b.postcode ? -1 : 1; });

  var territories = Object.keys(territoriesSet).sort();
  var managers = Object.keys(managersSet).sort();

  var territoryColors = {};
  territories.forEach(function (t, i) { territoryColors[t] = tPal[i % tPal.length]; });
  var managerColors = {};
  managers.forEach(function (m, i) { managerColors[m] = mPal[i % mPal.length]; });

  // Count statuses
  var sc = {};
  merged.forEach(function (e) { sc[e.status] = (sc[e.status] || 0) + 1; });

  return {
    merged: merged,
    sfdc_only: [],
    territories: territories,
    managers: managers,
    territory_colors: territoryColors,
    manager_colors: managerColors,
    stats: {
      total_zips: merged.length,
      covered_zips: sc["covered"] || 0,
      covered_new_zips: sc["covered new"] || 0,
      potential_zips: sc["potential"] || 0,
      prospect_zips: sc["prospect"] || 0,
      excluded_zips: sc["excluded"] || 0,
    },
  };
}

// ==================== Refresh App State In-Place ====================
export function refreshAppWithData(newData, options) {
  options = options || {};
  var shouldPersist = options.persist !== false;
  var headerLabel = options.label || null;

  setActiveData(newData);
  window.APP_DATA = newData;

  var newZipSet = {};
  if (newData && newData.merged) {
    newData.merged.forEach(function (e) { if (e.postcode) newZipSet[e.postcode] = true; });
  }

  // Preserve excluded ZIPs
  if (Object.prototype.hasOwnProperty.call(options, "excludedZips")) {
    state.excludedZips = options.excludedZips || {};
  } else if (Object.prototype.hasOwnProperty.call(options, "preserveExcluded") && !options.preserveExcluded) {
    state.excludedZips = {};
  } else {
    var prevExcluded = state.excludedZips || {};
    var filteredExcluded = {};
    Object.keys(prevExcluded).forEach(function (z) {
      if (newZipSet[z]) filteredExcluded[z] = prevExcluded[z];
    });
    state.excludedZips = filteredExcluded;
  }

  // Preserve identified ZIPs
  if (Object.prototype.hasOwnProperty.call(options, "identifiedZips")) {
    state.identifiedZips = options.identifiedZips || {};
  } else if (Object.prototype.hasOwnProperty.call(options, "preserveIdentified") && !options.preserveIdentified) {
    state.identifiedZips = {};
  } else {
    var prevIdentified = state.identifiedZips || {};
    var filteredIdentified = {};
    Object.keys(prevIdentified).forEach(function (z) {
      if (newZipSet[z]) filteredIdentified[z] = prevIdentified[z];
    });
    state.identifiedZips = filteredIdentified;
  }

  // Reset volatile state
  state.zipDataMap = {};
  state.selectedZips = {};
  state.zefixResults = [];
  state.zefixChecked = [];
  state.filterManagers = [];
  state.filterTerritory = "";
  state.filterStatus = "";
  state.filterSearch = "";
  state.colorMode = "coverage";

  buildZipDataMap();

  clearSelectOptions("filterManager");
  clearSelectOptions("filterTerritory");
  clearSelectOptions("filterStatus");
  populateSelects();

  document.getElementById("amButtons").innerHTML = "";
  populateAMButtons();

  var covRadio = document.querySelector('input[name="colorMode"][value="coverage"]');
  if (covRadio) covRadio.checked = true;

  renderGeoLayer();
  renderTerritoryBorders();

  updateStats();
  updateLegend();
  updateSelectionTray();

  document.getElementById("zefixPanel").style.display = "none";
  showNotionQueueStatus("", "");

  if (headerLabel) {
    document.getElementById("lastUpdated").textContent = headerLabel;
  } else {
    document.getElementById("lastUpdated").textContent = shouldPersist ? "Data: uploaded (persisted)" : "Data: April 2026";
  }

  if (shouldPersist) {
    setUsingPersistedData(true);
    showResetDataButton();
  }
}

// ==================== Reset Data Button ====================
export function showResetDataButton() {
  var badge = document.getElementById("lastUpdated");
  if (document.getElementById("btnResetData")) return;
  var btn = document.createElement("button");
  btn.id = "btnResetData";
  btn.className = "export-btn export-btn-sm";
  btn.style.marginLeft = "8px";
  btn.title = "Discard uploaded data and revert to bundled dataset";
  btn.textContent = "Reset to bundled";
  btn.addEventListener("click", function () {
    if (!confirm("Revert to the bundled dataset? Uploaded data will be discarded.")) return;
    btn.disabled = true;
    clearPersistedDataset()
      .then(function () {
        setUsingPersistedData(false);
        setSavedUploadedAt(null);
        state.excludedZips = {};
        state.identifiedZips = {};
        var bundled = typeof APP_DATA !== "undefined" ? APP_DATA : (window.APP_DATA || null);
        refreshAppWithData(bundled, { persist: false, label: "Data: April 2026", excludedZips: {}, identifiedZips: {} });
        var rb = document.getElementById("btnResetData");
        if (rb) rb.remove();
      })
      .catch(function (err) {
        btn.disabled = false;
        alert("Could not reset saved data: " + err.message);
      });
  });
  badge.parentNode.appendChild(btn);
}

// ==================== Upload Event Wiring ====================
export function setupUploadEvents() {
  var formDiv = document.getElementById("uploadForm");
  var fileMaster = document.getElementById("fileMaster");
  var processBtn = document.getElementById("btnProcessUpload");
  var statusEl = document.getElementById("uploadStatus");

  if (!formDiv || !fileMaster) return;

  // Enable process button when file selected
  fileMaster.addEventListener("change", function () {
    processBtn.disabled = !fileMaster.files.length;
  });

  processBtn.addEventListener("click", function () {
    if (!fileMaster.files.length) return;

    statusEl.textContent = "Reading file...";
    statusEl.className = "upload-hint";
    processBtn.disabled = true;

    var reader = new FileReader();
    reader.onload = function (evt) {
      try {
        statusEl.textContent = "Parsing JSON...";
        var raw = JSON.parse(evt.target.result);

        if (!Array.isArray(raw)) throw new Error("Expected a JSON array of ZIP entries.");
        if (raw.length === 0) throw new Error("JSON array is empty.");

        // Validate first entry has expected fields
        var first = raw[0];
        if (!first.zipcode && !first.postcode) {
          throw new Error("JSON entries must have a 'zipcode' or 'postcode' field.");
        }

        statusEl.textContent = "Processing " + raw.length + " entries...";
        var newData = preprocessMasterJSON(raw);

        statusEl.textContent = "Saving processed dataset...";
        saveDatasetToServer(newData)
          .then(function (result) {
            setSavedUploadedAt(result && result.uploaded_at ? result.uploaded_at : null);
            refreshAppWithData(newData, { persist: true, label: "Data: uploaded (persisted)" });
            statusEl.textContent = "Done. " + newData.stats.total_zips + " ZIPs (" +
              newData.stats.covered_zips + " covered, " +
              newData.stats.covered_new_zips + " covered new, " +
              newData.stats.potential_zips + " potential, " +
              newData.stats.prospect_zips + " prospect, " +
              newData.stats.excluded_zips + " excluded).";
            statusEl.className = "upload-hint upload-success";
            processBtn.disabled = false;
          })
          .catch(function (err) {
            statusEl.textContent = "Error: Could not save. " + err.message;
            statusEl.className = "upload-hint upload-error";
            processBtn.disabled = false;
          });
      } catch (err) {
        statusEl.textContent = "Error: " + err.message;
        statusEl.className = "upload-hint upload-error";
        processBtn.disabled = false;
      }
    };
    reader.onerror = function () {
      statusEl.textContent = "Error reading file.";
      statusEl.className = "upload-hint upload-error";
      processBtn.disabled = false;
    };

    reader.readAsText(fileMaster.files[0]);
  });
}
