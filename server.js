/**
 * server.js — Authenticated Express backend for Swiss Territory App.
 *
 * Serves sensitive data (territory assignments, SFDC accounts) only after login.
 * Static frontend assets are served publicly; data endpoints require a session.
 *
 * Vercel-compatible: uses cookie-session (stateless), read-only data from bundled
 * files, and exports the app for serverless. Local dev still uses app.listen().
 */

require("dotenv").config();
const express = require("express");
const cookieSession = require("cookie-session");
const helmet = require("helmet");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const bcryptjs = require("bcryptjs");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = parseInt(process.env.PORT || "3000", 10);
const IS_VERCEL = !!process.env.VERCEL;

// --------------- Environment ---------------
const ADMIN_USER = process.env.ADMIN_USER || "admin";
// Pre-hashed password from env, or fall back to hashing a default (dev only)
const ADMIN_HASH =
  process.env.ADMIN_PASSWORD_HASH ||
  bcryptjs.hashSync(process.env.ADMIN_PASSWORD || "changeme", 10);

const SESSION_SECRET = process.env.SESSION_SECRET || "dev-secret-change-me";
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "").split(",").filter(Boolean);

// --------------- Middleware ---------------
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "https://unpkg.com"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com"],
        imgSrc: ["'self'", "data:", "https://*.basemaps.cartocdn.com", "https://*.tile.openstreetmap.org"],
        connectSrc: ["'self'", "https://int.lindas.admin.ch"],
        fontSrc: ["'self'"],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
      },
    },
  })
);

app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// CORS — allow configured origins or same-origin only
if (ALLOWED_ORIGINS.length > 0) {
  app.use(
    cors({
      origin: ALLOWED_ORIGINS,
      credentials: true,
    })
  );
}

// Sessions — cookie-session stores state in a signed cookie (stateless / Vercel-safe)
app.use(
  cookieSession({
    name: "session",
    keys: [SESSION_SECRET],
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 8 * 60 * 60 * 1000, // 8 hours
  })
);

// CSRF token — simple double-submit cookie pattern
app.use(function (req, res, next) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    return next();
  }
  // Skip CSRF for login (no session yet)
  if (req.path === "/api/login") return next();

  var csrfHeader = req.headers["x-csrf-token"];
  var csrfCookie = req.cookies["csrf_token"];
  if (!csrfHeader || !csrfCookie || csrfHeader !== csrfCookie) {
    return res.status(403).json({ error: "CSRF token mismatch" });
  }
  next();
});

// --------------- Auth helpers ---------------
function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  return res.status(401).json({ error: "Authentication required" });
}

// Read-only guard — rejects write attempts on Vercel with a clear message
function readOnlyGuard(_req, res) {
  return res.status(403).json({ error: "Read-only deployment. Data modifications are not supported." });
}

// --------------- Static files ---------------
// Block direct access to data/ directory BEFORE static middleware
// (express.static's setHeaders only sets status but still sends the file body)
app.use("/data", function (_req, res) {
  res.status(403).json({ error: "Access denied. Use authenticated API endpoints." });
});

// Serve frontend files (data/ is already blocked above)
app.use(
  express.static(path.join(__dirname), {
    index: "index.html",
  })
);

// --------------- Auth endpoints ---------------
app.post("/api/login", function (req, res) {
  var username = (req.body.username || "").trim();
  var password = req.body.password || "";

  if (username !== ADMIN_USER) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  if (!bcryptjs.compareSync(password, ADMIN_HASH)) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  req.session.authenticated = true;
  req.session.user = username;

  // Set CSRF cookie for subsequent requests
  var crypto = require("crypto");
  var csrfToken = crypto.randomBytes(32).toString("hex");
  res.cookie("csrf_token", csrfToken, {
    httpOnly: false, // JS must read it
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
  });

  res.json({ ok: true, csrf_token: csrfToken });
});

app.post("/api/logout", requireAuth, function (req, res) {
  req.session = null; // cookie-session: clear by nullifying
  res.clearCookie("session");
  res.clearCookie("session.sig");
  res.clearCookie("csrf_token");
  res.json({ ok: true });
});

app.get("/api/me", function (req, res) {
  if (req.session && req.session.authenticated) {
    return res.json({ authenticated: true, user: req.session.user });
  }
  res.json({ authenticated: false });
});

// --------------- Data endpoints (authenticated, read-only) ---------------
// Serve APP_DATA — reads from bundled data/data.js (no server-data/ dependency)
app.get("/api/data", requireAuth, function (_req, res) {
  // On Vercel (or when server-data/ doesn't exist), serve bundled data directly
  if (!IS_VERCEL) {
    var serverDataPath = path.join(__dirname, "server-data", "data.json");
    if (fs.existsSync(serverDataPath)) {
      return res.sendFile(serverDataPath);
    }
  }
  // Bundled data/data.js is a JS file (const APP_DATA = {...}), extract the JSON
  var jsPath = path.join(__dirname, "data", "data.js");
  if (fs.existsSync(jsPath)) {
    var raw = fs.readFileSync(jsPath, "utf8");
    // Strip the "const APP_DATA = " prefix and any trailing semicolons/whitespace
    var jsonStr = raw.replace(/^[^=]+=\s*/, "").replace(/;\s*$/, "");
    res.setHeader("Content-Type", "application/json");
    return res.send(jsonStr);
  }
  return res.status(404).json({ error: "Data file not found" });
});

// Serve TopoJSON
app.get("/api/topojson", requireAuth, function (_req, res) {
  if (!IS_VERCEL) {
    var serverTopoPath = path.join(__dirname, "server-data", "ch-plz.topojson");
    if (fs.existsSync(serverTopoPath)) {
      return res.sendFile(serverTopoPath);
    }
  }
  var origPath = path.join(__dirname, "data", "ch-plz.topojson");
  if (fs.existsSync(origPath)) {
    return res.sendFile(origPath);
  }
  return res.status(404).json({ error: "TopoJSON file not found" });
});

// --------------- Excluded ZIPs (read-only on Vercel) ---------------
app.get("/api/excluded", requireAuth, function (_req, res) {
  // Always returns empty on Vercel (no persistent storage)
  if (IS_VERCEL) {
    return res.json({});
  }
  var excludedFile = path.join(__dirname, "server-data", "excluded.json");
  try {
    if (fs.existsSync(excludedFile)) {
      return res.json(JSON.parse(fs.readFileSync(excludedFile, "utf8")));
    }
  } catch (e) {
    console.warn("Could not read excluded.json:", e.message);
  }
  res.json({});
});

// Write endpoints — disabled on Vercel, functional for local dev
if (IS_VERCEL) {
  app.post("/api/excluded", requireAuth, readOnlyGuard);
  app.post("/api/upload-excluded", requireAuth, readOnlyGuard);
  app.post("/api/dataset", requireAuth, readOnlyGuard);
  app.delete("/api/dataset", requireAuth, readOnlyGuard);
} else {
  // --- Local/traditional server: full read-write support ---
  var EXCLUDED_FILE = path.join(__dirname, "server-data", "excluded.json");

  function readExcluded() {
    try {
      if (fs.existsSync(EXCLUDED_FILE)) {
        return JSON.parse(fs.readFileSync(EXCLUDED_FILE, "utf8"));
      }
    } catch (e) {
      console.warn("Could not read excluded.json:", e.message);
    }
    return {};
  }

  function writeExcluded(data) {
    var dir = path.dirname(EXCLUDED_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(EXCLUDED_FILE, JSON.stringify(data, null, 2));
  }

  app.post("/api/excluded", requireAuth, function (req, res) {
    var map = req.body;
    if (typeof map !== "object" || Array.isArray(map)) {
      return res.status(400).json({ error: "Expected object mapping ZIP -> timestamp" });
    }
    writeExcluded(map);
    res.json({ saved: true });
  });

  app.post("/api/upload-excluded", requireAuth, function (req, res) {
    var zips = req.body.zips;
    if (!Array.isArray(zips)) {
      return res.status(400).json({ error: "Expected { zips: string[] }" });
    }
    var valid = [];
    var invalid = [];
    var now = new Date().toISOString();
    zips.forEach(function (z) {
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
    var current = readExcluded();
    valid.forEach(function (zip) {
      if (!current[zip]) current[zip] = now;
    });
    writeExcluded(current);
    res.json({ saved: true, added: valid.length, invalid: invalid, total: Object.keys(current).length });
  });

  app.post("/api/dataset", requireAuth, function (req, res) {
    var data = req.body;
    if (!data || !data.merged) {
      return res.status(400).json({ error: "Invalid dataset format" });
    }
    var dir = path.join(__dirname, "server-data");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    var now = new Date().toISOString();
    fs.writeFileSync(path.join(dir, "uploaded-dataset.json"), JSON.stringify(data));
    fs.writeFileSync(path.join(dir, "uploaded-at.json"), JSON.stringify({ uploaded_at: now }));
    res.json({ saved: true, uploaded_at: now });
  });

  app.delete("/api/dataset", requireAuth, function (_req, res) {
    var dir = path.join(__dirname, "server-data");
    ["uploaded-dataset.json", "uploaded-at.json", "excluded.json"].forEach(function (f) {
      var p = path.join(dir, f);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    });
    res.json({ cleared: true });
  });
}

app.get("/api/dataset-meta", requireAuth, function (_req, res) {
  if (IS_VERCEL) {
    return res.json({ uploaded_at: null });
  }
  var metaPath = path.join(__dirname, "server-data", "uploaded-at.json");
  if (fs.existsSync(metaPath)) {
    var meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    return res.json(meta);
  }
  res.json({ uploaded_at: null });
});

// --------------- Start / Export ---------------
// Vercel: export the app for the serverless adapter
// Local: bind to port
if (!IS_VERCEL) {
  app.listen(PORT, function () {
    console.log("Swiss Territory App server running on http://localhost:" + PORT);
    console.log("Environment: " + (process.env.NODE_ENV || "development"));
  });
}

module.exports = app;
