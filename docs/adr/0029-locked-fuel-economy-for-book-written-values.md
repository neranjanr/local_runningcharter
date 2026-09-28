# ADR 0029: Locked Fuel Economy for book-written values

Date: 2026-09-27
Status: Accepted

## Context

After applying Estimated Fuel Economies and copying them into the physical running chart, re-running estimation must not silently change already-written Day Groups. Example: Jan 1–31 locked at closing balance 20 L; Feb 1–15 estimation later suggests Jan 31 as 25 L, which would invalidate the book. Grill 2026-09-27 requested selectable lock/unlock per economy so the estimator treats locked prefix as immutable and anchors the next unlocked segment to the locked closing balance and last locked economy.

## Decision

Store locks at **DayGroup granularity** (`PageId+Day` re-keyed by date for rebuild survival) in a parallel `fuelEconomyLockStore` (localStorage + server persistence), default unlocked. UX: `EstimateFuelEconomy` popup gains a `☐` select column plus `Lock Selected` / `Unlock Selected` bulk actions (Apply does not auto-lock); locked rows show `🔒` and are disabled/omitted from future estimation runs. Side2 Fuel Economy tables render `🔒` badge and disable inline edit until unlocked; a "Manage Locks" listing of locked intervals is offered. Estimator with locks: simulate locked prefix to derive `runningPos` (closing balance after last locked Day) and `prevEconomy` (last locked), then estimate only unlocked segments; locked segments are excluded and validated but never overwritten. Import/Sheet Pull skips locked dates with warning; structural operations (Insert/Remove/Reverse Gap Fill/Rebuild) preserve locked economies per date and recompute positions, surfacing a banner if a preserved locked segment becomes infeasible without auto-unlocking.

## Consequences

No schema migration on `Trips`; one new lock store. Strict Full-Tank window (`cap-3..cap`) still applies inside unlocked estimation but locked Full-Tank segments remain anchored to their written values. Historical behavior unchanged when no locks exist.
