# ADR 0023: Dual-Sheet Leaves Export/Import for Excel and Google Sheets

Date: 2026-09-16
Status: Accepted
Deciders: Neranjan

## Context

Grill `excel+google sheet leave export` (2026-09-16): Trips already export/import via `All Trips Workbook` single sheet `All Trips` (`lib/allTripsWorkbook.ts:18,39`) and `Buffer Sheet` single sheet `All Trips` (`quicktrip-mobile/apps-script/Code.gs:7`) with `Sheet Pull` Odo-Key comparison (`lib/sheetPull.ts:55`) and `Sheet Push` preservation (`lib/sheetPush.ts:23`). `LeaveDay {date, note?}` (`types/index.ts:65`, `CONTEXT.md:202` manual-only 2024–2027 ≤200-char) had no workbook/buffer representation, so backup/restore lost leaves.

## Decision

- **All Trips Workbook becomes dual-sheet** (`All Trips` 10-col + `Leaves` `Date|Note` aliases `Notes|Remark|Remarks|Leave Note`, strict order-enforced normalized header validation like `validateHeaders:224`, `Date` `YYYY-MM-DD` 2024–2027, `Note` ≤200 hard-error, sorted `date ASC`, tab amber `F59E0B`, frozen header, always header-only when empty; filename prefix unchanged).
- **Buffer Sheet becomes dual-sheet** (same spreadsheet, second sheet `Leaves`; `LockService` atomic `POST rewriteSheet {rows, leaves}` and `GET allRows {rows, leaves}` in `Code.gs`; old script returns `leaves:[]` and ignores `leaves` on push with a nudge — back-compat per grill Q6).
- **Import is independent per sheet**: `Leaves` keyed by `date` (one per date), dedup last-wins, hard-error on bad date/Note>200, **upsert-only never delete** (mirror odo-upsert `importTripsFromWorkbook:543` — absent leaves stay), valid unimported buffer leaves preserved (`date ∉ DB` appended, DB wins on collision, invalid ignored). `compareBufferLeavesToDb` mirrors trips but by `date` diffing `note`.
- **Export is atomic dual-sheet** (`LockService` reuses existing trips preservation: `computePreservedRows` → `computePreservedLeaves`). Preview modals gain a `Leaves — New/Changed/Skipped` section and push preview second line leaf counts; toast `Exported N trips + M leaves`.

## Alternatives Considered

- Single-sheet extra columns on `All Trips` — rejected: breaks parity with `Buffer Sheet` and trips pagination contract.
- Mirror-delete on import (absent leaves → delete DB) — rejected: destructive; manual leave requires explicit `Clear Leave` in calendar.
- All-or-nothing atomic import (trip error blocks leaves) — rejected: typo in leaves shouldn't block 200 trips; chosen independent pipelines.
- Separate spreadsheet for leaves — rejected: second `sheetId` doubles config and breaks `Sheet Settings` single-ID UX.
- Silent truncate `Note>200` — rejected: lossy; chosen hard-error like trips essential-field errors.

## Consequences

- `CONTEXT.md` extended: `All Trips Workbook`, `Buffer Sheet`, `Leaves Sheet` (new), `Sheet Pull Import`, `Sheet Push`, `Sheet Proxy`.
- Excel generator/parser, `sheetClient`, `sheetPull`/`sheetPush` leaf helpers, and `Code.gs` must be updated and redeployed as New Version (Anyone with link) for leaf sync; old deployments degrade gracefully.
- Reversal requires dropping second sheet and reverting dual helpers/script.
