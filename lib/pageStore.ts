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
  let apiPages: BookPage[] = [];
  try {
    const res = await apiFetch('/api/pages');
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) apiPages = data;
    }
  } catch { /* fall through to localStorage */ }
  const localPages = readLocalPages();
  if (apiPages.length > 0) return apiPages;
  if (localPages.length > 0) return localPages;
  return apiPages;
}

export async function rebuildLedger(): Promise<{ success: boolean; message: string }> {
  try {
    const { getTrips } = await import('./tripStore');
    const { getVehicleProfile } = await import('./vehicleStore');
    const { validateTripForPage, getDistinctDates, countTripsForDate, getMonthKey, recalculatePageBalancesFromOpening } = await import('./pagination');
    const { sortTripsChronologically } = await import('./tripShift');
    const tripsRaw = await getTrips();
    const vehicle = await getVehicleProfile();
    const vehicleId = (vehicle as any)?.id ?? 'veh-1';
    if (tripsRaw.length === 0) {
      const { trips } = await applyChronologicalRenumber();
      try { if (typeof window !== 'undefined') { localStorage.removeItem('fleetledger.rebuildRequired'); localStorage.removeItem('fleetledger.rebuildReason'); } } catch {}
      return { success: true, message: `Ledger rebuilt successfully. Recalculated ${trips.length} trips.` };
    }
    // Repaginate from scratch respecting 4 days / 13 trips / month rollover
    const sorted = sortTripsChronologically(tripsRaw);
    const newPages: BookPage[] = [];
    const newTrips: Trip[] = [];
    let currentPage: BookPage | null = null;
    for (const orig of sorted) {
      if (!currentPage) {
        currentPage = {
          id: `page-1`,
          vehicle_id: vehicleId,
          page_number: 1,
          month: getMonthKey(orig.date),
          start_km: 0,
          end_km: 0,
          start_fuel_balance: 0,
          end_fuel_balance: 0,
          created_at: new Date().toISOString(),
        };
        newPages.push(currentPage);
      } else {
        const tripsOnCurrent = newTrips.filter(t => t.page_id === currentPage!.id);
        const validation = validateTripForPage(tripsOnCurrent, currentPage, orig.date);
        if (!validation.allowed || validation.requiresNewPage) {
          const nextNumber = newPages.length + 1;
          currentPage = {
            id: `page-${nextNumber}`,
            vehicle_id: vehicleId,
            page_number: nextNumber,
            month: getMonthKey(orig.date),
            start_km: 0,
            end_km: 0,
            start_fuel_balance: 0,
            end_fuel_balance: 0,
            created_at: new Date().toISOString(),
          };
          newPages.push(currentPage);
        }
      }
      const tripsOnCurrent = newTrips.filter(t => t.page_id === currentPage!.id);
      const distinct = getDistinctDates(tripsOnCurrent);
      let dayIndex: number;
      if (distinct.includes(orig.date)) {
        dayIndex = distinct.sort().indexOf(orig.date) + 1;
      } else {
        const withNew = [...distinct, orig.date].sort();
        dayIndex = withNew.indexOf(orig.date) + 1;
      }
      const tripIndex = countTripsForDate(tripsOnCurrent, orig.date) + 1;
      newTrips.push({
        ...orig,
        page_id: currentPage.id,
        day_index: dayIndex,
        trip_index: tripIndex,
      });
    }
    // Recalculate odometer/fuel continuity from book opening
    const openingKm = roundToIntegerKm((vehicle as any)?.current_odometer ?? (vehicle as any)?.opening_km ?? 0);
    const openingFuel = roundToOneDecimal((vehicle as any)?.current_fuel_level ?? (vehicle as any)?.opening_fuel ?? 10);
    const recalculated = recalculatePageBalancesFromOpening({ pages: newPages, trips: newTrips, opening: { openingKm, openingFuel } });
    // Persist
    // Clear old pages first (localStorage and API)
    try {
      if (typeof window !== 'undefined') {
        localStorage.setItem('fleetledger_book_pages', JSON.stringify(recalculated));
        localStorage.setItem('fleetledger_trips', JSON.stringify(newTrips));
        localStorage.removeItem('fleetledger.rebuildRequired');
        localStorage.removeItem('fleetledger.rebuildReason');
      }
    } catch {}
    for (const p of recalculated) {
      await savePage(p);
    }
    try {
      if (typeof window !== 'undefined') {
        const TRIPS_KEY = 'fleetledger_trips';
        localStorage.setItem(TRIPS_KEY, JSON.stringify(newTrips));
        window.dispatchEvent(new CustomEvent('fleetledger:data-changed'));
      }
    } catch {}
    // Also try bulk API
    try {
      await fetch('/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pages: recalculated, trips: newTrips }) });
    } catch {}
    return { success: true, message: `Ledger rebuilt successfully. Repaginated ${newTrips.length} trips into ${recalculated.length} pages (was ${newPages.length} before).` };
  } catch (e: any) {
    return { success: false, message: e?.message || 'Failed to rebuild ledger' };
  }
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
