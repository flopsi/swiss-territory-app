#!/usr/bin/env node
/**
 * regenerate-data.js — Regenerate data/data.js from source CSV files.
 *
 * Usage:
 *   node scripts/regenerate-data.js <sfdc_csv> <territory_csv>
 *
 * Mirrors the preprocessUploadedCSVs() logic in js/uploads.js, including
 * the SFDC-only ZIP assignment rule:
 *   When a ZIP is in SFDC but not in the master territory file, assign it
 *   using the CMD Account Manager name and the territory ID associated with
 *   that manager from the inferred territory→manager mapping.
 */

const fs = require("fs");
const path = require("path");

// ---------- helpers ----------
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuote = false;
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuote) {
      if (ch === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') { field += '"'; i++; }
        else inQuote = false;
      } else { field += ch; }
    } else {
      if (ch === '"') inQuote = true;
      else if (ch === ",") { row.push(field.trim()); field = ""; }
      else if (ch === "\n") {
        row.push(field.trim());
        if (row.length > 1 || (row.length === 1 && row[0] !== "")) rows.push(row);
        row = []; field = "";
      } else { field += ch; }
    }
  }
  row.push(field.trim());
  if (row.length > 1 || (row.length === 1 && row[0] !== "")) rows.push(row);
  if (rows.length < 2) return [];
  const headers = rows[0];
  return rows.slice(1).map(r => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = r[i] || ""; });
    return obj;
  });
}

function normalizeZip(z) {
  if (!z) return null;
  z = String(z).trim().replace(/[^\d]/g, "");
  if (!z) return null;
  while (z.length < 4) z = "0" + z;
  return z.length === 4 ? z : null;
}

// ---------- main ----------
const args = process.argv.slice(2);
if (args.length < 2) {
  console.error("Usage: node scripts/regenerate-data.js <sfdc_csv> <territory_csv>");
  process.exit(1);
}

const sfdcText = fs.readFileSync(args[0], "utf-8");
const territoryText = fs.readFileSync(args[1], "utf-8");
const sfdcRows = parseCSV(sfdcText);
const territoryRows = parseCSV(territoryText);

console.log(`SFDC rows: ${sfdcRows.length}`);
console.log(`Territory rows: ${territoryRows.length}`);

// --- Build master from territory CSV ---
const masterByZip = {};
territoryRows.forEach(row => {
  const z = normalizeZip(row["Postcode"]);
  if (!z) return;
  const tid = (row["Territory_ID"] || row["Territory ID"] || "").trim();
  const am = (row["AM 2026"] || "").trim();
  masterByZip[z] = { postcode: z, territory_id: tid, account_manager: am, official_city: "", canton: "" };
});

// --- Build SFDC aggregation ---
const sfdcByZip = {};
sfdcRows.forEach(row => {
  const z = normalizeZip(row["zip"] || row["Billing Zip/Postal Code"]);
  if (!z) return;
  if (!sfdcByZip[z]) sfdcByZip[z] = { accounts: [], managers: {} };
  sfdcByZip[z].accounts.push({
    id: (row["SF Account ID"] || "").trim(),
    name: (row["Accounts Name"] || "").trim(),
    industry: (row["Industry Segment*"] || "").trim(),
    sector: (row["Economic Sector"] || "").trim(),
    naics: (row["NAICS Industry"] || "").trim(),
  });
  const mgr = (row["CMD Account Manager"] || "").trim();
  if (mgr) sfdcByZip[z].managers[mgr] = (sfdcByZip[z].managers[mgr] || 0) + 1;
});

// --- Infer account managers when territory file lacks AM column ---
const hasAMColumn = Object.keys(masterByZip).some(z => masterByZip[z].account_manager !== "");

if (!hasAMColumn) {
  const zipsByTerritory = {};
  Object.keys(masterByZip).forEach(z => {
    const tid = masterByZip[z].territory_id;
    if (!zipsByTerritory[tid]) zipsByTerritory[tid] = [];
    zipsByTerritory[tid].push(z);
  });
  Object.keys(zipsByTerritory).forEach(tid => {
    const managerCounts = {};
    zipsByTerritory[tid].forEach(z => {
      if (sfdcByZip[z]) {
        Object.keys(sfdcByZip[z].managers).forEach(m => {
          managerCounts[m] = (managerCounts[m] || 0) + 1;
        });
      }
    });
    let bestMgr = "";
    let bestCount = 0;
    Object.keys(managerCounts).forEach(m => {
      if (managerCounts[m] > bestCount) { bestCount = managerCounts[m]; bestMgr = m; }
    });
    if (bestMgr) {
      zipsByTerritory[tid].forEach(z => { masterByZip[z].account_manager = bestMgr; });
    }
  });
}

// --- Manager name mapping (SFDC -> territory) ---
const masterManagers = {};
Object.keys(masterByZip).forEach(z => {
  const m = masterByZip[z].account_manager;
  if (m) masterManagers[m.toLowerCase()] = m;
});

function mapManager(sfdcName) {
  if (!sfdcName) return sfdcName;
  const lc = sfdcName.toLowerCase();
  if (masterManagers[lc]) return masterManagers[lc];
  const sParts = lc.split(/\s+/);
  let bestMatch = null;
  let bestScore = 0;
  Object.keys(masterManagers).forEach(mk => {
    const mkParts = mk.split(/\s+/);
    let shared = 0;
    sParts.forEach(sp => { if (mkParts.indexOf(sp) >= 0) shared++; });
    if (shared > bestScore) { bestScore = shared; bestMatch = masterManagers[mk]; }
  });
  return bestScore >= 1 && bestMatch ? bestMatch : sfdcName;
}

// --- Merge ---
const merged = [];
Object.keys(masterByZip).sort().forEach(z => {
  const mdata = masterByZip[z];
  const sdata = sfdcByZip[z];
  const entry = {
    postcode: mdata.postcode,
    territory_id: mdata.territory_id,
    account_manager: mdata.account_manager,
    official_city: mdata.official_city,
    canton: mdata.canton,
  };
  if (sdata) {
    entry.in_sfdc = true;
    entry.sfdc_account_count = sdata.accounts.length;
    entry.sfdc_accounts = sdata.accounts;
    entry.sfdc_managers = Object.keys(sdata.managers).map(mapManager).sort();
    entry.sfdc_territories = [mdata.territory_id];
    entry.status = "covered";
  } else {
    entry.in_sfdc = false;
    entry.sfdc_account_count = 0;
    entry.sfdc_accounts = [];
    entry.sfdc_managers = [];
    entry.sfdc_territories = [];
    entry.status = "potential";
  }
  merged.push(entry);
});

// --- Build metadata sets ---
const territoriesSet = {};
const managersSet = {};
merged.forEach(e => {
  if (e.territory_id) territoriesSet[e.territory_id] = true;
  if (e.account_manager) managersSet[e.account_manager] = true;
});

// --- Build manager -> territory mapping ---
const managerToTerritory = {};
Object.keys(masterByZip).forEach(z => {
  const m = masterByZip[z].account_manager;
  const t = masterByZip[z].territory_id;
  if (m && t) {
    if (!managerToTerritory[m]) managerToTerritory[m] = {};
    managerToTerritory[m][t] = (managerToTerritory[m][t] || 0) + 1;
  }
});
const managerTerritoryResolved = {};
Object.keys(managerToTerritory).forEach(m => {
  let best = "";
  let bestCount = 0;
  Object.keys(managerToTerritory[m]).forEach(t => {
    if (managerToTerritory[m][t] > bestCount) { bestCount = managerToTerritory[m][t]; best = t; }
  });
  if (best) managerTerritoryResolved[m] = best;
});

console.log("\nManager -> Territory mapping:");
Object.keys(managerTerritoryResolved).sort().forEach(m => {
  console.log(`  ${m} -> ${managerTerritoryResolved[m]}`);
});

// --- SFDC-only: assign via manager -> territory rule ---
// Rule: pick the manager with the most SFDC accounts in this ZIP (dominant evidence).
// Tie-break: alphabetical by manager name (deterministic fallback).
const sfdcOnly = [];
let assignedCount = 0;
const ambiguousCases = [];
Object.keys(sfdcByZip).forEach(z => {
  if (!masterByZip[z]) {
    const sd = sfdcByZip[z];
    const mappedManagers = Object.keys(sd.managers).map(mapManager).sort();
    // Build mapped-manager -> account count (sum raw counts for each SFDC name that maps to same master name)
    const mappedCounts = {};
    Object.keys(sd.managers).forEach(rawMgr => {
      const mapped = mapManager(rawMgr);
      mappedCounts[mapped] = (mappedCounts[mapped] || 0) + sd.managers[rawMgr];
    });
    // Sort candidates: highest account count first, then alphabetical tie-break
    const candidates = mappedManagers
      .filter(m => m && managerTerritoryResolved[m])
      .sort((a, b) => {
        const diff = (mappedCounts[b] || 0) - (mappedCounts[a] || 0);
        return diff !== 0 ? diff : a.localeCompare(b);
      });
    let assignedManager = candidates.length > 0 ? candidates[0] : "";
    let assignedTerritory = assignedManager ? managerTerritoryResolved[assignedManager] : "";
    // Track ambiguity when multiple managers map to different territories
    if (mappedManagers.length > 1) {
      const uniqueTerrs = {};
      mappedManagers.forEach(m => {
        if (m && managerTerritoryResolved[m]) uniqueTerrs[managerTerritoryResolved[m]] = m;
      });
      if (Object.keys(uniqueTerrs).length > 1) {
        ambiguousCases.push({ zip: z, managers: mappedManagers, territories: Object.keys(uniqueTerrs), chosen: assignedTerritory });
      }
    }
    if (assignedTerritory) {
      merged.push({
        postcode: z,
        territory_id: assignedTerritory,
        account_manager: assignedManager,
        official_city: "",
        canton: "",
        in_sfdc: true,
        sfdc_account_count: sd.accounts.length,
        sfdc_accounts: sd.accounts,
        sfdc_managers: mappedManagers,
        sfdc_territories: [assignedTerritory],
        status: "covered",
        _assigned_from_sfdc: true,
      });
      if (assignedTerritory) territoriesSet[assignedTerritory] = true;
      if (assignedManager) managersSet[assignedManager] = true;
      assignedCount++;
    } else {
      sfdcOnly.push({
        postcode: z,
        sfdc_account_count: sd.accounts.length,
        sfdc_accounts: sd.accounts,
        sfdc_managers: mappedManagers,
        sfdc_territories: [],
        note: "present in SFDC but missing from master (no manager-territory mapping)",
      });
    }
  }
});
sfdcOnly.sort((a, b) => a.postcode < b.postcode ? -1 : 1);
merged.sort((a, b) => a.postcode < b.postcode ? -1 : 1);

// --- Finalize metadata ---
const territories = Object.keys(territoriesSet).sort();
const managers = Object.keys(managersSet).sort();

const tPal = ["#e6194b","#3cb44b","#4363d8","#f58231","#911eb4","#42d4f4","#f032e6","#bfef45","#fabed4","#469990","#dcbeff","#9A6324","#fffac8","#800000","#aaffc3","#808000"];
const mPal = ["#1b9e77","#d95f02","#7570b3","#e7298a","#66a61e","#e6ab02","#a6761d","#666666","#e41a1c","#377eb8","#4daf4a","#984ea3"];

const territoryColors = {};
territories.forEach((t, i) => { territoryColors[t] = tPal[i % tPal.length]; });
const managerColors = {};
managers.forEach((m, i) => { managerColors[m] = mPal[i % mPal.length]; });

const result = {
  merged,
  sfdc_only: sfdcOnly,
  territories,
  managers,
  territory_colors: territoryColors,
  manager_colors: managerColors,
  stats: {
    total_zips: merged.length,
    covered_zips: merged.filter(e => e.status === "covered").length,
    potential_zips: merged.filter(e => e.status === "potential").length,
    sfdc_only_zips: sfdcOnly.length,
    total_sfdc_accounts: merged.reduce((s, e) => s + e.sfdc_account_count, 0),
  },
};

// --- Write output ---
const outPath = path.join(__dirname, "..", "data", "data.js");
fs.writeFileSync(outPath, "var APP_DATA = " + JSON.stringify(result) + ";\n");
console.log(`\nOutput written to ${outPath}`);
console.log(`\nStats:`);
console.log(`  Total ZIPs in merged: ${result.stats.total_zips}`);
console.log(`  Covered ZIPs: ${result.stats.covered_zips}`);
console.log(`  Potential ZIPs: ${result.stats.potential_zips}`);
console.log(`  SFDC-only (unresolved anomalies): ${result.stats.sfdc_only_zips}`);
console.log(`  Total SFDC accounts: ${result.stats.total_sfdc_accounts}`);
console.log(`  SFDC-only ZIPs assigned via manager rule: ${assignedCount}`);

if (ambiguousCases.length > 0) {
  console.log(`\nAmbiguous manager->territory cases (${ambiguousCases.length}):`);
  ambiguousCases.forEach(c => {
    console.log(`  ZIP ${c.zip}: managers=${c.managers.join(", ")} territories=${c.territories.join(", ")} chosen=${c.chosen}`);
  });
}

if (sfdcOnly.length > 0) {
  console.log(`\nUnresolved SFDC-only ZIPs (${sfdcOnly.length}):`);
  sfdcOnly.forEach(s => {
    console.log(`  ZIP ${s.postcode}: managers=${s.sfdc_managers.join(", ") || "(none)"} accounts=${s.sfdc_account_count}`);
  });
}

// --- Export summary data for parent script ---
const summary = {
  assignedCount,
  ambiguousCases,
  unresolvedZips: sfdcOnly.map(s => ({ zip: s.postcode, managers: s.sfdc_managers, accounts: s.sfdc_account_count })),
  stats: result.stats,
  managerTerritoryMapping: managerTerritoryResolved,
};
fs.writeFileSync(path.join(__dirname, "..", "data", "regen-summary.json"), JSON.stringify(summary, null, 2));
