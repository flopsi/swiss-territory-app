/**
 * api.js — Persistence layer using localStorage (static / GitHub Pages mode).
 *
 * The original Python backend is not available on GitHub Pages.
 * All state is stored in the browser via localStorage.
 */

var LS_KEY_EXCLUDED = "swiss_territory_excluded";
var LS_KEY_DATASET = "swiss_territory_dataset";
var LS_KEY_UPLOADED_AT = "swiss_territory_uploaded_at";

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
  try {
    localStorage.removeItem(key);
  } catch (e) {
    // ignore
  }
}

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

/**
 * apiRequest — stub for backend API calls.
 * The original Python backend is not available on GitHub Pages,
 * so this returns a rejected promise with a helpful message.
 */
export function apiRequest(url, options) {
  return Promise.reject(new Error("Backend API is not available on GitHub Pages (requested " + url + ")"));
}
