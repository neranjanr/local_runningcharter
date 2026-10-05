/**
 * Trip-delimited Fuel-In cycle slicing shared by the ledger engine and
 * pagination (Spec #6, Issues #8/#11, ADR-0035).
 *
 * Lives in its own leaf module (imports only `Trip` + rounding) so both
 * `ledgerCalculations.ts` and `pagination.ts` can use it without an
 * import cycle: a START pump opens the next Fuel-In Segment at the pumped
 * Trip itself at any distance, an END pump keeps the pumped Trip in the
 * previous one, and every pumped Trip is a boundary with no collapsing.
 * A date totaling over 40 km renders one Side 2 column per segment slice
 * (a Split Day Column); 40 km or less collapses to one column.
 */
import type { Trip } from '@/types';
import { roundToIntegerKm } from './tripCalculations';

/** Date totals above this render one Side 2 column per segment slice. */
export const SPLIT_DAY_THRESHOLD_KM = 40;

export function isStartPumpTrip(t: Trip): boolean {
  return t.pump_timing === 'START' && (t.fuel_pumped_amount ?? 0) > 0;
}

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

/**
 * Trip-delimited Fuel-In Segments (cycles) in chronological order.
 * Boundaries are exactly the pumped Trips with no collapsing: a START
 * pump opens the next segment at the pumped Trip, an END pump closes the
 * previous segment after the pumped Trip. One date can hold several
 * segments.
 */
export function buildTripCycles(trips: Trip[]): Trip[][] {
  const sorted = sortTripsForCycles(trips);
  const cycles: Trip[][] = [];
  let current: Trip[] = [];
  for (const t of sorted) {
    if (isStartPumpTrip(t) && current.length > 0) {
      cycles.push(current);
      current = [t];
    } else {
      current.push(t);
    }
    if (isEndPumpTrip(t)) {
      cycles.push(current);
      current = [];
    }
  }
  if (current.length > 0) cycles.push(current);
  return cycles;
}

/** One date's intersection with each segment, in chronological order. */
export function cycleSlicesForDate(dateTrips: Trip[], cycles: Trip[][]): Trip[][] {
  const ids = new Set(dateTrips.map((t) => t.id));
  const slices: Trip[][] = [];
  for (const cycle of cycles) {
    const slice = cycle.filter((t) => ids.has(t.id));
    if (slice.length > 0) slices.push(slice);
  }
  // Defensive: every date trip belongs to exactly one segment, so slices
  // cover the date. If cycles were built from a different trip set, fall
  // back to a single slice holding all date trips in order.
  const covered = new Set(slices.flat().map((t) => t.id));
  if (covered.size !== dateTrips.length) return [sortTripsForCycles(dateTrips)];
  return slices;
}

/**
 * Number of Side 2 day-slots a trip set consumes: one per date, except a
 * date totaling over 40 km consumes one slot per segment slice. Pure from
 * trips (distances + pump boundaries) — no economy input needed — so
 * pagination can count slots before any estimation runs.
 */
export function countLedgerColumnSlots(trips: Trip[]): number {
  if (trips.length === 0) return 0;
  const sorted = sortTripsForCycles(trips);
  const cycles = buildTripCycles(sorted);
  const dates = Array.from(new Set(sorted.map((t) => t.date))).sort();
  let slots = 0;
  for (const date of dates) {
    const dateTrips = sorted.filter((t) => t.date === date);
    const totalDist = roundToIntegerKm(
      dateTrips.reduce((s, t) => s + roundToIntegerKm(t.trip_distance), 0),
    );
    const slices = cycleSlicesForDate(dateTrips, cycles);
    if (slices.length <= 1) slots += 1;
    else if (totalDist > SPLIT_DAY_THRESHOLD_KM) slots += slices.length;
    else slots += 1;
  }
  return slots;
}
