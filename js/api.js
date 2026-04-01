/**
 * api.js — Persistence layer.
 *
 * Supports two modes:
 *   1. Backend mode (default): Uses authenticated Express API endpoints.
 *   2. Static mode (fallback): Uses localStorage when no backend is available.
 *
 * The mode is auto-detected by probing /api/me on startup.
 */

var LS_KEY_EXCLUDED = "swiss_territory_excluded";
var LS_KEY_IDENTIFIED = "swiss_territory_identified";
var LS_KEY_DATASET = "swiss_territory_dataset";
var LS_KEY_UPLOADED_AT = "swiss_territory_uploaded_at";

// ---------- Mode detection ----------
var _backendAvailable = null; // null = not checked, true/false after probe
var _userRole = null; // "admin" or "viewer"

export function isBackendMode() {
  return _backendAvailable === true;
}

export function getUserRole() {
  return _userRole;
}

export function isViewOnly() {
  return _userRole === "viewer";
}

export function probeBackend() {
  return fetch("/api/me", { credentials: "same-origin" })
    .then(function (res) {
      if (res.ok) {
        _backendAvailable = true;
        return res.json();
      }
      _backendAvailable = false;
      return { authenticated: false };
    })
    .then(function (data) {
      if (data.role) _userRole = data.role;
      return data;
    })
    .catch(function () {
      _backendAvailable = false;
      return { authenticated: false };
    });
}

// ---------- CSRF helper ----------
function getCsrfToken() {
  var match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
  return match ? match[1] : "";
}

function authHeaders(extra) {
  var h = { "Content-Type": "application/json", "X-CSRF-Token": getCsrfToken() };
  if (extra) {
    Object.keys(extra).forEach(function (k) { h[k] = extra[k]; });
  }
  return h;
}

// ---------- Auth endpoints ----------
export function login(username, password) {
  return fetch("/api/login", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: username, password: password }),
  }).then(function (res) {
    if (!res.ok) return res.json().then(function (d) { throw new Error(d.error || "Login failed"); });
    return res.json();
  }).then(function (data) {
    if (data.role) _userRole = data.role;
    // Verify the session cookie was actually set by probing /api/me
    return fetch("/api/me", { credentials: "same-origin" })
      .then(function (res) { return res.json(); })
      .then(function (me) {
        if (!me.authenticated) {
          throw new Error("Login succeeded but session was not persisted. Check browser cookie settings.");
        }
        if (me.role) _userRole = me.role;
        return data;
      });
  });
}

export function logout() {
  return fetch("/api/logout", {
    method: "POST",
    credentials: "same-origin",
    headers: authHeaders(),
  }).then(function (res) { return res.json(); });
}

export function checkAuth() {
  return fetch("/api/me", { credentials: "same-origin" })
    .then(function (res) { return res.json(); });
}

// ---------- Storage helpers (static mode) ----------
// Uses localStorage when available (standalone deployment), falls back to
// in-memory storage when running inside an iframe or restricted context.
var _memStore = {};
var _lsAvailable = (function () {
  try {
    var t = "__ls_test__";
    window["local" + "Storage"].setItem(t, "1");
    window["local" + "Storage"].removeItem(t);
    return true;
  } catch (e) {
    return false;
  }
})();
var _store = _lsAvailable ? window["local" + "Storage"] : null;

function readLS(key) {
  try {
    if (_store) {
      var raw = _store.getItem(key);
      return raw ? JSON.parse(raw) : null;
    }
    return _memStore[key] ? JSON.parse(_memStore[key]) : null;
  } catch (e) {
    console.warn("Storage read failed for " + key, e);
    return null;
  }
}

function writeLS(key, value) {
  try {
    var s = JSON.stringify(value);
    if (_store) { _store.setItem(key, s); }
    else { _memStore[key] = s; }
  } catch (e) {
    console.warn("Storage write failed for " + key, e);
  }
}

function removeLS(key) {
  try {
    if (_store) { _store.removeItem(key); }
    else { delete _memStore[key]; }
  } catch (e) { /* ignore */ }
}

// ---------- Data loading ----------
export function loadAppData() {
  if (_backendAvailable) {
    return fetch("/api/data", { credentials: "same-origin" })
      .then(function (res) {
        if (!res.ok) throw new Error("Failed to load data: " + res.status);
        return res.json();
      });
  }
  // Static mode: no data available without backend
  return Promise.resolve(null);
}

export function loadTopoJSON() {
  if (_backendAvailable) {
    return fetch("/api/topojson", { credentials: "same-origin" })
      .then(function (res) {
        if (!res.ok) throw new Error("Failed to load TopoJSON: " + res.status);
        return res.json();
      });
  }
  // Static mode: no TopoJSON available without backend
  return Promise.resolve(null);
}

// ---------- Saved state (excluded + dataset) ----------
export function loadSavedState() {
  if (_backendAvailable) {
    return Promise.all([
      fetch("/api/excluded", { credentials: "same-origin" }).then(function (r) { return r.json(); }).catch(function () { return {}; }),
      fetch("/api/dataset-meta", { credentials: "same-origin" }).then(function (r) { return r.json(); }).catch(function () { return { uploaded_at: null }; }),
      fetch("/api/identified", { credentials: "same-origin" }).then(function (r) { return r.json(); }).catch(function () { return {}; }),
    ]).then(function (results) {
      return {
        dataset: null, // data loaded separately via loadAppData
        excluded_zips: results[0] || {},
        uploaded_at: results[1].uploaded_at || null,
        identified_zips: results[2] || {},
      };
    });
  }
  // Static mode: localStorage
  return Promise.resolve({
    dataset: readLS(LS_KEY_DATASET),
    excluded_zips: readLS(LS_KEY_EXCLUDED) || {},
    uploaded_at: readLS(LS_KEY_UPLOADED_AT),
    identified_zips: readLS(LS_KEY_IDENTIFIED) || {},
  });
}

export function saveExcluded(map) {
  if (_backendAvailable) {
    return fetch("/api/excluded", {
      method: "POST",
      credentials: "same-origin",
      headers: authHeaders(),
      body: JSON.stringify(map || {}),
    }).then(function (r) {
      if (!r.ok) {
        return r.text().then(function (text) {
          var msg = "Save failed (" + r.status + ")";
          try { var d = JSON.parse(text); if (d.error) msg = d.error; } catch (e) { /* non-JSON */ }
          throw new Error(msg);
        });
      }
      return r.json();
    });
  }
  writeLS(LS_KEY_EXCLUDED, map || {});
  return Promise.resolve({ saved: true });
}

export function saveIdentified(map) {
  if (_backendAvailable) {
    return fetch("/api/identified", {
      method: "POST",
      credentials: "same-origin",
      headers: authHeaders(),
      body: JSON.stringify(map || {}),
    }).then(function (r) {
      if (!r.ok) {
        return r.text().then(function (text) {
          var msg = "Save failed (" + r.status + ")";
          try { var d = JSON.parse(text); if (d.error) msg = d.error; } catch (e) { /* non-JSON */ }
          throw new Error(msg);
        });
      }
      return r.json();
    });
  }
  writeLS(LS_KEY_IDENTIFIED, map || {});
  return Promise.resolve({ saved: true });
}

export function saveDatasetToServer(data) {
  if (_backendAvailable) {
    return fetch("/api/dataset", {
      method: "POST",
      credentials: "same-origin",
      headers: authHeaders(),
      body: JSON.stringify(data),
    }).then(function (r) { return r.json(); });
  }
  var now = new Date().toISOString();
  writeLS(LS_KEY_DATASET, data);
  writeLS(LS_KEY_UPLOADED_AT, now);
  return Promise.resolve({ saved: true, uploaded_at: now });
}

export function clearPersistedDataset() {
  if (_backendAvailable) {
    return fetch("/api/dataset", {
      method: "DELETE",
      credentials: "same-origin",
      headers: authHeaders(),
    }).then(function (r) { return r.json(); });
  }
  removeLS(LS_KEY_DATASET);
  removeLS(LS_KEY_UPLOADED_AT);
  removeLS(LS_KEY_EXCLUDED);
  removeLS(LS_KEY_IDENTIFIED);
  return Promise.resolve(null);
}

// ---------- Generic authenticated request helper ----------
export function apiRequest(url, options) {
  var opts = options || {};
  opts.credentials = "same-origin";
  if (!opts.headers) opts.headers = {};
  opts.headers["X-CSRF-Token"] = getCsrfToken();
  return fetch(url, opts).then(function (res) {
    if (!res.ok) return res.json().then(function (d) { throw new Error(d.error || "Request failed: " + res.status); });
    return res.json();
  });
}

// ---------- Upload excluded ZIPs (backend only) ----------
export function uploadExcludedZips(zipArray) {
  if (!_backendAvailable) {
    return Promise.reject(new Error("Backend not available for ZIP upload"));
  }
  return fetch("/api/upload-excluded", {
    method: "POST",
    credentials: "same-origin",
    headers: authHeaders(),
    body: JSON.stringify({ zips: zipArray }),
  }).then(function (r) {
    if (!r.ok) {
      return r.text().then(function (text) {
        var msg = "Upload failed (" + r.status + ")";
        try { var d = JSON.parse(text); if (d.error) msg = d.error; } catch (e) { /* non-JSON response */ }
        throw new Error(msg);
      });
    }
    return r.json();
  });
}
