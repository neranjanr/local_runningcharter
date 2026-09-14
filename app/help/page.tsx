'use client';

import React from 'react';
import Link from 'next/link';
import { ProtectedRoute } from '@/components/ProtectedRoute';

const sections = [
  {
    id: 'book-opening',
    title: '1. Book Opening',
    content: `Book Opening seeds Page 1 with Opening KM (integer) and Opening Fuel (1 decimal, default 10 L). Enter it in Vehicle Settings when the Book starts (e.g., 2026-01-01 at 50,000 km). It is re-editable: when back-dated Pages are inserted before the earliest date, the Opening is re-applied to the new earliest Page and fuel balances are recalculated forward from the earliest Page. This keeps older histories correctly capitalized without mutating dates.`,
  },
  {
    id: 'reciprocals',
    title: '2. Reciprocal Calculations (Start+Distance=End)',
    content: `Integer KM Rule: All odometer values (Start KM, End KM, Trip Distance, Page Start/End KM, Day Start/End KM) are displayed as integers with no decimals everywhere (UI tables, toasts, Excel KM columns). Decimal KM input is accepted but rounded on blur/save via Math.round. Excel KM columns use integer format (numFmt '0'). Consumed Fuel and Closing Balance remain 1 decimal for maths (Consumed = Distance / Economy rounded 1 dec, Balance = Position + In-Tank + Drawn − Consumed rounded 1 dec). Reciprocal Calculations: Odometer fields follow Integer KM rule. Distance = round(End − Start). Entering Start KM + Distance auto-derives End KM, and vice versa, both integer-rounded. This mirrors the paper book's integer odometer and prevents manual math errors.`,
  },
  {
    id: 'time-estimation',
    title: '3. Time Estimation (End − Distance/20, ceil 5 min)',
    content: `Estimated Start Time = End Time − (Distance / 20 km/h) ceiled to nearest 5 minutes: estimatedMinutes = ceil((distance/20)*60 /5)*5. Auto-fills only when Start Time is empty and End Time + Distance are present. The explicit "Auto" button recomputes even when Start Time is already filled, so edits to distance or End Time can be re-estimated. Manual override is always allowed and never auto-clobbered. End Time defaults to now (present time) on form load and remains overrideable to any HH:MM; Start Time may be left empty (null/"") and the Trip still saves.`,
  },
  {
    id: 'all-trips-workbook',
    title: '4. All Trips Workbook (Export & Import)',
    content: `Export: Click "Export Excel" in the All Trips table header to download a .xlsx file with all trip records. The file uses the "All Trips" sheet with columns: Date, Start KM, End KM, Distance, Start Time, End Time, Private / Official, Places Visited, Fuel Pumped, Fuel Order No (header "Type" still accepted as alias).\n\nImport: Click "Import Excel" and select a .xlsx file matching the export template. The import validates:\n• Header row (case-insensitive, order-enforced; "Type" accepted as alias for "Private / Official", "Fuel Drawn" for "Fuel Pumped")\n• Essential fields: Date (YYYY-MM-DD), Start KM, End KM, End Time, Places Visited\n• End KM ≥ Start KM, integer KM values\n• Private / Official restricted to Official or Private (list values)\n• No KM range overlap with existing trips on the same date\n• Pagination rules (4 days / 13 trips / month)\n\nAny validation failure aborts with a row-numbered error report and no writes. On success, trips are appended chronologically with deduplication. Back-dated insertions trigger automatic page renumber.`,
  },
  {
    id: 'inline-editing',
    title: "5. Inline Editing (All Trips Table)",
    content: `Any trip in the All Trips Master Table can be edited inline. Click on Start KM, End KM, Fuel Pumped, Fuel Order No, or Places Visited cells to edit. Changes are highlighted and a confirmation dialog appears before saving.\n\n• Start KM / End KM: Integer values. Changing either auto-recalculates Trip Distance.\n• Fuel Pumped: Decimal litres (1 decimal).\n• Fuel Order No / Places Visited: Free text.\n\nAfter save, page end values and fuel balances are recalculated if KM changed.`,
  },
  {
    id: 'pagination-rules',
    title: '6. Pagination Rules (4 days / 13 trips / month rollover)',
    content: `Physical Book constraints are enforced strictly: maximum 4 distinct Dates per Page, maximum 13 Trips per Day Group, and a new calendar month always forces a new Page. Violations during manual entry or import pre-flight are reported as row-numbered errors and block any write until fixed. This keeps digital pagination identical to the paper book.`,
  },
  {
    id: 'fuel-formula',
    title: '7. Fuel Formula (Position + In-Tank + Drawn − Consumed = Closing)',
    content: `Per Day Group, Closing Balance = Position + In-Tank Fuel + Drawn − Consumed, rounded to 1 decimal. Position is the previous Day Group's Closing Balance (Page N+1 Day 1 inherits Page N's final Closing). In-Tank defaults to 0 per Day Group and is editable only on the first Trip of the day (distinguishing tank stock from pumped fuel). Drawn is summed Fuel Pumped per day with Fuel Order No. Consumed = Distance / Fuel Economy (economy inherits forward until overridden, fallback 10.5 km/L). Economy propagation and fuel arithmetic are tested via the ledger fuel engine seam.`,
  },
  {
    id: 'adjusted-economy',
    title: '8. Adjusted Fuel Economy (±0.1 step, badge, revert)',
    content: `Fuel Economy for a Day Group can be adjusted by stepping ±0.1 from the existing value using the number input's up/down arrows (or typing). Values are clamped 0.1–50 km/L and rounded to 1 decimal. An "Adjusted" badge appears when the economy is an explicit override (economySource === 'explicit'). To revert to the inherited value, type the inherited number (e.g., the value shown with "(Inh.)") and the override is automatically deleted, removing the badge. Alternatively, click the × clear button next to the badge. The overridden economy propagates forward to subsequent Day Groups until the next explicit override, recomputing Consumed and Closing Balance immediately.`,
  },
  {
    id: 'renumber',
    title: '9. Retroactive Renumber (Chronological 1..N)',
    content: `When a Trip or import date precedes the earliest Page, all Pages are sorted chronologically by date, renumbered 1..N sequentially, and page_number/page_id plus Trip.page_id are cascaded; dates are never mutated and pagination constraints (4/13/month) are preserved. Example: Book starts 2026-01-01 Page 1 at 50,000 km, later entry for 2025-01-01 becomes Pages 1–2 and the existing Page renumbers (no gap). Book Opening re-edit triggers recalculation of fuel balances forward from the earliest Page only. Continuity invariants hold after renumber: Page N End KM = Page N+1 Start KM and End Fuel = next Fuel Position (including In-Tank).`,
  },
  {
    id: 'continuity-alerts',
    title: '10. Continuity Alerts (RED/AMBER gap legend)',
    content: `Two-color alerts surface odometer and fuel discontinuities at Page-to-Page and Trip-to-Trip levels. RED (bg-red-100) indicates a KM Gap: Page N End KM ≠ Page N+1 Start KM, or a Trip's End KM ≠ next Trip's Start KM (chronological sort). AMBER/ORANGE (bg-amber-100) indicates a Fuel Gap: Page N End Fuel Balance ≠ Page N+1 Start Fuel Balance, or a Day Group Closing Balance ≠ next Day's Position (including In-Tank).\n\nDashboard: Shows a compact alert bar ("Continuity Gaps Detected") with a "View All Trips" link. Click to see full gap details in the All Trips table.\n\nAll Trips / Ledger: Shows the full detailed alert with page/trip numbers, expected vs actual values, color-coded RED/AMBER, and "Jump to Page/Trip" links. The banner survives refresh and only clears when gaps are fixed.`,
  },
  {
    id: 'auth-roles',
    title: '11. Auth Roles (Landing, Super Admin, Allow-list)',
    content: `Unauthenticated visitors see only Landing — a login page showing Super Admin password login (username Neranjan, hashed SupAd@2000, forced change on first login) and Google SSO. Google SSO is gated by the Super Admin's Gmail allow-list managed at /settings/access (one or many addresses, CRUD only for Super Admin). Allowed Gmail users can SSO and see Dashboard, Ledger, Trips, and Help. Non-allowed Gmail is rejected with "Not authorized — contact admin" and stays on Landing. All ledger routes are behind an authenticated guard except Landing; Help at /help is authenticated and linked from the header (?) icon. Successful Trip save shows a "Trip Added" toast (~2s) then redirects to Dashboard; import success shows "N trips added" then redirects.`,
  },
  {
    id: 'private-bold',
    title: '12. Private Trip — Bold Row',
    content: `Any Trip with Type = Private is rendered as a fully bold row in both the Ledger (Side 1 Trips Log, per Page) and the All Trips Master Table, in addition to the orange background (bg-orange-200). The RED KM-gap highlight (bg-red-100) on a gapped Start KM cell takes precedence over the orange but the bold weight is retained. Print preserves bold (font-weight 600) so the paper Book and PDF match. Change Type via inline edit in All Trips (click Type cell → select Official/Private) — the row toggles bold immediately.`,
  },
  {
    id: 'gap-ops',
    title: '13. Gaps — Fill Gap vs Insert After vs Remove & Shift (All Trips only)',
    content: `KM Gaps surface as RED badges/alerts where Trip N End KM ≠ Trip N+1 Start KM (chronological by date then Start KM) and where Page N End KM ≠ Page N+1 Start KM. Two shift operations and one gap-fill exist — all in All Trips Master Table only (Ledger is read-only and shows only the bold Private rows).\n\n• Fill Gap (no shift): When a KM gap exists (e.g., 100-110 → 120-130, gap 110-120), the successor row's Start KM cell shows a "+ Fill Gap 10 km" chip (RED) and the predecessor row's ⋯ menu shows "Fill Gap (110→120)". Clicking opens a dialog with Start KM = 110, End KM = 120, Distance = 10, Date = predecessor Date auto-filled (editable, clamped to predecessor Date … successor Date). Fill Places Visited, Times and confirm — the dialog validates (Places non-empty, End ≥ Start, End Time required) and on save the gap closes with NO downstream shift. Use this when the gap is missing history.\n\n• Insert After (shift +Δ): Row ⋯ menu → "Insert After" on any Trip. Dialog defaults Date = that row's Date (editable within [that date … next date]). Enter Start/End KM (distance auto-derived as End−Start); other fields as for a normal Trip. Confirmation modal shows "Insert Trip — Shift N trips by Δ km?" with a before→after preview of the first 3 downstream trips (+M more). On Confirm, the new Trip is inserted at that chronological position and every later Trip's Start/End KM is increased uniformly by Δ (their own Distance and fuel pumped stay frozen). Page start/end KM and the fuel chain (Position + In-Tank + Drawn − Consumed = Balance) are recomputed forward; if 13 trips/day or 4 days/page or month rollover would be breached, a new Page is auto-created via the same pagination engine that governs New Trip.\n\n• Remove & Shift (shift −Δ): Row ⋯ menu → "Remove & Shift" (distinct from plain "Delete" which just deletes and may leave a new gap). Removes the selected Trip and shifts every later Trip down by Δ = removed.end − removed.start (−Δ). Confirmation shows "Remove Trip — Shift N trips by −Δ km?" with the same 3-row preview. Empty Pages are retained as "No trips" but patched for continuity; plain Delete remains for discarding without shifting.\n\nAll three show Cancel/Confirm; Confirm toasts the count and re-renders continuity alerts (RED/AMBER) immediately. Fuel In-Tank/Drawn values are not shifted — only KMs move — so Closing Balance updates downstream automatically. Integer KM rounding (Math.round, numFmt '0') applies on save.`,
  },
  {
    id: 'focused-trip',
    title: '14. Focused Trip Retention',
    content: 'After Insert After, Gap Fill, Remove & Shift, or plain Delete in All Trips Master Table, focus is kept on the affected row. Insert/Gap Fill -> the newly added trip row is highlighted (ring + cyan flash) and scrolled to center. Delete/Remove & Shift -> the predecessor row (chronologically previous date||start_km) is focused; if the earliest trip was deleted, the successor that slid into its place is focused. If the target row is hidden by the current Search, Month, or Type filter, the filter is cleared to All + date ascending and a toast Filter cleared to show focused row appears before scrolling. The highlight fades after ~3.2s. Bulk Sheet Pull import (section 15) focuses the earliest newly added trip and flashes all imported rows.',
  },
  {
    id: 'sheet-pull',
    title: '15. Import from Google Sheet — Pull (Buffer Sheet)',
    content: 'The Buffer Sheet that QuickTrip Mobile writes to can be pulled directly without downloading Excel. In All Trips Master Table header click Import from Google Sheet ☁️↓ — first click prompts for Sheet URL/ID and Apps Script Web App URL (same values as QuickTrip Mobile Settings, stored locally as mobile.sheetId / mobile.scriptUrl). The dialog probes GET scriptUrl?action=allRows and shows Connected — N rows or an error hint Deploy as Anyone with link.\n\nOn Pull, the app fetches all rows, compares by Odo Key (date|start|end integer via getOdoKey) — New (odo not in DB, checked by default), Changed (same odo but different places/time/fuel/type, unchecked with amber diff like places: A->B), and Skipped (exact duplicate). Preview modal lists New above Changed, both with select-all checkboxes; Confirm is blocked until at least one row is checked and until overlap/pagination pre-flight (same as Import Excel) passes. Selected rows are imported via the same pipeline (importTripsFromWorkbook + bulk /api/import with localStorage fallback), then the earliest newly added trip is focused per section 14 and all imported rows flash cyan. Manual pull only; last successful pull time is stored as mobile.lastSheetPullAt and shown under the header and as tooltip on the button. Copy/paste a Sheet URL like https://docs.google.com/spreadsheets/d/... — the ID is extracted automatically.\n\nHeader has four distinct directions: Import from Excel | Export to Excel | Import from Google Sheet ☁️↓ | Export to Google Sheet ☁️↑ — Import pulls Buffer → DB, Export pushes DB → Buffer (see 16).',
  },
  {
    id: 'sheet-push',
    title: '16. Export to Google Sheet — Push (atomic rewrite, Preserve unimported)',
    content: 'Inverse of Pull (15). Click Export to Google Sheet ☁️↑ in All Trips Master Table header to rewrite the Buffer Sheet with all DB Trips plus preserved pending mobile rows. Steps:\n• Fetch: GET scriptUrl?action=allRows → filter valid rows (date && places_visited && end_time && isFinite start_km/end_km) same as Pull, dedupe within buffer by Odo Key (first occurrence wins).\n• Preserve: valid buffer rows whose Odo Key (date|start_km|end_km integer via getOdoKey) not in DB are kept; same Odo Key is overwritten by DB version (DB wins). Invalid rows ignored and counted as Invalid ignored.\n• Payload: [...DB rows sorted date ASC → start_km ASC, ...preserved in original buffer order at bottom]. DB edits of same Odo Key overwrite the sheet copy. Integer KM kept as numFmt \'0\', Fuel Pumped as \'0.0\'.\n• Proxy: POST scriptUrl?action=rewriteSheet body {action:\'rewriteSheet\', rows} (alias pushAll). Apps Script uses LockService.getDocumentLock().tryLock(30000) — if lock fails or header validation (ensureHeaders_) fails it returns {ok:false} leaving sheet untouched (atomic). On success it does single batch sh.clear() + header ALL_TRIPS_HEADERS + setValues(rows) + number formats; large payloads should be chunked if >5k rows.\n• Preview: Push Preview modal before write shows counts DB rows N | Preserved M (unimported) | Overwriting K | Invalid ignored X, expandable preserved-row list (date | start→end | places), warning "Sheet will be cleared and rewritten". Confirm is disabled until sheetId && scriptUrl configured — blocked with "Blocked by: Settings" banner; Cancel closes without write. On success toast Exported — N rows (+M preserved) and persist mobile.lastSheetPushAt shown as Last Sheet push: subtitle and button tooltip; on failure toast Sheet not modified: <error> and Settings modal stays open. Requires redeployed Apps Script bound to Buffer Sheet with POST rewriteSheet and deployed as Anyone with link (same as Pull), otherwise fetch probe fails with hint.',
  },
];

export default function HelpPage() {
  return (
    <ProtectedRoute>
      <div className="max-w-4xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-on-surface">Help — Running Chart Guide</h1>
            <p className="text-sm text-on-surface-variant">
              How Book Opening, reciprocals, time estimation, All Trips export/import, inline editing, pagination, fuel, adjusted economy, continuity alerts, renumber, and auth roles work.
            </p>
          </div>
          <Link href="/" className="text-sm font-medium text-telemetry-cyan hover:underline">
            ← Back to Dashboard
          </Link>
        </div>

        <div className="bg-paper-sheet border border-rule-line rounded-xl shadow-sm divide-y divide-rule-line">
          {sections.map((s) => (
            <section key={s.id} id={s.id} className="p-6">
              <h2 className="text-sm font-bold tracking-tight text-on-surface mb-2">{s.title}</h2>
              <p className="text-sm leading-relaxed text-on-surface-variant whitespace-pre-wrap">{s.content}</p>
            </section>
          ))}
        </div>

        <p className="mt-6 text-xs text-on-surface-variant">
          Domain glossary: Book, Page, Trip, Vehicle, Book Opening, Fuel Economy/Position/In-Tank/Drawn/Consumed/Closing Balance, Adjusted Fuel Economy, Page-Wide Trip Sequence, Integer KM, Continuity Alert, All Trips Workbook, Ledger Full-Width Stack, Super Admin, Allowed Email, Landing, Help Page, Trip Import, Estimated Start Time, Continuity Break, Transposed Side 2, Focused Trip, Sheet Pull Import, Sheet Push (Export to Google Sheet), Push Preview, Sheet Settings (mobile.lastSheetPullAt/mobile.lastSheetPushAt), Import Preview, Sheet Proxy (GET allRows/last10, POST appendTrip/rewriteSheet + LockService).
        </p>
      </div>
    </ProtectedRoute>
  );
}
