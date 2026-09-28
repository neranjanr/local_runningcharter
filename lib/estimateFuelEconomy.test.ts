import { describe, it, expect } from 'vitest';
import { estimateFuelEconomies } from './estimateFuelEconomy';
import type { BookPage, Trip, Vehicle } from '@/types';

const vehicle: Vehicle = {
  id: 'veh-1',
  brand: 'Toyota',
  model: 'Hilux',
  vehicle_type: 'Double Cab',
  fuel_type: 'Diesel',
  tank_capacity: 75,
  current_odometer: 0,
  typical_economy_low: 7,
  typical_economy_high: 9,
};

const page: BookPage = {
  id: 'page-1',
  vehicle_id: 'veh-1',
  page_number: 1,
  month: '2024-02',
  start_km: 0,
  end_km: 1000,
  start_fuel_balance: 75,
  end_fuel_balance: 10,
};

function trip(over: Partial<Trip> & { id: string; date: string }): Trip {
  return {
    id: over.id,
    page_id: 'page-1',
    vehicle_id: 'veh-1',
    date: over.date,
    day_index: 1,
    trip_index: over.trip_index ?? 1,
    start_time: '',
    end_time: '10:00',
    start_km: over.start_km ?? 0,
    end_km: over.end_km ?? 0,
    trip_distance: over.trip_distance ?? 0,
    trip_type: 'Official',
    places_visited: 'A -> B',
    fuel_pumped_amount: over.fuel_pumped_amount ?? 0,
    fuel_order_no: over.fuel_order_no,
    is_full_tank: over.is_full_tank ?? false,
    pump_timing: over.pump_timing ?? 'END',
  };
}

describe('estimateFuelEconomies — full tank anchoring & dual suggestions', () => {
  it('Full -> Full physics uses totalDist/totalFuel (not a drifted balance)', () => {
    // Feb 20 full (69 L) -> Mar 11 full (63 L); 455 km driven between pumps.
    const trips: Trip[] = [
      trip({ id: 't1', date: '2024-02-20', start_km: 0, end_km: 100, trip_distance: 100, fuel_pumped_amount: 69, is_full_tank: true }),
      trip({ id: 't2', date: '2024-02-25', start_km: 100, end_km: 500, trip_distance: 400, trip_index: 2 }),
      trip({ id: 't3', date: '2024-03-11', start_km: 500, end_km: 555, trip_distance: 55, fuel_pumped_amount: 63, is_full_tank: true, trip_index: 3 }),
    ];
    const est = estimateFuelEconomies({ trips, pages: [page], vehicle, tankCapacityOverride: 75 });
    // First segment is Feb20 -> Mar11 (includes Mar11 pump trip): 455 km / 63 L ≈ 7.2
    const seg = est[0];
    expect(seg).toBeDefined();
    expect(seg.distance).toBe(455);
    expect(seg.isFullTank).toBe(true);
    expect(seg.suggested).toBeCloseTo(7.2, 1);
    expect(seg.suggestedStrict).toBeCloseTo(7.2, 1);
    expect(seg.feasible).toBe(true);
    // Must not fall back to an absurd high economy
    expect(seg.suggested).toBeLessThan(12);
  });

  it('anchors running balance to tankCapacity after a Full Tank pump', () => {
    // If the opening balance were not anchored, 494 km at ~7 km/L would drain 70 L
    // from a low balance and be flagged infeasible. Anchoring to 75 L keeps it feasible.
    const trips: Trip[] = [
      trip({ id: 't1', date: '2024-02-20', start_km: 0, end_km: 100, trip_distance: 100, fuel_pumped_amount: 69, is_full_tank: true }),
      trip({ id: 't2', date: '2024-02-25', start_km: 100, end_km: 500, trip_distance: 400, trip_index: 2 }),
      trip({ id: 't3', date: '2024-03-11', start_km: 500, end_km: 594, trip_distance: 94, fuel_pumped_amount: 63, is_full_tank: true, trip_index: 3 }),
    ];
    const est = estimateFuelEconomies({ trips, pages: [page], vehicle, tankCapacityOverride: 75 });
    expect(est[0].feasible).toBe(true);
    expect(est[0].suggested).toBeCloseTo(494 / 63, 0);
  });

  it('returns both Normal and Strict suggestions for every segment', () => {
    const trips: Trip[] = [
      trip({ id: 't1', date: '2024-02-20', start_km: 0, end_km: 100, trip_distance: 100, fuel_pumped_amount: 69, is_full_tank: true }),
      trip({ id: 't2', date: '2024-02-25', start_km: 100, end_km: 500, trip_distance: 400, trip_index: 2 }),
      trip({ id: 't3', date: '2024-03-11', start_km: 500, end_km: 555, trip_distance: 55, fuel_pumped_amount: 63, is_full_tank: true, trip_index: 3 }),
      trip({ id: 't4', date: '2024-03-20', start_km: 555, end_km: 800, trip_distance: 245, trip_index: 4 }),
    ];
    const est = estimateFuelEconomies({ trips, pages: [page], vehicle, tankCapacityOverride: 75 });
    expect(est.length).toBeGreaterThan(0);
    for (const seg of est) {
      expect(typeof seg.suggested).toBe('number');
      expect(typeof seg.suggestedStrict).toBe('number');
      expect(seg.suggested).toBeGreaterThan(0);
      expect(seg.suggestedStrict).toBeGreaterThan(0);
    }
  });

  it('when no Full Tank is marked, Strict equals Normal', () => {
    const trips: Trip[] = [
      trip({ id: 't1', date: '2024-02-20', start_km: 0, end_km: 100, trip_distance: 100, fuel_pumped_amount: 40 }),
      trip({ id: 't2', date: '2024-02-25', start_km: 100, end_km: 400, trip_distance: 300, trip_index: 2 }),
      trip({ id: 't3', date: '2024-03-11', start_km: 400, end_km: 550, trip_distance: 150, fuel_pumped_amount: 35, trip_index: 3 }),
    ];
    const est = estimateFuelEconomies({ trips, pages: [page], vehicle, tankCapacityOverride: 75 });
    expect(est.length).toBeGreaterThan(0);
    for (const seg of est) {
      expect(seg.suggestedStrict).toBeCloseTo(seg.suggested, 5);
    }
  });
});
