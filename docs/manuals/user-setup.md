# User Setup Manual — Local Running Charter

> **Goal:** A new user who has only this repo can, by reading this file alone, prepare a fresh Google Buffer Sheet, wire it to the app, run the app on Windows, and install the phone PWA — without ever leaking private Sheet/Script URLs to git.

---

## 0. Mental Model

```
Phone (PWA) ──appendTrip──► Google Buffer Sheet ◄──allRows/rewriteSheet──► Laptop app (All Trips Master Table)
                              ▲                                               │
                              │  Apps Script = Sheet Proxy (no Google keys)   │
                              └─────────────── you deploy once ───────────────┘
```

**Laptop DB** is local: `./runningcharter.db` (SQLite via better-sqlite3, `lib/db.ts:1`). No Railway / Supabase / Vercel needed.

**File roles** (do not rename):

| File | Git? | Purpose |
|------|------|---------|
| `config/sheet.example.json` | Committed | Template with placeholders — copy it |
| `config/sheet.local.json` | **Ignored** | Your real Sheet ID + Script URL — never commit |
| `mobile_app_public.html` | Committed | Public template, no secret — safe to push |
| `Mobile_with_url_private.html` | **Ignored** | Private build with URL hard-coded — copy to phone |

---

## 1. Prepare a New Google Sheet (Buffer Sheet)

### Quick Method — Export Template (recommended)

The easiest way to get the exact headers without mistakes:

1. Open the app → All Trips Master Table header → **Export Excel**
2. Open the downloaded .xlsx in Google Sheets: **File → Import → Upload**
3. This gives you the exact header row in the correct order
4. Rename the **tab** (bottom) to exactly `All Trips` (case/spaces matter)
5. Delete the dummy data rows, keep the header row
6. **Freeze row 1:** View → Freeze → 1 row

This avoids the "Header row mismatch" error that causes both Pull and Push to fail.

### Manual Method — Paste Headers by Hand

1. https://sheets.google.com → **Blank spreadsheet**
2. Rename the **first tab** (bottom) to exactly `All Trips`
3. Row 1 paste these 10 headers **in this exact order** (`lib/sheetClient.ts:6`):

   `Date | Start KM | End KM | Distance | Start Time | End Time | Private / Official | Places Visited | Fuel Pumped | Fuel Order No`

   - `Date` must be `YYYY-MM-DD`
   - `Start KM / End KM / Distance` are integers (script formats them `0`)
   - `Fuel Pumped` is 1 decimal (`0.0`)
   - `Private / Official` accepts `Official` or `Private`
4. Freeze row 1: View → Freeze → 1 row

### Why Strict Header Order Matters

`ensureHeaders_` (`Code.gs:146`) validates the first row — order-enforced, case-insensitive, aliases `Type` for column 6 and `Fuel Drawn` for column 8. If validation fails the Sheet Proxy returns `{ok:false, error:'Header row mismatch…'}` and **both Pull and Push are rejected atomically** (sheet left untouched).

---

## 2. Deploy the Sheet Proxy (Apps Script)

### 2.1 Paste the Script

1. In the Sheet: **Extensions → Apps Script**
2. Delete any `Code.gs` placeholder → paste the entire `quicktrip-mobile/apps-script/Code.gs` (186 lines)
3. Save (Ctrl+S) — project name e.g. `RunningChart Proxy`

### 2.2 Deploy as Web App

1. **Deploy → New deployment → Web App**
2. **Description:** `RunningChart Buffer Proxy v1`
3. **Execute as:** `Me` (your Google account — the Sheet owner)
4. **Who has access:** `Anyone with the link` (required)
   - If you restrict to Google accounts, the laptop `fetch` will 401 and the main app shows "verify Apps Script deployed as Anyone with link"
5. Click **Deploy → Authorize** (allow `See, edit, create… spreadsheets`)
6. Copy the **Web App URL** — looks like `https://script.google.com/macros/s/AKfycby…/exec` (this is `scriptUrl`)

### 2.3 Copy the Sheet URL

Copy the Sheet's browser URL bar. Any form is accepted — the app extracts the ID via `/\/d\/([a-zA-Z0-9-_]+)/` (`lib/sheetClient.ts:56`):

`https://docs.google.com/spreadsheets/d/1AbC…XyZ/edit?gid=0#gid=0` → ID `1AbC…XyZ`

You now have two strings:
- `sheetUrl` (or just the ID)
- `scriptUrl`

**Never commit them.**

### 2.4 Verify Without the Laptop

Append `?action=allRows` to the Script URL and open in a browser. You should get `{"rows":[]}`. If you see `Header row mismatch`, fix row 1.

---

## 3. Where URLs Live — Keep Them Out of Git

| Where | Git? | Purpose |
|-------|------|---------|
| `config/sheet.local.json` | **Ignored** (`.gitignore:48`) | Single source of truth on the laptop |
| `lib/sheetConfig.ts` FALLBACKs | Committed | **Must stay empty** (`''`) — do not paste real URLs |
| `.env.local` / `NEXT_PUBLIC_*` | Ignored | Optional alt for CI |
| `localStorage mobile.*` | Per-browser | Runtime override via Sheet Settings dialog |
| `Mobile_with_url_private.html` | **Ignored** | Single-file for phone with URL hard-coded at build |

**Rule of thumb:** After step 2, create `config/sheet.local.json` and never paste URLs into any tracked `.ts`/`.html`. Before `git push`, run `git status` — you should see neither `sheet.local.json` nor `Mobile_with_url_private.html` listed (or listed as ignored).

---

## 4. Run on Windows

### 4.1 Prerequisites

- **Node 20+** (`node -v`) and npm (`npm -v`) — install from https://nodejs.org (LTS)
- Clone repo and install:

```powershell
cd C:\labs\local_runningcharter
npm install
```

### 4.2 First-Time: Create config/sheet.local.json

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

### 4.3 Option A — Dev Mode

```powershell
npm run dev        # http://localhost:3000
# or, if port 3000 busy:
npm run dev -- -p 3001
```

- DB file `runningcharter.db` sits in repo root (gitignored)
- Amend Vehicle Opening in **Settings → Vehicle** (Brand/Model/Tank)
- See §7 for *Calculate Fuel* / *Rebuild Ledger*

### 4.4 Option B — Persistent Background Service (start-service.ps1)

Run PowerShell as Administrator:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\start-service.ps1
```

**What it does:**

1. Prints `-- attempting to start service at HH:mm on dd-MM-yyyy` (cyan) immediately after `Set-Location` — so you see the exact click time even before UAC elevation.
2. Stops any old `LocalRunningCharterService` task and kills processes on `:8082`
3. Runs `npm run build` (retries 3x on contention)
4. Builds the mobile private file: `npm run build:mobile` — reads `$ScriptUrl` or `config/sheet.local.json`
5. Registers a **Scheduled Task** at logon (`NT AUTHORITY\SYSTEM`, restart-on-failure x3)
6. Starts the task, waits 3s, opens `http://localhost:8082`

**Configuring the Script URL in the PS1:**

Open `start-service.ps1` and set line 13:

```powershell
$ScriptUrl = "https://script.google.com/macros/s/AKfycby…/exec"
```

This value overrides `config/sheet.local.json` via `$env:SCRIPT_URL`. The PS1 itself is tracked, so leave `$ScriptUrl = ""` unless you keep the PS1 private.

**Managing the service:**

```powershell
# Stop the service
Stop-ScheduledTask -TaskName LocalRunningCharterService

# Or: Task Scheduler GUI → find LocalRunningCharterService → delete
# After stop, port 8082 is free

# Re-run after git pull to update
.\start-service.ps1
```

**Data preserved:** `runningcharter.db` and browser `localStorage fleetledger_*` are never deleted by the script.

### 4.5 Wiring the Running App to the Sheet

1. Open `http://localhost:3000` (dev) or `http://localhost:8082` (service)
2. Log in as Super Admin → **All Trips Master Table** header → **Sheet Settings** gear (⚙️)
3. Paste Sheet URL + Script URL (or just IDs — the dialog extracts via `/d/([…])/`)
4. It probes `GET …?action=allRows` and shows *Connected — N rows* or error hint
5. Click **Save** — values land in `localStorage mobile.sheetId/mobile.scriptUrl`

No restart needed.

---

## 5. Phone PWA — Single-File Install

### 5.1 Why Two Files?

- `mobile_app_public.html` — **public template**, `SCRIPT_URL_DEFAULT = ""`, committed, safe for GitHub. You'd paste Script URL once via Settings.
- `Mobile_with_url_private.html` — **private**, built locally, URL hard-coded. Copy to phone; no Settings paste needed. Gitignored.

### 5.2 Build the Private File

```powershell
npm run build:mobile
# Reads $env:SCRIPT_URL (from start-service.ps1) or config/sheet.local.json
# Writes quicktrip-mobile/dist/Mobile_with_url_private.html
```

Or just re-run `.\start-service.ps1` — it does this for you.

### 5.3 Copy to Phone

Any one-file transfer works:

- **USB cable:** copy file, open with Chrome
- **Google Drive / OneDrive:** upload → open Drive app → Open with Chrome
- **Nearby Share / Bluetooth / Telegram / Email to yourself**
- **QR trick (offline):** `python -m http.server 8000` on laptop → fetch via `http://<laptop-ip>:8000/` on same Wi-Fi

### 5.4 Install & Run

1. In **Chrome on Android**, open the private HTML file
2. Allow any one-time permission for the Script URL
3. **Add to Home Screen:** ⋮ → **Add to Home Screen** → confirm. Icon launches standalone (no browser bar).
4. First load fetches `GET ?action=last10` to seed Start KM from sheet's last rows
5. Offline trips queue in **IndexedDB** and flush on `online` / `visibilitychange`

**Updating the URL later:** Edit `config/sheet.local.json` (or `start-service.ps1 $ScriptUrl`), re-run `npm run build:mobile`, recopy the single file to the phone.

---

## 6. Quick Checklists

### A. Fresh Sheet Checklist

```
[ ] Sheet tab renamed "All Trips", row 1 = 10 exact headers (frozen)
[ ] Extensions → Apps Script → paste Code.gs → Deploy → Anyone with link → copied Script URL
[ ] Copied Sheet URL (any format — ID extracted automatically)
[ ] Created config/sheet.local.json from config/sheet.example.json, pasted both URLs
[ ] git status — neither sheet.local.json nor Mobile_with_url_private.html appear
[ ] npm install → npm run build → OK
[ ] All Trips header → Sheet Settings → paste URLs → "Connected — N rows"
[ ] Export to Google Sheet ☁️↑ → check Sheet populated with current ledger rows
```

### B. Windows Persistent Run Checklist

```
[ ] Node 20+ installed
[ ] config/sheet.local.json exists
[ ] PowerShell as Admin → .\start-service.ps1 → opened http://localhost:8082
[ ] Scheduled Task LocalRunningCharterService exists (Task Scheduler)
[ ] After reboot, localhost:8082 comes up without re-running anything
```

### C. Phone File Checklist

```
[ ] npm run build:mobile (or start-service.ps1 did it)
[ ] Mobile_with_url_private.html exists, contains SCRIPT_URL_DEFAULT = "https:…/exec"
[ ] Copied file to phone (USB/Drive)
[ ] Chrome → open file → Add to Home Screen → icon works
[ ] Sheet Settings inside phone (if using public template) else no paste needed
[ ] Queued offline trip test: airplane mode → submit → IndexedDB queue → online → auto-flush
```

---

## 7. Calendar, Leaves & All Trips Table

### 7.0 Holiday Calendar & Summaries (`/calendar`)

- **Range:** 2024–2027. Saturdays/Sundays are Bank holidays; plus CBSL Poya/Bank/Public/Mercantile from `lib/sriLankanHolidays.ts`. Cells colored by kind; cyan dot marks dates with trips, ×N for multiple trips. Right-click a date cell that has trips → context menu **Show Trip Details →** jumps to `All Trips?focus=<tripId>` and focuses that day (`app/calendar/page.tsx:90,508`).
- **Leave (manual-only):** Click any date → dialog. If not leave: enter optional note (max 200) → **Mark as Leave**. If already leave: edit note → **Save** or **Clear Leave**. Leaves are never auto-created from holidays/import; all prior auto leaves were purged. Leaves are always Off-Days (priority Leave > Mercantile > Public > Bank/Poya > Weekend). Dialog shows 6 preset pills `Annual Leave | Casual Leave | Medical Leave | Duty Leave | Duty Leave (Overseas) | Private Overseas` (`LEAVE_PRESETS`) that fill the note box on click (`editNote === preset` → `bg-sky-600`, else `bg-paper-gutter`); box still freely editable, `maxLength 200`, placeholder `e.g. Annual Leave…`, counter `N/200`. If that date has trips, dialog shows amber bar `⚠ N trip(s) on this date` + **Show Trips →** (`leave-show-trips-btn`) that navigates to `All Trips` and focuses the date’s first trip (`app/calendar/page.tsx:327`, `handleShowTripsForDate`).
- **Header buttons (popups):**
  - **Trips on Off-Days** — grouped by date (header `Date · DayOfWeek · Reason`) with per-trip Start/End KM, Distance, Type, Places, Fuel and per-date total km. Built from `validateTripsOnOffDays` + `getTripsOnOffDaysGrouped`.
  - **No-Trip Working Days** — lists every Working Day (Mon–Fri, not holiday, not leave) with zero trips that lies inside an **ODO-Continuous Segment**. Dates strictly inside a Trip-to-Trip ODO Gap (`end_km ≠ next start_km` on different dates, `lib/continuityAlerts.ts`) are hidden (ledger missing). Range `firstTripDate..lastTripDate` clamped to 2024..2027.
- **Leave History:** Persistent card below months — table `Date | Day | Holiday | Note` with Edit/Clear. Year filter `All | 2024..2027` (default current year), sorted `date DESC`.

### 7.1 All Trips — Day Type & Layout

- **DAY column (Day Type) — compact:** `w-16 min-w-[56px] max-w-[64px]` narrow, header `DAY` `text-[8px]` (`-2px` from `10px`), badges `text-[9px]` (`-2px` from `11px`) centered (`components/dashboard/AllTripsMasterTable.tsx:1403,1489`). Weekday → no badge (`—` in `text-on-surface-variant`); `Sat`/`Sun` → **RED** `bg-red-100 border-red-300`; `Poya` → **YELLOW** `bg-yellow-100 border-yellow-300` (priority over all); `PH` (Public) → **BLUE** `bg-sky-100`; `MH` (Mercantile) → **AMBER** `bg-amber-100`; `BH` (Bank) → **RED**; `HOL` (other) → **SLATE** `bg-slate-100`; `Leave` → **ORANGE** `bg-orange-100` with dot (`bg-orange-500`). Priority `Leave > Poya > MH > PH > BH > Sat/Sun > Weekday` (`getDayBadge` in `AllTripsMasterTable.tsx:782`, `CONTEXT.md:150`).
- **Off-day summary bar:** `flex-wrap` chips `Off-day N trips • X km | Working N | Leave | Mercantile | Poya | Open Calendar →` plus RHS `Go to Latest records…` (`go-to-latest-btn`) `ml-auto bg-slate-900 text-white rounded-full` that `scrollIntoView({block:'center'})` to last filtered row (or chronological latest `sortedAll`) with focused `ring-2` flash (`handleGoToLatest` `AllTripsMasterTable.tsx:755`).
- **⋯ actions column:** `sticky right-0 w-10 min-w-[40px] bg-paper-gutter shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.08)]` stays visible without horizontal-scroll hiding; menu rendered via `createPortal` fixed to `document.body` at `getBoundingClientRect()` + `6px` gap, auto-flips above when `bottom+menuH > vh` (last rows pop up), `z-40`, backdrop `fixed inset-0 z-30` closes on click/scroll/Esc, so `Delete`/`Insert After`/`Remove & Shift`/`Fill Gap` never clip inside `overflow-auto` (`AllTripsMasterTable.tsx:84,1609`).
- **Private:** `Type` column removed; Private is signaled solely by orange row `bg-orange-200` (RED gap cell wins on Start KM, dark-blue `text-blue-900` layers when fuel pumped). Filter `All Types / Official / Private` still available; set type via Insert After / Gap Fill / Import.
- **Route width:** Reduced 22% → 6% narrow (`w-[6%]` −20% from 8%, Route text `text-xs`, `⋯` fixed `w-10 min-w-[40px]` fully visible, table `min-w-[1020px]` on mobile) so desktop `w-full lg:min-w-0 lg:overflow-x-hidden` shows all columns (Pumped/Order No/Pos./In-Tank/Econ/Balance/Page/⋯) with only vertical scroll.

---

## 8. Core Operations

### "Calculate Fuel" is Estimate Fuel Economy

**Where:** All Trips Master Table header → **Estimate Fuel Economy**

**What it answers:** *"What km/L did the vehicle actually achieve between two fuel-ins?"* — not "how much fuel is left?"

**When to press it:**

- After importing/pulling a batch that added new fuel-ins
- After fixing a large KM gap that shifted many pages

**When NOT to press it:**

- To fix a KM Gap (RED) — use Fill Gap / Insert After / Remove & Shift instead
- Repeatedly during normal entry — it is a forward-recalc, not a normalization

### "Rebuild Ledger" (Hard Recalculation from Book Opening)

**Where:** All Trips Master Table header → **Rebuild Ledger**

**When to press it:**

- After bulk edits (direct DB fix, `DELETE FROM trips` via SQLite Browser)
- After changing Vehicle Tank Capacity or Book Opening in Settings
- When Continuity Alerts show many Fuel Gaps all off by a constant

**When NOT to press it:**

- To fix a KM Gap (RED) — use Fill Gap / Insert After / Remove & Shift
- Repeatedly during normal entry — economy overrides intentionally survive it

---

## 9. Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Sheet fetch failed: 401/403` | Apps Script not deployed as `Anyone with link` | Redeploy → `Anyone with the link` → copy **new** URL into config + Sheet Settings |
| `Header row mismatch` | Row 1 ≠ correct order | Fix header order exactly, delete extra columns, redeploy |
| `Missing scriptUrl` toast | No config file + no localStorage Settings | Create config/sheet.local.json or paste in Sheet Settings dialog |
| Private phone file still asks for Settings | Built before URL existed | Re-run `npm run build:mobile` after filling config/sheet.local.json, recopy |
| `npm run build` fails `useSearchParams` | Deleted Suspense wrapper | Restore wrapper in `app/trips/page.tsx` |

---

## 10. Files to Read Next

- `lib/sheetClient.ts` + `lib/sheetConfig.ts` — client seams & priority
- `quicktrip-mobile/README.md` — phone PWA contract
- `quicktrip-mobile/apps-script/Code.gs` — proxy logic, LockService
- `scripts/build-mobile.js` — how the private file is assembled
- `docs/adr/0018-tiered-estimated-start-time.md` — time estimation tiers
- `docs/adr/0011-estimated-fuel-economy-per-fuel-in-segment.md` — fuel economy estimator
- `lib/pagination.ts` — Rebuild logic
- `CONTEXT.md` — glossary (Book Opening, Fuel-IN Segment, Focused Trip…)
