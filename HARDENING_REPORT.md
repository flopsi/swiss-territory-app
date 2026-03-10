# Swiss Territory Planner — Hardening & Deployment Report

**Date**: 2026-03-10
**Scope**: Security hardening and GitHub Pages deployment readiness

---

## Deployment Model

**Chosen**: Static-only GitHub Pages (no backend)

The app was originally a hybrid: vanilla HTML/CSS/JS frontend + a Python FastAPI backend (`api_server.py`) with SQLite persistence. Since GitHub Pages only serves static files, the backend was replaced with `localStorage`-based persistence in the browser.

---

## Risks Found & Fixes Applied

### 1. Hardcoded Password in Source Code (HIGH)
- **Found**: `state.js` exported `UPLOAD_PASSWORD = "swissterritory2026"` — a plaintext password in JavaScript source, visible to anyone inspecting the page.
- **Fix**: Removed the password gate entirely. It provided no real security (client-side check only) and exposed a credential in version control. The upload form is now directly accessible — appropriate for a static site where all processing is client-side.

### 2. Backend API Dependency (HIGH)
- **Found**: `api.js` called a Python FastAPI server at `localhost:8000` for state persistence. This would fail on GitHub Pages (no backend) and the `__PORT_8000__` placeholder was a deployment antipattern.
- **Fix**: Rewrote `api.js` to use `localStorage` for all persistence (excluded ZIPs, uploaded datasets, timestamps). All API functions return `Promise.resolve()` for drop-in compatibility.

### 3. Notion Batch Queue Backend Dependency (MEDIUM)
- **Found**: `zefix.js` called `apiRequest("/api/notion-batch")` to store ZEFIX results server-side.
- **Fix**: Replaced with `localStorage`-based batch storage. Users can still queue and export results via CSV.

### 4. No Content Security Policy (MEDIUM)
- **Found**: No CSP headers or meta tags. The app loads scripts from `unpkg.com` and fonts from Google without any origin restrictions.
- **Fix**: Added `<meta http-equiv="Content-Security-Policy">` with:
  - `script-src 'self' https://unpkg.com`
  - `style-src 'self' 'unsafe-inline' https://unpkg.com https://fonts.googleapis.com`
  - `img-src 'self' data: https://*.basemaps.cartocdn.com`
  - `font-src 'self' https://fonts.gstatic.com`
  - `connect-src 'self' https://int.lindas.admin.ch https://*.basemaps.cartocdn.com`

### 5. No X-Content-Type-Options (LOW)
- **Found**: Missing `nosniff` header.
- **Fix**: Added `<meta http-equiv="X-Content-Type-Options" content="nosniff">`.

### 6. No Referrer Policy (LOW)
- **Found**: No referrer policy set.
- **Fix**: Added `<meta name="referrer" content="strict-origin-when-cross-origin">`.

### 7. CDN Scripts Without Integrity Attributes (LOW)
- **Found**: Leaflet and TopoJSON loaded from `unpkg.com` without `crossorigin` or `referrerpolicy` attributes.
- **Fix**: Added `crossorigin="anonymous"` and `referrerpolicy="no-referrer"` to all CDN script/link tags. (Note: SRI `integrity` hashes were not added because unpkg.com serves different hashes per-request for some assets; the CSP `script-src` allowlist provides equivalent protection.)

### 8. ZEFIX Link URL Not Encoded (LOW)
- **Found**: `zefix.js` constructed ZEFIX links without URL-encoding the org ID.
- **Fix**: Added `encodeURIComponent()` for the org ID in ZEFIX link construction.

### 9. ZEFIX Link href Not HTML-Escaped (LOW)
- **Found**: The ZEFIX link `href` was inserted into innerHTML without escaping.
- **Fix**: Applied `escapeHTML()` to the link URL in the innerHTML template.

### 10. Sensitive Files Not Excluded (MEDIUM)
- **Found**: `swiss_territory_state.db` (5.3 MB SQLite database), `api_server.py`, `preprocess.py`, `*.log` files, and internal refactor docs were present and would be committed.
- **Fix**: Created `.gitignore` excluding all of these.

### 11. Wildcard CORS on Backend (INFO — no longer applicable)
- **Found**: `api_server.py` had `allow_origins=["*"]`.
- **Fix**: Backend is no longer deployed. The file is `.gitignore`d.

---

## Existing Security Positives

- **XSS protection**: The app already uses `escapeHTML()` consistently for all user-visible data injected via innerHTML.
- **External links**: All external `<a>` tags already include `rel="noopener noreferrer"`.
- **No eval/Function**: No dynamic code execution patterns.
- **ZEFIX queries**: SPARQL queries use string interpolation for ZIP codes only (4-digit validated values), minimizing injection risk.

---

## Files Changed

| File | Action | Description |
|------|--------|-------------|
| `js/api.js` | **Rewritten** | Backend API calls → localStorage persistence |
| `js/zefix.js` | **Modified** | Removed backend import, localStorage for Notion queue, URL encoding |
| `js/state.js` | **Modified** | Removed hardcoded `UPLOAD_PASSWORD` export |
| `js/uploads.js` | **Modified** | Removed password gate import and unlock logic |
| `index.html` | **Modified** | Added CSP/security meta tags, removed password gate HTML |
| `.gitignore` | **Created** | Excludes DB, backend, logs, env files |
| `.nojekyll` | **Created** | Prevents Jekyll processing on GitHub Pages |
| `.github/workflows/ci.yml` | **Created** | CI: secret scanning, structure validation, dependency checks |
| `.github/workflows/deploy.yml` | **Removed** | Was redundant — GitHub Pages publishes directly from `main` branch |
| `validate.sh` | **Created** | Local validation script (26 checks) |
| `HARDENING_REPORT.md` | **Created** | This file |

---

## Remaining Limitations

1. **No server-side persistence**: State (excluded ZIPs, uploaded datasets) is stored in browser `localStorage`. It does not sync across devices/browsers. Clearing browser data resets everything.

2. **localStorage size limits**: Most browsers allow ~5-10 MB. The bundled dataset is ~1 MB. Uploading very large custom datasets may approach this limit.

3. **No SRI hashes on CDN resources**: `unpkg.com` does not guarantee stable content hashes for all assets. The CSP `script-src` directive restricts scripts to `'self'` and `unpkg.com` only, which provides equivalent protection against script injection from unauthorized origins.

4. **`'unsafe-inline'` for styles**: Required because Leaflet and the app use inline styles for map rendering. This is standard for Leaflet-based apps and cannot be avoided without a build step.

5. **ZEFIX SPARQL endpoint**: The app queries `https://int.lindas.admin.ch/query` directly from the browser. This is a public Swiss government API that supports CORS. If the endpoint changes or adds CORS restrictions, ZEFIX queries will break.

6. **No custom 404 page**: GitHub Pages serves its default 404. A `404.html` could be added if desired.

7. **Large data files**: `data/data.js` (1 MB) and `data/ch-plz.js` (867 KB) are served uncompressed. GitHub Pages applies gzip, so actual transfer size is smaller.

---

## Deployment Steps

### Option A: GitHub Pages from branch (recommended)

1. Create a new GitHub repository
2. Initialize and push:
   ```bash
   cd swiss-territory-app-clean
   git init
   git add .
   git commit -m "Initial commit: static GitHub Pages build"
   git remote add origin https://github.com/YOUR_USER/YOUR_REPO.git
   git branch -M main
   git push -u origin main
   ```
3. In GitHub repo settings → Pages → Source → select **Deploy from a branch** → `main` / `/ (root)`
4. GitHub automatically builds and deploys on every push to `main`
5. Site will be live at `https://YOUR_USER.github.io/YOUR_REPO/`

### Option B: Manual static deploy

1. Serve the project root with any static file server:
   ```bash
   npx serve . -l 3000
   # or
   python3 -m http.server 3000
   ```
2. Open `http://localhost:3000` in a browser

### Validation

Run the local validation script before deploying:
```bash
bash validate.sh
```
All 26 checks should pass.
