import { describe, it, expect } from 'vitest';
import { validateFuelFeasibility } from './pagination';
import { Trip } from '@/types';

function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 't1',
    page_id: 'p1',
    vehicle_id: 'v1',
    date: '2024-10-21',
    day_index: 1,
    trip_index: 1,
    start_time: '08:00',
    end_time: '09:00',
    start_km: 100,
    end_km: 150,
    trip_distance: 50,
    trip_type: 'Official',
    places_visited: 'A -> B',
    fuel_pumped_amount: 0,
    fuel_order_no: '',
    is_full_tank: false,
    pump_timing: 'END',
    ...overrides,
  };
}

describe('Feasibility Validation & Post-Pump Window Enforcement (Issue #5)', () => {
  it('validates normal trips staying within [1, tankCapacity]', () => {
    const trips = [
      makeTrip({ id: 't1', start_km: 100, end_km: 150, trip_distance: 50, fuel_pumped_amount: 0 }),
      makeTrip({ id: 't2', start_km: 150, end_km: 200, trip_distance: 50, fuel_pumped_amount: 0 }),
    ];
    // opening fuel 40L, default economy 10.5 -> consumed ~4.8L per 50km
    const res = validateFuelFeasibility(trips, 75, 40, 10.5);
    expect(res.isValid).toBe(true);
  });

  it('fails when intermediate balance drops below 1L', () => {
    const trips = [
      makeTrip({ id: 't1', start_km: 100, end_km: 500, trip_distance: 400, fuel_pumped_amount: 0 }),
    ];
    // opening fuel 10L, 400km / 10.5 = ~38.1L consumed -> drops below 1L
    const res = validateFuelFeasibility(trips, 75, 10, 10.5);
    expect(res.isValid).toBe(false);
    expect(res.error).toMatch(/Intermediate fuel balance.*outside \[1/);
  });

  it('passes strict full-tank post-pump window [tankCapacity - 3, tankCapacity + 1]', () => {
    const trips = [
      makeTrip({
        id: 't1',
        start_km: 100,
        end_km: 120,
        trip_distance: 20,
        fuel_pumped_amount: 3.8, // 72L - 1.9L consumed = 70.1L + 3.8L = 73.9L (in [72, 76])
        is_full_tank: true,
      }),
    ];
    const res = validateFuelFeasibility(trips, 75, 72, 10.5);
    expect(res.isValid).toBe(true);
  });

  it('allows Full-Tank post-pump up to cap+1 for measurement imprecision', () => {
    const trips = [
      makeTrip({
        id: 't1',
        start_km: 100,
        end_km: 120,
        trip_distance: 20,
        fuel_pumped_amount: 5.4, // 72L - 1.9L = 70.1L + 5.4L = 75.5L (in [72, 76])
        is_full_tank: true,
      }),
    ];
    const res = validateFuelFeasibility(trips, 75, 72, 10.5);
    expect(res.isValid).toBe(true);
  });

  it('rejects Full-Tank post-pump above cap+1', () => {
    const trips = [
      makeTrip({
        id: 't1',
        start_km: 100,
        end_km: 120,
        trip_distance: 20,
        fuel_pumped_amount: 7.0, // 72L - 1.9L = 70.1L + 7.0L = 77.1L (> 76)
        is_full_tank: true,
      }),
    ];
    const res = validateFuelFeasibility(trips, 75, 72, 10.5);
    expect(res.isValid).toBe(false);
    expect(res.error).toMatch(/outside full-tank window \[72\.0, 76\.0\]/);
  });

  it('fails strict full-tank post-pump window when post-pump volume is below tankCapacity - 3', () => {
    const trips = [
      makeTrip({
        id: 't1',
        start_km: 100,
        end_km: 150,
        trip_distance: 50,
        fuel_pumped_amount: 2, // post-pump is 67.2L < 72L
        is_full_tank: true,
      }),
    ];
    const res = validateFuelFeasibility(trips, 75, 70, 10.5);
    expect(res.isValid).toBe(false);
    expect(res.error).toMatch(/Strict full-tank post-pump balance/);
  });
});
