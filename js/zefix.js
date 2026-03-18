/**
 * zefix.js — ZEFIX SPARQL query, result table, selection, CSV export, and Notion queue.
 */

import { state, getActiveData, ZEFIX_COLUMNS } from "./state.js";
import { escapeHTML, downloadCSV } from "./utils.js";
import { apiRequest } from "./api.js";

// ==================== SPARQL / ZEFIX Query ====================
var ZEFIX_PAGE_SIZE = 10000; // Large page size — no artificial limit

function buildZefixSparql(valuesClause, offset) {
  return [
    "PREFIX schema: <http://schema.org/>",
    "PREFIX admin: <https://schema.ld.admin.ch/>",
    "SELECT DISTINCT ?org ?legalName ?postalCode ?locality ?uid ?purpose",
    "WHERE {",
    "  ?org a admin:ZefixOrganisation ;",
    "       schema:legalName ?legalName ;",
    "       schema:address ?addr .",
    "  ?addr schema:postalCode ?postalCode .",
    "  OPTIONAL { ?addr schema:addressLocality ?locality }",
    "  OPTIONAL {",
    "    ?org schema:identifier ?uidRes .",
    "    FILTER(CONTAINS(STR(?uidRes), '/UID/'))",
    "    BIND(REPLACE(STR(?uidRes), '^.*/UID/', '') AS ?uid)",
    "  }",
    "  OPTIONAL { ?org schema:description ?purpose }",
    "  VALUES ?postalCode { " + valuesClause + " }",
    "}",
    "ORDER BY ?postalCode ?legalName",
    "LIMIT " + ZEFIX_PAGE_SIZE,
    "OFFSET " + offset,
  ].join("\n");
}

function fetchZefixPage(valuesClause, offset) {
  var sparql = buildZefixSparql(valuesClause, offset);
  return fetch("https://int.lindas.admin.ch/query", {
    method: "POST",
    headers: {
      "Content-Type": "application/sparql-query",
      "Accept": "application/sparql-results+json",
    },
    body: sparql,
  })
    .then(function (res) {
      if (!res.ok) throw new Error("SPARQL endpoint returned " + res.status);
      return res.json();
    })
    .then(function (data) {
      return data.results.bindings.map(function (b) {
        return {
          org: b.org ? b.org.value : "",
          legalName: b.legalName ? b.legalName.value : "",
          postalCode: b.postalCode ? b.postalCode.value : "",
          locality: b.locality ? b.locality.value : "",
          uid: b.uid ? b.uid.value : "",
          purpose: b.purpose ? b.purpose.value : "",
        };
      });
    });
}

export function queryZefix() {
  var zips = Object.keys(state.selectedZips).sort();
  if (zips.length === 0 || zips.length > 10) return;

  var panel = document.getElementById("zefixPanel");
  var statusEl = document.getElementById("zefixStatus");
  var tbody = document.getElementById("zefixBody");

  panel.style.display = "flex";
  statusEl.textContent = "Querying ZEFIX for " + zips.length + " ZIP code" + (zips.length > 1 ? "s" : "") + "...";
  statusEl.className = "zefix-status zefix-loading";
  tbody.innerHTML = "";

  var valuesClause = zips.map(function (z) { return '"' + z + '"'; }).join(" ");
  var allResults = [];

  function fetchNextPage(offset) {
    return fetchZefixPage(valuesClause, offset).then(function (pageResults) {
      allResults = allResults.concat(pageResults);
      statusEl.textContent = "Querying ZEFIX... " + allResults.length + " results so far";
      if (pageResults.length === ZEFIX_PAGE_SIZE) {
        // More results may exist, fetch next page
        return fetchNextPage(offset + ZEFIX_PAGE_SIZE);
      }
      return allResults;
    });
  }

  fetchNextPage(0)
    .then(function (results) {
      // Deduplicate
      var seen = {};
      state.zefixResults = results.filter(function (r) {
        var key = r.org + r.postalCode;
        if (seen[key]) return false;
        seen[key] = true;
        return true;
      });

      statusEl.textContent = state.zefixResults.length + " companies found across " + zips.length + " ZIP code" + (zips.length > 1 ? "s" : "");
      statusEl.className = "zefix-status zefix-success";

      renderZefixTable();
    })
    .catch(function (err) {
      console.error("ZEFIX query failed:", err);
      statusEl.textContent = "Query failed: " + err.message;
      statusEl.className = "zefix-status zefix-error";
    });
}

// ==================== ZEFIX Table Rendering ====================
export function renderZefixTable() {
  var tbody = document.getElementById("zefixBody");
  tbody.innerHTML = "";

  // Initialize checked state array (all checked by default)
  state.zefixChecked = [];

  state.zefixResults.forEach(function (r, idx) {
    state.zefixChecked.push(true);
    var tr = document.createElement("tr");
    var uidDisplay = r.uid || "\u2014";
    var orgId = r.org.split("/").pop();
    var zefixLink = "https://www.zefix.ch/en/search/entity/list/firm/" + orgId;

    // Build expandable purpose cell with 140-char preview truncation
    var purposeHTML;
    var purposeText = r.purpose || "";
    if (purposeText.length > 140) {
      var preview = escapeHTML(purposeText.substring(0, 140)) + "\u2026";
      purposeHTML =
        '<td class="zefix-purpose-cell">' +
          '<details class="zefix-purpose-details">' +
            '<summary class="zefix-purpose-summary">' + preview + '</summary>' +
            '<span class="zefix-purpose-full">' + escapeHTML(purposeText) + '</span>' +
          '</details>' +
        '</td>';
    } else {
      purposeHTML = '<td class="zefix-purpose-cell">' + escapeHTML(purposeText || "\u2014") + '</td>';
    }

    tr.innerHTML =
      '<td><input type="checkbox" class="zefix-row-cb" data-idx="' + idx + '" checked></td>' +
      "<td>" + escapeHTML(r.legalName) + "</td>" +
      purposeHTML +
      "<td>" + escapeHTML(r.postalCode) + "</td>" +
      "<td>" + escapeHTML(r.locality) + "</td>" +
      "<td>" + escapeHTML(uidDisplay) + "</td>" +
      '<td><a href="' + zefixLink + '" target="_blank" rel="noopener noreferrer" class="zefix-link">ZEFIX</a></td>';
    tbody.appendChild(tr);
  });

  // Update select-all checkbox state
  var selAll = document.getElementById("zefixSelectAll");
  if (selAll) selAll.checked = true;
  updateZefixSelectionCount();
}

// ==================== ZEFIX Selection ====================
export function updateZefixSelectionCount() {
  var count = (state.zefixChecked || []).filter(Boolean).length;
  var total = (state.zefixChecked || []).length;
  var el = document.getElementById("zefixSelCount");
  if (el) el.textContent = count + "/" + total + " selected";
}

export function getSelectedZefixResults() {
  var checked = state.zefixChecked || [];
  return state.zefixResults.filter(function (_r, i) { return checked[i]; });
}

// ==================== ZEFIX CSV Export ====================
export function exportZefixResults() {
  var selected = getSelectedZefixResults();
  if (selected.length === 0) { alert("No ZEFIX companies selected for export."); return; }

  // Use centralized column config
  var headerRow = ZEFIX_COLUMNS.map(function (col) { return col.csvHeader; });
  var rows = [headerRow];
  selected.forEach(function (r) {
    var row = ZEFIX_COLUMNS.map(function (col) {
      var val = r[col.key] || "";
      // Quote fields that may contain commas/quotes
      if (val.indexOf(",") >= 0 || val.indexOf('"') >= 0) {
        return '"' + val.replace(/"/g, '""') + '"';
      }
      return val;
    });
    rows.push(row);
  });
  downloadCSV("zefix_results_export.csv", rows.map(function (r) { return r.join(","); }).join("\n"));
}

// ==================== Notion Queue ====================
export function showNotionQueueStatus(message, type) {
  var el = document.getElementById("notionQueueStatus");
  if (!el) return;
  el.style.display = message ? "block" : "none";
  el.textContent = message || "";
  el.className = "zefix-status " + (type || "");
}

export function queueSelectedZefixForNotion() {
  var selected = getSelectedZefixResults();
  if (selected.length === 0) {
    showNotionQueueStatus("No ZEFIX companies selected for Notion.", "zefix-error");
    return;
  }

  var now = new Date();
  var stamp = now.toISOString().replace(/\.\d{3}Z$/, "Z");
  var batchName = "Swiss Territory ZEFIX Export " + stamp;
  var payload = {
    batch_name: batchName,
    source: "Swiss Territory Planner",
    items: selected.map(function (r) {
      var orgId = (r.org || "").split("/").pop();
      return {
        company: r.legalName || "",
        zip: r.postalCode || "",
        locality: r.locality || "",
        uid: r.uid || "",
        purpose: r.purpose || "",
        zefix_url: orgId ? ("https://www.zefix.ch/en/search/entity/list/firm/" + orgId) : (r.org || ""),
        selected_at: stamp,
      };
    }),
  };

  showNotionQueueStatus("Saving checked companies for manual Notion push...", "zefix-loading");
  apiRequest("/api/notion-batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
    .then(function (result) {
      showNotionQueueStatus(
        "Queued " + selected.length + " companies. Manual trigger ready: " + result.batch_id + ". Tell Computer to push the current Notion batch.",
        "zefix-success"
      );
    })
    .catch(function (err) {
      showNotionQueueStatus("Could not queue the Notion batch: " + err.message, "zefix-error");
    });
}
