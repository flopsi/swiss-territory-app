/**
 * perplexity.js — Sonar-Pro search, AM summary table, leaderboard, cost display,
 *                 and automatic ZIP status updates based on Sonar results.
 *
 * ZIP status update rule:
 *   - If ANY company in a ZIP is classified as is_target=true → mark ZIP "identified"
 *   - If ALL searched companies in a ZIP are is_target=false → mark ZIP "excluded"
 *   - If a ZIP has mixed results or insufficient data → no automatic change (left as-is)
 *
 * Leaderboard definition:
 *   Users ranked by total number of companies they identified (via Sonar or ZEFIX manual add).
 *   The "identified_by" field recorded on each company entry determines attribution.
 */

import { state, getActiveData } from "./state.js";
import { escapeHTML } from "./utils.js";
import { apiRequest, isBackendMode, saveIdentified, saveExcluded } from "./api.js";
import { getSessionMemoryCompanies, clearSessionMemory } from "./zefix.js";
import { refreshStyles, updateSelectionTray } from "./map.js";

// ==================== Sonar Results State ====================
var lastSonarResults = [];

// ==================== Sonar Search ====================

/**
 * Trigger a Sonar-Pro search for all companies in session memory.
 * Updates UI with results, costs, and triggers automatic ZIP status changes.
 */
export function runSonarSearch() {
  var companies = getSessionMemoryCompanies();
  if (companies.length === 0) {
    showSonarStatus("No companies in selection memory. Select companies from ZEFIX first, then click 'Remember Selected'.", "zefix-error");
    return;
  }

  if (!isBackendMode()) {
    showSonarStatus("Sonar search requires backend mode.", "zefix-error");
    return;
  }

  // Cost warning for large queries (>200 companies)
  if (companies.length > 200) {
    var ok = confirm(
      "You are about to search " + companies.length + " companies via Sonar-Pro.\n\n" +
      "Large queries like this can incur meaningful API costs (roughly $1+ per " +
      "thousand lookups). Each company requires a separate Perplexity API call.\n\n" +
      "Do you want to proceed?"
    );
    if (!ok) {
      showSonarStatus("Search cancelled by user.", "zefix-loading");
      return;
    }
  }

  showSonarStatus("Searching " + companies.length + " companies via Sonar-Pro...", "zefix-loading");
  disableSonarBtn(true);

  var payload = companies.map(function (c) {
    return {
      name: c.legalName || c.name || "",
      zip: c.postalCode || c.zip || "",
      locality: c.locality || "",
      uid: c.uid || "",
      org: c.org || "",
      purpose: c.purpose || "",
    };
  });

  apiRequest("/api/sonar-search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ companies: payload }),
  })
    .then(function (data) {
      disableSonarBtn(false);
      var targets = data.results.filter(function (r) { return r.sonar && r.sonar.is_target; });
      var nonTargets = data.results.filter(function (r) { return r.sonar && !r.sonar.is_target; });

      showSonarStatus(
        "Done: " + targets.length + " targets, " + nonTargets.length + " non-targets" +
        " (searched: " + data.searched + ", cached: " + data.cached + ", cost: $" + data.cost.toFixed(4) + ")",
        "zefix-success"
      );

      lastSonarResults = data.results;
      renderSonarResults(data.results);
      showSonarDownload(true);
      applyAutomaticZipUpdates(data.results);
      refreshCostDisplay();
      refreshLeaderboard();
      refreshAMSummary();
    })
    .catch(function (err) {
      disableSonarBtn(false);
      showSonarStatus("Search failed: " + err.message, "zefix-error");
    });
}

function showSonarStatus(msg, className) {
  var el = document.getElementById("sonarStatus");
  if (!el) return;
  el.textContent = msg;
  el.className = "zefix-status " + (className || "");
  el.style.display = msg ? "block" : "none";
}

function disableSonarBtn(disabled) {
  var btn = document.getElementById("btnSonarSearch");
  if (btn) btn.disabled = disabled;
}

// ==================== Sonar Results Table ====================

function renderSonarResults(results) {
  var container = document.getElementById("sonarResultsWrap");
  var tbody = document.getElementById("sonarBody");
  if (!container || !tbody) return;

  container.style.display = "block";
  tbody.innerHTML = "";

  results.forEach(function (r) {
    var tr = document.createElement("tr");
    var isTarget = r.sonar && r.sonar.is_target;
    var reason = r.sonar ? r.sonar.reason : "";
    var cachedLabel = r.cached ? " (cached)" : "";
    tr.className = isTarget ? "sonar-row-target" : "sonar-row-nontarget";
    tr.innerHTML =
      "<td>" + escapeHTML(r.name || r.legalName || "") + "</td>" +
      "<td>" + escapeHTML(r.zip || r.postalCode || "") + "</td>" +
      "<td>" + escapeHTML(r.locality || "") + "</td>" +
      '<td><span class="sonar-badge ' + (isTarget ? "sonar-badge-yes" : "sonar-badge-no") + '">' +
        (isTarget ? "TARGET" : "No") + '</span>' + escapeHTML(cachedLabel) + "</td>" +
      "<td>" + escapeHTML(reason) + "</td>";
    tbody.appendChild(tr);
  });
}

function showSonarDownload(visible) {
  var wrap = document.getElementById("sonarDownloadWrap");
  if (wrap) wrap.style.display = visible ? "block" : "none";
}

export function downloadSonarCSV() {
  if (lastSonarResults.length === 0) return;
  var rows = [["Company", "ZIP", "Locality", "Target", "Reason", "Cached"]];
  lastSonarResults.forEach(function (r) {
    var isTarget = r.sonar && r.sonar.is_target;
    var reason = r.sonar ? r.sonar.reason : "";
    rows.push([
      r.name || r.legalName || "",
      r.zip || r.postalCode || "",
      r.locality || "",
      isTarget ? "Yes" : "No",
      reason,
      r.cached ? "Yes" : "No",
    ]);
  });
  var csv = rows.map(function (row) {
    return row.map(function (cell) {
      var s = String(cell).replace(/"/g, '""');
      return '"' + s + '"';
    }).join(",");
  }).join("\n");
  var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url;
  a.download = "sonar-results.csv";
  a.click();
  URL.revokeObjectURL(url);
}

// ==================== Automatic ZIP Status Updates ====================
/**
 * Rule:
 *   - Group results by ZIP
 *   - If ANY company in a ZIP is is_target → mark ZIP "identified"
 *   - If ALL companies in a ZIP are !is_target → mark ZIP "excluded"
 *   - Mixed/no-data → skip
 */
function applyAutomaticZipUpdates(results) {
  var zipGroups = {};
  results.forEach(function (r) {
    var zip = (r.zip || r.postalCode || "").padStart(4, "0");
    if (!zip || zip.length !== 4) return;
    if (!zipGroups[zip]) zipGroups[zip] = { targets: 0, nonTargets: 0 };
    if (r.sonar) {
      if (r.sonar.is_target) zipGroups[zip].targets++;
      else zipGroups[zip].nonTargets++;
    }
  });

  var now = new Date().toISOString();
  var identifiedCount = 0;
  var excludedCount = 0;

  Object.keys(zipGroups).forEach(function (zip) {
    var g = zipGroups[zip];
    if (g.targets > 0) {
      // At least one target → mark identified
      if (!state.identifiedZips[zip]) {
        state.identifiedZips[zip] = now;
        identifiedCount++;
      }
      // Remove from excluded if it was there
      if (state.excludedZips[zip]) {
        delete state.excludedZips[zip];
      }
    } else if (g.nonTargets > 0 && g.targets === 0) {
      // All searched companies are non-targets → mark excluded
      if (!state.excludedZips[zip] && !state.identifiedZips[zip]) {
        state.excludedZips[zip] = now;
        excludedCount++;
      }
    }
  });

  if (identifiedCount > 0 || excludedCount > 0) {
    var saves = [];
    if (identifiedCount > 0) saves.push(saveIdentified(state.identifiedZips));
    if (excludedCount > 0) saves.push(saveExcluded(state.excludedZips));
    Promise.all(saves).then(function () {
      refreshStyles();
      updateSelectionTray();
    });

    var statusMsg = "";
    if (identifiedCount > 0) statusMsg += identifiedCount + " ZIP(s) marked identified. ";
    if (excludedCount > 0) statusMsg += excludedCount + " ZIP(s) marked excluded.";
    var zipUpdateEl = document.getElementById("sonarZipUpdates");
    if (zipUpdateEl) {
      zipUpdateEl.textContent = statusMsg;
      zipUpdateEl.style.display = "block";
    }
  }
}

// ==================== Cost Display ====================

export function refreshCostDisplay() {
  if (!isBackendMode()) return;
  apiRequest("/api/sonar-costs", { method: "GET" })
    .then(function (data) {
      var cost = data.total_cost || 0;
      var queries = data.queries || 0;
      var el = document.getElementById("sonarCostDisplay");
      if (el) {
        el.textContent = "$" + cost.toFixed(4) + " (" + queries + " lookups)";
      }
      // Update header cost badge
      var badge = document.getElementById("headerCostBadge");
      var val = document.getElementById("headerCostValue");
      if (badge && val) {
        val.textContent = "$" + cost.toFixed(2) + " (" + queries + ")";
        badge.style.display = (cost > 0 || queries > 0) ? "inline-flex" : "none";
      }
    })
    .catch(function () { /* silent */ });
}

// ==================== AM Summary Table ====================
/**
 * Shows newly identified companies count per Account Manager.
 * Fetches all identified companies from backend and groups by AM via ZIP→AM mapping.
 */
export function refreshAMSummary() {
  if (!isBackendMode()) return;
  var data = getActiveData();
  if (!data) return;

  apiRequest("/api/identified-companies", { method: "GET" })
    .then(function (companies) {
      var amCounts = {};
      companies.forEach(function (c) {
        var zip = (c.zip || "").padStart(4, "0");
        var entry = state.zipDataMap[zip];
        var am = entry ? (entry.account_manager || "Unknown") : "Unknown";
        if (!amCounts[am]) amCounts[am] = 0;
        amCounts[am]++;
      });

      var tbody = document.getElementById("amSummaryBody");
      if (!tbody) return;
      tbody.innerHTML = "";

      var sorted = Object.keys(amCounts).sort(function (a, b) { return amCounts[b] - amCounts[a]; });
      sorted.forEach(function (am) {
        var tr = document.createElement("tr");
        tr.innerHTML =
          "<td>" + escapeHTML(am) + "</td>" +
          "<td><strong>" + amCounts[am] + "</strong></td>";
        tbody.appendChild(tr);
      });

      var container = document.getElementById("amSummarySection");
      if (container) container.style.display = sorted.length > 0 ? "block" : "none";
    })
    .catch(function () { /* silent */ });
}

// ==================== Leaderboard ====================

export function refreshLeaderboard() {
  if (!isBackendMode()) return;
  apiRequest("/api/leaderboard", { method: "GET" })
    .then(function (data) {
      var tbody = document.getElementById("leaderboardBody");
      if (!tbody) return;
      tbody.innerHTML = "";

      var users = Object.keys(data).sort(function (a, b) {
        return (data[b].count || 0) - (data[a].count || 0);
      });

      users.forEach(function (user, idx) {
        var tr = document.createElement("tr");
        var medal = idx === 0 ? " \ud83e\udd47" : idx === 1 ? " \ud83e\udd48" : idx === 2 ? " \ud83e\udd49" : "";
        tr.innerHTML =
          "<td>" + (idx + 1) + medal + "</td>" +
          "<td>" + escapeHTML(user) + "</td>" +
          "<td><strong>" + (data[user].count || 0) + "</strong></td>";
        tbody.appendChild(tr);
      });

      var container = document.getElementById("leaderboardSection");
      if (container) container.style.display = users.length > 0 ? "block" : "none";
    })
    .catch(function () { /* silent */ });
}

// ==================== Session Memory Count Display ====================

export function updateMemoryCount() {
  var el = document.getElementById("sonarMemoryCount");
  var companies = getSessionMemoryCompanies();
  if (el) {
    el.textContent = companies.length + " companies in memory";
    el.style.display = companies.length > 0 ? "inline" : "none";
  }
}
