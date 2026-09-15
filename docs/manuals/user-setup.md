# User Setup Manual — Local Running Charter (Self-Serve)

> **Goal:** A new user who has only this repo can, by reading this file alone, prepare a fresh Google Buffer Sheet, wire it to the app, run the app on Windows, and install the phone PWA — without ever leaking private Sheet/Script URLs to git.

---

## 0. What you are building (mental model)

```
Phone (PWA) ──appendTrip──► Google Buffer Sheet ◄──allRows/rewriteSheet──► Laptop app (All Trips Master Table)
                              ▲                                               │
                              │  Apps Script = Sheet Proxy (no Google keys)   │
                              └─────────────── you deploy once ───────────────┘

Laptop app DB is local: ./runningcharter.db (SQLite via better-sqlite3, lib/db.ts:1).
No Railway / Supabase / Vercel is needed. All ledger math lives in lib/ledgerCalculations.ts, lib/pagination.ts,
lib/estimateFuelEconomy.ts and is re-run by “Rebuild Ledger”.
```

**File roles (do not rename):**

- `config/sheet.example.json` — committed template with placeholders. Copy it.
- `config/sheet.local.json` — **gitignored** (`-.gitignore:48`) — your real Sheet ID + Script URL live here ONLY. Never edit `lib/sheetConfig.ts` with real URLs.
- `quicktrip-mobile/dist/mobile_app_public.html` — committed public template (`SCRIPT_URL_DEFAULT = ""`). Safe to push.
- `quicktrip-mobile/dist/Mobile_with_url_private.html` — **gitignored** — single-file built by `npm run build:mobile` / `start-service.ps1` with your URL hard-coded. Copy this to the phone; never push it.

If you hardcode a URL in any committed `.ts`/`.html`, it ships to GitHub history. The rules above prevent that.

---

## 1. Prepare a new Google Sheet (Buffer Sheet) — 5 minutes

### 1.1 Create the Sheet

1. https://sheets.google.com → **Blank spreadsheet**.
2. Rename spreadsheet to e.g. `RunningChart — Buffer (your initials)`.
3. Rename the **first tab** (bottom) to exactly `All Trips` (`quicktrip-mobile/apps-script/Code.gs:8` `SHEET_NAME = 'All Trips'`). Case/spaces matter.
4. In row 1 paste this header row **in this exact order** (`lib/sheetClient.ts:6` `ALL_TRIPS_HEADERS`):

   `Date | Start KM | End KM | Distance | Start Time | End Time | Private / Official | Places Visited | Fuel Pumped | Fuel Order No`

   - `Date` must be `YYYY-MM-DD`.
   - `Start KM / End KM / Distance` are integers (sheet formats them `0`, the script rounds with `roundIntKm_`).
   - `Fuel Pumped` is 1-decimal (`0.0`).
   - `Private / Official` accepts `Official` or `Private` (legacy alias `Type` tolerated).
   - All 10 columns must exist even if some rows leave `Fuel Pumped` empty.

5. Select row 1 → **View → Freeze → 1 row**. Optional: bold row 1 (the Apps Script reapplies dark header anyway).
6. **Format → Number** is not required; `doPost` reapplies `setNumberFormat('0')` for KM and `'0.0'` for fuel.

### 1.2 Why strict header order matters

`ensureHeaders_` (`Code.gs:146`) validates the first row order-enforced, case-insensitive, aliases `Type` for column 6 and `Fuel Drawn` for column 8. If validation fails the Sheet Proxy returns `{ok:false, error:'Header row mismatch…'}` and **both Pull and Push are rejected atomically** (sheet left untouched). Fix the header row and redeploy.

---

## 2. Deploy the Sheet Proxy (Apps Script) — copy two URLs

### 2.1 Paste the script

1. In the Sheet: **Extensions → Apps Script**.
2. Delete any `Code.gs` placeholder → paste the entire `quicktrip-mobile/apps-script/Code.gs` (186 lines).
3. Save (Ctrl+S) — project name e.g. `RunningChart Proxy`.

### 2.2 Deploy as Web App

1. **Deploy → New deployment → Web App**.
2. **Description:** `RunningChart Buffer Proxy v1`.
3. **Execute as:** `Me` (your Google account — the Sheet owner).
4. **Who has access:** `Anyone with the link` (required). Alternative: `Anyone` also works. If you restrict to Google accounts, the laptop `fetch(...?action=allRows)` will 401 and the main app shows *“verify Apps Script deployed as Anyone with link”*.
5. Click **Deploy → Authorize** (allow `See, edit, create… spreadsheets`).
6. Copy the **Web App URL** — it looks like `https://script.google.com/macros/s/AKfycby…/exec` (this is `$ScriptUrl` / `scriptUrl`).

### 2.3 Copy the Sheet URL

Copy the Sheet’s browser URL bar. Any form is accepted — the app extracts the ID with `/\/d\/([a-zA-Z0-9-_]+)/` (`lib/sheetClient.ts:56`):

- `https://docs.google.com/spreadsheets/d/1AbC…XyZ/edit?gid=0#gid=0` → ID `1AbC…XyZ`

You now have two strings:

- `sheetUrl` (or just the ID)
- `scriptUrl`

**Never commit them.** Next section shows the only two gitignored places that may hold them.

### 2.4 Verify without the laptop

Append `?action=allRows` to the Script URL and open in a browser (still logged in). You should get `{"rows":[]}`. If you see `Header row mismatch`, fix row 1. Keep this URL handy for the next step.

---

## 3. Where URLs live — keep them out of git

| Where | Git? | Purpose | How the code reads it |
|-------|------|---------|-----------------------|
| `config/sheet.local.json` | **ignored** (`.gitignore:48`) | Single source of truth on the laptop. Template: `config/sheet.example.json` | `scripts/build-mobile.js:23` + built at startup; also as fallback for `lib/sheetConfig.ts` if `DEFAULT_*` empty |
| `lib/sheetConfig.ts` FALLBACKs | committed | **Must stay empty** (`''`). Do not paste real URLs here. | `process.env.NEXT_PUBLIC_SHEET_ID` / `..._SCRIPT_URL` else `''` |
| `.env.local` / `NEXT_PUBLIC_*` env vars | ignored (`.gitignore:34`) | Optional alt for CI | `lib/sheetConfig.ts:16` `process.env.*` |
| `localStorage mobile.sheetId / mobile.scriptUrl` | per-browser, not a file | Runtime override via **Sheet Settings** dialog in the All Trips header AND QuickTrip Mobile Settings | `lib/sheetClient.ts:39` — highest priority after env |
| `quicktrip-mobile/dist/Mobile_with_url_private.html` | **ignored** | Single-file for phone with URL hard-coded at build time | Inlined `SCRIPT_URL_DEFAULT` |

**Rule of thumb for a new user:** After step 2, create `config/sheet.local.json` (next section) and never paste URLs into any tracked `.ts`/`.html`. Before `git push`, run `git status` — you should see `config/sheet.local.json` and `quicktrip-mobile/dist/Mobile_with_url_private.html` **not listed** (or listed as ignored). If they appear, your `.gitignore` is broken.

---

## 4. Run on Windows — two modes (dev vs persistent service)

### 4.1 Prerequisites

- **Node 20+** (`node -v`) and npm (`npm -v`). Install from https://nodejs.org (LTS).
- Clone repo and install:

  ```powershell
  cd C:\labs\local_runningcharter   # or wherever you keep the repo
  git clone <your-fork-url> .       # or copy folder
  npm install                         # reads package.json:1 (no pg needed)
  ```

### 4.2 First-time: create `config/sheet.local.json`

```powershell
Copy-Item config\sheet.example.json config\sheet.local.json
notepad config\sheet.local.json
```

Replace with your two URLs from §2:

```json
{
  "sheetId": "1AbC…XyZ",
  "sheetUrl": "https://docs.google.com/spreadsheets/d/1AbC…XyZ/edit?gid=0#gid=0",
  "scriptUrl": "https://script.google.com/macros/s/AKfycby…/exec"
}
```

Any of `sheetId`, `sheetUrl`, `scriptUrl` accepted — `sheetUrl` is parsed for the ID. This file is never pushed.

**Alternative (no file):** Edit the top of `start-service.ps1:13` and set `$ScriptUrl = "https://script.google.com/…/exec"` — this PS1 value overrides `config/sheet.local.json` via `$env:SCRIPT_URL`. The PS1 itself is tracked, so leave `$ScriptUrl = ""` unless you keep the PS1 private.

### 4.3 Option A — Dev mode (you see logs, stop when you close the terminal)

```powershell
npm run dev        # next dev --webpack, package.json:6 → http://localhost:3000
# or, if port 3000 busy:
npm run dev -- -p 3001
```

- DB file `runningcharter.db` sits in repo root (gitignored, `lib/db.ts:5` `DATABASE_PATH` env override available).
- Amend Vehicle Opening in **Settings → Vehicle** (Brand/Model/Tank) — this seeds `lib/db.ts:113` `vehicles.current_odometer/current_fuel_level`.
- See §6 for *Calculate Fuel* / *Rebuild Ledger* after you add trips.

### 4.4 Option B — Persistent background service (survives closing the window)

Windows-only helper that builds, installs a Scheduled Task, and opens the browser:

```powershell
# Run PowerShell as Administrator (right-click → Run as Administrator)
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\start-service.ps1
```

What it does (`start-service.ps1:22`):

1. Stops any old task `LocalRunningCharterService` + kills processes on `:8082`.
2. `npm run build` (retries 3x, clears `.next/trace` locks on contention).
3. Builds phone private file: `npm run build:mobile` → reads `$ScriptUrl` or `config/sheet.local.json`, writes `quicktrip-mobile/dist/Mobile_with_url_private.html` (gitignored).
4. Registers a **Scheduled Task** at logon (`NT AUTHORITY\SYSTEM`, restart-on-failure ×3) that runs `node node_modules\next\dist\bin\next start -p 8082` in the repo.
5. Starts the task, waits 3s, opens `http://localhost:8082`.

- **Data preserved:** `runningcharter.db` and browser `localStorage fleetledger_*` are never deleted by the script.
- **Stop it:** `Stop-ScheduledTask -TaskName LocalRunningCharterService` or Task Scheduler GUI → delete `LocalRunningCharterService`. Port `8082` is then free.
- **Update after git pull:** re-run `.\start-service.ps1` (it unfresh-builds).

### 4.5 Wiring the running app to the Sheet (first launch after Windows run)

1. Open `http://localhost:3000` (dev) or `http://localhost:8082` (service).
2. Log in as Super Admin → **All Trips Master Table** header → **Sheet Settings** gear (⚙️, `data-testid=sheet-settings-btn`).
3. Paste Sheet URL + Script URL (or just IDs — the dialog extracts via `/d/([…])/`). It probes `GET …?action=allRows` and shows *Connected — N rows* or *error hint `Deploy as Anyone with link`*.
4. Click **Save** — values land in `localStorage mobile.sheetId/mobile.scriptUrl` and the header buttons **Import from Google Sheet ☁️↓** / **Export to Google Sheet ☁️↑** become enabled. `mobile.lastSheetPullAt / PushAt` timestamps appear under the header.

No restart needed. You can also set `NEXT_PUBLIC_SHEET_ID` / `NEXT_PUBLIC_SCRIPT_URL` env vars before `npm run build`, but the Settings dialog (localStorage) wins at runtime.

---

## 5. Add the phone file & run on phone — single-file PWA

### 5.1 Why two files?

- `quicktrip-mobile/dist/mobile_app_public.html` — **public template**, `SCRIPT_URL_DEFAULT = ""`, committed, safe for GitHub. On the phone you’d have to paste the Script URL once via Settings.
- `quicktrip-mobile/dist/Mobile_with_url_private.html` — **private**, built locally, URL hard-coded. Copy this one file to the phone and **no Settings paste is needed**. It is gitignored (`-.gitignore:51`) so it never leaves your machine via git.

### 5.2 Build the private file (after §4.2 is done)

```powershell
npm run build:mobile
# → reads $env:SCRIPT_URL (from start-service.ps1 $ScriptUrl) else config\sheet.local.json
# → writes quicktrip-mobile\dist\Mobile_with_url_private.html
# or just re-run .\start-service.ps1 — it calls build:mobile for you
```

Verify: open the private HTML in a desktop browser → View Source → `const SCRIPT_URL_DEFAULT = "https://script.google.com/…/exec"` should contain your URL (redact before sharing screenshots).

### 5.3 Copy to phone

Any one-file transfer works; no subfolders:

- **USB cable:** copy file, open with Chrome.
- **Google Drive / OneDrive:** upload → open Drive app → *Open with Chrome*.
- **Nearby Share / Bluetooth / Telegram Saved Messages / Email to yourself.**
- **QR trick (offline):** host the file temporarily via `python -m http.server 8000` on the laptop and fetch via `http://<laptop-ip>:8000/quicktrip-mobile/dist/Mobile…` on the same Wi-Fi.

### 5.4 Install & run

1. In **Chrome on Android**, open the private HTML file (via `file://` or `https://drive…` preview).
2. You may see a one-time permission for `…/exec` — allow.
3. **Add to Home Screen:** ⋮ (three dots) → **Add to Home Screen** / **Install app** → confirm. The icon now launches standalone (no browser bar).
4. First load fetches `GET ?action=last10` to seed **Start KM** from the sheet’s last rows (amber badge = remote truth vs offline stale).
5. Fill the same form as `components/QuickTripForm.tsx` (Date, Start/End KM with reciprocals, Places, optional Fuel Pumped). Offline: trips queue in **IndexedDB `mobile-queue`** and flush on `online` / `visibilitychange` (see `quicktrip-mobile/README.md:29`).
6. If you used the **public** template instead, open it → ⚙️ Settings → paste Script URL → Save. The private file skips this.

**Updating the URL later:** Edit `config/sheet.local.json` (or `start-service.ps1 $ScriptUrl`), re-run `npm run build:mobile`, recopy the single file to the phone. Or on the phone: Settings → overwrite `mobile.scriptUrl` in localStorage (the latest paste wins over the hard-coded default).

---

## 6. Core operations — Calculate Fuel & Rebuild Ledger (the two buttons new users mis-use)

### 6.1 “Calculate Fuel” is *Estimate Fuel Economy* (not a fuel-top-up)

**Where:** All Trips Master Table header → **Estimate Fuel Economy** (or per Ledger page via same control). Implemented in `lib/estimateFuelEconomy.ts:191` and UI `components/ledger/EstimateFuelEconomy.tsx`.

**What it answers:** *“What km/L did the vehicle actually achieve between two fuel-ins?”* — not “how much fuel is left?” The **Fuel Tank Level State** bar already shows the current `finalBalance / tankCapacity` (`components/ledger/Side2FuelTables.tsx:246`).

**Model (ADR 0011):**

- A **Fuel-IN Segment** (`CONTEXT.md:111`) is the trip after a `fuel_pumped_amount > 0` trip up to and *including* the next pumped trip. Economy changes **only after** the pumped trip completes (trip-level, not date-level).
- For each segment the estimator brute-forces every `0.1 km/L` in `0.1…50` and keeps the value whose simulated per-trip balances stay inside `[1, tankCapacity]` (default tank from `vehicles.tank_capacity`, min fuel `1 L`). Pump timing being on a specific trip is thus respected; intermediate `inTank` at the first trip of each date is added once.
- Pick rule: among feasible (`violation==0`) candidates, choose the one closest to the previous segment’s economy (or practical seed `7.8 km/L` for the first segment, `lib/estimateFuelEconomy.ts:181`). If none feasible, pick the `0.1` value with minimal max violation and emit a warning.

**When to press it:**

- Right after importing/pulling a batch that added new fuel-ins. The estimator suggests a `7.2…14 km/L` per segment.
- After fixing a large KM gap that shifted many pages (otherwise the old economy no longer matches the moved distances).

**What it writes:** Per-page overrides `fleetledger_fuel_economy_<pageId>` (and `..._in_tank_…` for In-Tank edits) plus the `DayGroup.economySource === 'explicit'` badge (*Adjusted*). Applying a suggestion immediately recomputes `Consumed = Distance / Economy` and `Closing = Position + In-Tank + Drawn − Consumed` forward through the book. Use **Dashboard → Fuel Economy Trend** (70% pane) to sanity-check: each `Year Track` should show green stems near `10…14 km/L`; a RED `Gap Span` indicates a remaining KM gap (fix that first).

**Warning paths:** If `lib/estimateFuelEconomy.ts:388` yields `No 1-dec economy keeps fuel in [1, tankCapacity]…` the dialog shows that warning plus the nearest value. Do not blindly apply — check `All Trips` for `Fuel Pumped` mistypes or an unclosed KM gap (gap changes `Distance`).

### 6.2 “Rebuild Ledger” (hard recalculation from Book Opening)

**Where:** All Trips Master Table header → **Rebuild Ledger** (`AllTripsMasterTable.tsx` / `lib/pageStore.ts: rebuildLedger`). Also triggered implicitly by **Book Opening** edits in Vehicle Settings.

**What it does (`lib/pagination.ts:236` `recalculatePageBalancesFromOpening`):**

1. Pages sorted `1…N` chronologically.
2. For each page, `start_km = prev end_km`, `start_fuel = prev end_fuel` (first page uses `vehicles.current_odometer / current_fuel_level` as the **Book Opening**).
3. Per page: `totalDistance = Σ trip_distance (integer KM)`, `totalDrawn = Σ fuel_pumped_amount`, `totalInTank = Σ inTanksByPage[pageId]` (from `fleetledger_in_tank_*`), `consumed = totalDistance / economy (default 10.5 if no explicit economy)`, `end_fuel = start_fuel + totalInTank + totalDrawn − consumed` (1-dec), `end_km = last trip end_km else start_km`.
4. No dates are mutated; pagination grouping (4 distinct dates / 13 trips per date / new-month forces new page) is preserved; `validatePaginationConstraints` ( `lib/pagination.ts:325` ) is then re-checked.

**When to press it:**

- After bulk edits (direct DB fix, `DELETE FROM trips` via SQLite Browser) or after dropping/re-adding many pages.
- After changing **Vehicle Tank Capacity** or **Book Opening** (Opening KM / Opening Fuel) in Settings — the UI does this automatically but a manual rebuild is harmless and idempotent.
- When `Continuity Alerts` show many `Fuel Gap — Expected X Actual Y (AMBER)` that are all off by a constant (opening moved).

**When NOT to press it:**

- To fix a `KM Gap` (RED) — use `Fill Gap / Insert After / Remove & Shift` in All Trips (see `app/help/page.tsx:68` §13). Rebuild does not create missing history; it only re-propagates fuel around existing gaps.
- Repeatedly during normal entry — it is a forward-recalc, not a normalization; economy overrides intentionally survive it.

**Output / verification:**

- Toast `Rebuilt — N pages` or row-numbered `MAX_DAYS / MAX_TRIPS_PER_DAY / MONTH_ROLLOVER` errors if the current book violates pagination after your raw edit.
- Then check: **Physical Book Ledger → Continuity Verification Stamp** ( `components/ledger/Side2FuelTables.tsx:264` ) should read *“Carried Forward … → Page N+1”* and the **All Trips continuity banner** should be empty (no RED/AMBER). If still present, fix gaps first, then optionally re-run Estimate Fuel Economy.

---

## 7. Quick checklists (copy-paste for a new teammate)

### A. Fresh Sheet checklist (laptop operator)

```
[ ] Sheet tab renamed “All Trips”, row 1 = 10 exact headers (frozen)
[ ] Extensions → Apps Script → paste Code.gs → Deploy → Anyone with link → copied Script URL
[ ] Copied Sheet URL (any format — ID extracted automatically)
[ ] Created config/sheet.local.json from config/sheet.example.json, pasted both URLs
[ ] git status — neither config/sheet.local.json nor .../Mobile_with_url_private.html appear
[ ] npm install → npm run build → OK
[ ] All Trips header → Sheet Settings → paste URLs → “Connected — N rows”
[ ] Export to Google Sheet ☁️↑ → check Sheet populated with current ledger rows
```

### B. Windows persistent run checklist

```
[ ] Node 20+ installed
[ ] config/sheet.local.json exists
[ ] PowerShell as Admin → .\start-service.ps1 → opened http://localhost:8082
[ ] Scheduled Task LocalRunningCharterService exists (Task Scheduler)
[ ] After reboot, localhost:8082 comes up without re-running anything
```

### C. Phone file checklist

```
[ ] npm run build:mobile  (or start-service.ps1 did it)
[ ] quicktrip-mobile/dist/Mobile_with_url_private.html exists, contains SCRIPT_URL_DEFAULT = "https:…/exec"
[ ] Copied file to phone (USB/Drive)
[ ] Chrome → open file → Add to Home Screen → icon works
[ ] Sheet Settings inside phone (if using public template) else no paste needed
[ ] Queued offline trip test: airplane mode → submit → IndexedDB queue → online → auto-flush → appears in Sheet allRows
```

---

## 8. Troubleshooting (URLs & builds)

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Sheet fetch failed: 401/403` or `Deploy as Anyone with link` | Apps Script not deployed as `Anyone with link` | Redeploy Web App → `Anyone with the link` → copy **new** URL into `config/sheet.local.json` + Sheet Settings |
| `Header row mismatch. Expected: Date \| Start KM …` | Row 1 ≠ `ALL_TRIPS_HEADERS` order | Fix header order exactly, delete extra columns, clear stray rows below, redeploy |
| `Missing scriptUrl` toast in All Trips | `config/sheet.local.json` empty + no localStorage Settings | Create `config/sheet.local.json` or paste in Sheet Settings dialog (localStorage) |
| Private phone file still asks for Settings paste | Built before URL existed | Re-run `npm run build:mobile` after filling `config/sheet.local.json` (or `$ScriptUrl` in `start-service.ps1`) and recopy to phone |
| `git push` shows `Mobile_with_url_private.html` | `.gitignore` bypassed (`git add -f`) | `git rm --cached quicktrip-mobile/dist/Mobile_with_url_private.html` then commit |
| `npm run build` fails `useSearchParams should be wrapped in Suspense` | Deleted Suspense wrapper in `app/trips/page.tsx` | Restore wrapper (`TripsMasterPage` → `TripsMasterPageContent` inside `Suspense`) |

---

## 9. Files to read next

- `lib/sheetClient.ts:1` + `lib/sheetConfig.ts:1` — client seams & priority.
- `quicktrip-mobile/README.md:1` — phone PWA contract.
- `quicktrip-mobile/apps-script/Code.gs:1` — proxy logic, `LockService` for atomic `rewriteSheet`.
- `scripts/build-mobile.js:1` — how the private file is assembled.
- `app/help/page.tsx:77` §§14–16 — in-app help for Focused Trip & Sheet Pull/Push previews.
- `lib/estimateFuelEconomy.ts:1` + `docs/adr/0011-*` — Fuel-IN segment feasibility.
- `lib/pagination.ts:236` — Rebuild logic.
- `CONTEXT.md:1` — glossary (Book Opening, Fuel-IN Segment, Focused Trip…).

