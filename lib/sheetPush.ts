/**
 * Sheet Push — preservation of unimported Buffer rows (Odo Key)
 * See ADR 0016 and lib/sheetPull.ts compareBufferToDb
 */
import type { Trip, LeaveDay } from '@/types';
import type { BufferTrip, BufferLeave } from './sheetClient';
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
 * When exactMirror=true, preserved rows are calculated but NOT appended — caller can use rowsExact = DB only.
 * Return includes both `rows` (with preserved) and `rowsExact` (DB only) so UI can toggle without recompute.
 */
export function buildPushPayload(params: { dbTrips: Trip[]; bufferRows: BufferTrip[] }): { rows: BufferTrip[]; rowsExact: BufferTrip[]; dbRows: BufferTrip[]; preserved: BufferTrip[]; overwritingCount: number; invalidIgnored: number } {
  const { dbTrips, bufferRows } = params;
  const { preserved, overwritingCount, invalidIgnored } = computePreservedRows({ bufferRows, dbTrips });
  const dbRows = buildDbBufferRows(dbTrips);
  const rows = [...dbRows, ...preserved];
  const rowsExact = [...dbRows];
  return { rows, rowsExact, dbRows, preserved, overwritingCount, invalidIgnored };
}

// --- Leaves ---
export interface PreservedLeavesResult {
  preserved: BufferLeave[];
  overwritingCount: number;
  invalidIgnored: number;
}

function isValidLeaf(l: BufferLeave): boolean {
  if (!l.date || !/^\d{4}-\d{2}-\d{2}$/.test(l.date)) return false;
  const [y, m, d] = l.date.split('-').map(Number);
  if (y < 2024 || y > 2027) return false;
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() + 1 !== m || dt.getDate() !== d) return false;
  if ((l.note ?? '').length > 200) return false;
  return true;
}

export function computePreservedLeaves(params: { bufferLeaves: BufferLeave[]; dbLeaves: LeaveDay[] }): PreservedLeavesResult {
  const { bufferLeaves, dbLeaves } = params;
  const invalidIgnored = bufferLeaves.filter((l) => !isValidLeaf(l)).length;
  const validRows = bufferLeaves.filter(isValidLeaf);
  const seen = new Set<string>();
  const deduped: BufferLeave[] = [];
  for (const r of validRows) {
    if (seen.has(r.date)) continue;
    seen.add(r.date);
    deduped.push(r);
  }
  const dbSet = new Set(dbLeaves.map((l) => l.date));
  const preserved: BufferLeave[] = [];
  let overwritingCount = 0;
  for (const r of deduped) {
    if (dbSet.has(r.date)) overwritingCount++;
    else preserved.push(r);
  }
  return { preserved, overwritingCount, invalidIgnored };
}

export function buildDbLeavesRows(dbLeaves: LeaveDay[]): BufferLeave[] {
  const sorted = [...dbLeaves].sort((a, b) => a.date.localeCompare(b.date));
  return sorted.map((l) => ({ date: l.date, note: l.note ?? '' }));
}

export function buildPushLeavesPayload(params: { dbLeaves: LeaveDay[]; bufferLeaves: BufferLeave[] }): { leaves: BufferLeave[]; leavesExact: BufferLeave[]; dbRows: BufferLeave[]; preserved: BufferLeave[]; overwritingCount: number; invalidIgnored: number } {
  const { dbLeaves, bufferLeaves } = params;
  const { preserved, overwritingCount, invalidIgnored } = computePreservedLeaves({ bufferLeaves, dbLeaves });
  const dbRows = buildDbLeavesRows(dbLeaves);
  const leaves = [...dbRows, ...preserved];
  const leavesExact = [...dbRows];
  return { leaves, leavesExact, dbRows, preserved, overwritingCount, invalidIgnored };
}
