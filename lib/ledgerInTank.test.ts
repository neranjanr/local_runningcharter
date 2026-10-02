import { describe, it, expect } from 'vitest';
import { calculateBalance, calculateConsumed } from './pagination';
import { computeLedgerDays, computeLedgerSummary } from './ledgerCalculations';
import type { BookPage, Trip } from '@/types';

function makeTrip(overrides: Partial<Trip> & { date: string; page_id: string }): Trip {
  const base: Trip = {
    id: `trip-${Math.random().toString(36).slice(2, 6)}`,
    vehicle_id: overrides.vehicle_id ?? 'veh-1',
    page_id: overrides.page_id,
    date: overrides.date,
    day_index: overrides.day_index ?? 1,
    trip_index: overrides.trip_index ?? 1,
    start_time: overrides.start_time ?? '08:00',
    end_time: overrides.end_time ?? '09:00',
    start_km: overrides.start_km ?? 100,
    end_km: overrides.end_km ?? 110,
    trip_distance: overrides.trip_distance ?? 10,
    trip_type: overrides.trip_type ?? 'Official',
    places_visited: overrides.places_visited ?? 'A -> B',
    fuel_pumped_amount: overrides.fuel_pumped_amount ?? 0,
    fuel_order_no: overrides.fuel_order_no ?? '',
    created_at: overrides.created_at ?? new Date().toISOString(),
  };
  return { ...base, ...overrides };
}
function makePage(overrides: Partial<BookPage>): BookPage {
  return {
    id: overrides.id ?? `page-${overrides.page_number ?? 1}`,
    vehicle_id: 'veh-1',
    page_number: overrides.page_number ?? 1,
    month: overrides.month ?? '2024-10',
    start_km: overrides.start_km ?? 100,
    end_km: overrides.end_km ?? 200,
    start_fuel_balance: overrides.start_fuel_balance ?? 30,
    end_fuel_balance: overrides.end_fuel_balance ?? 25,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('Fuel model with In-Tank (Issue 03)', () => {
  it('calculateBalance implements Closing = Position + InTank + Drawn - Consumed rounded 1 dec', () => {
    expect(calculateBalance(31.4, 0, 6.0, 0)).toBe(25.4);
    expect(calculateBalance(31.4, 0, 5.9, 0)).toBe(25.5);
    // With In-Tank 5.0
    expect(calculateBalance(31.4, 0, 6.0, 5.0)).toBe(30.4);
    expect(calculateBalance(25.5, 35.0, 6.2, 2.0)).toBe(56.3); // 25.5+2+35-6.2=56.3
    expect(calculateBalance(10, 5, 2, 0)).toBe(13.0);
    expect(calculateBalance(10, 5, 2, 3)).toBe(16.0);
  });

  it('computeLedgerDays default In-Tank 0 matches legacy closing', () => {
    const page = makePage({ id: 'page-1', start_fuel_balance: 10, start_km: 100, end_km: 200 });
    const trips = [
      makeTrip({ date: '2024-10-21', page_id: 'page-1', trip_distance: 60, start_km: 100, end_km: 160, fuel_pumped_amount: 0 }),
      makeTrip({ date: '2024-10-22', page_id: 'page-1', trip_distance: 65, start_km: 160, end_km: 225, fuel_pumped_amount: 35, fuel_order_no: 'FO-1' }),
    ];
    const days = computeLedgerDays({ page, trips, economies: [10.5, null] });
    // Day1: pos10, distance60, consumed 5.7 (60/10.5=5.714), drawn0,inTank0 => 10-5.7=4.3
    expect(days[0].inTank).toBe(0);
    expect(days[0].fuelPosition).toBe(10);
    expect(days[0].consumed).toBe(calculateConsumed(60, 10.5));
    expect(days[0].balance).toBe(calculateBalance(10, 0, days[0].consumed, 0));
    // Day2 pos = prev balance
    expect(days[1].fuelPosition).toBe(days[0].balance);
    expect(days[1].inTank).toBe(0);
    expect(days[1].balance).toBe(calculateBalance(days[1].fuelPosition, 35, days[1].consumed, 0));
  });

  it('computeLedgerDays with typed In-Tank adds to closing', () => {
    const page = makePage({ id: 'page-1', start_fuel_balance: 31.4 });
    const trips = [
      makeTrip({ date: '2024-10-21', page_id: 'page-1', trip_distance: 62, start_km: 100, end_km: 162, fuel_pumped_amount: 0 }),
      makeTrip({ date: '2024-10-22', page_id: 'page-1', trip_distance: 65, start_km: 162, end_km: 227, fuel_pumped_amount: 35 }),
    ];
    const daysNoInTank = computeLedgerDays({ page, trips, economies: [10.5, null], inTanks: [0, 0] });
    const daysWithInTank = computeLedgerDays({ page, trips, economies: [10.5, null], inTanks: [5, 2] });
    // Day1 with 5 L inTank: 31.4+5-5.9=30.5 vs 25.5 without
    expect(daysNoInTank[0].balance).toBe(25.5);
    expect(daysWithInTank[0].balance).toBe(30.5);
    // Day2 position = prev balance, plus inTank 2
    // Day2 no inTank: 25.5+35-6.2=54.3 ; with inTank sequence: 30.5 pos +2 +35 -6.2 =61.3
    expect(daysNoInTank[1].balance).toBe(54.3);
    expect(daysWithInTank[1].balance).toBe(61.3);
    expect(daysWithInTank[1].inTank).toBe(2);
  });

  it('fuel economy propagation inherited/explicit/fallback still works with new formula', () => {
    const page = makePage({ id: 'page-1', start_fuel_balance: 20 });
    const trips = [
      makeTrip({ date: '2024-10-21', page_id: 'page-1', trip_distance: 50, start_km: 0, end_km: 50 }),
      makeTrip({ date: '2024-10-22', page_id: 'page-1', trip_distance: 50, start_km: 50, end_km: 100 }),
      makeTrip({ date: '2024-10-23', page_id: 'page-1', trip_distance: 54, start_km: 100, end_km: 154 }),
    ];
    // economies: [null,10.8,null] -> fallback 10.5 for day1, explicit 10.8 day2, inherited day3
    const days = computeLedgerDays({ page, trips, economies: [null, 10.8, null], inTanks: [0, 0, 1] });
    expect(days[0].fuelEconomy).toBe(10.5);
    expect(days[0].economySource).toBe('fallback');
    expect(days[0].consumed).toBe(calculateConsumed(50, 10.5));
    expect(days[1].fuelEconomy).toBe(10.8);
    expect(days[1].economySource).toBe('explicit');
    expect(days[2].fuelEconomy).toBe(10.8);
    expect(days[2].economySource).toBe('inherited');
    // Closing reflects inTank 1 on day3
    const expectedDay3Bal = calculateBalance(days[2].fuelPosition, 0, days[2].consumed, 1);
    expect(days[2].balance).toBe(expectedDay3Bal);
  });

  it('Transposed totals equal row-based totals (weighted economy, final balance)', () => {
    const page = makePage({ id: 'page-14', start_fuel_balance: 31.4, start_km: 142684, end_km: 142875 });
    const trips = [
      makeTrip({ date: '2024-10-21', page_id: 'page-14', trip_index: 1, start_km: 142684, end_km: 142708, trip_distance: 24 }),
      makeTrip({ date: '2024-10-21', page_id: 'page-14', trip_index: 2, start_km: 142708, end_km: 142729, trip_distance: 21 }),
      makeTrip({ date: '2024-10-21', page_id: 'page-14', trip_index: 3, start_km: 142729, end_km: 142746, trip_distance: 17, trip_type: 'Private' }),
      makeTrip({ date: '2024-10-22', page_id: 'page-14', trip_index: 1, start_km: 142746, end_km: 142765, trip_distance: 18, fuel_pumped_amount: 35.0, fuel_order_no: '#FO-88912' }),
      makeTrip({ date: '2024-10-22', page_id: 'page-14', trip_index: 2, start_km: 142765, end_km: 142782, trip_distance: 17 }),
      makeTrip({ date: '2024-10-22', page_id: 'page-14', trip_index: 3, start_km: 142782, end_km: 142799, trip_distance: 18 }),
      makeTrip({ date: '2024-10-22', page_id: 'page-14', trip_index: 4, start_km: 142799, end_km: 142812, trip_distance: 12 }),
      makeTrip({ date: '2024-10-23', page_id: 'page-14', trip_index: 1, start_km: 142812, end_km: 142833, trip_distance: 21 }),
      makeTrip({ date: '2024-10-23', page_id: 'page-14', trip_index: 2, start_km: 142833, end_km: 142850, trip_distance: 17 }),
      makeTrip({ date: '2024-10-24', page_id: 'page-14', trip_index: 1, start_km: 142850, end_km: 142875, trip_distance: 25 }),
    ];
    const days = computeLedgerDays({ page, trips, economies: [10.5, null, 10.8, null], inTanks: [0, 0, 2, 0] });
    const summary = computeLedgerSummary(days);
    // Verify transposed column sums: totalDrawn = sum drawn, totalDistance = sum distances, totalConsumed = sum consumed
    expect(summary.totalDistance).toBe(days.reduce((s, d) => s + d.distance, 0));
    expect(summary.totalDrawn).toBe(35.0);
    // Day3 has inTank 2, so its balance = prev +2 -consumed
    const day3 = days[2];
    expect(day3.inTank).toBe(2);
    expect(day3.balance).toBe(calculateBalance(day3.fuelPosition, day3.drawn, day3.consumed, 2));
    // Weighted economy unchanged by inTank
    const manualWeighted = Math.round((summary.totalDistance / summary.totalConsumed) * 10) / 10;
    expect(summary.weightedEconomy).toBe(manualWeighted);
  });

  it('Full tank trip sets balance to tankCapacity (e.g. 75L) and caps balances at tankCapacity', () => {
    const page = makePage({ id: 'page-1', start_fuel_balance: 15, start_km: 100, end_km: 102 });
    const trips = [
      makeTrip({ date: '2024-10-21', page_id: 'page-1', trip_distance: 2, start_km: 100, end_km: 102, fuel_pumped_amount: 25, is_full_tank: true }),
    ];
    const days = computeLedgerDays({ page, trips, economies: [10.5], tankCapacity: 75 });
    // After 2km trip (consumed ~0.2L) and full tanking 25L with is_full_tank=true, balance should be ~75.0 (74.8)
    expect(days[0].balance).toBe(74.8);

    // Capping at tankCapacity (never goes to 100+)
    const page2 = makePage({ id: 'page-2', start_fuel_balance: 70, start_km: 200, end_km: 210 });
    const trips2 = [
      makeTrip({ date: '2024-10-22', page_id: 'page-2', trip_distance: 10, start_km: 200, end_km: 210, fuel_pumped_amount: 50 }),
    ];
    const days2 = computeLedgerDays({ page: page2, trips: trips2, economies: [10.5], tankCapacity: 75 });
    expect(days2[0].balance).toBe(75.0);
  });
});
