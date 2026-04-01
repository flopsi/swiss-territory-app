/**
 * exports.js — CSV export functions for excluded ZIPs, identified ZIPs, selected ZIPs, and full master.
 * Rewritten for flat master JSON with 5 statuses.
 */

import { state, getActiveData, getEffectiveStatus } from "./state.js";
import { downloadCSV } from "./utils.js";

export function exportFullMaster() {
  var data = getActiveData();
  var rows = [["ZIP", "City", "Canton", "State", "Province", "Community", "Manager", "Territory", "Status", "Lat", "Lon"]];
  data.merged.forEach(function (e) {
    var eff = getEffectiveStatus(state.zipDataMap[e.postcode]);
    rows.push([
      e.postcode,
      '"' + (e.official_city || "").replace(/"/g, '""') + '"',
      e.canton || "",
      '"' + (e.state || "").replace(/"/g, '""') + '"',
      '"' + (e.province || "").replace(/"/g, '""') + '"',
      '"' + (e.community || "").replace(/"/g, '""') + '"',
      '"' + (e.account_manager || "").replace(/"/g, '""') + '"',
      e.territory_id || "",
      eff,
      e.latitude || "",
      e.longitude || "",
    ]);
  });
  downloadCSV("territory_master_export.csv", rows.map(function (r) { return r.join(","); }).join("\n"));
}

export function exportExcludedZips() {
  var excludedKeys = Object.keys(state.excludedZips);
  // Also include ZIPs whose master status is "excluded"
  var data = getActiveData();
  var masterExcluded = {};
  data.merged.forEach(function (e) {
    if (e.status === "excluded") masterExcluded[e.postcode] = true;
  });
  // Merge both sets
  var allExcluded = {};
  Object.keys(masterExcluded).forEach(function (z) { allExcluded[z] = "master"; });
  excludedKeys.forEach(function (z) { allExcluded[z] = "user"; });

  var keys = Object.keys(allExcluded);
  if (keys.length === 0) { alert("No excluded ZIPs."); return; }

  var rows = [["ZIP", "City", "Canton", "Manager", "Territory", "Source", "Excluded_At"]];
  keys.sort().forEach(function (zip) {
    var entry = state.zipDataMap[zip];
    rows.push([
      zip,
      entry ? entry.official_city || "" : "",
      entry ? entry.canton || "" : "",
      entry ? '"' + (entry.account_manager || "").replace(/"/g, '""') + '"' : "",
      entry ? entry.territory_id || "" : "",
      allExcluded[zip],
      state.excludedZips[zip] || "",
    ]);
  });
  downloadCSV("excluded_zips_export.csv", rows.map(function (r) { return r.join(","); }).join("\n"));
}

export function exportIdentifiedZips() {
  var identifiedKeys = Object.keys(state.identifiedZips);
  if (identifiedKeys.length === 0) { alert("No identified ZIPs."); return; }

  var rows = [["ZIP", "City", "Canton", "Manager", "Territory", "Previous_Status", "Identified_At"]];
  identifiedKeys.sort().forEach(function (zip) {
    var entry = state.zipDataMap[zip];
    var prevStatus = entry ? entry.status || "" : "";
    rows.push([
      zip,
      entry ? entry.official_city || "" : "",
      entry ? entry.canton || "" : "",
      entry ? '"' + (entry.account_manager || "").replace(/"/g, '""') + '"' : "",
      entry ? entry.territory_id || "" : "",
      prevStatus,
      state.identifiedZips[zip],
    ]);
  });
  downloadCSV("identified_zips_export.csv", rows.map(function (r) { return r.join(","); }).join("\n"));
}

export function exportSelectedZips() {
  var keys = Object.keys(state.selectedZips);
  if (keys.length === 0) return;

  var rows = [["ZIP", "City", "Canton", "Province", "Community", "Manager", "Territory", "Status"]];
  keys.sort().forEach(function (zip) {
    var entry = state.zipDataMap[zip];
    var eff = getEffectiveStatus(entry);
    rows.push([
      zip,
      entry ? entry.official_city || "" : "",
      entry ? entry.canton || "" : "",
      entry ? '"' + (entry.province || "").replace(/"/g, '""') + '"' : "",
      entry ? '"' + (entry.community || "").replace(/"/g, '""') + '"' : "",
      entry ? '"' + (entry.account_manager || "").replace(/"/g, '""') + '"' : "",
      entry ? entry.territory_id || "" : "",
      eff,
    ]);
  });
  downloadCSV("selected_zips_export.csv", rows.map(function (r) { return r.join(","); }).join("\n"));
}
