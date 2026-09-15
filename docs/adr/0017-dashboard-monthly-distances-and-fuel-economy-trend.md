# ADR 0017: Dashboard — Previous Month Stats, 70:30 Fuel Economy Trend with Odometer Gaps, and Auto-Refresh

Date: 2026-09-15
Status: Accepted
Deciders: Neranjan (Super Admin / single operator)

## Context

Dashboard after Phase 4 had a single “This Month” tile (Official/Private/Total) plus a full-width `Fuel IN Summary` (12 rows) and separate `MonthlyBreakdown`/`PageWise` charts. User requests emerging from daily use: (a) import should refresh dashboard automatically, (b) need previous month side-by-side to spot month-over-month change without leaving dashboard, (c) Fuel IN Summary dominated vertical space while fuel economy (the actual efficiency signal) had no visual, and (d) horizontal gaps due to ODO loss were invisible — calendar idle months without trips should not show as gaps, but a missing odometer span must be visible as a gap.

Options:
- Previous month: compute via `computeMetricsForMonth` for `YYYY-MM` of today minus 1 vs derive from `MonthlyBreakdown` vs hide when no data vs show 0.
- Fuel economy visualization: per-DayGroup `LedgerDay.fuelEconomy` vs monthly weighted `Σdistance/Σconsumed` vs per-Fuel-In-Segment vs external chart lib (recharts) vs hand-rolled div bars like existing `MonthlyBreakdownChart`.
- Layout for Fuel IN + Economy: keep full-width stacked vs 70:30 split (graph 70%, summary 30%) vs tabs vs separate page. On mobile stack vs keep side-by-side.
- Odometer gap: calendar gap (no trips that day) vs KM gap (`Trip N End KM ≠ Trip N+1 Start KM`, `detectTripGaps`) vs page gap. Show as break, hatch, or zero bar.
- Auto-refresh: polling vs `storage` event only (cross-tab) vs custom `fleetledger:data-changed` dispatched on any mutation vs import-only.

Constraints: Single operator, Integer KM (ADR 0002), per-DayGroup economy propagated (ADR 0006), no DB schema change, existing `dashboardCalculations` pure helpers, existing `FleetLedger` localStorage + `/api/import` persistence, horizontal scroll must show latest at right by default.

## Decision

- **Auto-refresh breadth:** Dashboard listens to `window 'fleetledger:data-changed'` (dispatched via `notifyDataChanged()` on *any* ledger mutation: Excel Import, Sheet Pull Import, inline edit, Delete/Remove & Shift, Gap Fill, Insert After, Rebuild Ledger, Estimated Economy apply) plus `storage` for cross-tab. On event, `refresh()` re-fetches `vehicle/pages/trips` so `This/Previous Month`, `Fuel IN`, and `Fuel Economy Trend` update without reload. (Grill Q1 = “all mutations”).

- **Monthly Distances Tile — two virtual rows:** Keep a single `Monthly Distances` tile (`bg-amber-50/60`) with two stacked rows separated by `border-t amber-200`: row 1 “This Month Stats (MMM YYYY)” (`computeThisMonthMetrics` / `computeMetricsForMonth` for current `YYYY-MM`), row 2 “Previous Month Stats (MMM YYYY)” (`computeMetricsForMonth` for `prevKey = YYYY-MM` of today minus 1 calendar month, via `getCurrentMonthKey`). Both rows show `Official | Private | Total` (integer KM, `Math.round`), 0 shown as `0 KM` when no trips. Existing `data-testid="metric-official/private/total"` stay on this-month row; new `metric-prev-official/private/total` on previous row. (Grill Q2).

- **70:30 dashboard split:** `app/page.tsx` replaces the full-width `Fuel IN Summary` with `grid lg:grid-cols-10` — `FuelEconomyGraph` in `lg:col-span-7` (≈70%) and `FuelInSummary` in `lg:col-span-3` (≈30%); mobile stacks `grid-cols-1` (graph on top). `FuelInSummary` reduced to 6 newest rows (`slice(0,6)`, `max-h 240px` scrollable) to fit 30% pane without excess space. `FuelEconomyGraph` is a new hand-rolled component (no new lib) mirroring `MonthlyBreakdownChart` style.

- **Fuel Economy Trend data source:** Per-DayGroup `fuelEconomy` from `computeLedgerDays` flattened across all pages sorted by `date` (`getFuelEconomiesForPage`/`getInTanksForPage`, 1-dec, `DEFAULT 10.5` fallback). Each day is a bar (`height = economy / ceil(max)`). X = `DD Mon`, Y = km/L. (Grill Q3 = daily).

- **Odometer gaps ≠ calendar gaps:** A gap is *only* a KM Gap (`detectTripGaps` `kind:'km'`, `actual - expected !=0`). Idle months with no trips and no odometer discontinuity show *no* gap. When a KM gap exists between trip N and N+1, the successor DayGroup date gets a RED hatched gap column (`border-dashed red`) with `gap N km` label, inserted before the bar for that date. Horizontally scrollable (`overflow-x-auto`, `minWidth = days*36 + gaps*48`), scrolled to `scrollWidth` on mount/update so latest is visible at right by default. (Grill Q4).

- **Glossary:** `CONTEXT.md` updated: `Fuel-IN Summary` (now 6 rows, 30% pane), new `Fuel Economy Trend` (per-DayGroup, scrollable, odometer gaps), new `Monthly Distances Tile` (two virtual rows), new `Dashboard Auto-Refresh` (`fleetledger:data-changed`).

## Alternatives Considered

- Single-month tile only — rejected: requires navigating to `MonthlyBreakdown` to compare, missed month-over-month insight.
- Monthly weighted economy or per-segment graph — rejected for v1: coarser than daily; daily gives immediate gap visibility and reuses existing `LedgerDay` pipeline without extending `MonthlyBreakdown`.
- External chart lib (recharts, chart.js) — rejected: adds bundle weight; existing div-bar pattern is sufficient and keeps styling consistent.
- Calendar-day gaps — rejected per Q4: would flag every idle month as missing data, noisy for a vehicle that legitimately sits unused.
- Polling / import-only refresh — rejected: polling wasteful, import-only leaves edits/deletes stale on dashboard.

## Consequences

- Positive: Dashboard now shows This vs Previous month side-by-side in one tile; 70:30 uses vertical space efficiently; economy trend makes fuel efficiency and odometer loss obvious at a glance; auto-refresh keeps all three (distances, Fuel IN, trend) fresh after any import/mutation without reload.
- Negative/Risk: Daily granularity can be wide with >90 days (horizontal scroll required); max economy ceiling is `ceil(max)` — if one outlier (e.g., 40 km/L) compresses others, scale is skewed (mitigated by `Math.ceil`). Previous month computed as calendar previous of *today*, not of latest trip, so future-dated trips won’t appear there.
- Reversal: Remove `prevMetrics` from `MetricCards` and revert to single-row; remove `FuelEconomyGraph` and restore `FuelInSummary` to full-width 12 rows; remove `fleetledger:data-changed` listener from `app/page.tsx`.
