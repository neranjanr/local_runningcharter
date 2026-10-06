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
import {
  buildTripCycles,
  countLedgerColumnSlots,
  isEndPumpTrip,
  isStartPumpTrip,
  sortTripsForCycles,
  SPLIT_DAY_THRESHOLD_KM,
} from './tripCycleSlots';

// Re-exported so existing readers keep working:
// stores and cycle helpers import the day-atom boundary rule from here.
export {
  buildTripCycles,
  countLedgerColumnSlots,
  isEndPumpTrip,
  isStartPumpTrip,
  SPLIT_DAY_THRESHOLD_KM,
};

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
  /** Per-trip in-tank inputs (Issue #10): when provided, a day's in-tank
   * is the sum of its trips' effective values (explicit per-trip entry
   * wins, otherwise the legacy per-date value on the first trip of the
   * date, zero elsewhere). Absent means legacy per-day behavior. */
  tripInTanks?: Map<string, number>;
}): LedgerDay[] {
  const { page, trips, economies, fallbackEconomy, inTanks, tankCapacity = 75, tripInTanks } = params;
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
    // Issue #10: per-trip inputs sum into the day total; legacy per-day
    // value survives as the first-trip fallback so backfilled books match.
    let inTank = roundToOneDecimal(rawInTanks[i] ?? 0);
    if (tripInTanks) {
      const firstId = dayTrips.length > 0 ? dayTrips[0].id : null;
      let total = 0;
      for (const t of dayTrips) {
        const explicit = tripInTanks.get(t.id);
        if (explicit !== undefined && Number(explicit) > 0) total = roundToOneDecimal(total + Number(explicit));
        else if (t.id === firstId) total = roundToOneDecimal(total + inTank);
      }
      inTank = roundToOneDecimal(total);
    }
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
 * Trip-level fuel info with day-atom economies (ADR-0036).
 * Every Trip of a Date shares that Date's economy (Pump Timing is ignored);
 * In-Tank is added at the first trip of each date. Balances are per-trip
 * using Position (balance before trip) -> Consumed -> +Drawn -> next
 * Position: pumped fuel is added after the Trip that pumped it.
 * Used by All Trips Master Table and Trend graph.
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
  /** Per-trip in-tank inputs (Issue #10): explicit per-trip value wins and
   * is added at its own trip; otherwise the legacy per-date value applies
   * at the first trip of the date. Untouched trips default to zero. */
  tripInTank?: Map<string, number>;
}): Map<string, TripFuelInfo> {
  const { trips, dateEconomy, dateInTank, openingFuel, tankCapacity = 75, tripEconomy, tripInTank } = params;
  const cap = tankCapacity > 0 ? tankCapacity : 75;
  const sorted = sortTripsForCycles(trips);
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

  let balance = roundToOneDecimal(openingFuel);
  const dateFirstSeen = new Set<string>();
  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i];
    // Issue #10: an explicit per-trip input is added at its own trip under
    // the existing capacity rule; otherwise the legacy per-date value
    // applies once at the first trip of the date. Untouched trips get zero.
    const explicit = tripInTank?.get(t.id);
    const hasExplicit = explicit !== undefined && Number(explicit) > 0;
    const isFirstOfDate = !dateFirstSeen.has(t.date);
    dateFirstSeen.add(t.date);
    let inTankForTrip = 0;
    if (hasExplicit) {
      inTankForTrip = roundToOneDecimal(Number(explicit));
    } else if (isFirstOfDate) {
      inTankForTrip = roundToOneDecimal(dateInTank?.get(t.date) ?? 0);
    }
    if (inTankForTrip) balance = roundToOneDecimal(Math.min(cap, balance + inTankForTrip));
    // Day-atom (ADR-0036): one economy per Date, Pump Timing ignored.
    const economy = roundToOneDecimal(propBase[i]);
    const position = roundToOneDecimal(balance);
    const distance = roundToIntegerKm(t.trip_distance);
    const consumed = calculateConsumed(distance, economy);
    const pumped = roundToOneDecimal(t.fuel_pumped_amount ?? 0);
    const isFull = !!t.is_full_tank && pumped > 0;
    const afterConsumed = roundToOneDecimal(balance - consumed);
    const afterPump = isFull ? cap : roundToOneDecimal(afterConsumed + pumped);
    const newBalance = roundToOneDecimal(Math.min(cap, afterPump));
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

/**
 * Side 2 day-atom columns (ADR-0036).
 *
 * One column per Date, always: a fuel-in Date never splits, so there are
 * no trip-range labels, no split flags and no 40 km collapse rule.
 * Balances chain exactly: each column opens at its first trip's position
 * and closes at its last trip's balance, with consumed summed per trip so
 * full-tank anchoring stays exact. Every column consumes one day-slot
 * toward the per-page limit.
 */

export interface LedgerCycleColumn {
  key: string;
  date: string;
  dayLabel: string;
  /** e.g. "21 Oct T1-2" for split slices, "21 Oct" otherwise. */
  columnLabel: string;
  /** 1-based column slot across the page (consumes day-slots). */
  dayIndex: number;
  /** e.g. "T1-2" for split slices, null for single columns. */
  tripRange: string | null;
  tripIds: string[];
  startKm: number;
  endKm: number;
  distance: number;
  fuelEconomy: number;
  economySource: LedgerDay['economySource'];
  fuelPosition: number;
  inTank: number;
  drawn: number;
  fuelOrderNo: string;
  fuelOrderDate: string;
  consumed: number;
  balance: number;
  isFullTank: boolean;
  /** The date holds more than one cycle slice. */
  isSplit: boolean;
  /** Split date collapsed to one column (total <= 40 km). */
  isCollapsed: boolean;
}

export interface CycleStem {
  date: string;
  economy: number;
  key: string;
  tripRange: string | null;
  tripIds: string[];
}

/** One Date always renders a single Side 2 column (day-atom). */

/** Cycle slices of one date live in `./tripCycleSlots` (shared with pagination). */

/**
 * One trend stem per Date (day-atom, ADR-0036) — a fuel-in Date never
 * splits, so each Date contributes exactly one stem.
 */
export function buildCycleStems(params: {
  trips: Trip[];
  fuelMap: Map<string, TripFuelInfo>;
}): CycleStem[] {
  const { trips, fuelMap } = params;
  if (trips.length === 0) return [];
  const sorted = sortTripsForCycles(trips);
  const dates = Array.from(new Set(sorted.map((t) => t.date))).sort();
  return dates.map((date) => {
    const dateTrips = sorted.filter((t) => t.date === date);
    const economy = fuelMap.get(dateTrips[0].id)?.economy ?? DEFAULT_FUEL_ECONOMY;
    return {
      date,
      economy: roundToOneDecimal(economy),
      key: date,
      tripRange: null,
      tripIds: dateTrips.map((t) => t.id),
    };
  });
}

/**
 * Side 2 ledger columns for a set of trips (typically one page): one
 * column per Date. Balances chain exactly: each column opens at its
 * first trip's position and closes at its last trip's balance, with
 * consumed summed per trip so full-tank anchoring stays exact.
 */
export function buildSide2Columns(params: {
  trips: Trip[];
  fuelMap: Map<string, TripFuelInfo>;
  tankCapacity?: number;
}): LedgerCycleColumn[] {
  const { trips, fuelMap } = params;
  if (trips.length === 0) return [];
  const sorted = sortTripsForCycles(trips);
  const dates = Array.from(new Set(sorted.map((t) => t.date))).sort();

  const columns: LedgerCycleColumn[] = [];
  let prevEconomy: number | null = null;
  let isFirst = true;

  const perTripConsumed = (t: Trip, economy: number): number =>
    calculateConsumed(roundToIntegerKm(t.trip_distance), economy);

  for (const date of dates) {
    const ordered = sorted.filter((t) => t.date === date);
    const first = ordered[0];
    const last = ordered[ordered.length - 1];
    const startKm = roundToIntegerKm(first.start_km);
    const endKm = roundToIntegerKm(last.end_km);
    const distance = roundToIntegerKm(
      ordered.reduce((s, t) => s + roundToIntegerKm(t.trip_distance), 0),
    );
    // Day-atom: one economy per Date (first trip's mapped economy).
    const fuelEconomy = roundToOneDecimal(
      fuelMap.get(first.id)?.economy ?? DEFAULT_FUEL_ECONOMY,
    );
    const fuelPosition = roundToOneDecimal(
      fuelMap.get(first.id)?.position ?? columns[columns.length - 1]?.balance ?? 0,
    );
    const inTank = roundToOneDecimal(
      ordered.reduce((s, t) => s + roundToOneDecimal(fuelMap.get(t.id)?.inTank ?? 0), 0),
    );
    const drawn = roundToOneDecimal(
      ordered.reduce(
        (s, t) => s + roundToOneDecimal(fuelMap.get(t.id)?.drawn ?? fuelMap.get(t.id)?.pumped ?? t.fuel_pumped_amount ?? 0),
        0,
      ),
    );
    const balance = roundToOneDecimal(
      fuelMap.get(last.id)?.balance ?? fuelPosition,
    );
    const consumed = roundToOneDecimal(
      ordered.reduce((s, t) => {
        const e = fuelMap.get(t.id)?.economy ?? fuelEconomy;
        return s + perTripConsumed(t, e);
      }, 0),
    );
    const orderNos = ordered
      .filter((t) => t.fuel_order_no && t.fuel_order_no.trim() !== '')
      .map((t) => t.fuel_order_no!.trim());
    const isFullTank = ordered.some(
      (t) => !!t.is_full_tank && (t.fuel_pumped_amount ?? 0) > 0,
    );
    let economySource: LedgerCycleColumn['economySource'];
    if (isFirst) economySource = 'fallback';
    else if (fuelEconomy !== prevEconomy) economySource = 'explicit';
    else economySource = 'inherited';
    const dayLabel = shortDayLabel(date);
    prevEconomy = fuelEconomy;
    isFirst = false;
    columns.push({
      key: date,
      date,
      dayLabel,
      columnLabel: dayLabel,
      dayIndex: 0, // assigned below in column order
      tripRange: null,
      tripIds: ordered.map((t) => t.id),
      startKm,
      endKm,
      distance,
      fuelEconomy,
      economySource,
      fuelPosition,
      inTank,
      drawn,
      fuelOrderNo: orderNos.join(', '),
      fuelOrderDate: drawn > 0 ? date : '',
      consumed,
      balance,
      isFullTank,
      isSplit: false,
      isCollapsed: false,
    });
  }

  columns.forEach((c, i) => {
    c.dayIndex = i + 1;
  });
  return columns;
}
