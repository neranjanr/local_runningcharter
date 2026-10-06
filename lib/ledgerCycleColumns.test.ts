import { describe, it, expect } from 'vitest';
import {
  buildTripCycles,
  computeTripFuelMap,
  buildSide2Columns,
  countLedgerColumnSlots,
  buildCycleStems,
  SPLIT_DAY_THRESHOLD_KM,
} from './ledgerCalculations';
import type { Trip } from '@/types';

function trip(over: Partial<Trip> & { id: string; date: string }): Trip {
  return {
    id: over.id,
    page_id: over.page_id ?? 'p1',
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

describe('day-atom Side 2 columns (ADR-0036)', () => {
  it('exposes the deprecated 40km split threshold for import compat', () => {
    expect(SPLIT_DAY_THRESHOLD_KM).toBe(40);
  });

  it('over-40km date with mid-day pump renders a single column — never splits', () => {
    // Date totals 90km (>40) with a mid-day pump: day-atom keeps one column.
    const trips = [
      trip({ id: 't1', date: '2024-10-21', trip_index: 1, start_km: 0, end_km: 30, trip_distance: 30 }),
      trip({ id: 't2', date: '2024-10-21', trip_index: 2, start_km: 30, end_km: 60, trip_distance: 30, fuel_pumped_amount: 20, pump_timing: 'END' }),
      trip({ id: 't3', date: '2024-10-21', trip_index: 3, start_km: 60, end_km: 90, trip_distance: 30 }),
      trip({ id: 't4', date: '2024-10-22', trip_index: 1, start_km: 90, end_km: 100, trip_distance: 10 }),
    ];
    const cycles = buildTripCycles(trips);
    expect(cycles.length).toBe(2);
    const dateEconomy = new Map([['2024-10-21', 10.5]]);
    const tripEconomy = new Map([['t1', 10.5], ['t2', 10.5], ['t3', 10.5], ['t4', 8.0]]);
    const fuelMap = computeTripFuelMap({ trips, pages: [], dateEconomy, tripEconomy, openingFuel: 30 });
    const cols = buildSide2Columns({ trips, fuelMap });
    const oct21 = cols.filter((c) => c.date === '2024-10-21');
    // One column for the large day, holding every trip of the date.
    expect(oct21.length).toBe(1);
    expect(oct21[0].tripIds).toEqual(['t1', 't2', 't3']);
    expect(oct21[0].tripRange).toBeNull();
    expect(oct21[0].fuelEconomy).toBe(10.5);
    expect(oct21[0].isSplit).toBe(false);
    expect(oct21[0].isCollapsed).toBe(false);
    // Balances chain exactly through the date.
    expect(oct21[0].fuelPosition).toBe(fuelMap.get('t1')!.position);
    expect(oct21[0].balance).toBe(fuelMap.get('t3')!.balance);
    expect(oct21[0].distance).toBe(90);
  });

  it('one column per date with exact balances — no averaged economy, no split marker', () => {
    const trips = [
      trip({ id: 't1', date: '2024-10-21', trip_index: 1, start_km: 0, end_km: 10, trip_distance: 10, fuel_pumped_amount: 10, pump_timing: 'END' }),
      trip({ id: 't2', date: '2024-10-21', trip_index: 2, start_km: 10, end_km: 20, trip_distance: 10, fuel_pumped_amount: 10, pump_timing: 'START' }),
      trip({ id: 't3', date: '2024-10-21', trip_index: 3, start_km: 20, end_km: 30, trip_distance: 10 }),
    ];
    const cycles = buildTripCycles(trips);
    // Day-atom: the date is a single date-delimited cycle however many pumps it holds.
    expect(cycles.length).toBe(1);
    const dateEconomy = new Map([['2024-10-21', 10.5]]);
    const tripEconomy = new Map([['t1', 10.0], ['t2', 8.0], ['t3', 8.0]]);
    const fuelMap = computeTripFuelMap({ trips, pages: [], dateEconomy, tripEconomy, openingFuel: 30 });
    const cols = buildSide2Columns({ trips, fuelMap });
    expect(cols.length).toBe(1);
    const col = cols[0];
    expect(col.date).toBe('2024-10-21');
    expect(col.isSplit).toBe(false);
    expect(col.isCollapsed).toBe(false);
    // Exact balances: position = first trip position, balance = last trip balance
    expect(col.fuelPosition).toBe(fuelMap.get('t1')!.position);
    expect(col.balance).toBe(fuelMap.get('t3')!.balance);
    // Drawn sums exactly
    expect(col.drawn).toBe(20.0);
    // Day-atom economy: the date's mapped economy (first trip), not an average.
    expect(col.fuelEconomy).toBe(10.0);
    // Consumed keeps the column balance exact
    const expectedConsumed = Math.round((col.fuelPosition + col.inTank + col.drawn - col.balance) * 10) / 10;
    expect(col.consumed).toBe(expectedConsumed);
  });

  it('unsplit dates render one column each with no split flags', () => {
    const trips = [
      trip({ id: 't1', date: '2024-10-21', trip_index: 1, start_km: 0, end_km: 10, trip_distance: 10 }),
      trip({ id: 't2', date: '2024-10-22', trip_index: 1, start_km: 10, end_km: 20, trip_distance: 10 }),
    ];
    const fuelMap = computeTripFuelMap({
      trips,
      pages: [],
      dateEconomy: new Map([['2024-10-21', 10.5]]),
      openingFuel: 30,
    });
    const cols = buildSide2Columns({ trips, fuelMap });
    expect(cols.length).toBe(2);
    expect(cols.every((c) => !c.isSplit && !c.isCollapsed)).toBe(true);
  });

  it('ledger columns consume one day-slot per date — large days never split', () => {
    // 4 dates = 4 slots even though 2024-10-24 totals 90 km with a mid-day pump.
    const trips = [
      trip({ id: 'a1', date: '2024-10-21', trip_index: 1, start_km: 0, end_km: 10, trip_distance: 10 }),
      trip({ id: 'a2', date: '2024-10-22', trip_index: 1, start_km: 10, end_km: 20, trip_distance: 10 }),
      trip({ id: 'a3', date: '2024-10-23', trip_index: 1, start_km: 20, end_km: 30, trip_distance: 10 }),
      trip({ id: 'b1', date: '2024-10-24', trip_index: 1, start_km: 30, end_km: 60, trip_distance: 30 }),
      trip({ id: 'b2', date: '2024-10-24', trip_index: 2, start_km: 60, end_km: 90, trip_distance: 30, fuel_pumped_amount: 20, pump_timing: 'END' }),
      trip({ id: 'b3', date: '2024-10-24', trip_index: 3, start_km: 90, end_km: 120, trip_distance: 30 }),
    ];
    expect(countLedgerColumnSlots(trips)).toBe(4);
    const small = [
      trip({ id: 's1', date: '2024-10-21', trip_index: 1, start_km: 0, end_km: 10, trip_distance: 10, fuel_pumped_amount: 10, pump_timing: 'END' }),
      trip({ id: 's2', date: '2024-10-21', trip_index: 2, start_km: 10, end_km: 20, trip_distance: 10, fuel_pumped_amount: 10, pump_timing: 'START' }),
      trip({ id: 's3', date: '2024-10-21', trip_index: 3, start_km: 20, end_km: 30, trip_distance: 10 }),
    ];
    expect(countLedgerColumnSlots(small)).toBe(1);
  });

  it('trend draws one stem per date even with a mid-day pump', () => {
    const trips = [
      trip({ id: 't1', date: '2024-10-21', trip_index: 1, start_km: 0, end_km: 30, trip_distance: 30 }),
      trip({ id: 't2', date: '2024-10-21', trip_index: 2, start_km: 30, end_km: 60, trip_distance: 30, fuel_pumped_amount: 20, pump_timing: 'END' }),
      trip({ id: 't3', date: '2024-10-21', trip_index: 3, start_km: 60, end_km: 90, trip_distance: 30 }),
    ];
    const dateEconomy = new Map([['2024-10-21', 10.5]]);
    const tripEconomy = new Map([['t1', 10.5], ['t2', 10.5], ['t3', 10.5]]);
    const fuelMap = computeTripFuelMap({ trips, pages: [], dateEconomy, tripEconomy, openingFuel: 30 });
    const stems = buildCycleStems({ trips, fuelMap });
    // Day-atom: a single stem for the date.
    expect(stems.length).toBe(1);
    expect(stems[0].date).toBe('2024-10-21');
    expect(stems[0].economy).toBe(10.5);
    expect(stems[0].tripRange).toBeNull();
  });
});
