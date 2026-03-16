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
  dataset: BLOB_PREFIX + "uploaded-dataset.json",
  datasetMeta: BLOB_PREFIX + "uploaded-at.json",
};

// Local filesystem paths
const SERVER_DATA_DIR = path.join(__dirname, "server-data");
const LOCAL_PATHS = {
  excluded: path.join(SERVER_DATA_DIR, "excluded.json"),
  dataset: path.join(SERVER_DATA_DIR, "uploaded-dataset.json"),
  datasetMeta: path.join(SERVER_DATA_DIR, "uploaded-at.json"),
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

/**
 * Delete all persisted data (excluded + dataset + meta).
 */
async function clearAll() {
  if (IS_VERCEL) {
    if (!isBlobConfigured()) return;
    await Promise.all([
      blobDel(BLOB_PATHS.excluded),
      blobDel(BLOB_PATHS.dataset),
      blobDel(BLOB_PATHS.datasetMeta),
    ]);
    return;
  }
  localDel(LOCAL_PATHS.excluded);
  localDel(LOCAL_PATHS.dataset);
  localDel(LOCAL_PATHS.datasetMeta);
}

module.exports = {
  isBlobConfigured: isBlobConfigured,
  getExcluded: getExcluded,
  putExcluded: putExcluded,
  getDataset: getDataset,
  putDataset: putDataset,
  getDatasetMeta: getDatasetMeta,
  putDatasetMeta: putDatasetMeta,
  clearAll: clearAll,
};
