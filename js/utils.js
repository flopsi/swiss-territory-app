/**
 * utils.js — Shared utility functions.
 */

// ==================== CSV Parser (RFC 4180, auto-detect delimiter) ====================
// Auto-detects comma, semicolon, or tab delimiters from the header row.
export function parseCSV(text) {
  // Normalise line endings
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  // Strip BOM
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

  // Auto-detect delimiter from the first line (header)
  var firstLine = text.split("\n")[0] || "";
  var delimiter = detectDelimiter(firstLine);

  var rows = [];
  var row = [];
  var field = "";
  var inQuote = false;

  for (var i = 0; i < text.length; i++) {
    var ch = text[i];
    if (inQuote) {
      if (ch === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuote = false;
        }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuote = true;
      } else if (ch === delimiter) {
        row.push(field.trim());
        field = "";
      } else if (ch === "\n") {
        row.push(field.trim());
        if (row.length > 1 || (row.length === 1 && row[0] !== "")) rows.push(row);
        row = [];
        field = "";
      } else {
        field += ch;
      }
    }
  }
  // last field / row
  row.push(field.trim());
  if (row.length > 1 || (row.length === 1 && row[0] !== "")) rows.push(row);

  if (rows.length < 2) return [];
  var headers = rows[0];
  var result = [];
  for (var ri = 1; ri < rows.length; ri++) {
    var obj = {};
    for (var ci = 0; ci < headers.length; ci++) {
      obj[headers[ci]] = (rows[ri][ci] || "");
    }
    result.push(obj);
  }
  return result;
}

// Detect delimiter by counting occurrences in the header line.
// Supports comma, semicolon, and tab. Picks whichever appears most.
function detectDelimiter(headerLine) {
  var commas = (headerLine.match(/,/g) || []).length;
  var semis = (headerLine.match(/;/g) || []).length;
  var tabs = (headerLine.match(/\t/g) || []).length;
  if (semis > commas && semis >= tabs) return ";";
  if (tabs > commas && tabs >= semis) return "\t";
  return ",";
}

// ==================== SFDC Column Name Normalisation ====================
// Maps common SFDC export column name variations to the canonical names
// expected by the app. Applied to CSV rows after parsing.
var SFDC_ALIASES = {
  "Accounts Name": ["Account Name", "AccountName", "Account_Name", "Accounts Name"],
  "SF Account ID": ["SF Account ID", "Account ID", "AccountId", "Account_ID", "Id", "Account Id"],
  "CMD Account Manager": ["CMD Account Manager", "Account Owner", "Owner Full Name", "Owner Name", "Account Manager", "AccountOwner"],
  "zip": ["zip", "Zip", "ZIP", "BillingPostalCode", "Billing Zip/Postal Code", "Billing Zip", "Postal Code", "PostalCode", "Postcode", "PLZ"],
};

var TERRITORY_ALIASES = {
  "Postcode": ["Postcode", "postcode", "Postal Code", "PostalCode", "ZIP", "Zip", "zip", "PLZ"],
  "Territory_ID": ["Territory_ID", "Territory ID", "TerritoryID", "Territory", "territory_id"],
  "AM 2026": ["AM 2026", "AM2026", "Account Manager", "AccountManager", "AM"],
};

// Remap row keys to canonical names using alias maps.
// Returns a new array of objects with canonical keys.
export function normalizeHeaders(rows, aliasMap) {
  if (rows.length === 0) return rows;
  var originalKeys = Object.keys(rows[0]);
  var keyMapping = {}; // original -> canonical

  Object.keys(aliasMap).forEach(function (canonical) {
    var aliases = aliasMap[canonical];
    for (var i = 0; i < originalKeys.length; i++) {
      var orig = originalKeys[i];
      for (var j = 0; j < aliases.length; j++) {
        if (orig.toLowerCase().trim() === aliases[j].toLowerCase().trim()) {
          keyMapping[orig] = canonical;
          return;
        }
      }
    }
  });

  return rows.map(function (row) {
    var mapped = {};
    Object.keys(row).forEach(function (key) {
      var canonical = keyMapping[key] || key;
      mapped[canonical] = row[key];
    });
    return mapped;
  });
}

export { SFDC_ALIASES, TERRITORY_ALIASES };

// ==================== HTML Escaping ====================
export function escapeHTML(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ==================== ZIP Normalisation ====================
export function normalizeZip(z) {
  if (!z) return null;
  z = String(z).trim().replace(/[^\d]/g, "");
  if (!z) return null;
  while (z.length < 4) z = "0" + z;
  return z.length === 4 ? z : null;
}

// ==================== Animated Number ====================
export function animateNumber(id, target) {
  var el = document.getElementById(id);
  if (!el) return;
  var current = parseInt(el.textContent.replace(/[^\d]/g, ""), 10) || 0;
  if (current === target) {
    el.textContent = target.toLocaleString();
    return;
  }
  var duration = 300;
  var start = performance.now();

  function step(now) {
    var elapsed = now - start;
    var progress = Math.min(elapsed / duration, 1);
    var eased = 1 - Math.pow(1 - progress, 3);
    var val = Math.round(current + (target - current) * eased);
    el.textContent = val.toLocaleString();
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// ==================== CSV Download ====================
export function downloadCSV(filename, csvContent) {
  var blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  var url = URL.createObjectURL(blob);
  var link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
