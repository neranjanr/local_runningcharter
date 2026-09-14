import { describe, it, expect } from 'vitest';
import { computePreservedRows, buildDbBufferRows, buildPushPayload } from './sheetPush';
import type { Trip } from '@/types';
import type { BufferTrip } from './sheetClient';

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
function buf(over: Partial<BufferTrip>): BufferTrip {
  return {
    date: over.date ?? '2026-01-01',
    start_km: over.start_km ?? 100,
    end_km: over.end_km ?? 110,
    trip_distance: over.trip_distance ?? 10,
    start_time: over.start_time ?? '08:00',
    end_time: over.end_time ?? '09:00',
    trip_type: over.trip_type ?? 'Official',
    places_visited: over.places_visited ?? 'A -> B',
    fuel_pumped_amount: over.fuel_pumped_amount ?? 0,
    fuel_order_no: over.fuel_order_no ?? '',
  };
}

describe('computePreservedRows', () => {
  it('filters invalid rows and counts invalidIgnored', () => {
    const db = [trip({ date: '2026-01-01', start_km: 100, end_km: 110 })];
    const buffer: BufferTrip[] = [
      buf({ date: '2026-01-02', start_km: 110, end_km: 120, places_visited: 'B->C', end_time: '10:00' }), // valid preserved
      buf({ date: '', start_km: 120, end_km: 130, places_visited: 'C->D', end_time: '11:00' }), // invalid date
      buf({ date: '2026-01-03', start_km: 130, end_km: 140, places_visited: '', end_time: '12:00' }), // invalid places
      buf({ date: '2026-01-04', start_km: 140, end_km: 150, places_visited: 'E->F', end_time: '' }), // invalid end_time
      buf({ date: '2026-01-05', start_km: NaN as any, end_km: 160, places_visited: 'F->G', end_time: '13:00' } as any), // invalid km
    ];
    const res = computePreservedRows({ bufferRows: buffer, dbTrips: db });
    expect(res.invalidIgnored).toBe(4);
    expect(res.preserved.length).toBe(1);
    expect(res.preserved[0].date).toBe('2026-01-02');
  });

  it('dedupes same Odo within buffer (first wins)', () => {
    const db: Trip[] = [];
    const buffer: BufferTrip[] = [
      buf({ date: '2026-01-01', start_km: 100, end_km: 110, places_visited: 'A' }),
      buf({ date: '2026-01-01', start_km: 100, end_km: 110, places_visited: 'A dup' }),
      buf({ date: '2026-01-02', start_km: 110, end_km: 120, places_visited: 'B' }),
    ];
    const res = computePreservedRows({ bufferRows: buffer, dbTrips: db });
    expect(res.preserved.length).toBe(2);
    expect(res.preserved[0].places_visited).toBe('A'); // first wins
    expect(res.invalidIgnored).toBe(0);
  });

  it('DB wins on same Odo Key (overwrite)', () => {
    const db = [trip({ date: '2026-01-01', start_km: 100, end_km: 110, places_visited: 'DB' })];
    const buffer: BufferTrip[] = [
      buf({ date: '2026-01-01', start_km: 100, end_km: 110, places_visited: 'Buffer same odo' }), // overwriting
      buf({ date: '2026-01-02', start_km: 110, end_km: 120, places_visited: 'Buffer new' }), // preserved
    ];
    const res = computePreservedRows({ bufferRows: buffer, dbTrips: db });
    expect(res.preserved.length).toBe(1);
    expect(res.preserved[0].date).toBe('2026-01-02');
    expect(res.overwritingCount).toBe(1);
  });

  it('preserved rows keep original buffer order', () => {
    const db: Trip[] = [];
    const buffer: BufferTrip[] = [
      buf({ date: '2026-01-03', start_km: 120, end_km: 130, places_visited: 'C' }),
      buf({ date: '2026-01-01', start_km: 100, end_km: 110, places_visited: 'A' }),
      buf({ date: '2026-01-02', start_km: 110, end_km: 120, places_visited: 'B' }),
    ];
    const res = computePreservedRows({ bufferRows: buffer, dbTrips: db });
    expect(res.preserved.map(p => p.date)).toEqual(['2026-01-03', '2026-01-01', '2026-01-02']);
  });

  it('handles empty DB and empty sheet', () => {
    const r1 = computePreservedRows({ bufferRows: [], dbTrips: [] });
    expect(r1.preserved.length).toBe(0);
    expect(r1.invalidIgnored).toBe(0);
    expect(r1.overwritingCount).toBe(0);
    const r2 = computePreservedRows({ bufferRows: [], dbTrips: [trip({})] });
    expect(r2.preserved.length).toBe(0);
    expect(r2.overwritingCount).toBe(0);
  });

  it('integer KM Odo Key dedupes via rounding', () => {
    const db: Trip[] = [];
    const buffer: BufferTrip[] = [
      buf({ date: '2026-01-01', start_km: 100.6, end_km: 110.4, places_visited: 'A' }), // rounds to 101|110
      buf({ date: '2026-01-01', start_km: 101, end_km: 110, places_visited: 'A dup integer' }),
    ];
    const res = computePreservedRows({ bufferRows: buffer, dbTrips: db });
    expect(res.preserved.length).toBe(1);
  });
});

describe('buildPushPayload', () => {
  it('payload is DB sorted + preserved appended at bottom', () => {
    const db = [
      trip({ id: 't2', date: '2026-01-02', start_km: 110, end_km: 120 }),
      trip({ id: 't1', date: '2026-01-01', start_km: 100, end_km: 110 }),
    ];
    const buffer = [
      buf({ date: '2026-01-02', start_km: 110, end_km: 120, places_visited: 'DB same' }), // overwriting
      buf({ date: '2026-01-03', start_km: 120, end_km: 130, places_visited: 'Pending' }),
      buf({ date: '', start_km: 0, end_km: 0, places_visited: '', end_time: '' } as any), // invalid
    ];
    const payload = buildPushPayload({ dbTrips: db, bufferRows: buffer });
    // DB sorted ASC
    expect(payload.rows[0].date).toBe('2026-01-01');
    expect(payload.rows[1].date).toBe('2026-01-02');
    // preserved appended
    expect(payload.rows[2].date).toBe('2026-01-03');
    expect(payload.rows.length).toBe(3);
    expect(payload.preserved.length).toBe(1);
    expect(payload.overwritingCount).toBe(1);
    expect(payload.invalidIgnored).toBe(1);
  });

  it('export with 0 DB rows preserves pending', () => {
    const db: Trip[] = [];
    const buffer = [buf({ date: '2026-01-01', start_km: 100, end_km: 110, places_visited: 'Pending' })];
    const payload = buildPushPayload({ dbTrips: db, bufferRows: buffer });
    expect(payload.rows.length).toBe(1);
    expect(payload.rows[0].places_visited).toBe('Pending');
  });
});

describe('buildDbBufferRows rounding', () => {
  it('preserves Integer KM invariant and 1-dec fuel rounding', () => {
    const db = [trip({ start_km: 100.6, end_km: 110.4, trip_distance: 9.8, fuel_pumped_amount: 12.345 })];
    const rows = buildDbBufferRows(db);
    expect(rows[0].start_km).toBe(101);
    expect(rows[0].end_km).toBe(110);
    expect(rows[0].trip_distance).toBe(10);
    expect(rows[0].fuel_pumped_amount).toBe(12.3);
  });
});
