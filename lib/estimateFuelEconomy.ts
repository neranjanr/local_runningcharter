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
 * Estimate economies for all segments using trip-level logic:
 * Economy changes only AFTER the pumped trip (not the pumped date).
 * Fuel pumped on trip k is available only for trips k+1 onward.
 * Each fuel-in segment after a pump covers trips [pumpIdx+1 .. nextPumpIdx] inclusive of the next pump's distance.
 * Brute-force 0.1 step search keeps balance in [1, tankCapacity] after each trip.
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

  if (trips.length === 0) return [];

  const sortedTrips = [...trips].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.trip_index !== b.trip_index) return a.trip_index - b.trip_index;
    return a.start_km - b.start_km;
  });

  const pumpIndices: number[] = [];
  sortedTrips.forEach((t, idx) => {
    if ((t.fuel_pumped_amount ?? 0) > 0) pumpIndices.push(idx);
  });

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

  // Build date -> inTank map (default 0). For now 0; could be extended to read from stores.
  const dateInTank = new Map<string, number>();

  // Helper to simulate segment with candidate economy and return max violation
  const simulateMaxViolation = (segmentTrips: Trip[], startPos: number, economy: number): number => {
    let bal = roundToOneDecimal(startPos);
    const seenDates = new Set<string>();
    let maxViolation = 0;
    for (const t of segmentTrips) {
      if (!seenDates.has(t.date)) {
        seenDates.add(t.date);
        const it = roundToOneDecimal(dateInTank.get(t.date) ?? 0);
        if (it) bal = roundToOneDecimal(bal + it);
      }
      const consumed = roundToOneDecimal(roundToIntegerKm(t.trip_distance) / economy);
      const pumped = roundToOneDecimal(t.fuel_pumped_amount ?? 0);
      bal = roundToOneDecimal(bal - consumed + pumped);
      if (bal < minFuel) maxViolation = Math.max(maxViolation, minFuel - bal);
      else if (bal > tankCapacity) maxViolation = Math.max(maxViolation, bal - tankCapacity);
    }
    return maxViolation;
  };

  const simulateFinalBalance = (segmentTrips: Trip[], startPos: number, economy: number): number => {
    let bal = roundToOneDecimal(startPos);
    const seenDates = new Set<string>();
    for (const t of segmentTrips) {
      if (!seenDates.has(t.date)) {
        seenDates.add(t.date);
        const it = roundToOneDecimal(dateInTank.get(t.date) ?? 0);
        if (it) bal = roundToOneDecimal(bal + it);
      }
      const consumed = roundToOneDecimal(roundToIntegerKm(t.trip_distance) / economy);
      const pumped = roundToOneDecimal(t.fuel_pumped_amount ?? 0);
      bal = roundToOneDecimal(bal - consumed + pumped);
    }
    return bal;
  };

  // Initial segment before first pump: trips [0 .. pumpIndices[0]] inclusive, uses prevEconomy, no estimation needed but we need to advance runningPos through it
  const firstPumpIdx = pumpIndices[0];
  const initialTrips = sortedTrips.slice(0, firstPumpIdx + 1);
  // Simulate initial segment with prevEconomy to get startPos for first post-pump segment
  // If initial distance 0, keep runningPos as is
  if (initialTrips.length > 0) {
    // Use prevEconomy for initial segment; no suggestion generated for it, but we advance runningPos
    runningPos = simulateFinalBalance(initialTrips, runningPos, prevEconomy);
  }

  const results: SegmentEstimate[] = [];

  // Post-pump segments: for each pump i, segment = trips [pump_i +1 .. pump_{i+1}] inclusive of next pump, last segment goes to end
  for (let segIdx = 0; segIdx < pumpIndices.length; segIdx++) {
    const pumpIdx = pumpIndices[segIdx];
    const nextPumpIdx = pumpIndices[segIdx + 1];
    const segStart = pumpIdx + 1;
    const segEnd = nextPumpIdx !== undefined ? nextPumpIdx : sortedTrips.length - 1;
    if (segStart > segEnd) {
      // No trips after this pump (pump was last trip) -> no segment to estimate, but still need to account? Create zero-distance segment for completeness
      const fuelFed = roundToOneDecimal(sortedTrips[pumpIdx].fuel_pumped_amount ?? 0);
      const fromDate = sortedTrips[pumpIdx].date;
      results.push({
        fromDate,
        toDate: fromDate,
        distance: 0,
        fuelFed,
        orderNo: sortedTrips[pumpIdx].fuel_order_no ?? '',
        orderDate: fromDate,
        prevEconomy,
        suggested: roundToOneDecimal(prevEconomy),
        feasible: true,
        feasibleMin: 0.1,
        feasibleMax: 50,
        warning: '0 km — no trips after this pump',
      });
      // runningPos already includes this pump's fuel from initial simulation? For subsequent, we already advanced through initial; for consecutive pumps where segStart>segEnd (pumps adjacent), the next segment has zero trips, we still need to keep runningPos (already includes pump fuel)
      continue;
    }
    const segmentTrips = sortedTrips.slice(segStart, segEnd + 1);
    const totalDist = roundToIntegerKm(segmentTrips.reduce((s, t) => s + roundToIntegerKm(t.trip_distance), 0));
    const fuelFed = roundToOneDecimal(sortedTrips[pumpIdx].fuel_pumped_amount ?? 0);
    const orderNo = sortedTrips[pumpIdx].fuel_order_no ?? '';
    const fromDate = segmentTrips[0].date;
    const toDate = segmentTrips[segmentTrips.length - 1].date;
    const prev = prevEconomy;

    if (totalDist === 0) {
      results.push({
        fromDate,
        toDate,
        distance: 0,
        fuelFed,
        orderNo,
        orderDate: sortedTrips[pumpIdx].date,
        prevEconomy: prev,
        suggested: roundToOneDecimal(prev),
        feasible: true,
        feasibleMin: 0.1,
        feasibleMax: 50,
        warning: '0 km — no distance in segment',
      });
      prevEconomy = roundToOneDecimal(prev);
      // advance runningPos (no consumption)
      // runningPos already at start of segment, but we need to simulate with prev economy (no consumption)
      continue;
    }

    // Brute force search for best economy
    const candidatePrev = prev ?? estimatePrevEconomyFallback();
    let bestE = candidatePrev;
    let bestViolation = Infinity;
    let bestScore = Infinity;
    let foundFeasible = false;
    let feasibleMin: number | null = null;
    let feasibleMax: number | null = null;

    // First pass to find feasible range bounds
    const feasibleEs: number[] = [];
    for (let e10 = 1; e10 <= 500; e10++) {
      const e = e10 / 10;
      const v = simulateMaxViolation(segmentTrips, runningPos, e);
      if (v < 1e-9) {
        feasibleEs.push(e);
        if (feasibleMin === null || e < feasibleMin) feasibleMin = e;
        if (feasibleMax === null || e > feasibleMax) feasibleMax = e;
      }
    }

    if (feasibleEs.length > 0) {
      foundFeasible = true;
      // pick closest to prev among feasible
      let bestDist = Infinity;
      for (const e of feasibleEs) {
        const d = Math.abs(e - candidatePrev);
        if (d < bestDist - 1e-9) {
          bestDist = d;
          bestE = e;
        }
      }
      // If multiple at same distance, prefer one closest to prev rounded? Already
    } else {
      // No feasible: brute for minimal violation
      for (let e10 = 1; e10 <= 500; e10++) {
        const e = e10 / 10;
        const v = simulateMaxViolation(segmentTrips, runningPos, e);
        const stepPenalty = Math.abs(e - candidatePrev) * 0.01;
        const score = v + stepPenalty;
        if (score < bestScore - 1e-9) {
          bestScore = score;
          bestE = e;
          bestViolation = v;
        }
      }
    }

    const suggested = roundToOneDecimal(bestE);
    let warning: string | undefined;
    let feasible = foundFeasible;
    if (!foundFeasible) {
      warning = `No 1-dec economy keeps fuel in [${minFuel}, ${tankCapacity}]L — nearest ${suggested.toFixed(1)} km/L suggested (check KM/fuel gaps)`;
    } else if (feasibleMin !== null && feasibleMax !== null) {
      const distFromPrev = Math.abs(suggested - candidatePrev);
      if (distFromPrev > 3) warning = `Large step from ${candidatePrev.toFixed(1)} to ${suggested.toFixed(1)} to stay feasible`;
    }

    results.push({
      fromDate,
      toDate,
      distance: totalDist,
      fuelFed,
      orderNo,
      orderDate: sortedTrips[pumpIdx].date,
      prevEconomy: prev,
      suggested,
      feasible,
      feasibleMin,
      feasibleMax,
      warning,
    });

    // Advance runningPos for next segment using suggested economy
    runningPos = simulateFinalBalance(segmentTrips, runningPos, suggested);
    prevEconomy = suggested;
  }

  return results;
}
