/**
 * app.js — Bootstrap / init. Wires up all modules.
 */

import {
  state, getActiveData, setActiveData, setUsingPersistedData,
  setSavedStateLoaded, setSavedUploadedAt,
  getUsingPersistedData, buildZipDataMap,
} from "./state.js";
import {
  probeBackend, isBackendMode, isViewOnly, login, logout,
  loadSavedState, loadAppData, loadTopoJSON, uploadExcludedZips,
} from "./api.js";
import {
  setupMap, loadBoundaries, clearSelection,
  updateSelectionTray, refreshStyles, markSelectedExcluded,
  markSelectedIdentified, undoLastAction, setOnExcludeCallback, setRenderAnomalyTable,
} from "./map.js";
import {
  populateSelects, populateAMButtons, syncAMButtons,
  onFilterChange, onSearchChange, updateStats, updateLegend, renderAnomalyTable,
} from "./filters.js";
import { queryZefix, updateZefixSelectionCount, exportZefixResults, queueSelectedZefixForNotion, saveSelectedToSessionMemory, clearSessionMemory } from "./zefix.js";
import { exportAnomalies, exportExcludedZips, exportIdentifiedZips, exportSelectedZips } from "./exports.js";
import { setupUploadEvents, showResetDataButton } from "./uploads.js";
import { runSonarSearch, refreshCostDisplay, refreshAMSummary, refreshLeaderboard, updateMemoryCount, downloadSonarCSV } from "./perplexity.js";
import { initAnalytics, trackEvent } from "./analytics.js";

// ==================== Login Screen ====================
function showLoginScreen() {
  var overlay = document.getElementById("loginOverlay");
  if (overlay) overlay.style.display = "flex";
}

function hideLoginScreen() {
  var overlay = document.getElementById("loginOverlay");
  if (overlay) overlay.style.display = "none";
}

function setupLoginForm() {
  var form = document.getElementById("loginForm");
  if (!form) return;
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var user = document.getElementById("loginUser").value.trim();
    var pass = document.getElementById("loginPass").value;
    var errEl = document.getElementById("loginError");
    var btn = form.querySelector("button[type=submit]");
    errEl.textContent = "";
    btn.disabled = true;

    login(user, pass)
      .then(function () {
        trackEvent("login_success");
        hideLoginScreen();
        initApp();
      })
      .catch(function (err) {
        errEl.textContent = err.message || "Login failed";
        btn.disabled = false;
      });
  });
}

function setupLogoutButton() {
  var btn = document.getElementById("btnLogout");
  if (!btn) return;
  btn.style.display = "inline-block";
  btn.addEventListener("click", function () {
    logout().then(function () {
      window.location.reload();
    });
  });
}

// ==================== View-Only Mode ====================
function disableWriteControls() {
  // Disable buttons that modify persisted state
  var writeButtons = [
    "btnMarkExcluded", "btnMarkIdentified", "btnProcessUpload",
    "btnUploadExcluded", "btnResetData", "queueNotionBatch",
    "btnSonarSearch", "btnRememberSelected", "btnClearMemory",
  ];
  writeButtons.forEach(function (id) {
    var el = document.getElementById(id);
    if (el) {
      el.disabled = true;
      el.title = "View-only account — modifications not permitted";
    }
  });
  // Hide upload sections entirely
  var uploadSections = ["excludedUploadSection"];
  uploadSections.forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.style.display = "none";
  });
  // Collapse upload data section
  var uploadDetails = document.querySelector("details.sidebar-section-collapsible");
  if (uploadDetails) {
    var summary = uploadDetails.querySelector("summary");
    if (summary && summary.textContent.indexOf("Upload") >= 0) {
      uploadDetails.style.display = "none";
    }
  }
}

// ==================== Excluded ZIP Upload ====================
function setupExcludedUpload() {
  var section = document.getElementById("excludedUploadSection");
  if (!section) return;

  // Only show in backend mode
  if (!isBackendMode()) {
    section.style.display = "none";
    return;
  }

  var fileInput = document.getElementById("fileExcluded");
  var processBtn = document.getElementById("btnUploadExcluded");
  var statusEl = document.getElementById("excludedUploadStatus");

  if (!fileInput || !processBtn) return;

  section.style.display = "block";

  processBtn.addEventListener("click", function () {
    if (!fileInput.files.length) {
      statusEl.textContent = "Please select a file first.";
      statusEl.className = "upload-hint upload-error";
      return;
    }

    processBtn.disabled = true;
    statusEl.textContent = "Reading file...";
    statusEl.className = "upload-hint";

    var reader = new FileReader();
    reader.onload = function (evt) {
      var text = evt.target.result;
      var zips = text.split(/[\r\n,]+/).map(function (s) { return s.trim(); }).filter(Boolean);

      if (zips.length === 0) {
        statusEl.textContent = "No ZIP codes found in file.";
        statusEl.className = "upload-hint upload-error";
        processBtn.disabled = false;
        return;
      }

      statusEl.textContent = "Uploading " + zips.length + " ZIP codes...";

      uploadExcludedZips(zips)
        .then(function (result) {
          statusEl.textContent = "Added " + result.added + " excluded ZIPs (total: " + result.total + ")." +
            (result.invalid.length > 0 ? " Invalid: " + result.invalid.join(", ") : "");
          statusEl.className = "upload-hint upload-success";
          processBtn.disabled = false;

          // Reload excluded state
          loadSavedState().then(function (saved) {
            state.excludedZips = saved.excluded_zips || {};
            refreshStyles();
            updateStats();
            updateLegend();
          });
        })
        .catch(function (err) {
          statusEl.textContent = "Upload failed: " + err.message;
          statusEl.className = "upload-hint upload-error";
          processBtn.disabled = false;
        });
    };
    reader.readAsText(fileInput.files[0]);
  });
}

// ==================== Init App ====================
function initApp() {
  document.getElementById("lastUpdated").textContent = "Loading data...";

  var dataPromise = isBackendMode() ? loadAppData() : Promise.resolve(null);
  var topoPromise = isBackendMode() ? loadTopoJSON() : Promise.resolve(null);
  var savedPromise = loadSavedState();

  Promise.all([dataPromise, topoPromise, savedPromise]).then(function (results) {
    var apiData = results[0];
    var topoData = results[1];
    var savedState = results[2] || {};

    setSavedStateLoaded(true);
    setSavedUploadedAt(savedState.uploaded_at || null);

    if (apiData) {
      setActiveData(apiData);
    } else if (savedState.dataset) {
      setActiveData(savedState.dataset);
      setUsingPersistedData(true);
    } else if (typeof APP_DATA !== "undefined" && APP_DATA) {
      // Static mode: fall back to bundled data loaded via <script> tag
      setActiveData(APP_DATA);
    }

    if (!getActiveData()) {
      document.getElementById("lastUpdated").textContent = "No data available. Please upload.";
      return;
    }

    state.excludedZips = savedState.excluded_zips || {};
    state.identifiedZips = savedState.identified_zips || {};

    if (topoData) {
      window.CH_PLZ_TOPOJSON = topoData;
    }

    setRenderAnomalyTable(renderAnomalyTable);
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
    setupExcludedUpload();
    updateStats();
    updateLegend();
    renderAnomalyTable();

    if (isBackendMode()) {
      var roleLabel = isViewOnly() ? " (view-only)" : "";
      document.getElementById("lastUpdated").textContent = "Data: loaded from server" + roleLabel;
      setupLogoutButton();
      // Load Sonar-related data
      refreshCostDisplay();
      refreshAMSummary();
      refreshLeaderboard();
      if (isViewOnly()) {
        disableWriteControls();
      }
    } else if (getUsingPersistedData()) {
      document.getElementById("lastUpdated").textContent = "Data: uploaded (persisted)";
      showResetDataButton();
    } else {
      document.getElementById("lastUpdated").textContent = "Data: March 2026";
    }
  }).catch(function (err) {
    console.error("Init error:", err);
    document.getElementById("lastUpdated").textContent = "Error: " + err.message;
  });
}

// ==================== Startup ====================
function startup() {
  initAnalytics();
  setupLoginForm();

  probeBackend().then(function (meResult) {
    if (isBackendMode()) {
      if (meResult.authenticated) {
        hideLoginScreen();
        initApp();
      } else {
        showLoginScreen();
      }
    } else {
      hideLoginScreen();
      initApp();
    }
  });
}

// ==================== Event Listeners ====================
function setupEventListeners() {
  // Manager multi-select change handler
  document.getElementById("filterManager").addEventListener("change", function (e) {
    var sel = e.target;
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

    var idx = state.filterManagers.indexOf(mgr);
    if (idx >= 0) {
      state.filterManagers.splice(idx, 1);
    } else {
      state.filterManagers.push(mgr);
    }
    var sel = document.getElementById("filterManager");
    for (var si = 0; si < sel.options.length; si++) {
      sel.options[si].selected = state.filterManagers.indexOf(sel.options[si].value) >= 0;
    }
    syncAMButtons();
    onFilterChange();
  });

  // V1 anomaly bar toggle
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
  document.getElementById("btnZefix").addEventListener("click", function () {
    trackEvent("zefix_query");
    queryZefix();
  });
  document.getElementById("btnMarkIdentified").addEventListener("click", markSelectedIdentified);
  document.getElementById("btnMarkExcluded").addEventListener("click", markSelectedExcluded);

  // Export buttons
  document.getElementById("exportAnomalies").addEventListener("click", exportAnomalies);
  document.getElementById("exportExcluded").addEventListener("click", exportExcludedZips);
  document.getElementById("exportIdentified").addEventListener("click", function () {
    trackEvent("export_identified");
    exportIdentifiedZips();
  });

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
      var allChecked = state.zefixChecked.every(Boolean);
      var selAllCb = document.getElementById("zefixSelectAll");
      if (selAllCb) selAllCb.checked = allChecked;
      updateZefixSelectionCount();
    }
  });

  // ZEFIX purpose keyword filter
  var purposeInput = document.getElementById("zefixPurposeFilter");
  if (purposeInput) {
    purposeInput.addEventListener("input", function () {
      filterZefixByPurpose();
    });
  }

  // ZIP / City search
  var zipSearchInput = document.getElementById("zipSearch");
  if (zipSearchInput) {
    var searchDebounce = null;
    zipSearchInput.addEventListener("input", function () {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(function () {
        state.filterSearch = zipSearchInput.value.trim();
        onSearchChange();
        refreshStyles();
      }, 200);
    });
  }

  // ZEFIX purpose preset buttons
  var presetBar = document.querySelector(".zefix-filter-bar-presets");
  if (presetBar) {
    presetBar.addEventListener("click", function (e) {
      var btn = e.target.closest(".zefix-preset-btn");
      if (!btn) return;
      var keywords = btn.dataset.keywords || "";
      var purposeInput = document.getElementById("zefixPurposeFilter");
      if (!purposeInput) return;

      // Toggle: if same preset is active, clear it
      var wasActive = btn.classList.contains("active");
      presetBar.querySelectorAll(".zefix-preset-btn").forEach(function (b) { b.classList.remove("active"); });

      if (wasActive || !keywords) {
        purposeInput.value = "";
        btn.classList.remove("active");
      } else {
        purposeInput.value = keywords;
        btn.classList.add("active");
      }
      filterZefixByPurpose();
    });
  }

  // Sonar-Pro / Perplexity buttons
  var btnRemember = document.getElementById("btnRememberSelected");
  if (btnRemember) {
    btnRemember.addEventListener("click", function () {
      var added = saveSelectedToSessionMemory();
      updateMemoryCount();
      if (added > 0) {
        showNotionQueueStatusTemp("Remembered " + added + " new companies for Sonar search.", "zefix-success");
      } else {
        showNotionQueueStatusTemp("No new companies to add (already in memory or none selected).", "zefix-loading");
      }
    });
  }

  var btnSonar = document.getElementById("btnSonarSearch");
  if (btnSonar) {
    btnSonar.addEventListener("click", function () {
      trackEvent("sonar_search_clicked");
      runSonarSearch();
    });
  }

  var btnClearMem = document.getElementById("btnClearMemory");
  if (btnClearMem) {
    btnClearMem.addEventListener("click", function () {
      clearSessionMemory();
      updateMemoryCount();
      showNotionQueueStatusTemp("Session memory cleared.", "zefix-loading");
    });
  }

  var btnDownloadSonar = document.getElementById("btnDownloadSonar");
  if (btnDownloadSonar) {
    btnDownloadSonar.addEventListener("click", function () {
      trackEvent("sonar_download_csv");
      downloadSonarCSV();
    });
  }

  // Keyboard shortcut: Ctrl+Z for undo
  document.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === "z") {
      e.preventDefault();
      undoLastAction();
    }
  });
}

function showNotionQueueStatusTemp(msg, cls) {
  var el = document.getElementById("sonarStatus");
  if (!el) return;
  el.textContent = msg;
  el.className = "zefix-status " + (cls || "");
  el.style.display = "block";
  setTimeout(function () { el.style.display = "none"; }, 4000);
}

// ==================== ZEFIX Purpose Filter ====================
function filterZefixByPurpose() {
  var input = document.getElementById("zefixPurposeFilter");
  if (!input) return;
  var keywords = input.value.trim().toLowerCase().split(/[,;]+/).map(function (s) { return s.trim(); }).filter(Boolean);

  var rows = document.querySelectorAll("#zefixBody tr");
  var visibleCount = 0;

  rows.forEach(function (tr, idx) {
    if (keywords.length === 0) {
      tr.style.display = "";
      visibleCount++;
      return;
    }
    var result = state.zefixResults[idx];
    if (!result) { tr.style.display = "none"; return; }
    var purposeLC = (result.purpose || "").toLowerCase();
    var nameLC = (result.legalName || "").toLowerCase();
    var match = keywords.some(function (kw) {
      return purposeLC.indexOf(kw) >= 0 || nameLC.indexOf(kw) >= 0;
    });
    tr.style.display = match ? "" : "none";
    if (match) visibleCount++;
  });

  var countEl = document.getElementById("zefixFilterCount");
  if (countEl) {
    countEl.textContent = keywords.length > 0
      ? visibleCount + "/" + state.zefixResults.length + " matching"
      : "";
  }
}

// Make accessible for zefix.js after render
window._filterZefixByPurpose = filterZefixByPurpose;

// ==================== Start ====================
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startup);
} else {
  startup();
}
