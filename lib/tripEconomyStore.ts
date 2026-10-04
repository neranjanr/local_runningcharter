/**
 * Per-trip fuel economy overrides (Spec #6 Issue #7 — expand step).
 *
 * Beside the current per-day stores (`fuelEconomyStore`), every trip carries
 * its own economy override slot: empty (absent/null) means inherit with
 * forward propagation in trip order and the existing 10.5 fallback at the
 * book start. No readers use this store yet — tables, popups, and graphs
 * still render from per-day values so displayed numbers are unchanged.
 */
import type { Trip } from '@/types';
import { getDistinctDates } from './pagination';
import { roundToOneDecimal } from './tripCalculations';
import { DEFAULT_FUEL_ECONOMY } from './ledgerCalculations';

const STORAGE_KEY = 'fleetledger_trip_economy_v1';

export type TripEconomyOverrides = Record<string, number | null>;

// In-memory mirror so the store works when localStorage is unavailable
// (SSR, vitest happy-dom without --localstorage-file). Always kept in sync
// with persistent storage when it exists.
let inMemoryOverrides: TripEconomyOverrides = {};

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

function parseRecord(raw: string | null): TripEconomyOverrides {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as TripEconomyOverrides;
    }
  } catch {}
  return {};
}

function readAll(): TripEconomyOverrides {
  const store = storage();
  if (!store) return { ...inMemoryOverrides };
  const persisted = parseRecord(store.getItem(STORAGE_KEY));
  // Merge memory writes that never reached storage (test env) over persisted.
  return { ...persisted, ...inMemoryOverrides };
}

function writeAll(all: TripEconomyOverrides): void {
  inMemoryOverrides = { ...all };
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {}
}

function normalizeOverride(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!isFinite(n) || n <= 0) return null;
  return roundToOneDecimal(n);
}

export function getTripEconomyOverride(tripId: string): number | null {
  const all = readAll();
  const v = all[tripId];
  return normalizeOverride(v ?? null);
}

export function getAllTripEconomyOverrides(): TripEconomyOverrides {
  const all = readAll();
  const out: TripEconomyOverrides = {};
  for (const [k, v] of Object.entries(all)) {
    const n = normalizeOverride(v);
    if (n !== null) out[k] = n;
  }
  return out;
}

export function saveTripEconomyOverride(tripId: string, value: number | null): void {
  const all = readAll();
  const n = normalizeOverride(value);
  if (n === null) delete all[tripId];
  else all[tripId] = n;
  writeAll(all);
}

export function clearAllTripEconomies(): void {
  inMemoryOverrides = {};
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
 * Resolve effective economy per trip in chronological trip order.
 * Forward propagation: an explicit override sets the running value;
 * empty slots inherit; the book start falls back to `fallback`.
 */
export function resolveTripEconomies(
  trips: Trip[],
  overrides: TripEconomyOverrides,
  fallback: number = DEFAULT_FUEL_ECONOMY,
): Map<string, number> {
  const sorted = sortTripsChronologically(trips);
  const result = new Map<string, number>();
  let current = roundToOneDecimal(fallback);
  for (const t of sorted) {
    const raw = overrides[t.id];
    const n = normalizeOverride(raw ?? null);
    if (n !== null) current = n;
    result.set(t.id, roundToOneDecimal(current));
  }
  return result;
}

/**
 * Backfill per-day stored values onto every trip of their date.
 * Only fills trips with no existing override; null/empty per-day values
 * leave trips empty (inherit). Returns counts for reporting.
 */
export function backfillTripEconomiesFromPerDay(
  trips: Trip[],
  getEconomiesForPage: (pageId: string) => (number | null | undefined)[],
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
    const economies = getEconomiesForPage(pageId) ?? [];
    for (const t of pageTrips) {
      if (all[t.id] !== undefined && normalizeOverride(all[t.id]) !== null) {
        skipped++;
        continue;
      }
      const idx = distinct.indexOf(t.date);
      const perDay = idx >= 0 && idx < economies.length ? economies[idx] : null;
      const n = normalizeOverride(perDay ?? null);
      if (n !== null) {
        all[t.id] = n;
        copied++;
      } else {
        skipped++;
      }
    }
  }

  writeAll(all);
  return { copied, skipped };
}
