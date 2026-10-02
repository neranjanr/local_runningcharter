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
      expect(seg.suggestedStrict!).toBeCloseTo(seg.suggested!, 5);
    }
  });

  it('shows exactly one range per consecutive fuel-in, from pump date to next pump date', () => {
    // Pump on 03-03 with no trips until 12-03, next pump on 15-03 marked START.
    // The first segment must read 03-03 -> 15-03 (not 12-03 -> 14-03).
    const trips: Trip[] = [
      trip({ id: 't1', date: '2024-03-03', start_km: 0, end_km: 50, trip_distance: 50, fuel_pumped_amount: 56 }),
      trip({ id: 't2', date: '2024-03-12', start_km: 50, end_km: 100, trip_distance: 50, trip_index: 2 }),
      trip({ id: 't3', date: '2024-03-15', start_km: 100, end_km: 140, trip_distance: 40, fuel_pumped_amount: 61, pump_timing: 'START', trip_index: 3 }),
      trip({ id: 't4', date: '2024-03-20', start_km: 140, end_km: 200, trip_distance: 60, trip_index: 4 }),
    ];
    const est = estimateFuelEconomies({ trips, pages: [page], vehicle, tankCapacityOverride: 75 });
    // Exactly one segment per fuel-in date (two pumps -> two segments).
    expect(est.length).toBe(2);
    expect(est[0].fromDate).toBe('2024-03-03');
    expect(est[0].toDate).toBe('2024-03-15');
    expect(est[1].fromDate).toBe('2024-03-15');
    // Ranges are contiguous and non-overlapping: no range nested inside another.
    expect(est[0].toDate).toBe(est[1].fromDate);
    // No stray 12-03 -> 14-03 range.
    expect(est.some(s => s.fromDate === '2024-03-12')).toBe(false);
  });

  it('collapses same-day multiple pumps into one range', () => {
    const trips: Trip[] = [
      trip({ id: 't1', date: '2024-03-03', start_km: 0, end_km: 50, trip_distance: 50, fuel_pumped_amount: 30, trip_index: 1 }),
      trip({ id: 't2', date: '2024-03-03', start_km: 50, end_km: 120, trip_distance: 70, fuel_pumped_amount: 26, trip_index: 2 }),
      trip({ id: 't3', date: '2024-03-15', start_km: 120, end_km: 200, trip_distance: 80, fuel_pumped_amount: 61, trip_index: 3 }),
      trip({ id: 't4', date: '2024-03-20', start_km: 200, end_km: 260, trip_distance: 60, trip_index: 4 }),
    ];
    const est = estimateFuelEconomies({ trips, pages: [page], vehicle, tankCapacityOverride: 75 });
    // Two distinct fuel-in dates -> two ranges; the same-day pumps are merged.
    expect(est.length).toBe(2);
    expect(est[0].fromDate).toBe('2024-03-03');
    expect(est[0].toDate).toBe('2024-03-15');
    expect(est[0].fuelFed).toBeCloseTo(56, 1);
    expect(est[1].fromDate).toBe('2024-03-15');
  });

  // A segment that drains the tank forces a feasibility floor well above the 7.8 seed,
  // so the step from the previous economy has to be widened to reach it.
  function forcedJumpScenario(midTripDistances: number[]): Trip[] {
    const trips: Trip[] = [
      trip({ id: 'p0', date: '2024-03-25', start_km: 0, end_km: 50, trip_distance: 50, fuel_pumped_amount: 70, is_full_tank: true, trip_index: 1 }),
    ];
    let km = 50;
    midTripDistances.forEach((d, i) => {
      trips.push(trip({ id: `m${i}`, date: '2024-04-05', start_km: km, end_km: km + d, trip_distance: d, trip_index: i + 2 }));
      km += d;
    });
    trips.push(trip({ id: 'p1', date: '2024-04-10', start_km: km, end_km: km + 30, trip_distance: 30, fuel_pumped_amount: 70, trip_index: midTripDistances.length + 2 }));
    return trips;
  }

  it('keeps the 1.5 km/L cap when the segment has no long trips', () => {
    // 20 x 35 km: floor ~9.4, so a 1.6 step is needed and the base cap bites at 9.3.
    const trips = forcedJumpScenario(Array(20).fill(35));
    const est = estimateFuelEconomies({ trips, pages: [page], vehicle, tankCapacityOverride: 75 });
    expect(est.length).toBe(2);
    const seg0 = est[0];
    expect(seg0.longTripCount).toBe(0);
    expect(seg0.veryLongTripCount).toBe(0);
    expect(seg0.suggested).toBeCloseTo(9.3, 5);
    expect(seg0.feasible).toBe(false);
    expect(seg0.warning ?? '').toContain('capped');
    expect(seg0.warning ?? '').not.toContain('km trips');
  });

  it('widens the Normal cap to 2.5 km/L for >40 km trips', () => {
    // 14 x 50 km: floor 9.6, a 1.8 step the base cap would block but 2.5 allows.
    const trips = forcedJumpScenario(Array(14).fill(50));
    const est = estimateFuelEconomies({ trips, pages: [page], vehicle, tankCapacityOverride: 75 });
    const seg0 = est[0];
    expect(seg0.longTripCount).toBe(14);
    expect(seg0.veryLongTripCount).toBe(0);
    expect(seg0.suggested).toBeCloseTo(9.6, 5);
    expect(seg0.feasible).toBe(true);
  });

  it('widens the Normal cap to 3.0 km/L for 100 km+ trips (highest tier wins)', () => {
    // One 777 km trip (>=100): floor 10.5, a 2.7 step that only the 3.0 tier can take.
    const trips = forcedJumpScenario([777]);
    const est = estimateFuelEconomies({ trips, pages: [page], vehicle, tankCapacityOverride: 75 });
    const seg0 = est[0];
    expect(seg0.veryLongTripCount).toBe(1);
    expect(seg0.suggested).toBeCloseTo(10.5, 5);
    expect(seg0.feasible).toBe(true);
  });

  it('treats a >40-only segment as the lower tier even with the same distance', () => {
    // Same 777 km, but as 50 km hops: >40 tier caps at 2.5 -> 10.3, below the 10.6 floor.
    const trips = forcedJumpScenario([...Array(15).fill(50), 27]);
    const est = estimateFuelEconomies({ trips, pages: [page], vehicle, tankCapacityOverride: 75 });
    const seg0 = est[0];
    expect(seg0.longTripCount).toBe(15);
    expect(seg0.veryLongTripCount).toBe(0);
    expect(seg0.suggested).toBeCloseTo(10.3, 5);
    expect(seg0.feasible).toBe(false);
    expect(seg0.warning ?? '').toContain('>40 km trips');
  });

  it('keeps Strict feasibility-first beyond the widened Normal cap', () => {
    const trips = forcedJumpScenario(Array(20).fill(35));
    const est = estimateFuelEconomies({ trips, pages: [page], vehicle, tankCapacityOverride: 75 });
    const seg0 = est[0];
    expect(seg0.suggested).toBeCloseTo(9.3, 5);
    expect(seg0.suggestedStrict).toBeCloseTo(9.4, 5);
    expect(seg0.suggestedStrict!).toBeGreaterThan(seg0.suggested!);
  });

  it('reports the longest trip per segment for large-distance badges', () => {
    const trips: Trip[] = [
      trip({ id: 't1', date: '2024-02-20', start_km: 0, end_km: 30, trip_distance: 30, fuel_pumped_amount: 40, trip_index: 1 }),
      trip({ id: 't2', date: '2024-02-25', start_km: 30, end_km: 80, trip_distance: 50, trip_index: 2 }),
      trip({ id: 't3', date: '2024-03-11', start_km: 80, end_km: 230, trip_distance: 150, fuel_pumped_amount: 35, trip_index: 3 }),
      trip({ id: 't4', date: '2024-03-20', start_km: 230, end_km: 260, trip_distance: 30, trip_index: 4 }),
    ];
    const est = estimateFuelEconomies({ trips, pages: [page], vehicle, tankCapacityOverride: 75 });
    // Segment 0 (20-02 -> 11-03) includes the 50 km and 150 km trips.
    expect(est[0].maxTripDistance).toBe(150);
    expect(est[0].longTripCount).toBe(2);
    expect(est[0].veryLongTripCount).toBe(1);
    // Segment 1 (11-03 -> end) includes only the 30 km trip.
    expect(est[1].maxTripDistance).toBe(30);
    expect(est[1].longTripCount).toBe(0);
    expect(est[1].veryLongTripCount).toBe(0);
  });

  it('detects ODO gaps and returns null suggestions (em-dash span) for gap-blanked segments', () => {
    const trips: Trip[] = [
      trip({ id: 't1', date: '2024-02-20', start_km: 0, end_km: 100, trip_distance: 100, fuel_pumped_amount: 40, is_full_tank: true, trip_index: 1 }),
      trip({ id: 't2', date: '2024-02-22', start_km: 100, end_km: 200, trip_distance: 100, fuel_pumped_amount: 20, trip_index: 2 }),
      // ODO Gap: expected start 200, actual start 300
      trip({ id: 't3', date: '2024-02-25', start_km: 300, end_km: 400, trip_distance: 100, fuel_pumped_amount: 40, is_full_tank: true, trip_index: 3 }),
    ];
    const est = estimateFuelEconomies({ trips, pages: [page], vehicle, tankCapacityOverride: 75 });
    expect(est.length).toBeGreaterThan(0);
    // Segments spanning/after last full before gap or between gap and first full after should be blanked (isGapSpan = true, suggested = null)
    const gapSegs = est.filter(e => e.isGapSpan);
    expect(gapSegs.length).toBeGreaterThan(0);
    for (const gs of gapSegs) {
      expect(gs.suggested).toBeNull();
      expect(gs.suggestedStrict).toBeNull();
    }
  });
});
