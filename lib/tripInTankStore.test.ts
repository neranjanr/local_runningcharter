import { describe, it, expect, beforeEach } from 'vitest';
import {
  getTripInTank,
  saveTripInTank,
  getAllTripInTanks,
  getTripInTankMap,
  clearAllTripInTanks,
  backfillTripInTanksFromPerDay,
} from './tripInTankStore';
import type { Trip } from '@/types';

function makeTrip(overrides: Partial<Trip> & { id: string; date: string; page_id: string }): Trip {
  return {
    vehicle_id: 'veh-1',
    day_index: 1,
    trip_index: 1,
    start_time: '08:00',
    end_time: '09:00',
    start_km: 100,
    end_km: 110,
    trip_distance: 10,
    trip_type: 'Official',
    places_visited: 'A -> B',
    fuel_pumped_amount: 0,
    fuel_order_no: '',
    created_at: new Date().toISOString(),
    ...overrides,
  } as Trip;
}

beforeEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    clearAllTripInTanks();
  }
  clearAllTripInTanks();
});

describe('tripInTankStore per-trip inputs (issue #10)', () => {
  it('untouched trips default to zero', () => {
    expect(getTripInTank('nope')).toBe(0);
    expect(getTripInTankMap().size).toBe(0);
  });

  it('saves per-trip litres rounded to 1 decimal', () => {
    saveTripInTank('t1', 5.24);
    expect(getTripInTank('t1')).toBe(5.2);
    saveTripInTank('t2', 3);
    expect(getTripInTankMap().get('t2')).toBe(3);
  });

  it('zero, null, negative, and NaN clear the entry back to default zero', () => {
    saveTripInTank('t1', 5);
    expect(getTripInTank('t1')).toBe(5);
    saveTripInTank('t1', 0);
    expect(getTripInTank('t1')).toBe(0);
    saveTripInTank('t1', 4);
    saveTripInTank('t1', null);
    expect(getTripInTank('t1')).toBe(0);
    saveTripInTank('t1', 4);
    saveTripInTank('t1', -2);
    expect(getTripInTank('t1')).toBe(0);
    saveTripInTank('t1', 4);
    saveTripInTank('t1', NaN);
    expect(getTripInTank('t1')).toBe(0);
    expect(getAllTripInTanks()).toEqual({});
  });

  it('backfills a per-day value onto the first trip of its date only', () => {
    const trips = [
      makeTrip({ id: 't1', date: '2024-10-21', page_id: 'p1', trip_index: 1 }),
      makeTrip({ id: 't2', date: '2024-10-21', page_id: 'p1', trip_index: 2 }),
      makeTrip({ id: 't3', date: '2024-10-22', page_id: 'p1', trip_index: 1 }),
    ];
    const res = backfillTripInTanksFromPerDay(trips, (pid) =>
      pid === 'p1' ? [5, 0] : []
    );
    expect(res.copied).toBe(1);
    expect(getTripInTank('t1')).toBe(5);
    expect(getTripInTank('t2')).toBe(0);
    expect(getTripInTank('t3')).toBe(0);
  });

  it('backfill never overwrites an existing per-trip entry', () => {
    const trips = [
      makeTrip({ id: 't1', date: '2024-10-21', page_id: 'p1', trip_index: 1 }),
      makeTrip({ id: 't2', date: '2024-10-21', page_id: 'p1', trip_index: 2 }),
    ];
    saveTripInTank('t1', 7);
    const res = backfillTripInTanksFromPerDay(trips, () => [5]);
    expect(getTripInTank('t1')).toBe(7);
    expect(res.skipped).toBeGreaterThanOrEqual(1);
  });

  it('backfill with no legacy values copies nothing', () => {
    const trips = [makeTrip({ id: 't1', date: '2024-10-21', page_id: 'p1', trip_index: 1 })];
    const res = backfillTripInTanksFromPerDay(trips, () => []);
    expect(res.copied).toBe(0);
    expect(getTripInTankMap().size).toBe(0);
  });
});
