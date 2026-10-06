import { describe, it, expect } from 'vitest';
import { estimateFuelEconomies, resolveFuelDayOwnership } from './estimateFuelEconomy';
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

// Low opening balance so early pumps fit the tank headroom (physically
// consistent books: pumped fuel must fit after consumption).
const page10: BookPage = { ...page, start_fuel_balance: 10 };

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

describe('estimateFuelEconomies — day-atom backward segments (ADR-0036)', () => {
  it('Full -> Full physics uses totalDist/closingFuel on the closing segment', () => {
    // Feb 20 full (69 L) -> Mar 11 full (63 L); 455 km driven between pumps.
    // Backward: seg0 is just Feb 20 (closed by its own fuel), seg1 carries
    // Feb 25 + Mar 11 and its Full->Full economy is 455 / 63 ≈ 7.2.
    const trips: Trip[] = [
      trip({ id: 't1', date: '2024-02-20', start_km: 0, end_km: 50, trip_distance: 50, fuel_pumped_amount: 69, is_full_tank: true }),
      trip({ id: 't2', date: '2024-02-25', start_km: 50, end_km: 450, trip_distance: 400, trip_index: 2 }),
      trip({ id: 't3', date: '2024-03-11', start_km: 450, end_km: 505, trip_distance: 55, fuel_pumped_amount: 63, is_full_tank: true, trip_index: 3 }),
    ];
    const est = estimateFuelEconomies({ trips, pages: [page10], vehicle, tankCapacityOverride: 75 });
    expect(est.length).toBe(2);
    const seg0 = est[0];
    expect(seg0.fromDate).toBe('2024-02-20');
    expect(seg0.toDate).toBe('2024-02-20');
    expect(seg0.fuelDate).toBe('2024-02-20');
    expect(seg0.ownership).toBe('previous');
    expect(seg0.distance).toBe(50);
    expect(seg0.suggested).toBeCloseTo(7.8, 1);
    expect(seg0.feasible).toBe(true);
    const seg = est[1];
    expect(seg.fromDate).toBe('2024-02-25');
    expect(seg.toDate).toBe('2024-03-11');
    expect(seg.fuelDate).toBe('2024-03-11');
    expect(seg.distance).toBe(455);
    expect(seg.isFullTank).toBe(true);
    // Strict is physics-first and unsmoothed: exactly the Full->Full ratio.
    expect(seg.suggestedStrict).toBeCloseTo(7.2, 1);
    // Normal smooths toward the previous economy but stays feasible and sane.
    expect(seg.suggested).toBeGreaterThan(7.0);
    expect(seg.suggested).toBeLessThan(7.6);
    expect(seg.feasible).toBe(true);
    // Must not fall back to an absurd high economy
    expect(seg.suggested).toBeLessThan(12);
  });

  it('anchors running balance to tankCapacity when the previous fuel was full', () => {
    // Same trips against a full opening: seg0 overflows the cap and is
    // flagged, but seg1 still calibrates via the full-tank opening anchor
    // (the previous pump restores the tank to full).
    const trips: Trip[] = [
      trip({ id: 't1', date: '2024-02-20', start_km: 0, end_km: 50, trip_distance: 50, fuel_pumped_amount: 69, is_full_tank: true }),
      trip({ id: 't2', date: '2024-02-25', start_km: 50, end_km: 450, trip_distance: 400, trip_index: 2 }),
      trip({ id: 't3', date: '2024-03-11', start_km: 450, end_km: 505, trip_distance: 55, fuel_pumped_amount: 63, is_full_tank: true, trip_index: 3 }),
    ];
    const est = estimateFuelEconomies({ trips, pages: [page], vehicle, tankCapacityOverride: 75 });
    // The opening segment overflows the cap and is flagged, but the closing
    // Full->Full segment still calibrates: the previous full pump anchors
    // the opening balance back to tank capacity. Strict shows the raw physics.
    expect(est[1].feasible).toBe(true);
    expect(est[1].suggestedStrict).toBeCloseTo(455 / 63, 1);
  });

  it('returns both Normal and Strict suggestions for every fuel-closed segment', () => {
    const trips: Trip[] = [
      trip({ id: 't1', date: '2024-02-20', start_km: 0, end_km: 50, trip_distance: 50, fuel_pumped_amount: 69, is_full_tank: true }),
      trip({ id: 't2', date: '2024-02-25', start_km: 50, end_km: 450, trip_distance: 400, trip_index: 2 }),
      trip({ id: 't3', date: '2024-03-11', start_km: 450, end_km: 505, trip_distance: 55, fuel_pumped_amount: 63, is_full_tank: true, trip_index: 3 }),
      trip({ id: 't4', date: '2024-03-20', start_km: 505, end_km: 750, trip_distance: 245, trip_index: 4 }),
    ];
    const est = estimateFuelEconomies({ trips, pages: [page10], vehicle, tankCapacityOverride: 75 });
    const closed = est.filter(s => !s.isPending);
    expect(closed.length).toBe(2);
    for (const seg of closed) {
      expect(typeof seg.suggested).toBe('number');
      expect(typeof seg.suggestedStrict).toBe('number');
      expect(seg.suggested).toBeGreaterThan(0);
      expect(seg.suggestedStrict).toBeGreaterThan(0);
    }
    // The open tail inherits: pending with no suggestion.
    const tail = est[est.length - 1];
    expect(tail.isPending).toBe(true);
    expect(tail.suggested).toBeNull();
    expect(tail.suggestedStrict).toBeNull();
  });

  it('when no Full Tank is marked, Strict equals Normal', () => {
    const trips: Trip[] = [
      trip({ id: 't1', date: '2024-02-20', start_km: 0, end_km: 100, trip_distance: 100, fuel_pumped_amount: 13 }),
      trip({ id: 't2', date: '2024-02-25', start_km: 100, end_km: 400, trip_distance: 300, trip_index: 2 }),
      trip({ id: 't3', date: '2024-03-11', start_km: 400, end_km: 550, trip_distance: 150, fuel_pumped_amount: 58, trip_index: 3 }),
    ];
    const est = estimateFuelEconomies({ trips, pages: [page], vehicle, tankCapacityOverride: 75 });
    expect(est.length).toBe(2);
    for (const seg of est) {
      expect(seg.suggestedStrict!).toBeCloseTo(seg.suggested!, 5);
    }
  });

  it('ranges run backward: day after previous fuel-in through the closing fuel-in', () => {
    // Pump on 03-03, run on 03-12, pump on 03-15 (START timing is ignored),
    // run on 03-20. Segments close on their fuel date; the tail pends.
    const trips: Trip[] = [
      trip({ id: 't1', date: '2024-03-03', start_km: 0, end_km: 50, trip_distance: 50, fuel_pumped_amount: 56 }),
      trip({ id: 't2', date: '2024-03-12', start_km: 50, end_km: 100, trip_distance: 50, trip_index: 2 }),
      trip({ id: 't3', date: '2024-03-15', start_km: 100, end_km: 140, trip_distance: 40, fuel_pumped_amount: 61, pump_timing: 'START', trip_index: 3 }),
      trip({ id: 't4', date: '2024-03-20', start_km: 140, end_km: 200, trip_distance: 60, trip_index: 4 }),
    ];
    const est = estimateFuelEconomies({ trips, pages: [page], vehicle, tankCapacityOverride: 75 });
    // One row per fuel-in date plus the pending tail.
    expect(est.length).toBe(3);
    expect(est[0].fromDate).toBe('2024-03-03');
    expect(est[0].toDate).toBe('2024-03-03');
    expect(est[0].fuelDate).toBe('2024-03-03');
    expect(est[1].fromDate).toBe('2024-03-12');
    expect(est[1].toDate).toBe('2024-03-15');
    expect(est[1].fuelDate).toBe('2024-03-15');
    expect(est[2].isPending).toBe(true);
    // Ranges are contiguous and non-overlapping over the fuel-closed rows.
    expect(est[0].toDate < est[1].fromDate).toBe(true);
    // No stray ranges starting mid-segment.
    expect(est.some(s => s.fromDate === '2024-03-12' && s.isPending)).toBe(false);
  });

  it('same-day multiple pumps collapse to one date with summed fuel', () => {
    const trips: Trip[] = [
      trip({ id: 't1', date: '2024-03-03', start_km: 0, end_km: 50, trip_distance: 50, fuel_pumped_amount: 30, trip_index: 1 }),
      trip({ id: 't2', date: '2024-03-03', start_km: 50, end_km: 120, trip_distance: 70, fuel_pumped_amount: 26, trip_index: 2 }),
      trip({ id: 't3', date: '2024-03-15', start_km: 120, end_km: 200, trip_distance: 80, fuel_pumped_amount: 61, trip_index: 3 }),
      trip({ id: 't4', date: '2024-03-20', start_km: 200, end_km: 260, trip_distance: 60, trip_index: 4 }),
    ];
    const est = estimateFuelEconomies({ trips, pages: [page], vehicle, tankCapacityOverride: 75 });
    // Two fuel-in dates + tail: the shared date is a single row.
    expect(est.length).toBe(3);
    expect(est[0].fromDate).toBe('2024-03-03');
    expect(est[0].toDate).toBe('2024-03-03');
    expect(est[0].distance).toBe(120);
    expect(est[0].fuelFed).toBeCloseTo(56, 1);
    expect(est[0].tripIds.sort()).toEqual(['t1', 't2']);
    expect(est[1].fromDate).toBe('2024-03-15');
    expect(est[2].isPending).toBe(true);
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
    // 20 x 35 km on 04-05 + 30 km on 04-10: floor ~9.6, so a 1.8 step is
    // needed and the base cap bites at 9.3 on the closing segment.
    const trips = forcedJumpScenario(Array(20).fill(35));
    const est = estimateFuelEconomies({ trips, pages: [page10], vehicle, tankCapacityOverride: 75 });
    expect(est.length).toBe(2);
    const seg1 = est[1];
    expect(seg1.longTripCount).toBe(0);
    expect(seg1.veryLongTripCount).toBe(0);
    expect(seg1.suggested).toBeCloseTo(9.3, 5);
    expect(seg1.feasible).toBe(false);
    expect(seg1.warning ?? '').toContain('capped');
    expect(seg1.warning ?? '').not.toContain('km trips');
  });

  it('widens the Normal cap to 2.5 km/L for >40 km trips', () => {
    // 14 x 50 km: floor reachable within the widened cap.
    const trips = forcedJumpScenario(Array(14).fill(50));
    const est = estimateFuelEconomies({ trips, pages: [page10], vehicle, tankCapacityOverride: 75 });
    const seg1 = est[1];
    expect(seg1.longTripCount).toBe(14);
    expect(seg1.veryLongTripCount).toBe(0);
    expect(seg1.suggested).toBeCloseTo(9.8, 5);
    expect(seg1.feasible).toBe(true);
  });

  it('widens the Normal cap to 3.0 km/L for 100 km+ trips (highest tier wins)', () => {
    // One 777 km trip (>=100): the 3.0 tier takes the step.
    const trips = forcedJumpScenario([777]);
    const est = estimateFuelEconomies({ trips, pages: [page10], vehicle, tankCapacityOverride: 75 });
    const seg1 = est[1];
    expect(seg1.veryLongTripCount).toBe(1);
    expect(seg1.suggested).toBeCloseTo(10.7, 5);
    expect(seg1.feasible).toBe(true);
  });

  it('treats a >40-only segment as the lower tier even with the same distance', () => {
    // Same ~807 km, but as 50 km hops: >40 tier caps at 2.5 -> 10.3.
    const trips = forcedJumpScenario([...Array(15).fill(50), 27]);
    const est = estimateFuelEconomies({ trips, pages: [page10], vehicle, tankCapacityOverride: 75 });
    const seg1 = est[1];
    expect(seg1.longTripCount).toBe(15);
    expect(seg1.veryLongTripCount).toBe(0);
    expect(seg1.suggested).toBeCloseTo(10.3, 5);
    expect(seg1.feasible).toBe(false);
    expect(seg1.warning ?? '').toContain('>40 km trips');
  });

  it('keeps Strict feasibility-first beyond the widened Normal cap', () => {
    const trips = forcedJumpScenario(Array(20).fill(35));
    const est = estimateFuelEconomies({ trips, pages: [page10], vehicle, tankCapacityOverride: 75 });
    const seg1 = est[1];
    expect(seg1.suggested).toBeCloseTo(9.3, 5);
    expect(seg1.suggestedStrict).toBeCloseTo(9.6, 5);
    expect(seg1.suggestedStrict!).toBeGreaterThan(seg1.suggested!);
  });

  it('reports the longest trip per segment for large-distance badges', () => {
    const trips: Trip[] = [
      trip({ id: 't1', date: '2024-02-20', start_km: 0, end_km: 30, trip_distance: 30, fuel_pumped_amount: 40, trip_index: 1 }),
      trip({ id: 't2', date: '2024-02-25', start_km: 30, end_km: 80, trip_distance: 50, trip_index: 2 }),
      trip({ id: 't3', date: '2024-03-11', start_km: 80, end_km: 230, trip_distance: 150, fuel_pumped_amount: 35, trip_index: 3 }),
      trip({ id: 't4', date: '2024-03-20', start_km: 230, end_km: 260, trip_distance: 30, trip_index: 4 }),
    ];
    const est = estimateFuelEconomies({ trips, pages: [page10], vehicle, tankCapacityOverride: 75 });
    // Segment 0 is just 20-02 (30 km); segment 1 carries the 50 + 150 km trips.
    expect(est[0].maxTripDistance).toBe(30);
    expect(est[0].longTripCount).toBe(0);
    expect(est[1].maxTripDistance).toBe(150);
    expect(est[1].longTripCount).toBe(2);
    expect(est[1].veryLongTripCount).toBe(1);
    // Tail (20-03) carries only the 30 km trip and pends.
    expect(est[2].isPending).toBe(true);
    expect(est[2].maxTripDistance).toBe(30);
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

  describe('Issue 3 — Raw Anchored Averages & Full-Tank Segmenting Engine', () => {
    it('bounds backward segments on fuel dates and computes Full->Full as Di / closingFi', () => {
      const trips: Trip[] = [
        trip({ id: 't1', date: '2024-03-01', start_km: 0, end_km: 100, trip_distance: 100, fuel_pumped_amount: 40, is_full_tank: true, trip_index: 1 }),
        trip({ id: 't2', date: '2024-03-05', start_km: 100, end_km: 300, trip_distance: 200, trip_index: 2 }),
        trip({ id: 't3', date: '2024-03-10', start_km: 300, end_km: 400, trip_distance: 100, fuel_pumped_amount: 25, is_full_tank: true, trip_index: 3 }),
      ];
      const est = estimateFuelEconomies({ trips, pages: [page], vehicle, tankCapacityOverride: 75 });
      expect(est.length).toBe(2);
      expect(est[1].distance).toBe(300);
      expect(est[1].isFullTank).toBe(true);
      // Strict is physics-first: exactly the Full->Full ratio. Normal stays
      // feasible but smooths toward the previous economy.
      expect(est[1].suggestedStrict).toBeCloseTo(300 / 25, 1);
      expect(est[1].feasible).toBe(true);
    });

    it('ensures locked economies take precedence over raw and estimated calculations', () => {
      const trips: Trip[] = [
        trip({ id: 't1', date: '2024-03-01', start_km: 0, end_km: 100, trip_distance: 100, fuel_pumped_amount: 40, is_full_tank: true, trip_index: 1 }),
        trip({ id: 't2', date: '2024-03-05', start_km: 100, end_km: 300, trip_distance: 200, fuel_pumped_amount: 30, is_full_tank: true, trip_index: 2 }),
      ];
      const lockedDatesSet = new Set(['2024-03-01', '2024-03-05']);
      const lockedEconomyMap = new Map<string, number>([['2024-03-01', 15.5]]);

      const est = estimateFuelEconomies({
        trips,
        pages: [page],
        vehicle,
        tankCapacityOverride: 75,
        lockedDatesSet,
        lockedEconomyMap,
      });

      expect(est.length).toBeGreaterThan(0);
      expect(est[0].suggested).toBe(15.5);
      expect(est[0].warning).toContain('🔒 Locked');
    });
  });

  describe('day-atom suggestion rows (pending tail, timing ignored)', () => {
    it('fuel on the final date leaves no pending tail', () => {
      const trips: Trip[] = [
        trip({ id: 't1', date: '2024-03-01', start_km: 0, end_km: 100, trip_distance: 100, fuel_pumped_amount: 40, trip_index: 1 }),
        trip({ id: 't2', date: '2024-03-05', start_km: 100, end_km: 300, trip_distance: 200, trip_index: 2 }),
        trip({ id: 't3', date: '2024-03-10', start_km: 300, end_km: 400, trip_distance: 100, fuel_pumped_amount: 25, trip_index: 3 }),
      ];
      const est = estimateFuelEconomies({ trips, pages: [page], vehicle, tankCapacityOverride: 75 });
      // One row per fuel-in date; the book ends on a fuel date so no tail pends.
      expect(est.length).toBe(2);
      expect(est.some(s => s.isPending)).toBe(false);
      expect(est[0].tripIds).toEqual(['t1']);
      expect(est[1].tripIds).toEqual(['t2', 't3']);
      expect(est[0].isLowConfidence).toBe(false);
      expect(est[1].isLowConfidence).toBe(false);
    });

    it('trailing run dates form a pending tail that chains the previous economy', () => {
      const trips: Trip[] = [
        trip({ id: 't1', date: '2024-03-01', start_km: 0, end_km: 100, trip_distance: 100, fuel_pumped_amount: 40, trip_index: 1 }),
        trip({ id: 't2', date: '2024-03-05', start_km: 100, end_km: 300, trip_distance: 200, trip_index: 2 }),
        trip({ id: 't3', date: '2024-03-10', start_km: 300, end_km: 400, trip_distance: 100, fuel_pumped_amount: 25, trip_index: 3 }),
        trip({ id: 't4', date: '2024-03-15', start_km: 400, end_km: 480, trip_distance: 80, trip_index: 4 }),
      ];
      const est = estimateFuelEconomies({ trips, pages: [page], vehicle, tankCapacityOverride: 75 });
      expect(est.length).toBe(3);
      const tail = est[2];
      expect(tail.isPending).toBe(true);
      expect(tail.tripIds).toEqual(['t4']);
      expect(tail.suggested).toBeNull();
      expect(tail.suggestedStrict).toBeNull();
      // Pending carries no suggestion, so it chains the previous suggestion.
      expect(tail.prevEconomy).toBe(est[1].suggested);
    });

    it('pump_timing START vs END yields identical segments and economies', () => {
      const base = [
        trip({ id: 't1', date: '2024-03-01', start_km: 0, end_km: 100, trip_distance: 100, fuel_pumped_amount: 40, trip_index: 1 }),
        trip({ id: 't2', date: '2024-03-05', start_km: 100, end_km: 150, trip_distance: 50, trip_index: 2 }),
        trip({ id: 't3', date: '2024-03-06', start_km: 150, end_km: 210, trip_distance: 60, fuel_pumped_amount: 25, trip_index: 3 }),
        trip({ id: 't4', date: '2024-03-10', start_km: 210, end_km: 290, trip_distance: 80, trip_index: 4 }),
      ];
      const asStart = base.map(t => ({ ...t, pump_timing: 'START' as const }));
      const asEnd = base.map(t => ({ ...t, pump_timing: 'END' as const }));
      const eStart = estimateFuelEconomies({ trips: asStart, pages: [page], vehicle, tankCapacityOverride: 75 });
      const eEnd = estimateFuelEconomies({ trips: asEnd, pages: [page], vehicle, tankCapacityOverride: 75 });
      expect(eStart.length).toBe(eEnd.length);
      expect(eStart.map(s => [s.fromDate, s.toDate, s.tripIds, s.suggested])).toEqual(
        eEnd.map(s => [s.fromDate, s.toDate, s.tripIds, s.suggested]),
      );
    });
  });

  describe('Fuel-Day Ownership — greedy minimal gap (ADR-0036)', () => {
    // Jan 1-5 run, fuel + run on the 6th, run 7-10, fuel on the 11th.
    // Previous-join: x = 600/50 = 12 vs 400/50 = 8 (gap 4).
    // Next-join: p = 500/50 = 10 vs q = 500/50 = 10 (gap 0, perfect).
    function janTrips(): Trip[] {
      const ts: Trip[] = [];
      let km = 0;
      const day = (date: string, dist: number, fuel = 0) => {
        ts.push(trip({ id: `j${date}`, date, start_km: km, end_km: km + dist, trip_distance: dist, fuel_pumped_amount: fuel }));
        km += dist;
      };
      ['01', '02', '03', '04', '05'].forEach(d => day(`2024-01-${d}`, 100));
      day('2024-01-06', 100, 50);
      ['07', '08', '09', '10'].forEach(d => day(`2024-01-${d}`, 100));
      day('2024-01-11', 0, 50);
      return ts;
    }

    it('picks the join with the smaller adjacent-economy gap (perfect match wins)', () => {
      const est = estimateFuelEconomies({ trips: janTrips(), pages: [page10], vehicle, tankCapacityOverride: 75 });
      expect(est.length).toBe(2);
      expect(est[0].fuelDate).toBe('2024-01-06');
      expect(est[0].ownership).toBe('next');
      expect(est[0].gapChosen).toBe(0);
      expect(est[0].gapOther).toBe(4);
      // The 6th's distance moved next: seg0 ends on the 5th...
      expect(est[0].fromDate).toBe('2024-01-01');
      expect(est[0].toDate).toBe('2024-01-05');
      // ...and seg1 opens on the 6th through the closing 11th fuel.
      expect(est[1].fromDate).toBe('2024-01-06');
      expect(est[1].toDate).toBe('2024-01-11');
      expect(est[1].ownership).toBe('previous');
    });

    it('a pinned ownership is honored without comparison', () => {
      const est = estimateFuelEconomies({
        trips: janTrips(), pages: [page10], vehicle, tankCapacityOverride: 75,
        ownership: new Map([['2024-01-06', 'previous']]),
      });
      expect(est[0].ownership).toBe('previous');
      expect(est[0].toDate).toBe('2024-01-06');
      expect(est[0].gapChosen).toBeNull();
      expect(est[1].fromDate).toBe('2024-01-07');
    });

    it('ties join previous', () => {
      const res = resolveFuelDayOwnership({
        dates: ['d1', 'd2', 'd3'],
        dateDistance: new Map([['d1', 100], ['d2', 100], ['d3', 100]]),
        dateFuel: new Map([['d2', 50], ['d3', 50]]),
        fuelDates: ['d2', 'd3'],
      });
      // Prev: {d1,d2} 200/50=4 vs {d3} 100/50=2 (gap 2).
      // Next: {d1} 100/50=2 vs {d2,d3} 200/50=4 (gap 2). Tie -> previous.
      expect(res.get('d2')).toEqual({ ownership: 'previous', gapChosen: 2, gapOther: 2 });
      expect(res.get('d3')).toEqual({ ownership: 'previous', gapChosen: null, gapOther: null });
    });

    it('zero-distance fuel days auto-join previous even when pinned next', () => {
      const res = resolveFuelDayOwnership({
        dates: ['d1', 'd2', 'd3'],
        dateDistance: new Map([['d1', 100], ['d2', 0], ['d3', 100]]),
        dateFuel: new Map([['d2', 50], ['d3', 50]]),
        fuelDates: ['d2', 'd3'],
        pinned: new Map([['d2', 'next']]),
      });
      expect(res.get('d2')?.ownership).toBe('previous');
    });

    it('locked fuel days keep their stored ownership without comparison', () => {
      const res = resolveFuelDayOwnership({
        dates: ['d1', 'd2', 'd3'],
        dateDistance: new Map([['d1', 100], ['d2', 100], ['d3', 100]]),
        dateFuel: new Map([['d2', 50], ['d3', 50]]),
        fuelDates: ['d2', 'd3'],
        pinned: new Map([['d2', 'next']]),
        lockedDates: new Set(['d2']),
      });
      expect(res.get('d2')).toEqual({ ownership: 'next', gapChosen: null, gapOther: null });
    });

    it('a next join that would empty its own segment falls back to previous', () => {
      const res = resolveFuelDayOwnership({
        dates: ['d1', 'd2'],
        dateDistance: new Map([['d1', 100], ['d2', 100]]),
        dateFuel: new Map([['d1', 50], ['d2', 50]]),
        fuelDates: ['d1', 'd2'],
        pinned: new Map([['d1', 'next']]),
      });
      // d1 joining next would leave its own segment dateless — forced previous.
      expect(res.get('d1')?.ownership).toBe('previous');
    });
  });

  describe('Issue 4 — Exponential Smoothing & Global Delta Constraints', () => {
    it('applies weighted moving average exponential smoothing with alpha = 0.7 across segments', () => {
      const trips: Trip[] = [
        trip({ id: 't1', date: '2024-03-01', start_km: 0, end_km: 100, trip_distance: 100, fuel_pumped_amount: 10, is_full_tank: true, trip_index: 1 }),
        trip({ id: 't2', date: '2024-03-05', start_km: 100, end_km: 200, trip_distance: 100, fuel_pumped_amount: 10, is_full_tank: true, trip_index: 2 }),
        trip({ id: 't3', date: '2024-03-10', start_km: 200, end_km: 300, trip_distance: 100, fuel_pumped_amount: 7, is_full_tank: true, trip_index: 3 }),
        // Trailing run date forms the pending open tail.
        trip({ id: 't4', date: '2024-03-15', start_km: 300, end_km: 400, trip_distance: 100, trip_index: 4 }),
      ];
      const est = estimateFuelEconomies({ trips, pages: [page], vehicle, tankCapacityOverride: 75 });
      // Three fuel-closed rows plus the pending tail.
      expect(est.length).toBe(4);
      expect(est[3].isPending).toBe(true);
      expect(est[2].suggested).toBeLessThan(14.3);
      expect(est[2].suggested).toBeGreaterThan(10.0);
    });

    it('enforces global delta constraints (MaxDelta = 1.5 km/L) across adjacent segments', () => {
      const trips: Trip[] = [
        trip({ id: 't1', date: '2024-03-01', start_km: 0, end_km: 100, trip_distance: 100, fuel_pumped_amount: 12, is_full_tank: true, trip_index: 1 }),
        trip({ id: 't2', date: '2024-03-05', start_km: 100, end_km: 200, trip_distance: 100, fuel_pumped_amount: 7, is_full_tank: true, trip_index: 2 }),
        // Trailing run date forms the pending open tail.
        trip({ id: 't3', date: '2024-03-10', start_km: 200, end_km: 300, trip_distance: 100, trip_index: 3 }),
      ];
      const est = estimateFuelEconomies({ trips, pages: [page], vehicle, tankCapacityOverride: 75 });
      expect(est.length).toBe(3);
      expect(est[2].isPending).toBe(true);
      const delta = Math.abs((est[1].suggested ?? 0) - (est[0].suggested ?? 0));
      expect(delta).toBeLessThanOrEqual(1.51);
    });
  });
});
