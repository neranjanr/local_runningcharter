/**
 * Ledger Calculations - pure functions for Dual-Side Physical Book Ledger View (Issue 6)
 * Seams:
 * - Fuel economy propagation (forward until overridden) rounded to 1 decimal
 * - Consumption & balance formulas (rounded to 1 decimal)
 * - Daily aggregation from trips
 */
import type { BookPage, Trip } from '@/types';
import { roundToOneDecimal, roundToIntegerKm } from './tripCalculations';
import { calculateConsumed, calculateBalance, getDistinctDates } from './pagination';

export const DEFAULT_FUEL_ECONOMY = 10.5;

export interface LedgerDay {
  dayIndex: number; // 1..4
  date: string; // YYYY-MM-DD
  dayLabel: string; // e.g., "Mon 21 Oct"
  startKm: number;
  endKm: number;
  distance: number;
  fuelEconomy: number;
  economySource: 'explicit' | 'inherited' | 'fallback';
  fuelPosition: number;
  inTank: number; // Phase 2 Issue 03: In-Tank Fuel per Day Group, default 0
  drawn: number;
  fuelOrderNo: string; // aggregated, empty if none
  fuelOrderDate: string; // date of first drawn entry if any
  consumed: number;
  balance: number; // Closing Balance = Position + InTank + Drawn - Consumed
  isFullTank: boolean;
}

export interface LedgerSummary {
  totalDistance: number;
  totalDrawn: number;
  totalConsumed: number;
  finalBalance: number;
  weightedEconomy: number; // totalDistance / totalConsumed rounded 1 dec, or 0
}

/**
 * Propagate fuel economy forward.
 * - raw: array per day in chronological order, null/undefined means inherit.
 * - fallback: economy to use if first entry is missing.
 * Values rounded to 1 decimal.
 */
export function propagateFuelEconomy(
  raw: (number | null | undefined)[],
  fallback: number = DEFAULT_FUEL_ECONOMY
): number[] {
  const normalizedFallback = roundToOneDecimal(fallback);
  const result: number[] = [];
  let current = normalizedFallback;
  let hasExplicitBefore = false;
  // If first raw is explicit, use it; else use fallback
  for (let i = 0; i < raw.length; i++) {
    const v = raw[i];
    if (v !== null && v !== undefined && !isNaN(Number(v)) && Number(v) > 0) {
      current = roundToOneDecimal(Number(v));
      hasExplicitBefore = true;
      result.push(current);
    } else {
      // No override on this day -> inherit previous
      // If no explicit before and i==0, current is fallback already
      result.push(roundToOneDecimal(current));
    }
  }
  return result;
}

export function getTripsForPage(trips: Trip[], pageId: string): Trip[] {
  return trips.filter((t) => t.page_id === pageId);
}

function shortDayLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const daysShort = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const monthsShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${daysShort[date.getDay()]} ${d} ${monthsShort[m - 1]}`;
}

export function computeLedgerDays(params: {
  page: BookPage;
  trips: Trip[];
  economies?: (number | null | undefined)[];
  fallbackEconomy?: number;
  inTanks?: (number | null | undefined)[];
  tankCapacity?: number;
}): LedgerDay[] {
  const { page, trips, economies, fallbackEconomy, inTanks, tankCapacity = 75 } = params;
  const cap = tankCapacity > 0 ? tankCapacity : 75;
  const tripsForPage = getTripsForPage(trips, page.id);
  if (tripsForPage.length === 0) return [];

  const distinctDates = getDistinctDates(tripsForPage); // sorted

  // Map raw economies to distinctDates order
  // If economies length != distinct length, slice/pad with nulls
  const raw: (number | null | undefined)[] = [];
  for (let i = 0; i < distinctDates.length; i++) {
    if (economies && i < economies.length) raw.push(economies[i]);
    else raw.push(null);
  }

  const propagated = propagateFuelEconomy(raw, fallbackEconomy ?? DEFAULT_FUEL_ECONOMY);

  // Map inTanks to distinctDates order (default 0 per Day Group)
  const rawInTanks: (number | null | undefined)[] = [];
  for (let i = 0; i < distinctDates.length; i++) {
    if (inTanks && i < inTanks.length) rawInTanks.push(inTanks[i]);
    else rawInTanks.push(0);
  }

  const days: LedgerDay[] = [];
  let prevBalance = roundToOneDecimal(page.start_fuel_balance);

  for (let i = 0; i < distinctDates.length; i++) {
    const date = distinctDates[i];
    const dayTrips = tripsForPage
      .filter((t) => t.date === date)
      .sort((a, b) => a.trip_index - b.trip_index || a.start_km - b.start_km);

    // Determine start/end km from trip sequence (Integer KM)
    const startKm = roundToIntegerKm(dayTrips[0].start_km);
    const endKm = roundToIntegerKm(dayTrips[dayTrips.length - 1].end_km);
    const distance = roundToIntegerKm(
      dayTrips.reduce((sum, t) => sum + roundToIntegerKm(t.trip_distance), 0)
    );
    // Alternative: end - start; but trips may have gaps? Use sum for robustness. Both should match continuous trips.
    // For validation, use sum; spec example matches sum.

    const econ = propagated[i];
    const rawVal = raw[i];
    let economySource: LedgerDay['economySource'];
    if (rawVal !== null && rawVal !== undefined && Number(rawVal) > 0) economySource = 'explicit';
    else if (i === 0 && (rawVal === null || rawVal === undefined) && fallbackEconomy !== undefined) economySource = 'fallback';
    else if (i === 0 && (rawVal === null || rawVal === undefined)) economySource = 'fallback';
    else economySource = 'inherited';

    const drawn = roundToOneDecimal(
      dayTrips.reduce((sum, t) => sum + roundToOneDecimal(t.fuel_pumped_amount ?? 0), 0)
    );
    const orderNos = dayTrips
      .filter((t) => t.fuel_order_no && t.fuel_order_no.trim() !== '')
      .map((t) => t.fuel_order_no!.trim());
    const fuelOrderNo = orderNos.join(', ');
    const fuelOrderDate = drawn > 0 ? date : '';

    const fuelPosition = roundToOneDecimal(prevBalance);
    const inTank = roundToOneDecimal(rawInTanks[i] ?? 0);
    const consumed = calculateConsumed(distance, econ);
    const isFullTank = dayTrips.some(t => !!t.is_full_tank && (t.fuel_pumped_amount ?? 0) > 0);
    const balance = calculateBalance(fuelPosition, drawn, consumed, inTank, cap, isFullTank);

    days.push({
      dayIndex: i + 1,
      date,
      dayLabel: shortDayLabel(date),
      startKm,
      endKm,
      distance,
      fuelEconomy: econ,
      economySource,
      fuelPosition,
      inTank,
      drawn,
      fuelOrderNo,
      fuelOrderDate,
      consumed,
      balance,
      isFullTank,
    });

    prevBalance = balance;
  }

  return days;
}

export function computeLedgerSummary(days: LedgerDay[]): LedgerSummary {
  if (days.length === 0) {
    return {
      totalDistance: 0,
      totalDrawn: 0,
      totalConsumed: 0,
      finalBalance: 0,
      weightedEconomy: 0,
    };
  }
  const totalDistance = roundToIntegerKm(days.reduce((s, d) => s + d.distance, 0));
  const totalDrawn = roundToOneDecimal(days.reduce((s, d) => s + d.drawn, 0));
  const totalConsumed = roundToOneDecimal(days.reduce((s, d) => s + d.consumed, 0));
  const finalBalance = roundToOneDecimal(days[days.length - 1].balance);
  const weightedEconomy =
    totalConsumed > 0 ? roundToOneDecimal(totalDistance / totalConsumed) : 0;
  return {
    totalDistance,
    totalDrawn,
    totalConsumed,
    finalBalance,
    weightedEconomy,
  };
}

/**
 * Group trips by date for Side 1 rendering (includes per-day subtotals)
 */
export interface DayGroup {
  date: string;
  dayLabel: string;
  dayIndex: number;
  trips: Trip[];
  startKm: number;
  endKm: number;
  distance: number;
  officialKm: number;
  privateKm: number;
}

export function groupTripsByDateForSide1(trips: Trip[], pageId: string): DayGroup[] {
  const forPage = getTripsForPage(trips, pageId);
  if (forPage.length === 0) return [];
  const distinct = getDistinctDates(forPage);
  return distinct.map((date, idx) => {
    const dayTrips = forPage
      .filter((t) => t.date === date)
      .sort((a, b) => a.trip_index - b.trip_index);
    const startKm = roundToIntegerKm(dayTrips[0].start_km);
    const endKm = roundToIntegerKm(dayTrips[dayTrips.length - 1].end_km);
    const distance = roundToIntegerKm(dayTrips.reduce((s, t) => s + roundToIntegerKm(t.trip_distance), 0));
    const officialKm = roundToIntegerKm(
      dayTrips.filter((t) => t.trip_type === 'Official').reduce((s, t) => s + roundToIntegerKm(t.trip_distance), 0)
    );
    const privateKm = roundToIntegerKm(
      dayTrips.filter((t) => t.trip_type === 'Private').reduce((s, t) => s + roundToIntegerKm(t.trip_distance), 0)
    );
    return {
      date,
      dayLabel: shortDayLabel(date),
      dayIndex: idx + 1,
      trips: dayTrips,
      startKm,
      endKm,
      distance,
      officialKm,
      privateKm,
    };
  });
}

/**
 * Page-Wide Trip Sequence: 1..N continuous across Day Groups for a page.
 * Trips sorted by date, then trip_index, then start_km (spec §24).
 */
export function computePageSeq(dayGroups: DayGroup[]): number[] {
  const flatTrips = dayGroups.flatMap((g) => g.trips);
  const sorted = [...flatTrips].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.trip_index !== b.trip_index) return a.trip_index - b.trip_index;
    return a.start_km - b.start_km;
  });
  return sorted.map((_, idx) => idx + 1);
}

/**
 * A START pump puts the pumped Trip in the next cycle at any distance;
 * an END pump keeps it in the previous one (Spec #6, Issue #8).
 * No distance guard, no collapsing — every pumped Trip is a boundary.
 */
export function isStartPumpTrip(t: Trip): boolean {
  return t.pump_timing === 'START' && (t.fuel_pumped_amount ?? 0) > 0;
}

export function isEndPumpTrip(t: Trip): boolean {
  return (t.pump_timing ?? 'END') === 'END' && (t.fuel_pumped_amount ?? 0) > 0;
}

function sortTripsForCycles(trips: Trip[]): Trip[] {
  return [...trips].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.trip_index !== b.trip_index) return a.trip_index - b.trip_index;
    return a.start_km - b.start_km;
  });
}

/**
 * Trip-delimited Fuel-In cycles (Issue #8).
 * Boundaries are exactly the pumped Trips in chronological order with no
 * collapsing: a START pump opens the next cycle at the pumped Trip itself,
 * an END pump closes the previous cycle after the pumped Trip. One date can
 * therefore hold several cycles.
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

/**
 * Trip-level fuel info with trip-delimited cycle economies (Issue #8).
 * A START pumped Trip uses the next cycle's economy (fuel available before its
 * distance is driven); an END pumped Trip keeps the previous cycle's economy.
 * In-Tank is added at the first trip of each date. Balances are per-trip using
 * Position (balance before trip) -> Consumed -> +Drawn -> next Position
 * (START adds fuel before consuming).
 * Used by All Trips Master Table and Trend graph for intra-day pump splits.
 */
export interface TripFuelInfo {
  position: number;
  economy: number;
  balance: number;
  pumped: number;
  inTank: number;
  drawn: number;
}

export function computeTripFuelMap(params: {
  trips: Trip[];
  pages: BookPage[];
  dateEconomy: Map<string, number>;
  dateInTank?: Map<string, number>;
  openingFuel: number;
  tankCapacity?: number;
  /** Per-trip effective economies (Issue #8): explicit per-trip value wins,
   * otherwise falls back to dateEconomy with forward propagation. Lets a
   * same-date pump split display two economies. */
  tripEconomy?: Map<string, number>;
}): Map<string, TripFuelInfo> {
  const { trips, dateEconomy, dateInTank, openingFuel, tankCapacity = 75, tripEconomy } = params;
  const cap = tankCapacity > 0 ? tankCapacity : 75;
  const sorted = sortTripsForCycles(trips);
  const distinctDates = Array.from(new Set(sorted.map(t => t.date))).sort();
  const result = new Map<string, TripFuelInfo>();
  if (sorted.length === 0) return result;

  // Raw base per trip: explicit per-trip wins, else date-level, else undefined.
  const rawBase: (number | null)[] = sorted.map((t) => {
    const perTrip = tripEconomy?.get(t.id);
    if (perTrip !== undefined && perTrip !== null && Number(perTrip) > 0) {
      return roundToOneDecimal(Number(perTrip));
    }
    const perDate = dateEconomy.get(t.date);
    if (perDate !== undefined && perDate !== null && Number(perDate) > 0) {
      return roundToOneDecimal(Number(perDate));
    }
    return null;
  });
  // Forward-propagate with fallback at the book start.
  const propBase: number[] = [];
  let running = roundToOneDecimal(dateEconomy.get(sorted[0].date) ?? DEFAULT_FUEL_ECONOMY);
  if (rawBase[0] !== null) running = rawBase[0]!;
  for (let i = 0; i < sorted.length; i++) {
    if (i === 0) {
      propBase.push(roundToOneDecimal(running));
      continue;
    }
    if (rawBase[i] !== null) running = rawBase[i]!;
    propBase.push(roundToOneDecimal(running));
  }

  const nextPropAfter = (i: number): number | null => {
    for (let j = i + 1; j < sorted.length; j++) {
      if (rawBase[j] !== null) return propBase[j];
    }
    // No explicit value ahead — fall back to the next dated economy.
    const fromDate = sorted[i].date;
    const idx = distinctDates.indexOf(fromDate);
    for (let j = idx + 1; j < distinctDates.length; j++) {
      const nd = distinctDates[j];
      if (dateEconomy.has(nd)) return roundToOneDecimal(dateEconomy.get(nd)!);
    }
    return null;
  };

  let balance = roundToOneDecimal(openingFuel);
  const dateFirstSeen = new Set<string>();
  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i];
    let inTankForTrip = 0;
    if (!dateFirstSeen.has(t.date)) {
      dateFirstSeen.add(t.date);
      inTankForTrip = roundToOneDecimal(dateInTank?.get(t.date) ?? 0);
      if (inTankForTrip) balance = roundToOneDecimal(Math.min(cap, balance + inTankForTrip));
    }
    const migrated = isStartPumpTrip(t);
    let economy: number;
    if (migrated) {
      // START at any distance joins the next cycle. An explicit per-trip
      // value on the pumped Trip itself wins; otherwise inherit the next
      // cycle's economy ahead.
      const explicit = tripEconomy?.get(t.id);
      if (explicit !== undefined && explicit !== null && Number(explicit) > 0) {
        economy = roundToOneDecimal(Number(explicit));
      } else {
        economy = nextPropAfter(i) ?? propBase[i];
      }
    } else {
      economy = propBase[i];
    }
    economy = roundToOneDecimal(economy);
    const position = roundToOneDecimal(balance);
    const distance = roundToIntegerKm(t.trip_distance);
    const consumed = calculateConsumed(distance, economy);
    const pumped = roundToOneDecimal(t.fuel_pumped_amount ?? 0);
    const isFull = !!t.is_full_tank && pumped > 0;
    let newBalance: number;
    if (pumped > 0 && migrated) {
      // START: fuel available for this Trip, charged to next economy => add before consume
      const afterFuel = isFull ? cap : roundToOneDecimal(balance + pumped);
      newBalance = roundToOneDecimal(Math.min(cap, afterFuel - consumed));
    } else {
      const afterConsumed = roundToOneDecimal(balance - consumed);
      const afterPump = isFull ? cap : roundToOneDecimal(afterConsumed + pumped);
      newBalance = roundToOneDecimal(Math.min(cap, afterPump));
    }
    result.set(t.id, {
      position,
      economy,
      balance: newBalance,
      pumped,
      inTank: inTankForTrip,
      drawn: pumped,
    });
    balance = newBalance;
  }
  return result;
}

/**
 * Global Chronological Sequence: Map<tripId, seq> for cross-Book traceability.
 * Sorts all trips by date, then trip_index, then start_km, assigns 1..T.
 */
export function computeGlobalSeq(trips: Trip[]): Map<string, number> {
  const sorted = [...trips].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.trip_index !== b.trip_index) return a.trip_index - b.trip_index;
    return a.start_km - b.start_km;
  });
  const map = new Map<string, number>();
  sorted.forEach((t, idx) => map.set(t.id, idx + 1));
  return map;
}
