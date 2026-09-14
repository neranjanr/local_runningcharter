# ADR 0015: Sheet Pull Import & Focused Trip Retention

Date: 2026-09-14
Status: Accepted
Deciders: Neranjan (Super Admin / single operator)

## Context

After ADR 0013 (Insert/Remove & Shift + Gap Fill) and ADR 0014 (QuickTrip Mobile PWA + Buffer Sheet), two UX gaps remained:

1. **Focus loss**: After Insert After / Remove & Shift / Delete / Gap Fill in `AllTripsMasterTable`, the table re-renders without scroll or highlight — user loses position in 600-row ledger. Needs deterministic focus onto the affected row without guessing pagination/filter state.

2. **Manual download import**: Buffer Sheet rows written by QuickTrip Mobile required `Download as .xlsx → Import Excel` manual step (`lib/allTripsWorkbook.ts`). A direct pull that reuses the same Sheet Proxy URL, detects only records not yet in DB, previews them, and asks consent before import was requested. "Path will be prompted and saved", "most recent records not available in db" — identity and pull semantics were ambiguous. Options:

- Focus: URL hash vs ephemeral state, scroll vs just highlight, clear filter vs keep hidden.
- Sheet identity: reuse `mobile.sheetId/scriptUrl` keys vs separate `import.*` keys; store in localStorage vs DB.
- Sheet proxy reuse: same Apps Script `?action=allRows` (already in `quicktrip-mobile/apps-script/Code.gs:42`) vs new endpoint or OAuth service account.
- Dedup key: Odo Key (`date|start|end` integer `lib/allTripsWorkbook.ts:246`) vs Duplicate Key (`+end_time`) vs full row hash; "most recent" as `max(date)` subset vs full set diff newest-first.
- Preview: auto-import all vs checkbox consent with Changed vs New split; pre-flight validation same pipeline or bypass.
- Trigger: manual button vs auto-poll/badge.

Constraints: single operator (`CONTEXT.md:62`), Landing Gate strict (`docs/adr/0005`), Integer KM + 1-dec fuel rounding (`docs/adr/0002`), no DB schema change for v1, offline tolerance (localStorage fallback per `AllTripsMasterTable.tsx:311`).

## Decision

- **Focused Trip**: Ephemeral `focusedTripId` state in `AllTripsMasterTable` (no URL hash). On insert/gap-fill → new trip id; on remove/delete → predecessor id (successor if earliest removed). If current `search/month/tripType` filter would hide the row, clear to `All + date asc` with toast "Filter cleared to show focused row", then `requestAnimationFrame` `scrollIntoView({behavior:'smooth', block:'center'})` + `ring-2 ring-telemetry-cyan bg-cyan-50` flash 3.2s via `rowRefs` map (`data-testid=trip-row-${id}`). Bulk sheet import focuses earliest new trip (`date||start_km` order, per grilled Q9 a) and briefly flashes all new ids. File preserves `components/ledger/Side1TripsLog` read-only.

- **Sheet Pull Import**: Manual only ("Pull from Google Sheet" `☁️` button next to Import Excel, plus gear `⚙` Settings, `components/dashboard/AllTripsMasterTable.tsx:832`). Reuses same Buffer Sheet and same Apps Script Web App URL as Mobile (`GET scriptUrl?action=allRows`, `POST appendTrip`). Settings via shared `SheetSettingsDialog` (`components/SheetSettingsDialog.tsx`) reading/writing `localStorage mobile.sheetId/mobile.scriptUrl` (`lib/sheetClient.ts`) with URL→ID extraction (`/d/<id>/`) and `?action=allRows` probe + `Anyone with link` deploy hint. Fetch failures keep error banner + Settings modal open; empty sheet toasts "Buffer Sheet up to date".

- **Comparison**: Identity = Odo Key (`getOdoKey` integer) per grill Q5 a. Buffer rows deduped internally (first occurrence wins), then sorted newest-first for preview (`date DESC||start DESC`). Buckets: New (odo not in DB, checked by default), Changed (same odo diff `places/start/end/type/fuel/order` → amber diff string `places: "A"→"B"` etc, unchecked), Skipped (exact duplicate). Total fetched shown in preview header. Changed ≠ auto-import — requires explicit check.

- **Pipeline reuse**: Selected partials → `estimateStartTime` if start missing → split `newOnly` for `validateNoOverlap`/`validatePaginationForImport` (changed rows are upserts) → `importTripsFromWorkbook` → bulk `POST /api/import` with localStorage fallback then per-trip `POST/PUT /api/trips` fallback (same as file import). Success toast "Pulled — N new, M updated", persisting `mobile.lastSheetPullAt` ISO for header tooltip and `Last Sheet pull:` subtitle. Failures block Confirm with red banner.

- **Glossary** added to `CONTEXT.md` under UX: `Focused Trip`, `Sheet Pull Import`, `Sheet Settings`, `Import Preview`; `Sheet Proxy` amended to mention `allRows`; no schema change.

## Alternatives Considered

- Hash-based focus (`?focus=id`) — rejected: pollutes URL/history, breaks back nav.
- Separate import sheet/keys — rejected: two sources of truth until import, diverges from ADR 0014 single Buffer Sheet.
- OAuth/service account direct Sheet API — rejected v1 for Google Cloud setup + token refresh; proxy reuse keeps zero credentials in PWA and works when deployment down.
- Duplicate Key identity — rejected: same physical move with different time would create duplicate odo; Odo Key matches ledger audit rule.
- Auto-poll/badge — rejected v1 for CORS/quota noise; manual matches existing Excel import mental model.
- Auto-select Changed — rejected: silent overwrite risky; default unchecked + diff visible is safer.

## Consequences

- Positive: In-place gap/insert/remove no longer loses cursor; sheet rows import in one click with same validation as Excel, no transform; preview consent prevents accidental overwrite; shared Settings keeps phone+desktop sheet id in sync.
- Negative/Risk: Requires Apps Script redeployed as Anyone; CORS still fails if restricted. Manual pull only — staleness not auto-surfaced. Changed rows hidden until user checks diff.
- Reversal: Remove `lib/sheetClient.ts`, `lib/sheetPull.ts`, `SheetSettingsDialog`, pull button+preview from `AllTripsMasterTable`, focused state/refs; glossary entries deleted; DB untouched (imported trips remain).
