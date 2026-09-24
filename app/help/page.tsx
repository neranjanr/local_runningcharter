'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { ProtectedRoute } from '@/components/ProtectedRoute';

type Section = { id: string; title: string; content: string; group: string };

const sections: Section[] = [
  {
    id: 'book-opening',
    title: '1. Book Opening',
    group: 'Core Concepts',
    content: `Book Opening seeds Page 1 with Opening KM (integer) and Opening Fuel (1 decimal, default 10 L). Enter it in Vehicle Settings when the Book starts (e.g., 2026-01-01 at 50,000 km).

It is re-editable: when back-dated Pages are inserted before the earliest date, the Opening is re-applied to the new earliest Page and fuel balances are recalculated forward. This keeps older histories correctly capitalized without mutating dates.`,
  },
  {
    id: 'reciprocals',
    title: '2. Reciprocal Calculations (Start+Distance=End)',
    group: 'Core Concepts',
    content: `Integer KM Rule — all odometer values (Start KM, End KM, Trip Distance, Page Start/End KM, Day Start/End KM) are displayed as integers with no decimals everywhere (UI tables, toasts, Excel KM columns). Decimal KM input is accepted but rounded on blur/save via Math.round.

Reciprocal Calculations — odometer fields follow Integer KM rule. Distance = round(End - Start). Entering Start KM + Distance auto-derives End KM, and vice versa. Both integer-rounded. This mirrors the paper book's integer odometer and prevents manual math errors.

Fuel and Closing Balance remain 1 decimal for maths (Consumed = Distance / Economy rounded 1 dec, Balance = Position + In-Tank + Drawn - Consumed rounded 1 dec). Excel KM columns use integer format (numFmt '0').`,
  },
  {
    id: 'time-estimation',
    title: '3. Time Estimation (tiered speed, ceil 5 min)',
    group: 'Core Concepts',
    content: `Estimated Start Time = End Time - (Distance / speed) ceiled to nearest 5 minutes.

Speed tiers:
  • < 10 km  →  15 km/h
  • < 20 km  →  20 km/h
  • < 40 km  →  25 km/h
  • <= 60 km →  30 km/h
  • > 60 km  →  35 km/h

formula: estimatedMinutes = ceil((distance / speed) * 60 / 5) * 5

Auto-fills only when Start Time is empty and End Time + Distance are present. The explicit "Auto" button recomputes even when Start Time is already filled. Manual override is always allowed and never auto-clobbered. End Time defaults to now (present time) on form load.

During Excel / Sheet import, empty Start Time is auto-estimated from End Time + Distance and persisted (overwrite on same Odo Key). If End Time is empty the row is rejected. If distance <= 0 estimation returns null and Start stays "".`,
  },
  {
    id: 'pagination-rules',
    title: '4. Pagination Rules (4 days / 13 trips / month rollover)',
    group: 'Core Concepts',
    content: `Physical Book constraints are enforced strictly:

  • Maximum 4 distinct Dates per Page
  • Maximum 13 Trips per Day Group
  • A new calendar month always forces a new Page

Violations during manual entry or import pre-flight are reported as row-numbered errors and block any write until fixed. This keeps digital pagination identical to the paper book.`,
  },
  {
    id: 'fuel-formula',
    title: '5. Fuel Formula (Position + In-Tank + Drawn - Consumed = Closing)',
    group: 'Ledger & Fuel',
    content: `Per Day Group, Closing Balance = Position + In-Tank Fuel + Drawn - Consumed, rounded to 1 decimal.

  • Position is the previous Day Group's Closing Balance (Page N+1 Day 1 inherits Page N's final Closing)
  • In-Tank defaults to 0 per Day Group and is editable only on the first Trip of the day
  • Drawn is summed Fuel Pumped per day with Fuel Order No
  • Consumed = Distance / Fuel Economy (economy inherits forward until overridden, fallback 10.5 km/L)

Economy propagation and fuel arithmetic are tested via the ledger fuel engine seam.`,
  },
  {
    id: 'adjusted-economy',
    title: '6. Adjusted Fuel Economy (±0.1 step, badge, revert)',
    group: 'Ledger & Fuel',
    content: `Fuel Economy for a Day Group can be adjusted by stepping ±0.1 from the existing value using the number input's up/down arrows (or typing). Values are clamped 0.1–50 km/L and rounded to 1 decimal.

An "Adjusted" badge appears when the economy is an explicit override (economySource === 'explicit').

To revert to the inherited value:
  • Type the inherited number (e.g., the value shown with "(Inh.)") — the override is automatically deleted
  • Or click the x clear button next to the badge

The overridden economy propagates forward to subsequent Day Groups until the next explicit override, recomputing Consumed and Closing Balance immediately.`,
  },
  {
    id: 'private-bold',
    title: '7. Private Trip — Orange Row (Private = Orange)',
    group: 'Ledger & Fuel',
    content: `Any Trip with Type = Private is rendered with an orange row background bg-orange-200 in both the Ledger (Side 1 Trips Log, per Page) and the All Trips Master Table. Fuel-pumped Private rows layer dark-blue text on the orange.

The RED KM-gap highlight (bg-red-100) on a gapped Start KM cell takes precedence over the orange. Private is signaled solely by row color; the Type column was removed from All Trips (see section 20) to save width — use the "All Types / Official / Private" filter or set type via Insert After / Gap Fill / Import (Excel/Sheet) to change it. Print preserves the orange distinction.`,
  },
  {
    id: 'continuity-alerts',
    title: '8. Continuity Alerts (RED/AMBER gap legend)',
    group: 'Ledger & Fuel',
    content: `Two-color alerts surface odometer and fuel discontinuities at Page-to-Page and Trip-to-Trip levels.

RED (bg-red-100) indicates a KM Gap:
  • Page N End KM ≠ Page N+1 Start KM
  • Trip's End KM ≠ next Trip's Start KM (chronological sort)

AMBER/ORANGE (bg-amber-100) indicates a Fuel Gap:
  • Page N End Fuel Balance ≠ Page N+1 Start Fuel Balance
  • Day Group Closing Balance ≠ next Day's Position (including In-Tank)

Dashboard — shows a compact alert bar ("Continuity Gaps Detected") with a "View All Trips" link. Click to see full gap details in the All Trips table.

All Trips / Ledger — shows the full detailed alert with page/trip numbers, expected vs actual values, color-coded RED/AMBER, and "Jump to Page/Trip" links. The banner survives refresh and only clears when gaps are fixed.`,
  },
  {
    id: 'renumber',
    title: '9. Retroactive Renumber (Chronological 1..N)',
    group: 'Ledger & Fuel',
    content: `When a Trip or import date precedes the earliest Page, all Pages are sorted chronologically by date, renumbered 1..N sequentially, and page_number/page_id plus Trip.page_id are cascaded. Dates are never mutated and pagination constraints (4/13/month) are preserved.

Example: Book starts 2026-01-01 Page 1 at 50,000 km, later entry for 2025-01-01 becomes Pages 1–2 and the existing Page renumbers (no gap).

Book Opening re-edit triggers recalculation of fuel balances forward from the earliest Page only. Continuity invariants hold after renumber: Page N End KM = Page N+1 Start KM and End Fuel = next Fuel Position (including In-Tank).`,
  },
  {
    id: 'inline-editing',
    title: '10. Inline Editing (All Trips Table)',
    group: 'Operations & Gaps',
    content: `Any trip in the All Trips Master Table can be edited inline. Click on a cell to edit. Changes are highlighted and a confirmation dialog appears before saving.

Editable fields:
  • Start KM / End KM — integer values; changing either auto-recalculates Trip Distance
  • Fuel Pumped — decimal litres (1 decimal)
  • Fuel Order No / Places Visited — free text
  • Start Time / End Time — HH:MM format, normalised on save

After save, page end values and fuel balances are recalculated if KM changed.`,
  },
  {
    id: 'gap-ops',
    title: '11. Gaps — Fill Gap vs Insert After vs Remove & Shift vs Reverse Gap Fill',
    group: 'Operations & Gaps',
    content: `KM Gaps surface as RED badges/alerts where Trip N End KM ≠ Trip N+1 Start KM (chronological by date then Start KM) and where Page N End KM ≠ Page N+1 Start KM.

All gap operations are in All Trips Master Table only (Continuity Gap banner). Ledger is read-only and shows only the bold Private rows.

Fill Gap (no shift) — when a KM gap exists (e.g., 100-110 → 120-130, gap 110-120):
  • Successor row's Start KM cell shows a "+ Fill Gap 10 km" chip (RED)
  • Predecessor row's menu shows "Fill Gap (110→120)"
  • Dialog auto-fills Start KM = 110, End KM = 120, Date = predecessor Date (editable, clamped)
  • Validates: Places non-empty, End >= Start, End Time required
  • On save the gap closes with NO downstream shift — use when the gap is missing history

Insert After (shift +Δ) — row menu → "Insert After" on any Trip:
  • Dialog defaults Date = that row's Date (editable within [that date … next date])
  • Enter Start/End KM (distance auto-derived as End - Start)
  • Confirmation shows "Insert Trip — Shift N trips by Δ km?" with before→after preview of first 3 downstream trips
  • Every later Trip's Start/End KM is increased uniformly by Δ; their Distance and fuel pumped stay frozen
  • Page start/end KM and fuel chain are recomputed forward; new Page auto-created if needed

Remove & Shift (shift -Δ) — row menu → "Remove & Shift" (distinct from plain "Delete"):
  • Removes the selected Trip and shifts every later Trip down by Δ = removed.end - removed.start
  • Confirmation shows "Remove Trip — Shift N trips by -Δ km?" with the same before→after preview
  • Page continuity is patched; empty Pages are retained v1 (not collapsed)

Reverse Gap Fill (bulk backward shift, Δ clamped to total gaps) — Continuity Gap banner → small "↩ Reverse Gap Fill" button (visible only when positive KM gaps exist, disabled when overlaps):
  • Example: Jan 0→800, Feb 900→1000 gap 100 but physical final reads 920 (recorded 1000). Δ = 1000−920 = 80, gap compresses 100→20 (Feb 900→820→920)
  • Dialog asks either Physical ODO or Reverse Shift Δ — reciprocal fields synced (Δ = recordedFinal − physicalOdo), Integer KM, both editable
  • Default fills to fully close gaps: physical = recordedFinal − totalGaps, Δ = totalGaps; "Fill to max" chip restores this
  • Validates: 0 < Δ ≤ totalPositiveGapExtent; if Δ > total shows "maximum compressible ODO is …" and disables Confirm; if physical > recorded rejects "Add missing trips instead"
  • Earliest-first sequential absorption: G1→max(0,G1−Δ), spill S=max(0,Δ−G1) to G2…, shifting the tail segment after each gap backward by its consumed share (trip_distance frozen); per-gap Before→After table shows 800→900 (100→20) etc.
  • Warning banner: "⚠️ Fuel Position & Closing Balances will be recalculated from Book Opening forward"
  • Optional checkbox "Also update Vehicle ODO" (default on) writes the physical value to Digital Vehicle Cluster
  • On confirm: Page KM + fuel chain recomputed via recalculatePageBalancesFromOpening, pagination checked (MAX_DAYS rebuildRequired path), atomic fleetledger:data-changed refresh

All four operations dispatch fleetledger:data-changed so Dashboard auto-refreshes`,
  },
  {
    id: 'focused-trip',
    title: '12. Focused Trip Retention',
    group: 'Operations & Gaps',
    content: `After Insert After, Gap Fill, Remove & Shift, or plain Delete in All Trips Master Table, focus is kept on the affected row.

  • Insert / Gap Fill → the newly added trip row is highlighted (ring + cyan flash) and scrolled to center
  • Delete / Remove & Shift → the predecessor row (chronologically previous date||start_km) is focused
  • If the earliest trip was deleted, the successor that slid into its place is focused
  • If the target row is hidden by a filter, the filter is cleared to All + date ascending and a toast appears

The highlight fades after ~3.2s. Bulk Sheet Pull import focuses the earliest newly added trip and flashes all imported rows.`,
  },
  {
    id: 'all-trips-workbook',
    title: '13. All Trips Workbook (Export & Import)',
    group: 'Data Exchange',
    content: `Export — click "Export Excel" in the All Trips table header to download a .xlsx file with all trip records. The file uses the "All Trips" sheet with these columns:

  Date | Start KM | End KM | Distance | Start Time | End Time | Private / Official | Places Visited | Fuel Pumped | Fuel Order No

("Type" header accepted as alias for "Private / Official", "Fuel Drawn" for "Fuel Pumped".)

Import — click "Import Excel" and select a .xlsx file matching the export template. Validation:
  • Header row (case-insensitive, order-enforced, aliases accepted)
  • Essential fields: Date (YYYY-MM-DD), Start KM, End KM, End Time, Places Visited
  • Start Time optional — if empty but End Time + Distance are present it is auto-estimated (tiered speed, ceil 5 min) and saved as HH:MM; if End Time is empty the row is rejected; if distance <= 0 the Start stays ""
  • End KM >= Start KM, integer KM values
  • Private / Official restricted to Official or Private (list values)
  • No KM range overlap with existing trips on the same date
  • Pagination rules (4 days / 13 trips / month)

Any validation failure aborts with a row-numbered error report and no writes. On success, trips are appended chronologically with deduplication (same date|start|end is upsert — estimated Start overwrites). Back-dated insertions trigger automatic page renumber.`,
  },
  {
    id: 'sheet-pull',
    title: '14. Import from Google Sheet — Pull (Buffer Sheet)',
    group: 'Data Exchange',
    content: `The Buffer Sheet that QuickTrip Mobile writes to can be pulled directly without downloading Excel.

Steps:
  1. In All Trips Master Table header, click "Import from Google Sheet"
  2. First click prompts for Sheet URL/ID and Apps Script Web App URL (same values as QuickTrip Mobile Settings)
  3. Dialog probes GET scriptUrl?action=allRows and shows "Connected — N rows" or an error hint "Deploy as Anyone with link"

On Pull, the app fetches all rows and compares by Odo Key (date|start|end integer):
  • New — odo not in DB, checked by default
  • Changed — same odo but different places/time/fuel/type, unchecked with amber diff (e.g., places: A→B)
  • Skipped — exact duplicate

Empty Start Time with End Time + Distance is auto-estimated before diff, so Changed may show start: -→08:50.

Preview modal lists New above Changed, both with select-all checkboxes. Confirm is blocked until at least one row is checked and overlap/pagination pre-flight passes. Selected rows are imported via the same pipeline, then the earliest newly added trip is focused and all imported rows flash cyan.

Manual pull only; last successful pull time is stored as mobile.lastSheetPullAt and shown under the header.

Header directions: Import from Excel | Export to Excel | Import from Google Sheet | Export to Google Sheet — Import pulls Buffer → DB, Export pushes DB → Buffer (see section 15).`,
  },
  {
    id: 'sheet-push',
    title: '15. Export to Google Sheet — Push (atomic rewrite, Preserve unimported)',
    group: 'Data Exchange',
    content: `Inverse of Pull (section 14). Click "Export to Google Sheet" in All Trips Master Table header to rewrite the Buffer Sheet with all DB Trips plus preserved pending mobile rows.

Steps:
  1. Fetch: GET scriptUrl?action=allRows → filter valid rows, dedupe by Odo Key (first occurrence wins)
  2. Preserve: valid buffer rows whose Odo Key not in DB are kept; same Odo Key is overwritten by DB version (DB wins)
  3. Payload: [...DB rows sorted date ASC → start_km ASC, ...preserved in original buffer order at bottom]
  4. Proxy: POST scriptUrl?action=rewriteSheet with LockService — atomic; if lock fails or header validation fails, sheet is left untouched
  5. Preview modal shows counts: DB rows N | Preserved M | Overwriting K | Invalid ignored X

On success: toast "Exported — N rows (+M preserved)" and mobile.lastSheetPushAt is persisted.
On failure: toast "Sheet not modified: <error>" and Settings modal stays open.

Requires redeployed Apps Script bound to Buffer Sheet with POST rewriteSheet and deployed as "Anyone with link".`,
  },
  {
    id: 'sheet-linking',
    title: '16. How to Link Google Sheet (Buffer Sheet)',
    group: 'Setup & Manuals',
    content: `Quick method — add a dummy record first:
  1. Click "Export Excel" in All Trips header to download the template .xlsx with correct headers
  2. Open the file in Google Sheets (File → Import → Upload) — this gives you the exact header row
  3. Rename the tab to exactly "All Trips" (case/spaces matter)
  4. Delete the dummy data rows, keep the header row
  5. Freeze row 1: View → Freeze → 1 row

This avoids header-order mistakes that cause "Header row mismatch" errors.

Manual method — paste headers by hand:
  1. Create Sheet at sheets.google.com → Blank spreadsheet
  2. Rename tab to exactly "All Trips"
  3. Row 1 = these 10 headers in this exact order:

     Date | Start KM | End KM | Distance | Start Time | End Time | Private / Official | Places Visited | Fuel Pumped | Fuel Order No

  4. Freeze row 1: View → Freeze → 1 row

Deploy the Sheet Proxy:
  1. Extensions → Apps Script → paste quicktrip-mobile/apps-script/Code.gs → Save
  2. Deploy → New deployment → Web App
  3. Execute as: Me (Sheet owner)
  4. Who has access: Anyone with the link
  5. Authorize → copy the Web App URL (this is your scriptUrl)

Wire it to the app:
  1. Copy the Sheet URL (browser bar) — ID extracted automatically via /d/ID/
  2. Open All Trips → Sheet Settings (gear icon) → paste both URLs
  3. Probe shows "Connected — N rows" — you're done
  4. Optionally: create config/sheet.local.json from config/sheet.example.json (gitignored)

Verify: open scriptUrl?action=allRows in browser → should show {"rows":[]}. If "Header row mismatch", fix row 1.

Troubleshooting: see docs/manuals/user-setup.md §8 for 401/403 Deploy hints.`,
  },
  {
    id: 'mobile-setup',
    title: '17. How to Set Up Mobile Webpage / PWA',
    group: 'Setup & Manuals',
    content: `File roles:
  • mobile_app_public.html — tracked public template (SCRIPT_URL_DEFAULT = ""), safe to push to GitHub
  • Mobile_with_url_private.html — gitignored private build with your URL hard-coded; copy this to phone

Build the private file:
  1. After filling config/sheet.local.json (see section 16), run:
     npm run build:mobile
  2. Or run the PowerShell service script (see section 19 below) — it builds mobile for you
  3. Verify: open the private HTML in desktop browser → View Source → should contain const SCRIPT_URL_DEFAULT = "https://script.google.com/…/exec"

Copy to phone:
  • USB cable: copy file, open with Chrome
  • Google Drive / OneDrive: upload → open Drive app → Open with Chrome
  • Nearby Share / Bluetooth / Telegram Saved Messages / Email to yourself
  • QR trick (offline): python -m http.server 8000 on laptop → fetch via http://<laptop-ip>:8000/ on same Wi-Fi

Install and run:
  1. In Chrome on Android, open the private HTML file
  2. Allow any one-time permission for the Script URL
  3. Chrome menu → Add to Home Screen → confirm — icon launches standalone (no browser bar)
  4. First load fetches GET ?action=last10 to seed Start KM from sheet's last rows
  5. Offline trips queue in IndexedDB and auto-flush on online / visibilitychange

If you used the public template instead, open it → Settings → paste Script URL → Save. Private file needs no paste.

To update URL later: edit config/sheet.local.json + npm run build:mobile + recopy to phone.`,
  },
  {
    id: 'auth-roles',
    title: '18. Auth Roles (Landing, Super Admin)',
    group: 'Setup & Manuals',
    content: `System is single-operator — Super Admin (Neranjan) only.

Unauthenticated visitors see only Landing:
  • Super Admin password login (username Neranjan, hashed, forced change on first login)
  • TOTP (Google Authenticator) — required on every login after enrollment
  • Single-use Recovery Code at /recovery — bypasses password + TOTP, forces immediate password reset

All ledger routes are behind an authenticated Landing Gate except Landing and /recovery. Help at /help is authenticated and linked from the header (?) icon.

Successful Trip save shows a "Trip Added" toast (~2s) then redirects to Dashboard. Import success shows "N trips added" then redirects.`,
  },
  {
    id: 'calendar-leaves',
    title: '19. Calendar — Holiday Calendar, Leaves, Trip Badges & Expanded Month',
    group: 'Calendar & Leaves',
    content: `Holiday Calendar 2024–2027 — Saturdays and Sundays are Bank holidays, plus CBSL Poya / Bank / Public / Mercantile holidays from lib/sriLankanHolidays.ts. Day cells are tinted by kind (weekend slate, Poya rose, Mercantile amber, public teal, personal leave sky).

Trip badges inside each date cell:
  • Official trips → black badge (white text) Xn — e.g., X1, X2
  • Private trips → orange badge (white text) Xm
  • Both appear side-by-side at bottom-right; even a single trip shows X1 (no more ×N)
  • Fuel pumped → small red dot top-right; hover shows litres

Month tile:
  • Header shows trip-days count and a ⛶ Maximize button
  • Click ⛶ to open an expanded popup for that month only

Expanded month popup:
  • Large min-h-[108px] grid — same holiday/leave tinting, but each date lists its trips inline: "24km · Colombo → Kandy" plus ⛽ 12.0L ORD-123 when fuel was pumped
  • Private trips show an orange dot (●) before the route inside the cell and in the summary table
  • Right-click any dated cell with trips → context menu Show Trip Details → opens All Trips focused on that date (also works inside the popup)
  • Below the grid: Trip Summary table Date | Day | Route | Km | Fuel | Order No | Type (type badge black/orange with dot) + month totals

Leave (manual-only):
  • Click any date → dialog shows Mark as Leave or, if already leave, Clear Leave. Leave is never auto-created from holidays or import.
  • Optional note max 200 chars; 6 preset pills (Annual, Casual, Medical, Duty, Duty Overseas, Private Overseas) fill the box on click; Clear removes the row and dispatches fleetledger:data-changed.
  • All Leaves are Off-Days (priority Leave > Poya > Mercantile > Public > Bank > Weekend).

Header summaries:
  • Trips on Off-Days — grouped by date (Date · DayOfWeek · Reason) with per-trip Start/End KM, Distance, Type, Places, Fuel and per-date total km.
  • No-Trip Working Days — every Working Day (Mon–Fri, not holiday, not leave) with zero trips inside an ODO-Continuous Segment; dates strictly inside a Trip-to-Trip ODO Gap (end_km ≠ next start_km on different dates) are hidden; range is firstTripDate..lastTripDate clamped to 2024..2027.

Leave History — persistent card below months: table Date | Day | Holiday | Note with Edit / Clear; Year filter All | 2024..2027 (default current year), sorted date DESC.`,
  },
  {
    id: 'all-trips-daytype',
    title: '20. All Trips — Day Type Colors & Table Layout',
    group: 'Calendar & Leaves',
    content: `Day Type column (All Trips Master Table) is color-coded with a dot icon:
  • Sat/Sun or any holiday (Mercantile/Bank/Public) — RED bg-red-100 border-red-300 + red dot
  • Poya (isPoya) — YELLOW bg-yellow-100 border-yellow-300 + yellow dot (takes priority over RED)
  • Leave — ORANGE bg-orange-100 border-orange-300 + orange dot
  • Weekday (Mon–Fri, not holiday/leave) — light GREEN bg-green-50 border-green-200 + green dot

Private indication:
  • Type [Official/Private] column removed from All Trips table; Private trips are signaled solely by orange row background bg-orange-200 (RED gap cell bg-red-100 wins on Start KM, dark-blue text layers when fuel pumped). Use filter "All Types / Official / Private" or Insert/Gap-Fill dialogs to set type.

Layout fix:
  • Route column reduced 22% → 6% narrow (w-[6%], −20% from 8%, text-xs) and table min-w 1080→1020 on mobile; ⋯ menu column fixed w-10 min-w-[40px] so it stays fully visible; desktop stays w-full lg:min-w-0 lg:overflow-x-hidden so only vertical scroll appears and last columns (Pumped/Order No/Pos./In-Tank/Econ/Balance/Page/⋯) stay visible without horizontal scroll.`,
  },
  {
    id: 'ps1-service',
    title: '21. PowerShell Service Script (start-service.ps1)',
    group: 'Setup & Manuals',
    content: `The start-service.ps1 script automates build, deploy, and persistent service on Windows. Run it once and the app starts automatically at logon.

Prerequisites:
  • Node 20+ installed (node -v)
  • Run PowerShell as Administrator (right-click → Run as Administrator)

Usage:
  1. Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
  2. .\\start-service.ps1

On start it prints: Web Service start process started at HH:mm:ss on dd-MM-yyyy (cyan, e.g., Web Service start process started at 09:14:22 on 15-09-2026) — echoed in the calling cmd so you see the click time even after the elevated PowerShell window closes.

What it does:
  1. Stops any old local_runningchart (legacy LocalRunningCharterService) task and kills processes on :8082 (local_runningchart.exe)
  2. Runs npm run build (retries 3x on contention)
  3. Builds the mobile private file: npm run build:mobile — reads $ScriptUrl or config/sheet.local.json
  4. Creates/updates wrapper local_runningchart.exe (copy of node.exe so Task Manager shows local_runningchart) and registers Scheduled Task local_runningchart at logon (NT AUTHORITY\\SYSTEM, restart-on-failure x3)
  5. Starts the task, waits 3s, opens http://localhost:8082

Configuring the Script URL in the PS1:
  Open start-service.ps1 and set line 13: $ScriptUrl = "https://script.google.com/…/exec"
  This value overrides config/sheet.local.json via $env:SCRIPT_URL.

Managing the service:
  • Stop: Stop-ScheduledTask -TaskName local_runningchart (legacy: LocalRunningCharterService) or .\\stop-service.ps1
  • Or: Task Scheduler GUI → find local_runningchart → delete
  • Process shows as local_runningchart.exe (not node.exe) in Task Manager
  • After stop, port 8082 is free
  • Re-run .\\start-service.ps1 after git pull to update

The script preserves runningcharter.db and browser localStorage fleetledger_* — these are never deleted.`,
  },
];

const groups = ['Core Concepts', 'Ledger & Fuel', 'Operations & Gaps', 'Calendar & Leaves', 'Data Exchange', 'Setup & Manuals'];

function highlight(text: string, query: string) {
  if (!query) return text;
  const esc = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${esc})`, 'gi'));
  return parts.map((p, i) =>
    p.toLowerCase() === query.toLowerCase() ? (
      <mark key={i} className="bg-amber-200 px-0.5 rounded">
        {p}
      </mark>
    ) : (
      <span key={i}>{p}</span>
    ),
  ) as unknown as string;
}

function renderContent(content: string, q: string) {
  const lines = content.split('\n');
  const blocks: React.ReactNode[] = [];
  let currentPara: string[] = [];

  const flushPara = () => {
    if (currentPara.length > 0) {
      const text = currentPara.join(' ');
      blocks.push(
        <p key={blocks.length} className="mb-3 last:mb-0">
          {q ? (highlight(text, q) as unknown as React.ReactNode) : text}
        </p>,
      );
      currentPara = [];
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') {
      flushPara();
    } else if (trimmed.startsWith('• ')) {
      flushPara();
      const text = trimmed.slice(2);
      blocks.push(
        <div key={blocks.length} className="flex gap-2 mb-1.5">
          <span className="text-telemetry-cyan mt-0.5 shrink-0">•</span>
          <span>{q ? (highlight(text, q) as unknown as React.ReactNode) : text}</span>
        </div>,
      );
    } else if (/^\d+\.\s/.test(trimmed)) {
      flushPara();
      const m = trimmed.match(/^(\d+)\.\s+(.*)/);
      if (m) {
        blocks.push(
          <div key={blocks.length} className="flex gap-3 mb-2">
            <span className="text-xs font-bold text-telemetry-cyan bg-slate-100 rounded-full w-5 h-5 flex items-center justify-center shrink-0 mt-0.5">
              {m[1]}
            </span>
            <span className="flex-1">{q ? (highlight(m[2], q) as unknown as React.ReactNode) : m[2]}</span>
          </div>,
        );
      }
    } else if (trimmed.startsWith('  • ')) {
      flushPara();
      const text = trimmed.slice(4);
      blocks.push(
        <div key={blocks.length} className="flex gap-2 mb-1 ml-6">
          <span className="text-on-surface-variant mt-0.5 shrink-0">-</span>
          <span>{q ? (highlight(text, q) as unknown as React.ReactNode) : text}</span>
        </div>,
      );
    } else {
      currentPara.push(trimmed);
    }
  }
  flushPara();

  return <div className="text-sm leading-relaxed text-on-surface-variant space-y-1">{blocks}</div>;
}

export default function HelpPage() {
  const [q, setQ] = useState('');

  const norm = (s: string) => s.toLowerCase();
  const filtered = useMemo(() => {
    if (!q.trim()) return sections;
    const qq = norm(q.trim());
    return sections.filter((s) => norm(s.title).includes(qq) || norm(s.content).includes(qq));
  }, [q]);

  const byGroup = useMemo(() => {
    const m = new Map<string, Section[]>();
    for (const g of groups) m.set(g, []);
    for (const s of filtered) m.get(s.group)?.push(s);
    return m;
  }, [filtered]);

  return (
    <ProtectedRoute>
      <div className="max-w-6xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-on-surface">Help — Running Chart Guide</h1>
            <p className="text-sm text-on-surface-variant">22 sections across 6 groups. Search or browse the table of contents.</p>
          </div>
          <Link href="/" className="text-sm font-medium text-telemetry-cyan hover:underline shrink-0">
            ← Back to Dashboard
          </Link>
        </div>

        <div className="mb-5 flex items-center gap-3">
          <div className="relative flex-1 max-w-xl">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search help — try sheet, fuel, gap, mobile, ps1…"
              className="w-full rounded-lg border border-rule-line bg-paper-sheet px-3 py-2.5 pr-9 text-sm outline-none focus:border-telemetry-cyan focus:ring-1 focus:ring-telemetry-cyan"
              aria-label="Search help"
            />
            {q && (
              <button onClick={() => setQ('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-zinc-400 hover:bg-zinc-100" aria-label="Clear search">
                ×
              </button>
            )}
          </div>
          <span className="text-xs text-on-surface-variant whitespace-nowrap">
            {filtered.length}/{sections.length} sections{q ? ` for "${q}"` : ''}
          </span>
        </div>

        <div className="flex flex-col lg:flex-row gap-6">
          <nav className="lg:w-56 shrink-0 lg:sticky lg:top-4 self-start bg-paper-sheet border border-rule-line rounded-xl shadow-sm p-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-3">On this page</p>
            {groups.map((g) => {
              const list = byGroup.get(g) ?? [];
              if (list.length === 0) return null;
              return (
                <div key={g} className="mb-3 last:mb-0">
                  <p className="text-xs font-semibold text-on-surface mb-1">{g}</p>
                  <ul className="space-y-0.5">
                    {list.map((s) => (
                      <li key={s.id}>
                        <a href={`#${s.id}`} className="block text-xs text-telemetry-cyan hover:underline truncate">
                          {q ? (highlight(s.title, q) as unknown as React.ReactNode) : s.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
            {filtered.length === 0 && <p className="text-xs text-on-surface-variant">No matches.</p>}
          </nav>

          <div className="flex-1 min-w-0">
            {filtered.length === 0 ? (
              <div className="rounded-xl border border-dashed border-rule-line p-8 text-center text-sm text-on-surface-variant">
                No sections match "{q}". Try a different term or clear search.
              </div>
            ) : (
              <div className="bg-paper-sheet border border-rule-line rounded-xl shadow-sm divide-y divide-rule-line">
                {groups.map((g) => {
                  const list = byGroup.get(g) ?? [];
                  if (list.length === 0) return null;
                  return (
                    <div key={g}>
                      <div className="px-6 py-2.5 bg-paper-gutter">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">{g}</p>
                      </div>
                      {list.map((s) => (
                        <section key={s.id} id={s.id} className="p-6 scroll-mt-20">
                          <h2 className="text-sm font-bold tracking-tight text-on-surface mb-3">
                            {q ? (highlight(s.title, q) as unknown as React.ReactNode) : s.title}
                          </h2>
                          {renderContent(s.content, q)}
                        </section>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}

            <p className="mt-6 text-xs text-on-surface-variant">
              Domain glossary: Book, Page, Trip, Vehicle, Book Opening, Fuel Economy/Position/In-Tank/Drawn/Consumed/Closing Balance, Adjusted Fuel Economy, Page-Wide Trip Sequence, Integer KM, Continuity Alert, All Trips Workbook, Ledger Full-Width Stack, Super Admin, TOTP, Recovery Code, Landing, Help Page (searchable), Trip Import with Estimated Start Time auto-fill, Continuity Break, Transposed Side 2, Focused Trip, Gap Fill / Insert After / Remove & Shift / Reverse Gap Fill, Sheet Pull Import, Sheet Push (Export to Google Sheet), Push Preview, Sheet Settings (mobile.lastSheetPullAt/mobile.lastSheetPushAt), Import Preview, Sheet Proxy (GET allRows/last10, POST appendTrip/rewriteSheet + LockService), Digital Vehicle Cluster, Fuel Economy Trend, Monthly Distances Tile, Off-Day/Working Day, LeaveDay (manual-only), Leave History, ODO Gap Period/ODO-Continuous Segment, Trips-On-OffDays & No-Trip Working Days Summaries, All Trips Day Type colors (RED/YELLOW/ORANGE/GREEN). Full manuals: <Link href="/docs/manuals/user-setup.md" className="underline">docs/manuals/user-setup.md</Link> + quicktrip-mobile/README.md.
            </p>
          </div>
        </div>
      </div>
    </ProtectedRoute>
  );
}
