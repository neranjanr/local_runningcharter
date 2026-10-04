import { describe, it, expect, beforeEach } from 'vitest';
import { buildTripCycles, computeTripFuelMap } from './ledgerCalculations';
import {
  clearAllTripEconomies,
  getTripEconomyOverride,
  saveTripCycleOverride,
} from './tripEconomyStore';
import type { Trip } from '@/types';

beforeEach(() => {
  try {
    window.localStorage.clear();
  } catch {}
  clearAllTripEconomies();
});

function trip(over: Partial<Trip> & { id: string; date: string }): Trip {
  return {
    id: over.id,
    page_id: 'p1',
    vehicle_id: 'veh-1',
    date: over.date,
    day_index: 1,
    trip_index: over.trip_index ?? 1,
    start_time: '08:00',
    end_time: '09:00',
    start_km: over.start_km ?? 0,
    end_km: over.end_km ?? 0,
    trip_distance: over.trip_distance ?? 10,
    trip_type: 'Official',
    places_visited: 'A -> B',
    fuel_pumped_amount: over.fuel_pumped_amount ?? 0,
    fuel_order_no: over.fuel_order_no ?? '',
    is_full_tank: over.is_full_tank ?? false,
    pump_timing: over.pump_timing ?? 'END',
    created_at: new Date().toISOString(),
  } as Trip;
}

describe('buildTripCycles (issue #8)', () => {
  it('START pump puts the pumped trip in the next cycle at any distance (19 km)', () => {
    const trips = [
      trip({ id: 't1', date: '2024-10-21', trip_index: 1, trip_distance: 10 }),
      trip({
        id: 't2',
        date: '2024-10-21',
        trip_index: 2,
        trip_distance: 19,
        fuel_pumped_amount: 66,
        pump_timing: 'START',
      }),
      trip({ id: 't3', date: '2024-10-22', trip_index: 1, trip_distance: 10 }),
    ];
    const cycles = buildTripCycles(trips);
    // Cycle 1: [t1], Cycle 2: [t2, t3] — pumped trip opens the next cycle
    expect(cycles.length).toBe(2);
    expect(cycles[0].map((t) => t.id)).toEqual(['t1']);
    expect(cycles[1].map((t) => t.id)).toEqual(['t2', 't3']);
  });

  it('END pump keeps the pumped trip in the previous cycle', () => {
    const trips = [
      trip({ id: 't1', date: '2024-10-21', trip_index: 1, trip_distance: 10 }),
      trip({
        id: 't2',
        date: '2024-10-21',
        trip_index: 2,
        trip_distance: 19,
        fuel_pumped_amount: 20,
        pump_timing: 'END',
      }),
      trip({ id: 't3', date: '2024-10-22', trip_index: 1, trip_distance: 10 }),
    ];
    const cycles = buildTripCycles(trips);
    // Cycle 1: [t1, t2], Cycle 2: [t3]
    expect(cycles.length).toBe(2);
    expect(cycles[0].map((t) => t.id)).toEqual(['t1', 't2']);
    expect(cycles[1].map((t) => t.id)).toEqual(['t3']);
  });

  it('same-day multiple pumps open separate cycles with no collapsing', () => {
    const trips = [
      trip({
        id: 't1',
        date: '2024-10-21',
        trip_index: 1,
        trip_distance: 10,
        fuel_pumped_amount: 10,
        pump_timing: 'END',
      }),
      trip({
        id: 't2',
        date: '2024-10-21',
        trip_index: 2,
        trip_distance: 10,
        fuel_pumped_amount: 10,
        pump_timing: 'START',
      }),
      trip({ id: 't3', date: '2024-10-21', trip_index: 3, trip_distance: 10 }),
    ];
    const cycles = buildTripCycles(trips);
    // t1 END stays in cycle 1; t2 START opens cycle 2 -> 3 cycles... actually:
    // [t1] | [t2, t3]? No — t1 END boundary after t1, t2 START boundary before t2.
    // t1 is a boundary (END: [t1] then rest), t2 is a boundary (START: new cycle at t2).
    // Result: [t1], [t2, t3] — two pumped trips but t1's cycle is [t1] alone and
    // t2 opens the next cycle. If t1 were START it would differ; here both pumps
    // are respected as boundaries (no collapse into one range).
    expect(cycles.length).toBe(2);
    expect(cycles[0].map((t) => t.id)).toEqual(['t1']);
    expect(cycles[1].map((t) => t.id)).toEqual(['t2', 't3']);
    // And with two END pumps on the same date each still splits:
    const trips2 = [
      trip({ id: 'a1', date: '2024-10-21', trip_index: 1, trip_distance: 10, fuel_pumped_amount: 10, pump_timing: 'END' }),
      trip({ id: 'a2', date: '2024-10-21', trip_index: 2, trip_distance: 10, fuel_pumped_amount: 10, pump_timing: 'END' }),
      trip({ id: 'a3', date: '2024-10-21', trip_index: 3, trip_distance: 10 }),
    ];
    const cycles2 = buildTripCycles(trips2);
    expect(cycles2.length).toBe(3);
    expect(cycles2.map((c) => c.map((t) => t.id))).toEqual([['a1'], ['a2'], ['a3']]);
  });
});

describe('computeTripFuelMap trip-delimited economies (issue #8)', () => {
  it('START pump trip uses the next cycle economy regardless of distance', () => {
    const trips = [
      trip({ id: 't1', date: '2024-10-21', trip_index: 1, trip_distance: 10, start_km: 0, end_km: 10 }),
      trip({
        id: 't2',
        date: '2024-10-21',
        trip_index: 2,
        trip_distance: 19,
        start_km: 10,
        end_km: 29,
        fuel_pumped_amount: 20,
        pump_timing: 'START',
      }),
      trip({ id: 't3', date: '2024-10-22', trip_index: 1, trip_distance: 10, start_km: 29, end_km: 39 }),
    ];
    const dateEconomy = new Map([
      ['2024-10-21', 10.5],
      ['2024-10-22', 8.0],
    ]);
    const m = computeTripFuelMap({ trips, pages: [], dateEconomy, openingFuel: 30 });
    // t1 previous cycle, t2 START joins next cycle even at 19 km
    expect(m.get('t1')?.economy).toBe(10.5);
    expect(m.get('t2')?.economy).toBe(8.0);
    expect(m.get('t3')?.economy).toBe(8.0);
  });

  it('END pump trip keeps the previous cycle economy', () => {
    const trips = [
      trip({ id: 't1', date: '2024-10-21', trip_index: 1, trip_distance: 10, start_km: 0, end_km: 10 }),
      trip({
        id: 't2',
        date: '2024-10-21',
        trip_index: 2,
        trip_distance: 19,
        start_km: 10,
        end_km: 29,
        fuel_pumped_amount: 20,
        pump_timing: 'END',
      }),
      trip({ id: 't3', date: '2024-10-22', trip_index: 1, trip_distance: 10, start_km: 29, end_km: 39 }),
    ];
    const dateEconomy = new Map([
      ['2024-10-21', 10.5],
      ['2024-10-22', 8.0],
    ]);
    const m = computeTripFuelMap({ trips, pages: [], dateEconomy, openingFuel: 30 });
    expect(m.get('t1')?.economy).toBe(10.5);
    expect(m.get('t2')?.economy).toBe(10.5);
    expect(m.get('t3')?.economy).toBe(8.0);
  });

  it('trips after a same-date pump show the next cycle economy', () => {
    const trips = [
      trip({ id: 't1', date: '2024-10-21', trip_index: 1, trip_distance: 10, start_km: 0, end_km: 10 }),
      trip({
        id: 't2',
        date: '2024-10-21',
        trip_index: 2,
        trip_distance: 10,
        start_km: 10,
        end_km: 20,
        fuel_pumped_amount: 15,
        pump_timing: 'END',
      }),
      trip({ id: 't3', date: '2024-10-21', trip_index: 3, trip_distance: 10, start_km: 20, end_km: 30 }),
    ];
    const dateEconomy = new Map([
      ['2024-10-21', 10.5],
      ['2024-10-22', 8.0],
    ]);
    // Per-trip overrides: t3 carries the next-cycle economy explicitly
    const tripEconomy = new Map([
      ['t1', 10.5],
      ['t2', 10.5],
      ['t3', 8.0],
    ]);
    const m = computeTripFuelMap({ trips, pages: [], dateEconomy, tripEconomy, openingFuel: 30 });
    expect(m.get('t1')?.economy).toBe(10.5);
    expect(m.get('t2')?.economy).toBe(10.5);
    expect(m.get('t3')?.economy).toBe(8.0);
  });

  it('editing one trip writes its whole cycle; clearing inherits again', () => {
    const trips = [
      trip({ id: 't1', date: '2024-10-21', trip_index: 1, trip_distance: 10 }),
      trip({
        id: 't2',
        date: '2024-10-21',
        trip_index: 2,
        trip_distance: 10,
        fuel_pumped_amount: 20,
        pump_timing: 'END',
      }),
      trip({ id: 't3', date: '2024-10-22', trip_index: 1, trip_distance: 10 }),
    ];
    const affected = saveTripCycleOverride(trips, 't1', 9.5);
    expect(affected.sort()).toEqual(['t1', 't2']);
    expect(getTripEconomyOverride('t1')).toBe(9.5);
    expect(getTripEconomyOverride('t2')).toBe(9.5);
    expect(getTripEconomyOverride('t3')).toBeNull();
    saveTripCycleOverride(trips, 't2', null);
    expect(getTripEconomyOverride('t1')).toBeNull();
    expect(getTripEconomyOverride('t2')).toBeNull();
  });

  it('balances match hand-computed START vs END arithmetic', () => {
    // opening 30, 105 km trips: consumed = round(105 / econ, 1)
    // t1: 105 km @ 10.5 -> 10.0 consumed -> balance 20.0
    const base = { start_km: 0, end_km: 105, trip_distance: 105 };
    const mkStart = () => [
      trip({ id: 't1', date: '2024-10-21', trip_index: 1, ...base, start_km: 0, end_km: 105 }),
      trip({
        id: 't2',
        date: '2024-10-21',
        trip_index: 2,
        start_km: 105,
        end_km: 210,
        trip_distance: 105,
        fuel_pumped_amount: 20,
        pump_timing: 'START',
      }),
    ];
    const dateEconomy = new Map([['2024-10-21', 10.5]]);
    const tripEconomy = new Map([['t1', 10.5], ['t2', 8.0]]);
    const mStart = computeTripFuelMap({
      trips: mkStart(),
      pages: [],
      dateEconomy,
      tripEconomy,
      openingFuel: 30,
    });
    // t1: 30 - 10.0 = 20.0 ; t2 START: (20 + 20) - round(105/8=13.125->13.1) = 26.9
    expect(mStart.get('t1')?.balance).toBe(20.0);
    expect(mStart.get('t2')?.balance).toBe(26.9);
    expect(mStart.get('t2')?.economy).toBe(8.0);

    const mkEnd = () => [
      trip({ id: 't1', date: '2024-10-21', trip_index: 1, start_km: 0, end_km: 105, trip_distance: 105 }),
      trip({
        id: 't2',
        date: '2024-10-21',
        trip_index: 2,
        start_km: 105,
        end_km: 210,
        trip_distance: 105,
        fuel_pumped_amount: 20,
        pump_timing: 'END',
      }),
    ];
    const tripEconomyEnd = new Map([['t1', 10.5], ['t2', 10.5]]);
    const mEnd = computeTripFuelMap({
      trips: mkEnd(),
      pages: [],
      dateEconomy,
      tripEconomy: tripEconomyEnd,
      openingFuel: 30,
    });
    // t1: 20.0 ; t2 END @10.5: consumed 10.0 -> (20 - 10.0) + 20 = 30.0
    expect(mEnd.get('t1')?.balance).toBe(20.0);
    expect(mEnd.get('t2')?.balance).toBe(30.0);
    expect(mEnd.get('t2')?.economy).toBe(10.5);
  });
});
