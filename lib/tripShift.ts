/**
 * Trip Shift Engine — pure helpers for Insert After and Remove & Shift
 * Used by Phase 4 Gap Fill / Insert / Remove operations.
 * All KM values are Integer KM via roundToIntegerKm.
 */
import type { Trip } from '@/types';
import { roundToIntegerKm } from './tripCalculations';
import { validatePaginationConstraints, recalculatePageBalancesFromOpening, type BookOpening } from './pagination';
import type { BookPage } from '@/types';
import { validateOdometerContinuity } from './pagination';

export interface ShiftResult {
  trips: Trip[];
  delta: number;
  insertedIndex?: number;
  removedIndex?: number;
}

/**
 * Sort helper: chronological order as used by detectTripGaps (date || start_km)
 */
export function sortTripsChronologically(trips: Trip[]): Trip[] {
  return [...trips].sort((a, b) => a.date.localeCompare(b.date) || a.start_km - b.start_km);
}

/**
 * Insert a new trip after insertAfterIndex in chronological sorted order.
 * Downstream trips (index > insertAfterIndex) have start_km/end_km shifted by Δ.
 * trip_distance is frozen (preserved). Integer KM via roundToIntegerKm, clamped to >=0.
 *
 * @param sortedTrips - already sorted chronologically (date || start_km)
 * @param insertAfterIndex - index in sortedTrips after which to insert (-1 to insert at beginning)
 * @param newTrip - the trip to insert (will be normalized to Integer KM)
 */
export function shiftForInsert(sortedTrips: Trip[], insertAfterIndex: number, newTrip: Trip): ShiftResult {
  const normalizedNew: Trip = {
    ...newTrip,
    start_km: roundToIntegerKm(newTrip.start_km),
    end_km: roundToIntegerKm(newTrip.end_km),
    trip_distance: roundToIntegerKm(roundToIntegerKm(newTrip.end_km) - roundToIntegerKm(newTrip.start_km)),
  };
  const delta = normalizedNew.end_km - normalizedNew.start_km;
  // Clamp delta? delta may be 0 if gap; normally positive. Keep as computed.
  const before = sortedTrips.slice(0, insertAfterIndex + 1);
  const after = sortedTrips.slice(insertAfterIndex + 1);

  const shiftedAfter: Trip[] = after.map((t) => ({
    ...t,
    start_km: Math.max(0, roundToIntegerKm(t.start_km + delta)),
    end_km: Math.max(0, roundToIntegerKm(t.end_km + delta)),
    // trip_distance frozen — preserve original distance
    trip_distance: roundToIntegerKm(t.trip_distance),
  }));

  const resultTrips = [...before, normalizedNew, ...shiftedAfter];
  return { trips: resultTrips, delta, insertedIndex: insertAfterIndex + 1 };
}

/**
 * Remove trip at removeIndex and shift downstream down by Δ.
 * @param sortedTrips - already sorted chronologically
 * @param removeIndex - index of trip to remove
 */
export function shiftForRemove(sortedTrips: Trip[], removeIndex: number): ShiftResult {
  if (removeIndex < 0 || removeIndex >= sortedTrips.length) {
    return { trips: [...sortedTrips], delta: 0, removedIndex: removeIndex };
  }
  const removed = sortedTrips[removeIndex];
  const delta = roundToIntegerKm(removed.end_km) - roundToIntegerKm(removed.start_km);
  const before = sortedTrips.slice(0, removeIndex);
  const after = sortedTrips.slice(removeIndex + 1);

  const shiftedAfter: Trip[] = after.map((t) => ({
    ...t,
    start_km: Math.max(0, roundToIntegerKm(t.start_km - delta)),
    end_km: Math.max(0, roundToIntegerKm(t.end_km - delta)),
    trip_distance: roundToIntegerKm(t.trip_distance),
  }));

  const resultTrips = [...before, ...shiftedAfter];
  // delta negative for downstream shift: downstream shift = -delta
  return { trips: resultTrips, delta: -delta, removedIndex: removeIndex };
}

/**
 * Helper: check whether pagination constraints would be violated after shift.
 * Returns violations array (empty means no auto-split needed).
 */
export function checkPaginationViolations(pages: BookPage[], trips: Trip[]) {
  return validatePaginationConstraints(pages, trips);
}

/**
 * Convenience: recompute pages fuel/km continuity after shift.
 * Wraps recalculatePageBalancesFromOpening.
 */
export function recomputePagesAfterShift(params: {
  pages: BookPage[];
  trips: Trip[];
  opening: BookOpening;
  economy?: number;
  inTanksByPage?: Record<string, (number | null | undefined)[]>;
}): BookPage[] {
  return recalculatePageBalancesFromOpening(params);
}

/**
 * Validate that odometer continuity holds (no breaks) — exposed for tests.
 */
export function isContinuityValid(pages: BookPage[]): boolean {
  return validateOdometerContinuity(pages).isValid;
}
