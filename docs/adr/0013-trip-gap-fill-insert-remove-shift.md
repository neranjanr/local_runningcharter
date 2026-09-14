# ADR 0013: Trip Gap Fill, Insert & Remove with Odometer Shift, Private Bold

Date: 2026-09-15
Status: Accepted
Deciders: Neranjan (Super Admin / single operator)

## Context

Phase 3 left two audit gaps visible as RED KM gaps (`CONTEXT.md:56` `detectTripGaps` `lib/continuityAlerts.ts:62`) with no first-class fix. Operators either hand-typed a closing Trip with exact `110→120` bounds or hand-patched every downstream `Start/End KM` when inserting/removing a bridging Trip. Both were error-prone and broke continuity alerts or pagination (`MAX_DAYS_PER_PAGE=4`, `MAX_TRIPS_PER_DAY=13`, month rollover `lib/pagination.ts:13`). The paper book also bolds Private rows; digital Ledger/All Trips mirrored only the orange background.

Options for “Add Trip for Gap” and “ADD RECORD in between” / “Remove Trip” were:

1. **Gap-only fix**: Only allow closing a detected gap exactly (`start=expected`, `end=actual`), no shift — simplest but cannot insert inside a continuous chain.
2. **Free insert with manual downstream edit**: Allow insert at any position, require user to edit downstream rows one-by-one — no invariant, high error.
3. **Insert/Remove with automatic uniform downstream shift by Δ** — preserves continuity by construction, recomputes Pages’ fuel chain, validates pagination.

Private bold options: badge-only vs inline Type cell vs full-row bold. Full-row bold is most scannable and matches the book.

## Decision

- **Private Trip (Bold Row) is whole-row bold** in both `Side1TripsLog` `components/ledger/Side1TripsLog.tsx:98` and `AllTripsMasterTable` `components/dashboard/AllTripsMasterTable.tsx:627`, keeping `bg-orange-200` and letting `bg-red-100` win on the Start KM gap cell. Print retains `font-weight:600`. Glossary added to `CONTEXT.md:121` as `Private Trip (Bold Row)`.
- **Three All-Trips-only mutations** (Ledger read-only):
  - **Gap Fill Trip** — visible only when `detectTripGaps()` reports a KM gap after predecessor. `+ Fill Gap Δ km` chip on the successor’s RED Start KM cell + `Fill Gap (expected→actual)` in predecessor row ⋯ menu. Dialog auto-fills `start=expected`, `end=actual`, `date=predecessor date` (clamped `[predecessor date, successor date]`), distance auto-derived. Save does **no shift** — it exactly consumes the gap.
  - **Inserted Trip (Shift)** — `Insert After` on any row. Free `start/end` + date (default predecessor date, same clamp). On confirm, downstream Trips in chronological `date || start_km` order shift uniformly by `Δ = new.end − new.start`; Pages recomputed forward via `recalculatePageBalancesFromOpening`.
  - **Removed Trip (Shift)** — `Remove & Shift` (distinct from plain `deleteTrip` no-shift). Deletes Trip and shifts downstream by `−Δ = -(removed.end−removed.start)` with same fuel/page recompute. Plain Delete stays available.
- **Confirmation gate before save/remove**: Modal shows `N trips will be shifted by Δ km` plus before→after table for first 3 downstream rows (`+M more`), Cancel/Confirm. Toast and continuity banner confirm result.
- **Fuel chain** recomputed forward after any shift via `computeLedgerDays`/`fuelMap` (`AllTripsMasterTable.tsx:91`); per-trip pumped values frozen, Day `Consumed/Balance` recomputed, AMBER gaps surfaced non-blockingly.
- **Pagination** auto-splits via `assignPageForNewTrip`/`createNextPage` when Insert would breach 13/day, 4/day/page, or month rollover. Remove that empties a Page retains the empty Page (rendered “No trips” per `Side1TripsLog:39`) with patched continuity.
- **Help** exposed at `/help` (`app/help/page.tsx:65`, still behind `ProtectedRoute` per Landing Gate) with two new sections documenting the visual rule and the three operations.

Glossary (`CONTEXT.md`) adds `Gap Fill Trip`, `Inserted Trip (Shift)`, `Removed Trip (Shift)`; spec lives in `docs/SPEC-phase4.md`.

## Alternatives Considered

- Gap-only fix: rejected — cannot handle the reported `100-110,110-130,130-150 +110-120 → 120-140,140-160` continuous-chain insert.
- Manual downstream edit: rejected — breaks `validateOdometerContinuity` and forces N edits for one intent.
- Shift-whole-book vs shift-downstream: chosen shift-downstream only; shifting the whole Book would also move predecessor KMs, breaking Book Opening and earliest ODO invariants.
- Ledger mutation: rejected — Ledger is the auditable read view; All Trips owns mutation so Book view stays stable.
- Bold on badge only: rejected — “entire raw” requested and whole-row bold is measurably more scannable in 600-row tables.

## Consequences

- **Positive**: Gaps become actionable in place; one Insert/Remove replaces N manual edits; RED gaps clear/reappear deterministically; Private mileage scannable and printable.
- **Negative/Risk**: Bulk shifts are hard to undo without re-insert/remove — mitigated by preview modal + requiring Places Visited + `End ≥ Start` validation. Shifting integer KMs via `Math.round` must stay integer (`roundToIntegerKm`). Pagination auto-split can create new Pages that need chronological numbering awareness; callers must route through `getPages`/`savePage` single transaction.

## Reversal

Reversing would require removing the ⋯ menu actions, the `lib/tripShift.ts` pure helper, and the glossary entries, and falling back to manual gap filling. The bold rule is a pure CSS reversal.
