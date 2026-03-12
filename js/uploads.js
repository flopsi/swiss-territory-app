/**
 * uploads.js — CSV upload, client-side preprocessing, and refresh-app-with-data.
 */

import {
  state, getActiveData, setActiveData,
  setUsingPersistedData, getUsingPersistedData,
  setSavedUploadedAt, buildZipDataMap,
} from "./state.js";
import { parseCSV, normalizeZip } from "./utils.js";
import { saveDatasetToServer, clearPersistedDataset } from "./api.js";
import { renderGeoLayer, renderTerritoryBorders, updateSelectionTray, refreshStyles } from "./map.js";
import {
  populateSelects, populateAMButtons, clearSelectOptions,
  updateStats, updateLegend, renderAnomalyTable,
} from "./filters.js";
import { showNotionQueueStatus } from "./zefix.js";

// ==================== Client-Side Preprocessing ====================
function preprocessUploadedCSVs(sfdcRows, territoryRows) {
  // --- Build master from territory CSV ---
  var masterByZip = {};
  territoryRows.forEach(function (row) {
    var z = normalizeZip(row["Postcode"]);
    if (!z) return;
    masterByZip[z] = {
      postcode: z,
      territory_id: (row["Territory_ID"] || "").trim(),
      account_manager: (row["AM 2026"] || "").trim(),
      official_city: "",
      canton: "",
    };
  });

  // --- Build SFDC aggregation ---
  var sfdcByZip = {};
  sfdcRows.forEach(function (row) {
    var z = normalizeZip(row["zip"]);
    if (!z) return;
    if (!sfdcByZip[z]) {
      sfdcByZip[z] = { accounts: [], managers: {}, territories: {} };
    }
    sfdcByZip[z].accounts.push({
      id: (row["SF Account ID"] || "").trim(),
      name: (row["Accounts Name"] || "").trim(),
    });
    var mgr = (row["CMD Account Manager"] || "").trim();
    if (mgr) sfdcByZip[z].managers[mgr] = true;
  });

  // --- Manager name mapping (SFDC -> territory) ---
  var masterManagers = {};
  Object.keys(masterByZip).forEach(function (z) {
    var m = masterByZip[z].account_manager;
    if (m) masterManagers[m.toLowerCase()] = m;
  });

  function mapManager(sfdcName) {
    if (!sfdcName) return sfdcName;
    var lc = sfdcName.toLowerCase();
    if (masterManagers[lc]) return masterManagers[lc];
    // Partial (last-name) match
    var sParts = lc.split(/\s+/);
    var bestMatch = null;
    var bestScore = 0;
    Object.keys(masterManagers).forEach(function (mk) {
      var mkParts = mk.split(/\s+/);
      var shared = 0;
      sParts.forEach(function (sp) {
        if (mkParts.indexOf(sp) >= 0) shared++;
      });
      if (shared > bestScore) {
        bestScore = shared;
        bestMatch = masterManagers[mk];
      }
    });
    return bestScore >= 1 && bestMatch ? bestMatch : sfdcName;
  }

  // --- Merge ---
  var merged = [];
  Object.keys(masterByZip).sort().forEach(function (z) {
    var mdata = masterByZip[z];
    var sdata = sfdcByZip[z];
    var entry = {
      postcode: mdata.postcode,
      territory_id: mdata.territory_id,
      account_manager: mdata.account_manager,
      official_city: mdata.official_city,
      canton: mdata.canton,
    };
    if (sdata) {
      entry.in_sfdc = true;
      entry.sfdc_account_count = sdata.accounts.length;
      entry.sfdc_accounts = sdata.accounts;
      entry.sfdc_managers = Object.keys(sdata.managers).map(mapManager).sort();
      entry.sfdc_territories = [mdata.territory_id];
      entry.status = "covered";
    } else {
      entry.in_sfdc = false;
      entry.sfdc_account_count = 0;
      entry.sfdc_accounts = [];
      entry.sfdc_managers = [];
      entry.sfdc_territories = [];
      entry.status = "potential";
    }
    merged.push(entry);
  });

  // --- SFDC-only (not in master) ---
  var sfdcOnly = [];
  Object.keys(sfdcByZip).forEach(function (z) {
    if (!masterByZip[z]) {
      var sd = sfdcByZip[z];
      sfdcOnly.push({
        postcode: z,
        sfdc_account_count: sd.accounts.length,
        sfdc_accounts: sd.accounts,
        sfdc_managers: Object.keys(sd.managers).map(mapManager).sort(),
        sfdc_territories: [],
        note: "present in SFDC but missing from master",
      });
    }
  });
  sfdcOnly.sort(function (a, b) { return a.postcode < b.postcode ? -1 : 1; });

  // --- Build metadata ---
  var territoriesSet = {};
  var managersSet = {};
  merged.forEach(function (e) {
    if (e.territory_id) territoriesSet[e.territory_id] = true;
    if (e.account_manager) managersSet[e.account_manager] = true;
  });
  var territories = Object.keys(territoriesSet).sort();
  var managers = Object.keys(managersSet).sort();

  // Color palettes
  var tPal = ["#e6194b","#3cb44b","#4363d8","#f58231","#911eb4","#42d4f4","#f032e6","#bfef45","#fabed4","#469990","#dcbeff","#9A6324","#fffac8","#800000","#aaffc3","#808000"];
  var mPal = ["#1b9e77","#d95f02","#7570b3","#e7298a","#66a61e","#e6ab02","#a6761d","#666666","#e41a1c","#377eb8","#4daf4a","#984ea3"];

  var territoryColors = {};
  territories.forEach(function (t, i) { territoryColors[t] = tPal[i % tPal.length]; });
  var managerColors = {};
  managers.forEach(function (m, i) { managerColors[m] = mPal[i % mPal.length]; });

  return {
    merged: merged,
    sfdc_only: sfdcOnly,
    territories: territories,
    managers: managers,
    territory_colors: territoryColors,
    manager_colors: managerColors,
    stats: {
      total_zips: merged.length,
      covered_zips: merged.filter(function (e) { return e.status === "covered"; }).length,
      potential_zips: merged.filter(function (e) { return e.status === "potential"; }).length,
      sfdc_only_zips: sfdcOnly.length,
      total_sfdc_accounts: merged.reduce(function (s, e) { return s + e.sfdc_account_count; }, 0),
    },
  };
}

// ==================== Refresh App State In-Place ====================
export function refreshAppWithData(newData, options) {
  options = options || {};
  var shouldPersist = options.persist !== false;
  var headerLabel = options.label || null;

  // Replace active dataset used by the app
  setActiveData(newData);
  window.APP_DATA = newData;

  if (Object.prototype.hasOwnProperty.call(options, "excludedZips")) {
    state.excludedZips = options.excludedZips || {};
  }

  // Reset state
  state.zipDataMap = {};
  state.anomalyZips = {};
  state.selectedZips = {};
  state.zefixResults = [];
  state.zefixChecked = [];
  state.filterManagers = [];
  state.filterTerritory = "";
  state.filterStatus = "";
  state.colorMode = "coverage";

  // Rebuild data map
  buildZipDataMap();

  // Clear and repopulate selects
  clearSelectOptions("filterManager");
  clearSelectOptions("filterTerritory");
  clearSelectOptions("filterStatus");
  populateSelects();

  // Rebuild AM buttons
  document.getElementById("amButtons").innerHTML = "";
  populateAMButtons();

  // Re-set radio to coverage
  var covRadio = document.querySelector('input[name="colorMode"][value="coverage"]');
  if (covRadio) covRadio.checked = true;

  // Re-render map layers
  renderGeoLayer();
  renderTerritoryBorders();

  // Update UI
  updateStats();
  updateLegend();
  renderAnomalyTable();
  updateSelectionTray();

  // Hide ZEFIX panel
  document.getElementById("zefixPanel").style.display = "none";
  showNotionQueueStatus("", "");

  // Update header badge
  if (headerLabel) {
    document.getElementById("lastUpdated").textContent = headerLabel;
  } else {
    document.getElementById("lastUpdated").textContent = shouldPersist ? "Data: uploaded (persisted)" : "Data: March 2026";
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
        var bundled = typeof APP_DATA !== "undefined" ? APP_DATA : (window.APP_DATA || null);
        refreshAppWithData(bundled, { persist: false, label: "Data: March 2026", excludedZips: {} });
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
  var fileSFDC = document.getElementById("fileSFDC");
  var fileTerritory = document.getElementById("fileTerritory");
  var processBtn = document.getElementById("btnProcessUpload");
  var statusEl = document.getElementById("uploadStatus");

  if (!formDiv) return; // guard

  // Enable process button when both files selected
  function checkFiles() {
    processBtn.disabled = !(fileSFDC.files.length && fileTerritory.files.length);
  }
  fileSFDC.addEventListener("change", checkFiles);
  fileTerritory.addEventListener("change", checkFiles);

  // Process
  processBtn.addEventListener("click", function () {
    statusEl.textContent = "Reading files...";
    statusEl.className = "upload-hint";
    processBtn.disabled = true;

    var readerSFDC = new FileReader();
    var readerTerritory = new FileReader();
    var sfdcText = null;
    var territoryText = null;

    function tryProcess() {
      if (sfdcText === null || territoryText === null) return;

      statusEl.textContent = "Parsing CSVs...";
      try {
        var sfdcRows = parseCSV(sfdcText);
        var territoryRows = parseCSV(territoryText);

        if (sfdcRows.length === 0) throw new Error("SFDC CSV is empty or unparseable.");
        if (territoryRows.length === 0) throw new Error("Territory CSV is empty or unparseable.");

        // Validate expected columns
        var sfdcCols = Object.keys(sfdcRows[0]);
        if (sfdcCols.indexOf("Accounts Name") < 0 || sfdcCols.indexOf("zip") < 0) {
          throw new Error("SFDC CSV missing expected columns (Accounts Name, SF Account ID, CMD Account Manager, zip). Found: " + sfdcCols.join(", "));
        }
        var terrCols = Object.keys(territoryRows[0]);
        if (terrCols.indexOf("Postcode") < 0 || terrCols.indexOf("Territory_ID") < 0) {
          throw new Error("Territory CSV missing expected columns (Postcode, Territory_ID, AM 2026). Found: " + terrCols.join(", "));
        }

        statusEl.textContent = "Processing " + sfdcRows.length + " SFDC rows + " + territoryRows.length + " territory rows...";

        var newData = preprocessUploadedCSVs(sfdcRows, territoryRows);
        statusEl.textContent = "Saving processed dataset...";
        saveDatasetToServer(newData)
          .then(function (result) {
            setSavedUploadedAt(result && result.uploaded_at ? result.uploaded_at : null);
            refreshAppWithData(newData, { persist: true, label: "Data: uploaded (persisted)" });
            statusEl.textContent = "Done. " + newData.stats.total_zips + " ZIPs (" + newData.stats.covered_zips + " covered, " + newData.stats.potential_zips + " potential, " + newData.stats.sfdc_only_zips + " exceptions).";
            statusEl.className = "upload-hint upload-success";
            processBtn.disabled = false;
          })
          .catch(function (err) {
            statusEl.textContent = "Error: Could not save the uploaded dataset. " + err.message;
            statusEl.className = "upload-hint upload-error";
            processBtn.disabled = false;
            console.error("Upload save error:", err);
          });
        return;
      } catch (err) {
        statusEl.textContent = "Error: " + err.message;
        statusEl.className = "upload-hint upload-error";
        console.error("Upload processing error:", err);
      }

      processBtn.disabled = false;
    }

    readerSFDC.onload = function (e) {
      sfdcText = e.target.result;
      tryProcess();
    };
    readerTerritory.onload = function (e) {
      territoryText = e.target.result;
      tryProcess();
    };
    readerSFDC.onerror = function () {
      statusEl.textContent = "Error reading SFDC file.";
      statusEl.className = "upload-hint upload-error";
      processBtn.disabled = false;
    };
    readerTerritory.onerror = function () {
      statusEl.textContent = "Error reading Territory file.";
      statusEl.className = "upload-hint upload-error";
      processBtn.disabled = false;
    };

    readerSFDC.readAsText(fileSFDC.files[0]);
    readerTerritory.readAsText(fileTerritory.files[0]);
  });
}
