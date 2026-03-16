/**
 * api.js — Persistence layer (static / GitHub Pages mode).
 *
 * All data is stored in the browser's localStorage. There is no server backend.
 * Bundled data is loaded from the global APP_DATA / CH_PLZ_TOPOJSON constants
 * embedded in data/data.js and data/ch-plz.js.
 */

var LS_KEY_EXCLUDED = "swiss_territory_excluded";
var LS_KEY_DATASET = "swiss_territory_dataset";
var LS_KEY_UPLOADED_AT = "swiss_territory_uploaded_at";

// ---------- localStorage helpers ----------
function readLS(key) {
  try {
    var raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.warn("localStorage read failed for " + key, e);
    return null;
  }
}

function writeLS(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn("localStorage write failed for " + key, e);
  }
}

function removeLS(key) {
  try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
}

// ---------- Data loading ----------
export function loadAppData() {
  // Static mode: data comes from bundled data/data.js (global APP_DATA)
  return Promise.resolve(null);
}

export function loadTopoJSON() {
  // Static mode: TopoJSON comes from bundled data/ch-plz.js (global CH_PLZ_TOPOJSON)
  return Promise.resolve(null);
}

// ---------- Saved state (excluded + dataset) ----------
export function loadSavedState() {
  return Promise.resolve({
    dataset: readLS(LS_KEY_DATASET),
    excluded_zips: readLS(LS_KEY_EXCLUDED) || {},
    uploaded_at: readLS(LS_KEY_UPLOADED_AT),
  });
}

export function saveExcluded(map) {
  writeLS(LS_KEY_EXCLUDED, map || {});
  return Promise.resolve({ saved: true });
}

export function saveDatasetToServer(data) {
  var now = new Date().toISOString();
  writeLS(LS_KEY_DATASET, data);
  writeLS(LS_KEY_UPLOADED_AT, now);
  return Promise.resolve({ saved: true, uploaded_at: now });
}

export function clearPersistedDataset() {
  removeLS(LS_KEY_DATASET);
  removeLS(LS_KEY_UPLOADED_AT);
  removeLS(LS_KEY_EXCLUDED);
  return Promise.resolve(null);
}

// ---------- Excluded ZIP import (client-side) ----------
export function uploadExcludedZips(zipArray) {
  var current = readLS(LS_KEY_EXCLUDED) || {};
  var now = new Date().toISOString();
  var valid = [];
  var invalid = [];

  zipArray.forEach(function (z) {
    var normalized = String(z).trim().padStart(4, "0");
    if (/^\d{4}$/.test(normalized)) {
      var num = parseInt(normalized, 10);
      if (num >= 1000 && num <= 9999) {
        valid.push(normalized);
      } else {
        invalid.push(z);
      }
    } else {
      invalid.push(z);
    }
  });

  valid.forEach(function (zip) {
    if (!current[zip]) current[zip] = now;
  });

  writeLS(LS_KEY_EXCLUDED, current);

  return Promise.resolve({
    saved: true,
    added: valid.length,
    invalid: invalid,
    total: Object.keys(current).length,
  });
}
