# Running Chart

Digital counterpart to the physical vehicle running chart logbook. The system mirrors the book's pagination, continuity, and fuel arithmetic so a digital ledger prints and audits identically to the paper original.

## Language

### Core Ledger

**Book**: The complete sequence of Pages for one Vehicle, ordered chronologically by date.
_Avoid_: Ledger, logbook

**Page**: A single physical sheet holding at most 4 distinct dates and 13 Trips per date; a new calendar month always forces a new Page.
_Avoid_: Sheet, paper

**Trip**: One movement record from Start KM to End KM on a given Date, with Start/End Time, Places Visited, Trip Type, and optional fuel Drawn.
_Avoid_: Entry, log, row

**Quick Places (Home ↔ Office)**: Two convenience pill buttons shown directly beside the `Places Visited` field on both `New Trip Entry` (`components/QuickTripForm.tsx:481`) and Mobile (`components/mobile/MobileQuickTripForm.tsx:178`, `quicktrip-mobile/dist/mobile_app_public.html:93`, `/mobile` route): `Home - Office` and `Office - Home`. Pressing a pill clears the textbox and fills it with the pill text; the field remains freely editable afterward (`setPlacesVisited(v)` + focus, `data-testid="quick-places-home-office"` / `quick-places-office-home"`). Static PWA template mirrors the same JS (`setPlacesQuick` + `places input` sync) so the private phone file inherits the chips after `npm run build:mobile`.
_Avoid_: Route shortcut, preset location

**Vehicle**: The tracked asset defined by Brand, Model, Type, Fuel Type, Tank Capacity, and Registration No.
_Avoid_: Car, fleet unit

**Book Opening**: The initial odometer reading (Opening KM) and fuel in tank (Opening Fuel) that seeds Page 1; re-editable when retroactive older Pages are inserted.
_Avoid_: Starting balance, initial state

**Day Group**: All Trips sharing the same Date on a Page, numbered 1..4.
_Avoid_: Daily batch

### Fuel & Distance

**Fuel Economy**: Kilometres per litre for a Day Group, propagated forward until explicitly overridden; fallback 10.5 km/L.
_Avoid_: Mileage, efficiency

**Adjusted Fuel Economy**: A Day Group where Fuel Economy has an explicit override (stored per Page+Day, stepped ±0.1 from existing value, rounded to 1 decimal, clamped 0.1–50); rendered with an "Adjusted" badge; reverting to the inherited value deletes the override so the badge disappears and the Day inherits again.
_Avoid_: Custom economy, edited economy

**Fuel Position**: Fuel balance carried from the previous Day Group's Closing Balance; Page N+1 Day 1 inherits Page N's final Closing Balance.
_Avoid_: Opening fuel, previous balance

**In-Tank Fuel**: Fuel physically in the tank at the start of a Day Group before any Drawn fuel, default 0 unless typed.
_Avoid_: On-hand fuel, carried fuel

**Drawn Fuel**: Fuel pumped on the day, recorded per Trip as Fuel Pumped Amount with Fuel Order No.
_Avoid_: Filled fuel, pumped quantity

**Consumed Fuel**: Fuel used on the day, calculated as Distance / Fuel Economy, rounded to 1 decimal.
_Avoid_: Usage, burn

**Closing Balance**: Fuel remaining at end of a Day Group, calculated as Position + In-Tank + Drawn − Consumed, rounded to 1 decimal.
_Avoid_: Ending balance, remainder

**Integer KM**: Odometer values (Start KM, End KM, Trip Distance) stored and displayed as whole kilometres with no decimals (decimal input is rounded on blur/save, `numFmt '0'` in Excel); fuel values retain 1 decimal for consumption/balance maths.
_Avoid_: Decimal odometer, 1-dec km

**Page-Wide Trip Sequence**: Derived continuous numbering 1..N per Page across Day Groups for Ledger display (not stored, recomputed from chronological sort), replacing per-day trip_index; All Trips global sequence is separate 1..T chronologically across the Book.
_Avoid_: Day-local index, stored seq

**KM Gap**: Odometer discontinuity where a Page's End KM ≠ next Page's Start KM, or a Trip's End KM ≠ next Trip's Start KM (chronological sort); rendered in RED near the next Page/Trip's Start KM and as inline RED cell highlight.
_Avoid_: Mileage gap, odometer mismatch

**Fuel Gap**: Fuel discontinuity where a Page's End Fuel Balance ≠ next Page's Start Fuel Balance (or trip-implied fuel stock gap per Day Group); rendered in AMBER/ORANGE distinct from KM Gap, near next Page's Start Fuel and as inline AMBER cell highlight.
_Avoid_: Fuel mismatch, tank gap

### Auth & Access

**Super Admin**: The single Operator account (Neranjan) authenticated by password plus TOTP, must change bootstrap password and enroll TOTP on first login; the system is single-operator with no other users.
_Avoid_: Admin, owner

**TOTP**: Time-based one-time password (RFC 6238, 30s step, ±1 window) via Google Authenticator; secret encrypted at rest (AES-256-GCM) and required on every login after enrollment.
_Avoid_: OTP, 2FA code

**Recovery Code**: Single-use 64-character (256-bit) fallback generated once at enrollment, displayed once for offline saving, stored hashed with bcrypt; entered at /recovery it bypasses password and TOTP and creates a short recovery session that forces immediate password reset, TOTP re-enrollment, and new code generation.
_Avoid_: Backup password, long password

**Session**: Authenticated state via httpOnly Secure cookie (session_token) bound to sessions table with absolute 30-day expiry and 7-day idle timeout (sliding on activity), revoked on password, TOTP, or recovery reset.
_Avoid_: JWT, localStorage session

**Landing**: The public unauthenticated entry page showing Super Admin login (password + TOTP) and Recovery entry; no ledger data.
_Avoid_: Homepage, login screen

**Landing Gate**: Strict auth guard where every route except Landing and /recovery hard-redirects to Landing when unauthenticated, before any ledger or vehicle data fetch; no flash of data, session expiry also redirects with toast.
_Avoid_: Soft gate, lazy redirect

### UX & Operations

**Help Page**: Authenticated reference at `/help` with live search (title+content substring, highlight) and grouped navigable sections (sticky TOC) distilling Sheet linking and Mobile setup manuals inline and linking to `docs/manuals/user-setup.md`; covers trip entry reciprocals, pagination rules, fuel formulas, import template, and auth roles.
_Avoid_: Guide, docs

**Trip Import**: Bulk creation of Trips from an Excel file validated pre-flight against essential fields and pagination rules before any write.
_Avoid_: Data import, upload

**Estimated Start Time**: Suggested Start Time derived as End Time − (Distance / speed) ceiled to the nearest 5 minutes where speed is resolved from configurable **Speed Slab**s (see below); auto-filled only when Start Time is empty and editable, with `+5/+10/−5/−10` nudge buttons to adjust (`formatMinutesToTime` wrap, `calculateDurationMinutes` refresh). During Excel Workbook import (`parseAllTripsWorkbook`) and Buffer Sheet Pull (`toPartial`), an empty `start_time` is estimated from `end_time` + `distance` using the **Traffic** set when **Traffic Mode** dual-set is active (fallback) and persisted as `HH:MM` (overwrite on same Odo Key); if `end_time` is empty the row is rejected; if estimation yields `null` (zero/invalid distance) the Trip keeps `start_time = ""` and still imports. Help page renders the active slab table dynamically.
_Avoid_: Calculated start, inferred start

**Speed Slab**: A distance interval with associated speed for **Estimated Start Time**: configured as up to 4 contiguous half-open intervals covering `0 → ∞` (e.g. `<20 → 15 km/h, 20–50 → 20, 50–100 → 25, ≥100 → 35`), each speed `1–80` km/h integer, plus fixed ceiling `5 min`. Three modes in Settings: **Default** (locked `<10→15 <20→20 <40→25 ≤60→30 >60→35`, read-only), **Custom** (single set, user-defined up to 4 slabs), **Traffic-aware** (two independent sets: `Traffic` default and `Light Traffic`, selected per-entry via **Traffic Mode**). Stored via `lib/speedConfig.ts` (`app_config` single row + localStorage cache, hybrid server source of truth, migrated `mode:'default'` for existing installs). Bulk import without Traffic selection falls back to `Traffic` set.
_Avoid_: Speed tier, slab range

**Traffic Mode**: Transient selector `Traffic` (default) vs `Light Traffic` shown only when **Speed Slab** mode is `traffic-aware`; appears in Add-Trip forms (`components/QuickTripForm.tsx`, `quicktrip-mobile/dist/mobile_app_public.html`) beside Trip Type and controls which Speed Slab set the `Auto`/auto-estimate uses. Not persisted to `Trip` table/DB nor Excel/Sheet export — evaluation helper only.
_Avoid_: Traffic day, light day

**Typical Fuel Economy Range**: Per-Vehicle `[low, high]` km/L (1-decimal, `0.1 ≤ low < high ≤ 50`, default `7.0–9.0` stored on `vehicles.typical_economy_low/high`) used to color **Fuel Economy Trend** bars: Green if `low ≤ econ ≤ high`, Amber if `low−margin ≤ econ < low` or `high < econ ≤ high+margin`, Red otherwise, where `margin = ((low+high)/2)*0.20` (20% of mid). Shown with legend `Green: in range | Amber: within margin outside | Red: beyond` (`components/dashboard/FuelEconomyGraph.tsx:30`).
_Avoid_: Economy band, mileage range

**Global Search**: (Removed) Header search that previously live-filtered all Trips. Search is now available only within the All Trips Master Table section.
_Avoid_: Finder, lookup

**Continuity Break**: A ledger gap where Page N End KM ≠ Page N+1 Start KM or End Fuel Balance ≠ next Start Fuel Balance, surfaced as an alert banner with optional recalculation.
_Avoid_: Mismatch, discontinuity error

**Continuity Alert**: Persistent, non-dismissible banner/drawer listing every KM Gap (RED) and Fuel Gap (AMBER) at Page-to-Page and Trip-to-Trip levels; survives refresh, shows expected vs actual and jump-to-page/trip links, clears only when gaps are fixed or missing records are added to close them (no auto-recalc). Dashboard shows a compact alert bar ("Continuity Gaps Detected") with a "View All Trips" link; All Trips and Ledger pages show the full detailed alert.
_Avoid_: Toast alert, dismissible warning

**All Trips Workbook**: Dual-sheet Excel file (`All Trips` + `Leaves`) named per All Trips table; `All Trips` sheet has header row `Date | Start KM | End KM | Distance | Start Time | End Time | Private / Official | Places Visited | Fuel Pumped | Fuel Order No` (`Type` alias case-insensitive order-enforced), `Leaves` sheet has `Date | Note` (`Notes|Remark|Remarks|Leave Note` alias, dynamic range `CALENDAR_RANGE 2024–${CALENDAR_RANGE.endYear}` auto-extends on Dec 01, Note ≤200). Export always writes both sheets (Leaves header-only when empty); import validates each sheet independently and upserts chronologically without implicit delete.
_Avoid_: Book-Mirror sheet, generic export

**Transposed Side 2**: Side 2 Fuel Economy & Position tables rendered with days as columns to mirror the physical book's landscape layout, matching Side 1 column orientation.
_Avoid_: Rotated tables, flipped view

**Ledger Full-Width Stack**: Ledger Page View layout where Table 1 (Trips Log) occupies full width on top, with Table 2 (Fuel Economy & Consumption) and Table 3 (Fuel Position & Balance) stacked full-width beneath it, replacing the dual-column Side 1 / Side 2 folio; print and responsive rules preserve this stack.
_Avoid_: Side-by-side folio, two-column ledger

**Fuel-In Segment**: Contiguous Trips from the trip after a fuel-in Trip (Drawn>0 per Trip, `fuel_pumped_amount`) inclusive to the next fuel-in Trip inclusive; the final segment ends at the Book's last Trip. Economy changes only after the pumped Trip completes, not at the pumped date boundary — e.g., pump on 3rd Trip of a date, Trips 1-3 use previous economy, Trip 4 onward uses new economy. One Fuel Economy value applies uniformly across the segment; intermediate balances (per-Trip, In-Tank at first Trip of each date) must stay in [1, tankCapacity] where tankCapacity is `Vehicle.tank_capacity`.
_Avoid_: Fill interval, refuel block

**Estimated Fuel Economy**: Calibrated km/L for a Fuel-In Segment (trip-level) suggested by the estimator via brute-force 0.1 km/L search, chosen as the value within the feasible interval (per-Trip balances in [1, tankCapacity]) closest to the previous segment's economy (or practical seed 7.8 km/L for the first segment). If no feasible value exists, the nearest infeasible value is suggested with a warning and the estimator prefers keeping below tankCapacity while allowing the physical max when pump timing is uncertain.
_Avoid_: Calculated economy, guessed economy

**Fuel-IN Summary**: Dashboard table listing fuel-in dates with aggregated Fuel IN (L) and Fuel Order No, sorted newest-first; 6 rows shown scrollable with MORE opening a full-list popup; header icon `📊` opens Fuel-In Indicative Economy popup; in the 70:30 dashboard split it occupies the 30% pane beside Fuel Economy Trend.
_Avoid_: Refuel log, fuel history

**Fuel-In Indicative Economy**: Derived km/L for a fuel-in date `Di` (i>1) as `DistanceBetweenFuelIns / FuelIN(Di)` where `DistanceBetweenFuelIns = LastKM(Di) − LastKM(Di−1)` and `LastKM(D)` is the `end_km` of the last Trip on `D` (Integer KM, `roundToIntegerKm`), per-Date aggregated (same-day multiple pumps summed to one row; assumes one fuel-in per day). `FuelIN(Di)` is aggregated `fuel_pumped_amount` for `Di` rounded to 1 decimal (`roundToOneDecimal`). Result rounded to 1 decimal; first fuel-in and any interval containing a KM Gap (`detectTripGaps` successor date in `(Di−1, Di]`) shows `—` with `⚠️ Insufficient — ODO gap` tooltip. Values outside 5–20 km/L are highlighted AMBER as abnormality. Shown in the Fuel-IN Summary header-icon popup (`components/dashboard/FuelInSummary.tsx`) with columns `# | Date | Last KM | Fuel IN (L) | Distance Since Last (km) | Indicative Economy (km/L) | Ref No` sorted newest-first. AMBER banner states indicative-only, full-tank assumption: "Indicative only — assumes each fuel-in was a full tank. Accurate only for Full tank → Full tank cycles. Use to detect abnormalities or data entry mistakes." plus footer note "Assumes one fuel-in per day — same-day multiple pumps are summed."
_Avoid_: Full-tank economy, actual economy, fuel efficiency

**Fuel Economy Trend**: Dashboard graph in the 70% pane beside Fuel-IN Summary (70:30 split), showing km/L chronologically from `computeTripFuelMap`; X = DayGroup date (two stems drawn for a single date when it contains both pre- and post-pump economies, label `DD Mon` per stem), Y = km/L; bars use `trip-official` green (#059669) on `paper-gutter` track, horizontally scrollable with latest at right via middle-mouse drag plus year-filter and chevron scroll, with dashed `14 km/L` max and `10 km/L` baseline references; gaps where an Odometer loss (KM Gap) exists are rendered as a RED hatched Gap Span column with “gap N km” pill — calendar idle months without an ODO gap are not shown. A dedicated sticky year footer row inside the scroll container is interrupted by blank Gap Span cells; each Year Track’s Sticky Year Label stays pinned so 1–3 year labels remain visible under their correct date ranges while scrolling, each year in a distinct tint.
_Avoid_: Mileage chart, consumption graph

**Year Track**: Contiguous horizontal band in Fuel Economy Trend’s sticky year footer representing one calendar year’s date range; tinted distinctly per year (cycle slate/amber/emerald/sky/violet) and split by blank Gap Spans.
_Avoid_: Year bar, year segment

**Sticky Year Label**: Year number inside a Year Track that stays pinned to the track’s visible edge via CSS `position:sticky` so relevant year(s) remain in viewport during horizontal scroll.
_Avoid_: Fixed year, floating header

**Gap Span**: Striped RED column in Fuel Economy Trend’s stems, dates, and year footer rows marking an odometer-loss KM Gap; the year footer’s Gap Span is blank (no Year Track or Sticky Year Label).
_Avoid_: Gap column blank, gap marker

**Monthly Distances Tile**: Dashboard dark card (`bg-slate-900/90`, `lg:col-span-4` in 12-col grid) that shows two virtual rows inside one “Monthly Distances” container: row 1 “This Month (MMM YYYY) • In Progress”, row 2 “Previous Month (MMM YYYY) • Audited”; each row shows `Official | Private | Total` (integer KM, zero as `0 KM`, per ADR 0002) with trip counts and a Business/Private progress bar.
_Avoid_: This-month card, last-month widget

**Digital Vehicle Cluster**: Dark automotive cluster (`bg-cluster-bezel`, `lg:col-span-8` in 12-col grid) whose visor shows vehicle identity (`Brand Model` + `Type • Fuel Type • Tank Capacity` with `Registration No` plate badge), left ODO barrel (`lastOdo` as at `DD-MM-YYYY`) and right fuel gauge (level `toFixed(1) L` + `%`, semicircular arc and level bar); ODO not duplicated in visor.
_Avoid_: Vehicle card, car widget

**Dashboard Auto-Refresh**: After any ledger mutation (Excel Import, Sheet Pull Import, inline edit, Delete/Remove & Shift, Gap Fill, Insert After, Rebuild Ledger, Estimated Economy apply) the originating component dispatches `fleetledger:data-changed` and the Dashboard page listens (`fleetledger:data-changed` + `storage`) to refresh `vehicle/pages/trips` so This/Previous Month Stats, Fuel IN, and Fuel Economy Trend update without manual reload.
_Avoid_: Polling, manual refresh

**Trip Type**: Enumerated category of a Trip, restricted to Official or Private; validated as a select list in All Trips, New Trip, and import.
_Avoid_: Category, purpose type

**Private Trip (Orange Row)**: A Trip with `Trip Type = Private`; rendered with `bg-orange-200` background (no bold) in both Ledger (`Side1TripsLog`) and All Trips Master Table (RED gap cell `bg-red-100` wins on Start KM). When a Private Trip also has `Fuel Pumped >0`, the dark-blue fuel-pumped text color layers on top of the orange background.
_Avoid_: Partial bold, badge-only

**Fuel-Pumped Trip (Dark Blue)**: Any Trip with `fuel_pumped_amount > 0`; rendered with dark-blue text (`text-blue-900`) in All Trips Master Table, layered on top of Private orange or alternating day backgrounds. The ⛽ icon appears in the # column.
_Avoid_: Blue highlight, fuel badge

**All Trips Master Table (Desktop Layout)**: Master table with **Type column removed** (Private is signaled by `bg-orange-200` row) and Route column at ~6% width (narrow, from 22% → ~6%, text-xs, `⋯` fixed `w-10 sticky right-0` shifted left and shadowed so it stays visible without horizontal-scroll hiding) with horizontal scroll restored (`overflow-x-auto`, `min-w-[1020px]`) so all columns including ⋯ menu stay reachable; footer sums and continuity chips remain. **DAY** column (Day Type) is compact `w-16` (`64px`), header `DAY` at `text-[8px]`, badges at `text-[9px]` (`-2px` from prior). Day badges are abbreviated: **Weekday → no badge (empty)**, **Sat → `Sat` RED**, **Sun → `Sun` RED**, **Poya → `Poya` YELLOW**, **PH → `PH` (Public) BLUE**, **MH → `MH` (Mercantile) AMBER**, **BH → `BH` (Bank) RED**, **HOL → `HOL` (other holiday) SLATE**, **Leave → `Leave` ORANGE** (with dot). Priority `Leave > Poya > MH > PH > BH > Sat/Sun > Weekday (empty)`; Poya takes priority over other holiday colors. ⋯ menu is rendered via portal fixed-positioned and auto-flips above the button for last rows to avoid clipping inside the scroll container. Off-day summary bar has RHS **Go to Latest →** that jumps to the last row of the table (bottom of current filtered view, or chronological latest) via focused scroll.
_Avoid_: Horizontal scroll, full-width route

**Gap Fill Trip**: A Trip inserted solely to close a detected **KM Gap** (`Trip N End KM ≠ Trip N+1 Start KM`); the dialog auto-fills `Start KM = predecessor End KM`, `End KM = successor Start KM`, `Distance = End − Start`, `Date = predecessor Date` (editable within `[predecessor Date, successor Date]`), `Trip Type = Official` default; no downstream shift — it consumes the gap extent exactly and is surfaced only in All Trips via an inline `+ Fill Gap` chip and row ⋯ menu when a KM Gap exists.
_Avoid_: Gap patch, gap insert

**Inserted Trip (Shift)**: A Trip inserted after any existing Trip at a chosen chronological position in All Trips; downstream Trips (all later in `date || start_km` order, across Page boundaries) have their `Start KM` and `End KM` increased uniformly by `Δ = new.end − new.start` (their `trip_distance` and other fields frozen), with `BookPage` start/end KM and fuel chain recomputed forward via `recalculatePageBalancesFromOpening`; pagination auto-splits (`13 trips/day`, `4 days/page`, month rollover) creating a new Page when needed. Confirmation previews `N` shifted trips and `Δ` before save.
_Avoid_: Add record in between, middle insert

**Removed Trip (Shift)**: Deletion of a Trip (the “Remove & Shift” action, distinct from plain **Delete** which leaves a gap) that shifts all downstream Trips down by `Δ = removed.end − removed.start` (`Start KM −= Δ`, `End KM −= Δ`), recomputes fuel chain forward, and patches Page continuity; confirmation previews `N` and `−Δ`; empty Pages are retained v1 (not collapsed).
_Avoid_: Delete, shift-delete

**Focused Trip**: The ephemeral highlight-and-scroll target after a mutating operation in All Trips; `Inserted Trip`/`Gap Fill Trip` focuses the new row, `Removed Trip`/`Delete` focuses the predecessor (or successor if earliest) after clearing any search/month filter so the row is visible; rendered as `ring-2 ring-telemetry-cyan` + `bg-cyan-50` flash for ~3s and scrolled to center.
_Avoid_: Selected row, active row

**Sheet Pull Import**: Direct pull from the dual-sheet Buffer Sheet via `GET scriptUrl?action=allRows` using the same Sheet Proxy as QuickTrip Mobile; Trips compared by Odo Key (`date|start_km|end_km` integer) into New / Changed / Skipped buckets validated by `validateNoOverlap`/`validatePaginationForImport`, Leaves compared by `date` into New / Changed (note diff) / Skipped; each sheet previewed with consent and validated independently (one can succeed while other fails), persisted via `importTripsFromWorkbook` + `importLeaves` bulk `/api/import` and `/api/leaves`, focusing earliest new Trip and flashing imported rows `bg-cyan-50`; triggered manually by "Import from Google Sheet" next to Import from Excel.
_Avoid_: Sheet sync, auto-pull

**Sheet Settings**: Persisted Buffer Sheet identity (`mobile.sheetId` extracted from full Sheet URL + `mobile.scriptUrl` Apps Script URL) shared between `QuickTrip Mobile` and All Trips header, editable via a shared dialog that probes `?action=allRows`; defaults are stored in gitignored `config/sheet.local.json` (see `config/sheet.example.json`, loaded via `lib/sheetConfig.ts`) and runtime overrides remain `localStorage mobile.sheetId/mobile.scriptUrl` and `NEXT_PUBLIC_*` env; `Use Defaults` fetches live from `GET /api/sheet-config` (`app/api/sheet-config/route.ts:14`, reads `config/sheet.local.json` + env at request time, no rebuild) and fills the dialog fields before `Save & Test`; last successful pull time stored as `mobile.lastSheetPullAt` and push time as `mobile.lastSheetPushAt`.
_Avoid_: Sheet config, path

**Import Preview**: Modal shown before a Sheet Pull commit, listing New Trips (checked by default) and Changed rows (unchecked, with `old→new` diff such as `places: "A"→"B"`), supporting select/deselect all, blocking Confirm until at least one row is checked and until overlap/pagination pre-flight passes.
_Avoid_: Import dialog, confirm screen

**Sheet Push (Export to Google Sheet)**: Inverse of Sheet Pull Import; manual push that atomically rewrites both Buffer sheets with `LockService`; Trips sheet from all DB Trips sorted `date ASC → start_km ASC` plus header, preserving valid unimported buffer Trip rows (Odo Key ∉ DB appended, DB wins on collision); Leaves sheet from all DB Leaves sorted `date ASC` plus header, preserving valid unimported buffer Leave rows (`date` ∉ DB appended, DB wins, invalid ignored); via `POST rewriteSheet {rows, leaves}`; stores `mobile.lastSheetPushAt`; triggered manually by "Export to Google Sheet".
_Avoid_: Sheet sync, auto-push

**Push Preview**: Modal shown before a Sheet Push commit, showing counts `DB rows N | Preserved M (unimported) | Overwriting K | Invalid ignored X` with expandable preserved-row list, blocking Confirm until settings configured.
_Avoid_: Export dialog, confirm screen

### Mobile Capture

**QuickTrip Mobile**: Installable PWA for Android that mirrors QuickTripForm entry (Date, Integer KM reciprocals, Estimated Start Time (configurable **Speed Slab**s + optional **Traffic Mode** selector, ceiled to 5 min, flat 20 km/h deprecated), Trip Type, Places Visited, Drawn Fuel) but writes to a Buffer Sheet, not the deployment DB; lives in `quicktrip-mobile/` sibling folder (or `app/mobile/` route) and is usable while deployment is unreachable; distribution is `quicktrip-mobile/dist/mobile_app_public.html` (tracked public template, no secret, rebuilt via `npm run build:mobile` / `scripts/build-mobile.js` to inject Speed Slabs + Traffic logic) vs `quicktrip-mobile/dist/Mobile_with_url_private.html` (gitignored private build generated via `start-service.ps1` `$ScriptUrl` or `npm run build:mobile` from `config/sheet.local.json` `scriptUrl`, single-file standalone for phone).
_Avoid_: Mobile app, trip app

**Buffer Sheet**: A dedicated Google Sheet (QuickTrip Buffer) with two sheets mirroring the All Trips Workbook (`All Trips` with identical 10-col header, `Leaves` with `Date | Note`) used as offline staging; rows are later imported via Trip/Leave Import (manual .xlsx download or direct pull).
_Avoid_: Staging sheet, temp sheet

**Leaves Sheet**: Second sheet named `Leaves` in both the All Trips Workbook and the Buffer Sheet, with header `Date | Note` (aliases `Notes|Remark|Remarks|Leave Note` accepted, case-insensitive order-enforced), sorted `date ASC`, always present header-only when empty; round-trips only `LeaveDay {date, note}`.
_Avoid_: Leave tab, holiday sheet

**Sheet Proxy**: Google Apps Script Web App bound to the Buffer Sheet exposing `POST appendTrip` / `POST rewriteSheet` (now `{rows, leaves}` dual-sheet) and `GET last10` / `GET allRows` (now `{rows, leaves}`) over HTTPS so the PWA writes/reads without embedding Google credentials; the script re-applies Integer KM and 1-dec fuel rounding plus `Note ≤200` and `date` dynamic `CALENDAR_RANGE` for Leaves, rejects invalid `End < Start`, and uses `LockService` for atomic dual-sheet rewrite.
_Avoid_: Sheet API, backend proxy

**Mobile Queue**: IndexedDB-backed offline buffer in QuickTrip Mobile that stores Trips when offline and retries Sheet Proxy sync when online, preserving sheet truth for Start KM auto-fill.
_Avoid_: Offline cache, sync queue

### Calendar & Leaves

**Off-Day**: Any date where `isOffDay=true` per `getDayTypeInfo(date, leaveSet)` — PersonalLeave (manual `LeaveDay`) OR Mercantile (M) OR Public (P) OR Bank/Poya (B) OR Saturday/Sunday. Priority `Leave > M > P > B > Weekend`. `LeaveDay` is manual-only, never auto-created from holidays.
_Avoid_: Non-working day (ambiguous), holiday-only

**Working Day**: Monday–Friday that is not a `SriLankanHoliday` (B/P/M) and not a manual `LeaveDay` and not Weekend; i.e. `isOffDay=false`. The complement of Off-Day.
_Avoid_: Weekday (overloaded), business day

**LeaveDay (Manual-Only)**: A personal leave record `{date, note?}` persisted via `leaves` table / `fleetledger_leaves` localStorage, created or cleared **only** through the Calendar cell dialog (“Mark as Leave” / “Clear Leave” with optional 200-char note, plus one-click preset buttons grouped `Standard Leave: Annual Leave | Casual Leave | Medical Leave` and `Duty & Overseas: Duty Leave | Duty Leave (Overseas) | Private Overseas` that fill the `Note / Reason` textarea); never seeded from holidays, import, or any auto path. A Leave date is always an Off-Day. `note` holds the preset name when a preset is chosen, or free text otherwise. `Clear Leave` requires a styled confirmation modal (both in the dialog and in Leave History) before `deleteLeave` executes. Calendar cell right-click on a date with trips shows a `Show Trip Details →` context menu; activating it opens All Trips in a **new tab** (`window.open('/trips?focus=<tripId>', '_blank')` + `focus()`) focused to the date’s first Trip (`app/calendar/page.tsx:98`). The dialog shell mirrors `leavesample.html` (gradient `h-1.5` bar, `rounded-2xl` `max-w-lg`, grouped chips with `aria-checked`, `textarea h-24` + `N/200` counter, `Cancel` + primary `Mark as Leave`/`Save` footer).
_Avoid_: Auto-leave, holiday leave

**Leave History**: Year-filterable table of `LeaveDay` rows (`Date | Day | Holiday | Note`) shown as a persistent card on the Calendar page; filter `All | 2024..${CALENDAR_RANGE.endYear}` (auto-extends) defaults to current year, sorted `date DESC`; row `Clear` asks the same styled confirmation before delete.
_Avoid_: Leave log, leave report

**ODO Gap Period**: Open interval `(curTrip.date, nextTrip.date)` strictly between two chronologically adjacent Trips (`date || start_km` sort) where `cur.end_km != next.start_km` per `detectTripGaps` (`lib/continuityAlerts.ts`); the gap extent is the missing odometer `Δ`. Page KM gaps are not used for calendar filtering.
_Avoid_: Missing period, jump interval

**ODO-Continuous Segment**: Maximal date interval between `firstTripDate .. lastTripDate` that contains **no** ODO Gap Period interior; i.e. ledger is contiguous by `end_km == next start_km` throughout. No-trip Working Day enumeration is restricted to these segments.
_Avoid_: Continuous ledger, clean range

**Trips-On-OffDays Summary**: Popup grouped by date listing every Trip whose date is an Off-Day, each group header `Date — DayOfWeek — Reason (Leave/Mercantile/Public/Bank+ Poya/Weekend)` with per-Trip `Start KM/End KM/Distance/Type/Places/Fuel` and per-date totals; sorted `date ASC, start_km ASC`.
_Avoid_: Holiday trips list, off-day report

**No-Trip Working Days Summary**: Popup listing every Working Day date (`isOffDay=false`) with zero Trips that lies inside an ODO-Continuous Segment (any date strictly inside an ODO Gap Period is excluded/hidden); each row `Date | Day (Monday…Friday) | Holiday none` sorted `date ASC`. Enumerated over `[firstTripDate .. lastTripDate]` intersect `CALENDAR_RANGE` (auto-extends, e.g. `2024–${CALENDAR_RANGE.endYear}`) (no future beyond last trip/today).
_Avoid_: Idle days, unused days (vague)

**Calendar Range (Auto-Extend)**: `CALENDAR_RANGE` `lib/sriLankanHolidays.ts:248` with `startYear 2024` fixed and `endYear` computed as `2027` until `Dec 01 2027`, then rolling `+1` each `Dec 01` (`while now >= Dec01(endYear) endYear++`, capped 2100). `getYearsInRange()` and `CALENDAR_RANGE.endDate` and all leaf validators (`lib/leaveStore.ts:92`, `lib/allTripsWorkbook.ts:300`, `app/api/leaves/route.ts:24`) read `CALENDAR_RANGE.endYear` live, so `2028` leaves/calendar appear on `2027-12-01` without rebuild.
_Avoid_: Fixed 2024-2027 range

**Dynamic Holidays (Live Query)**: Holidays beyond static `SRI_LANKAN_HOLIDAYS 2024-2027` are stored in `holidays` table `lib/db.ts:109` and merged at runtime via `setDynamicHolidays()` `lib/sriLankanHolidays.ts:154` (`getHoliday()` checks `DYNAMIC_MAP` first). Calendar page loads them via `GET /api/holidays` `app/api/holidays/route.ts:14` on mount; `⟳ Query Holidays (YYYY)` button `app/calendar/page.tsx:185` calls `POST /api/holidays/refresh` `app/api/holidays/refresh/route.ts:14` which fetches `https://date.nager.at/api/v3/PublicHolidays/{year}/LK`, maps to `{kinds, isPoya}` (Poya detected by name, `M` not auto-detected) and upserts into DB, then re-merges — no rebuild, `holidayStore.ts` handles the fetch.
_Avoid_: Rebuild for holidays
