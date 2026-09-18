# Apartment Ledger

A local apartment review database with separate buildings and units, address deduplication, explicit hard filters, configurable scores, human-controlled workflow decisions, and review history. No research services, AI, scraping, accounts, or cloud infrastructure.

## Run

Requires **Node.js 22.13 or newer** and npm. SQLite is built into Node; no database server or native addon installation is required. Node 22 may print an experimental SQLite warning.

```sh
cd apartment-search
npm install
npm run dev
```

Open **http://127.0.0.1:4317**. One process serves both the React UI and Express API, bound to the loopback interface. `Ctrl+C` stops it. Restarting keeps all data. The application works offline after dependencies are installed.

### This Windows workspace

Node is available in WSL in this environment. From PowerShell:

```powershell
wsl.exe --cd /mnt/c/projects/apartment-search npm install
wsl.exe --cd /mnt/c/projects/apartment-search npm run dev
```

Then open http://127.0.0.1:4317 in your Windows browser. Alternatively, with Node installed on Windows:

```powershell
cd C:\projects\apartment-search
npm install
npm run dev
```

Do not run two servers on the same port. Use `PORT` to change the port, and `DB_PATH` to use a separate SQLite file. Relative paths resolve from the project directory; always launch commands there.

### Demo data

```sh
npm run seed
```

Seeding requires an empty database and never overwrites existing records. Six demo buildings include the requested AMLI unit, a confirmed maximum-size failure, no laundry, September-only inventory, a manual post-tour rejection, and an unreviewed lead. **All demo information is illustrative and unverified**, including addresses and the additional $45 demo fee. Demo data is optional and is not loaded automatically.

To see an address duplicate, enter `2428 NW Market Street Seattle WA 98107` under Add Apartment. It matches the seeded punctuation/abbreviation variant. The duplicate card shows previous status, score, dates, notes, and rejection reason, and lets you add a unit, update the existing building, or cancel.

### Checks and production mode

```sh
npm test
npm run build
npm start
```

`npm test` runs engine, SQLite, import, and HTTP integration tests using isolated databases. `npm run build` checks TypeScript and builds the frontend. `npm start` serves that production build locally. `npm run dev` compiles the frontend on demand; restart it after server/shared backend changes.

## Typical workflow

1. Add Apartment → enter name/address. Review any matching building before continuing.
2. Enter building facts; unknown scores may remain blank. Confirm permanent failures only when known.
3. Enter unit details or deselect “Include a unit” to save just the building. Use zero for a known zero cost, blank for an unknown cost.
4. Preview hard filters, score, auto/final status, warnings, duplicate status, and current rank estimate. Save.
5. Open a building to edit facts/units, reject with a reason, move to Watch, mark Shortlist/Tour/Finalist/Signed, or clear an override. TOUR is a planned decision; record completed tours with “Already toured” and the tour date.
6. Update an existing unit to retain its rent history; mark inactive when it leaves inventory. A blank unit number is allowed but displays a duplicate warning.
7. Use Settings to tune criteria and scores, export backups, or preview/import JSON.

Dashboard excludes rejected and signed buildings. Buildings includes every status; Rejected is the searchable rejection archive. Dashboard priority is Finalist, Tour, Shortlist, Watch, Unreviewed; the score view ignores stage. Ties use building name. Cost, size, availability, and lease filters apply to the displayed best qualifying unit. The Units page shows all inventory, including failures and inactive units.

### Managing several units in one building

Building Detail has a **Unit Inventory** table with each unit's rent, parking and total costs, availability, lease, floor, score, filter result, and active state. The **BEST CURRENT UNIT** row is the qualifying active unit used for opportunity score and ranking. Open the filter result's **Details** button for explicit failures, warnings, score breakdown, notes, and timestamps.

- **+ Add Unit** goes directly to a unit form for that building. Save returns to Building Detail with recalculated inventory and scores; no building facts are re-entered. Evaluation preview is optional.
- **Edit Building** edits only permanent building facts and saves directly. **Edit Unit** edits that unit by its existing ID, preserving price/availability history and leaving sibling units untouched.
- Use **Mark inactive** when a listing disappears; its history is retained and it stops contributing to opportunity score/ranking. **Show inactive units** reveals older inventory, where **Mark active** can restore it. Deleting a unit requires confirmation.
- The initial Add Apartment wizard still checks the address, collects building facts, optionally adds the first unit, and previews before saving. Duplicate matches link directly to the existing building's unit or building editor.

These flows use the existing one-to-many relationship and rules. A viable building with no qualifying active inventory stays WATCH unless manually overridden. A failing unit never disqualifies another qualifying unit in the same building.

## Rules and deliberate choices

### Paste apartment JSON

Use **Paste JSON** beside Add Apartment, or **Add / Update via JSON** on Building Detail. Manual forms remain available. Paste a plain JSON object (without Markdown code fences), select **Validate** or **Preview**, review the proposed records and scores, then **Save**. Validation does not write records; saving is disabled until a successful preview. Editing the JSON or changing the merge choice requires another preview.

```json
{
  "building": {
    "name": "Windsor Ballard",
    "address": "5555 14th Ave NW, Seattle, WA 98107",
    "aliases": ["Windsor"],
    "parking_type": "garage",
    "has_in_unit_washer_dryer": "yes",
    "safety_score": 8,
    "quiet_score": 6
  },
  "units": [
    {
      "unit_number": "247",
      "sqft": 654,
      "base_rent": 2174,
      "parking_cost": 115,
      "mandatory_monthly_fees": 91,
      "available_date": "2026-10-31",
      "lease_length_months": 12,
      "unit_quality_score": null,
      "active": true
    }
  ]
}
```

The example is illustrative manual input. **Copy JSON Template** copies the full supported factual structure with unknowns/defaults; **Show JSON Format** displays it. Globally, `building.name` and `building.address` are required. From Building Detail, the building is already known, so `{"units": [...]}` works by itself. `units` may be empty or omitted. Unknown numeric values and dates can be `null`; optional text can be omitted or empty, and enum values must match the existing schema.

- Exact normalized-address matches default to **Keep existing building facts and only add/update units**. Choose **Merge supplied building facts** deliberately to update those facts. Omitted fields retain existing values; for new records they use normal schema defaults. Supplied building aliases are combined; building and unit notes are appended rather than erased.
- Numbered units are matched within that building by normalized unit number. Preview labels each supplied unit NEW UNIT, EXISTING UNIT, or UNNUMBERED UNIT and shows existing-unit diffs. Updates retain IDs, first-seen timestamps, and change history. Blank numbers create separate units with a warning. Repeated numbered units within one paste are rejected so the same unit cannot receive conflicting updates in a batch.
- `manual_status_override`, `rejection_reason`, `toured`, `tour_date`, `finalist`, and `signed` cannot be supplied through this shortcut. Use the existing manual review controls for those decisions. Existing decisions stay in place during a merge. IDs, derived scores, and unrelated fields are rejected rather than silently ignored.
- Omitted units are never removed or deactivated. Supplying `active: false` explicitly updates that unit, with a diff in the preview. All writes occur in one SQLite transaction. If data/settings changed after preview, Save asks for another preview instead of applying stale changes.
- Preview uses the same filter, scoring, opportunity, status, and ranking engine as the manual forms. Failed or unresolved units may still be saved for later review. Syntax errors include the parser message and line/column when available; schema errors name paths such as `units[1].sqft`.

This paste format is a manual entry shortcut. The versioned full-backup JSON import/export under Settings remains a separate workflow.

### Quick Apartment Search

The header search is available on every page. It searches all saved buildings, including rejected and signed properties, using an in-memory index of the loaded local database. Results update as you type, without network search or extra dependencies in the app runtime. Up to 20 results are displayed; refine the query to narrow longer lists.

- Match order: exact name, exact alias, name prefix, partial/fuzzy name or alias, then address. Matching ignores case, and address queries use the same abbreviation normalization as deduplication. Name matching also tolerates spacing/punctuation differences and one-character typos or transpositions for queries of at least four characters. Ties sort by name.
- Each result shows name, address, neighborhood, final status, opportunity/building score, review date, and a short notes preview. Rejected results have a red treatment and show the saved rejection reason or current building-level failures.
- Press `/` outside a form field or `Ctrl/Cmd+K` anywhere in the app to focus search. Use arrow keys to select, Enter to open, and Escape to close. These shortcuts apply while the app tab is focused, not while another listing website is active.
- No matches shows “No existing apartment found” with **Add New Apartment** (also available with Enter).
- Edit aliases through **Building detail → Edit building → Building aliases**, one name per line. Aliases are saved in SQLite and included in JSON exports/imports. Existing records need no migration; missing aliases default to an empty list. Aliases are only search hints: normalized street address remains the authoritative duplicate key.

Search logic lives in `shared/search.ts`; the header component and keyboard behavior live in `src/QuickSearch.tsx`. Automated search tests cover match ordering, case/alias/partial/address matches, rejected records, empty results, persistence, and keyboard interaction in a simulated DOM.

### Evaluation rules

The isolated rule engine is **`shared/engine.ts`**. Defaults, schemas, and configurable types are in **`shared/model.ts`**. Normalization is in **`shared/normalize.ts`**.

- Addresses are lowercased, whitespace collapsed, punctuation removed, and common street/direction words abbreviated. Exact normalized addresses are unique in SQLite. Unit numbers are normalized within a building and unique when present.
- This is exact normalization, not geocoding or fuzzy matching. Include the same city/state/ZIP consistently and omit apartment numbers from the building address. Missing ZIPs, spelling errors, or alternate street names may need manual search. Unit numbers are not guessed.
- Confirmed building failures: no in-unit laundry, street-only/no parking, safety/quiet below minimum, or a manually confirmed largest floorplan smaller than the minimum. A small entered unit alone never proves that all floorplans are too small.
- Unknown required building facts produce UNREVIEWED. Otherwise no qualifying active unit produces WATCH; a qualifying active unit produces SHORTLIST. Unknown required unit facts block qualification but are shown as unresolved, not as confirmed failures.
- Unit hard filters require size at least the minimum, base + parking **strictly below** the ceiling, and availability within the **inclusive** move-in window. Earlier availability fails by design; the app does not assume a landlord will hold the unit. Inactive units never qualify.
- Mandatory fees are shown in total monthly cost but do not affect the initial budget filter or price score. Unknown fees leave that total unknown. Concessions are descriptive and are not amortized automatically.
- `final_status = manual_status_override ?? auto_status`. The engine never automatically assigns TOUR, FINALIST, or SIGNED. Overrides, including rejection, survive inventory/settings changes. Clearing an override reapplies the rules, so confirmed permanent failures still yield REJECTED.
- Component scores range from 0–100. Weights total exactly 100%. Price is piecewise linear; defaults give 0/7/13/17/20 weighted points at $2400/$2300/$2200/$2100/$2000. Values beyond endpoints are clamped to endpoint scores. Changing the budget does not automatically shift the independently editable price curve.
- Size increases linearly from 50 at 550 sqft to 100 at 700 sqft, clamped to 0–100. Optional layout quality (1–10) contributes half by default. Without layout data, size alone is used. The size cap, minimum score, and layout share are editable.
- Garage/covered/lot score 100/90/70 by default. Lease terms up to 12 months score 100, 13–15 score 85, 16–18 score 60, longer terms score 30, and unknown terms score 50 with a warning. Long leases are not hard failures.
- Building score is a normalized weighted average of building-only components: quiet, safety, commute, parking, and building/management quality. Building and management scores are averaged when both exist. Missing optional qualitative scores use neutral 50/100 values. If all building-only weights are zero, the building score is zero.
- Opportunity score uses the highest-scoring qualifying active unit, which is identified in the UI. No qualifying unit means no opportunity score; the dashboard displays building score and labels it accordingly. Scores are displayed to one decimal and stored/calculated at full precision.

## Persistence, backup, and reset

The database is **`data/apartments.sqlite`**. SQLite enforces unique normalized addresses and unit keys, foreign keys, and atomic transactions. Flexible record payloads are JSON inside SQLite rows; identity, foreign keys, and deduplication keys are indexed SQL columns. Schema version is 1. History stores timestamped before/after snapshots, including evaluation changes and settings recalculations. There is no automatic deletion of old reviews.

**Recommended full database backup**, safe while the app is running:

```sh
npm run backup
```

This uses SQLite `VACUUM INTO` to produce a consistent, standalone timestamped `.sqlite` file in `backups/`. Also available from Settings: JSON export for records/settings/history, and CSV export as a spreadsheet report. CSV protects cells that might otherwise execute spreadsheet formulas and is not a full-fidelity backup.

**Reset without losing the old database:** stop the app with Ctrl+C, then rename the entire `data` directory to a new name such as `data-before-reset`. The next launch creates an empty database with default settings. Run `npm run seed` before launching if you want demos again. Renaming the whole directory retains any SQLite `-wal` and `-shm` sidecars; never copy just the main database file while it is in use.

**Restore an exact SQLite backup:** stop the app, rename the current `data` directory to preserve it, make a new `data` directory, copy your standalone backup into it as `apartments.sqlite`, and restart. Do not reuse old WAL/SHM files with a restored database.

**JSON import:** select a version-1 export in Settings. Preview shows new/existing building and unit counts, unnumbered units, and recoverable history. Exact address matches link to existing buildings; numbered units match within buildings. Existing records are skipped, so prior decisions cannot be overwritten. Same-export unnumbered units are recognized by ID; independently entered unknown units remain separate. New records preserve original timestamps, and history for newly imported buildings is restored. Imported settings apply only when the checkbox is selected. Existing building history is not merged; use exact SQLite backup/restore when you need an exact replacement or recovery of deleted records.

Deleting a unit or building requires confirmation and retains an audit snapshot, but there is no automatic undo UI. Prefer inactive units or REJECTED status for normal search workflow. Keep backups before intentional deletions.

## Project layout

```text
shared/model.ts       Types, validation, initial settings
shared/normalize.ts   Address and unit normalization
shared/engine.ts      Filters, price/lease/size scoring, auto status, ranking
server/store.ts       SQLite schema, CRUD, transactions, history
server/index.ts       Express API and local frontend server
server/import.ts      Validated import preview and deduplicating import
server/paste.ts       Apartment JSON validation, diffs, preview, atomic add/update
server/seed.ts        Optional illustrative demo records
server/backup.ts      Consistent SQLite backup command
src/main.tsx          React entry point
src/App.tsx           Dashboard, separate editors, details, rejected archive, settings
src/UnitInventory.tsx Building inventory table and inactive toggle
src/JsonPaste.tsx     JSON paste, template, validation and preview screen
src/style.css         Compact, responsive desktop-first UI
tests/               Rule, persistence, import, and API tests
data/                Local SQLite files (ignored by git)
backups/             Standalone SQLite backups (ignored by git)
```

The server has no authentication because it is intended for your own local computer. It binds only to loopback and rejects cross-origin API requests. Do not expose it through a public proxy. No external requests are made by the running app.

## Verification

Automated tests cover normalization, database deduplication, hard filters and boundary dates/prices, unknown values, price interpolation, lease penalties, auto/manual statuses, ranking, best-unit selection, settings validation, transaction rollback, persistence across reopen, JSON import idempotency, history, exports, and HTTP editing/deletion. TypeScript and the production frontend build are checked separately. Browser visual verification was unavailable in the build session because no browser connection was present.
