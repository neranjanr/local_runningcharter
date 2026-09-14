# Dashboard & Ledger UX Polish

Date: 2026-09-13
Status: Accepted

## Context
Stakeholder requested: Last ODO date visibility, column width rebalancing, alternating row visibility, date format unification, odometer tint for this-month metrics, and Fuel-IN summary on dashboard.

## Decision
- **Last ODO**: `lib/dashboardCalculations.ts:119` `lastOdo` + `lastOdoDate` rendered as `dd-mm-yyyy` alongside drum in `components/dashboard/MetricCards.tsx`. Largest `end_km` chronologically determines date.
- **Type validation**: `Trip.trip_type` restricted to `Official|Private` (`types/index.ts:41`) via `<select>` in All Trips inline edit (`components/dashboard/AllTripsMasterTable.tsx:185`) and `app/trips/new`; workbook import hard-fails on other values (list values).
- **All Trips table**: Column 1 = RowNo (`#` page-wide/global), Column 2 = Date with day after date in single badge; full-row alternating background by date-group index (`groupIdx%2` `components/dashboard/AllTripsMasterTable.tsx:77`) not just date cell, with `+30%` max width for Route (`Places Visited`) and reduced Date/ODO widths.
- **Ledger Side1**: Same `# | Date(day)` order, Route 30% cap, full-row date-group alternating as Side1 `components/ledger/Side1TripsLog.tsx`.
- **Audit tables**: Table 2 & 3 dates use `dd-mm-yyyy` no day (`components/ledger/Side2FuelTables.tsx`); Table 1 keeps day badge. Ledger date helper split into `formatDateCell` (Side1) vs `formatAuditDate` (Side2).
- **This-month meter**: `Official/Private/Total this month` cards tinted `bg-amber-50/60 border-amber-200` distinct from all-time cards (`bg-white`/`bg-surface-container`) to mimic mileage meter without 7-segment drum.
- **Fuel-IN summary**: Dashboard section `Date | Fuel IN | Ref No` aggregated per date where `fuel_pumped_amount>0`, newest-first, 12 rows + MORE modal with full list and page link, between MetricCards and Vehicle strip (`app/page.tsx:72`).

## Alternatives Considered
- 7-segment drum for this-month — rejected as overkill; tint suffices per Q13.
- Calendar-date parity for alternating rows — rejected; group-index parity handles missing dates correctly.
