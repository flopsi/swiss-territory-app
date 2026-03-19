/**
 * map.js — Leaflet map setup, polygon rendering, tooltips, and ZIP selection.
 */

import {
  state, getActiveData, getEffectiveStatus, getZipColor,
  hasActiveFilters, isFiltered, getExceptionInfo, coverageColors,
} from "./state.js";
import { escapeHTML } from "./utils.js";
import { saveExcluded, saveIdentified } from "./api.js";

// Approximate coordinates for ZIPs that have no TopoJSON polygon
// (sub-delivery areas, PO boxes, business districts). Derived from
// centroids of nearest postal areas so markers appear in the right region.
export var FALLBACK_ZIP_COORDS = {
  "1001": [46.5403, 6.6802], "1002": [46.5195, 6.6306], "1014": [46.5195, 6.5763],
  "1211": [46.1768, 6.1182], "1401": [46.7952, 6.6911], "1701": [46.8054, 7.1651],
  "1705": [46.8054, 7.1651], "1708": [46.8054, 7.1651], "1951": [46.2281, 7.3564],
  "2001": [46.9977, 6.9305], "2002": [46.9977, 6.9305], "2003": [46.9977, 6.9305],
  "2007": [46.9977, 6.9305], "2009": [46.9977, 6.9305], "2139": [46.9605, 6.7646],
  "2301": [47.1165, 6.875],  "2304": [47.1165, 6.875],  "2500": [47.1484, 7.2449],
  "2501": [47.1484, 7.2449], "3001": [46.9752, 7.4491], "3003": [46.9752, 7.4491],
  "3100": [46.8794, 7.5633], "3401": [47.0544, 7.6133], "3515": [46.9725, 7.6335],
  "3690": [46.8181, 7.6417], "3990": [46.38, 8.0708],   "4002": [47.5548, 7.5886],
  "4005": [47.5548, 7.5886], "4012": [47.5548, 7.5886], "4019": [47.5619, 7.5759],
  "4050": [47.5551, 7.586],  "4070": [47.5283, 7.5929], "4075": [47.5283, 7.5929],
  "4502": [47.2067, 7.5289], "4509": [47.2067, 7.5289], "4550": [47.1924, 7.5892],
  "4901": [47.2137, 7.7953], "5001": [47.3899, 8.0496], "5194": [47.4545, 8.171],
  "5201": [47.4856, 8.2079], "5232": [47.5139, 8.2321], "5401": [47.4724, 8.2941],
  "6000": [47.0506, 8.296],  "6002": [47.0506, 8.296],  "6021": [47.13, 8.0547],
  "6281": [47.1482, 8.2862], "6301": [47.1418, 8.5318], "6302": [47.1418, 8.5318],
  "6341": [47.2272, 8.5734], "6342": [47.1538, 8.4408], "6501": [46.1936, 9.0408],
  "6601": [46.1908, 8.7827], "6671": [46.2366, 8.7669], "6901": [46.0129, 8.9436],
  "6910": [45.9799, 8.9434], "7001": [46.8451, 9.5299], "7007": [46.8451, 9.5299],
  "8000": [47.3729, 8.5429], "8010": [47.3553, 8.5608], "8021": [47.369, 8.5632],
  "8024": [47.369, 8.5632],  "8027": [47.369, 8.5632],  "8058": [47.4006, 8.5421],
  "8090": [47.3989, 8.4863], "8091": [47.3989, 8.4863], "8092": [47.3989, 8.4863],
  "8093": [47.3989, 8.4863], "8160": [47.4911, 8.4297], "8201": [47.7151, 8.6309],
  "8205": [47.7229, 8.6744], "8369": [47.4463, 8.9162], "8401": [47.4875, 8.7314],
  "8411": [47.5361, 8.6877], "8501": [47.534, 8.879],   "8510": [47.538, 8.9967],
  "8571": [47.5723, 9.1182], "8823": [47.1935, 8.6401], "9001": [47.4252, 9.3687],
  "9007": [47.4438, 9.3949], "9101": [47.3832, 9.2839], "9201": [47.4189, 9.2483],
  "9303": [47.4681, 9.3419], "9471": [47.1792, 9.4444],
};

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
    var topo = typeof CH_PLZ_TOPOJSON !== "undefined" ? CH_PLZ_TOPOJSON : null;
    if (!topo || !topo.objects || !topo.objects.plz) {
      throw new Error("Bundled TopoJSON data is missing");
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

// ==================== Markers for ZIPs Without Polygons ====================
// No-polygon marker rendering is intentionally disabled.
// ZIPs without TopoJSON polygons (sub-delivery areas, PO boxes, business
// districts) are surfaced only in the Exceptions warning panel — not as
// dot markers on the map.
export function renderAnomalyMarkers() {
  // no-op: no-polygon ZIPs are shown only in the exception table, not on the map
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
  var isSearchMatch = state.searchMatchedZips[zip];
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

  if (isSearchMatch) {
    return {
      fillColor: "#f59e0b",
      fillOpacity: 0.65,
      weight: 2.5,
      color: "#d97706",
      opacity: 1,
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
  var statusLabels = { covered: "Covered", potential: "Potential", exception: "Exception (SFDC only)", excluded: "Excluded", identified: "Identified (new targets)" };
  var statusClasses = { covered: "covered", potential: "potential", exception: "anomaly", excluded: "excluded", identified: "identified" };

  var html =
    '<div class="tt-zip">' + zip + (entry.official_city ? " &mdash; " + escapeHTML(entry.official_city) : "") + '</div>';

  if (entry.canton) {
    html += '<div class="tt-row"><span class="tt-label">Canton</span><span class="tt-val">' + escapeHTML(entry.canton) + '</span></div>';
  }

  html +=
    '<div class="tt-row"><span class="tt-label">Manager</span><span class="tt-val">' + escapeHTML(entry.account_manager || (entry.sfdc_managers || []).join(", ")) + '</span></div>' +
    '<div class="tt-row"><span class="tt-label">Territory</span><span class="tt-val">' + escapeHTML((entry.territory_id || "").replace("CMD_EMEA_CH_AM_", "AM ").replace("CMD_EMEA_CHAM_", "AM ")) + '</span></div>' +
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

// ==================== Mark as Identified ====================
export function markSelectedIdentified() {
  var zips = Object.keys(state.selectedZips);
  if (zips.length === 0) return;

  var undoEntry = { type: "identify", zips: zips, previousIdentified: {}, previousExcluded: {} };
  zips.forEach(function (zip) {
    undoEntry.previousIdentified[zip] = state.identifiedZips[zip] || null;
    undoEntry.previousExcluded[zip] = state.excludedZips[zip] || null;
  });
  state.undoStack.push(undoEntry);

  var now = new Date().toISOString();
  zips.forEach(function (zip) {
    state.identifiedZips[zip] = now;
    // Overwrite: remove from excluded when marking identified
    delete state.excludedZips[zip];
  });
  saveIdentified(state.identifiedZips);
  saveExcluded(state.excludedZips);

  state.selectedZips = {};
  refreshStyles();
  updateSelectionTray();
  if (_onExcludeCallback) _onExcludeCallback();
}

// ==================== Mark as Excluded ====================
export function markSelectedExcluded() {
  var zips = Object.keys(state.selectedZips);
  if (zips.length === 0) return;

  var undoEntry = { type: "exclude", zips: zips, previousExcluded: {}, previousIdentified: {} };
  zips.forEach(function (zip) {
    undoEntry.previousExcluded[zip] = state.excludedZips[zip] || null;
    undoEntry.previousIdentified[zip] = state.identifiedZips[zip] || null;
  });
  state.undoStack.push(undoEntry);

  var now = new Date().toISOString();
  zips.forEach(function (zip) {
    state.excludedZips[zip] = now;
    // Overwrite: remove from identified when marking excluded
    delete state.identifiedZips[zip];
  });
  saveExcluded(state.excludedZips);
  saveIdentified(state.identifiedZips);

  state.selectedZips = {};
  refreshStyles();
  updateSelectionTray();
  if (_onExcludeCallback) _onExcludeCallback();
}

export function undoLastAction() {
  if (state.undoStack.length === 0) return;
  var entry = state.undoStack.pop();

  if (entry.type === "exclude") {
    entry.zips.forEach(function (zip) {
      // Restore excluded state
      if (entry.previousExcluded[zip]) {
        state.excludedZips[zip] = entry.previousExcluded[zip];
      } else {
        delete state.excludedZips[zip];
      }
      // Restore identified state (may have been removed by overwrite)
      if (entry.previousIdentified && entry.previousIdentified[zip]) {
        state.identifiedZips[zip] = entry.previousIdentified[zip];
      } else if (entry.previousIdentified) {
        delete state.identifiedZips[zip];
      }
    });
    saveExcluded(state.excludedZips);
    saveIdentified(state.identifiedZips);
    refreshStyles();
    if (_onExcludeCallback) _onExcludeCallback();
  }

  if (entry.type === "identify") {
    entry.zips.forEach(function (zip) {
      // Restore identified state
      if (entry.previousIdentified[zip]) {
        state.identifiedZips[zip] = entry.previousIdentified[zip];
      } else {
        delete state.identifiedZips[zip];
      }
      // Restore excluded state (may have been removed by overwrite)
      if (entry.previousExcluded && entry.previousExcluded[zip]) {
        state.excludedZips[zip] = entry.previousExcluded[zip];
      } else if (entry.previousExcluded) {
        delete state.excludedZips[zip];
      }
    });
    saveIdentified(state.identifiedZips);
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
