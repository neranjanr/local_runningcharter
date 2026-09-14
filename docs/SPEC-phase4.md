# Running Chart — Phase 4 Specification

**Author:** Neranjan Rathnayake (github.com/neranjanr)  
**Credits:** OpenCode, Alacrity, MattPocock tools, Gemini, DeepSeek  
**Status:** Local spec — grilling completed Sat 2026-09-13 / Mon 2026-09-15 Phase 3 tree extended. Builds on Phase 3 without breaking pagination invariants (4 days / 13 trips / month rollover).  
**Context ref:** `CONTEXT.md:56-60` KM Gap / Fuel Gap, `CONTEXT.md:120-134` Trip Type / Private Trip (Bold Row) / Gap Fill Trip / Inserted Trip (Shift) / Removed Trip (Shift).

---

## Problem Statement

Phase 3 delivered strict Landing Gate, Adjusted Fuel Economy (±0.1/badge), full-width Ledger stack, All Trips Workbook, Integer KM, and two-color continuity alerts (RED KM vs AMBER fuel). Two fidelity gaps remain:

- Private vs Official is badge-only; the paper book bolds the entire private row — digital Ledger and All Trips should mirror that for audit scannability and print.
- Odometer discontinuities surface as alerts but have no first-class fix: a 10 km gap `100-110 → 120-130` requires manual Trip creation with hand-typed `110-120`; inserting a Trip in the middle of a continuous chain `100-110,110-130,130-150 → +110-120` requires hand-editing every downstream `Start/End KM` (+10 shift); removing a bridging Trip similarly requires hand-patching downstream KMs (`−Δ` shift). No confirmation gate protects these bulk shifts.

Phase 4 closes this with three All-Trips-only operations and a visual rule, without changing pagination invariants.

---

## Solution

Phase 4 is a local, non-breaking extension on top of Phase 1–3:

- **Private Trip (Bold Row)** — entire `<tr>` bold (`font-semibold`) when `trip_type==='Private'` in both Ledger `Side1TripsLog` and All Trips Master Table, preserving `bg-orange-200` and letting RED `bg-red-100` win on the gapped Start KM cell. Print retains bold.
- **Gap Fill Trip** — mutation visible only when a Trip-level **KM Gap** is detected (`detectTripGaps()` `lib/continuityAlerts.ts:62`). Row shows `+ Fill Gap Δ km` chip on the RED Start KM cell and a `Fill Gap (110→120)` entry in the row ⋯ menu. Dialog auto-fills `Start KM = predecessor End KM`, `End KM = successor Start KM`, `Distance = End−Start`, `Date = predecessor Date`, `Trip Type = Official`; date editable within `[predecessor Date, successor Date]`, other fields (Places Visited, Times, Fuel) manually entered. Save is No-Shift — it exactly consumes the gap extent; pagination validated pre-flight (`validatePaginationConstraints`).
- **Inserted Trip (Shift)** — `Insert After` entry in row ⋯ menu on every Trip (All Trips only). User picks `Date` (default predecessor Date, same clamp), `Start KM/End KM` (free, distance auto-derived), and other fields. On confirm, a new Trip is inserted at that chronological position (`date || start_km` sorted) and all downstream Trips shift uniformly by `Δ = new.end − new.start` (`start_km += Δ`, `end_km += Δ`, `trip_distance` frozen). `BookPage` start/end KM + fuel chain (`recalculatePageBalancesFromOpening`) are recomputed forward; pagination auto-splits via `assignPageForNewTrip`/`createNextPage` when `MAX_TRIPS_PER_DAY=13` or `MAX_DAYS_PER_PAGE=4` or month rollover would be breached.
- **Removed Trip (Shift)** — `Remove & Shift` entry alongside plain **Delete** (no-shift) in row ⋯ menu. Deletes the selected Trip and shifts downstream Trips down by `Δ = removed.end − removed.start` (`−= Δ`), with same fuel chain recompute. Empty Pages retained v1 (not collapsed) but continuity patched.
- **Confirmation gate** — both Insert and Remove/Shift and Gap Fill show a modal previewing `N shifted trips`, `Δ` (±), and a before→after table for the first 3 downstream rows (`+M more`). Cancel/Confirm; on Confirm, toast `Trip inserted — N trips shifted by Δ km` / `Trip removed — N trips shifted by −Δ km` and validation via `validatePaginationConstraints`; fuel gaps, if any, surface as AMBER alerts (non-blocking).

Ledger remains read-only for these mutations (bold only); all shifts own in All Trips.

---

## User Stories

### Private bold

**1.** As an auditor, I want every Private Trip row rendered fully bold (entire row, both Ledger and All Trips, print included) so private mileage is instantly scannable while preserving the orange background and RED gap override on Start KM.

### Gap Fill

**2.** As a clerk seeing a RED KM Gap `Trip 100-110 → 120-130 (gap 110-120)` in All Trips, I want a `+ Fill Gap 10 km` chip on the successor’s RED Start KM cell and a `Fill Gap (110→120)` menu item on the predecessor row, so the gap is actionable where it is detected.

**3.** As a clerk filling a gap, I want a dialog with `Start KM` and `End KM` auto-filled as `110` and `120`, `Date` as predecessor Date, distance auto-derived, other fields to fill, date editable within bounds, validated like `validateTripForPage` (Places Visited non-empty, `End ≥ Start`, `trip_type` in list), and on save the gap closes with no downstream shift and pagination still enforced.

### Insert After (Shift)

**4.** As a clerk with `100-110, 110-130, 130-150` wanting to insert `110-120` after row 1, I want `Insert After` on row 1 to open a dialog defaulting `Date = row 1 Date` with free KM fields; on confirm, downstream KMs become `120-140, 140-160` (Δ=10) uniformly across pages, with fuel chain recomputed forward and pagination auto-splitting if needed.

**5.** As a manager, I want Insert-After insertion point defined chronologically (`date` then `start_km`) so “below” means all later Trips in `continuityAlerts.ts:63` order regardless of page or day, and be shown a confirmation modal `Insert Trip — Shift N trips by Δ km?` with a 3-row before→after preview before commit.

### Remove & Shift

**6.** As a clerk removing bridging Trip `110-120` from `100-110,110-120,120-140,140-160`, I want `Remove & Shift` to delete it and shift downstream `120-140→110-130, 140-160→130-150` (`−Δ = −10`), with fuel recomputed, pages patched, and a confirmation `Remove Trip — Shift N trips by −Δ km?` with preview; plain `Delete` (no shift) remains available and may leave a newly surfaced RED gap instead of shifting.

### Cross-cutting

**7.** As an unauthenticated visitor, nothing changes — all mutations stay behind `ProtectedRoute`/`Landing Gate`; as an authenticated user, mutations fire only from All Trips, preserve Integer KM (`Math.round` on blur/save, `numFmt '0'`), recompute fuel via `computeLedgerDays`/`fuelMap`, and keep existing RED/AMBER continuity banners (new gaps after Remove appear, filled gaps clear).

---

## Implementation Decisions

- **Framework:** Next.js App Router + TypeScript + Tailwind. Ledger `Side1TripsLog.tsx:98` already maps `flatTrips`; add `trip_type==='Private'` → `font-semibold` on `<tr>` plus `font-bold` on badge, preserving `bg-orange-200` `AllTripsMasterTable.tsx:634`. RED `bg-red-100` class on Start KM cell retains precedence via cell-level override. Print helper already present (`BookLedgerView.tsx:198` `@media print`) — add `font-weight:600` rule for Private rows.
- **Gap detection:** Reuse `detectTripGaps()` (`continuityAlerts.ts:62`) which sorts `date || start_km`; derive `predecessor = sorted[i]`, `successor = sorted[i+1]` where `expectedEnd !== actualStart`. Derive `gap = actualStart − expectedEnd`. Button visibility: `tripKmGapIds` (`AllTripsMasterTable.tsx:74`) drives gap set; chip rendered only on successor row’s Start KM cell, menu item only on predecessor row.
- **Gap Fill flow:** New component `GapFillDialog` (or inline modal in `AllTripsMasterTable`): props `{predecessor, successor, expected, actual}` → initial form `date=predecessor.date`, `start_km=expected`, `end_km=actual`, `trip_distance=actual−expected`. Date `<input type="date">` bounded `[predecessor.date, successor.date]`; `Places Visited` required; `End Time` required. On submit: `validateTripForPage` + `validatePaginationConstraints` pre-flight; if gap already closed (concurrent), show “Gap no longer exists”.
- **Insert After flow:** New `InsertAfterDialog` per row: `defaultDate = predecessor.date`, free `start_km/end_km` (if user leaves contiguous, auto-suggest `start = predecessor.end_km`). On confirm: build new `Trip` with `page_id` via `assignPageForNewTrip` (honors 4/13/month), then `shiftDownstream()` helper: `for each t in sortedTrips where index > insertIndex: t.start_km += Δ, t.end_km += Δ, t.trip_distance unchanged (re-derive is no-op since shift preserves distance)`. Persist via existing `saveTrip` + bulk `/api/import` path for downstream patches, or new `shiftTrips` pure helper (`lib/tripShift.ts`). Then `recalculatePageBalancesFromOpening` for all affected Pages; `getEarliestOverallDate` not needed (no back-date).
- **Remove & Shift flow:** New `RemoveShiftDialog`: compute `Δ = removed.end − removed.start`, `affected = sorted.indexOf(removed)+1 … end`. Preview first 3. On confirm: `deleteTrip(removed.id)` then patch downstream `−Δ` and same fuel/page recompute. Keep `deleteTrip` (no shift) intact; label menu `Delete` vs `Remove & Shift`. Confirmation modal copy: `Remove Trip — Shift N trips by −Δ km? This cannot be undone without re-inserting.` Empty page: if `getDistinctDates(pageTrips)` becomes 0, page stays (render “No trips” per `Side1TripsLog:39`) and its `end_km = start_km` until next insert.
- **Fuel chain:** After any shift, recompute ledger chain: `fuelMap` in `AllTripsMasterTable.tsx:91` already runs `computeLedgerDays` per page with `getFuelEconomiesForPage`/`getInTanksForPage` and a continuous `runningFuelPos`. No per-trip fuel pumped mutation; `calculateBalance` downstream updates automatically. Surface any new `detectDayGroupFuelGaps` AMBER without blocking.
- **Help/manual:** Update `app/help/page.tsx` sections array with `12. Private Trip Bold` and `13. Gaps — Fill vs Insert vs Remove & Shift` (auditable help, still behind `ProtectedRoute`), and link from header `?`.
- **Excel:** Export (`generateAllTripsBuffer`) picks up shifted KMs automatically; import path unchanged.

## Testing Decisions

- **What makes a good test:** Highest seam — pure gap detection, shift helpers, page continuity, rendered bold+chip/menu, modal previews, pagination invariants — not component wiring.
- **Which modules will be tested:**
  - Private bold: Ledger + All Trips rows with `trip_type='Private'` render `font-semibold`/`bg-orange-200` and print rule; Official rows not bold.
  - Gap detection & Fill visibility: `detectTripGaps` with `100-110 → 120-130` gap shows chip on successor and menu on predecessor only; clicking chip opens dialog with pre-filled `110/120` + predecessor date.
  - Gap Fill save: pre-filled saves with no shift, gap clears, `validateTripForPage` rejects empty Places, date clamp rejects successor+1 day.
  - Insert shift: `100-110,110-130,130-150` + insert `110-120` after row1 → downstream `120-140,140-160` (pure `shiftTrips` helper + `recalculatePageBalancesFromOpening` invariant `validateOdometerContinuity` holds).
  - Remove shift: remove `110-120` from 4 → downstream `−10`; plain Delete leaves gap (separate test).
  - Pagination auto-split: Insert that would make 14 trips on same date → new Page created via `assignPageForNewTrip(MAX_TRIPS_PER_DAY)`; remove that empties a page keeps page but patched continuity.
  - Fuel chain: after shift, `detectDayGroupFuelGaps` unchanged or correctly AMBER; `computeFilteredSums` still Integer KM.
  - Confirmation gate: Insert/Remove modals require explicit Confirm; Cancel leaves trips untouched.
- **Prior Art:** Reuse `pagination.test.ts`, `continuityAlerts.test.ts`, `ledgerCalculations.test.ts`, `allTripsWorkbook.test.ts`, `tripStore.test.ts` patterns.
- **Proposed seams (for confirmation — 5 seams):**
  1. Private bold (`components/ledger/Side1TripsLog`, `AllTripsMasterTable`, `app/help/page.tsx`)
  2. Gap detection & Fill (`lib/continuityAlerts`, `AllTripsMasterTable` gap chip + dialog)
  3. Insert/Remove shift engine (`lib/tripShift` pure + `lib/pagination` recompute)
  4. Fuel chain recompute (`lib/ledgerCalculations` + `AllTripsMasterTable fuelMap`)
  5. Help & Spec docs (`app/help/page.tsx`, `docs/SPEC-phase4.md`, `CONTEXT.md`, `docs/adr/0013`)

## Out of Scope

- Ledger-side mutation (Ledger stays read-only for Fill/Insert/Remove; bold only).
- Undo/redo stack (Cancel+re-insert is sufficient v1; can add history later).
- Reserved-gap page numbering, multi-currency, PWA binaries, i18n.
- Auto-recalculation/fix beyond the defined shift recompute; gaps that remain after Remove stay as RED alerts until filled.

## Further Notes

- Glossary lives in `CONTEXT.md` — Phase 4 adds `Private Trip (Bold Row), Gap Fill Trip, Inserted Trip (Shift), Removed Trip (Shift)` (q.v.).
- Decisions hard to reverse recorded in `docs/adr/0013-trip-gap-fill-insert-remove-shift.md`.
- Source refs: `CONTEXT.md:56` KM Gap, `lib/continuityAlerts.ts:62` trip gaps, `components/dashboard/AllTripsMasterTable.tsx:74,91,634` gap set/fuelMap/private row, `components/ledger/Side1TripsLog.tsx:98,102` ledger rows, `lib/pagination.ts:13,96,236` limits/continuity/recalc, `types/index.ts:29` Trip, `app/help/page.tsx:7` help sections.
