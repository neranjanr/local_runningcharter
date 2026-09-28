/**
 * Estimated Fuel Economy per Fuel-In Segment
 * Feasibility-first estimator: keeps balance in [1, tankCapacity] at every intermediate Day Group.
 * Pump Timing migration, physics-first Full->Full, small-variation lenient, safe margins.
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
  suggested: number;
  feasible: boolean;
  feasibleMin: number | null;
  feasibleMax: number | null;
  warning?: string;
}
function buildDateAggregates(params: { trips: Trip[]; pages: BookPage[] }): Map<string, { distance: number; drawn: number; orderNo: string; inTank: number; positionSeed?: number }> {
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
function feasibleIntervalForSegment(params: { pos: number; drawn: number; perDay: { dist: number; inTank: number }[]; tankCapacity: number; minFuel: number; }): { min: number | null; max: number | null; feasible: boolean; warning?: string } {
  const { pos, drawn, perDay, tankCapacity, minFuel } = params;
  const totalDist = perDay.reduce((s, d) => s + d.dist, 0);
  if (totalDist === 0) return { min: 0.1, max: 50, feasible: true };
  let globalMin = 0.1; let globalMax = 50; let hasConstraint = false; let sumDist = 0; let sumInTank = 0;
  for (const day of perDay) {
    sumDist += day.dist; sumInTank += day.inTank;
    const A = pos + sumInTank + drawn;
    const denomLow = A - minFuel; const denomHigh = A - tankCapacity;
    if (denomLow <= 0) return { min: null, max: null, feasible: false, warning: `Infeasible: start fuel ${A.toFixed(1)}L ≤ min ${minFuel}L` };
    const eMinForPrefix = sumDist / denomLow;
    if (eMinForPrefix > globalMin) globalMin = eMinForPrefix;
    if (denomHigh > 0) { const eMaxForPrefix = sumDist / denomHigh; if (eMaxForPrefix < globalMax) globalMax = eMaxForPrefix; }
    hasConstraint = true;
  }
  if (!hasConstraint) return { min: 0.1, max: 50, feasible: true };
  globalMin = Math.max(0.1, globalMin); globalMax = Math.min(50, globalMax);
  if (globalMin > globalMax + 1e-9) return { min: null, max: null, feasible: false };
  return { min: globalMin, max: globalMax, feasible: true };
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
  for (const [k, v] of dateMap) { v.distance = roundToIntegerKm(v.distance); v.drawn = roundToOneDecimal(v.drawn); }
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
function isStartMigrated(trip: Trip): boolean { return (trip.pump_timing === 'START') && roundToIntegerKm(trip.trip_distance) > 20 && (trip.fuel_pumped_amount ?? 0) > 0; }
function getSafeWindow(vehicle: Vehicle | null): { low: number; high: number; margin: number } {
  let low = 4, high = 30;
  if (vehicle && vehicle.typical_economy_low != null && vehicle.typical_economy_high != null && vehicle.typical_economy_low > 0 && vehicle.typical_economy_high > vehicle.typical_economy_low) { low = vehicle.typical_economy_low; high = vehicle.typical_economy_high; }
  const mid = (low + high) / 2; const margin = mid * 0.20;
  return { low, high, margin };
}
export function estimateFuelEconomies(params: { trips: Trip[]; pages: BookPage[]; vehicle: Vehicle | null; prevEconomies?: (number | null | undefined)[]; tankCapacityOverride?: number; strictFullTank?: boolean; lockedDatesSet?: Set<string>; lockedEconomyMap?: Map<string, number>; }): SegmentEstimate[] {
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
  interface BuiltSeg { start: number; end: number; sourceIdx: number; trips: Trip[]; fromDate: string; toDate: string; distance: number; fuelFed: number; isFullTank: boolean; pumpTiming: 'START'|'END'; }
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
      builtSegs.push({ start, end: start-1, sourceIdx: srcIdx, trips: [], fromDate, toDate: fromDate, distance: 0, fuelFed, isFullTank: !!srcTrip.is_full_tank, pumpTiming: (srcTrip.pump_timing ?? 'END') as 'START'|'END' });
      continue;
    }
    const segTrips = sortedTrips.slice(start, end + 1);
    const distance = roundToIntegerKm(segTrips.reduce((s, t) => s + roundToIntegerKm(t.trip_distance), 0));
    const fuelFed = roundToOneDecimal(srcTrip.fuel_pumped_amount ?? 0);
    const fromDate = segTrips[0]?.date ?? srcTrip.date;
    const toDate = segTrips[segTrips.length - 1]?.date ?? srcTrip.date;
    builtSegs.push({ start, end, sourceIdx: srcIdx, trips: segTrips, fromDate, toDate, distance, fuelFed, isFullTank: !!srcTrip.is_full_tank, pumpTiming: (srcTrip.pump_timing ?? 'END') as 'START'|'END' });
  }
  const firstStart = builtSegs.length > 0 ? builtSegs[0].start : (pumpIndices[0] + 1);
  const initialTrips = sortedTrips.slice(0, firstStart);
  if (initialTrips.length > 0) {
    runningPos = simulateFinalBalance(initialTrips, runningPos, prevEconomy!);
  }
  const results: SegmentEstimate[] = [];
  const safeWin = getSafeWindow(vehicle);
  for (let segIdx = 0; segIdx < builtSegs.length; segIdx++) {
    const seg = builtSegs[segIdx];
    const segmentTrips = seg.trips;
    const totalDist = seg.distance;
    const fuelFed = seg.fuelFed;
    const fromDate = seg.fromDate;
    const toDate = seg.toDate;
    const prev = prevEconomy;
    const srcTrip = sortedTrips[seg.sourceIdx];
    const isFullTank = seg.isFullTank;
    const pumpTiming = seg.pumpTiming;
    if (isFullTank) {
      runningPos = tankCapacity;
    }
    const lockedSet = params.lockedDatesSet;
    const lockedMap = params.lockedEconomyMap;
    if (lockedSet && lockedMap) {
      const segDates = segmentTrips.length > 0 ? Array.from(new Set(segmentTrips.map(t => t.date))) : [fromDate];
      const allLocked = segDates.length > 0 && segDates.every(d => lockedSet.has(d));
      if (allLocked) {
        const lockedEcon = lockedMap.get(fromDate) ?? prev ?? estimatePrevEconomyFallback();
        const lockedVal = roundToOneDecimal(lockedEcon);
        results.push({ fromDate, toDate, distance: totalDist, fuelFed, orderNo: srcTrip.fuel_order_no ?? '', orderDate: srcTrip.date, isFullTank, pumpTiming, prevEconomy: prev, suggested: lockedVal, feasible: true, feasibleMin: lockedVal, feasibleMax: lockedVal, warning: '🔒 Locked — not re-estimated' });
        if (segmentTrips.length > 0) runningPos = simulateFinalBalance(segmentTrips, runningPos, lockedVal);
        prevEconomy = lockedVal;
        continue;
      }
    }
    if (totalDist === 0) {
      results.push({
        fromDate,
        toDate,
        distance: 0,
        fuelFed,
        orderNo: srcTrip.fuel_order_no ?? '',
        orderDate: srcTrip.date,
        isFullTank,
        pumpTiming,
        prevEconomy: prev,
        suggested: roundToOneDecimal(prev!),
        feasible: true,
        feasibleMin: 0.1,
        feasibleMax: 50,
        warning: segmentTrips.length===0 ? '0 km — no trips after this pump (adjacent)' : '0 km — no distance in segment',
      });
      prevEconomy = roundToOneDecimal(prev!);
      continue;
    }
    const nextSrcIdx = segIdx + 1 < builtSegs.length ? builtSegs[segIdx+1].sourceIdx : undefined;
    const nextIsFull = nextSrcIdx !== undefined ? !!sortedTrips[nextSrcIdx].is_full_tank : false;
    const isFullToFull = isFullTank && nextIsFull;
    let candidatePrev = prev ?? estimatePrevEconomyFallback();
    let bestE = candidatePrev;
    let foundFeasible = false;
    let feasibleMin: number | null = null;
    let feasibleMax: number | null = null;
    const isFullTankSource = isFullTank;
    const strictViolationPos = strict && isFullTankSource ? (runningPos < strictMin ? strictMin - runningPos : runningPos > tankCapacity ? runningPos - tankCapacity : 0) : 0;
    if (isFullToFull) {
      const totalFuelInSeg = roundToOneDecimal(segmentTrips.reduce((s, t) => s + roundToOneDecimal(t.fuel_pumped_amount ?? 0), 0));
      let rawEcon: number | null = null;
      if (totalFuelInSeg > 0) rawEcon = totalDist / totalFuelInSeg;
      else if (fuelFed > 0) rawEcon = totalDist / fuelFed;
      if (rawEcon !== null && isFinite(rawEcon)) {
        let suggestedRaw = roundToOneDecimal(rawEcon);
        suggestedRaw = Math.min(50, Math.max(0.1, suggestedRaw));
        const feasibleEs: number[] = [];
        for (let e10=1; e10<=500; e10++){ const e=e10/10; const v=simulateMaxViolation(segmentTrips, runningPos, e)+strictViolationPos; if(v<1e-9){ feasibleEs.push(e); if(feasibleMin===null||e<feasibleMin) feasibleMin=e; if(feasibleMax===null||e>feasibleMax) feasibleMax=e; } }
        if (feasibleEs.length>0){
          foundFeasible = true;
          let bestDist = Infinity;
          for(const e of feasibleEs){ const d=Math.abs(e - suggestedRaw); if(d < bestDist -1e-9){ bestDist=d; bestE=e; } }
        } else {
          let bestScore = Infinity;
          for(let e10=1;e10<=500;e10++){ const e=e10/10; const v=simulateMaxViolation(segmentTrips, runningPos, e)+strictViolationPos; const score=v + Math.abs(e - suggestedRaw)*0.01; if(score < bestScore -1e-9){ bestScore=score; bestE=e; } }
        }
        const suggested = roundToOneDecimal(bestE);
        let warning: string | undefined;
        if (!foundFeasible) {
          if (strictViolationPos>1e-9) warning = `Strict requires balance after ${srcTrip.date} ${runningPos.toFixed(1)}L in [${strictMin.toFixed(1)}, ${tankCapacity.toFixed(1)}] — computed ${suggestedRaw.toFixed(1)} km/L keeps balance outside — check fuel gaps`;
          else warning = `Computed ${suggestedRaw.toFixed(1)} km/L (${totalDist} km / ${totalFuelInSeg>0?totalFuelInSeg.toFixed(1):fuelFed.toFixed(1)} L) keeps fuel outside [1, ${tankCapacity.toFixed(1)}]L — nearest feasible ${suggested.toFixed(1)} suggested`;
        } else {
          const lowSafe = safeWin.low - safeWin.margin;
          const highSafe = safeWin.high + safeWin.margin;
          if (suggested < lowSafe || suggested > highSafe) warning = `Outside typical range [${safeWin.low.toFixed(1)}–${safeWin.high.toFixed(1)} ±20%] — ${suggested.toFixed(1)} km/L`;
        }
        results.push({ fromDate, toDate, distance: totalDist, fuelFed, orderNo: srcTrip.fuel_order_no ?? '', orderDate: srcTrip.date, isFullTank, pumpTiming, prevEconomy: prev, suggested, feasible: foundFeasible, feasibleMin, feasibleMax, warning });
        runningPos = simulateFinalBalance(segmentTrips, runningPos, suggested);
        prevEconomy = suggested;
        continue;
      }
    }
    const feasibleEs: number[] = [];
    for (let e10=1; e10<=500; e10++){ const e=e10/10; const v=simulateMaxViolation(segmentTrips, runningPos, e)+strictViolationPos; if(v<1e-9){ feasibleEs.push(e); if(feasibleMin===null||e<feasibleMin) feasibleMin=e; if(feasibleMax===null||e>feasibleMax) feasibleMax=e; } }
    if (feasibleEs.length>0){
      foundFeasible = true;
      let bestDist = Infinity;
      for(const e of feasibleEs){ const d=Math.abs(e - candidatePrev); if(d < bestDist -1e-9){ bestDist=d; bestE=e; } }
    } else {
      let bestScore = Infinity;
      for(let e10=1;e10<=500;e10++){ const e=e10/10; const v=simulateMaxViolation(segmentTrips, runningPos, e)+strictViolationPos; const score=v + Math.abs(e - candidatePrev)*0.01; if(score < bestScore -1e-9){ bestScore=score; bestE=e; } }
    }
    const suggested = roundToOneDecimal(bestE);
    let warning: string | undefined;
    if (!foundFeasible){
      if (strictViolationPos>1e-9 && isFullTankSource) warning = `Strict Full Tank requires balance after pump ${runningPos.toFixed(1)}L in [${strictMin.toFixed(1)}, ${tankCapacity.toFixed(1)}] — nearest ${suggested.toFixed(1)} km/L outside strict (lenient feasible)`;
      else warning = `No 1-dec economy keeps fuel in [1, ${tankCapacity.toFixed(1)}]L — nearest ${suggested.toFixed(1)} km/L suggested (check KM/fuel gaps)`;
    } else {
      const distFromPrev = Math.abs(suggested - candidatePrev);
      if (distFromPrev > 3) warning = `Large step from ${candidatePrev.toFixed(1)} to ${suggested.toFixed(1)} to stay feasible`;
      const lowSafe = safeWin.low - safeWin.margin;
      const highSafe = safeWin.high + safeWin.margin;
      if (suggested < lowSafe || suggested > highSafe) {
        const safeWarn = `Outside typical range [${safeWin.low.toFixed(1)}–${safeWin.high.toFixed(1)} ±20%] — ${suggested.toFixed(1)} km/L`;
        warning = warning ? `${warning} | ${safeWarn}` : safeWarn;
      }
    }
    results.push({
      fromDate,
      toDate,
      distance: totalDist,
      fuelFed,
      orderNo: srcTrip.fuel_order_no ?? '',
      orderDate: srcTrip.date,
      isFullTank,
      pumpTiming,
      prevEconomy: prev,
      suggested,
      feasible: foundFeasible,
      feasibleMin,
      feasibleMax,
      warning,
    });
    runningPos = simulateFinalBalance(segmentTrips, runningPos, suggested);
    prevEconomy = suggested;
  }
  return results;
}
