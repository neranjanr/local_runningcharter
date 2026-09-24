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

export interface GapInfo {
  gapPreIdx: number;
  gapSuccIdx: number;
  gapExtent: number;
  predecessor: Trip;
  successor: Trip;
}

/**
 * Find the next downstream KM Gap (positive vacuum) after insertAfterIndex.
 * Scans gaps where predecessor index >= insertAfterIndex (for anchor gap) and successor start > predecessor end.
 * Returns null if no positive gap downstream.
 */
export function findNextGapAfter(sortedTrips: Trip[], insertAfterIndex: number): GapInfo | null {
  const start = Math.max(0, insertAfterIndex);
  // When insertAfterIndex == -1 we start at 0; for others start at insertAfterIndex to catch anchor gap.
  const loopStart = insertAfterIndex === -1 ? 0 : insertAfterIndex;
  for (let j = Math.max(0, loopStart); j < sortedTrips.length - 1; j++) {
    if (j < insertAfterIndex) continue;
    const cur = sortedTrips[j];
    const nxt = sortedTrips[j + 1];
    const extent = roundToIntegerKm(nxt.start_km) - roundToIntegerKm(cur.end_km);
    if (extent > 0) {
      return { gapPreIdx: j, gapSuccIdx: j + 1, gapExtent: extent, predecessor: cur, successor: nxt };
    }
  }
  return null;
}

/**
 * Bounded (Gap-Absorbed) Insert — shift contiguous block until next gap by Δ,
 * reduce gap G→G-Δ, spill S=max(0,Δ-G) beyond gap.
 * When Δ≤G, remainder beyond gap untouched (gap shrinks).
 * When no downstream positive gap, falls back to unbounded shiftForInsert.
 */
export function shiftForInsertBounded(sortedTrips: Trip[], insertAfterIndex: number, newTrip: Trip): ShiftResult & { gapInfo: GapInfo | null; spill: number; residualGap: number } {
  const normalizedNew: Trip = {
    ...newTrip,
    start_km: roundToIntegerKm(newTrip.start_km),
    end_km: roundToIntegerKm(newTrip.end_km),
    trip_distance: roundToIntegerKm(roundToIntegerKm(newTrip.end_km) - roundToIntegerKm(newTrip.start_km)),
  };
  const delta = normalizedNew.end_km - normalizedNew.start_km;
  const gapInfo = findNextGapAfter(sortedTrips, insertAfterIndex);
  if (!gapInfo) {
    const r = shiftForInsert(sortedTrips, insertAfterIndex, normalizedNew);
    return { ...r, gapInfo: null, spill: delta, residualGap: 0 };
  }
  const G = gapInfo.gapExtent;
  const S = Math.max(0, delta - G);
  const residualGap = Math.max(0, G - delta);

  const before = sortedTrips.slice(0, insertAfterIndex + 1);
  const block = sortedTrips.slice(insertAfterIndex + 1, gapInfo.gapSuccIdx);
  const remainder = sortedTrips.slice(gapInfo.gapSuccIdx);

  const shiftedBlock: Trip[] = block.map((t) => ({
    ...t,
    start_km: Math.max(0, roundToIntegerKm(t.start_km + delta)),
    end_km: Math.max(0, roundToIntegerKm(t.end_km + delta)),
    trip_distance: roundToIntegerKm(t.trip_distance),
  }));
  const shiftedRemainder: Trip[] = remainder.map((t) => ({
    ...t,
    start_km: Math.max(0, roundToIntegerKm(t.start_km + S)),
    end_km: Math.max(0, roundToIntegerKm(t.end_km + S)),
    trip_distance: roundToIntegerKm(t.trip_distance),
  }));

  const resultTrips = [...before, normalizedNew, ...shiftedBlock, ...shiftedRemainder];
  return { trips: resultTrips, delta, insertedIndex: insertAfterIndex + 1, gapInfo, spill: S, residualGap };
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
 * Reverse Gap Fill — compress KM gaps backward to match physical odometer.
 * Earliest-first sequential absorption: G1→max(0,G1−Δ), spill S=max(0,Δ−G1) to G2…
 * Shifts suffix tail after each gap by its consumed share.
 * trip_distance frozen, start/end clamped >=0. Returns per-gap before/after extents.
 */
export interface ReverseGapFillGap {
  gapPreIdx: number;
  gapSuccIdx: number;
  beforeExtent: number;
  afterExtent: number;
  consumed: number;
}

export interface ReverseGapFillResult extends ShiftResult {
  delta: number;
  physicalOdo: number;
  recordedFinal: number;
  totalGapExtent: number;
  gaps: ReverseGapFillGap[];
  trips: Trip[];
}

export function getTotalPositiveGapExtent(sortedTrips: Trip[]): number {
  let total = 0;
  for (let i = 0; i < sortedTrips.length - 1; i++) {
    const extent = roundToIntegerKm(sortedTrips[i + 1].start_km) - roundToIntegerKm(sortedTrips[i].end_km);
    if (extent > 0) total += extent;
  }
  return total;
}

export function shiftForReverseGapFill(sortedTrips: Trip[], physicalOdo: number): ReverseGapFillResult {
  const sorted = sortTripsChronologically(sortedTrips);
  if (sorted.length < 2) {
    return { trips: sorted, delta: 0, physicalOdo: roundToIntegerKm(physicalOdo), recordedFinal: sorted[0]?.end_km ?? 0, totalGapExtent: 0, gaps: [] };
  }
  const recordedFinal = roundToIntegerKm(sorted[sorted.length - 1].end_km);
  const phys = roundToIntegerKm(physicalOdo);
  const delta = recordedFinal - phys;
  const totalGapExtent = getTotalPositiveGapExtent(sorted);

  if (delta <= 0 || delta > totalGapExtent) {
    // Validation failure — caller should reject; still return unmodified for preview
    return { trips: sorted, delta, physicalOdo: phys, recordedFinal, totalGapExtent, gaps: [] };
  }

  // Copy trips for mutation
  const result: Trip[] = sorted.map(t => ({ ...t }));
  const gaps: ReverseGapFillGap[] = [];
  let remaining = delta;

  for (let i = 0; i < result.length - 1 && remaining > 0; i++) {
    const cur = result[i];
    const nxt = result[i + 1];
    // extent must be computed from current shifted values (already affected by prior consumptions for nxt.start)
    const extent = roundToIntegerKm(nxt.start_km) - roundToIntegerKm(cur.end_km);
    if (extent <= 0) continue; // skip overlaps/zero, they consume nothing
    const consumed = Math.min(extent, remaining);
    const beforeExtent = extent;
    const afterExtent = extent - consumed;
    gaps.push({ gapPreIdx: i, gapSuccIdx: i + 1, beforeExtent, afterExtent, consumed });
    // Shift suffix starting at i+1 backward by consumed
    for (let j = i + 1; j < result.length; j++) {
      result[j] = {
        ...result[j],
        start_km: Math.max(0, roundToIntegerKm(result[j].start_km - consumed)),
        end_km: Math.max(0, roundToIntegerKm(result[j].end_km - consumed)),
        trip_distance: roundToIntegerKm(result[j].trip_distance),
      };
    }
    remaining -= consumed;
  }

  return { trips: result, delta, physicalOdo: phys, recordedFinal, totalGapExtent, gaps };
}

/**
 * Validate that odometer continuity holds (no breaks) — exposed for tests.
 */
export function isContinuityValid(pages: BookPage[]): boolean {
  return validateOdometerContinuity(pages).isValid;
}
