/**
 * exports.js — CSV export functions for anomalies, excluded ZIPs, and selected ZIPs.
 */

import { state, getActiveData, getEffectiveStatus, getExceptionInfo } from "./state.js";
import { downloadCSV } from "./utils.js";
import { FALLBACK_ZIP_COORDS } from "./map.js";

export function exportAnomalies() {
  var data = getActiveData();
  var rows = [["ZIP", "SFDC_Territory", "SFDC_Manager", "Account_Count", "Account_Names", "Reason", "Category", "Polygon_Exists"]];
  data.sfdc_only.forEach(function (row) {
    var hasPolygon = !!state.topoFeaturesById[row.postcode] || !!FALLBACK_ZIP_COORDS[row.postcode];
    var names = row.sfdc_accounts.map(function (a) { return a.name; }).join("; ");
    var pseudoEntry = state.zipDataMap[row.postcode] || { sfdc_accounts: row.sfdc_accounts };
    var excInfo = getExceptionInfo(pseudoEntry);
    rows.push([
      row.postcode,
      row.sfdc_territories.join("; "),
      row.sfdc_managers.join("; "),
      row.sfdc_account_count,
      '"' + names.replace(/"/g, '""') + '"',
      excInfo ? '"' + excInfo.reason.replace(/"/g, '""') + '"' : "Not in territory file",
      excInfo ? excInfo.category : "Unmatched ZIP",
      hasPolygon ? "Yes" : "No",
    ]);
  });
  downloadCSV("exceptions_export.csv", rows.map(function (r) { return r.join(","); }).join("\n"));
}

export function exportExcludedZips() {
  var excludedKeys = Object.keys(state.excludedZips);
  if (excludedKeys.length === 0) { alert("No excluded ZIPs."); return; }

  var rows = [["ZIP", "City", "Canton", "Manager", "Territory", "Excluded_At"]];
  excludedKeys.sort().forEach(function (zip) {
    var entry = state.zipDataMap[zip];
    rows.push([
      zip,
      entry ? entry.official_city || "" : "",
      entry ? entry.canton || "" : "",
      entry ? entry.account_manager || "" : "",
      entry ? entry.territory_id || "" : "",
      state.excludedZips[zip],
    ]);
  });
  downloadCSV("excluded_zips_export.csv", rows.map(function (r) { return r.join(","); }).join("\n"));
}

export function exportSelectedZips() {
  var keys = Object.keys(state.selectedZips);
  if (keys.length === 0) return;

  var rows = [["ZIP", "City", "Canton", "Manager", "Territory", "Status", "SFDC_Accounts"]];
  keys.sort().forEach(function (zip) {
    var entry = state.zipDataMap[zip];
    var eff = getEffectiveStatus(entry);
    rows.push([
      zip,
      entry ? entry.official_city || "" : "",
      entry ? entry.canton || "" : "",
      entry ? entry.account_manager || "" : "",
      entry ? entry.territory_id || "" : "",
      eff,
      entry ? (entry.sfdc_account_count || 0) : 0,
    ]);
  });
  downloadCSV("selected_zips_export.csv", rows.map(function (r) { return r.join(","); }).join("\n"));
}
