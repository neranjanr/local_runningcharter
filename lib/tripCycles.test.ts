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

describe('buildTripCycles (day-atom, ADR-0036)', () => {
  it('fuel-in date closes its segment by default — pump timing ignored', () => {
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
    // Day-atom: one Date never splits — START no longer migrates the trip.
    // Cycle 1: [t1, t2] (closed by the 10-21 fuel-in), Cycle 2: [t3].
    expect(cycles.length).toBe(2);
    expect(cycles[0].map((t) => t.id)).toEqual(['t1', 't2']);
    expect(cycles[1].map((t) => t.id)).toEqual(['t3']);
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

  it('same-day multiple pumps stay in a single date-delimited cycle', () => {
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
    // Day-atom: one Date never splits, however many pumps it holds.
    expect(cycles.length).toBe(1);
    expect(cycles[0].map((t) => t.id)).toEqual(['t1', 't2', 't3']);
  });

  it('ownership next moves the fuel-in date into the following segment', () => {
    const trips = [
      trip({ id: 't1', date: '2024-10-21', trip_index: 1, trip_distance: 10 }),
      trip({
        id: 't2',
        date: '2024-10-21',
        trip_index: 2,
        trip_distance: 10,
        fuel_pumped_amount: 20,
      }),
      trip({ id: 't3', date: '2024-10-22', trip_index: 1, trip_distance: 10 }),
    ];
    const cycles = buildTripCycles(trips, new Map([['2024-10-21', 'next']]));
    expect(cycles.length).toBe(1);
    expect(cycles[0].map((t) => t.id)).toEqual(['t1', 't2', 't3']);
    // ...while default previous-join keeps the date closing its own segment.
    const def = buildTripCycles(trips);
    expect(def.map((c) => c.map((t) => t.id))).toEqual([['t1', 't2'], ['t3']]);
  });
});

describe('computeTripFuelMap day-atom economies (ADR-0036)', () => {
  it('pump timing no longer changes economy — one economy per date', () => {
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
    // t1 and t2 share the 10-21 date economy; t3 uses 10-22.
    expect(m.get('t1')?.economy).toBe(10.5);
    expect(m.get('t2')?.economy).toBe(10.5);
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

  it('editing one trip writes its whole date-delimited segment; clearing inherits again', () => {
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

  it('balances match hand-computed day-atom arithmetic (timing ignored)', () => {
    // opening 30, 105 km trips: consumed = round(105 / econ, 1)
    // t1: 105 km @ 10.5 -> 10.0 consumed -> balance 20.0
    const base = { start_km: 0, end_km: 105, trip_distance: 105 };
    const mk = (timing: 'START' | 'END') => [
      trip({ id: 't1', date: '2024-10-21', trip_index: 1, ...base, start_km: 0, end_km: 105 }),
      trip({
        id: 't2',
        date: '2024-10-21',
        trip_index: 2,
        start_km: 105,
        end_km: 210,
        trip_distance: 105,
        fuel_pumped_amount: 20,
        pump_timing: timing,
      }),
    ];
    const dateEconomy = new Map([['2024-10-21', 10.5]]);
    const tripEconomy = new Map([['t1', 10.5], ['t2', 8.0]]);
    for (const timing of ['START', 'END'] as const) {
      const m = computeTripFuelMap({
        trips: mk(timing),
        pages: [],
        dateEconomy,
        tripEconomy,
        openingFuel: 30,
      });
      // t1: 30 - 10.0 = 20.0 ; t2 @8.0 (explicit override): 20 - 13.1 + 20 = 26.9
      // Pump timing changes nothing — fuel is added after the pumping trip.
      expect(m.get('t1')?.balance).toBe(20.0);
      expect(m.get('t2')?.balance).toBe(26.9);
      expect(m.get('t2')?.economy).toBe(8.0);
    }
  });
});
