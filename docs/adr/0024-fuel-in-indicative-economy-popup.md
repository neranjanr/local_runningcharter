# ADR 0024: Fuel-In Indicative Economy Popup on Dashboard

Date: 2026-09-22
Status: Accepted
Deciders: Neranjan

## Context

Grill `fuel-in indicative economy popup` (2026-09-22): `Fuel-IN Summary` (`components/dashboard/FuelInSummary.tsx:22`, `CONTEXT.md:120`) showed fuel-in dates aggregated per-Date with Fuel IN (L) and Ref No, but gave no distance-between-fuel-ins insight. User requested a header-icon popup showing for each fuel-in date: fuel-in date, Last KM of that day's last Trip, distance since previous fuel-in, and indicative fuel economy = distance / current fuel volume (full-tank assumption, e.g. 20L Jan1 → 100km → 20L Jan5 ⇒ 100/20=5.0 km/L). Needed disclaimer that it is indicative only, accurate only for Full tank → Full tank cycles, to help detect abnormalities/mistakes. Assumption of one pump per day to be surfaced (same-day pumps summed). Gaps (ODO discontinuity) make the metric unreliable.

Existing ledger economy (`Fuel Economy` `CONTEXT.md:32`, `Fuel-In Segment` `CONTEXT.md:114`, `Estimated Fuel Economy` `CONTEXT.md:117`) is per-DayGroup ledger-derived and per-segment feasible-interval calibrated, not the full-tank running average requested. The new metric is Dashboard-only, derived, not stored.

## Decision

- **Term**: `Fuel-In Indicative Economy` (`CONTEXT.md`) — `DistanceBetweenFuelIns / FuelIN(Di)` km/L, `Distance = LastKM(Di) − LastKM(Di−1)` where `LastKM(D)` = `end_km` of last Trip on `D` (Integer KM, `roundToIntegerKm`), per-Date aggregated (same-day multiple `fuel_pumped_amount >0` summed to one row; assumes one fuel-in per day). Previous vs per-Trip grain rejected: per-Date preserves parity with `Fuel-IN Summary`; per-Trip deferred to v2.
- **Formula**: For sorted fuel-in dates ascending `D1<…<Dn`, `Di` (i>1) `indicative = roundToOneDecimal((LastKM(Di)−LastKM(Di−1)) / FuelIN(Di))`; `D1` → `—`. Uses current row's fuel volume as denominator (full-tank method). 1-decimal via `roundToOneDecimal` (`lib/tripCalculations.ts:6`).
- **ODO gap handling**: `detectTripGaps` (`lib/continuityAlerts.ts`) KM gaps inspected; if any gap successor date ∈ `(Di−1, Di]` ⇒ Economy `—` with tooltip `⚠️ Insufficient — ODO gap between fuel-ins`, Distance still shown (reveals jump), row AMBER-hatched. Alternative of hiding Distance rejected: gap inflates Distance and user needs to see it. Zero/negative Distance → RED `⚠️`.
- **Abnormality indication**: Values outside 5–20 km/L highlighted AMBER (`bg-amber-100`) + ⚠️ to flag typos; normal 5–20 plain. Threshold chosen over 6–18 after grill Q10.
- **UI**: New `📊` icon button in `Fuel-IN Summary` header (`data-testid="fuelin-indicative-economy-btn"`, tooltip "Fuel-in distance & indicative economy (full-tank assumption)") distinct from existing `+ MORE` full-list popup. New modal with columns `# | Date | Last KM | Fuel IN (L) | Distance Since Last (km) | Indicative Economy (km/L) | Ref No`, sorted newest-first (parity with summary), scrollable, close on backdrop/✕.
- **Disclaimers**: AMBER banner at popup top: "Indicative only — assumes each fuel-in was a full tank. Accurate only for Full tank → Full tank cycles. Use to detect abnormalities or data entry mistakes." plus footer ℹ️ line: "Assumes one fuel-in per day — same-day multiple pumps are summed."
- **Empty/edge**: 0 fuel-ins ⇒ "No fuel-in records yet"; 1 row ⇒ single row Distance/Economy `—` + footer "Add another fuel-in to see distance".

## Alternatives Considered

- Per-Trip fuel-event grain (each `Trip` with `fuel_pumped_amount>0` separate row) — rejected: overcomplicates same-day sums, breaks parity; defer.
- Suppress Distance when gap present — rejected: hides inflated km cause.
- Global least-squares / ledger `Fuel Economy` reuse — rejected: different semantics (ledger is Distance/Economy vs derived full-tank running average).
- No highlighting — rejected: user explicitly wants abnormality detection aid.
- Oldest-first sort — rejected: newest-first keeps latest economy at top, matching summary.

## Consequences

- `CONTEXT.md` extended: `Fuel-In Indicative Economy` and `Fuel-IN Summary` header-icon note.
- `components/dashboard/FuelInSummary.tsx` adds derived LastKM + gap-aware Distance/Economy computation, second modal, no DB migration.
- Future per-Trip split or tighter thresholds can be done without schema change; reversal is deleting the icon/modal + glossary term.
