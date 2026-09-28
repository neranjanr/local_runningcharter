# ADR 0028: Full Tank flag and strict full-tank economy estimation

Date: 2026-09-27
Status: Accepted

## Context

Fuel balance feasibility (`lib/estimateFuelEconomy.ts:187`) evaluated every intermediate balance against lenient `[1, tankCapacity]` only, so a pump flagged as "filled to full" could still be estimated to a half-empty balance without warning. Users need to mark that a pump reached full (All Trips right-click, New Trip / Insert After checkbox, Mobile entry) and see a ★ FULL mark near the pumped fuel cell and in fuel-balance displays, plus an estimator toggle that tightens the post-pump balance to near-full (`72–76 L` for a 75 L tank in the request, clamped to `tankCapacity`) to reflect unknown consumption en route to the station (pump at start vs end of Trip).

## Decision

Add per-Trip boolean `is_full_tank` (DB `trips.is_full_tank`, `types/index.ts:44`, `fuel_pumped_amount>0` guard, default `false`, backward-compatible import: missing `Full Tank` column → false, `YES/TRUE/1/★` → true). UI: checkbox/below Fuel Order No in `QuickTripForm.tsx`, `AllTripsMasterTable.tsx` Insert After, and `MobileQuickTripForm.tsx`/`mobile_app_public.html` (disabled unless pumped>0); All Trips row right-click (and ⋯ menu fallback) toggles the flag on pumped rows and renders a `★ FULL` emerald pill beside the dark-blue pumped amount and in Ledger Side2 tables (`Side2FuelTables.tsx`) and as a `Full?` icon column in the fuel-balance estimation popup (`EstimateFuelEconomy.tsx`). Export/push: workbook `All Trips` and Buffer Sheet dual-sheet now carry a trailing `Full Tank` column (`YES`/`""`), round-tripped via `allTripsWorkbook.ts`/`sheetClient.ts`/`sheetPush.ts`/Apps Script, DB wins on `date|start_km|end_km` collision.

Estimator (`estimateFuelEconomy.ts`): expose `strictFullTank?: boolean` toggle in the popup header (default OFF). When ON, any segment whose source pump has `is_full_tank==true` is feasible only if the balance immediately after that pumped Trip lies in `[tankCapacity-3, tankCapacity]` (scaled linearly, e.g. 75 L → 72–75 L, never exceeding `tankCapacity`; the `+1 L` in `72–76` is clamped) and intermediate balances remain in `[1, tankCapacity]`; non-Full segments keep the lenient window. Strict infeasibility surfaces as amber warning "no feasible economy in strict range — nearest outside strict suggested". No existing semantics changed when toggle is OFF.

## Considered Options

Global `is_full_tank` per DayGroup or per fuel-in segment — rejected: pump granularity is per Trip (user may pump mid-day) so day-level flag would over-constrain. Always-strict without toggle — rejected: would break historical estimates where few pumps are Full. Strict window as `±4 L` or percentage `96–101%` — chosen `cap-3..cap` as simplest linear clamp fitting the 72–76 request without exceeding capacity.

## Consequences

One boolean migration plus `Full Tank` column versioning across Excel/Sheet/Proxy. Estimator gains a non-breaking strict path that prefers near-full post-pump balances; UI must handle empty Strict (no Full flags → warning, strict has no effect). Historical rows remain valid without backfill.
