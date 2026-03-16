#!/usr/bin/env bash
# validate.sh — Local validation checks for the Swiss Territory Planner
# Run: bash validate.sh
set -euo pipefail

cd "$(dirname "$0")"

PASS=0
FAIL=0
WARN=0

pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }
warn() { echo "  WARN: $1"; WARN=$((WARN + 1)); }

echo "=== Swiss Territory Planner — Validation ==="
echo ""

# 1. Required files
echo "[1] Required files..."
for f in index.html style.css .nojekyll .gitignore; do
  if [ -f "$f" ]; then pass "$f exists"; else fail "$f missing"; fi
done
for f in js/app.js js/state.js js/api.js js/map.js js/filters.js js/zefix.js js/exports.js js/uploads.js js/utils.js; do
  if [ -f "$f" ]; then pass "$f exists"; else fail "$f missing"; fi
done

# 1b. Bundled data files (required for static fallback mode)
for f in data/data.js data/ch-plz.js data/ch-plz.topojson; do
  if [ -f "$f" ]; then pass "$f exists"; else fail "$f missing (required for static fallback)"; fi
done

# 1c. Verify server files are NOT present (static-only mode)
for f in server.js storage.js .env.example vercel.json; do
  if [ -f "$f" ]; then fail "$f should not exist in static GitHub Pages mode"; else pass "$f correctly absent"; fi
done

# 2. Security checks
echo ""
echo "[2] Security checks..."

if grep -q 'Content-Security-Policy' index.html; then
  pass "CSP meta tag present"
else
  fail "CSP meta tag missing"
fi

if grep -q 'X-Content-Type-Options' index.html; then
  pass "X-Content-Type-Options present"
else
  fail "X-Content-Type-Options missing"
fi

if grep -q 'referrer' index.html; then
  pass "Referrer policy present"
else
  warn "Referrer policy missing"
fi

# 3. No hardcoded secrets
echo ""
echo "[3] Secret scanning..."

if grep -rn 'UPLOAD_PASSWORD\|swissterritory2026' js/ index.html 2>/dev/null; then
  fail "Hardcoded password found"
else
  pass "No hardcoded passwords in JS/HTML"
fi

if grep -rn 'localhost:8000\|__PORT_8000__' js/ index.html 2>/dev/null; then
  fail "Legacy backend URL references found"
else
  pass "No legacy backend URL references in frontend"
fi

# 4. Deployment safety
echo ""
echo "[4] Deployment safety..."

for pattern in 'swiss_territory_state.db' 'api_server.py' '\.env' 'server-data'; do
  if grep -q "$pattern" .gitignore; then
    pass ".gitignore excludes $pattern"
  else
    fail ".gitignore does not exclude $pattern"
  fi
done

if [ -d "server-data" ]; then
  fail "server-data/ directory should not be committed"
else
  pass "server-data/ correctly absent from repo"
fi

# 5. JS module imports valid
echo ""
echo "[5] JS import validation..."

IMPORT_ERRORS=0
for f in js/*.js; do
  while IFS= read -r line; do
    # Extract import path
    path=$(echo "$line" | sed -n 's/.*from\s*"\(.*\)".*/\1/p')
    if [ -z "$path" ]; then
      path=$(echo "$line" | sed -n "s/.*from\s*'\(.*\)'.*/\1/p")
    fi
    if [ -n "$path" ]; then
      # Resolve relative to the JS directory
      resolved="js/$(echo "$path" | sed 's|^\./||')"
      if [ ! -f "$resolved" ]; then
        fail "Broken import in $f: $path (resolved: $resolved)"
        IMPORT_ERRORS=$((IMPORT_ERRORS + 1))
      fi
    fi
  done < <(grep -n '^\s*import' "$f" 2>/dev/null || true)
done
if [ "$IMPORT_ERRORS" -eq 0 ]; then
  pass "All JS imports resolve correctly"
fi

# 6. GitHub Actions workflows
echo ""
echo "[6] CI/CD workflows..."

if [ -f .github/workflows/ci.yml ]; then
  pass "CI workflow exists"
else
  fail "CI workflow missing"
fi

if [ ! -f .github/workflows/deploy.yml ]; then
  pass "No redundant deploy workflow (Pages deploys from branch)"
else
  warn "deploy.yml exists but may be redundant if Pages source is set to branch"
fi

# Summary
echo ""
echo "=== Summary ==="
echo "  Passed: $PASS"
echo "  Failed: $FAIL"
echo "  Warnings: $WARN"
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo "RESULT: FAILED ($FAIL failures)"
  exit 1
else
  echo "RESULT: PASSED"
  exit 0
fi
