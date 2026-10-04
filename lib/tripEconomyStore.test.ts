import { describe, it, expect, beforeEach } from 'vitest';
import {
  getTripEconomyOverride,
  saveTripEconomyOverride,
  getAllTripEconomyOverrides,
  clearAllTripEconomies,
  backfillTripEconomiesFromPerDay,
  resolveTripEconomies,
} from './tripEconomyStore';
import { propagateFuelEconomy } from './ledgerCalculations';
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
    clearAllTripEconomies();
  }
  clearAllTripEconomies();
});

describe('tripEconomyStore per-trip overrides (issue #7)', () => {
  it('empty overrides inherit with fallback at book start', () => {
    const trips = [
      makeTrip({ id: 't1', date: '2024-10-21', page_id: 'p1', trip_index: 1 }),
      makeTrip({ id: 't2', date: '2024-10-21', page_id: 'p1', trip_index: 2 }),
      makeTrip({ id: 't3', date: '2024-10-22', page_id: 'p1', trip_index: 1 }),
    ];
    const resolved = resolveTripEconomies(trips, {}, 10.5);
    expect(resolved.get('t1')).toBe(10.5);
    expect(resolved.get('t2')).toBe(10.5);
    expect(resolved.get('t3')).toBe(10.5);
  });

  it('explicit override propagates forward in trip order', () => {
    const trips = [
      makeTrip({ id: 't1', date: '2024-10-21', page_id: 'p1', trip_index: 1 }),
      makeTrip({ id: 't2', date: '2024-10-21', page_id: 'p1', trip_index: 2 }),
      makeTrip({ id: 't3', date: '2024-10-22', page_id: 'p1', trip_index: 1 }),
    ];
    saveTripEconomyOverride('t2', 10.8);
    expect(getTripEconomyOverride('t2')).toBe(10.8);
    const resolved = resolveTripEconomies(trips, getAllTripEconomyOverrides(), 10.5);
    expect(resolved.get('t1')).toBe(10.5);
    expect(resolved.get('t2')).toBe(10.8);
    expect(resolved.get('t3')).toBe(10.8);
  });

  it('backfill copies each date stored value onto every trip of that date', () => {
    const trips = [
      makeTrip({ id: 't1', date: '2024-10-21', page_id: 'p1', trip_index: 1 }),
      makeTrip({ id: 't2', date: '2024-10-21', page_id: 'p1', trip_index: 2 }),
      makeTrip({ id: 't3', date: '2024-10-22', page_id: 'p1', trip_index: 1 }),
      makeTrip({ id: 't4', date: '2024-10-23', page_id: 'p1', trip_index: 1 }),
    ];
    // per-day raw: day1 explicit 10.5, day2 null, day3 explicit 10.8
    // (dates: 21 -> 10.5, 22 -> null, 23 -> 10.8)
    const getEconomies = (pageId: string) => (pageId === 'p1' ? [10.5, null, 10.8] : []);
    const { copied } = backfillTripEconomiesFromPerDay(trips, getEconomies);
    expect(copied).toBe(3); // t1, t2 (10.5) + t4 (10.8); t3 stays empty (inherit)
    expect(getTripEconomyOverride('t1')).toBe(10.5);
    expect(getTripEconomyOverride('t2')).toBe(10.5);
    expect(getTripEconomyOverride('t3')).toBeNull();
    expect(getTripEconomyOverride('t4')).toBe(10.8);
  });

  it('backfill does not overwrite existing trip overrides', () => {
    const trips = [
      makeTrip({ id: 't1', date: '2024-10-21', page_id: 'p1', trip_index: 1 }),
      makeTrip({ id: 't2', date: '2024-10-21', page_id: 'p1', trip_index: 2 }),
    ];
    saveTripEconomyOverride('t1', 9.9);
    const getEconomies = () => [10.5];
    backfillTripEconomiesFromPerDay(trips, getEconomies);
    expect(getTripEconomyOverride('t1')).toBe(9.9);
    expect(getTripEconomyOverride('t2')).toBe(10.5);
  });

  it('display-neutral: backfilled trip resolution matches per-day propagation expanded to trips', () => {
    const trips = [
      makeTrip({ id: 't1', date: '2024-10-21', page_id: 'p1', trip_index: 1 }),
      makeTrip({ id: 't2', date: '2024-10-21', page_id: 'p1', trip_index: 2 }),
      makeTrip({ id: 't3', date: '2024-10-22', page_id: 'p1', trip_index: 1 }),
      makeTrip({ id: 't4', date: '2024-10-23', page_id: 'p1', trip_index: 1 }),
      makeTrip({ id: 't5', date: '2024-10-23', page_id: 'p1', trip_index: 2 }),
      makeTrip({ id: 't6', date: '2024-10-24', page_id: 'p1', trip_index: 1 }),
    ];
    const perDayRaw: (number | null)[] = [10.5, null, 10.8, null];
    const propagated = propagateFuelEconomy(perDayRaw, 10.5);
    // expand per-day propagated to trips
    const dates = ['2024-10-21', '2024-10-22', '2024-10-23', '2024-10-24'];
    const expectedByTrip = new Map<string, number>();
    for (const t of trips) expectedByTrip.set(t.id, propagated[dates.indexOf(t.date)]);

    clearAllTripEconomies();
    backfillTripEconomiesFromPerDay(trips, () => perDayRaw);
    const resolved = resolveTripEconomies(trips, getAllTripEconomyOverrides(), 10.5);
    for (const t of trips) expect(resolved.get(t.id)).toBe(expectedByTrip.get(t.id));
  });
});
