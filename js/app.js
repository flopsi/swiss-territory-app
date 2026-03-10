/**
 * app.js — Bootstrap / init. Wires up all modules.
 */

import {
  state, setActiveData, setUsingPersistedData,
  setSavedStateLoaded, setSavedUploadedAt,
  getUsingPersistedData, buildZipDataMap,
} from "./state.js";
import { loadSavedState } from "./api.js";
import {
  setupMap, loadBoundaries, clearSelection,
  updateSelectionTray, refreshStyles, markSelectedExcluded,
  undoLastAction, setOnExcludeCallback, setRenderAnomalyTable,
} from "./map.js";
import {
  populateSelects, populateAMButtons, syncAMButtons,
  onFilterChange, updateStats, updateLegend, renderAnomalyTable,
} from "./filters.js";
import { queryZefix, updateZefixSelectionCount, exportZefixResults, queueSelectedZefixForNotion } from "./zefix.js";
import { exportAnomalies, exportExcludedZips, exportSelectedZips } from "./exports.js";
import { setupUploadEvents, showResetDataButton } from "./uploads.js";

// ==================== Init ====================
function init() {
  document.getElementById("lastUpdated").textContent = "Loading data...";

  loadSavedState().then(function (savedState) {
    savedState = savedState || {};
    setSavedStateLoaded(true);
    setSavedUploadedAt(savedState.uploaded_at || null);

    if (savedState.dataset) {
      setActiveData(savedState.dataset);
      setUsingPersistedData(true);
    }
    state.excludedZips = savedState.excluded_zips || {};

    // Wire up the anomaly table renderer for map.js's renderGeoLayer callback
    setRenderAnomalyTable(renderAnomalyTable);

    // Wire up stats/legend refresh after exclude changes
    setOnExcludeCallback(function () {
      updateStats();
      updateLegend();
    });

    buildZipDataMap();
    setupMap();
    loadBoundaries();
    populateSelects();
    populateAMButtons();
    setupEventListeners();
    setupUploadEvents();
    updateStats();
    updateLegend();
    renderAnomalyTable();

    if (getUsingPersistedData()) {
      document.getElementById("lastUpdated").textContent = "Data: uploaded (persisted)";
      showResetDataButton();
    } else {
      document.getElementById("lastUpdated").textContent = "Data: March 2026";
    }
  });
}

// ==================== Event Listeners ====================
function setupEventListeners() {
  // Manager multi-select change handler
  document.getElementById("filterManager").addEventListener("change", function (e) {
    var sel = e.target;
    // If "All Managers" (value="") is selected, deselect everything
    if (sel.options[0] && sel.options[0].selected && sel.options[0].value === "") {
      for (var j = 0; j < sel.options.length; j++) sel.options[j].selected = false;
      state.filterManagers = [];
      syncAMButtons();
      onFilterChange();
      return;
    }
    var vals = [];
    for (var i = 0; i < sel.options.length; i++) {
      if (sel.options[i].selected && sel.options[i].value) vals.push(sel.options[i].value);
    }
    state.filterManagers = vals;
    syncAMButtons();
    onFilterChange();
  });

  document.getElementById("filterTerritory").addEventListener("change", function (e) {
    state.filterTerritory = e.target.value;
    onFilterChange();
  });

  document.getElementById("filterStatus").addEventListener("change", function (e) {
    state.filterStatus = e.target.value;
    onFilterChange();
  });

  // Color mode radios
  document.querySelectorAll('input[name="colorMode"]').forEach(function (radio) {
    radio.addEventListener("change", function (e) {
      state.colorMode = e.target.value;
      updateLegend();
      refreshStyles();
    });
  });

  // AM quick buttons (toggle multi-select)
  document.getElementById("amButtons").addEventListener("click", function (e) {
    var btn = e.target.closest(".am-btn");
    if (!btn) return;
    var mgr = btn.dataset.manager;

    // Toggle: add or remove from multi-select
    var idx = state.filterManagers.indexOf(mgr);
    if (idx >= 0) {
      state.filterManagers.splice(idx, 1);
    } else {
      state.filterManagers.push(mgr);
    }
    // Sync native select
    var sel = document.getElementById("filterManager");
    for (var si = 0; si < sel.options.length; si++) {
      sel.options[si].selected = state.filterManagers.indexOf(sel.options[si].value) >= 0;
    }
    syncAMButtons();
    onFilterChange();
  });

  // V1 anomaly bar toggle → opens anomaly overlay on map
  var anomalyBarToggle = document.getElementById("anomalyBarToggle");
  var anomalyPanel = document.getElementById("anomalySection");
  var closeAnomalyBtn = document.getElementById("closeAnomalyPanel");

  if (anomalyBarToggle) {
    anomalyBarToggle.addEventListener("click", function () {
      var bar = document.getElementById("anomalyBar");
      if (anomalyPanel.style.display === "flex") {
        anomalyPanel.style.display = "none";
        bar.classList.remove("expanded");
      } else {
        anomalyPanel.style.display = "flex";
        bar.classList.add("expanded");
      }
    });
  }
  if (closeAnomalyBtn) {
    closeAnomalyBtn.addEventListener("click", function () {
      anomalyPanel.style.display = "none";
      var bar = document.getElementById("anomalyBar");
      bar.classList.remove("expanded");
    });
  }

  // Selection tray events
  document.getElementById("trayChips").addEventListener("click", function (e) {
    var removeBtn = e.target.closest(".chip-remove");
    if (removeBtn) {
      var zip = removeBtn.dataset.zip;
      delete state.selectedZips[zip];
      refreshStyles();
      updateSelectionTray();
    }
  });

  document.getElementById("btnClearSelection").addEventListener("click", clearSelection);
  document.getElementById("btnExportSelected").addEventListener("click", exportSelectedZips);
  document.getElementById("btnZefix").addEventListener("click", queryZefix);
  document.getElementById("btnMarkExcluded").addEventListener("click", markSelectedExcluded);

  // Export buttons
  document.getElementById("exportAnomalies").addEventListener("click", exportAnomalies);
  document.getElementById("exportExcluded").addEventListener("click", exportExcludedZips);

  // ZEFIX panel
  document.getElementById("closeZefix").addEventListener("click", function () {
    document.getElementById("zefixPanel").style.display = "none";
  });
  document.getElementById("exportZefix").addEventListener("click", exportZefixResults);
  document.getElementById("queueNotionBatch").addEventListener("click", queueSelectedZefixForNotion);

  // ZEFIX select-all checkbox
  var zefixSelAll = document.getElementById("zefixSelectAll");
  if (zefixSelAll) {
    zefixSelAll.addEventListener("change", function () {
      var checked = zefixSelAll.checked;
      state.zefixChecked = state.zefixChecked.map(function () { return checked; });
      document.querySelectorAll(".zefix-row-cb").forEach(function (cb) { cb.checked = checked; });
      updateZefixSelectionCount();
    });
  }

  // ZEFIX individual row checkboxes (delegated)
  document.getElementById("zefixBody").addEventListener("change", function (e) {
    if (e.target.classList.contains("zefix-row-cb")) {
      var idx = parseInt(e.target.dataset.idx, 10);
      state.zefixChecked[idx] = e.target.checked;
      // Sync select-all
      var allChecked = state.zefixChecked.every(Boolean);
      var selAllCb = document.getElementById("zefixSelectAll");
      if (selAllCb) selAllCb.checked = allChecked;
      updateZefixSelectionCount();
    }
  });

  // Keyboard shortcut: Ctrl+Z for undo
  document.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === "z") {
      e.preventDefault();
      undoLastAction();
    }
  });
}

// ==================== Start ====================
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
