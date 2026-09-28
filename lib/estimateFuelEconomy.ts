/**
 * Estimated Fuel Economy per Fuel-In Segment
 * Feasibility-first estimator: keeps balance in [1, tankCapacity] at every intermediate Day Group.
 * Pump Timing migration, physics-first Full->Full, small-variation lenient, strict full-tank,
 * and dual Normal + Strict suggestions for the estimation popup.
 */
import { roundToOneDecimal, roundToIntegerKm } from './tripCalculations';
import type { BookPage, Trip, Vehicle } from '@/types';

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
  isFullTank: boolean;
  pumpTiming: 'START' | 'END';
  prevEconomy: number | null;
  /** Normal (lenient) suggestion — balances in [1, tankCapacity]. */
  suggested: number;
  /** Strict Full-Tank suggestion — balance after a Full Tank pump kept near tankCapacity. */
  suggestedStrict: number;
  feasible: boolean;
  feasibleStrict: boolean;
  feasibleMin: number | null;
  feasibleMax: number | null;
  feasibleMinStrict: number | null;
  feasibleMaxStrict: number | null;
  warning?: string;
  warningStrict?: string;
}

interface PassSegment {
  fromDate: string;
  toDate: string;
  distance: number;
  fuelFed: number;
  orderNo: string;
  orderDate: string;
  isFullTank: boolean;
  pumpTiming: 'START' | 'END';
  prevEconomy: number | null;
  suggested: number;
  feasible: boolean;
  feasibleMin: number | null;
  feasibleMax: number | null;
  warning?: string;
  isFullToFull: boolean;
  nextIsFull: boolean;
  startPos: number;
  trips: Trip[];
}

export function buildFuelInSegments(params: { trips: Trip[]; inTankMap?: Map<string, number> }): FuelInSegmentInput[] {
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
    const from = fuelInDates[i]; const nextFuel = fuelInDates[i + 1];
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

function estimatePrevEconomyFallback(): number { return 7.8; }

function isStartMigrated(trip: Trip): boolean {
  return (trip.pump_timing === 'START') && roundToIntegerKm(trip.trip_distance) > 20 && (trip.fuel_pumped_amount ?? 0) > 0;
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

  const dateInTank = new Map<string, number>();

  const simulateMaxViolation = (segmentTrips: Trip[], startPos: number, economy: number): number => {
    let bal = roundToOneDecimal(startPos);
    const seenDates = new Set<string>();
    let maxViolation = 0;
    for (const t of segmentTrips) {
      if (!seenDates.has(t.date)) { seenDates.add(t.date); const it = roundToOneDecimal(dateInTank.get(t.date) ?? 0); if (it) bal = roundToOneDecimal(bal + it); }
      const distance = roundToIntegerKm(t.trip_distance);
      const pumped = roundToOneDecimal(t.fuel_pumped_amount ?? 0);
      const migrated = isStartMigrated(t);
      if (pumped > 0 && migrated) { bal = roundToOneDecimal(bal + pumped); const consumed = roundToOneDecimal(distance / economy); bal = roundToOneDecimal(bal - consumed); }
      else { const consumed = roundToOneDecimal(distance / economy); bal = roundToOneDecimal(bal - consumed); if (pumped > 0) bal = roundToOneDecimal(bal + pumped); }
      if (bal < minFuel) maxViolation = Math.max(maxViolation, minFuel - bal);
      else if (bal > tankCapacity) maxViolation = Math.max(maxViolation, bal - tankCapacity);
    }
    return maxViolation;
  };

  const simulateFinalBalance = (segmentTrips: Trip[], startPos: number, economy: number): number => {
    let bal = roundToOneDecimal(startPos);
    const seenDates = new Set<string>();
    for (const t of segmentTrips) {
      if (!seenDates.has(t.date)) { seenDates.add(t.date); const it = roundToOneDecimal(dateInTank.get(t.date) ?? 0); if (it) bal = roundToOneDecimal(bal + it); }
      const distance = roundToIntegerKm(t.trip_distance);
      const pumped = roundToOneDecimal(t.fuel_pumped_amount ?? 0);
      const migrated = isStartMigrated(t);
      if (pumped > 0 && migrated) { bal = roundToOneDecimal(bal + pumped); const consumed = roundToOneDecimal(distance / economy); bal = roundToOneDecimal(bal - consumed); }
      else { const consumed = roundToOneDecimal(distance / economy); bal = roundToOneDecimal(bal - consumed); if (pumped > 0) bal = roundToOneDecimal(bal + pumped); }
    }
    return bal;
  };

  interface BuiltSeg { start: number; end: number; sourceIdx: number; trips: Trip[]; fromDate: string; toDate: string; distance: number; fuelFed: number; isFullTank: boolean; pumpTiming: 'START'|'END'; nextSrcIdx: number | undefined; }
  const builtSegs: BuiltSeg[] = [];
  for (let i = 0; i < pumpIndices.length; i++) {
    const srcIdx = pumpIndices[i];
    const srcTrip = sortedTrips[srcIdx];
    const nextIdx = pumpIndices[i + 1];
    const start = isStartMigrated(srcTrip) ? srcIdx : srcIdx + 1;
    let end: number;
    if (nextIdx !== undefined) {
      const nextTrip = sortedTrips[nextIdx];
      if (isStartMigrated(nextTrip)) end = nextIdx - 1;
      else end = nextIdx;
    } else {
      end = sortedTrips.length - 1;
    }
    if (start > end) {
      const fuelFed = roundToOneDecimal(srcTrip.fuel_pumped_amount ?? 0);
      const fromDate = srcTrip.date;
      builtSegs.push({ start, end: start - 1, sourceIdx: srcIdx, trips: [], fromDate, toDate: fromDate, distance: 0, fuelFed, isFullTank: !!srcTrip.is_full_tank, pumpTiming: (srcTrip.pump_timing ?? 'END') as 'START'|'END', nextSrcIdx: nextIdx });
      continue;
    }
    const segTrips = sortedTrips.slice(start, end + 1);
    const distance = roundToIntegerKm(segTrips.reduce((s, t) => s + roundToIntegerKm(t.trip_distance), 0));
    const fuelFed = roundToOneDecimal(srcTrip.fuel_pumped_amount ?? 0);
    // Segment spans consecutive fuel-in dates: from this pump's date to the next pump's date
    // (inclusive), so exactly one range appears between two consecutive fuel-ins regardless
    // of pump timing or how many days later the next trip is recorded.
    const fromDate = srcTrip.date;
    const toDate = nextIdx !== undefined
      ? sortedTrips[nextIdx].date
      : (segTrips.length > 0 ? segTrips[segTrips.length - 1].date : srcTrip.date);
    builtSegs.push({ start, end, sourceIdx: srcIdx, trips: segTrips, fromDate, toDate, distance, fuelFed, isFullTank: !!srcTrip.is_full_tank, pumpTiming: (srcTrip.pump_timing ?? 'END') as 'START'|'END', nextSrcIdx: nextIdx });
  }

  // Collapse same-day multiple pumps into a single range: there is only ever one
  // Fuel-In Segment between two consecutive fuel-in dates.
  const mergedSegs: BuiltSeg[] = [];
  for (const seg of builtSegs) {
    const last = mergedSegs[mergedSegs.length - 1];
    if (last && last.fromDate === seg.fromDate) {
      last.end = seg.end;
      last.trips = sortedTrips.slice(last.start, last.end + 1);
      last.distance = roundToIntegerKm(last.trips.reduce((s, t) => s + roundToIntegerKm(t.trip_distance), 0));
      last.fuelFed = roundToOneDecimal(last.fuelFed + seg.fuelFed);
      last.isFullTank = last.isFullTank || seg.isFullTank;
      last.nextSrcIdx = seg.nextSrcIdx;
      last.toDate = seg.toDate;
    } else {
      mergedSegs.push({ ...seg });
    }
  }

  const firstStart = mergedSegs.length > 0 ? mergedSegs[0].start : (pumpIndices[0] + 1);
  const initialTrips = sortedTrips.slice(0, firstStart);
  if (initialTrips.length > 0) {
    runningPos = simulateFinalBalance(initialTrips, runningPos, prevEconomy!);
  }
  const posBeforeFirstSeg = runningPos;
  const initialPrevEconomy = prevEconomy;

  const results: PassSegment[] = [];
  const safeWin = getSafeWindow(vehicle);

  for (let segIdx = 0; segIdx < mergedSegs.length; segIdx++) {
    const seg = mergedSegs[segIdx];
    const segmentTrips = seg.trips;
    const totalDist = seg.distance;
    const fuelFed = seg.fuelFed;
    const fromDate = seg.fromDate;
    const toDate = seg.toDate;
    const prev = prevEconomy;
    const srcTrip = sortedTrips[seg.sourceIdx];
    const isFullTank = seg.isFullTank;
    const pumpTiming = seg.pumpTiming;
    // A Full Tank pump physically fills the tank: anchor the segment's opening balance to capacity.
    if (isFullTank) {
      runningPos = tankCapacity;
    }
    const startPos = runningPos;
    const nextIsFull = seg.nextSrcIdx !== undefined ? !!sortedTrips[seg.nextSrcIdx].is_full_tank : false;
    const nextPumpAmount = seg.nextSrcIdx !== undefined ? roundToOneDecimal(sortedTrips[seg.nextSrcIdx].fuel_pumped_amount ?? 0) : 0;
    const nextPumpIncluded = seg.nextSrcIdx !== undefined && !isStartMigrated(sortedTrips[seg.nextSrcIdx]);
    const isFullToFull = isFullTank && nextIsFull;

    const push = (suggested: number, feasible: boolean, feasibleMin: number | null, feasibleMax: number | null, warning?: string) => {
      results.push({
        fromDate, toDate, distance: totalDist, fuelFed, orderNo: srcTrip.fuel_order_no ?? '', orderDate: srcTrip.date,
        isFullTank, pumpTiming, prevEconomy: prev, suggested, feasible, feasibleMin, feasibleMax, warning,
        isFullToFull, nextIsFull, startPos, trips: segmentTrips,
      });
    };

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
      push(v, true, 0.1, 50, segmentTrips.length === 0 ? '0 km — no trips after this pump (adjacent)' : '0 km — no distance in segment');
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
      // Physics-first: total distance / total fuel between consecutive Full Tanks.
      const totalFuelInSeg = roundToOneDecimal(segmentTrips.reduce((s, t) => s + roundToOneDecimal(t.fuel_pumped_amount ?? 0), 0));
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
    // Normal caps the step from the previous economy (MAX_STEP) so the sequence
    // stays smooth even when feasibility would force a jump; the segment is then
    // flagged infeasible with a warning. Strict stays feasibility-first.
    const MAX_STEP = 1.5;
    let bestE = candidatePrev;
    let foundFeasible = feasibleEs.length > 0;
    let warning: string | undefined;
    if (feasibleEs.length > 0) {
      if (strict && nextIsFull) {
        // Strict: leave the post-pump balance as close to capacity as possible.
        let bestDiff = Infinity;
        for (const e of feasibleEs) {
          const endBal = simulateFinalBalance(segmentTrips, runningPos, e);
          const postPump = roundToOneDecimal(endBal + (nextPumpIncluded ? 0 : nextPumpAmount));
          const diff = Math.abs(postPump - tankCapacity);
          if (diff < bestDiff - 1e-9) { bestDiff = diff; bestE = e; }
        }
        const endBal = simulateFinalBalance(segmentTrips, runningPos, bestE);
        const postPump = roundToOneDecimal(endBal + (nextPumpIncluded ? 0 : nextPumpAmount));
        if (postPump < strictMin) warning = `Strict: post-pump balance ${postPump.toFixed(1)}L below full-tank window [${strictMin.toFixed(1)}, ${tankCapacity.toFixed(1)}]L — nearest feasible suggested`;
      } else {
        // Normal: nearest feasible to the previous economy, but cap the step.
        let nearest = candidatePrev;
        let bestDist = Infinity;
        for (const e of feasibleEs) { const d = Math.abs(e - candidatePrev); if (d < bestDist - 1e-9) { bestDist = d; nearest = e; } }
        const step = nearest - candidatePrev;
        if (!strict && Math.abs(step) > MAX_STEP + 1e-9) {
          bestE = roundToOneDecimal(candidatePrev + Math.sign(step) * MAX_STEP);
          foundFeasible = false;
          warning = `Step capped at ${MAX_STEP.toFixed(1)} km/L from ${candidatePrev.toFixed(1)} (nearest feasible ${nearest.toFixed(1)}) — balance may leave [1, ${tankCapacity.toFixed(1)}]L`;
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
      if (!strict && Math.abs(step) > MAX_STEP + 1e-9) {
        bestE = roundToOneDecimal(candidatePrev + Math.sign(step) * MAX_STEP);
        warning = `No 1-dec economy keeps fuel in [1, ${tankCapacity.toFixed(1)}]L — step capped to ${roundToOneDecimal(bestE).toFixed(1)} km/L (check KM/fuel gaps)`;
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
    runningPos = simulateFinalBalance(segmentTrips, runningPos, suggested);
    prevEconomy = suggested;
  }

  // Lenient smoothing: when no Full Tank anchors a run, pull interior suggestions
  // toward the average of their neighbours so steps stay small. Validated by a
  // forward re-simulation; any segment that becomes infeasible reverts.
  if (!strict && results.length >= 3) {
    const original = results.map(r => r.suggested);
    for (let i = 1; i < results.length - 1; i++) {
      const r = results[i];
      if (!r.feasible || r.isFullToFull || r.isFullTank || r.nextIsFull) continue;
      const p = results[i - 1];
      const n = results[i + 1];
      if (p.isFullToFull || p.isFullTank || p.nextIsFull || n.isFullToFull || n.isFullTank || n.nextIsFull) continue;
      if (r.feasibleMin === null || r.feasibleMax === null || r.trips.length === 0) continue;
      const avg = (p.suggested + n.suggested) / 2;
      if (Math.abs(avg - r.suggested) <= 0.3) continue;
      const cand = roundToOneDecimal(Math.min(r.feasibleMax, Math.max(r.feasibleMin, avg)));
      r.suggested = cand;
    }
    let pos = posBeforeFirstSeg;
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.isFullTank) pos = tankCapacity;
      if (r.trips.length > 0) {
        const v = simulateMaxViolation(r.trips, pos, r.suggested);
        if (v >= 1e-9) r.suggested = original[i];
        pos = simulateFinalBalance(r.trips, pos, r.suggested);
      }
    }
  }

  // Keep the displayed "previous economy" chain consistent with the final
  // suggestions (smoothing may have moved an earlier segment's value).
  let chainPrev = initialPrevEconomy;
  for (const r of results) {
    r.prevEconomy = chainPrev;
    chainPrev = r.suggested;
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
      isFullTank: n.isFullTank,
      pumpTiming: n.pumpTiming,
      prevEconomy: n.prevEconomy,
      suggested: n.suggested,
      suggestedStrict: s.suggested,
      feasible: n.feasible,
      feasibleStrict: s.feasible,
      feasibleMin: n.feasibleMin,
      feasibleMax: n.feasibleMax,
      feasibleMinStrict: s.feasibleMin,
      feasibleMaxStrict: s.feasibleMax,
      warning: n.warning,
      warningStrict: s.warning,
    };
  });
}
