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
    content: `Book Opening seeds Page 1 with Opening KM (integer) and Opening Fuel (1 decimal, default 10 L). Enter it in Vehicle Settings when the Book starts (e.g., 2026-01-01 at 50,000 km). It is re-editable: when back-dated Pages are inserted before the earliest date, the Opening is re-applied to the new earliest Page and fuel balances are recalculated forward from the earliest Page. This keeps older histories correctly capitalized without mutating dates.`,
  },
  {
    id: 'reciprocals',
    title: '2. Reciprocal Calculations (Start+Distance=End)',
    group: 'Core Concepts',
    content: `Integer KM Rule: All odometer values (Start KM, End KM, Trip Distance, Page Start/End KM, Day Start/End KM) are displayed as integers with no decimals everywhere (UI tables, toasts, Excel KM columns). Decimal KM input is accepted but rounded on blur/save via Math.round. Excel KM columns use integer format (numFmt '0'). Consumed Fuel and Closing Balance remain 1 decimal for maths (Consumed = Distance / Economy rounded 1 dec, Balance = Position + In-Tank + Drawn − Consumed rounded 1 dec). Reciprocal Calculations: Odometer fields follow Integer KM rule. Distance = round(End − Start). Entering Start KM + Distance auto-derives End KM, and vice versa, both integer-rounded. This mirrors the paper book's integer odometer and prevents manual math errors.`,
  },
  {
    id: 'time-estimation',
    title: '3. Time Estimation (tiered speed, ceil 5 min)',
    group: 'Core Concepts',
    content: `Estimated Start Time = End Time − (Distance / speed) ceiled to nearest 5 minutes: speed tier <10 km→15 km/h, <20→20, <40→25, ≤60→30, >60→35; estimatedMinutes = ceil((distance/speed)*60 /5)*5. Auto-fills only when Start Time is empty and End Time + Distance are present. The explicit "Auto" button recomputes even when Start Time is already filled, so edits to distance or End Time can be re-estimated. Manual override is always allowed and never auto-clobbered. End Time defaults to now (present time) on form load and remains overrideable to any HH:MM; Start Time may be left empty (null/"") and the Trip still saves. During Excel/Sheet import, empty Start Time is auto-estimated from End Time + Distance and persisted (overwrite on same Odo Key); if End Time is empty the row is rejected; if distance ≤0 estimation returns null and Start stays "".`,
  },
  {
    id: 'pagination-rules',
    title: '4. Pagination Rules (4 days / 13 trips / month rollover)',
    group: 'Core Concepts',
    content: `Physical Book constraints are enforced strictly: maximum 4 distinct Dates per Page, maximum 13 Trips per Day Group, and a new calendar month always forces a new Page. Violations during manual entry or import pre-flight are reported as row-numbered errors and block any write until fixed. This keeps digital pagination identical to the paper book.`,
  },
  {
    id: 'fuel-formula',
    title: '5. Fuel Formula (Position + In-Tank + Drawn − Consumed = Closing)',
    group: 'Ledger & Fuel',
    content: `Per Day Group, Closing Balance = Position + In-Tank Fuel + Drawn − Consumed, rounded to 1 decimal. Position is the previous Day Group's Closing Balance (Page N+1 Day 1 inherits Page N's final Closing). In-Tank defaults to 0 per Day Group and is editable only on the first Trip of the day (distinguishing tank stock from pumped fuel). Drawn is summed Fuel Pumped per day with Fuel Order No. Consumed = Distance / Fuel Economy (economy inherits forward until overridden, fallback 10.5 km/L). Economy propagation and fuel arithmetic are tested via the ledger fuel engine seam.`,
  },
  {
    id: 'adjusted-economy',
    title: '6. Adjusted Fuel Economy (±0.1 step, badge, revert)',
    group: 'Ledger & Fuel',
    content: `Fuel Economy for a Day Group can be adjusted by stepping ±0.1 from the existing value using the number input's up/down arrows (or typing). Values are clamped 0.1–50 km/L and rounded to 1 decimal. An "Adjusted" badge appears when the economy is an explicit override (economySource === 'explicit'). To revert to the inherited value, type the inherited number (e.g., the value shown with "(Inh.)") and the override is automatically deleted, removing the badge. Alternatively, click the × clear button next to the badge. The overridden economy propagates forward to subsequent Day Groups until the next explicit override, recomputing Consumed and Closing Balance immediately.`,
  },
  {
    id: 'private-bold',
    title: '7. Private Trip — Bold Row',
    group: 'Ledger & Fuel',
    content: `Any Trip with Type = Private is rendered as a fully bold row in both the Ledger (Side 1 Trips Log, per Page) and the All Trips Master Table, in addition to the orange background (bg-orange-200). The RED KM-gap highlight (bg-red-100) on a gapped Start KM cell takes precedence over the orange but the bold weight is retained. Print preserves bold (font-weight 600) so the paper Book and PDF match. Change Type via inline edit in All Trips (click Type cell → select Official/Private) — the row toggles bold immediately.`,
  },
  {
    id: 'continuity-alerts',
    title: '8. Continuity Alerts (RED/AMBER gap legend)',
    group: 'Ledger & Fuel',
    content: `Two-color alerts surface odometer and fuel discontinuities at Page-to-Page and Trip-to-Trip levels. RED (bg-red-100) indicates a KM Gap: Page N End KM ≠ Page N+1 Start KM, or a Trip's End KM ≠ next Trip's Start KM (chronological sort). AMBER/ORANGE (bg-amber-100) indicates a Fuel Gap: Page N End Fuel Balance ≠ Page N+1 Start Fuel Balance, or a Day Group Closing Balance ≠ next Day's Position (including In-Tank).\n\nDashboard: Shows a compact alert bar ("Continuity Gaps Detected") with a "View All Trips" link. Click to see full gap details in the All Trips table.\n\nAll Trips / Ledger: Shows the full detailed alert with page/trip numbers, expected vs actual values, color-coded RED/AMBER, and "Jump to Page/Trip" links. The banner survives refresh and only clears when gaps are fixed.`,
  },
  {
    id: 'renumber',
    title: '9. Retroactive Renumber (Chronological 1..N)',
    group: 'Ledger & Fuel',
    content: `When a Trip or import date precedes the earliest Page, all Pages are sorted chronologically by date, renumbered 1..N sequentially, and page_number/page_id plus Trip.page_id are cascaded; dates are never mutated and pagination constraints (4/13/month) are preserved. Example: Book starts 2026-01-01 Page 1 at 50,000 km, later entry for 2025-01-01 becomes Pages 1–2 and the existing Page renumbers (no gap). Book Opening re-edit triggers recalculation of fuel balances forward from the earliest Page only. Continuity invariants hold after renumber: Page N End KM = Page N+1 Start KM and End Fuel = next Fuel Position (including In-Tank).`,
  },
  {
    id: 'inline-editing',
    title: '10. Inline Editing (All Trips Table)',
    group: 'Operations & Gaps',
    content: `Any trip in the All Trips Master Table can be edited inline. Click on Start KM, End KM, Fuel Pumped, Fuel Order No, or Places Visited cells to edit. Changes are highlighted and a confirmation dialog appears before saving.\n\n• Start KM / End KM: Integer values. Changing either auto-recalculates Trip Distance.\n• Fuel Pumped: Decimal litres (1 decimal).\n• Fuel Order No / Places Visited: Free text.\n\nAfter save, page end values and fuel balances are recalculated if KM changed.`,
  },
  {
    id: 'gap-ops',
    title: '11. Gaps — Fill Gap vs Insert After vs Remove & Shift (All Trips only)',
    group: 'Operations & Gaps',
    content: `KM Gaps surface as RED badges/alerts where Trip N End KM ≠ Trip N+1 Start KM (chronological by date then Start KM) and where Page N End KM ≠ Page N+1 Start KM. Two shift operations and one gap-fill exist — all in All Trips Master Table only (Ledger is read-only and shows only the bold Private rows).\n\n• Fill Gap (no shift): When a KM gap exists (e.g., 100-110 → 120-130, gap 110-120), the successor row's Start KM cell shows a "+ Fill Gap 10 km" chip (RED) and the predecessor row's ⋯ menu shows "Fill Gap (110→120)". Clicking opens a dialog with Start KM = 110, End KM = 120, Distance = 10, Date = predecessor Date auto-filled (editable, clamped to predecessor Date … successor Date). Fill Places Visited, Times and confirm — the dialog validates (Places non-empty, End ≥ Start, End Time required) and on save the gap closes with NO downstream shift. Use this when the gap is missing history.\n\n• Insert After (shift +Δ): Row ⋯ menu → "Insert After" on any Trip. Dialog defaults Date = that row's Date (editable within [that date … next date]). Enter Start/End KM (distance auto-derived as End−Start); other fields as for a normal Trip. Confirmation modal shows "Insert Trip — Shift N trips by Δ km?" with a before→after preview of the first 3 downstream trips (+M more). On Confirm, the new Trip is inserted at that chronological position and every later Trip's Start/End KM is increased uniformly by Δ (their own Distance and fuel pumped stay frozen). Page start/end KM and the fuel chain (Position + In-Tank + Drawn − Consumed = Balance) are recomputed forward; if 13 trips/day or 4 days/page or month rollover would be breached, a new Page is auto-created via the same pagination engine that governs New Trip.\n\n• Remove & Shift (shift −Δ): Row ⋯ menu → "Remove & Shift" (distinct from plain "Delete" which just deletes and may leave a new gap). Removes the selected Trip and shifts every later Trip down by Δ = removed.end − removed.start (−Δ). Confirmation shows "Remove Trip — Shift N trips by −Δ km?" with the same before→after preview. Page continuity is patched; empty Pages are retained v1 (not collapsed). All three operations dispatch fleetledger:data-changed so Dashboard auto-refreshes.`,
  },
  {
    id: 'focused-trip',
    title: '12. Focused Trip Retention',
    group: 'Operations & Gaps',
    content: 'After Insert After, Gap Fill, Remove & Shift, or plain Delete in All Trips Master Table, focus is kept on the affected row. Insert/Gap Fill -> the newly added trip row is highlighted (ring + cyan flash) and scrolled to center. Delete/Remove & Shift -> the predecessor row (chronologically previous date||start_km) is focused; if the earliest trip was deleted, the successor that slid into its place is focused. If the target row is hidden by the current Search, Month, or Type filter, the filter is cleared to All + date ascending and a toast Filter cleared to show focused row appears before scrolling. The highlight fades after ~3.2s. Bulk Sheet Pull import focuses the earliest newly added trip and flashes all imported rows.',
  },
  {
    id: 'all-trips-workbook',
    title: '13. All Trips Workbook (Export & Import)',
    group: 'Data Exchange',
    content: `Export: Click "Export Excel" in the All Trips table header to download a .xlsx file with all trip records. The file uses the "All Trips" sheet with columns: Date, Start KM, End KM, Distance, Start Time, End Time, Private / Official, Places Visited, Fuel Pumped, Fuel Order No (header "Type" still accepted as alias).\n\nImport: Click "Import Excel" and select a .xlsx file matching the export template. The import validates:\n• Header row (case-insensitive, order-enforced; "Type" accepted as alias for "Private / Official", "Fuel Drawn" for "Fuel Pumped")\n• Essential fields: Date (YYYY-MM-DD), Start KM, End KM, End Time, Places Visited\n• Start Time optional — if empty but End Time + Distance are present it is auto-estimated (tiered speed, ceil 5 min) and saved as HH:MM; if End Time is empty the row is rejected; if distance ≤0 the Start stays "".\n• End KM ≥ Start KM, integer KM values\n• Private / Official restricted to Official or Private (list values)\n• No KM range overlap with existing trips on the same date\n• Pagination rules (4 days / 13 trips / month)\n\nAny validation failure aborts with a row-numbered error report and no writes. On success, trips are appended chronologically with deduplication (same date|start|end is upsert — estimated Start overwrites). Back-dated insertions trigger automatic page renumber.`,
  },
  {
    id: 'sheet-pull',
    title: '14. Import from Google Sheet — Pull (Buffer Sheet)',
    group: 'Data Exchange',
    content: 'The Buffer Sheet that QuickTrip Mobile writes to can be pulled directly without downloading Excel. In All Trips Master Table header click Import from Google Sheet ☁️↓ — first click prompts for Sheet URL/ID and Apps Script Web App URL (same values as QuickTrip Mobile Settings, stored locally as mobile.sheetId / mobile.scriptUrl). The dialog probes GET scriptUrl?action=allRows and shows Connected — N rows or an error hint Deploy as Anyone with link.\n\nOn Pull, the app fetches all rows, compares by Odo Key (date|start|end integer via getOdoKey) — New (odo not in DB, checked by default), Changed (same odo but different places/time/fuel/type, unchecked with amber diff like places: A->B), and Skipped (exact duplicate). Empty Start Time with End Time + Distance is auto-estimated before diff so Changed shows start: -→08:50. Preview modal lists New above Changed, both with select-all checkboxes; Confirm is blocked until at least one row is checked and until overlap/pagination pre-flight (same as Import Excel) passes. Selected rows are imported via the same pipeline (importTripsFromWorkbook + bulk /api/import with localStorage fallback), then the earliest newly added trip is focused and all imported rows flash cyan. Manual pull only; last successful pull time is stored as mobile.lastSheetPullAt and shown under the header and as tooltip on the button.\n\nHeader has four distinct directions: Import from Excel | Export to Excel | Import from Google Sheet ☁️↓ | Export to Google Sheet ☁️↑ — Import pulls Buffer → DB, Export pushes DB → Buffer (see 15).',
  },
  {
    id: 'sheet-push',
    title: '15. Export to Google Sheet — Push (atomic rewrite, Preserve unimported)',
    group: 'Data Exchange',
    content: 'Inverse of Pull (14). Click Export to Google Sheet ☁️↑ in All Trips Master Table header to rewrite the Buffer Sheet with all DB Trips plus preserved pending mobile rows. Steps:\n• Fetch: GET scriptUrl?action=allRows → filter valid rows (date && places_visited && end_time && isFinite start_km/end_km) same as Pull, dedupe within buffer by Odo Key (first occurrence wins).\n• Preserve: valid buffer rows whose Odo Key (date|start_km|end_km integer via getOdoKey) not in DB are kept; same Odo Key is overwritten by DB version (DB wins). Invalid rows ignored and counted as Invalid ignored.\n• Payload: [...DB rows sorted date ASC → start_km ASC, ...preserved in original buffer order at bottom]. DB edits of same Odo Key overwrite the sheet copy. Integer KM kept as numFmt \'0\', Fuel Pumped as \'0.0\'.\n• Proxy: POST scriptUrl?action=rewriteSheet body {action:\'rewriteSheet\', rows} (alias pushAll). Apps Script uses LockService.getDocumentLock().tryLock(30000) — if lock fails or header validation (ensureHeaders_) fails it returns {ok:false} leaving sheet untouched (atomic). On success it does single batch sh.clear() + header ALL_TRIPS_HEADERS + setValues(rows) + number formats; large payloads should be chunked if >5k rows.\n• Preview: Push Preview modal before write shows counts DB rows N | Preserved M (unimported) | Overwriting K | Invalid ignored X, expandable preserved-row list (date | start→end | places), warning "Sheet will be cleared and rewritten". Confirm is disabled until sheetId && scriptUrl configured — blocked with "Blocked by: Settings" banner; Cancel closes without write. On success toast Exported — N rows (+M preserved) and persist mobile.lastSheetPushAt shown as Last Sheet push: subtitle and button tooltip; on failure toast Sheet not modified: <error> and Settings modal stays open. Requires redeployed Apps Script bound to Buffer Sheet with POST rewriteSheet and deployed as Anyone with link (same as Pull), otherwise fetch probe fails with hint.',
  },
  {
    id: 'sheet-linking',
    title: '16. How to Link Google Sheet (Buffer Sheet)',
    group: 'Setup & Manuals',
    content: `Follow docs/manuals/user-setup.md §§1–3 for full detail. Distilled:\n1) Create Sheet: sheets.google.com → Blank → rename tab to exactly All Trips → row 1 = Date | Start KM | End KM | Distance | Start Time | End Time | Private / Official | Places Visited | Fuel Pumped | Fuel Order No (freeze row 1).\n2) Deploy Proxy: Extensions → Apps Script → paste quicktrip-mobile/apps-script/Code.gs → Save → Deploy → New deployment → Web App → Execute as Me, Who has access Anyone with the link → Authorize (spreadsheets) → copy Web App URL (scriptUrl).\n3) Copy Sheet URL (browser bar) — any format, ID extracted via /d/ID/.\n4) Save URLs: create config/sheet.local.json from config/sheet.example.json (gitignored) with sheetId/sheetUrl/scriptUrl, or open All Trips → Sheet Settings ⚙ → paste both URLs → probe shows Connected — N rows (GET ?action=allRows).\n5) Verify: open scriptUrl?​action=allRows in browser → {"rows":[]}; if Header row mismatch fix row 1. See docs/manuals/user-setup.md §1.2 for ensureHeaders_ alias rules and §8 troubleshooting for 401/403 Deploy hint.`,
  },
  {
    id: 'mobile-setup',
    title: '17. How to Set Up Mobile Webpage / PWA',
    group: 'Setup & Manuals',
    content: `Follow docs/manuals/user-setup.md §§5 + quicktrip-mobile/README.md. Distilled:\n1) File roles: quicktrip-mobile/dist/mobile_app_public.html is the tracked public template (SCRIPT_URL_DEFAULT = ""); quicktrip-mobile/dist/Mobile_with_url_private.html is gitignored private build with URL hard-coded — copy the private file to phone.\n2) Build private file: after filling config/sheet.local.json, run npm run build:mobile (or .\\start-service.ps1 as Admin — it builds mobile + schedules Next start on :8082 at logon). Verify private file contains const SCRIPT_URL_DEFAULT = "https://script.google.com/…/exec".\n3) Copy to phone: USB / Drive / QR (python -m http.server) → open in Chrome on Android.\n4) Install: Chrome ⋮ → Add to Home Screen → standalone icon. First load does GET ?action=last10 to seed Start KM from sheet's last rows; offline trips queue in IndexedDB mobile-queue and auto-flush on online/visibilitychange — see app/mobile/page.tsx reuse of same Sheet Proxy logic.\n5) If you use the public template, paste Script URL once via Settings; private file needs no paste. To update URL later, edit config/sheet.local.json + npm run build:mobile + recopy. Full troubleshooting: docs/manuals/user-setup.md §8.`,
  },
  {
    id: 'auth-roles',
    title: '18. Auth Roles (Landing, Super Admin)',
    group: 'Setup & Manuals',
    content: `System is single-operator — Super Admin (Neranjan) only. Unauthenticated visitors see only Landing — a login page showing Super Admin password login (username Neranjan, hashed, forced change on first login) plus TOTP (Google Authenticator) and single-use Recovery Code at /recovery. No Gmail allow-list or Google SSO (removed ADR-0010/0019, /settings/access deleted). All ledger routes are behind an authenticated Landing Gate except Landing and /recovery; Help at /help is authenticated and linked from the header (?) icon. Successful Trip save shows a "Trip Added" toast (~2s) then redirects to Dashboard; import success shows "N trips added" then redirects.`,
  },
];

const groups = ['Core Concepts', 'Ledger & Fuel', 'Operations & Gaps', 'Data Exchange', 'Setup & Manuals'];

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
        <div className="flex items-center justify-between mb-4 gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-on-surface">Help — Running Chart Guide</h1>
            <p className="text-sm text-on-surface-variant">Search across 18 sections. Groups mirror the app's mental model — Core, Ledger, Operations, Exchange, Setup.</p>
          </div>
          <Link href="/" className="text-sm font-medium text-telemetry-cyan hover:underline shrink-0">
            ← Back to Dashboard
          </Link>
        </div>

        <div className="mb-4 flex items-center gap-2">
          <div className="relative flex-1 max-w-xl">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search help — try sheet, fuel, gap, mobile, time…"
              className="w-full rounded-lg border border-rule-line bg-paper-sheet px-3 py-2 pr-9 text-sm outline-none focus:border-telemetry-cyan focus:ring-1 focus:ring-telemetry-cyan"
              aria-label="Search help"
            />
            {q && (
              <button onClick={() => setQ('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-zinc-400 hover:bg-zinc-100" aria-label="Clear search">
                ×
              </button>
            )}
          </div>
          <span className="text-xs text-on-surface-variant whitespace-nowrap">
            {filtered.length}/{sections.length} sections{q ? ` for “${q}”` : ''}
          </span>
        </div>

        <div className="flex flex-col lg:flex-row gap-6">
          <nav className="lg:w-56 shrink-0 lg:sticky lg:top-4 self-start bg-paper-sheet border border-rule-line rounded-xl shadow-sm p-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-2">On this page</p>
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
                No sections match “{q}”. Try a different term or clear search.
              </div>
            ) : (
              <div className="bg-paper-sheet border border-rule-line rounded-xl shadow-sm divide-y divide-rule-line">
                {groups.map((g) => {
                  const list = byGroup.get(g) ?? [];
                  if (list.length === 0) return null;
                  return (
                    <div key={g}>
                      <div className="px-6 py-2 bg-paper-gutter">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">{g}</p>
                      </div>
                      {list.map((s) => (
                        <section key={s.id} id={s.id} className="p-6 scroll-mt-20">
                          <h2 className="text-sm font-bold tracking-tight text-on-surface mb-2">
                            {q ? (highlight(s.title, q) as unknown as React.ReactNode) : s.title}
                          </h2>
                          <p className="text-sm leading-relaxed text-on-surface-variant whitespace-pre-wrap">
                            {q ? (highlight(s.content, q) as unknown as React.ReactNode) : s.content}
                          </p>
                        </section>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}

            <p className="mt-6 text-xs text-on-surface-variant">
              Domain glossary: Book, Page, Trip, Vehicle, Book Opening, Fuel Economy/Position/In-Tank/Drawn/Consumed/Closing Balance, Adjusted Fuel Economy, Page-Wide Trip Sequence, Integer KM, Continuity Alert, All Trips Workbook, Ledger Full-Width Stack, Super Admin, TOTP, Recovery Code, Landing, Help Page (searchable), Trip Import with Estimated Start Time auto-fill, Continuity Break, Transposed Side 2, Focused Trip, Sheet Pull Import, Sheet Push (Export to Google Sheet), Push Preview, Sheet Settings (mobile.lastSheetPullAt/mobile.lastSheetPushAt), Import Preview, Sheet Proxy (GET allRows/last10, POST appendTrip/rewriteSheet + LockService), Digital Vehicle Cluster, Fuel Economy Trend, Monthly Distances Tile. Full manuals: <Link href="/docs/manuals/user-setup.md" className="underline">docs/manuals/user-setup.md</Link> + quicktrip-mobile/README.md.
            </p>
          </div>
        </div>
      </div>
    </ProtectedRoute>
  );
}
