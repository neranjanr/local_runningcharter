# Running Chart Web Application - Specification

**Author:** Neranjan Rathnayake (github.com/neranjanr)  
**Credits:** OpenCode, Alacrity, MattPocock tools, Gemini, DeepSeek, and other stacks used in this app.

## Problem Statement

Fleet operators, drivers, and transport managers who maintain physical running chart logbooks face tedious manual arithmetic, high risk of odometer and fuel continuity errors across pages and month boundaries, lack real-time digital visibility into official vs. private mileage breakdowns, and struggle with laborious transcription when auditing or generating reports. Phase 2 adds backdated entry (Book starts 2026-01-01 then 2025 data must be inserted at the front without breaking dates), bulk Excel ingestion, single-operator auth (Landing visible to all but ledger restricted to Super Admin + TOTP), missing start-time capture, integer-km book-matching, in-tank fuel nuances, and readable ledger/dashboard density — all while keeping the digital book auditable against the paper original. Later phases add tiered time estimation, dark Digital Vehicle Cluster, and Fuel Economy Trend year footer / palette alignment.

## Solution

A high-fidelity digital counterpart to the physical running chart Book. Phase 1 delivers Google Sign-In, Vehicle profiling, quick Trip entry with reciprocal Start+Distance=End and End−Duration=Start calculations, Day Group fuel propagation, pagination constraints (4 days / 13 trips / month rollover), Dual-Side Ledger (Side 1 Trips Log + Side 2 Fuel Economy & Position), Dashboard & Analytics, All Trips Master Table, and book-mirror Excel export.

Phase 2 adds: an authenticated Help Page; Excel Trip Import with pre-flight validation; chronological Page renumbering on retroactive insertion with re-editable Book Opening; Estimated Start Time (tiered speed `<10→15, <20→20, <40→25, ≤60→30, >60→35` ceiled to 5 min, ADR-0018) auto-suggest plus manual override and optional Start Time; Landing login page with Super Admin (Neranjan) forced password change + TOTP + Recovery Code (single-operator, Gmail allow-list removed ADR-0010/0019); "Trip Added" toast + redirect to Dashboard; Transposed Side 2 tables mirroring the physical book layout; revised fuel arithmetic `Closing = Position + In-Tank + Drawn − Consumed` with In-Tank default 0; Integer KM (no decimals) for odometer fields with fuel at 1 decimal; clear-font spacious ledger tables; Dashboard dark Digital Vehicle Cluster (brand/model/type/fuel/reg/tank in visor, ODO barrel + semicircular gauge) + Monthly Distances dark card (This/Previous month with counts + progress bar) + Fuel Economy Trend (green bars, year/range footer, odometer gaps) + Fuel IN Summary 70:30 split; Vehicle Registration No and removal of current fuel level from profile; last-12 Months/Pages summaries with More modal; and Continuity Break alerts with persistent RED/AMBER banners.

## User Stories

### Phase 1 (carried forward)

1. As a driver, I want to authenticate using my Google account, so that my running chart data is securely associated with my profile.
2. As a transport manager, I want to create and configure a Vehicle profile (Brand, Model, Type, Fuel Type, Tank Capacity), so that all logs adhere to specific Vehicle specifications.
3. As a driver, I want the system to auto-select today's date and display the corresponding day of the week, so that I don't have to manually look up calendar days.
4. As a driver, I want the Start KM of a new Trip to automatically default to the last recorded End KM with visual highlighting, so that odometer continuity is never broken.
5. As a driver, I can manually override the Start KM if needed with clear visual indication, so that exceptional adjustments can be recorded.
6. As a driver, when I enter the Trip End KM, the system should automatically calculate the Trip Distance, and vice versa, so that manual math errors are prevented.
7. As a driver, when entering trip times, the End Time defaults to the current time, and entering Trip Duration automatically computes the Start Time, or entering Start Time calculates the Duration.
8. As a driver, I want to classify each Trip as Official (default) or Private, so that official duties and private mileages are distinctly tracked.
9. As a driver, I want to record Places Visited (route/purpose) and optional fuel Drawn amount along with its Fuel Order Number and date, so that fuel inflows are tracked per Trip.
10. As the system, I want to enforce strict physical Book constraints (maximum 4 Days per Page, maximum 13 Trips per Day Group, and a new calendar month always forcing a new Page), so that digital records mirror physical Books perfectly.
11. As a transport auditor, I want to view the Dual-Side Ledger (Side 1: Trips Log table, Side 2: Fuel Economy & Consumption + Fuel Position & Balance tables) with page navigation, so that I can inspect logs exactly as they appear in the physical Book.
12. As a transport auditor, I want the system to automatically calculate daily Fuel Economy (km/L), propagate default economy values to subsequent Day Groups until modified, and compute Consumed and Closing Balance rounded to 1 decimal place.
13. As a transport auditor, I want End KM of Page N to automatically equal Start KM of Page N+1, and End Fuel Balance of Page N to equal Fuel Position of Page N+1 Day 1, so that strict ledger continuity is maintained.
14. As a manager, I want a dedicated Dashboard & Analytics tab showing current month Official KM, Private KM, Total KM, estimated fuel level, monthly breakdown charts with numerical values displayed for official and private km, and page-wise distance visualization.
15. As a manager, I want a scrollable All Trips Master Table to inspect, filter, and search all historical Trips across all Pages.
16. As a manager, I want to export running chart records and summaries to Excel (.xlsx) as a structured single sheet mirroring the physical Book layout, so that I can easily print or archive records.
17. As a user, when I select any date in the date picker, the app should instantly show the correct day of the week.

### Phase 2 Improvements

18. As an authenticated user, I want a Help Page at `/help` linked from the header, so that I can read how Book Opening, reciprocal calculations, pagination rules, fuel formulas, Import template, and auth roles work without leaving the app.
19. As a data clerk, I want to bulk-import Trips from an Excel file (`.xlsx`), so that historical books can be digitized without manual retyping.
20. As a data clerk, I want the Trip Import to validate pre-flight against essential fields (Date, Start KM, End KM, End Time, Places Visited) and pagination rules (4 days / 13 trips / month rollover) before any write, so that bad rows never partially corrupt the Book.
21. As a data clerk, I want the import template columns defined as Date (YYYY-MM-DD) | Start KM (int) | End KM (int) | Distance (int auto) | Start Time (HH:MM optional) | End Time (HH:MM) | Type (Official/Private default Official) | Places Visited | Fuel Pumped (L) | Fuel Order No, with distance auto-derived as `round(end − start)` if blank, so that the file is self-documenting.
22. As a Book keeper who started the Book on 2026-01-01 at 50,000 km with Opening Fuel 10 L on Page 1 and later enters 2025-01-01 Trips, I want those older Trips inserted as new Pages 1–2 and the existing Pages renumbered chronologically 1..N (dates unchanged, only Page numbers), so that the Book remains strictly chronological.
23. As a Book keeper, I want the Book Opening (Opening KM and Opening Fuel) entered on the first Page and re-editable when retroactive Pages are inserted, recalculating fuel balances forward from the earliest Page, so that older histories carry correct opening stock.
24. As a driver, I want Start Time auto-suggested as `End Time − (Trip Distance / speed)` tiered by distance (`<10→15, <20→20, <40→25, ≤60→30, >60→35 km/h`), ceiled to the nearest 5 minutes, when Distance and End Time are present but Start Time is empty, so that I don't have to estimate manually.
25. As a driver, I want an explicit "Auto" button in the time section of the Trip form that recomputes Estimated Start Time even when Start Time is already filled, so that I can re-estimate after editing distance or End Time.
26. As a driver, I want to manually type and override any auto-suggested Start Time, so that exceptional waits or stops are recorded accurately.
27. As a driver, I want End Time to auto-fill with the present time on form load and be overrideable to any HH:MM, so that the common case is one tap.
28. As a driver, I want to save a Trip even without Start Time, so that incomplete field notes can be captured and completed later.
29. As a visitor, I want a Landing login page as the only view when unauthenticated, showing Super Admin password + TOTP login and Recovery entry, so that ledger data is not exposed.
30. As Neranjan (Super Admin), I want to sign in with username Neranjan and password `SupAd@2000` (hashed) plus TOTP, and be forced to change the password and enroll TOTP on first login, so that the bootstrap credential is not reused.
31. (Removed — Gmail allow-list / Google SSO deleted; system is single-operator ADR-0010/0019, /settings/access removed.)
32. (Removed — Allowed Email user SSO deleted; single-operator only.)
33. As any unauthenticated user I must see only Landing (and /recovery), and as any non-Super Admin I am Landing Gate hard-redirected before any ledger fetch, so that data isolation holds.
34. As a driver, when a Trip is saved I want a toast "Trip Added" and an automatic redirect to Dashboard, so that feedback is immediate and I see the updated metrics.
35. As a transport auditor, I want Side 2 Fuel Economy & Position tables Transposed to mirror the physical Book's landscape layout (days as columns matching Side 1 orientation, or a toggle), so that the digital Book prints identically to paper.
36. As a transport auditor, I want Fuel arithmetic to use Position + In-Tank Fuel + Drawn − Consumed = Closing Balance, with In-Tank default 0 unless typed on the first Trip of a Day Group, so that tank stock already on board is distinguished from pumped fuel.
37. As a driver, I want Start KM, End KM, and Trip Distance stored and displayed as Integer KM with no decimals (fuel retains 1 decimal), so that the display matches the integer odometer book.
38. As an auditor, I want ledger tables in a clear monospace font with strong grid column lines, sticky headers, slightly reduced font (13px body / 11px header) and airy cell padding, so that columns are scannable and the Ledger view is more spacious.
39. As a manager, I want Dashboard cards showing Official Distance (This Month), Private Mileage (This Month), and Total (This Month) as Integer KM, so that monthly accountability is at a glance.
40. As a transport manager, I want the Vehicle profile to include Vehicle Registration No and to remove current fuel level (Opening Fuel now lives on Book Opening), so that the profile reflects the paper header.
41. As an auditor, when a Continuity Break is detected (Page N End KM ≠ next Start KM or End Fuel ≠ next Fuel Position, including In-Tank), I want an alert banner listing page, expected, and actual, with optional confirmed actions to renumber chronologically and recalculate fuel from Book Opening, so that gaps are surfaced not silently fixed.
42. As a manager, I want a header Global Search that live-filters (debounced) all Trips across all Pages by Date, Places Visited, Fuel Order No, Trip Type, and KM substrings, showing filtered count and summed Official/Private/Total distances, so that any history is found instantly.
43. As a manager, I want the Dashboard monthly and Page-wise summary tables to show only the last 12 months and last 12 Pages by default, with a More button opening a scrollable modal (max-height, sticky header) of all months/pages, so that the default view stays dense but full history is reachable.
44. As a driver, I want book continuity carried forward (Page N End KM = Page N+1 Start KM, End Fuel = next Fuel Position) recomputed after any retroactive insertion or Book Opening edit, limited to affected older Pages forward, so that later pages don't need manual edits.
45. As a manager, I want Excel export to include Vehicle Registration No and Integer KM formatting while keeping fuel at 1 decimal, so that the printed Book-Mirror matches Phase 2 ledger rules.
46. As a clerk viewing All Trips, I want the DAY column compact (`w-16`, header `DAY` `8px`, badges `9px` -2px) with no badge for Weekdays and abbreviated badges `Sat`/`Sun` RED, `Poya` YELLOW, `PH` BLUE, `MH` AMBER, `BH` RED, `HOL` SLATE, `Leave` ORANGE (dot, priority `Leave > Poya > MH > PH > BH > Sat/Sun`), so off-days scan without clutter.
47. As a clerk viewing All Trips, I want the ⋯ actions column sticky `right-0` with shadow and its menu rendered via portal (fixed, auto-flips above for last rows), so Delete/Insert After/Remove & Shift never clip inside the `overflow-auto` container.
48. As a clerk scanning the Off-day/Working summary bar, I want a RHS `Go to Latest records…` button that jumps to the last row of the current filtered table (or chronological latest), focused with `ring-2` flash, so I can reach the newest record instantly.
49. As a manager marking leave on `/calendar`, I want one-click preset pills `Annual Leave | Casual Leave | Medical Leave | Duty Leave | Duty Leave (Overseas) | Private Overseas` that fill the note box (`max 200`), plus free typing, so leave types are consistent.
50. As a manager on `/calendar` opening a Leave dialog for a date that already has trips, I want a `Show Trips →` button in that same dialog that navigates to `All Trips` and focuses the date’s first trip, so I can audit leave vs trips without searching.
51. As a clerk on `/calendar`, I want to right-click any date cell that has trips to see a context menu `Show Trip Details →` (header `YYYY-MM-DD · Day · N trip(s)`) that navigates to `All Trips?focus=<tripId>` and focuses that day, so date-to-ledger navigation is one gesture.

## Implementation Decisions

- **Framework & Architecture:** Next.js (App Router) + TypeScript + Tailwind CSS with existing design tokens (paper-sheet, paper-ledger, slate-surface, telemetry-cyan, trip-official/private) and JetBrains Mono for KM/fuel columns; reduce ledger body font and increase padding for spaciousness per Phase 2.
- **Backend & Database:** Supabase Postgres + Google OAuth; add tables/columns for profiles (Super Admin flag, must_change_password), allow-list (allowed_emails array or separate table), and Book Opening history; Landing and all ledger routes behind authenticated guard except Landing.
- **Book Opening & Retroactive Insertion:** Introduce Book Opening as the earliest Page's Opening KM / Opening Fuel, editable in Settings; on any Trip/Import whose earliest date precedes current earliest Page, sort all Pages chronologically, renumber 1..N, cascade `page_number`/`page_id` and `Trip.page_id`, keep dates immutable, and recalculate ledger fuel forward from the Opening (see ADR 0001).
- **Integer KM Migration:** Switch odometer storage/display from 1-decimal rounding to integer rounding; migrate existing rows by `Math.round`; distance remains `end − start` integer and reciprocal calculations adapt (see ADR 0002).
- **Fuel Model Change:** Replace `current_fuel_level` on Vehicle with day-level In-Tank Fuel (default 0, editable on first Trip of Day Group) and close as `Position + In-Tank + Drawn − Consumed` rounded to 1 decimal; remove current fuel level from profile and add Vehicle Registration No (see ADR 0003).
- **Time Estimation Engine:** Highest seam reuses odometer distance tiered: `speed = getSpeedForDistance(distance)` (`<10→15, <20→20, <40→25, ≤60→30, >60→35`), `estimatedMinutes = ceil( (distance/speed)*60 /5)*5` (ADR-0018); auto-fills Start Time only when empty and End Time + Distance present; explicit Auto button recomputes on demand; End Time defaults to now and remains overrideable; `start_time` becomes nullable and persistence allows empty string/null.
- **Trip Import Pipeline:** New import module parses Excel via existing workbook library, maps template columns, validates essential fields and pagination constraints (4 days / 13 trips / month) pre-flight with row-numbered error report, then reuses the existing page-assignment and continuity engine for bulk writes; on success toast "N trips added" and redirect to Dashboard.
- **Auth & Allow-List:** Single-operator auth (ADR-0010/0019): Supabase/Postgres with Super Admin bootstrap (hashed `SupAd@2000`, forced change + TOTP enrollment), TOTP (RFC 6238, AES-256-GCM) + single-use Recovery Code at /recovery; Gmail allow-list and Google SSO deleted (`/settings/access` removed), Landing Gate hard-redirects every route except Landing and /recovery.
- **Ledger & Dashboard Presentation:** Side 2 tables Transposed (days as columns) matching Side 1 orientation; Dashboard dark Digital Vehicle Cluster (`dashsample.html` bezel/visor/ODO barrel/semicircular gauge, ADR-0019) + Monthly Distances dark card (This/Previous month with trip counts + Business/Private progress bar) in 12-col grid, Fuel Economy Trend 70% (`trip-official` green bars, `DD Mon` per stem + year/range footer `YYYY` or `MMM YYYY — …`, odometer gaps RED hatched) + Fuel IN Summary 30% (6 rows + MORE); monthly and Page-wise breakdowns default to last 12 with More modal; continuity alerts persistent RED/AMBER banner + compact alert bar with View All Trips link.
- **All Trips Polish (2026-09-16):** DAY column compact `w-16` (`64px`), header `DAY` `8px`, badges `9px` (-2px) — `Weekday` empty (`—`), `Sat`/`Sun` RED, `Poya` YELLOW, `PH` BLUE, `MH` AMBER, `BH` RED, `HOL` SLATE, `Leave` ORANGE + dot, priority `Leave > Poya > MH > PH > BH > Sat/Sun` (`components/dashboard/AllTripsMasterTable.tsx:1403,1489`, `CONTEXT.md:150`); ⋯ column `sticky right-0` with `shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.08)]` and menu via `createPortal` fixed + auto-flip above for last rows to avoid `overflow-auto` clipping (`AllTripsMasterTable.tsx:1609`); Off-day/Working summary bar RHS `Go to Latest records…` (`AllTripsMasterTable.tsx:1380`) jumps to last filtered row / chronological latest via `rowRefs` + focused flash.
- **Calendar & Leaves Polish:** Preset pills `Annual Leave|Casual Leave|Medical Leave|Duty Leave|Duty Leave (Overseas)|Private Overseas` fill `leave-note-input` `max 200` (`app/calendar/page.tsx:16,325`, `CONTEXT.md:202`); Leave dialog shows `Show Trips →` (amber bar + `data-testid="leave-show-trips-btn"`) when that date has trips, navigating to `All Trips?focus=<firstTripId>` (`page.tsx:327`); calendar date cells support `onContextMenu` → `Show Trip Details` portal (`data-testid="calendar-context-menu"` / `calendar-show-trip-details-btn`) at `clientX/Y` clamped, same `?focus` navigation (`page.tsx:90,249,508`).
- **Help Page:** Authenticated route rendering local markdown covering Book Opening, reciprocal End↔Distance, time estimation formula, import template, pagination rules, fuel arithmetic, retroactive renumber, and auth roles; linked from header.
- **Excel Export Update:** Workbook generation keeps single-sheet Book-Mirror, now including Vehicle Registration No, Integer KM number formats, and fuel at 1 decimal; column widths and page-setup retained for print.

## Testing Decisions

- **What makes a good test:** Test external behavior at the highest seam that covers the requirement, not internal component wiring; assert on pure function outputs, rendered ledger cards, and page continuity invariants rather than private state.
- **Which modules will be tested:**
  - Trip & time reciprocals and Estimated Start Time ceiling (distance-first, tiered speed `<10→15, <20→20, <40→25, ≤60→30, >60→35`, ceil 5 min, optional Start Time, End Time default now).
  - Integer KM rounding and odometer reciprocals (Start+Distance=End) plus boundary checks (4 days / 13 trips / month rollover).
  - Pagination, chronological renumbering, Book Opening re-edit, and cross-page odometer/fuel continuity (including In-Tank in the formula).
  - Fuel propagation (economy inheritance, fallback 10.5, `Position+InTank+Drawn−Consumed` at 1 decimal, Transposed Side 2 totals).
  - Trip Import pre-flight validation (essential fields, template column mapping, distance auto-derive, pagination breach reporting, bulk write via assignment engine).
  - Dashboard This-Month/Previous-Month dark card + Digital Vehicle Cluster (brand/model/fuel/reg/tank in visor, ODO barrel, fuel gauge) + Fuel Economy Trend (green bars, year footer, gap rendering) + Fuel IN Summary 70:30, monthly/Page-wise last-12 + More modal data.
  - Auth single-operator gating (Super Admin bootstrap + forced change + TOTP + Recovery Code, Landing Gate hard-redirect, /settings/access removed), Help Page visibility, and "Trip Added" toast + redirect.
- **Prior Art:** Prior phase ledger and financial-audit calculation tests, Excel workbook snapshot tests, and dashboard filter/sort tests; reuse those patterns for new seams rather than adding low-level component mocks.
- **Proposed seams (for confirmation — 6 seams, existing preferred, ideal is one):**
  1. Trip & Time Calculation Engine (reciprocals, Integer KM, Estimated Start Time ceiling, day-of-week)
  2. Pagination & Renumbering Engine (4/13/month, chronological 1..N renumber, Book Opening, continuity invariants)
  3. Ledger Fuel Engine (economy propagation, In-Tank, Closing arithmetic, Transposed Side 2)
  4. Trip Import & Excel Export (template parse, pre-flight validate, bulk assign, book-mirror workbook)
  5. Dashboard & Global Search (This-Month metrics, last-12 + More, live header filter/sums)
  6. Auth & Access (Landing, Super Admin, allow-list, SSO gate, Help visibility)

## Out of Scope

- Multi-tenant enterprise fleet dispatching and GPS hardware telemetry tracking.
- Native offline-first mobile app binaries (PWA web deployment is supported).
- Multi-currency fuel cost accounting (liters and fuel order numbers are tracked as specified).
- Real-time GPS speed adaptation for time estimation (tiered table, not GPS) and reserved-gap page numbering (configurable print offset may be added later).
- Full i18n/localization and role-based row-level policies beyond Super Admin / Allowed Email.

## Further Notes

- Domain glossary lives in `CONTEXT.md` (Book, Page, Trip, Vehicle, Book Opening, Fuel Economy/Position/In-Tank/Drawn/Consumed/Closing Balance, Adjusted Fuel Economy, Page-Wide Trip Sequence, Integer KM, KM/Fuel Gap, Super Admin, TOTP, Recovery Code, Landing, Help Page, Trip Import, Estimated Start Time, Continuity Break/Alert, Digital Vehicle Cluster, Fuel Economy Trend, Monthly Distances Tile, Fuel-IN Summary, Dashboard Auto-Refresh) — spec uses those exact terms.
- Decisions hard to reverse are recorded in `docs/adr/0001-chronological-page-renumbering`, `0002-integer-km-fuel-decimals`, `0003-fuel-formula-with-in-tank`, `0004-super-admin-gated-google-sso`, `0010-totp-recovery-code-replaces-google-sso`, `0017-dashboard-monthly-distances-and-fuel-economy-trend`, `0018-tiered-estimated-start-time`, `0019-dashboard-dark-cluster-fuel-trend-year-and-access-removal`.
- To publish this specification to the configured GitHub issue tracker (`neranjanr/cebrunningchart`) with triage labels, the agent uses `gh issue create` with `ready-for-agent`.

