/**
 * Dashboard Analytics - pure functions for Issue 7 + Phase 2 Issue 04
 * Seams:
 * - Summary metric cards (Official, Private, Total KM as Integer KM, estimated fuel level 1 decimal)
 * - Monthly breakdown (Official/Private/Total per YYYY-MM as integers)
 * - Page-wise distance visualization (integers)
 * - All Trips Master Table filter/search/sort + Global Search (Phase 2)
 * - This-Month trio via YYYY-MM prefix, Last-12 slicing
 */
import type { BookPage, Trip, Vehicle } from '@/types';
import { roundToOneDecimal, roundToIntegerKm, formatDateISO } from './tripCalculations';

export interface DashboardMetrics {
  officialKm: number; // Integer KM
  privateKm: number; // Integer KM
  totalKm: number; // Integer KM
  tripCount: number;
  fuelLevel: number; // 1 decimal
  tankCapacity: number; // 1 decimal
  fuelLevelPercent: number; // 1 decimal
  lastOdo: number; // Integer KM
  lastOdoDate: string | null; // YYYY-MM-DD
}

export interface MonthlyBreakdown {
  monthKey: string; // YYYY-MM
  monthLabel: string; // e.g., "Oct 2024"
  officialKm: number; // Integer KM
  privateKm: number; // Integer KM
  totalKm: number; // Integer KM
  tripCount: number;
  fuelDrawn: number; // 1 decimal
  pageCount: number;
}

export interface PageDistance {
  pageNumber: number;
  month: string;
  monthLabel: string;
  distance: number; // Integer KM
  officialKm: number; // Integer KM
  privateKm: number; // Integer KM
  tripCount: number;
}

export type SortColumn = 'date' | 'start_km' | 'end_km' | 'trip_distance' | 'trip_type' | 'places_visited' | 'fuel_pumped_amount';
export type SortDirection = 'asc' | 'desc';

export interface FilterOptions {
  search?: string;
  tripType?: 'All' | 'Official' | 'Private';
  month?: string; // YYYY-MM or 'All'
  sortColumn?: SortColumn;
  sortDirection?: SortDirection;
}

export interface FilteredSums {
  count: number;
  officialKm: number; // Integer KM
  privateKm: number; // Integer KM
  totalKm: number; // Integer KM
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatMonthLabel(monthKey: string): string {
  if (!monthKey || !monthKey.includes('-')) return monthKey;
  const [y, m] = monthKey.split('-');
  const monthsShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const idx = parseInt(m, 10) - 1;
  return `${monthsShort[idx] ?? m} ${y}`;
}

function sumDistance(trips: Trip[]): number {
  return roundToIntegerKm(trips.reduce((s, t) => s + roundToIntegerKm(t.trip_distance), 0));
}

function sumOfficialKm(trips: Trip[]): number {
  return roundToIntegerKm(
    trips.filter((t) => t.trip_type === 'Official').reduce((s, t) => s + roundToIntegerKm(t.trip_distance), 0)
  );
}

function sumPrivateKm(trips: Trip[]): number {
  return roundToIntegerKm(
    trips.filter((t) => t.trip_type === 'Private').reduce((s, t) => s + roundToIntegerKm(t.trip_distance), 0)
  );
}

// ---------------------------------------------------------------------------
// Summary metric cards — Integer KM per ADR 0002
// ---------------------------------------------------------------------------

export function computeDashboardMetrics(params: {
  trips: Trip[];
  vehicle: Vehicle | null;
  pages?: BookPage[];
}): DashboardMetrics {
  const { trips, vehicle, pages } = params;
  const officialKm = sumOfficialKm(trips);
  const privateKm = sumPrivateKm(trips);
  const totalKm = roundToIntegerKm(officialKm + privateKm);
  const tripCount = trips.length;

  let fuelLevel: number;
  if (pages && pages.length > 0) {
    const last = [...pages].sort((a, b) => a.page_number - b.page_number)[pages.length - 1];
    fuelLevel = roundToOneDecimal(last.end_fuel_balance);
  } else if (vehicle) {
    fuelLevel = roundToOneDecimal(vehicle.current_fuel_level ?? 0);
  } else {
    fuelLevel = 0;
  }
  const tankCapacity = vehicle ? roundToOneDecimal(vehicle.tank_capacity ?? 0) : 0;
  const fuelLevelPercent = tankCapacity > 0 ? roundToOneDecimal(Math.min(100, Math.max(0, (fuelLevel / tankCapacity) * 100))) : 0;

  // Last ODO: max end_km among trips, with its date; fallback to vehicle odometer
  let lastOdo = 0;
  let lastOdoDate: string | null = null;
  if (trips.length > 0) {
    const sorted = [...trips].sort((a, b) => a.date.localeCompare(b.date) || a.end_km - b.end_km);
    const lastTrip = sorted[sorted.length - 1];
    lastOdo = roundToIntegerKm(lastTrip.end_km);
    lastOdoDate = lastTrip.date;
  } else if (vehicle) {
    lastOdo = roundToIntegerKm(vehicle.current_odometer ?? 0);
    lastOdoDate = null;
  }

  return { officialKm, privateKm, totalKm, tripCount, fuelLevel, tankCapacity, fuelLevelPercent, lastOdo, lastOdoDate };
}

export function getCurrentMonthKey(now: Date = new Date()): string {
  return formatDateISO(now).slice(0, 7); // YYYY-MM
}

export function computeMetricsForMonth(trips: Trip[], vehicle: Vehicle | null, monthKey: string, pages?: BookPage[]): DashboardMetrics {
  const filtered = trips.filter((t) => t.date.slice(0, 7) === monthKey);
  return computeDashboardMetrics({ trips: filtered, vehicle, pages });
}

export function computeThisMonthMetrics(params: {
  trips: Trip[];
  vehicle: Vehicle | null;
  pages?: BookPage[];
  now?: Date;
}): DashboardMetrics {
  const { trips, vehicle, pages, now } = params;
  const monthKey = getCurrentMonthKey(now ?? new Date());
  return computeMetricsForMonth(trips, vehicle, monthKey, pages);
}

// ---------------------------------------------------------------------------
// Monthly breakdown — integer KM
// ---------------------------------------------------------------------------

export function computeMonthlyBreakdown(params: { trips: Trip[]; pages: BookPage[] }): MonthlyBreakdown[] {
  const { trips, pages } = params;
  const monthKeys = new Set<string>();
  for (const t of trips) monthKeys.add(t.date.slice(0, 7));
  for (const p of pages) monthKeys.add(p.month);
  const sortedKeys = Array.from(monthKeys).sort();

  return sortedKeys.map((key) => {
    const monthTrips = trips.filter((t) => t.date.slice(0, 7) === key);
    const monthPages = pages.filter((p) => p.month === key);
    const officialKm = sumOfficialKm(monthTrips);
    const privateKm = sumPrivateKm(monthTrips);
    const totalKm = roundToIntegerKm(officialKm + privateKm);
    const fuelDrawn = roundToOneDecimal(monthTrips.reduce((s, t) => s + roundToOneDecimal(t.fuel_pumped_amount ?? 0), 0));
    return {
      monthKey: key,
      monthLabel: formatMonthLabel(key),
      officialKm,
      privateKm,
      totalKm,
      tripCount: monthTrips.length,
      fuelDrawn,
      pageCount: monthPages.length,
    };
  });
}

// ---------------------------------------------------------------------------
// Page-wise distance — integer KM
// ---------------------------------------------------------------------------

export function computePageWiseDistances(params: { trips: Trip[]; pages: BookPage[] }): PageDistance[] {
  const { trips, pages } = params;
  const sortedPages = [...pages].sort((a, b) => a.page_number - b.page_number);
  return sortedPages.map((page) => {
    const pageTrips = trips.filter((t) => t.page_id === page.id);
    const distance = sumDistance(pageTrips);
    const officialKm = sumOfficialKm(pageTrips);
    const privateKm = sumPrivateKm(pageTrips);
    return {
      pageNumber: page.page_number,
      month: page.month,
      monthLabel: formatMonthLabel(page.month),
      distance,
      officialKm,
      privateKm,
      tripCount: pageTrips.length,
    };
  });
}

// ---------------------------------------------------------------------------
// Last-12 slicing helpers
// ---------------------------------------------------------------------------

export function getLastN<T>(items: T[], n: number): T[] {
  if (n <= 0) return [];
  if (items.length <= n) return [...items];
  return items.slice(-n);
}

export function getLast12MonthlyBreakdown(breakdown: MonthlyBreakdown[]): MonthlyBreakdown[] {
  return getLastN(breakdown, 12);
}

export function getLast12PageDistances(distances: PageDistance[]): PageDistance[] {
  return getLastN(distances, 12);
}

// ---------------------------------------------------------------------------
// Global Search — Phase 2 Issue 04
// Fields: Date, Places Visited, Fuel Order No, Trip Type, KM substrings (start_km, end_km, trip_distance)
// Case-insensitive substring for text, numeric substring for KM.
// Debounce (~200ms) is handled at the UI layer.
// ---------------------------------------------------------------------------

export function matchesGlobalSearch(trip: Trip, rawQuery: string): boolean {
  const q = rawQuery.trim().toLowerCase();
  if (q === '') return true;
  const dateMatch = trip.date.toLowerCase().includes(q);
  const placesMatch = trip.places_visited.toLowerCase().includes(q);
  const orderNoMatch = (trip.fuel_order_no ?? '').toLowerCase().includes(q);
  const typeMatch = trip.trip_type.toLowerCase().includes(q);
  const kmMatch =
    String(trip.start_km).includes(q) ||
    String(trip.end_km).includes(q) ||
    String(trip.trip_distance).includes(q);
  return dateMatch || placesMatch || orderNoMatch || typeMatch || kmMatch;
}

export function filterTripsByGlobalSearch(trips: Trip[], rawQuery: string): Trip[] {
  const q = rawQuery.trim();
  if (q === '') return [...trips];
  return trips.filter((t) => matchesGlobalSearch(t, q));
}

export function computeFilteredSums(trips: Trip[]): FilteredSums {
  const count = trips.length;
  const officialKm = sumOfficialKm(trips);
  const privateKm = sumPrivateKm(trips);
  const totalKm = roundToIntegerKm(officialKm + privateKm);
  return { count, officialKm, privateKm, totalKm };
}

export function filterTripsByGlobalSearchWithSums(
  trips: Trip[],
  rawQuery: string
): { filtered: Trip[]; sums: FilteredSums } {
  const filtered = filterTripsByGlobalSearch(trips, rawQuery);
  const sums = computeFilteredSums(filtered);
  return { filtered, sums };
}

// ---------------------------------------------------------------------------
// Master Table filter/search/sort — retains full extended search for backward compat
// ---------------------------------------------------------------------------

export function filterAndSortTrips(trips: Trip[], opts: FilterOptions): Trip[] {
  let result = [...trips];

  if (opts.tripType && opts.tripType !== 'All') {
    result = result.filter((t) => t.trip_type === opts.tripType);
  }

  if (opts.month && opts.month !== 'All') {
    result = result.filter((t) => t.date.slice(0, 7) === opts.month);
  }

  if (opts.search && opts.search.trim() !== '') {
    const q = opts.search.trim().toLowerCase();
    result = result.filter((t) => {
      return (
        t.places_visited.toLowerCase().includes(q) ||
        t.trip_type.toLowerCase().includes(q) ||
        t.date.toLowerCase().includes(q) ||
        t.start_time.toLowerCase().includes(q) ||
        t.end_time.toLowerCase().includes(q) ||
        String(t.start_km).includes(q) ||
        String(t.end_km).includes(q) ||
        String(t.trip_distance).includes(q) ||
        (t.fuel_order_no ?? '').toLowerCase().includes(q)
      );
    });
  }

  const column = opts.sortColumn ?? 'date';
  const dir = opts.sortDirection ?? 'desc';

  result.sort((a, b) => {
    let cmp = 0;
    switch (column) {
      case 'date':
        cmp = a.date.localeCompare(b.date);
        if (cmp === 0) cmp = a.end_km - b.end_km;
        if (cmp === 0) cmp = a.start_time.localeCompare(b.start_time);
        break;
      case 'start_km':
        cmp = a.start_km - b.start_km;
        break;
      case 'end_km':
        cmp = a.end_km - b.end_km;
        break;
      case 'trip_distance':
        cmp = a.trip_distance - b.trip_distance;
        break;
      case 'trip_type':
        cmp = a.trip_type.localeCompare(b.trip_type);
        break;
      case 'places_visited':
        cmp = a.places_visited.localeCompare(b.places_visited);
        break;
      case 'fuel_pumped_amount':
        cmp = (a.fuel_pumped_amount ?? 0) - (b.fuel_pumped_amount ?? 0);
        break;
      default:
        cmp = a.date.localeCompare(b.date);
    }
    return dir === 'asc' ? cmp : -cmp;
  });

  return result;
}

export function getAvailableMonths(trips: Trip[], pages: BookPage[]): string[] {
  const set = new Set<string>();
  for (const t of trips) set.add(t.date.slice(0, 7));
  for (const p of pages) set.add(p.month);
  return Array.from(set).sort();
}

export function getDistinctTripTypes(): Array<'Official' | 'Private'> {
  return ['Official', 'Private'];
}
