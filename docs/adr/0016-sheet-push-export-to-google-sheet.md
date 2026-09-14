# ADR 0016: Sheet Push — Export to Google Sheet with Preserved Buffer Rows

Date: 2026-09-14
Status: Accepted
Deciders: Neranjan (Super Admin / single operator)

## Context

After ADR 0014 (Buffer Sheet + Sheet Proxy `appendTrip`/`allRows`/`last10` in `quicktrip-mobile/apps-script/Code.gs`) and ADR 0015 (Sheet Pull Import `Import from Google Sheet` via Odo Key `date|start_km|end_km` in `lib/sheetPull.ts:48`), the remaining gap was DB → Sheet. Requested as "Update Google Sheet Option — all trips available in db will be rewritten to google sheet but will not overwrite or damage new records not yet imported". Identity of "new records", rewrite atomicity, overwrites for same Odo Key, ordering, and UX symmetry with Import were ambiguous. Options:

- Trigger: manual Export button vs auto-sync on every DB write.
- Identity: Odo Key reuse vs sheet row number vs timestamp.
- Rewrite vs incremental append: full clear+write vs diff-merge vs append-only.
- Overlap: DB wins vs sheet wins for same Odo Key.
- Preserved placement: append at bottom in original order vs merged chronological vs sorted.
- Validity: preserve all buffer rows vs only valid rows (`date/places_visited/end_time/start_km/end_km` per `lib/sheetPull.ts:51`).
- Proxy: extend Apps Script with `POST rewriteSheet` + `LockService` vs client-side clear+append loop vs OAuth Sheet API.
- UX: 4-button header (`Import/Export × Excel/Sheet`) vs menu vs single sync button.

Constraints: single operator (`CONTEXT.md:62`), Integer KM `numFmt '0'` + fuel `0.0` (`docs/adr/0002`), same `mobile.sheetId`/`mobile.scriptUrl` + `Anyone with link` deploy as Pull (`lib/sheetClient.ts:32`, `components/SheetSettingsDialog.tsx:40`), large payload handling (Apps Script 6-min/50 MB), atomicity required per Q11, no DB schema change.

## Decision

- **Sheet Push (Export to Google Sheet)** — inverse of Sheet Pull Import. Manual only, via `Export to Google Sheet` `☁️↑` button next to renamed `Import from Google Sheet` `☁️↓` (formerly "Pull from Google Sheet" `components/dashboard/AllTripsMasterTable.tsx:1043`), plus existing `Import from Excel` / `Export to Excel`. Four distinct labels/icons per Q6–Q7.

- **Scope** — all DB Trips, sorted `date ASC → start_km ASC` (same order as `lib/allTripsWorkbook.ts:generateAllTripsBuffer` / `All Trips Workbook` `CONTEXT.md:102`), header row `ALL_TRIPS_HEADERS` (`lib/sheetClient.ts:6`) enforced. Builds in-memory array `BufferTrip[]` via `roundToIntegerKm`/`roundToOneDecimal` (`lib/tripCalculations.ts`).

- **Preservation** — identity = Odo Key (`getOdoKey` integer). Steps: `fetchAllRows()` → filter valid (`date && places_visited && end_time && isFinite start_km/end_km`) → dedupe buffer Odo Keys (first wins, same as pull `lib/sheetPull.ts:56`) → `preserved = bufferRows where odo ∉ DB` (Q3/Q5). DB wins for same Odo Key (overwrite). Preserved rows appended at bottom in original buffer order (Q8a), invalid rows ignored and counted as `invalidIgnored`.

- **Proxy extension** — new `POST rewriteSheet` (alias `pushAll`) in `quicktrip-mobile/apps-script/Code.gs`: `LockService.getDocumentLock().tryLock(30000)`, validate headers (`ensureHeaders_`), then single batch `sh.clear(); sh.getRange(1,1,1,HEADERS.length).setValues([HEADERS])` + `setNumberFormat` + `sh.getRange(2,1,rows.length,HEADERS.length).setValues(values)` with `sKm/eKm` as `0` and `fuel` as `0.0` (`Code.gs:97`). On failure lock release + `json_({ok:false})` leaving sheet untouched — atomic per Q11. Client flow: `GET allRows` → compute preserved → `POST rewriteSheet {rows: [...dbRows, ...preserved]}` in one call (chunk if > 5k rows).

- **Preview & audit** — `Push Preview` modal before commit: `DB rows N | Preserved M | Overwriting K | Invalid ignored X`, expandable preserved list (`date|start→end places`), `Anyone with link` hint if fetch fails. Block Confirm until `sheetId && scriptUrl`. On success toast `Exported — N rows (+M preserved)` + `setLastPushAt(iso)` to `localStorage mobile.lastSheetPushAt` (`lib/sheetClient.ts:77` pattern) shown as subtitle `Last Sheet push:` and button tooltip (Q12). Failure toast `Sheet not modified: <error>`.

- **Glossary** — `CONTEXT.md` UX: add `Sheet Push (Export to Google Sheet)`, `Push Preview`; amend `Sheet Settings` to mention `mobile.lastSheetPushAt`; amend `Sheet Proxy` to list `POST rewriteSheet` + `LockService`.

## Alternatives Considered

- Two-way auto-sync (poll/trigger on write) — rejected: quota/noise, conflicts with manual Excel mental model, surprising silent overwrite.
- Incremental append (only new DB rows not in sheet) — rejected: leaves edited DB rows stale in sheet; spec says "all trips ... will be rewritten".
- Interleaved chronological merge of preserved rows — rejected: hides pending rows among DB rows (Q8c); bottom-append keeps pending visibly distinct.
- Preserve invalid rows — rejected: pollutes sheet with half-typed mobile entries; filtered same as pull validity.
- Client-side loop `clear → appendRow×N` without lock — rejected: non-atomic, half-written on network drop; batch + lock required.

## Consequences

- Positive: one-click mirror makes Buffer recoverable from DB; offline-taken trips not yet imported survive (Odo Key preservation); atomic batch + formatting keeps Integer KM invariant; symmetric 4-button header clarifies direction.
- Negative/Risk: requires redeploy of Apps Script with `rewriteSheet`; redeploy must stay `Anyone with link` else `fetchAllRows` probe fails; large DB (>5k trips) may hit Apps Script execution limit — needs chunking or paginated push v2; DB edits silently overwrite sheet copy of same Odo Key (intended per Q5).
- Reversal: remove `rewriteSheet` branch from `Code.gs`, `setLastPushAt`/`getLastPushAt` from `lib/sheetClient.ts`, Export button + Push Preview from `AllTripsMasterTable.tsx`; glossary entries deleted; sheet retains last written state.
