/**
 * Estimated Fuel Economy per Fuel-In Segment (day-atom, ADR-0036).
 * One economy per Date: a segment is a run of Dates closed by a fuel-in
 * Date, whose fuel is the segment's denominator (backward attribution).
 * Each fuel-in Date joins previous or next via greedy minimal-gap
 * ownership; feasibility keeps day-close balances in [1, tankCapacity].
 * Pump Timing is ignored (display only).
 */
import { roundToOneDecimal, roundToIntegerKm } from './tripCalculations';
import { detectTripGaps } from './continuityAlerts';
import type { BookPage, Trip, Vehicle } from '@/types';
import type { FuelDayOwnership, FuelDayOwnershipInput } from './tripCycleSlots';
import { ownershipOfDate } from './tripCycleSlots';

export interface FuelInSegmentInput {
  fromDate: string;
  toDate: string;
  distance: number;
  fuelFed: number;
  orderNo: string;
}

export interface SegmentEstimate {
  fromDate: string;
  toDate: string;
  distance: number;
  fuelFed: number;
  orderNo: string;
  orderDate: string;
  /** Closing fuel-in Date: this segment's fuel denominator (backward attribution). */
  fuelDate: string;
  /** Resolved Fuel-Day Ownership of the closing fuel Date. */
  ownership: FuelDayOwnership;
  /** Adjacent-economy gap that won the greedy choice (1-decimal), if compared. */
  gapChosen: number | null;
  /** The rejected join's gap, if compared. */
  gapOther: number | null;
  isFullTank: boolean;
  /** Stored pump timing of the closing fuel Date (display only, ignored). */
  pumpTiming: 'START' | 'END';
  /** Trip ids sharing this segment's economy (whole Dates) — apply writes them all. */
  tripIds: string[];
  /** Open tail after the last fuel-in (no closing fuel yet): pending, nothing to estimate. */
  isPending: boolean;
  /** Retired with trip-delimited cycles (START no longer splits); always false. */
  isLowConfidence: boolean;
  prevEconomy: number | null;
  /** Normal (lenient) suggestion — balances in [1, tankCapacity]. */
  suggested: number | null;
  /** Strict Full-Tank suggestion — balance after a Full Tank pump kept near tankCapacity. */
  suggestedStrict: number | null;
  feasible: boolean;
  feasibleStrict: boolean;
  feasibleMin: number | null;
  feasibleMax: number | null;
  feasibleMinStrict: number | null;
  feasibleMaxStrict: number | null;
  warning?: string;
  warningStrict?: string;
  isGapSpan: boolean;
  /** Longest single Trip in the segment (Integer KM) — long runs usually give better economy. */
  maxTripDistance: number;
  /** Number of Trips over 40 km in the segment. */
  longTripCount: number;
  /** Number of Trips 100 km or longer in the segment. */
  veryLongTripCount: number;
}

interface PassSegment {
  fromDate: string;
  toDate: string;
  distance: number;
  fuelFed: number;
  orderNo: string;
  orderDate: string;
  fuelDate: string;
  ownership: FuelDayOwnership;
  gapChosen: number | null;
  gapOther: number | null;
  isFullTank: boolean;
  /** Full flag of the previous fuel-in Date (segment opening anchor). */
  openIsFull: boolean;
  /** Full flag of this segment's closing fuel Date. */
  closeIsFull: boolean;
  pumpTiming: 'START' | 'END';
  prevEconomy: number | null;
  suggested: number | null;
  feasible: boolean;
  feasibleMin: number | null;
  feasibleMax: number | null;
  warning?: string;
  isFullToFull: boolean;
  nextIsFull: boolean;
  startPos: number;
  trips: Trip[];
  isGapSpan: boolean;
  isPending: boolean;
  isLowConfidence: boolean;
  maxTripDistance: number;
  longTripCount: number;
  veryLongTripCount: number;
}

export function getGapBlankedSegments(trips: Trip[]): Set<string> {
  const sorted = [...trips].sort((a, b) => a.date.localeCompare(b.date) || a.start_km - b.start_km);
  const gaps = detectTripGaps(sorted);
  if (gaps.length === 0) return new Set();

  const gapTripIds = new Set(gaps.map(g => g.tripId).filter(Boolean));
  const chunks: Trip[][] = [];
  let currentChunk: Trip[] = [];
  for (const t of sorted) {
    if (gapTripIds.has(t.id) && currentChunk.length > 0) {
      chunks.push(currentChunk);
      currentChunk = [t];
    } else {
      currentChunk.push(t);
    }
  }
  if (currentChunk.length > 0) chunks.push(currentChunk);

  const blankedDates = new Set<string>();

  for (let cIdx = 0; cIdx < chunks.length; cIdx++) {
    const chunk = chunks[cIdx];
    const hasFullBefore = cIdx > 0;
    const hasFullAfter = cIdx < chunks.length - 1;

    const fullTankIndices: number[] = [];
    chunk.forEach((t, idx) => { if (t.is_full_tank) fullTankIndices.push(idx); });

    if (fullTankIndices.length > 0) {
      if (hasFullBefore) {
        const firstFull = fullTankIndices[0];
        for (let i = 0; i <= firstFull; i++) {
          blankedDates.add(chunk[i].date);
        }
      }
      if (hasFullAfter) {
        const lastFull = fullTankIndices[fullTankIndices.length - 1];
        for (let i = lastFull + 1; i < chunk.length; i++) {
          blankedDates.add(chunk[i].date);
        }
      }
    } else {
      if (cIdx > 0 && hasFullAfter) {
        for (const t of chunk) blankedDates.add(t.date);
      }
    }
  }

  return blankedDates;
}

export function isDateGapBlanked(date: string, trips: Trip[]): boolean {
  const blanked = getGapBlankedSegments(trips);
  return blanked.has(date);
}

export function buildFuelInSegments(params: { trips: Trip[]; inTankMap?: Map<string, number> }): FuelInSegmentInput[] {
  // Day-atom backward ranges under default previous-join ownership: each
  // segment runs from the day after the previous fuel-in to its closing
  // fuel-in Date (whose fuel is the denominator).
  const { trips } = params;
  const dateMap = new Map<string, { distance: number; drawn: number; orderNo: string }>();
  for (const t of trips) {
    const rec = dateMap.get(t.date) ?? { distance: 0, drawn: 0, orderNo: '' };
    rec.distance += roundToIntegerKm(t.trip_distance);
    rec.drawn += roundToOneDecimal(t.fuel_pumped_amount ?? 0);
    if (t.fuel_order_no?.trim()) rec.orderNo = rec.orderNo ? `${rec.orderNo}, ${t.fuel_order_no.trim()}` : t.fuel_order_no.trim();
    dateMap.set(t.date, rec);
  }
  const sortedDates = Array.from(dateMap.keys()).sort();
  for (const v of dateMap.values()) { v.distance = roundToIntegerKm(v.distance); v.drawn = roundToOneDecimal(v.drawn); }
  const fuelInDates = sortedDates.filter(d => (dateMap.get(d)?.drawn ?? 0) > 0);
  if (fuelInDates.length === 0) return [];
  const segments: FuelInSegmentInput[] = [];
  for (let i = 0; i < fuelInDates.length; i++) {
    const closing = fuelInDates[i];
    const from = i === 0 ? sortedDates[0] : sortedDates[sortedDates.indexOf(fuelInDates[i - 1]) + 1];
    const sliceDates = sortedDates.slice(sortedDates.indexOf(from), sortedDates.indexOf(closing) + 1);
    const distance = roundToIntegerKm(sliceDates.reduce((s, d) => s + (dateMap.get(d)?.distance ?? 0), 0));
    const fuelFed = roundToOneDecimal(dateMap.get(closing)?.drawn ?? 0);
    segments.push({ fromDate: from, toDate: closing, distance, fuelFed, orderNo: dateMap.get(closing)?.orderNo ?? '' });
  }
  return segments;
}

/** Greedy minimal-gap choice recorded per fuel-in Date. */
export interface OwnershipChoice {
  ownership: FuelDayOwnership;
  gapChosen: number | null;
  gapOther: number | null;
}

/**
 * Resolve Fuel-Day Ownership greedily left-to-right (ADR-0036 Q6).
 *
 * Each fuel-in Date's distance joins previous (its fuel closes a segment
 * ending on that Date) or next (its distance moves to the following
 * segment while its fuel still closes its own). Segment economy is
 * `totalDist / closingFuel` at 1 decimal; the join with the smaller
 * adjacent gap `|left-right|` wins, ties join previous, gap 0 is perfect.
 * Zero-distance fuel days auto-join previous; locked fuel days and the
 * last fuel-in keep their pinned (or default previous) ownership without
 * comparison. A `next` join that would leave its own segment dateless is
 * forced back to previous so every fuel keeps a denominator.
 */
export function resolveFuelDayOwnership(params: {
  dates: string[];
  dateDistance: Map<string, number>;
  dateFuel: Map<string, number>;
  fuelDates: string[];
  pinned?: FuelDayOwnershipInput;
  lockedDates?: Set<string>;
}): Map<string, OwnershipChoice> {
  const { dates, dateDistance, dateFuel, fuelDates, pinned, lockedDates } = params;
  const out = new Map<string, OwnershipChoice>();
  if (dates.length === 0 || fuelDates.length === 0) return out;
  const idxOf = new Map(dates.map((d, i) => [d, i]));
  const prefix: number[] = [];
  dates.forEach((d, i) => {
    prefix.push((i > 0 ? prefix[i - 1] : 0) + (dateDistance.get(d) ?? 0));
  });
  const rangeDist = (a: string, b: string): number => {
    const ia = idxOf.get(a) ?? 0;
    const ib = idxOf.get(b) ?? -1;
    if (ia > ib) return 0;
    return prefix[ib] - (ia > 0 ? prefix[ia - 1] : 0);
  };
  const dateBefore = (d: string): string | null => {
    const i = idxOf.get(d) ?? 0;
    return i > 0 ? dates[i - 1] : null;
  };
  const dateAfter = (d: string): string | null => {
    const i = idxOf.get(d) ?? dates.length - 1;
    return i < dates.length - 1 ? dates[i + 1] : null;
  };
  const econ1 = (dist: number, fuel: number): number | null => {
    if (!(fuel > 0)) return null;
    return roundToOneDecimal(dist / fuel);
  };
  const isExplicitPin = (d: string): boolean => {
    if (!pinned) return false;
    if (pinned instanceof Map) return pinned.has(d);
    return Object.prototype.hasOwnProperty.call(pinned, d);
  };
  const startOf = (i: number): string => {
    if (i === 0) return dates[0];
    const prev = fuelDates[i - 1];
    if (out.get(prev)?.ownership === 'next') return prev;
    return dateAfter(prev) ?? prev;
  };

  const n = fuelDates.length;
  for (let i = 0; i < n; i++) {
    const di = fuelDates[i];
    const fuel = dateFuel.get(di) ?? 0;
    const isLast = i === n - 1;
    const distDi = dateDistance.get(di) ?? 0;
    const pin: FuelDayOwnership | null = isExplicitPin(di) ? ownershipOfDate(pinned, di) : null;

    if (distDi === 0) {
      // A fuel day with no distance carries no information about either
      // side: it always joins previous, ignoring any stored pin.
      out.set(di, { ownership: 'previous', gapChosen: null, gapOther: null });
      continue;
    }
    if (lockedDates?.has(di) || isLast) {
      let choice: FuelDayOwnership = pin ?? 'previous';
      const s = startOf(i);
      if (choice === 'next' && (idxOf.get(s) ?? 0) >= (idxOf.get(di) ?? 0)) choice = 'previous';
      out.set(di, { ownership: choice, gapChosen: null, gapOther: null });
      continue;
    }
    if (pin !== null) {
      let choice = pin;
      const s = startOf(i);
      if (choice === 'next' && (idxOf.get(s) ?? 0) >= (idxOf.get(di) ?? 0)) choice = 'previous';
      out.set(di, { ownership: choice, gapChosen: null, gapOther: null });
      continue;
    }

    const s = startOf(i);
    const next = fuelDates[i + 1];
    const fuelNext = dateFuel.get(next) ?? 0;
    const afterDi = dateAfter(di);
    const segREmptyPrev = !afterDi || (idxOf.get(afterDi) ?? 0) > (idxOf.get(next) ?? 0);
    const eLprev = econ1(rangeDist(s, di), fuel);
    const eRprev = segREmptyPrev ? null : econ1(rangeDist(afterDi!, next), fuelNext);
    const beforeDi = dateBefore(di);
    const segLEmptyNext = !beforeDi || (idxOf.get(s) ?? 0) > (idxOf.get(beforeDi!) ?? 0);
    const eLnext = segLEmptyNext ? null : econ1(rangeDist(s, beforeDi!), fuel);
    const eRnext = econ1(rangeDist(di, next), fuelNext);
    const gapPrev =
      eLprev !== null && eRprev !== null ? roundToOneDecimal(Math.abs(eLprev - eRprev)) : null;
    const gapNext =
      eLnext !== null && eRnext !== null ? roundToOneDecimal(Math.abs(eLnext - eRnext)) : null;

    let choice: FuelDayOwnership = 'previous';
    let gapChosen: number | null = null;
    let gapOther: number | null = null;
    if (gapPrev === null && gapNext === null) {
      choice = 'previous';
    } else if (gapNext === null) {
      choice = 'previous';
      gapChosen = gapPrev;
    } else if (gapPrev === null) {
      choice = 'next';
      gapChosen = gapNext;
    } else if (gapNext < gapPrev - 1e-9) {
      choice = 'next';
      gapChosen = gapNext;
      gapOther = gapPrev;
    } else {
      choice = 'previous';
      gapChosen = gapPrev;
      gapOther = gapNext;
    }
    if (choice === 'next' && (idxOf.get(s) ?? 0) >= (idxOf.get(di) ?? 0)) {
      choice = 'previous';
      gapChosen = gapPrev;
      gapOther = null;
    }
    out.set(di, { ownership: choice, gapChosen, gapOther });
  }
  return out;
}

function estimatePrevEconomyFallback(): number { return 7.8; }

const MAX_STEP_BASE = 1.5;
const MAX_STEP_LONG = 2.5;
const MAX_STEP_VERY_LONG = 3.0;

/**
 * Normal-path step cap from the previous economy, widened when the segment
 * contains long trips: >40 km trips allow 2.5 km/L, 100 km+ trips allow 3.0 km/L
 * (highest tier wins). Long runs usually give better economy, so a bigger step is
 * justified; without long trips the historic 1.5 km/L cap is kept.
 */
function stepCapFor(longTripCount: number, veryLongTripCount: number): { cap: number; tier: string } {
  if (veryLongTripCount > 0) return { cap: MAX_STEP_VERY_LONG, tier: '≥100 km trips' };
  if (longTripCount > 0) return { cap: MAX_STEP_LONG, tier: '>40 km trips' };
  return { cap: MAX_STEP_BASE, tier: '' };
}

function getSafeWindow(vehicle: Vehicle | null): { low: number; high: number; margin: number } {
  let low = 4, high = 30;
  if (vehicle && vehicle.typical_economy_low != null && vehicle.typical_economy_high != null && vehicle.typical_economy_low > 0 && vehicle.typical_economy_high > vehicle.typical_economy_low) {
    low = vehicle.typical_economy_low; high = vehicle.typical_economy_high;
  }
  const mid = (low + high) / 2; const margin = mid * 0.20;
  return { low, high, margin };
}

interface PassParams {
  trips: Trip[];
  pages: BookPage[];
  vehicle: Vehicle | null;
  prevEconomies?: (number | null | undefined)[];
  tankCapacityOverride?: number;
  strictFullTank?: boolean;
  lockedDatesSet?: Set<string>;
  lockedEconomyMap?: Map<string, number>;
  /** Pinned Fuel-Day Ownership per fuel-in Date (operator flips + locks). */
  ownership?: FuelDayOwnershipInput;
}

/**
 * Single estimation pass. `strictFullTank` selects the strict selection rule:
 * when a segment ends at a Full Tank pump, prefer the economy that leaves the
 * post-pump balance closest to tankCapacity (strict) rather than closest to the
 * previous economy (lenient).
 */
function runEstimationPass(params: PassParams): PassSegment[] {
  const { trips, pages, vehicle, prevEconomies } = params;
  const tankCapacity = params.tankCapacityOverride ?? (vehicle?.tank_capacity ?? 75);
  const minFuel = 1;
  const strict = !!params.strictFullTank;
  const strictMin = Math.max(1, tankCapacity - 3);
  const strictMax = tankCapacity + 1;
  if (trips.length === 0) return [];

  const sortedTrips = [...trips].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.trip_index !== b.trip_index) return a.trip_index - b.trip_index;
    return a.start_km - b.start_km;
  });

  const pumpIndices: number[] = [];
  sortedTrips.forEach((t, idx) => { if ((t.fuel_pumped_amount ?? 0) > 0) pumpIndices.push(idx); });
  if (pumpIndices.length === 0) return [];

  const sortedPages = [...pages].sort((a, b) => a.page_number - b.page_number);
  let runningPos = sortedPages.length > 0 ? roundToOneDecimal(sortedPages[0].start_fuel_balance) : 10;
  if (sortedPages.length === 0 && vehicle) runningPos = roundToOneDecimal((vehicle as unknown as Record<string, unknown>).current_fuel_level as number ?? 10);

  let prevEconomy: number | null = null;
  if (prevEconomies && prevEconomies.length > 0) {
    const lastExplicit = [...prevEconomies].reverse().find(v => v !== null && v !== undefined && Number(v) > 0) as number | undefined;
    if (lastExplicit) prevEconomy = roundToOneDecimal(lastExplicit);
  }
  if (prevEconomy === null) prevEconomy = estimatePrevEconomyFallback();

  // Day-atom simulation: chronological END order always — consume each
  // Trip's distance, then add that Trip's pumped fuel afterwards.
  const simulateMaxViolation = (segmentTrips: Trip[], startPos: number, economy: number): number => {
    let bal = roundToOneDecimal(startPos);
    let maxViolation = 0;
    for (const t of segmentTrips) {
      const distance = roundToIntegerKm(t.trip_distance);
      const pumped = roundToOneDecimal(t.fuel_pumped_amount ?? 0);
      const consumed = roundToOneDecimal(distance / economy);
      bal = roundToOneDecimal(bal - consumed);
      if (pumped > 0) bal = roundToOneDecimal(bal + pumped);
      if (bal < minFuel) maxViolation = Math.max(maxViolation, minFuel - bal);
      else if (bal > strictMax) maxViolation = Math.max(maxViolation, bal - strictMax);
    }
    return maxViolation;
  };

  const simulateFinalBalance = (segmentTrips: Trip[], startPos: number, economy: number): number => {
    let bal = roundToOneDecimal(startPos);
    for (const t of segmentTrips) {
      const distance = roundToIntegerKm(t.trip_distance);
      const pumped = roundToOneDecimal(t.fuel_pumped_amount ?? 0);
      const consumed = roundToOneDecimal(distance / economy);
      bal = roundToOneDecimal(bal - consumed);
      if (pumped > 0) bal = roundToOneDecimal(bal + pumped);
    }
    return bal;
  };

  interface BuiltSeg { trips: Trip[]; fromDate: string; toDate: string; fuelDate: string; ownership: FuelDayOwnership; gapChosen: number | null; gapOther: number | null; distance: number; fuelFed: number; orderNo: string; isFullTank: boolean; openIsFull: boolean; closeIsFull: boolean; closeFuel: number; closeIncluded: boolean; pumpTiming: 'START'|'END'; }
  const builtSegs: BuiltSeg[] = [];
  // Day-atom aggregation: one row per Date; same-day multiple pumps are summed.
  const byDate = new Map<string, Trip[]>();
  for (const t of sortedTrips) {
    if (!byDate.has(t.date)) byDate.set(t.date, []);
    byDate.get(t.date)!.push(t);
  }
  const runDates = Array.from(byDate.keys()).sort();
  const dateDistance = new Map<string, number>();
  const dateFuel = new Map<string, number>();
  const dateOrderNo = new Map<string, string>();
  const dateIsFull = new Map<string, boolean>();
  for (const d of runDates) {
    const dts = byDate.get(d)!;
    dateDistance.set(d, roundToIntegerKm(dts.reduce((s, t) => s + roundToIntegerKm(t.trip_distance), 0)));
    dateFuel.set(d, roundToOneDecimal(dts.reduce((s, t) => s + roundToOneDecimal(t.fuel_pumped_amount ?? 0), 0)));
    dateOrderNo.set(d, dts.filter(t => t.fuel_order_no?.trim()).map(t => t.fuel_order_no!.trim()).join(', '));
    dateIsFull.set(d, dts.some(t => !!t.is_full_tank && (t.fuel_pumped_amount ?? 0) > 0));
  }
  const runFuelDates = runDates.filter(d => (dateFuel.get(d) ?? 0) > 0);

  const resolvedOwnership = resolveFuelDayOwnership({
    dates: runDates,
    dateDistance,
    dateFuel,
    fuelDates: runFuelDates,
    pinned: params.ownership,
    lockedDates: params.lockedDatesSet,
  });

  const idxOfDate = new Map(runDates.map((d, i) => [d, i]));
  // Day-atom segments: seg i is closed by fuel date Di (backward
  // attribution — Di's fuel is the denominator). Di's own distance joins
  // previous (in-range) or next (moves to the following segment).
  for (let i = 0; i < runFuelDates.length; i++) {
    const fuelDate = runFuelDates[i];
    const choice = resolvedOwnership.get(fuelDate) ?? { ownership: 'previous' as FuelDayOwnership, gapChosen: null, gapOther: null };
    const startDate = i === 0
      ? runDates[0]
      : (resolvedOwnership.get(runFuelDates[i - 1])?.ownership === 'next'
        ? runFuelDates[i - 1]
        : runDates[(idxOfDate.get(runFuelDates[i - 1]) ?? 0) + 1] ?? fuelDate);
    const endDate = choice.ownership === 'previous'
      ? fuelDate
      : runDates[(idxOfDate.get(fuelDate) ?? 0) - 1] ?? startDate;
    const segDates = runDates.filter(d => d >= startDate && d <= endDate);
    const segTrips = segDates.flatMap(d => byDate.get(d) ?? []);
    const distance = roundToIntegerKm(segDates.reduce((s, d) => s + (dateDistance.get(d) ?? 0), 0));
    const fuelFed = roundToOneDecimal(dateFuel.get(fuelDate) ?? 0);
    const closingTrips = byDate.get(fuelDate) ?? [];
    const closingPump = closingTrips.find(t => (t.fuel_pumped_amount ?? 0) > 0);
    builtSegs.push({
      trips: segTrips,
      fromDate: startDate,
      toDate: endDate,
      fuelDate,
      ownership: choice.ownership,
      gapChosen: choice.gapChosen,
      gapOther: choice.gapOther,
      distance,
      fuelFed,
      orderNo: dateOrderNo.get(fuelDate) ?? '',
      isFullTank: dateIsFull.get(fuelDate) ?? false,
      openIsFull: i > 0 ? (dateIsFull.get(runFuelDates[i - 1]) ?? false) : false,
      closeIsFull: dateIsFull.get(fuelDate) ?? false,
      closeFuel: fuelFed,
      closeIncluded: choice.ownership === 'previous',
      pumpTiming: ((closingPump?.pump_timing ?? 'END') as 'START' | 'END'),
    });
  }
  // Open tail after the last fuel-in: no closing fuel yet.
  // (A last fuel Date joining `next` moves its Trips into this tail.)
  const lastFuel = runFuelDates[runFuelDates.length - 1];
  const tailOwnsLast = resolvedOwnership.get(lastFuel)?.ownership === 'next';
  const tailStartIdx = lastFuel === undefined
    ? 0
    : (idxOfDate.get(lastFuel) ?? runDates.length - 1) + (tailOwnsLast ? 0 : 1);
  const tailDates = runDates.slice(tailStartIdx);
  const tailTrips = tailDates.flatMap(d => byDate.get(d) ?? []);

  const posBeforeFirstSeg = runningPos;
  const initialPrevEconomy = prevEconomy;

  const results: PassSegment[] = [];
  const safeWin = getSafeWindow(vehicle);

  for (let segIdx = 0; segIdx < builtSegs.length; segIdx++) {
    const seg = builtSegs[segIdx];
    const segmentTrips = seg.trips;
    const totalDist = seg.distance;
    const fuelFed = seg.fuelFed;
    const fromDate = seg.fromDate;
    const toDate = seg.toDate;
    const prev: number | null = prevEconomy;
    const isFullTank = seg.isFullTank;
    const pumpTiming = seg.pumpTiming;
    // A Full Tank pump physically fills the tank: when the previous fuel
    // was full, anchor the segment's opening balance to capacity, but let
    // a floated post-pump value in [cap-3, cap+1] carry forward.
    if (seg.openIsFull) {
      if (runningPos < strictMin || runningPos > strictMax) {
        runningPos = tankCapacity;
      }
    }
    const startPos = runningPos;
    // Closing-fuel tolerance: when the closing pump is Full Tank, prefer
    // the economy leaving the post-pump balance inside [cap-3, cap+1].
    // The closing fuel is already in endBal when its Date is in-range;
    // otherwise it lands just after the range.
    const nextIsFull = seg.closeIsFull;
    const nextPumpAmount = seg.closeIncluded ? 0 : seg.closeFuel;
    const nextPumpIncluded = seg.closeIncluded;
    const isFullToFull = seg.openIsFull && seg.closeIsFull;
    const maxTripDistance = segmentTrips.reduce((m, t) => Math.max(m, roundToIntegerKm(t.trip_distance)), 0);
    const longTripCount = segmentTrips.filter(t => roundToIntegerKm(t.trip_distance) > 40).length;
    const veryLongTripCount = segmentTrips.filter(t => roundToIntegerKm(t.trip_distance) >= 100).length;
    const { cap: maxStep, tier: capTier } = stepCapFor(longTripCount, veryLongTripCount);

    const blankedDates = getGapBlankedSegments(trips);
    const isGapSpan = segmentTrips.length > 0 && segmentTrips.some(t => blankedDates.has(t.date));

    // Day-atom: every built segment carries Trips (guaranteed non-empty
    // date range); only the open tail after the last fuel-in pends.
    const isPending = false;
    const isLowConfidence = false;

    const push = (suggested: number | null, feasible: boolean, feasibleMin: number | null, feasibleMax: number | null, warning?: string, isGap = false) => {
      results.push({
        fromDate, toDate, distance: totalDist, fuelFed, orderNo: seg.orderNo, orderDate: seg.fuelDate,
        fuelDate: seg.fuelDate, ownership: seg.ownership, gapChosen: seg.gapChosen, gapOther: seg.gapOther,
        isFullTank, openIsFull: seg.openIsFull, closeIsFull: seg.closeIsFull, pumpTiming, prevEconomy: prev, suggested, feasible, feasibleMin, feasibleMax, warning,
        isFullToFull, nextIsFull, startPos, trips: segmentTrips, isGapSpan: isGap, maxTripDistance, longTripCount, veryLongTripCount,
        isPending, isLowConfidence,
      });
    };

    if (isGapSpan) {
      push(null, false, null, null, 'Economy not calculated — ODO gap', true);
      prevEconomy = prev;
      continue;
    }

    const lockedSet = params.lockedDatesSet;
    const lockedMap = params.lockedEconomyMap;
    if (lockedSet && lockedMap) {
      const segDates = segmentTrips.length > 0 ? Array.from(new Set(segmentTrips.map(t => t.date))) : [fromDate];
      const allLocked = segDates.length > 0 && segDates.every(d => lockedSet.has(d));
      if (allLocked) {
        const lockedEcon = lockedMap.get(fromDate) ?? prev ?? estimatePrevEconomyFallback();
        const lockedVal = roundToOneDecimal(lockedEcon);
        push(lockedVal, true, lockedVal, lockedVal, '🔒 Locked — not re-estimated');
        if (segmentTrips.length > 0) runningPos = simulateFinalBalance(segmentTrips, runningPos, lockedVal);
        prevEconomy = lockedVal;
        continue;
      }
    }

    if (totalDist === 0) {
      const v = roundToOneDecimal(prev!);
      push(v, true, 0.1, 50, '0 km — no distance in segment');
      prevEconomy = v;
      continue;
    }

    const candidatePrev = prev ?? estimatePrevEconomyFallback();

    // Feasible set (shared by both selection rules)
    const feasibleEs: number[] = [];
    for (let e10 = 1; e10 <= 500; e10++) {
      const e = e10 / 10;
      const v = simulateMaxViolation(segmentTrips, runningPos, e);
      if (v < 1e-9) feasibleEs.push(e);
    }
    const feasibleMin = feasibleEs.length > 0 ? feasibleEs[0] : null;
    const feasibleMax = feasibleEs.length > 0 ? feasibleEs[feasibleEs.length - 1] : null;

    if (isFullToFull) {
      // Physics-first (backward): distance since the previous Full Tank /
      // the closing Full Tank fuel, which restores the tank to full.
      const totalFuelInSeg = seg.closeFuel > 0 ? seg.closeFuel : fuelFed;
      let rawEcon: number | null = null;
      if (totalFuelInSeg > 0) rawEcon = totalDist / totalFuelInSeg;
      else if (fuelFed > 0) rawEcon = totalDist / fuelFed;
      if (rawEcon !== null && isFinite(rawEcon)) {
        let suggestedRaw = roundToOneDecimal(rawEcon);
        suggestedRaw = Math.min(50, Math.max(0.1, suggestedRaw));
        let bestE = suggestedRaw;
        if (feasibleEs.length > 0) {
          let bestDist = Infinity;
          for (const e of feasibleEs) { const d = Math.abs(e - suggestedRaw); if (d < bestDist - 1e-9) { bestDist = d; bestE = e; } }
        } else {
          let bestScore = Infinity;
          for (let e10 = 1; e10 <= 500; e10++) { const e = e10 / 10; const v = simulateMaxViolation(segmentTrips, runningPos, e); const score = v + Math.abs(e - suggestedRaw) * 0.01; if (score < bestScore - 1e-9) { bestScore = score; bestE = e; } }
        }
        const suggested = roundToOneDecimal(bestE);
        let warning: string | undefined;
        if (feasibleEs.length === 0) {
          warning = `Computed ${suggestedRaw.toFixed(1)} km/L (${totalDist} km / ${totalFuelInSeg > 0 ? totalFuelInSeg.toFixed(1) : fuelFed.toFixed(1)} L) keeps fuel outside [1, ${tankCapacity.toFixed(1)}]L — nearest feasible ${suggested.toFixed(1)} suggested`;
        } else {
          const lowSafe = safeWin.low - safeWin.margin;
          const highSafe = safeWin.high + safeWin.margin;
          if (suggested < lowSafe || suggested > highSafe) warning = `Outside typical range [${safeWin.low.toFixed(1)}–${safeWin.high.toFixed(1)} ±20%] — ${suggested.toFixed(1)} km/L`;
        }
        push(suggested, feasibleEs.length > 0, feasibleMin, feasibleMax, warning);
        runningPos = simulateFinalBalance(segmentTrips, runningPos, suggested);
        prevEconomy = suggested;
        continue;
      }
    }

    // Non Full->Full: choose by mode.
    // Normal caps the step from the previous economy (maxStep) so the sequence
    // stays smooth even when feasibility would force a jump; the segment is then
    // flagged infeasible with a warning. Long-trip segments get a wider cap.
    // Strict stays feasibility-first.
    let bestE = candidatePrev;
    let foundFeasible = feasibleEs.length > 0;
    let warning: string | undefined;
    if (feasibleEs.length > 0) {
      if (nextIsFull) {
        // Full-Tank Tolerance Window [cap-3, cap+1]: float post-pump inside the
        // window to minimize economy variation (Q2/Q7). Both Normal and Strict
        // share this; Normal still step-caps afterwards, Strict stays uncapped.
        const inWindow = feasibleEs.filter(e => {
          const endBal = simulateFinalBalance(segmentTrips, runningPos, e);
          const postPump = roundToOneDecimal(endBal + (nextPumpIncluded ? 0 : nextPumpAmount));
          return postPump >= strictMin - 1e-9 && postPump <= strictMax + 1e-9;
        });
        const pool = inWindow.length > 0 ? inWindow : feasibleEs;
        let nearest = pool[0];
        let bestDist = Infinity;
        let bestCapDiff = Infinity;
        for (const e of pool) {
          const d = Math.abs(e - candidatePrev);
          const endBal = simulateFinalBalance(segmentTrips, runningPos, e);
          const postPump = roundToOneDecimal(endBal + (nextPumpIncluded ? 0 : nextPumpAmount));
          const capDiff = Math.abs(postPump - tankCapacity);
          if (d < bestDist - 1e-9 || (Math.abs(d - bestDist) < 1e-9 && capDiff < bestCapDiff - 1e-9)) {
            bestDist = d; bestCapDiff = capDiff; nearest = e;
          }
        }
        if (!strict) {
          const step = nearest - candidatePrev;
          if (Math.abs(step) > maxStep + 1e-9) {
            bestE = roundToOneDecimal(candidatePrev + Math.sign(step) * maxStep);
            foundFeasible = false;
            warning = `Step capped at ${maxStep.toFixed(1)} km/L from ${candidatePrev.toFixed(1)} (nearest feasible ${nearest.toFixed(1)}${capTier ? `, ${capTier}` : ''}) — balance may leave [1, ${tankCapacity.toFixed(1)}]L`;
          } else {
            bestE = nearest;
            if (inWindow.length === 0) {
              const endBal = simulateFinalBalance(segmentTrips, runningPos, bestE);
              const postPump = roundToOneDecimal(endBal + (nextPumpIncluded ? 0 : nextPumpAmount));
              warning = `Post-pump balance ${postPump.toFixed(1)}L outside full-tank window [${strictMin.toFixed(1)}, ${strictMax.toFixed(1)}]L — nearest feasible suggested`;
            }
          }
        } else {
          bestE = nearest;
          if (inWindow.length === 0) {
            const endBal = simulateFinalBalance(segmentTrips, runningPos, bestE);
            const postPump = roundToOneDecimal(endBal + (nextPumpIncluded ? 0 : nextPumpAmount));
            warning = `Strict: post-pump balance ${postPump.toFixed(1)}L outside full-tank window [${strictMin.toFixed(1)}, ${strictMax.toFixed(1)}]L — nearest feasible suggested`;
          }
        }
      } else {
        // Normal: nearest feasible to the previous economy, but cap the step.
        let nearest = candidatePrev;
        let bestDist = Infinity;
        for (const e of feasibleEs) { const d = Math.abs(e - candidatePrev); if (d < bestDist - 1e-9) { bestDist = d; nearest = e; } }
        const step = nearest - candidatePrev;
        if (!strict && Math.abs(step) > maxStep + 1e-9) {
          bestE = roundToOneDecimal(candidatePrev + Math.sign(step) * maxStep);
          foundFeasible = false;
          warning = `Step capped at ${maxStep.toFixed(1)} km/L from ${candidatePrev.toFixed(1)} (nearest feasible ${nearest.toFixed(1)}${capTier ? `, ${capTier}` : ''}) — balance may leave [1, ${tankCapacity.toFixed(1)}]L`;
        } else {
          bestE = nearest;
        }
      }
    } else {
      let bestScore = Infinity;
      for (let e10 = 1; e10 <= 500; e10++) {
        const e = e10 / 10;
        const v = simulateMaxViolation(segmentTrips, runningPos, e);
        const score = v + Math.abs(e - candidatePrev) * 0.01;
        if (score < bestScore - 1e-9) { bestScore = score; bestE = e; }
      }
      const step = bestE - candidatePrev;
      if (!strict && Math.abs(step) > maxStep + 1e-9) {
        bestE = roundToOneDecimal(candidatePrev + Math.sign(step) * maxStep);
        warning = `No 1-dec economy keeps fuel in [1, ${tankCapacity.toFixed(1)}]L — step capped to ${roundToOneDecimal(bestE).toFixed(1)} km/L${capTier ? ` (${capTier})` : ''} (check KM/fuel gaps)`;
      } else {
        warning = `No 1-dec economy keeps fuel in [1, ${tankCapacity.toFixed(1)}]L — nearest ${roundToOneDecimal(bestE).toFixed(1)} km/L suggested (check KM/fuel gaps)`;
      }
    }
    const suggested = roundToOneDecimal(bestE);
    if (foundFeasible) {
      const distFromPrev = Math.abs(suggested - candidatePrev);
      if (distFromPrev > 3) warning = `Large step from ${candidatePrev.toFixed(1)} to ${suggested.toFixed(1)} (Strict full-tank target)`;
      const lowSafe = safeWin.low - safeWin.margin;
      const highSafe = safeWin.high + safeWin.margin;
      if (suggested < lowSafe || suggested > highSafe) {
        const safeWarn = `Outside typical range [${safeWin.low.toFixed(1)}–${safeWin.high.toFixed(1)} ±20%] — ${suggested.toFixed(1)} km/L`;
        warning = warning ? `${warning} | ${safeWarn}` : safeWarn;
      }
    }
    push(suggested, foundFeasible, feasibleMin, feasibleMax, warning);
    const endBal = simulateFinalBalance(segmentTrips, runningPos, suggested);
    const postPumpCarry = roundToOneDecimal(endBal + (nextPumpIncluded ? 0 : nextPumpAmount));
    // Float carries forward (Q6): if the next pump is Full Tank, its post-pump
    // value in [cap-3, cap+1] becomes the next segment's opening; otherwise the
    // end balance carries (clamped to the modelling ceiling).
    if (nextIsFull) {
      runningPos = Math.min(strictMax, Math.max(1, postPumpCarry));
    } else {
      runningPos = endBal;
    }
    prevEconomy = suggested;
  }

  // Exponential Smoothing (alpha = 0.7) & Global Delta Constraints (MaxDelta = 1.5)
  if (!strict && results.length > 1) {
    const original = results.map(r => r.suggested);

    for (let i = 1; i < results.length; i++) {
      const r = results[i];
      const prevSeg = results[i - 1];
      if (r.isGapSpan || r.warning?.includes('Locked') || prevSeg.suggested === null) continue;
      if (r.trips.length === 0 || r.suggested === null) continue;

      const segDist = r.distance;
      const segFuel = r.fuelFed > 0 ? r.fuelFed : (r.trips.reduce((s, t) => s + roundToOneDecimal(t.fuel_pumped_amount ?? 0), 0));
      let rawEcon = segFuel > 0 ? segDist / segFuel : prevSeg.suggested;
      rawEcon = Math.min(50, Math.max(0.1, rawEcon));

      const alpha = 0.7;
      const prevFinal = prevSeg.suggested;
      const smoothed = alpha * rawEcon + (1 - alpha) * prevFinal;
      const roundedSmoothed = roundToOneDecimal(smoothed);

      r.suggested = roundedSmoothed;
    }

    const maxDelta = 1.5;
    for (let iter = 0; iter < 3; iter++) {
      for (let i = 1; i < results.length; i++) {
        const prevSeg = results[i - 1];
        const currSeg = results[i];
        if (prevSeg.suggested === null || currSeg.suggested === null) continue;
        if (prevSeg.isGapSpan || currSeg.isGapSpan || prevSeg.warning?.includes('Locked') || currSeg.warning?.includes('Locked')) continue;

        const delta = currSeg.suggested - prevSeg.suggested;
        if (Math.abs(delta) > maxDelta) {
          const adjusted = prevSeg.suggested + Math.sign(delta) * maxDelta;
          currSeg.suggested = roundToOneDecimal(Math.min(50, Math.max(0.1, adjusted)));
        }
      }
    }

    let pos = posBeforeFirstSeg;
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.openIsFull) pos = tankCapacity;
      if (r.trips.length > 0 && r.suggested !== null) {
        const v = simulateMaxViolation(r.trips, pos, r.suggested);
        if (v >= 1e-9) {
          r.suggested = original[i];
        }
        if (r.suggested !== null) {
          pos = simulateFinalBalance(r.trips, pos, r.suggested);
        }
      }
    }
  }

  // Keep the displayed "previous economy" chain consistent with the final
  // suggestions (smoothing may have moved an earlier segment's value).
  let chainPrev = initialPrevEconomy;
  for (const r of results) {
    r.prevEconomy = chainPrev;
    if (r.suggested !== null) {
      chainPrev = r.suggested;
    }
  }

  // Open tail after the last fuel-in: no closing fuel yet, so nothing to
  // estimate — it inherits. Listed as pending so the operator sees it.
  if (tailTrips.length > 0) {
    const tailFrom = tailDates[0];
    const tailTo = tailDates[tailDates.length - 1];
    const tailDist = roundToIntegerKm(tailTrips.reduce((s, t) => s + roundToIntegerKm(t.trip_distance), 0));
    const maxTail = tailTrips.reduce((m, t) => Math.max(m, roundToIntegerKm(t.trip_distance)), 0);
    results.push({
      fromDate: tailFrom,
      toDate: tailTo,
      distance: tailDist,
      fuelFed: 0,
      orderNo: '',
      orderDate: tailFrom,
      fuelDate: tailFrom,
      ownership: 'previous',
      gapChosen: null,
      gapOther: null,
      isFullTank: false,
      openIsFull: false,
      closeIsFull: false,
      pumpTiming: 'END',
      prevEconomy: chainPrev,
      suggested: null,
      feasible: false,
      feasibleMin: null,
      feasibleMax: null,
      warning: 'Pending — open segment, no closing fuel yet',
      isFullToFull: false,
      nextIsFull: false,
      startPos: runningPos,
      trips: tailTrips,
      isGapSpan: false,
      maxTripDistance: maxTail,
      longTripCount: tailTrips.filter(t => roundToIntegerKm(t.trip_distance) > 40).length,
      veryLongTripCount: tailTrips.filter(t => roundToIntegerKm(t.trip_distance) >= 100).length,
      isPending: true,
      isLowConfidence: false,
    });
  }

  return results;
}

/**
 * Estimate economies for all Fuel-In Segments. Runs the lenient and strict
 * full-tank passes and returns both suggestions per segment so the operator
 * can pick either.
 */
export function estimateFuelEconomies(params: {
  trips: Trip[];
  pages: BookPage[];
  vehicle: Vehicle | null;
  prevEconomies?: (number | null | undefined)[];
  tankCapacityOverride?: number;
  strictFullTank?: boolean;
  lockedDatesSet?: Set<string>;
  lockedEconomyMap?: Map<string, number>;
  ownership?: FuelDayOwnershipInput;
}): SegmentEstimate[] {
  const normal = runEstimationPass({ ...params, strictFullTank: false });
  const strictPass = runEstimationPass({ ...params, strictFullTank: true });
  return normal.map((n, i) => {
    const s = strictPass[i] ?? n;
    return {
      fromDate: n.fromDate,
      toDate: n.toDate,
      distance: n.distance,
      fuelFed: n.fuelFed,
      orderNo: n.orderNo,
      orderDate: n.orderDate,
      fuelDate: n.fuelDate,
      ownership: n.ownership,
      gapChosen: n.gapChosen,
      gapOther: n.gapOther,
      isFullTank: n.isFullTank,
      pumpTiming: n.pumpTiming,
      tripIds: n.trips.map((t) => t.id),
      isPending: n.isPending,
      isLowConfidence: n.isLowConfidence,
      prevEconomy: n.prevEconomy,
      suggested: n.isGapSpan ? null : n.suggested,
      suggestedStrict: s.isGapSpan ? null : s.suggested,
      feasible: n.feasible,
      feasibleStrict: s.feasible,
      feasibleMin: n.feasibleMin,
      feasibleMax: n.feasibleMax,
      feasibleMinStrict: s.feasibleMin,
      feasibleMaxStrict: s.feasibleMax,
      warning: n.warning,
      warningStrict: s.warning,
      isGapSpan: n.isGapSpan,
      maxTripDistance: n.maxTripDistance,
      longTripCount: n.longTripCount,
      veryLongTripCount: n.veryLongTripCount,
    };
  });
}
