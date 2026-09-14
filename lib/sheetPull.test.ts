import { describe, it, expect } from 'vitest';
import { compareBufferToDb } from './sheetPull';
import type { Trip } from '@/types';

function trip(over: Partial<Trip>): Trip {
  return {
    id: over.id ?? 't1',
    vehicle_id: 'veh-1',
    page_id: 'page-1',
    date: over.date ?? '2026-01-01',
    day_index: 1,
    trip_index: 1,
    start_time: over.start_time ?? '08:00',
    end_time: over.end_time ?? '09:00',
    start_km: over.start_km ?? 100,
    end_km: over.end_km ?? 110,
    trip_distance: over.trip_distance ?? 10,
    trip_type: over.trip_type ?? 'Official',
    places_visited: over.places_visited ?? 'A -> B',
    fuel_pumped_amount: over.fuel_pumped_amount ?? 0,
    fuel_order_no: over.fuel_order_no,
  };
}

describe('compareBufferToDb (Odo Key)', () => {
  it('separates new / changed / skipped by Odo Key', () => {
    const existing = [
      trip({ id: 't1', date: '2026-01-01', start_km: 100, end_km: 110, places_visited: 'A -> B', end_time: '09:00' }),
      trip({ id: 't2', date: '2026-01-02', start_km: 110, end_km: 120, places_visited: 'B -> C', end_time: '10:00' }),
    ];
    const buffer = [
      { date: '2026-01-01', start_km: 100, end_km: 110, trip_distance: 10, start_time: '08:00', end_time: '09:00', trip_type: 'Official' as const, places_visited: 'A -> B', fuel_pumped_amount: 0 }, // exact duplicate -> skipped
      { date: '2026-01-02', start_km: 110, end_km: 120, trip_distance: 10, start_time: '08:00', end_time: '10:00', trip_type: 'Official' as const, places_visited: 'B -> C changed', fuel_pumped_amount: 0 }, // same odo diff places -> changed
      { date: '2026-01-03', start_km: 120, end_km: 130, trip_distance: 10, start_time: '08:00', end_time: '11:00', trip_type: 'Official' as const, places_visited: 'C -> D', fuel_pumped_amount: 5 }, // new
    ];
    const comp = compareBufferToDb({ bufferRows: buffer as any, existingTrips: existing });
    expect(comp.skippedRows.length).toBe(1);
    expect(comp.changedRows.length).toBe(1);
    expect(comp.newRows.length).toBe(1);
    expect(comp.changedRows[0].diff).toContain('places');
  });

  it('dedupes same odo within buffer and sorts newest-first', () => {
    const existing: Trip[] = [];
    const buffer = [
      { date: '2026-01-01', start_km: 100, end_km: 110, trip_distance: 10, start_time: '', end_time: '09:00', trip_type: 'Official' as const, places_visited: 'A', fuel_pumped_amount: 0 },
      { date: '2026-01-01', start_km: 100, end_km: 110, trip_distance: 10, start_time: '', end_time: '09:00', trip_type: 'Official' as const, places_visited: 'A dup', fuel_pumped_amount: 0 },
      { date: '2026-01-02', start_km: 110, end_km: 120, trip_distance: 10, start_time: '', end_time: '10:00', trip_type: 'Official' as const, places_visited: 'B', fuel_pumped_amount: 0 },
    ];
    const comp = compareBufferToDb({ bufferRows: buffer as any, existingTrips: existing });
    expect(comp.newRows.length).toBe(2);
    // newest first
    expect(comp.newRows[0].partial.date).toBe('2026-01-02');
  });
});
