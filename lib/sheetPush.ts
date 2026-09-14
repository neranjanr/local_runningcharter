/**
 * Sheet Push — preservation of unimported Buffer rows (Odo Key)
 * See ADR 0016 and lib/sheetPull.ts compareBufferToDb
 */
import type { Trip } from '@/types';
import type { BufferTrip } from './sheetClient';
import { getOdoKey } from './allTripsWorkbook';
import { roundToIntegerKm, roundToOneDecimal } from './tripCalculations';

export interface PreservedResult {
  preserved: BufferTrip[];
  overwritingCount: number;
  invalidIgnored: number;
}

/**
 * Compute which Buffer rows are preserved (valid rows whose Odo Key not in DB).
 * - Filters invalid rows (date && places_visited && end_time && isFinite start_km/end_km)
 * - Dedupe within buffer by Odo Key (first occurrence wins)
 * - preserved = deduped valid rows where odo ∉ DB (DB wins on same Odo Key)
 * - Returns preserved in original buffer order, plus counts.
 */
export function computePreservedRows(params: { bufferRows: BufferTrip[]; dbTrips: Trip[] }): PreservedResult {
  const { bufferRows, dbTrips } = params;
  const invalidIgnored = bufferRows.filter(
    (r) => !(r.date && r.places_visited && r.end_time && Number.isFinite(r.start_km) && Number.isFinite(r.end_km))
  ).length;

  const validRows = bufferRows.filter(
    (r) => r.date && r.places_visited && r.end_time && Number.isFinite(r.start_km) && Number.isFinite(r.end_km)
  );

  // Dedupe within buffer by Odo Key (first wins)
  const seen = new Set<string>();
  const deduped: BufferTrip[] = [];
  for (const r of validRows) {
    const k = getOdoKey(r as unknown as Partial<Trip>);
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(r);
  }

  const dbOdoSet = new Set<string>(dbTrips.map((t) => getOdoKey(t)));

  const preserved: BufferTrip[] = [];
  let overwritingCount = 0;
  for (const r of deduped) {
    const k = getOdoKey(r as unknown as Partial<Trip>);
    if (dbOdoSet.has(k)) {
      overwritingCount++;
    } else {
      preserved.push(r);
    }
  }

  return { preserved, overwritingCount, invalidIgnored };
}

/**
 * Build DB rows as BufferTrip[] sorted date ASC → start_km ASC with Integer KM / 1-dec fuel.
 */
export function buildDbBufferRows(dbTrips: Trip[]): BufferTrip[] {
  const sorted = [...dbTrips].sort((a, b) => a.date.localeCompare(b.date) || a.start_km - b.start_km);
  return sorted.map((t) => ({
    date: t.date,
    start_km: roundToIntegerKm(t.start_km),
    end_km: roundToIntegerKm(t.end_km),
    trip_distance: roundToIntegerKm(t.trip_distance ?? t.end_km - t.start_km),
    start_time: t.start_time || '',
    end_time: t.end_time,
    trip_type: t.trip_type ?? 'Official',
    places_visited: t.places_visited,
    fuel_pumped_amount: t.fuel_pumped_amount != null ? roundToOneDecimal(t.fuel_pumped_amount) : 0,
    fuel_order_no: t.fuel_order_no || '',
  }));
}

/**
 * Build full push payload: DB rows sorted + preserved appended at bottom in original buffer order.
 */
export function buildPushPayload(params: { dbTrips: Trip[]; bufferRows: BufferTrip[] }): { rows: BufferTrip[]; preserved: BufferTrip[]; overwritingCount: number; invalidIgnored: number } {
  const { dbTrips, bufferRows } = params;
  const { preserved, overwritingCount, invalidIgnored } = computePreservedRows({ bufferRows, dbTrips });
  const dbRows = buildDbBufferRows(dbTrips);
  const rows = [...dbRows, ...preserved];
  return { rows, preserved, overwritingCount, invalidIgnored };
}
