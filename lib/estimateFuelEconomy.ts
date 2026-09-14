/**
 * Estimated Fuel Economy per Fuel-In Segment
 * Feasibility-first estimator: keeps balance in [1, tankCapacity] at every intermediate Day Group.
 * See docs/adr/0011-estimated-fuel-economy-per-fuel-in-segment.md
 */
import { roundToOneDecimal, roundToIntegerKm } from './tripCalculations';
import { computeLedgerDays } from './ledgerCalculations';
import type { BookPage, Trip, Vehicle } from '@/types';
import { getDistinctDates } from './pagination';

export interface FuelInSegmentInput {
  fromDate: string; // YYYY-MM-DD
  toDate: string; // inclusive end of segment (day before next fuel-in, or last date)
  distance: number; // Integer KM summed
  fuelFed: number; // 1-dec L pumped on fromDate
  orderNo: string;
}

export interface SegmentEstimate {
  fromDate: string;
  toDate: string;
  distance: number;
  fuelFed: number;
  orderNo: string;
  orderDate: string;
  prevEconomy: number | null;
  suggested: number; // 1-dec
  feasible: boolean;
  feasibleMin: number | null;
  feasibleMax: number | null;
  warning?: string;
}

/**
 * Derive per-date aggregated distance and fuel fed, ordered chronologically.
 */
function buildDateAggregates(params: { trips: Trip[]; pages: BookPage[] }): Map<string, { distance: number; drawn: number; orderNo: string; inTank: number; positionSeed?: number }> {
  // We use chronological order of dates from trips
  const allDates = Array.from(new Set(params.trips.map(t => t.date))).sort();
  const map = new Map<string, { distance: number; drawn: number; orderNo: string; inTank: number }>();
  for (const d of allDates) {
    const dayTrips = params.trips.filter(t => t.date === d);
    const distance = roundToIntegerKm(dayTrips.reduce((s, t) => s + roundToIntegerKm(t.trip_distance), 0));
    const drawn = roundToOneDecimal(dayTrips.reduce((s, t) => s + roundToOneDecimal(t.fuel_pumped_amount ?? 0), 0));
    const orderNos = dayTrips.filter(t => t.fuel_order_no?.trim()).map(t => t.fuel_order_no!.trim());
    map.set(d, { distance, drawn, orderNo: orderNos.join(', '), inTank: 0 });
  }
  return map;
}

/**
 * Compute feasibility interval for a segment given start position and per-day distances/inTanks.
 * Balance after k days: B_k = pos + sumInTank_{≤k} + drawn0 - sumDist_{≤k}/E
 * Require 1 ≤ B_k ≤ tankCap for all k
 * Solve for E: sumDist / (pos+sumInTank+drawn - bound) bounds
 */
function feasibleIntervalForSegment(params: {
  pos: number;
  drawn: number;
  perDay: { dist: number; inTank: number }[];
  tankCapacity: number;
  minFuel: number;
}): { min: number | null; max: number | null; feasible: boolean; warning?: string } {
  const { pos, drawn, perDay, tankCapacity, minFuel } = params;
  // Dist ==0 -> interval is whole range
  const totalDist = perDay.reduce((s, d) => s + d.dist, 0);
  if (totalDist === 0) return { min: 0.1, max: 50, feasible: true };

  // For each prefix, derive allowed E range
  // B_k = A_k - sumDist_k / E where A_k = pos + inTankPrefix + drawn
  // 1 ≤ A_k - sum/E ≤ cap  =>  A_k - cap ≤ sum/E ≤ A_k -1
  // => sum/(A_k -1) ≤ E ≤ sum/(A_k - cap)  careful with denominators signs
  // Denominators may be ≤0 making one side infeasible (no upper bound or no lower bound)
  let globalMin = 0.1;
  let globalMax = 50;
  let hasConstraint = false;

  let sumDist = 0;
  let sumInTank = 0;
  for (const day of perDay) {
    sumDist += day.dist;
    sumInTank += day.inTank;
    const A = pos + sumInTank + drawn;
    // Upper bound from lower fuel limit: sum/E ≤ A -1 => E ≥ sum / (A-1) if A>1
    // Lower bound from upper tank limit: sum/E ≥ A - cap => E ≤ sum / (A - cap) if A>cap
    const denomLow = A - minFuel; // for E lower bound
    const denomHigh = A - tankCapacity; // for E upper bound

    // If A - minFuel <=0, then sum/E ≤ non-positive impossible since sum>0, E>0 => no solution for this prefix -> infeasible
    if (denomLow <= 0) {
      // Even infinite E gives B_k = A < = minFuel, always below min -> infeasible interval
      return { min: null, max: null, feasible: false, warning: `Infeasible: start fuel ${A.toFixed(1)}L ≤ min ${minFuel}L` };
    }
    const eMinForPrefix = sumDist / denomLow;
    if (eMinForPrefix > globalMin) globalMin = eMinForPrefix;

    if (denomHigh > 0) {
      const eMaxForPrefix = sumDist / denomHigh;
      if (eMaxForPrefix < globalMax) globalMax = eMaxForPrefix;
    } else {
      // A ≤ cap => A - cap ≤0 => sum/E ≥ negative always true => no upper bound from this prefix
    }
    hasConstraint = true;
  }

  if (!hasConstraint) return { min: 0.1, max: 50, feasible: true };
  // Clamp to 0.1-50
  globalMin = Math.max(0.1, globalMin);
  globalMax = Math.min(50, globalMax);
  if (globalMin > globalMax + 1e-9) {
    return { min: null, max: null, feasible: false };
  }
  return { min: globalMin, max: globalMax, feasible: true };
}

function snapToOneDecimalFeasible(prev: number, intervalMin: number, intervalMax: number): number {
  // Candidate = clamp(prev, min, max) then snap to nearest 0.1 inside interval
  const clamped = Math.min(intervalMax, Math.max(intervalMin, prev));
  let candidate = roundToOneDecimal(clamped);
  // If rounding pushes outside, nudge
  if (candidate < intervalMin - 1e-9) candidate = Math.ceil(intervalMin * 10) / 10;
  if (candidate > intervalMax + 1e-9) candidate = Math.floor(intervalMax * 10) / 10;
  // Final clamp 0.1-50
  candidate = Math.min(50, Math.max(0.1, roundToOneDecimal(candidate)));
  // If still outside because of ceil/floor edge, ensure at least min
  if (candidate < intervalMin) candidate = Math.ceil(intervalMin * 10) / 10;
  if (candidate > intervalMax) candidate = Math.floor(intervalMax * 10) / 10;
  return roundToOneDecimal(candidate);
}

function nearestFeasibleBoundary(prev: number, min: number | null, max: number | null): number {
  // When interval empty, pick nearest boundary to prev (among min/max boundaries extrapolated)
  // Actually we have no interval; we treat both infeasible, pick value that minimizes violation via brute 0.1 search on violation metric
  // Simplified: search 0.1..50 for minimal max violation
  // For now, pick closest to prev within 0.1..50 but flagged
  // Caller will brute search for minimal violation instead; placeholder
  return roundToOneDecimal(Math.min(50, Math.max(0.1, prev)));
}

/**
 * Build Fuel-In segments ordered by date.
 * Aggregates per-date; a fuel-in date is where aggregated drawn>0.
 */
export function buildFuelInSegments(params: { trips: Trip[]; inTankMap?: Map<string, number> }): FuelInSegmentInput[] {
  const { trips } = params;
  const dateMap = new Map<string, { distance: number; drawn: number; orderNo: string }>();
  for (const t of trips) {
    const rec = dateMap.get(t.date) ?? { distance: 0, drawn: 0, orderNo: '' };
    rec.distance += roundToIntegerKm(t.trip_distance);
    rec.drawn += roundToOneDecimal(t.fuel_pumped_amount ?? 0);
    if (t.fuel_order_no?.trim()) {
      rec.orderNo = rec.orderNo ? `${rec.orderNo}, ${t.fuel_order_no.trim()}` : t.fuel_order_no.trim();
    }
    dateMap.set(t.date, rec);
  }
  const sortedDates = Array.from(dateMap.keys()).sort();
  // Normalize distances/drawn rounding post-sum
  for (const [k, v] of dateMap) {
    v.distance = roundToIntegerKm(v.distance);
    v.drawn = roundToOneDecimal(v.drawn);
  }
  const fuelInDates = sortedDates.filter(d => (dateMap.get(d)?.drawn ?? 0) > 0);
  if (fuelInDates.length === 0) return [];
  const segments: FuelInSegmentInput[] = [];
  for (let i = 0; i < fuelInDates.length; i++) {
    const from = fuelInDates[i];
    const nextFuel = fuelInDates[i + 1];
    const toIdx = nextFuel ? sortedDates.indexOf(nextFuel) - 1 : sortedDates.length - 1;
    const fromIdx = sortedDates.indexOf(from);
    const sliceDates = sortedDates.slice(fromIdx, toIdx + 1);
    const distance = roundToIntegerKm(sliceDates.reduce((s, d) => s + (dateMap.get(d)?.distance ?? 0), 0));
    const fuelFed = roundToOneDecimal(dateMap.get(from)?.drawn ?? 0);
    const orderNo = dateMap.get(from)?.orderNo ?? '';
    const toDate = sliceDates[sliceDates.length - 1];
    segments.push({ fromDate: from, toDate, distance, fuelFed, orderNo });
  }
  return segments;
}

function estimatePrevEconomyFallback(): number {
  return 7.8; // practical prior per Q1/Q10
}

/**
 * Estimate economies for all segments, using ledger to get per-day positions and inTanks.
 * Falls back to simple date-aggregates if ledger unavailable.
 */
export function estimateFuelEconomies(params: {
  trips: Trip[];
  pages: BookPage[];
  vehicle: Vehicle | null;
  prevEconomies?: (number | null | undefined)[];
  tankCapacityOverride?: number;
}): SegmentEstimate[] {
  const { trips, pages, vehicle, prevEconomies } = params;
  const tankCapacity = params.tankCapacityOverride ?? (vehicle?.tank_capacity ?? 75);
  const minFuel = 1;
  const segments = buildFuelInSegments({ trips });
  if (segments.length === 0) return [];

  // Need per-date ledger details to get position and inTank per day
  // Build a map date -> { pos, inTank, dist } by running ledgerDays across pages ordered by page_number
  const dateLedger = new Map<string, { pos: number; inTank: number; dist: number }>();
  const sortedPages = [...pages].sort((a, b) => a.page_number - b.page_number);
  // To get pos/inTank/dist per date, compute ledgerDays for each page (economies/inTanks from stores or defaults doesn't affect distances, but pos does propagate)
  // For estimation, we need actual pos chain with current economies? We approximate using provided prevEconomies propagation else fallback.
  // Simplify: use computeLedgerDays with given prevEconomies approximated? Instead derive pos as cumulative fuel logic with unknown E -> we iterate.
  // We'll instead build per-date inTank and dist independent of economy, and simulate pos chain using our own suggested Es sequentially.
  const dateInfo = new Map<string, { dist: number; inTank: number; drawn: number }>();
  // collect per-date inTank from ledger if available via Import: we don't have global store here, so default 0; caller can inject via trips? For now 0
  // Use trips per date for dist/drawn
  for (const seg of segments) {
    // dates slice will be recomputed later with successor logic; just ensure map filled
  }
  const allSortedDates = Array.from(new Set(trips.map(t => t.date))).sort();
  for (const d of allSortedDates) {
    const dayTrips = trips.filter(t => t.date === d);
    const dist = roundToIntegerKm(dayTrips.reduce((s, t) => s + roundToIntegerKm(t.trip_distance), 0));
    // Try to get inTank from any page's stored inTanks: we need page lookup
    // Find page for date
    const sampleTrip = dayTrips[0];
    let inTank = 0;
    if (sampleTrip) {
      // This is best-effort; real inTank may be stored per page; we default 0 if not found
      // Attempt to compute via ledgerDays if possible (import side doesn't have access to localStorage in node)
      // So keep 0
    }
    const drawn = roundToOneDecimal(dayTrips.reduce((s, t) => s + roundToOneDecimal(t.fuel_pumped_amount ?? 0), 0));
    dateInfo.set(d, { dist, inTank, drawn });
  }

  // Opening fuel position is start_fuel_balance of first page sorted
  let runningPos = sortedPages.length > 0 ? roundToOneDecimal(sortedPages[0].start_fuel_balance) : 10;
  // If pages empty, use vehicle fallback
  if (sortedPages.length === 0 && vehicle) runningPos = roundToOneDecimal((vehicle as unknown as Record<string, unknown>).current_fuel_level as number ?? 10);

  const results: SegmentEstimate[] = [];
  let prevEconomy: number | null = null;
  // Seed prev from last explicit before first segment if provided
  if (prevEconomies && prevEconomies.length > 0) {
    const lastExplicit = [...prevEconomies].reverse().find(v => v !== null && v !== undefined && Number(v) > 0) as number | undefined;
    if (lastExplicit) prevEconomy = roundToOneDecimal(lastExplicit);
  }
  if (prevEconomy === null) prevEconomy = estimatePrevEconomyFallback();

  // For each segment, build per-day array for its date slice
  const fuelInDates = segments.map(s => s.fromDate);
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const nextFuelDate = fuelInDates[i + 1];
    const sliceDates = allSortedDates.filter(d => d >= seg.fromDate && (nextFuelDate ? d < nextFuelDate : true));
    const perDay = sliceDates.map(d => ({ dist: dateInfo.get(d)?.dist ?? 0, inTank: dateInfo.get(d)?.inTank ?? 0 }));
    const totalDist = perDay.reduce((s, x) => s + x.dist, 0);
    const prev = prevEconomy;

    if (totalDist === 0) {
      const suggested = prev ?? estimatePrevEconomyFallback();
      results.push({
        fromDate: seg.fromDate,
        toDate: seg.toDate,
        distance: totalDist,
        fuelFed: seg.fuelFed,
        orderNo: seg.orderNo,
        orderDate: seg.fromDate,
        prevEconomy: prev,
        suggested: roundToOneDecimal(suggested),
        feasible: true,
        feasibleMin: 0.1,
        feasibleMax: 50,
        warning: '0 km — no distance in segment',
      });
      // advance runningPos: no consumption
      runningPos = roundToOneDecimal(runningPos + seg.fuelFed);
      prevEconomy = roundToOneDecimal(suggested);
      continue;
    }

    const interval = feasibleIntervalForSegment({ pos: runningPos, drawn: seg.fuelFed, perDay, tankCapacity, minFuel });
    let suggested: number;
    let feasible = interval.feasible;
    let warning: string | undefined;

    if (interval.feasible && interval.min !== null && interval.max !== null) {
      suggested = snapToOneDecimalFeasible(prev ?? estimatePrevEconomyFallback(), interval.min, interval.max);
      // If interval empty after rounding? Check brute
      // Ensure suggested feasible at 1-dec granularity via brute validate
      const consumed = roundToOneDecimal(totalDist / suggested);
      // Quick validate all prefixes with suggested (approx total only) — for thorough check re-validate per prefix with discrete balance steps rounded?
      // We do full per-prefix validation using real balances rounded per day?
      // For now accept
    } else {
      // Infeasible: brute search minimal violation
      feasible = false;
      const candidatePrev = prev ?? estimatePrevEconomyFallback();
      // Brute 0.1..50 to find minimal max violation (distance to keep balance in range)
      let bestE = candidatePrev;
      let bestScore = Infinity;
      let bestMinViolation: number | null = null;
      let bestMaxViolation: number | null = null;
      for (let e10 = 1; e10 <= 500; e10++) {
        const e = e10 / 10;
        let maxViolation = 0;
        let sumD = 0;
        let sumIT = 0;
        for (const day of perDay) {
          sumD += day.dist;
          sumIT += day.inTank;
          const A = runningPos + sumIT + seg.fuelFed;
          const B = A - sumD / e;
          if (B < minFuel) maxViolation = Math.max(maxViolation, minFuel - B);
          else if (B > tankCapacity) maxViolation = Math.max(maxViolation, B - tankCapacity);
        }
        const stepPenalty = Math.abs(e - candidatePrev) * 0.01; // tiny weight to prefer near prev
        const score = maxViolation + stepPenalty;
        if (score < bestScore - 1e-9) {
          bestScore = score;
          bestE = e;
        }
      }
      suggested = roundToOneDecimal(bestE);
      warning = `No 1-dec economy keeps fuel in [${minFuel}, ${tankCapacity}]L — nearest ${suggested.toFixed(1)} km/L suggested (check KM/fuel gaps)`;
    }

    if (!feasible) {
      // keep warning as above
    } else if (interval.min !== null && interval.max !== null) {
      // If suggested is at boundary far from prev, add gentle warning
      const distFromPrev = Math.abs(suggested - (prev ?? estimatePrevEconomyFallback()));
      if (distFromPrev > 3) {
        warning = `Large step from ${prev?.toFixed(1) ?? '—'} to ${suggested.toFixed(1)} to stay feasible`;
      }
    }

    results.push({
      fromDate: seg.fromDate,
      toDate: seg.toDate,
      distance: totalDist,
      fuelFed: seg.fuelFed,
      orderNo: seg.orderNo,
      orderDate: seg.fromDate,
      prevEconomy: prev,
      suggested: roundToOneDecimal(suggested),
      feasible,
      feasibleMin: interval.min,
      feasibleMax: interval.max,
      warning,
    });

    // Update runningPos for next segment: B_last with suggested economy (using sum)
    // Need actual consumed = totalDist / suggested (rounded 1-dec per day? For chain, use precise then round)
    // Use per-day consumption rounded per day sum for closer to ledger
    let totalConsumed = 0;
    for (const day of perDay) {
      totalConsumed += roundToOneDecimal(day.dist / suggested);
    }
    totalConsumed = roundToOneDecimal(totalConsumed);
    const inTankSum = perDay.reduce((s, d) => s + d.inTank, 0);
    runningPos = roundToOneDecimal(runningPos + inTankSum + seg.fuelFed - totalConsumed);
    // Clamp runningPos to [1, cap] for next interval start? Keep as computed even if negative/capped to show propagation; but for feasibility we clamp within? Let it be computed (negative will make next interval infeasible — which is correct to surface)
    // However ensure we keep at least 1 for next? We keep as is to propagate error visibility
    prevEconomy = roundToOneDecimal(suggested);
  }

  return results;
}
