# Estimated Fuel Economy per Fuel-In Segment

Date: 2026-09-13
Status: Accepted

## Context
Fuel consumption is `Distance / Fuel Economy` (`lib/ledgerCalculations.ts:149`) and `Closing Balance = Position + In-Tank + Drawn − Consumed` (`lib/ledgerCalculations.ts:150`). Partial tank fills make exact economy per Day Group unobservable — a full-tank method fails. Users requested a one-click estimator that suggests a single 1-decimal km/L per fuel-in section, keeping successive economies close (practical 7.5–8 km/L) while respecting the physical tank limit.

## Decision
- **Segmentation**: `Fuel-In Segment` = contiguous Day Groups from a fuel-in date (aggregated `Drawn>0` per date, `types/index.ts:43`) inclusive to day-before-next fuel-in; final segment open-ended to Book end. `In-Tank Fuel` (`CONTEXT.md:39`) does not create a boundary but is included in balance feasibility.
- **Feasibility interval**: For segment `S` with `Pos` start, `InTankSum`, `Drawn_i`, cumulative `Dist_k`, economy `E` must keep every intermediate `B_k = Pos + InTankSum_{≤k} + Drawn_i − Σ Dist_j/E` in `[1, tankCapacity]` (`Vehicle.tank_capacity` `types/index.ts:8`, fallback 75L). Higher `E` → higher `B_k` (less consumed). This yields analytic `[E_min, E_max]` intersected with `[0.1, 50]` (`lib/ledgerCalculations.ts:46`).
- **Choice**: If interval non-empty, pick `clamp(prev, E_min, E_max)` snapped to 1-dec nearest feasible (brute-checked 0.1 grid for rounding alignment, `lib/tripCalculations.ts:6`). If empty, pick nearest boundary with warning badge (amber `Fuel Gap` style `CONTEXT.md:58`); user is told estimation may be incorrect due to KM/Fuel gaps.
- **Seeding**: First segment with no prev uses practical seed 7.8 km/L (observed 7.5–8), not `DEFAULT 10.5` (`lib/ledgerCalculations.ts:12`). Open-ended final segment reuses previous suggestion else 7.8; zero-distance segments reuse prev.
- **UX**: Button "Estimate Fuel Economies" (Ledger header primary, All Trips secondary) opens preview table `From | To | Dist | Fed | Prev | Suggested | Action`; Apply writes one `Adjusted Fuel Economy` override (`CONTEXT.md:32`) to every DayGroup in segment via `lib/fuelEconomyStore.ts:24`, overwriting with confirmation "N Adjusted badges will change".

## Alternatives Considered
- Global least-squares across all segments — rejected: users want minimal gaps between successive segments, not global fit, and feasibility violations would be hidden.
- Fixed 75L magic — rejected; use `Vehicle.tank_capacity` dynamic per Q2.
- Full-tank-only method — rejected; excludes partial fills, which are the core problem.

## Consequences
- Preview is pure function `lib/estimateFuelEconomy.ts:estimateSegments` testable; no auto-recalc of gaps — warnings only.
- Tank capacity change re-shapes feasible intervals; estimator must be re-run.
