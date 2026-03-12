/**
 * map.js — Leaflet map setup, polygon rendering, tooltips, and ZIP selection.
 */

import {
  state, getActiveData, getEffectiveStatus, getZipColor,
  hasActiveFilters, isFiltered, getExceptionInfo, coverageColors,
} from "./state.js";
import { escapeHTML } from "./utils.js";
import { saveExcluded } from "./api.js";

// ==================== Map Setup ====================
export function setupMap() {
  state.map = L.map("map", {
    center: [46.8, 8.2],
    zoom: 8,
    minZoom: 7,
    maxZoom: 14,
    zoomControl: true,
    attributionControl: true,
    preferCanvas: true,
  });

  // V1: CartoDB Positron basemap for city labels and Swiss-map feel
  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: "abcd",
    maxZoom: 20,
  }).addTo(state.map);
}

// ==================== Load TopoJSON Boundaries ====================
export function loadBoundaries() {
  try {
    var topo = window.CH_PLZ_TOPOJSON || null;
    if (!topo || !topo.objects || !topo.objects.plz) {
      console.warn("No TopoJSON boundary data loaded. Upload data or provide ch-plz.js to enable the map.");
      return;
    }

    var geojson = topojson.feature(topo, topo.objects.plz);
    state.topoFeatures = geojson.features;

    state.topoFeatures.forEach(function (f) {
      var zip = String(f.id).padStart(4, "0");
      state.topoFeaturesById[zip] = f;
    });

    renderGeoLayer();
    renderTerritoryBorders();
    if (state.geoLayer) {
      state.map.fitBounds(state.geoLayer.getBounds(), { padding: [16, 16] });
    }
    setTimeout(function () {
      state.map.invalidateSize();
    }, 0);
  } catch (err) {
    console.error("Failed to load TopoJSON:", err);
  }
}

// ==================== Render Geo Layer ====================
export function renderGeoLayer() {
  if (state.geoLayer) {
    state.map.removeLayer(state.geoLayer);
  }

  state.geoLayer = L.geoJSON(state.topoFeatures, {
    style: styleFeature,
    onEachFeature: onEachFeature,
  }).addTo(state.map);

  if (state.territoryBorderLayer) {
    state.territoryBorderLayer.bringToFront();
  }

  // Also update exception table when geo layer re-renders
  renderAnomalyTableIfReady();
}

// ==================== Territory Borders ====================
export function renderTerritoryBorders() {
  var data = getActiveData();
  if (state.territoryBorderLayer) {
    state.map.removeLayer(state.territoryBorderLayer);
  }

  var filtersActive = hasActiveFilters();
  var territoryFeatures = {};
  data.merged.forEach(function (entry) {
    var feat = state.topoFeaturesById[entry.postcode];
    if (!feat) return;
    // When filters are active, only include borders for non-filtered entries
    if (filtersActive) {
      var zipEntry = state.zipDataMap[entry.postcode];
      if (isFiltered(zipEntry)) return;
    }
    var tid = entry.territory_id;
    if (!territoryFeatures[tid]) territoryFeatures[tid] = [];
    territoryFeatures[tid].push(feat);
  });

  var borderFeatures = [];
  Object.keys(territoryFeatures).forEach(function (tid) {
    var feats = territoryFeatures[tid];
    feats.forEach(function (f) {
      borderFeatures.push({
        type: "Feature",
        properties: { territory: tid },
        geometry: f.geometry,
      });
    });
  });

  // V1 style: thinner, more subtle territory borders
  state.territoryBorderLayer = L.geoJSON(borderFeatures, {
    style: function (feature) {
      var color = data.territory_colors[feature.properties.territory] || "#666";
      return {
        fillColor: "transparent",
        fillOpacity: 0,
        weight: 0.8,
        color: color,
        opacity: 0.25,
        dashArray: "4 3",
        interactive: false,
      };
    },
    interactive: false,
  }).addTo(state.map);

  state.territoryBorderLayer.bringToFront();
}

// ==================== Feature Styling ====================
// V1 style: softer, slightly more transparent territory fills
// When filters are active, unselected territories become invisible
function styleFeature(feature) {
  var zip = String(feature.id).padStart(4, "0");
  var entry = state.zipDataMap[zip];
  var filtered = isFiltered(entry);
  var isSelected = state.selectedZips[zip];
  var filtersActive = hasActiveFilters();

  if (isSelected) {
    return {
      fillColor: "#2563eb",
      fillOpacity: 0.55,
      weight: 1.5,
      color: "#1d4ed8",
      opacity: 0.9,
    };
  }

  if (filtered) {
    // When filters are active, hide unselected territories completely
    if (filtersActive) {
      return {
        fillColor: "transparent",
        fillOpacity: 0,
        weight: 0,
        color: "transparent",
        opacity: 0,
      };
    }
    // No filters active + entry has no data → normal unmatched look
    return {
      fillColor: "#eaecf0",
      fillOpacity: 0.12,
      weight: 0.3,
      color: "#d0d5dd",
      opacity: 0.25,
    };
  }

  return {
    fillColor: getZipColor(entry),
    fillOpacity: 0.40,
    weight: 0.4,
    color: "rgba(255,255,255,0.55)",
    opacity: 0.65,
  };
}

// ==================== Tooltip / Interaction ====================
function onEachFeature(feature, layer) {
  var zip = String(feature.id).padStart(4, "0");
  var entry = state.zipDataMap[zip];

  layer.on({
    mouseover: function (e) {
      var l = e.target;
      l.setStyle({
        weight: 1.5,
        color: "#1e40af",
        fillOpacity: 0.7,
      });
      l.bringToFront();
      if (state.territoryBorderLayer) state.territoryBorderLayer.bringToFront();
    },
    mouseout: function (e) {
      state.geoLayer.resetStyle(e.target);
      if (state.territoryBorderLayer) state.territoryBorderLayer.bringToFront();
    },
    click: function () {
      toggleZipSelection(zip);
    },
  });

  var tooltipHTML = buildTooltip(zip, entry);
  layer.bindTooltip(tooltipHTML, {
    sticky: true,
    className: "zip-tooltip",
    direction: "auto",
  });
}

export function buildTooltip(zip, entry) {
  if (!entry) {
    return (
      '<div class="tt-zip">' + zip + '</div>' +
      '<div class="tt-row"><span class="tt-label">Status</span><span class="tt-val" style="color:#94a3b8;">Not in master file</span></div>'
    );
  }

  var eff = getEffectiveStatus(entry);
  var statusLabels = { covered: "Covered", potential: "Potential", exception: "Exception (SFDC only)", excluded: "Excluded" };
  var statusClasses = { covered: "covered", potential: "potential", exception: "anomaly", excluded: "excluded" };

  var html =
    '<div class="tt-zip">' + zip + (entry.official_city ? " &mdash; " + escapeHTML(entry.official_city) : "") + '</div>';

  if (entry.canton) {
    html += '<div class="tt-row"><span class="tt-label">Canton</span><span class="tt-val">' + escapeHTML(entry.canton) + '</span></div>';
  }

  html +=
    '<div class="tt-row"><span class="tt-label">Manager</span><span class="tt-val">' + escapeHTML(entry.account_manager || (entry.sfdc_managers || []).join(", ")) + '</span></div>' +
    '<div class="tt-row"><span class="tt-label">Territory</span><span class="tt-val">' + escapeHTML((entry.territory_id || "").replace("CMD_EMEA_CH_AM_", "AM ")) + '</span></div>' +
    '<div class="tt-row"><span class="tt-label">Status</span><span class="tt-status ' + (statusClasses[eff] || "") + '">' + (statusLabels[eff] || eff) + '</span></div>' +
    '<div class="tt-row"><span class="tt-label">SFDC Accts</span><span class="tt-val">' + (entry.sfdc_account_count || 0) + '</span></div>';

  // Show exception reason if applicable
  if (eff === "exception") {
    var excInfo = getExceptionInfo(entry);
    if (excInfo) {
      html += '<div class="tt-row" style="margin-top:4px;"><span class="tt-label" style="color:#dc2626;">Exception</span><span class="tt-val" style="font-size:11px;">' + escapeHTML(excInfo.label) + '</span></div>';
    }
  }

  if (entry.sfdc_account_count > 0 && entry.sfdc_account_count <= 5) {
    var names = (entry.sfdc_accounts || []).map(function (a) { return escapeHTML(a.name); }).join("<br>");
    html += '<div class="tt-row" style="margin-top:4px;"><span class="tt-label">Accounts</span><span class="tt-val">' + names + '</span></div>';
  }

  if (state.selectedZips[zip]) {
    html += '<div class="tt-row" style="margin-top:4px;"><span class="tt-label" style="color:#2563eb;">Selected</span></div>';
  }

  return html;
}

// ==================== ZIP Selection ====================
export function toggleZipSelection(zip) {
  if (state.selectedZips[zip]) {
    delete state.selectedZips[zip];
  } else {
    state.selectedZips[zip] = true;
  }
  refreshStyles();
  updateSelectionTray();
}

export function clearSelection() {
  state.selectedZips = {};
  refreshStyles();
  updateSelectionTray();
}

export function updateSelectionTray() {
  var tray = document.getElementById("selectionTray");
  var chips = document.getElementById("trayChips");
  var count = document.getElementById("trayCount");
  var msg = document.getElementById("trayMessage");
  var keys = Object.keys(state.selectedZips);

  if (keys.length === 0) {
    tray.style.display = "none";
    return;
  }

  tray.style.display = "block";
  count.textContent = keys.length;

  var zefixBtn = document.getElementById("btnZefix");
  if (keys.length > 10) {
    zefixBtn.disabled = true;
    zefixBtn.title = "Select at most 10 ZIPs for ZEFIX query";
    msg.style.display = "block";
    msg.textContent = "Select at most 10 ZIPs to query ZEFIX.";
    msg.className = "tray-message tray-message-warn";
  } else {
    zefixBtn.disabled = false;
    zefixBtn.title = "Query ZEFIX for companies in selected ZIPs";
    msg.style.display = "none";
  }

  chips.innerHTML = "";
  keys.sort().forEach(function (zip) {
    var entry = state.zipDataMap[zip];
    var chip = document.createElement("div");
    chip.className = "tray-chip";
    var eff = getEffectiveStatus(entry);
    chip.classList.add("tray-chip-" + eff);
    chip.innerHTML =
      '<span class="chip-zip">' + zip + '</span>' +
      (entry && entry.official_city ? '<span class="chip-city">' + escapeHTML(entry.official_city) + '</span>' : '') +
      '<button class="chip-remove" data-zip="' + zip + '" title="Remove ' + zip + '">&times;</button>';
    chips.appendChild(chip);
  });
}

// ==================== Refresh Styles ====================
export function refreshStyles() {
  if (!state.geoLayer) return;
  state.geoLayer.eachLayer(function (layer) {
    var feature = layer.feature;
    layer.setStyle(styleFeature(feature));

    var zip = String(feature.id).padStart(4, "0");
    var entry = state.zipDataMap[zip];
    layer.unbindTooltip();
    layer.bindTooltip(buildTooltip(zip, entry), {
      sticky: true,
      className: "zip-tooltip",
      direction: "auto",
    });
  });
  // Re-render territory borders to match filter state
  renderTerritoryBorders();
}

// ==================== Mark as Excluded ====================
export function markSelectedExcluded() {
  var zips = Object.keys(state.selectedZips);
  if (zips.length === 0) return;

  var undoEntry = { type: "exclude", zips: zips, previous: {} };
  zips.forEach(function (zip) {
    undoEntry.previous[zip] = state.excludedZips[zip] || null;
  });
  state.undoStack.push(undoEntry);

  var now = new Date().toISOString();
  zips.forEach(function (zip) {
    state.excludedZips[zip] = now;
  });
  saveExcluded(state.excludedZips);

  state.selectedZips = {};
  refreshStyles();
  updateSelectionTray();
  // These will be called from the wired-up callbacks
  if (_onExcludeCallback) _onExcludeCallback();
}

export function undoLastAction() {
  if (state.undoStack.length === 0) return;
  var entry = state.undoStack.pop();

  if (entry.type === "exclude") {
    entry.zips.forEach(function (zip) {
      if (entry.previous[zip]) {
        state.excludedZips[zip] = entry.previous[zip];
      } else {
        delete state.excludedZips[zip];
      }
    });
    saveExcluded(state.excludedZips);
    refreshStyles();
    if (_onExcludeCallback) _onExcludeCallback();
  }
}

// Callback for stats/legend refresh after exclude changes
var _onExcludeCallback = null;
export function setOnExcludeCallback(fn) {
  _onExcludeCallback = fn;
}

// ==================== Exception Table ====================
// Store external renderer and call it after geo re-render
var _renderAnomalyTable = null;
export function setRenderAnomalyTable(fn) {
  _renderAnomalyTable = fn;
}
function renderAnomalyTableIfReady() {
  if (_renderAnomalyTable) _renderAnomalyTable();
}
