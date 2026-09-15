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

1. Stops any old `LocalRunningCharterService` task and kills processes on `:8082`
2. Runs `npm run build` (retries 3x on contention)
3. Builds the mobile private file: `npm run build:mobile` — reads `$ScriptUrl` or `config/sheet.local.json`
4. Registers a **Scheduled Task** at logon (`NT AUTHORITY\SYSTEM`, restart-on-failure x3)
5. Starts the task, waits 3s, opens `http://localhost:8082`

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

## 7. Core Operations

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

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Sheet fetch failed: 401/403` | Apps Script not deployed as `Anyone with link` | Redeploy → `Anyone with the link` → copy **new** URL into config + Sheet Settings |
| `Header row mismatch` | Row 1 ≠ correct order | Fix header order exactly, delete extra columns, redeploy |
| `Missing scriptUrl` toast | No config file + no localStorage Settings | Create config/sheet.local.json or paste in Sheet Settings dialog |
| Private phone file still asks for Settings | Built before URL existed | Re-run `npm run build:mobile` after filling config/sheet.local.json, recopy |
| `npm run build` fails `useSearchParams` | Deleted Suspense wrapper | Restore wrapper in `app/trips/page.tsx` |

---

## 9. Files to Read Next

- `lib/sheetClient.ts` + `lib/sheetConfig.ts` — client seams & priority
- `quicktrip-mobile/README.md` — phone PWA contract
- `quicktrip-mobile/apps-script/Code.gs` — proxy logic, LockService
- `scripts/build-mobile.js` — how the private file is assembled
- `docs/adr/0018-tiered-estimated-start-time.md` — time estimation tiers
- `docs/adr/0011-estimated-fuel-economy-per-fuel-in-segment.md` — fuel economy estimator
- `lib/pagination.ts` — Rebuild logic
- `CONTEXT.md` — glossary (Book Opening, Fuel-IN Segment, Focused Trip…)
