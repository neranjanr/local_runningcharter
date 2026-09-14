/**
 * Sheet Pull — comparison of Buffer Sheet rows vs DB using Odo Key
 * Identity = Odo Key (date|start|end) per grill Q5 a
 */
import type { Trip } from '@/types';
import type { BufferTrip } from './sheetClient';
import { roundToIntegerKm, roundToOneDecimal } from './tripCalculations';
import { getOdoKey } from './allTripsWorkbook';

export interface SheetRowAnalysis {
  bufferTrip: BufferTrip;
  partial: Partial<Trip>;
}

export interface PullComparison {
  newRows: SheetRowAnalysis[];
  changedRows: { bufferTrip: BufferTrip; partial: Partial<Trip>; existing: Trip; diff: string }[];
  skippedRows: SheetRowAnalysis[];
  totalFetched: number;
}

function toPartial(b: BufferTrip): Partial<Trip> {
  return {
    date: b.date,
    start_km: roundToIntegerKm(b.start_km),
    end_km: roundToIntegerKm(b.end_km),
    trip_distance: roundToIntegerKm(b.trip_distance ?? (b.end_km - b.start_km)),
    start_time: b.start_time || undefined,
    end_time: b.end_time,
    trip_type: b.trip_type || 'Official',
    places_visited: b.places_visited,
    fuel_pumped_amount: b.fuel_pumped_amount != null ? roundToOneDecimal(b.fuel_pumped_amount) : 0,
    fuel_order_no: b.fuel_order_no || undefined,
  };
}

function buildDiff(existing: Trip, incoming: Partial<Trip>): string {
  const parts: string[] = [];
  if ((incoming.places_visited ?? '') !== (existing.places_visited ?? '')) parts.push(`places: "${existing.places_visited}"→"${incoming.places_visited}"`);
  if ((incoming.start_time ?? '') !== (existing.start_time ?? '')) parts.push(`start: ${existing.start_time || '-'}→${incoming.start_time || '-'}`);
  if ((incoming.end_time ?? '') !== (existing.end_time ?? '')) parts.push(`end: ${existing.end_time}→${incoming.end_time}`);
  if ((incoming.trip_type ?? 'Official') !== (existing.trip_type ?? 'Official')) parts.push(`type: ${existing.trip_type}→${incoming.trip_type}`);
  if (roundToOneDecimal(incoming.fuel_pumped_amount ?? 0) !== roundToOneDecimal(existing.fuel_pumped_amount ?? 0)) parts.push(`fuel: ${existing.fuel_pumped_amount ?? 0}→${incoming.fuel_pumped_amount ?? 0}`);
  if ((incoming.fuel_order_no ?? '') !== (existing.fuel_order_no ?? '')) parts.push(`order: ${existing.fuel_order_no || '-'}→${incoming.fuel_order_no || '-'}`);
  return parts.join('; ') || 'changed';
}

export function compareBufferToDb(params: { bufferRows: BufferTrip[]; existingTrips: Trip[] }): PullComparison {
  const { bufferRows, existingTrips } = params;
  // Filter out invalid rows (same as parseAllTripsWorkbook essential fields)
  const validRows = bufferRows.filter(r => r.date && r.places_visited && r.end_time && Number.isFinite(r.start_km) && Number.isFinite(r.end_km));
  const odoMap = new Map<string, Trip>();
  for (const t of existingTrips) odoMap.set(getOdoKey(t), t);

  // Also track duplicate odo within buffer itself — keep first occurrence
  const seenOdo = new Set<string>();
  const deduped: BufferTrip[] = [];
  for (const r of validRows) {
    const p = toPartial(r);
    const k = getOdoKey(p);
    if (seenOdo.has(k)) continue;
    seenOdo.add(k);
    deduped.push(r);
  }

  // Sort newest-first for preview (but comparison is set-based)
  deduped.sort((a, b) => b.date.localeCompare(a.date) || b.start_km - a.start_km);

  const newRows: SheetRowAnalysis[] = [];
  const changedRows: PullComparison['changedRows'] = [];
  const skippedRows: SheetRowAnalysis[] = [];

  for (const b of deduped) {
    const p = toPartial(b);
    const k = getOdoKey(p);
    const existing = odoMap.get(k);
    if (!existing) {
      newRows.push({ bufferTrip: b, partial: p });
    } else {
      const sameFuel = roundToOneDecimal(p.fuel_pumped_amount ?? 0) === roundToOneDecimal(existing.fuel_pumped_amount ?? 0);
      const sameOrder = (p.fuel_order_no ?? '') === (existing.fuel_order_no ?? '');
      const sameStart = (p.start_time ?? '') === (existing.start_time ?? '');
      const sameEnd = (p.end_time ?? '') === (existing.end_time ?? '');
      const sameType = (p.trip_type ?? 'Official') === (existing.trip_type ?? 'Official');
      const samePlaces = (p.places_visited ?? '') === (existing.places_visited ?? '');
      if (sameFuel && sameOrder && sameStart && sameEnd && sameType && samePlaces) {
        skippedRows.push({ bufferTrip: b, partial: p });
      } else {
        changedRows.push({ bufferTrip: b, partial: p, existing, diff: buildDiff(existing, p) });
      }
    }
  }

  return { newRows, changedRows, skippedRows, totalFetched: bufferRows.length };
}

export function toPartialFromBuffer(b: BufferTrip): Partial<Trip> {
  return toPartial(b);
}
