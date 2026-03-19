/**
 * storage.js — Durable persistence layer.
 *
 * When BLOB_READ_WRITE_TOKEN is set: uses @vercel/blob for all persistence
 *   (works on Vercel deployments and locally when the developer sets the token).
 * Otherwise: falls back to the local filesystem under server-data/.
 *
 * Exposes simple get/put/del helpers that the server endpoints call.
 * All mutable runtime data classes are routed through this module:
 *   - excluded            : excluded ZIP codes map
 *   - identified          : identified ZIP codes map
 *   - dataset             : uploaded SFDC dataset
 *   - datasetMeta         : dataset upload timestamp
 *   - identifiedCompanies : Sonar/ZEFIX-qualified companies list
 *   - sonarCache          : Perplexity Sonar result cache
 *   - sonarCosts          : Sonar API cost tracking
 *   - leaderboard         : per-user identification counts
 *
 * Static bundled source files (data/data.js, data/ch-plz.topojson,
 * data/ch-plz.js) are never written at runtime and remain as bundled assets.
 */

const path = require("path");
const fs = require("fs");

// Blob store paths — stored as JSON files in the Vercel Blob store
const BLOB_PREFIX = "swiss-territory/";
const BLOB_PATHS = {
  excluded: BLOB_PREFIX + "excluded.json",
  identified: BLOB_PREFIX + "identified.json",
  dataset: BLOB_PREFIX + "uploaded-dataset.json",
  datasetMeta: BLOB_PREFIX + "uploaded-at.json",
  identifiedCompanies: BLOB_PREFIX + "identified-companies.json",
  sonarCache: BLOB_PREFIX + "sonar-cache.json",
  sonarCosts: BLOB_PREFIX + "sonar-costs.json",
  leaderboard: BLOB_PREFIX + "leaderboard.json",
};

// Local filesystem paths
const SERVER_DATA_DIR = path.join(__dirname, "server-data");
const LOCAL_PATHS = {
  excluded: path.join(SERVER_DATA_DIR, "excluded.json"),
  identified: path.join(SERVER_DATA_DIR, "identified.json"),
  dataset: path.join(SERVER_DATA_DIR, "uploaded-dataset.json"),
  datasetMeta: path.join(SERVER_DATA_DIR, "uploaded-at.json"),
  identifiedCompanies: path.join(SERVER_DATA_DIR, "identified-companies.json"),
  sonarCache: path.join(SERVER_DATA_DIR, "sonar-cache.json"),
  sonarCosts: path.join(SERVER_DATA_DIR, "sonar-costs.json"),
  leaderboard: path.join(SERVER_DATA_DIR, "leaderboard.json"),
};

// --------------- Lazy Blob SDK loader ---------------
var _blob = null;
function getBlob() {
  if (!_blob) {
    _blob = require("@vercel/blob");
  }
  return _blob;
}

function ensureLocalDir() {
  if (!fs.existsSync(SERVER_DATA_DIR)) {
    fs.mkdirSync(SERVER_DATA_DIR, { recursive: true });
  }
}

// --------------- Vercel Blob helpers ---------------

/**
 * Read a JSON object from Vercel Blob. Returns defaultValue if not found.
 */
async function blobGet(blobPath, defaultValue) {
  var blob = getBlob();
  try {
    // List blobs with the given prefix to find the URL
    var listing = await blob.list({ prefix: blobPath, limit: 1 });
    if (!listing.blobs || listing.blobs.length === 0) {
      return defaultValue;
    }
    var response = await fetch(listing.blobs[0].url);
    if (!response.ok) return defaultValue;
    return await response.json();
  } catch (e) {
    console.warn("Blob read failed for " + blobPath + ":", e.message);
    return defaultValue;
  }
}

/**
 * Write a JSON object to Vercel Blob. Overwrites any existing blob at that path.
 */
async function blobPut(blobPath, data) {
  var blob = getBlob();
  var body = JSON.stringify(data);
  await blob.put(blobPath, body, {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

/**
 * Delete a blob by path. No-op if it doesn't exist.
 */
async function blobDel(blobPath) {
  var blob = getBlob();
  try {
    var listing = await blob.list({ prefix: blobPath, limit: 1 });
    if (listing.blobs && listing.blobs.length > 0) {
      await blob.del(listing.blobs[0].url);
    }
  } catch (e) {
    console.warn("Blob delete failed for " + blobPath + ":", e.message);
  }
}

// --------------- Local filesystem helpers ---------------

function localGet(filePath, defaultValue) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    }
  } catch (e) {
    console.warn("Could not read " + filePath + ":", e.message);
  }
  return defaultValue;
}

function localPut(filePath, data) {
  ensureLocalDir();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function localDel(filePath) {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (e) {
    console.warn("Could not delete " + filePath + ":", e.message);
  }
}

// --------------- Public API ---------------

/**
 * Check whether Blob storage is configured.
 * Blob is used whenever BLOB_READ_WRITE_TOKEN is present — on Vercel
 * deployments (where it is injected automatically from the linked Blob store)
 * and locally when the developer sets the token in their .env file.
 */
function isBlobConfigured() {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

/**
 * Read excluded ZIPs map. Returns {} if not found.
 */
async function getExcluded() {
  if (isBlobConfigured()) {
    return await blobGet(BLOB_PATHS.excluded, {});
  }
  return localGet(LOCAL_PATHS.excluded, {});
}

/**
 * Write excluded ZIPs map.
 */
async function putExcluded(data) {
  if (isBlobConfigured()) {
    return await blobPut(BLOB_PATHS.excluded, data);
  }
  localPut(LOCAL_PATHS.excluded, data);
}

/**
 * Read identified ZIPs map. Returns {} if not found.
 */
async function getIdentified() {
  if (isBlobConfigured()) {
    return await blobGet(BLOB_PATHS.identified, {});
  }
  return localGet(LOCAL_PATHS.identified, {});
}

/**
 * Write identified ZIPs map.
 */
async function putIdentified(data) {
  if (isBlobConfigured()) {
    return await blobPut(BLOB_PATHS.identified, data);
  }
  localPut(LOCAL_PATHS.identified, data);
}

/**
 * Read uploaded dataset. Returns null if not found.
 */
async function getDataset() {
  if (isBlobConfigured()) {
    return await blobGet(BLOB_PATHS.dataset, null);
  }
  return localGet(LOCAL_PATHS.dataset, null);
}

/**
 * Write uploaded dataset.
 */
async function putDataset(data) {
  if (isBlobConfigured()) {
    return await blobPut(BLOB_PATHS.dataset, data);
  }
  localPut(LOCAL_PATHS.dataset, data);
}

/**
 * Read dataset metadata (uploaded_at). Returns { uploaded_at: null } if not found.
 */
async function getDatasetMeta() {
  if (isBlobConfigured()) {
    return await blobGet(BLOB_PATHS.datasetMeta, { uploaded_at: null });
  }
  return localGet(LOCAL_PATHS.datasetMeta, { uploaded_at: null });
}

/**
 * Write dataset metadata.
 */
async function putDatasetMeta(data) {
  if (isBlobConfigured()) {
    return await blobPut(BLOB_PATHS.datasetMeta, data);
  }
  localPut(LOCAL_PATHS.datasetMeta, data);
}

// --------------- Identified Companies (persisted CSV-backing store) ---------------

async function getIdentifiedCompanies() {
  if (isBlobConfigured()) {
    return await blobGet(BLOB_PATHS.identifiedCompanies, []);
  }
  return localGet(LOCAL_PATHS.identifiedCompanies, []);
}

async function putIdentifiedCompanies(data) {
  if (isBlobConfigured()) {
    return await blobPut(BLOB_PATHS.identifiedCompanies, data);
  }
  localPut(LOCAL_PATHS.identifiedCompanies, data);
}

// --------------- Sonar Lookup Cache (prevents repeated lookups) ---------------

async function getSonarCache() {
  if (isBlobConfigured()) {
    return await blobGet(BLOB_PATHS.sonarCache, {});
  }
  return localGet(LOCAL_PATHS.sonarCache, {});
}

async function putSonarCache(data) {
  if (isBlobConfigured()) {
    return await blobPut(BLOB_PATHS.sonarCache, data);
  }
  localPut(LOCAL_PATHS.sonarCache, data);
}

// --------------- Sonar Cost Tracking ---------------

async function getSonarCosts() {
  if (isBlobConfigured()) {
    return await blobGet(BLOB_PATHS.sonarCosts, { total_cost: 0, queries: 0 });
  }
  return localGet(LOCAL_PATHS.sonarCosts, { total_cost: 0, queries: 0 });
}

async function putSonarCosts(data) {
  if (isBlobConfigured()) {
    return await blobPut(BLOB_PATHS.sonarCosts, data);
  }
  localPut(LOCAL_PATHS.sonarCosts, data);
}

// --------------- Leaderboard ---------------

async function getLeaderboard() {
  if (isBlobConfigured()) {
    return await blobGet(BLOB_PATHS.leaderboard, {});
  }
  return localGet(LOCAL_PATHS.leaderboard, {});
}

async function putLeaderboard(data) {
  if (isBlobConfigured()) {
    return await blobPut(BLOB_PATHS.leaderboard, data);
  }
  localPut(LOCAL_PATHS.leaderboard, data);
}

/**
 * Delete all persisted runtime data from both storage backends.
 */
async function clearAll() {
  if (isBlobConfigured()) {
    await Promise.all([
      blobDel(BLOB_PATHS.excluded),
      blobDel(BLOB_PATHS.identified),
      blobDel(BLOB_PATHS.dataset),
      blobDel(BLOB_PATHS.datasetMeta),
      blobDel(BLOB_PATHS.identifiedCompanies),
      blobDel(BLOB_PATHS.sonarCache),
      blobDel(BLOB_PATHS.sonarCosts),
      blobDel(BLOB_PATHS.leaderboard),
    ]);
    return;
  }
  localDel(LOCAL_PATHS.excluded);
  localDel(LOCAL_PATHS.identified);
  localDel(LOCAL_PATHS.dataset);
  localDel(LOCAL_PATHS.datasetMeta);
  localDel(LOCAL_PATHS.identifiedCompanies);
  localDel(LOCAL_PATHS.sonarCache);
  localDel(LOCAL_PATHS.sonarCosts);
  localDel(LOCAL_PATHS.leaderboard);
}

module.exports = {
  isBlobConfigured: isBlobConfigured,
  getExcluded: getExcluded,
  putExcluded: putExcluded,
  getIdentified: getIdentified,
  putIdentified: putIdentified,
  getDataset: getDataset,
  putDataset: putDataset,
  getDatasetMeta: getDatasetMeta,
  putDatasetMeta: putDatasetMeta,
  getIdentifiedCompanies: getIdentifiedCompanies,
  putIdentifiedCompanies: putIdentifiedCompanies,
  getSonarCache: getSonarCache,
  putSonarCache: putSonarCache,
  getSonarCosts: getSonarCosts,
  putSonarCosts: putSonarCosts,
  getLeaderboard: getLeaderboard,
  putLeaderboard: putLeaderboard,
  clearAll: clearAll,
};
