/**
 * Day-atom Fuel-In cycle slicing (ADR-0036).
 *
 * Boundaries fall on DATE boundaries only: a fuel-in Date closes its
 * segment by default (previous-join), or joins the next segment when its
 * Fuel-Day Ownership is `next`. Pump Timing is ignored for economy
 * (deprecated — the parser still accepts and stores it). One Date never
 * splits, so Side 2 renders one ledger column and one trend stem per Date.
 *
 * Leaf module: imports only `Trip` + rounding.
 */
import type { Trip } from '@/types';
import { roundToOneDecimal } from './tripCalculations';

/**
 * Deprecated split threshold, kept for import compat.
 * Day-atom ledgers always render one column per Date.
 */
export const SPLIT_DAY_THRESHOLD_KM = 40;

/** Which segment's economy a fuel-in Date shares. Default `previous`. */
export type FuelDayOwnership = 'previous' | 'next';

/** Ownership overrides keyed by fuel-in Date. Absent means `previous`. */
export type FuelDayOwnershipInput =
  | Map<string, FuelDayOwnership>
  | Record<string, FuelDayOwnership>
  | undefined
  | null;

export function ownershipOfDate(input: FuelDayOwnershipInput, date: string): FuelDayOwnership {
  if (!input) return 'previous';
  if (input instanceof Map) return input.get(date) ?? 'previous';
  return (input as Record<string, FuelDayOwnership>)[date] ?? 'previous';
}

/** Display-only pump predicates (economy no longer branches on these). */
export function isStartPumpTrip(t: Trip): boolean {
  return t.pump_timing === 'START' && (t.fuel_pumped_amount ?? 0) > 0;
}

/** Display-only pump predicates (economy no longer branches on these). */
export function isEndPumpTrip(t: Trip): boolean {
  return (t.pump_timing ?? 'END') === 'END' && (t.fuel_pumped_amount ?? 0) > 0;
}

export function sortTripsForCycles(trips: Trip[]): Trip[] {
  return [...trips].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.trip_index !== b.trip_index) return a.trip_index - b.trip_index;
    return a.start_km - b.start_km;
  });
}

/** Per-date pumped-fuel sums (1-decimal) for a trip set. */
export function dateFuelSums(trips: Trip[]): Map<string, number> {
  const sums = new Map<string, number>();
  for (const t of trips) {
    const pumped = roundToOneDecimal(t.fuel_pumped_amount ?? 0);
    if (pumped > 0) sums.set(t.date, roundToOneDecimal((sums.get(t.date) ?? 0) + pumped));
  }
  return sums;
}

/** Sorted fuel-in Dates (drawn fuel > 0) for a trip set. */
export function fuelInDates(trips: Trip[]): string[] {
  return Array.from(dateFuelSums(trips).keys()).sort();
}

/**
 * Day-atom Fuel-In Segments (cycles) in chronological order.
 * Each segment is a run of whole Dates: a fuel-in Date closes the current
 * segment unless its ownership is `next`, in which case that Date's Trips
 * join the following segment. Dates after the last fuel-in form the final
 * (open) segment.
 */
export function buildTripCycles(trips: Trip[], ownership?: FuelDayOwnershipInput): Trip[][] {
  const sorted = sortTripsForCycles(trips);
  const byDate = new Map<string, Trip[]>();
  for (const t of sorted) {
    if (!byDate.has(t.date)) byDate.set(t.date, []);
    byDate.get(t.date)!.push(t);
  }
  const dates = Array.from(byDate.keys()).sort();
  if (dates.length === 0) return [];
  const drawn = dateFuelSums(sorted);
  const segOf = new Map<string, number>();
  let seg = 0;
  for (const d of dates) {
    segOf.set(d, seg);
    if ((drawn.get(d) ?? 0) > 0 && ownershipOfDate(ownership, d) !== 'next') seg++;
  }
  const buckets = new Map<number, Trip[]>();
  for (const d of dates) {
    const s = segOf.get(d)!;
    if (!buckets.has(s)) buckets.set(s, []);
    buckets.get(s)!.push(...byDate.get(d)!);
  }
  return Array.from(buckets.keys())
    .sort((a, b) => a - b)
    .map((k) => buckets.get(k)!);
}

/**
 * Day-atom: one Date is always a single slice. The `cycles` argument is
 * accepted for caller compat and ignored.
 */
export function cycleSlicesForDate(dateTrips: Trip[], _cycles?: Trip[][]): Trip[][] {
  return [sortTripsForCycles(dateTrips)];
}

/**
 * Day-atom: one ledger column slot per distinct Date. Pure from trip
 * dates — no economy input needed — so pagination can count slots before
 * any estimation runs.
 */
export function countLedgerColumnSlots(trips: Trip[]): number {
  if (trips.length === 0) return 0;
  return new Set(trips.map((t) => t.date)).size;
}
