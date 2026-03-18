/**
 * server.js — Authenticated Express backend for Swiss Territory App.
 *
 * Serves sensitive data (territory assignments, SFDC accounts) only after login.
 * Static frontend assets are served publicly; data endpoints require a session.
 *
 * Vercel-compatible: uses cookie-session (stateless), Vercel Blob for durable
 * persistence, and exports the app for serverless. Local dev uses filesystem.
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
const rateLimit = require("express-rate-limit");
const storage = require("./storage");

const app = express();
const PORT = parseInt(process.env.PORT || "3000", 10);
const IS_VERCEL = !!process.env.VERCEL;

// Rate limiter for filesystem-based dataset metadata endpoint
const datasetMetaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true, // Return rate limit info in the RateLimit-* headers
  legacyHeaders: false, // Disable the deprecated X-RateLimit-* headers
});

// --------------- Environment ---------------
const ADMIN_USER = process.env.ADMIN_USER || "admin";
// Pre-hashed password from env, or fall back to hashing a default (dev only)
const ADMIN_HASH =
  process.env.ADMIN_PASSWORD_HASH ||
  bcryptjs.hashSync(process.env.ADMIN_PASSWORD || "changeme", 10);

// View-only management user (can inspect but not modify data)
const VIEWER_USER = process.env.VIEWER_USER || "viewer";
const VIEWER_HASH =
  process.env.VIEWER_PASSWORD_HASH ||
  bcryptjs.hashSync(process.env.VIEWER_PASSWORD || "viewonly", 10);

const SESSION_SECRET = process.env.SESSION_SECRET || "dev-secret-change-me";
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "").split(",").filter(Boolean);

// --------------- Middleware ---------------
// Trust Vercel's (and other reverse proxies') X-Forwarded-* headers so that
// req.secure / req.protocol reflect the real client connection.  Without this,
// cookie-session silently refuses to set Secure cookies because the last hop
// between the proxy and the serverless function is plain HTTP.
app.set("trust proxy", 1);

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

// Require write (admin) role — blocks view-only users from modifying data
function requireWrite(req, res, next) {
  if (req.session && req.session.authenticated && req.session.role === "admin") return next();
  if (req.session && req.session.authenticated) {
    return res.status(403).json({ error: "View-only account. Modifications not permitted." });
  }
  return res.status(401).json({ error: "Authentication required" });
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

  // Determine which user is logging in
  var role = null;
  if (username === ADMIN_USER && bcryptjs.compareSync(password, ADMIN_HASH)) {
    role = "admin";
  } else if (username === VIEWER_USER && bcryptjs.compareSync(password, VIEWER_HASH)) {
    role = "viewer";
  }

  if (!role) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  req.session.authenticated = true;
  req.session.user = username;
  req.session.role = role;

  // Set CSRF cookie for subsequent requests
  var crypto = require("crypto");
  var csrfToken = crypto.randomBytes(32).toString("hex");
  res.cookie("csrf_token", csrfToken, {
    httpOnly: false, // JS must read it
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
  });

  res.json({ ok: true, csrf_token: csrfToken, role: role });
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
    return res.json({ authenticated: true, user: req.session.user, role: req.session.role || "admin" });
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

// --------------- Excluded ZIPs (durable storage via Vercel Blob or filesystem) ---------------
app.get("/api/excluded", requireAuth, function (_req, res) {
  storage.getExcluded()
    .then(function (data) { res.json(data); })
    .catch(function (err) {
      console.error("Failed to read excluded ZIPs:", err.message);
      res.json({});
    });
});

app.post("/api/excluded", requireWrite, function (req, res) {
  var map = req.body;
  if (typeof map !== "object" || Array.isArray(map)) {
    return res.status(400).json({ error: "Expected object mapping ZIP -> timestamp" });
  }
  storage.putExcluded(map)
    .then(function () { res.json({ saved: true }); })
    .catch(function (err) {
      console.error("Failed to save excluded ZIPs:", err.message);
      res.status(500).json({ error: err.message });
    });
});

app.post("/api/upload-excluded", requireWrite, function (req, res) {
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
  storage.getExcluded()
    .then(function (current) {
      valid.forEach(function (zip) {
        if (!current[zip]) current[zip] = now;
      });
      return storage.putExcluded(current).then(function () {
        res.json({ saved: true, added: valid.length, invalid: invalid, total: Object.keys(current).length });
      });
    })
    .catch(function (err) {
      console.error("Failed to upload excluded ZIPs:", err.message);
      res.status(500).json({ error: err.message });
    });
});

// --------------- Identified ZIPs (durable storage) ---------------
app.get("/api/identified", requireAuth, function (_req, res) {
  storage.getIdentified()
    .then(function (data) { res.json(data); })
    .catch(function (err) {
      console.error("Failed to read identified ZIPs:", err.message);
      res.json({});
    });
});

app.post("/api/identified", requireWrite, function (req, res) {
  var map = req.body;
  if (typeof map !== "object" || Array.isArray(map)) {
    return res.status(400).json({ error: "Expected object mapping ZIP -> timestamp" });
  }
  storage.putIdentified(map)
    .then(function () { res.json({ saved: true }); })
    .catch(function (err) {
      console.error("Failed to save identified ZIPs:", err.message);
      res.status(500).json({ error: err.message });
    });
});

// --------------- Dataset endpoints (durable storage) ---------------
app.post("/api/dataset", requireWrite, function (req, res) {
  var data = req.body;
  if (!data || !data.merged) {
    return res.status(400).json({ error: "Invalid dataset format" });
  }
  var now = new Date().toISOString();
  Promise.all([
    storage.putDataset(data),
    storage.putDatasetMeta({ uploaded_at: now }),
  ])
    .then(function () { res.json({ saved: true, uploaded_at: now }); })
    .catch(function (err) {
      console.error("Failed to save dataset:", err.message);
      res.status(500).json({ error: err.message });
    });
});

app.delete("/api/dataset", requireWrite, function (_req, res) {
  storage.clearAll()
    .then(function () { res.json({ cleared: true }); })
    .catch(function (err) {
      console.error("Failed to clear dataset:", err.message);
      res.status(500).json({ error: err.message });
    });
});

app.get("/api/dataset-meta", requireAuth, datasetMetaLimiter, function (_req, res) {
  storage.getDatasetMeta()
    .then(function (meta) { res.json(meta); })
    .catch(function (err) {
      console.error("Failed to read dataset meta:", err.message);
      res.json({ uploaded_at: null });
    });
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
