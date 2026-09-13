import { Trip, BookPage } from '@/types';
import { getVehicleProfile, saveVehicleProfile, DEFAULT_VEHICLE } from './vehicleStore';
import {
  assignPageForNewTrip,
  calculateConsumed,
  calculateBalance,
  getEarliestOverallDate,
  renumberPagesChronologically,
  getMonthKey,
} from './pagination';
import { getPages, savePage, createNextPage, updatePageEndValues } from './pageStore';
import { roundToOneDecimal, roundToIntegerKm } from './tripCalculations';

const LOCAL_STORAGE_KEY = 'fleetledger_trips';

export interface TripInput {
  date: string;
  start_time: string;
  end_time: string;
  start_km: number;
  end_km: number;
  trip_distance: number;
  trip_type: 'Official' | 'Private';
  places_visited: string;
  fuel_pumped_amount?: number;
  fuel_order_no?: string;
  fuel_order_date?: string;
}

function readLocalTrips(): Trip[] {
  if (typeof window === 'undefined') return [];
  const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
  if (!stored) return [];
  try { return JSON.parse(stored) as Trip[]; } catch { return []; }
}

function writeLocalTrips(trips: Trip[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(trips));
}

async function apiFetch(url: string, opts?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1000);
  try {
    return await fetch(url, { ...opts, signal: controller.signal, headers: { 'Content-Type': 'application/json', ...opts?.headers } });
  } finally {
    clearTimeout(timeout);
  }
}

export async function getTrips(): Promise<Trip[]> {
  let apiTrips: Trip[] = [];
  try {
    const res = await apiFetch('/api/trips');
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) apiTrips = data;
    }
  } catch { /* fall through */ }
  const localTrips = readLocalTrips();
  if (apiTrips.length > 0) return apiTrips;
  if (localTrips.length > 0) return localTrips;
  return apiTrips;
}

export async function getLastEndKm(): Promise<number> {
  const trips = await getTrips();
  if (trips.length > 0) return trips[trips.length - 1].end_km;
  const vehicle = await getVehicleProfile();
  return vehicle.current_odometer;
}

export async function saveTrip(input: TripInput): Promise<Trip> {
  const vehicle = await getVehicleProfile();
  const pages: BookPage[] = await getPages();
  let allTrips: Trip[];
  try {
    allTrips = await getTrips();
  } catch {
    allTrips = readLocalTrips();
  }

  let targetPage: BookPage | null = null;
  let dayIndex = 1;
  let tripIndex = 1;
  let pageId = '';

  if (pages.length === 0) {
    const defaultEconomy = 10.5;
    const consumed = calculateConsumed(roundToIntegerKm(input.trip_distance), defaultEconomy);
    const initialFuelEnd = calculateBalance(
      roundToOneDecimal(vehicle.current_fuel_level ?? 0),
      roundToOneDecimal(input.fuel_pumped_amount ?? 0),
      consumed
    );
    const initialPage: BookPage = {
      id: 'page-1', vehicle_id: vehicle.id, page_number: 1, month: getMonthKey(input.date),
      start_km: roundToIntegerKm(vehicle.current_odometer ?? 0), end_km: roundToIntegerKm(input.end_km),
      start_fuel_balance: roundToOneDecimal(vehicle.current_fuel_level ?? 0), end_fuel_balance: initialFuelEnd,
    };
    await savePage(initialPage);
    targetPage = initialPage;
    pageId = initialPage.id;
  } else {
    const assignment = assignPageForNewTrip({ pages, trips: allTrips, newTripDate: input.date });
    if ('allowed' in assignment && assignment.allowed === false) {
      throw new Error(`Cannot add trip: ${assignment.reason} limit reached for ${input.date}`);
    }
    const assign = assignment as { pageNumber: number; pageId: string; dayIndex: number; tripIndex: number; requiresNewPage: boolean };

    if (assign.requiresNewPage) {
      const current = [...pages].sort((a, b) => a.page_number - b.page_number)[pages.length - 1];
      const newPage = await createNextPage(current, input.date, vehicle.id);
      const defaultEconomy = 10.5;
      const consumed = calculateConsumed(roundToIntegerKm(input.trip_distance), defaultEconomy);
      newPage.end_km = roundToIntegerKm(input.end_km);
      newPage.end_fuel_balance = calculateBalance(roundToOneDecimal(newPage.start_fuel_balance), roundToOneDecimal(input.fuel_pumped_amount ?? 0), consumed);
      await savePage(newPage);
      targetPage = newPage;
      pageId = newPage.id;
    } else {
      targetPage = pages.find(p => p.id === assign.pageId) || pages[pages.length - 1];
      pageId = targetPage.id;
      dayIndex = assign.dayIndex;
      tripIndex = assign.tripIndex;
      const newEndKm = roundToIntegerKm(input.end_km);
      const fuelPumped = roundToOneDecimal(input.fuel_pumped_amount ?? 0);
      const defaultEconomy = 10.5;
      const consumed = calculateConsumed(roundToIntegerKm(input.trip_distance), defaultEconomy);
      const newEndFuel = calculateBalance(roundToOneDecimal(targetPage.end_fuel_balance), fuelPumped, consumed);
      await updatePageEndValues(targetPage.id, newEndKm, newEndFuel);
    }
  }

  const newTrip: Trip = {
    id: `trip-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    page_id: pageId, vehicle_id: vehicle.id, date: input.date,
    day_index: dayIndex, trip_index: tripIndex,
    start_time: input.start_time ?? '', end_time: input.end_time,
    start_km: roundToIntegerKm(input.start_km), end_km: roundToIntegerKm(input.end_km),
    trip_distance: roundToIntegerKm(input.trip_distance), trip_type: input.trip_type,
    places_visited: input.places_visited,
    fuel_pumped_amount: input.fuel_pumped_amount ?? 0,
    fuel_order_no: input.fuel_order_no ?? '',
  };

  // Try API first
  try {
    const res = await apiFetch('/api/trips', { method: 'POST', body: JSON.stringify(newTrip) });
    if (res.ok) {
      const data = await res.json();
      if (data) {
        await saveVehicleProfile({ current_odometer: roundToIntegerKm(input.end_km) });
        await saveVehicleProfile({ current_fuel_level: roundToOneDecimal(targetPage!.end_fuel_balance) });
        return data as Trip;
      }
    }
  } catch { /* fall through */ }

  // localStorage fallback
  const updated = [...readLocalTrips(), newTrip];
  writeLocalTrips(updated);

  try {
    await saveVehicleProfile({ current_odometer: roundToIntegerKm(input.end_km) });
    await saveVehicleProfile({ current_fuel_level: roundToOneDecimal(targetPage!.end_fuel_balance) });
  } catch { /* ignore */ }

  // Chronological renumber on back-dated insertion
  try {
    const earliestBefore = getEarliestOverallDate(pages, allTrips);
    const isBackdated = earliestBefore !== null && input.date < earliestBefore;
    if (isBackdated) {
      const { applyChronologicalRenumber } = await import('./pageStore');
      await applyChronologicalRenumber();
    }
  } catch { /* ignore */ }

  return newTrip;
}

export interface TripUpdateFields {
  start_km?: number;
  end_km?: number;
  trip_distance?: number;
  start_time?: string;
  end_time?: string;
  trip_type?: 'Official' | 'Private';
  places_visited?: string;
  fuel_pumped_amount?: number;
  fuel_order_no?: string;
}

export async function updateTrip(tripId: string, fields: TripUpdateFields): Promise<Trip | null> {
  const trips = await getTrips();
  const existing = trips.find(t => t.id === tripId);
  if (!existing) return null;

  const updated: Trip = {
    ...existing,
    ...fields,
    start_km: fields.start_km !== undefined ? roundToIntegerKm(fields.start_km) : existing.start_km,
    end_km: fields.end_km !== undefined ? roundToIntegerKm(fields.end_km) : existing.end_km,
    trip_distance: fields.trip_distance !== undefined
      ? roundToIntegerKm(fields.trip_distance)
      : fields.start_km !== undefined || fields.end_km !== undefined
        ? roundToIntegerKm((fields.end_km ?? existing.end_km) - (fields.start_km ?? existing.start_km))
        : existing.trip_distance,
    fuel_pumped_amount: fields.fuel_pumped_amount !== undefined ? roundToOneDecimal(fields.fuel_pumped_amount) : existing.fuel_pumped_amount,
  };

  // Try API first
  try {
    const res = await apiFetch('/api/trips', { method: 'PUT', body: JSON.stringify(updated) });
    if (res.ok) {
      const data = await res.json();
      if (data) {
        if (fields.start_km !== undefined || fields.end_km !== undefined) {
          await recalculatePageEndForTrip(updated);
        }
        return data as Trip;
      }
    }
  } catch { /* fall through */ }

  // localStorage fallback
  const localTrips = readLocalTrips();
  const idx = localTrips.findIndex(t => t.id === tripId);
  if (idx >= 0) { localTrips[idx] = updated; writeLocalTrips(localTrips); }

  if (fields.start_km !== undefined || fields.end_km !== undefined) {
    await recalculatePageEndForTrip(updated);
  }

  return updated;
}

async function recalculatePageEndForTrip(trip: Trip): Promise<void> {
  const pages = await getPages();
  const allTrips = await getTrips();
  const page = pages.find(p => p.id === trip.page_id);
  if (!page) return;

  const pageTrips = allTrips.filter(t => t.page_id === trip.page_id);
  const lastTrip = pageTrips.reduce((latest, t) => (t.end_km > latest.end_km ? t : latest), pageTrips[0]);
  if (lastTrip) {
    const defaultEconomy = 10.5;
    const consumed = calculateConsumed(roundToIntegerKm(lastTrip.trip_distance), defaultEconomy);
    const fuelPumped = roundToOneDecimal(lastTrip.fuel_pumped_amount ?? 0);
    const newEndFuel = calculateBalance(roundToOneDecimal(page.end_fuel_balance), fuelPumped, consumed);
    await updatePageEndValues(page.id, roundToIntegerKm(lastTrip.end_km), newEndFuel);
  }
}

export function clearTrips(): void {
  if (typeof window !== 'undefined') localStorage.removeItem(LOCAL_STORAGE_KEY);
}
