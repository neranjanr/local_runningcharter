import { BookPage, Trip } from '@/types';
import { roundToOneDecimal, roundToIntegerKm } from './tripCalculations';

const LOCAL_STORAGE_KEY = 'fleetledger_book_pages';

function readLocalPages(): BookPage[] {
  if (typeof window === 'undefined') return [];
  const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
  if (!stored) return [];
  try { return JSON.parse(stored) as BookPage[]; } catch { return []; }
}

function writeLocalPages(pages: BookPage[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(pages));
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

export async function getPages(): Promise<BookPage[]> {
  try {
    const res = await apiFetch('/api/pages');
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) return data as BookPage[];
    }
  } catch { /* fall through to localStorage */ }
  return readLocalPages();
}

export async function savePage(page: BookPage): Promise<BookPage> {
  // Try API first
  try {
    const existingPages = await getPages();
    const exists = existingPages.find(p => p.id === page.id);
    const method = exists ? 'PUT' : 'POST';
    const res = await apiFetch('/api/pages', { method, body: JSON.stringify(page) });
    if (res.ok) {
      const data = await res.json();
      if (data) return data as BookPage;
    }
  } catch { /* fall through */ }

  // localStorage fallback
  const pages = readLocalPages();
  const idx = pages.findIndex(p => p.id === page.id);
  if (idx >= 0) pages[idx] = page; else pages.push(page);
  pages.sort((a, b) => a.page_number - b.page_number);
  writeLocalPages(pages);
  return page;
}

export async function getNextPageStartKmAsync(): Promise<number> {
  const pages = await getPages();
  if (pages.length > 0) {
    const last = [...pages].sort((a, b) => a.page_number - b.page_number)[pages.length - 1];
    return roundToIntegerKm(last.end_km);
  }
  const { getVehicleProfile } = await import('./vehicleStore');
  const vehicle = await getVehicleProfile();
  return roundToIntegerKm(vehicle.current_odometer ?? 0);
}

export async function getNextPageStartFuelAsync(): Promise<number> {
  const pages = await getPages();
  if (pages.length > 0) {
    const last = [...pages].sort((a, b) => a.page_number - b.page_number)[pages.length - 1];
    return roundToOneDecimal(last.end_fuel_balance);
  }
  const { getVehicleProfile } = await import('./vehicleStore');
  const vehicle = await getVehicleProfile();
  const fallbackFuel = (vehicle as any).current_fuel_level ?? 10;
  return roundToOneDecimal(fallbackFuel);
}

export async function ensurePageForAssignment(vehicleId: string, newTripDate: string): Promise<BookPage> {
  const pages = await getPages();
  const { getMonthKey } = await import('./pagination');
  const monthKey = getMonthKey(newTripDate);

  if (pages.length === 0) {
    const { getVehicleProfile } = await import('./vehicleStore');
    const vehicle = await getVehicleProfile();
    const fallbackFuel = (vehicle as any).current_fuel_level ?? 10;
    const newPage: BookPage = {
      id: 'page-1', vehicle_id: vehicleId, page_number: 1, month: monthKey,
      start_km: roundToIntegerKm(vehicle.current_odometer ?? 0), end_km: roundToIntegerKm(vehicle.current_odometer ?? 0),
      start_fuel_balance: roundToOneDecimal(fallbackFuel), end_fuel_balance: roundToOneDecimal(fallbackFuel),
    };
    await savePage(newPage);
    return newPage;
  }
  return pages[pages.length - 1];
}

export async function createNextPage(
  currentPage: BookPage,
  newTripDate: string,
  vehicleId: string
): Promise<BookPage> {
  const pages = await getPages();
  const { getMonthKey } = await import('./pagination');
  const nextNumber = currentPage.page_number + 1;
  const startKm = roundToIntegerKm(currentPage.end_km);
  const startFuel = roundToOneDecimal(currentPage.end_fuel_balance);
  const newPage: BookPage = {
    id: `page-${nextNumber}`,
    vehicle_id: vehicleId,
    page_number: nextNumber,
    month: getMonthKey(newTripDate),
    start_km: startKm,
    end_km: startKm,
    start_fuel_balance: startFuel,
    end_fuel_balance: startFuel,
  };
  return savePage(newPage);
}

export async function updatePageEndValues(pageId: string, endKm: number, endFuel: number): Promise<void> {
  await savePage({
    ...(await getPages()).find(p => p.id === pageId) ?? { id: pageId, vehicle_id: '', page_number: 0, month: '', start_km: 0, end_km: 0, start_fuel_balance: 0, end_fuel_balance: 0 },
    end_km: roundToIntegerKm(endKm),
    end_fuel_balance: roundToOneDecimal(endFuel),
  });
}

export function clearPages(): void {
  if (typeof window !== 'undefined') localStorage.removeItem(LOCAL_STORAGE_KEY);
}

export async function applyChronologicalRenumber(): Promise<{ pages: BookPage[]; trips: Trip[] }> {
  const { renumberPagesChronologically, recalculatePageBalancesFromOpening, getEarliestOverallDate } = await import('./pagination');
  const { getVehicleProfile } = await import('./vehicleStore');
  const { getTrips } = await import('./tripStore');
  const pages = await getPages();
  const trips = await getTrips();
  if (pages.length === 0) return { pages, trips };

  const { pages: renumberedPages, trips: renumberedTrips } = renumberPagesChronologically(pages, trips);
  const vehicle = await getVehicleProfile();
  const recalculated = recalculatePageBalancesFromOpening({
    pages: renumberedPages, trips: renumberedTrips,
    opening: { openingKm: roundToIntegerKm(vehicle.current_odometer ?? 0), openingFuel: roundToOneDecimal((vehicle as any).current_fuel_level ?? 10) },
  });

  // Persist renumbered pages and trips (trips need page_id cascade)
  for (const page of recalculated) {
    await savePage(page);
  }
  // persist renumbered trips page_id mapping
  try {
    // direct localStorage write to avoid API round-trip
    if (typeof window !== 'undefined') {
      const TRIPS_KEY = 'fleetledger_trips';
      localStorage.setItem(TRIPS_KEY, JSON.stringify(renumberedTrips));
    }
  } catch { /* ignore */ }
  return { pages: recalculated, trips: renumberedTrips };
}

export async function maybeRenumberForBackdatedTrip(newTripDate: string): Promise<boolean> {
  const { getEarliestOverallDate } = await import('./pagination');
  const { getTrips } = await import('./tripStore');
  const pages = await getPages();
  const trips = await getTrips();
  const earliest = getEarliestOverallDate(pages, trips);
  if (earliest === null) return false;
  if (newTripDate < earliest) {
    await applyChronologicalRenumber();
    return true;
  }
  return false;
}

export async function recalculateFromBookOpening(openingKm: number, openingFuel: number): Promise<BookPage[]> {
  const { renumberPagesChronologically, recalculatePageBalancesFromOpening } = await import('./pagination');
  const { getTrips } = await import('./tripStore');
  const pages = await getPages();
  const trips = await getTrips();
  if (pages.length === 0) return pages;

  const { pages: renumbered, trips: renumberedTrips } = renumberPagesChronologically(pages, trips);
  const recalculated = recalculatePageBalancesFromOpening({
    pages: renumbered, trips: renumberedTrips,
    opening: { openingKm: roundToIntegerKm(openingKm), openingFuel: roundToOneDecimal(openingFuel) },
  });

  for (const page of recalculated) {
    await savePage(page);
  }
  return recalculated;
}

export { getNextPageStartKm, getNextPageStartFuel } from './pagination';
