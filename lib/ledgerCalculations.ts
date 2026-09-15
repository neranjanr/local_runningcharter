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
}): LedgerDay[] {
  const { page, trips, economies, fallbackEconomy, inTanks } = params;
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
    const balance = calculateBalance(fuelPosition, drawn, consumed, inTank);

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
 * Trip-level fuel info with economy applied only after the pumped trip.
 * A pumped trip still uses the previous economy; the next trip uses the next segment's economy.
 * In-Tank is added at the first trip of each date. Balances are per-trip using
 * Position (balance before trip) -> Consumed -> +Drawn -> next Position.
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
}): Map<string, TripFuelInfo> {
  const { trips, dateEconomy, dateInTank, openingFuel } = params;
  const sorted = [...trips].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.trip_index !== b.trip_index) return a.trip_index - b.trip_index;
    return a.start_km - b.start_km;
  });
  const distinctDates = Array.from(new Set(sorted.map(t => t.date))).sort();
  const result = new Map<string, TripFuelInfo>();
  if (sorted.length === 0) return result;
  let balance = roundToOneDecimal(openingFuel);
  // current economy starts as economy of first trip's date
  let currentEconomy = dateEconomy.get(sorted[0].date) ?? DEFAULT_FUEL_ECONOMY;
  const dateFirstSeen = new Set<string>();
  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i];
    // add In-Tank at first trip of each date (once per date, not per trip)
    let inTankForTrip = 0;
    if (!dateFirstSeen.has(t.date)) {
      dateFirstSeen.add(t.date);
      inTankForTrip = roundToOneDecimal(dateInTank?.get(t.date) ?? 0);
      if (inTankForTrip) balance = roundToOneDecimal(balance + inTankForTrip);
    }
    const position = roundToOneDecimal(balance);
    const economy = roundToOneDecimal(currentEconomy);
    const distance = roundToIntegerKm(t.trip_distance);
    const consumed = calculateConsumed(distance, economy);
    const pumped = roundToOneDecimal(t.fuel_pumped_amount ?? 0);
    const afterConsumed = roundToOneDecimal(balance - consumed);
    const newBalance = roundToOneDecimal(afterConsumed + pumped);
    // For display, drawn is pumped of this trip; balance is after
    result.set(t.id, {
      position,
      economy,
      balance: newBalance,
      pumped,
      inTank: inTankForTrip,
      drawn: pumped,
    });
    balance = newBalance;
    // After this trip, if it was a pumped trip, switch economy for next trip to next distinct date's economy
    if (pumped > 0 && i + 1 < sorted.length) {
      const currIdx = distinctDates.indexOf(t.date);
      let nextEconomy: number | null = null;
      for (let j = currIdx + 1; j < distinctDates.length; j++) {
        const nd = distinctDates[j];
        if (dateEconomy.has(nd)) { nextEconomy = dateEconomy.get(nd)!; break; }
      }
      // If pumped trip is not on last date, jump to next date's economy (covers intra-day split)
      // If pumped trip is on same date as next trip, this still jumps to next date's economy.
      // If no next distinct date (single date book), keep current economy (no new value available)
      if (nextEconomy !== null) {
        currentEconomy = nextEconomy;
      } else {
        // No next date: keep current, but if next trip is same date, economy stays same (unable to represent split without extra slot)
      }
    } else if (pumped === 0 && i + 1 < sorted.length) {
      // Even without pump, if next trip date differs, economy should follow dateEconomy
      const nextDate = sorted[i + 1].date;
      if (nextDate !== t.date) {
        const nextDateEcon = dateEconomy.get(nextDate);
        if (nextDateEcon !== undefined) currentEconomy = nextDateEcon;
      }
    }
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
