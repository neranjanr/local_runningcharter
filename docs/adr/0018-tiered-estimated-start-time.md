# ADR 0018: Tiered Estimated Start Time by Distance

Date: 2026-09-15
Status: Accepted
Deciders: Neranjan

## Context

`Estimated Start Time` was `End Time − (Distance / 20 km/h)` ceiled to 5 min (`lib/tripCalculations.ts:26-44`, `CONTEXT.md:90`). Fixed 20 km/h underestimates urban short trips and overestimates long highway runs. Requested tier: `<10→15, <20→20, <40→25, >60→35 km/h` with ceil-to-5min retained, leaving 40–60 undefined.

Options:
- Keep fixed 20 km/h (simple, but inaccurate for extremes)
- Literal 4-tier with gap 40–60 falling through (incomplete)
- Complete 5-tier filling gap with 30 km/h for ≤60 (interpolated between 25 and 35, preserves monotonic increase)

Constraints: Must retain `ceiled to nearest 5 min` + overnight wrap (`formatMinutesToTime`), auto-fill only when Start empty, and reuse on Import/Sheet Pull conditioning (`AllTripsMasterTable.tsx:787,975`).

## Decision

Complete tier as `distance <10→15; <20→20; <40→25; ≤60→30; >60→35 km/h` with upper-bound inclusive (`10→20, 20→25, 40→30, 60→30`). Implement pure `getSpeedForDistance(km)` in `lib/tripCalculations.ts` used by `calculateEstimatedMinutes` (`raw = distance/speed*60`, `ceil(raw/5)*5`) and `estimateStartTime` + all call sites (`QuickTripForm`, `MobileQuickTripForm`, Excel/Sheet Pull conditioning, Help page). Boundaries are exclusive-lower, inclusive-upper as stated.

## Alternatives Considered

- Literal 4-tier without 30 km/h — rejected: leaves 40–60 without speed, would fall back to arbitrary default.
- Continuous formula (e.g., `speed = 15 + distance*0.33`) — rejected: non-obvious, harder to audit vs discrete table.

## Consequences

- Glossary `CONTEXT.md:90` and `app/help/page.tsx:21` updated to tier table; `quicktrip-mobile/dist/mobile.html` bundle synced.
- Existing trips with previously estimated starts unchanged until re-estimated; no migration.
- Reversal: revert `getSpeedForDistance` to constant 20 and update glossary/help.
