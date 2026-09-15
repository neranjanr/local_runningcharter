# ADR 0021: Estimated Start Time Auto-Fill on Excel and Sheet Pull Import

Date: 2026-09-15
Status: Accepted
Deciders: Neranjan

## Context

`Trip.start_time` is optional (`""` when not captured, `types/index.ts:36`, `lib/db.ts:46 NOT NULL` stores `""`). `estimateStartTime(endTime, distance)` tiered by distance (`<10→15 <20→20 <40→25 ≤60→30 >60→35 km/h`, ceil 5 min, `lib/tripCalculations.ts:48`) already auto-filled in QuickTrip forms when start empty and on the All Trips import UI loops (`AllTripsMasterTable.tsx:835,1021`). A direct `POST /api/import` or future caller bypassing the UI would leave empty starts empty; grill Q1 required a canonical fix.

Grill decisions: Q1 canonical at parser level, Q2 reject only if `end_time` empty (essential field), keep `""` if distance ≤0 gives `null`, Q3 overwrite on same Odo Key (`date|start|end`), Q6 no silent patch of rows outside import set, Q7 no schema marker.

## Decision

- Excel path: `lib/allTripsWorkbook.ts:366` `parseAllTripsWorkbook` now computes `effectiveStart` — if `startTimeStr` empty and `endTimeStr` + `distance>0` present, call `estimateStartTime` and persist `HH:MM`; if estimation returns `null` keep `undefined` (stored as `""` via `createTripFromPartial:398`). `End Time` remains required; missing `end_time` still produces `ImportError` and blocks import.
- Sheet Pull path: `lib/sheetPull.ts:22` `toPartial` applies same estimation (mirrors workbook) so `compareBufferToDb` diff shows `start: -→08:50` and preview offers overwrite; `validRows` still requires `end_time`.
- UI loops in `AllTripsMasterTable` retained as fallback (idempotent) but no longer required for correctness.
- `CONTEXT.md:90` updated to document auto-fill on both import paths and reject/keep semantics.

## Alternatives Considered

- UI-only estimation — rejected: API bypass leaves empty starts; violates single source of truth.
- Store estimated flag column — rejected per Q7: plain `HH:MM` suffices, no migration.
- Reject rows with empty start — rejected: start is optional, only `end_time` is required.

## Consequences

- Any import (Excel .xlsx via workbook or Buffer Sheet via pull) now guarantees estimated starts without manual paste, matching QuickTrip form behaviour.
- `importTripsFromWorkbook` upsert treats estimated value as incoming diff; checked Changed rows overwrite DB start via `sameStart` check.
- Reversal requires removing the two estimation blocks and reverting CONTEXT.
