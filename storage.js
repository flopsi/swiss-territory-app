/**
 * storage.js — Durable persistence layer.
 *
 * On Vercel: uses @vercel/blob (requires BLOB_READ_WRITE_TOKEN env var).
 * Locally:   uses the filesystem under server-data/.
 *
 * Exposes simple get/put/del helpers that the server endpoints call.
 */

const path = require("path");
const fs = require("fs");

const IS_VERCEL = !!process.env.VERCEL;

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
 * Check whether blob storage is configured (has required env var).
 */
function isBlobConfigured() {
  return IS_VERCEL && !!process.env.BLOB_READ_WRITE_TOKEN;
}

/**
 * Read excluded ZIPs map. Returns {} if not found.
 */
async function getExcluded() {
  if (IS_VERCEL) {
    if (!isBlobConfigured()) return {};
    return await blobGet(BLOB_PATHS.excluded, {});
  }
  return localGet(LOCAL_PATHS.excluded, {});
}

/**
 * Write excluded ZIPs map.
 */
async function putExcluded(data) {
  if (IS_VERCEL) {
    if (!isBlobConfigured()) {
      throw new Error("BLOB_READ_WRITE_TOKEN is not set. Cannot persist excluded ZIPs.");
    }
    return await blobPut(BLOB_PATHS.excluded, data);
  }
  localPut(LOCAL_PATHS.excluded, data);
}

/**
 * Read identified ZIPs map. Returns {} if not found.
 */
async function getIdentified() {
  if (IS_VERCEL) {
    if (!isBlobConfigured()) return {};
    return await blobGet(BLOB_PATHS.identified, {});
  }
  return localGet(LOCAL_PATHS.identified, {});
}

/**
 * Write identified ZIPs map.
 */
async function putIdentified(data) {
  if (IS_VERCEL) {
    if (!isBlobConfigured()) {
      throw new Error("BLOB_READ_WRITE_TOKEN is not set. Cannot persist identified ZIPs.");
    }
    return await blobPut(BLOB_PATHS.identified, data);
  }
  localPut(LOCAL_PATHS.identified, data);
}

/**
 * Read uploaded dataset. Returns null if not found.
 */
async function getDataset() {
  if (IS_VERCEL) {
    if (!isBlobConfigured()) return null;
    return await blobGet(BLOB_PATHS.dataset, null);
  }
  return localGet(LOCAL_PATHS.dataset, null);
}

/**
 * Write uploaded dataset.
 */
async function putDataset(data) {
  if (IS_VERCEL) {
    if (!isBlobConfigured()) {
      throw new Error("BLOB_READ_WRITE_TOKEN is not set. Cannot persist dataset.");
    }
    return await blobPut(BLOB_PATHS.dataset, data);
  }
  localPut(LOCAL_PATHS.dataset, data);
}

/**
 * Read dataset metadata (uploaded_at). Returns { uploaded_at: null } if not found.
 */
async function getDatasetMeta() {
  if (IS_VERCEL) {
    if (!isBlobConfigured()) return { uploaded_at: null };
    return await blobGet(BLOB_PATHS.datasetMeta, { uploaded_at: null });
  }
  return localGet(LOCAL_PATHS.datasetMeta, { uploaded_at: null });
}

/**
 * Write dataset metadata.
 */
async function putDatasetMeta(data) {
  if (IS_VERCEL) {
    if (!isBlobConfigured()) {
      throw new Error("BLOB_READ_WRITE_TOKEN is not set. Cannot persist dataset metadata.");
    }
    return await blobPut(BLOB_PATHS.datasetMeta, data);
  }
  localPut(LOCAL_PATHS.datasetMeta, data);
}

// --------------- Identified Companies (persisted CSV-backing store) ---------------

async function getIdentifiedCompanies() {
  if (IS_VERCEL) {
    if (!isBlobConfigured()) return [];
    return await blobGet(BLOB_PATHS.identifiedCompanies, []);
  }
  return localGet(LOCAL_PATHS.identifiedCompanies, []);
}

async function putIdentifiedCompanies(data) {
  if (IS_VERCEL) {
    if (!isBlobConfigured()) throw new Error("BLOB_READ_WRITE_TOKEN is not set.");
    return await blobPut(BLOB_PATHS.identifiedCompanies, data);
  }
  localPut(LOCAL_PATHS.identifiedCompanies, data);
}

// --------------- Sonar Lookup Cache (prevents repeated lookups) ---------------

async function getSonarCache() {
  if (IS_VERCEL) {
    if (!isBlobConfigured()) return {};
    return await blobGet(BLOB_PATHS.sonarCache, {});
  }
  return localGet(LOCAL_PATHS.sonarCache, {});
}

async function putSonarCache(data) {
  if (IS_VERCEL) {
    if (!isBlobConfigured()) throw new Error("BLOB_READ_WRITE_TOKEN is not set.");
    return await blobPut(BLOB_PATHS.sonarCache, data);
  }
  localPut(LOCAL_PATHS.sonarCache, data);
}

// --------------- Sonar Cost Tracking ---------------

async function getSonarCosts() {
  if (IS_VERCEL) {
    if (!isBlobConfigured()) return { total_cost: 0, queries: 0 };
    return await blobGet(BLOB_PATHS.sonarCosts, { total_cost: 0, queries: 0 });
  }
  return localGet(LOCAL_PATHS.sonarCosts, { total_cost: 0, queries: 0 });
}

async function putSonarCosts(data) {
  if (IS_VERCEL) {
    if (!isBlobConfigured()) throw new Error("BLOB_READ_WRITE_TOKEN is not set.");
    return await blobPut(BLOB_PATHS.sonarCosts, data);
  }
  localPut(LOCAL_PATHS.sonarCosts, data);
}

// --------------- Leaderboard ---------------

async function getLeaderboard() {
  if (IS_VERCEL) {
    if (!isBlobConfigured()) return {};
    return await blobGet(BLOB_PATHS.leaderboard, {});
  }
  return localGet(LOCAL_PATHS.leaderboard, {});
}

async function putLeaderboard(data) {
  if (IS_VERCEL) {
    if (!isBlobConfigured()) throw new Error("BLOB_READ_WRITE_TOKEN is not set.");
    return await blobPut(BLOB_PATHS.leaderboard, data);
  }
  localPut(LOCAL_PATHS.leaderboard, data);
}

/**
 * Delete all persisted data (excluded + dataset + meta).
 */
async function clearAll() {
  if (IS_VERCEL) {
    if (!isBlobConfigured()) return;
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
