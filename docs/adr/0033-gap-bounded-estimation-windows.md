# Gap-Bounded Estimation Windows & Em-Dash Display

When odometer continuity breaks (a KM Gap where `end_km ≠ next.start_km`), estimating fuel economy across the gap is invalid because recorded distance excludes the hidden gap kilometres while fuel consumption continues. Grill 2026-10-02 established **Estimation Windows**: estimation passes are bounded by ODO gaps and anchored by the first record's start fuel position or a ★ Full Tank trip.

Specifically:
1. **Pre-gap**: Estimation runs from window start up to and including the last ★ Full Tank trip before an ODO gap. Trips after that last full tank and before the gap are blanked. If no full tank exists before the gap, the data-start opening fuel position acts as the anchor level, estimating through to the gap.
2. **Post-gap**: The first ★ Full Tank trip after an ODO gap re-anchors the tank balance to `tankCapacity`. Trips from the gap up to and including that first full tank are blanked (`—`). Estimation resumes for segments starting after that full tank.
3. **Em-Dash (`—`) display**: In all three locations where fuel economy is shown (Estimate Fuel Economies popup, All Trips Master Table, and Ledger Side 2 Fuel Economy table), gap-blanked segments/dates display an em dash (`—`) with an amber tooltip *"Economy not calculated — ODO gap"*, unless explicitly adjusted or locked by the operator (locks/adjustments win).

This is a deliberate trade-off: gap-blanked regions clearly signal missing data rather than fabricating arbitrary economies.

Consequences: `getGapBlankedSegments` in `lib/estimateFuelEconomy.ts` partitions trips at `detectTripGaps()` boundaries and classifies gap-spanning/interrupted segments; `isDateGapBlanked` propagates `—` to the popup, All Trips, and ledger side 2 tables while preserving underlying numeric fallback math for balance continuity. `CONTEXT.md` adds `Estimation Window` and ADR-0033 is recorded.
