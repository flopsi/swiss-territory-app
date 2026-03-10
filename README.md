# Swiss Territory Planner

Interactive web app for visualizing Swiss sales territories by postcode. Displays coverage status, account manager assignments, territory boundaries, anomaly ZIPs, and supports ZEFIX company lookups via SPARQL.

## How to Use

Open `index.html` in any modern browser. No server required — the app runs entirely in the browser as static HTML/CSS/JS.

Alternatively, serve locally:
```bash
npx serve . -l 3000
```

### Selecting ZIPs

- **Click any ZIP polygon** on the map to toggle its selection (blue highlight).
- Selected ZIPs appear in the **selection tray** at the bottom of the map area.
- Remove individual ZIPs by clicking the **×** on each chip, or use **Clear All**.

### Querying ZEFIX

1. Select up to **10 ZIP codes** on the map.
2. Click **Find in ZEFIX** in the selection tray.
3. A SPARQL query runs against `https://ld.admin.ch/query` (Swiss Linked Data / ZEFIX).
4. Results appear in a right-side panel showing Legal Name, ZIP, Locality, UID, and a ZEFIX link.
5. Click **CSV** in the ZEFIX panel header to export the results.
6. If more than 10 ZIPs are selected, the button is disabled with a warning message.

### Marking ZIPs as Excluded

1. Select one or more ZIPs on the map.
2. Click **Mark Excluded** in the selection tray.
3. Those ZIPs change to "excluded" status (purple) and no longer count as potential in stats.
4. Excluded state persists in **localStorage** across browser sessions.
5. Press **Ctrl+Z** (or Cmd+Z) to undo the last exclusion action.
6. Export all excluded ZIPs via the **Excluded CSV** button in the sidebar.

### Filtering

All three filters (Account Managers, Territory IDs, Coverage Status) support **multi-select**:
- Click the dropdown to open a checkbox list.
- Check multiple items to filter by any of them.
- Leaving all unchecked means "show all."
- Coverage Status includes: Covered, Potential, Anomaly, Excluded.

### Exports

Four CSV export options are available:
- **Anomalies CSV** (sidebar) — all 84 SFDC-only anomaly ZIPs with territory, manager, accounts, and polygon status.
- **Excluded CSV** (sidebar) — all user-excluded ZIPs with timestamps.
- **Export CSV** (selection tray) — currently selected ZIPs with full metadata.
- **ZEFIX CSV** (ZEFIX panel) — company lookup results from the most recent SPARQL query.

## Features

- **Interactive Swiss postcode map** using Leaflet + TopoJSON polygons (3,196 PLZ areas)
- **Four-state status model**: Covered, Potential, Anomaly (SFDC-only), Excluded
- **Anomaly plotting**: 84 SFDC-only ZIPs plotted on map in red where polygon exists
- **Three color modes**: Coverage (covered/potential/anomaly/excluded), Account Manager, Territory ID
- **Multi-select filters**: Account Manager, Territory ID, Coverage Status — all with checkbox dropdowns
- **On-map ZIP selection**: Click to select/deselect, blue highlight, selection tray with actions
- **ZEFIX SPARQL integration**: Query up to 10 ZIPs against Swiss Linked Data for registered companies
- **Excluded ZIPs**: Mark as "no valid accounts" with localStorage persistence and undo (Ctrl+Z)
- **Always-visible territory borders**: Dashed colored lines grouping ZIPs by territory, visible in all color modes
- **Quick-select AM buttons** with toggle behavior
- **Tooltips** showing ZIP, city, canton, manager, territory, status, and SFDC account details
- **Summary stats** (6 cards) with animated counters that update on filter change
- **SFDC-only anomaly table** with "On Map" indicator column
- **Four CSV export options**: anomalies, excluded, selected ZIPs, ZEFIX results
- **Responsive layout** with collapsible sidebar on mobile

## Data Processing

### Inputs
- `master_zip.csv` — 3,190 Swiss postcodes with territory assignments and account manager names (UTF-8-BOM)
- `sfdc_clean_min.csv` — 2,255 Salesforce account records with ZIP, territory, and manager info (CP1252, tab-separated)

### Preprocessing (`preprocess.py`)
1. **ZIP normalization**: All postcodes zero-padded to 4-digit strings; empty/invalid values dropped
2. **Manager name normalization**: Accent-stripped fuzzy matching maps SFDC names to master names
3. **Merge**: Each master ZIP enriched with SFDC account counts, account details, and coverage status
4. **SFDC-only ZIPs**: 84 postcodes in Salesforce but absent from master — tracked separately as anomalies

### Output
- `data/data.js` — JavaScript object with merged records, SFDC-only anomalies, metadata, and color maps
- `data/ch-plz.topojson` — Swiss postcode polygon boundaries (source: [mikpan/ch-maps](https://github.com/mikpan/ch-maps))

## Data Summary

| Metric | Count |
|--------|-------|
| Total master ZIPs | 3,190 |
| Covered ZIPs (in SFDC) | 627 |
| Potential ZIPs (not in SFDC) | 2,563 |
| SFDC-only ZIPs (anomalies) | 84 |
| Account Managers | 8 |
| Territories | 8 |
| Total SFDC accounts | 2,233 |

## Limitations & Caveats

1. **ZEFIX SPARQL query**: The `https://ld.admin.ch/query` endpoint supports CORS, so browser-side queries work. However, results are capped at 500 per query. For ZIPs with very many registered companies (e.g., Zurich 8000), the result set may be truncated.
2. **Anomaly polygon coverage**: Of the 84 SFDC-only ZIPs, many lack a TopoJSON polygon, so they cannot be plotted on the map. The anomaly table shows "Yes/No" for polygon availability.
3. **Excluded ZIP persistence**: The excluded-ZIP list is stored in browser `localStorage`. It does not sync across devices or browsers. Clearing browser data will reset exclusions.
4. **Territory borders**: Borders are drawn per-ZIP polygon with dashed lines by territory color. They are an approximation — not official administrative boundaries — and may appear noisy at low zoom levels.
5. **TopoJSON coverage**: The boundary file contains 3,196 unique PLZ polygons. 6 ZIPs in the TopoJSON have no match in the master file and appear as unmatched (gray).
6. **Manager name matching**: Uses accent-stripping + word-overlap heuristic. One SFDC manager (`Ludger Schmiech`) has no master counterpart.
7. **Encoding**: The SFDC file uses Windows CP1252 encoding, which causes some special characters to display with replacement characters in account names.

## Deployment

This app is designed to run as a **static site on GitHub Pages** — no backend required.

### GitHub Pages (recommended)

1. Push to a GitHub repo with `main` as the default branch
2. In repo Settings → Pages → Source, select **Deploy from a branch** → `main` / `/ (root)`
3. GitHub automatically builds and deploys on every push to `main`
4. Site available at `https://YOUR_USER.github.io/YOUR_REPO/`

### Local

```bash
npx serve . -l 3000
# or
python3 -m http.server 3000
```

### Validation

Run the included validation script before deploying:
```bash
bash validate.sh
```

For the full security audit and deployment details, see [HARDENING_REPORT.md](HARDENING_REPORT.md).

## Tech Stack

- **Leaflet** 1.9.4 — interactive mapping
- **topojson-client** 3.1.0 — TopoJSON → GeoJSON conversion
- **CARTO** light basemap tiles
- **Inter** font (Google Fonts)
- **SPARQL** via `https://int.lindas.admin.ch/query` — ZEFIX company lookups
- **localStorage** — client-side persistence (excluded ZIPs, uploaded datasets)
- Vanilla HTML/CSS/JS — no build step required

## Project Structure

```
swiss-territory-app-clean/
├── index.html               # Entry point (with CSP and security headers)
├── style.css                # All styles
├── .nojekyll                # Prevents Jekyll processing on GitHub Pages
├── .gitignore               # Excludes backend, DB, logs, secrets
├── validate.sh              # Local validation script (26 checks)
├── HARDENING_REPORT.md      # Security audit and deployment report
├── README.md                # This file
├── .github/
│   └── workflows/
│       └── ci.yml           # CI: secret scanning, structure checks
├── data/
│   ├── data.js             # Preprocessed data (auto-generated)
│   ├── ch-plz.js           # Bundled Swiss PLZ boundaries for runtime
│   └── ch-plz.topojson     # Source Swiss PLZ boundaries
└── js/
    ├── app.js              # Bootstrap / init
    ├── state.js            # Central state and config
    ├── api.js              # localStorage persistence layer
    ├── map.js              # Leaflet rendering and ZIP selection
    ├── filters.js          # Filters, stats, legend, exception panel
    ├── zefix.js            # ZEFIX query, result table, queue, export
    ├── uploads.js          # Upload and preprocessing flow
    ├── exports.js          # CSV export helpers
    └── utils.js            # Shared utilities
```
