/**
 * Fuel-Day Ownership store (ADR-0036).
 *
 * Per fuel-in Date choice of whether that Date shares the previous
 * segment's economy (`previous`, the default) or the next segment's
 * (`next`). Keyed by calendar date so it survives page rebuilds and
 * re-pagination. A zero-distance fuel day always joins previous
 * regardless of what is stored here (normalised at estimate time).
 */
import type { FuelDayOwnership } from './tripCycleSlots';

const STORAGE_KEY = 'fleetledger_fuel_day_ownership_v1';

// In-memory mirror so the store works when localStorage is unavailable
// (SSR, vitest without --localstorage-file). Kept in sync with
// persistent storage when it exists.
let inMemory: Record<string, FuelDayOwnership> = {};

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

function parseRecord(raw: string | null): Record<string, FuelDayOwnership> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: Record<string, FuelDayOwnership> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (v === 'previous' || v === 'next') out[k] = v;
      }
      return out;
    }
  } catch {}
  return {};
}

function readAll(): Record<string, FuelDayOwnership> {
  const store = storage();
  if (!store) return { ...inMemory };
  return { ...parseRecord(store.getItem(STORAGE_KEY)), ...inMemory };
}

function writeAll(all: Record<string, FuelDayOwnership>): void {
  inMemory = { ...all };
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {}
}

export function getFuelDayOwnership(date: string): FuelDayOwnership {
  return readAll()[date] ?? 'previous';
}

export function getAllFuelDayOwnership(): Record<string, FuelDayOwnership> {
  return readAll();
}

export function setFuelDayOwnership(date: string, ownership: FuelDayOwnership): void {
  const all = readAll();
  all[date] = ownership;
  writeAll(all);
}

export function clearFuelDayOwnership(date: string): void {
  const all = readAll();
  delete all[date];
  writeAll(all);
}

export function clearAllFuelDayOwnership(): void {
  inMemory = {};
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {}
}
