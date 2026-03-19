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

// Rate limiter for filesystem-based endpoints
const dataFileLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
});

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
        connectSrc: ["'self'", "https://int.lindas.admin.ch", "https://api.perplexity.ai"],
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
app.get("/api/data", requireAuth, dataFileLimiter, function (_req, res) {
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
app.get("/api/topojson", requireAuth, dataFileLimiter, function (_req, res) {
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

// --------------- Perplexity Sonar-Pro (backend-only, key never exposed to frontend) ---------------
var PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY || "";

var SONAR_SYSTEM_MSG = "You are a sales qualification assistant for Thermo Fisher Scientific's Chromatography and Mass Spectrometry Division (CMD). Return exactly one sentence: state whether the queried company is or is not a likely CMD target customer, with the primary reason. No hedging, no bullet points, no follow-up questions.";

var SONAR_USER_MSG_TEMPLATE = "Is {company_name} a target customer for Thermo Fisher Scientific's Chromatography and Mass Spectrometry (CMD) division? Research the company's industry, analytical laboratory activities, published methods, job postings mentioning liquid chromatography, trace elemental analysis, ICP-OES, ICP-MS, ion chromatography, PFAS, environmental safety, food testing, or mass spectrometry, and regulatory environment. CMD targets include pharma, biotech, life sciences, environmental testing, food safety, clinical research,clinical diagnostic, forensic, toxicology, and industrial quality control organizations that purchase or operate LC, GC, HPLC, UHPLC, or mass spectrometry instruments. Default geography: Switzerland.";

var SONAR_JSON_SCHEMA = {
  type: "json_schema",
  json_schema: {
    schema: {
      type: "object",
      properties: {
        is_target: { type: "boolean" },
        reason: { type: "string" },
      },
      required: ["is_target", "reason"],
    },
  },
};

// Rate-limit Sonar endpoint: 30 requests / 15 min per IP
var sonarLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many Sonar requests. Try again later." },
});

// In-memory session cache for already-searched companies (survives server restart via storage)
var _sonarCacheLoaded = false;
var _sonarCacheMap = {};

function loadSonarCacheOnce() {
  if (_sonarCacheLoaded) return Promise.resolve();
  return storage.getSonarCache().then(function (data) {
    _sonarCacheMap = data || {};
    _sonarCacheLoaded = true;
  });
}

app.post("/api/sonar-search", requireWrite, sonarLimiter, function (req, res) {
  if (!PERPLEXITY_API_KEY) {
    return res.status(503).json({ error: "Perplexity API key not configured. Set PERPLEXITY_API_KEY env var." });
  }

  var companies = req.body.companies;
  var user = req.session.user || "unknown";
  if (!Array.isArray(companies) || companies.length === 0) {
    return res.status(400).json({ error: "Expected { companies: [{ name, zip, locality, uid, org, purpose }] }" });
  }

  // Cap at 50 companies per request to prevent abuse
  if (companies.length > 50) {
    return res.status(400).json({ error: "Maximum 50 companies per request." });
  }

  loadSonarCacheOnce()
    .then(function () {
      var results = [];
      var toSearch = [];

      // Separate cached from uncached
      companies.forEach(function (c) {
        var cacheKey = (c.name || "").toLowerCase().trim() + "|" + (c.zip || "");
        if (_sonarCacheMap[cacheKey]) {
          results.push(Object.assign({}, c, { sonar: _sonarCacheMap[cacheKey], cached: true }));
        } else {
          toSearch.push({ company: c, cacheKey: cacheKey });
        }
      });

      if (toSearch.length === 0) {
        return res.json({ results: results, searched: 0, cached: results.length, cost: 0 });
      }

      // Use structured output for all batch sizes (reliable JSON parsing)
      var searchPromises = toSearch.map(function (item) {
        var userMsg = SONAR_USER_MSG_TEMPLATE.replace("{company_name}", item.company.name);
        return fetch("https://api.perplexity.ai/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": "Bearer " + PERPLEXITY_API_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "sonar-pro",
            messages: [
              { role: "system", content: SONAR_SYSTEM_MSG },
              { role: "user", content: userMsg },
            ],
            response_format: SONAR_JSON_SCHEMA,
          }),
        })
          .then(function (r) {
            if (!r.ok) return r.text().then(function (t) { throw new Error("Sonar API " + r.status + ": " + t); });
            return r.json();
          })
          .then(function (data) {
            var parsed = {};
            try {
              parsed = JSON.parse(data.choices[0].message.content);
            } catch (e) {
              parsed = { is_target: false, reason: "Failed to parse Sonar response" };
            }
            var cost = 0;
            if (data.usage && data.usage.cost && data.usage.cost.total_cost) {
              cost = data.usage.cost.total_cost;
            }
            return { item: item, parsed: parsed, cost: cost };
          })
          .catch(function (err) {
            return { item: item, parsed: { is_target: false, reason: "API error: " + err.message }, cost: 0, error: true };
          });
      });

      return Promise.all(searchPromises).then(function (searchResults) {
        var totalCost = 0;
        searchResults.forEach(function (sr) {
          totalCost += sr.cost;
          var sonarResult = {
            is_target: sr.parsed.is_target,
            reason: sr.parsed.reason,
            cost: sr.cost,
            searched_at: new Date().toISOString(),
            searched_by: user,
          };
          _sonarCacheMap[sr.item.cacheKey] = sonarResult;
          results.push(Object.assign({}, sr.item.company, { sonar: sonarResult, cached: false }));
        });

        // Persist cache and cost tracking
        var costPromise = storage.getSonarCosts().then(function (costs) {
          costs.total_cost = (costs.total_cost || 0) + totalCost;
          costs.queries = (costs.queries || 0) + searchResults.length;
          return storage.putSonarCosts(costs);
        });

        // Persist identified companies for companies classified as target
        var companiesPromise = storage.getIdentifiedCompanies().then(function (existing) {
          var now = new Date().toISOString();
          results.forEach(function (r) {
            if (r.sonar && r.sonar.is_target) {
              existing.push({
                name: r.name || r.legalName || "",
                zip: r.zip || r.postalCode || "",
                locality: r.locality || "",
                uid: r.uid || "",
                org: r.org || "",
                purpose: r.purpose || "",
                source: r.cached ? "sonar-cached" : "sonar",
                is_target: true,
                reason: r.sonar.reason,
                identified_at: now,
                identified_by: user,
              });
            }
          });
          return storage.putIdentifiedCompanies(existing);
        });

        // Update leaderboard
        var leaderPromise = storage.getLeaderboard().then(function (lb) {
          var newTargets = results.filter(function (r) { return r.sonar && r.sonar.is_target && !r.cached; });
          if (newTargets.length > 0) {
            if (!lb[user]) lb[user] = { count: 0, last_at: null };
            lb[user].count += newTargets.length;
            lb[user].last_at = new Date().toISOString();
          }
          return storage.putLeaderboard(lb);
        });

        return Promise.all([
          storage.putSonarCache(_sonarCacheMap),
          costPromise,
          companiesPromise,
          leaderPromise,
        ]).then(function () {
          res.json({
            results: results,
            searched: searchResults.filter(function (sr) { return !sr.error; }).length,
            cached: results.filter(function (r) { return r.cached; }).length,
            errors: searchResults.filter(function (sr) { return sr.error; }).length,
            cost: totalCost,
          });
        });
      });
    })
    .catch(function (err) {
      console.error("Sonar search failed:", err);
      res.status(500).json({ error: "Sonar search failed: " + err.message });
    });
});

// Check if Perplexity is configured (no key exposed)
app.get("/api/sonar-status", requireAuth, function (_req, res) {
  res.json({ configured: !!PERPLEXITY_API_KEY });
});

// Get API cost summary
app.get("/api/sonar-costs", requireAuth, function (_req, res) {
  storage.getSonarCosts()
    .then(function (data) { res.json(data); })
    .catch(function () { res.json({ total_cost: 0, queries: 0 }); });
});

// --------------- Identified Companies CSV (backend-persisted) ---------------
app.get("/api/identified-companies", requireAuth, function (_req, res) {
  storage.getIdentifiedCompanies()
    .then(function (data) { res.json(data); })
    .catch(function () { res.json([]); });
});

// Add companies from ZEFIX (manual identification)
app.post("/api/identified-companies", requireWrite, function (req, res) {
  var newCompanies = req.body.companies;
  var user = req.session.user || "unknown";
  if (!Array.isArray(newCompanies)) {
    return res.status(400).json({ error: "Expected { companies: [...] }" });
  }
  storage.getIdentifiedCompanies()
    .then(function (existing) {
      var now = new Date().toISOString();
      newCompanies.forEach(function (c) {
        existing.push({
          name: c.legalName || c.name || "",
          zip: c.postalCode || c.zip || "",
          locality: c.locality || "",
          uid: c.uid || "",
          org: c.org || "",
          purpose: c.purpose || "",
          source: "zefix",
          is_target: true,
          reason: "Manually identified from ZEFIX",
          identified_at: now,
          identified_by: user,
        });
      });

      // Update leaderboard for ZEFIX identifications
      return storage.getLeaderboard().then(function (lb) {
        if (!lb[user]) lb[user] = { count: 0, last_at: null };
        lb[user].count += newCompanies.length;
        lb[user].last_at = now;
        return storage.putLeaderboard(lb);
      }).then(function () {
        return storage.putIdentifiedCompanies(existing);
      }).then(function () {
        res.json({ saved: true, total: existing.length });
      });
    })
    .catch(function (err) {
      console.error("Failed to save identified companies:", err.message);
      res.status(500).json({ error: err.message });
    });
});

// Download identified companies as CSV
app.get("/api/identified-companies.csv", requireAuth, function (_req, res) {
  storage.getIdentifiedCompanies()
    .then(function (data) {
      var header = "Company_Name,ZIP,Locality,UID,Source,Is_Target,Reason,Identified_At,Identified_By";
      var rows = (data || []).map(function (c) {
        return [
          csvQuote(c.name), csvQuote(c.zip), csvQuote(c.locality), csvQuote(c.uid),
          csvQuote(c.source), c.is_target ? "true" : "false",
          csvQuote(c.reason), csvQuote(c.identified_at), csvQuote(c.identified_by),
        ].join(",");
      });
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=identified_companies.csv");
      res.send(header + "\n" + rows.join("\n"));
    })
    .catch(function (err) {
      res.status(500).json({ error: err.message });
    });
});

function csvQuote(val) {
  var s = String(val || "");
  if (s.indexOf(",") >= 0 || s.indexOf('"') >= 0 || s.indexOf("\n") >= 0) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// --------------- Leaderboard ---------------
app.get("/api/leaderboard", requireAuth, function (_req, res) {
  storage.getLeaderboard()
    .then(function (data) { res.json(data); })
    .catch(function () { res.json({}); });
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
