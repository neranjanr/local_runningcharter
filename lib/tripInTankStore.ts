/**
 * Per-trip In-Tank fuel inputs (Spec #6 Issue #10).
 *
 * Beside the legacy per-day store (`inTankStore`, per pageId -> dayIndex),
 * every trip carries its own in-tank slot: absent (or zero) means no top-up
 * at that trip. A typed value is added at its own trip under the existing
 * capacity rule, so a rare mid-day top-up without a pump record is modeled
 * where it happened. Existing per-day values backfill onto the first trip
 * of their date, so books render unchanged until a trip value is typed.
 */
import type { Trip } from '@/types';
import { getDistinctDates } from './pagination';
import { roundToOneDecimal } from './tripCalculations';

const STORAGE_KEY = 'fleetledger_trip_in_tank_v1';

export type TripInTanks = Record<string, number>;

// In-memory mirror so the store works when localStorage is unavailable
// (SSR, vitest happy-dom without --localstorage-file). Always kept in sync
// with persistent storage when it exists.
let inMemoryInTanks: TripInTanks = {};

function storage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
    if (typeof globalThis !== 'undefined' && (globalThis as unknown as { localStorage?: Storage }).localStorage) {
      return (globalThis as unknown as { localStorage: Storage }).localStorage;
    }
    return null;
  } catch {
    return null;
  }
}

function parseRecord(raw: string | null): TripInTanks {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as TripInTanks;
    }
  } catch {}
  return {};
}

function readAll(): TripInTanks {
  const store = storage();
  if (!store) return { ...inMemoryInTanks };
  const persisted = parseRecord(store.getItem(STORAGE_KEY));
  // Merge memory writes that never reached storage (test env) over persisted.
  return { ...persisted, ...inMemoryInTanks };
}

function writeAll(all: TripInTanks): void {
  inMemoryInTanks = { ...all };
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {}
}

/**
 * Normalize a typed value: zero/negative/NaN/empty clears back to the
 * default (absent), positive values round to 1 decimal.
 */
function normalizeInTank(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!isFinite(n) || n <= 0) return null;
  return roundToOneDecimal(n);
}

/** In-tank litres for one trip; untouched trips default to zero. */
export function getTripInTank(tripId: string): number {
  const all = readAll();
  const n = normalizeInTank(all[tripId] ?? null);
  return n ?? 0;
}

export function getAllTripInTanks(): TripInTanks {
  const all = readAll();
  const out: TripInTanks = {};
  for (const [k, v] of Object.entries(all)) {
    const n = normalizeInTank(v);
    if (n !== null) out[k] = n;
  }
  return out;
}

/**
 * Positive per-trip entries as a Map. Absent ids default to zero at their
 * own trip (with the legacy per-date fallback for the first trip of a date
 * applied by the ledger engine).
 */
export function getTripInTankMap(): Map<string, number> {
  const entries = getAllTripInTanks();
  const map = new Map<string, number>();
  for (const [k, v] of Object.entries(entries)) {
    if (v !== null && v !== undefined && Number(v) > 0) map.set(k, Number(v));
  }
  return map;
}

export function saveTripInTank(tripId: string, value: number | null): void {
  const all = readAll();
  const n = normalizeInTank(value);
  if (n === null) delete all[tripId];
  else all[tripId] = n;
  writeAll(all);
}

export function clearAllTripInTanks(): void {
  inMemoryInTanks = {};
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {}
}

function sortTripsChronologically(trips: Trip[]): Trip[] {
  return [...trips].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.trip_index !== b.trip_index) return a.trip_index - b.trip_index;
    return a.start_km - b.start_km;
  });
}

/**
 * Backfill legacy per-day values onto the first trip of their date.
 * Only fills trips with no existing entry; zero/empty per-day values leave
 * trips empty (default zero). Matches the legacy engine, which added a
 * date's in-tank at its first trip. Returns counts for reporting.
 */
export function backfillTripInTanksFromPerDay(
  trips: Trip[],
  getInTanksForPage: (pageId: string) => (number | null | undefined)[],
): { copied: number; skipped: number } {
  const all = readAll();
  let copied = 0;
  let skipped = 0;

  const byPage = new Map<string, Trip[]>();
  for (const t of trips) {
    if (!byPage.has(t.page_id)) byPage.set(t.page_id, []);
    byPage.get(t.page_id)!.push(t);
  }

  for (const [pageId, pageTrips] of byPage) {
    const distinct = getDistinctDates(pageTrips);
    const inTanks = getInTanksForPage(pageId) ?? [];
    const sorted = sortTripsChronologically(pageTrips);
    const firstByDate = new Map<string, Trip>();
    for (const t of sorted) {
      if (!firstByDate.has(t.date)) firstByDate.set(t.date, t);
    }
    for (const [date, first] of firstByDate) {
      if (all[first.id] !== undefined && normalizeInTank(all[first.id]) !== null) {
        skipped++;
        continue;
      }
      const idx = distinct.indexOf(date);
      const perDay = idx >= 0 && idx < inTanks.length ? inTanks[idx] : null;
      const n = normalizeInTank(perDay ?? null);
      if (n !== null) {
        all[first.id] = n;
        copied++;
      } else {
        skipped++;
      }
    }
  }

  writeAll(all);
  return { copied, skipped };
}
