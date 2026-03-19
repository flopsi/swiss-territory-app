/**
 * utils.js — Shared utility functions.
 */

// ==================== CSV Parser (RFC 4180, with auto-detected delimiter) ====================
export function parseCSV(text) {
  var rows = [];
  var row = [];
  var field = "";
  var inQuote = false;
  // Normalise line endings
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  // Strip BOM
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

  // Auto-detect delimiter from the first line: if tabs outnumber commas, use tab.
  // This supports SFDC exports which are tab-separated (CP1252 / TSV).
  var firstLine = text.split("\n")[0] || "";
  var tabCount = (firstLine.match(/\t/g) || []).length;
  var commaCount = (firstLine.match(/,/g) || []).length;
  var delimiter = tabCount > commaCount ? "\t" : ",";

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
