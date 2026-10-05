import { describe, it, expect } from 'vitest';
import {
  MAX_DAYS_PER_PAGE,
  MAX_TRIPS_PER_DAY,
  getMonthKey,
  getDistinctDates,
  countTripsForDate,
  validateTripForPage,
  getNextPageStartKm,
  getNextPageStartFuel,
  validateOdometerContinuity,
  validateFuelContinuity,
  assignPageForNewTrip,
  assignPageForBackdatedTrip,
  calculateConsumed,
  calculateBalance,
  countLedgerColumnSlots,
  validatePaginationConstraints,
  type PageAssignment,
} from './pagination';
import type { BookPage, Trip } from '@/types';

function makeTrip(overrides: Partial<Trip> & { date: string; page_id: string }): Trip {
  const base: Trip = {
    id: `trip-${Math.random().toString(36).slice(2, 8)}`,
    vehicle_id: 'veh-1',
    page_id: overrides.page_id,
    date: overrides.date,
    day_index: overrides.day_index ?? 1,
    trip_index: overrides.trip_index ?? 1,
    start_time: '08:00',
    end_time: '09:00',
    start_km: overrides.start_km ?? 100,
    end_km: overrides.end_km ?? 110,
    trip_distance: overrides.trip_distance ?? 10,
    trip_type: 'Official',
    places_visited: 'A -> B',
    fuel_pumped_amount: 0,
    fuel_order_no: '',
    created_at: new Date().toISOString(),
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

describe('pagination constants', () => {
  it('enforces max 4 days per page and 13 trips per day', () => {
    expect(MAX_DAYS_PER_PAGE).toBe(4);
    expect(MAX_TRIPS_PER_DAY).toBe(13);
  });
});

describe('getMonthKey', () => {
  it('extracts YYYY-MM from ISO date', () => {
    expect(getMonthKey('2024-10-21')).toBe('2024-10');
    expect(getMonthKey('2024-09-01')).toBe('2024-09');
    expect(getMonthKey('2025-01-31')).toBe('2025-01');
  });
});

describe('getDistinctDates', () => {
  it('returns distinct sorted dates', () => {
    const trips = [
      makeTrip({ date: '2024-10-22', page_id: 'p1' }),
      makeTrip({ date: '2024-10-21', page_id: 'p1' }),
      makeTrip({ date: '2024-10-21', page_id: 'p1' }),
      makeTrip({ date: '2024-10-23', page_id: 'p1' }),
    ];
    expect(getDistinctDates(trips)).toEqual(['2024-10-21', '2024-10-22', '2024-10-23']);
  });
  it('returns empty for no trips', () => {
    expect(getDistinctDates([])).toEqual([]);
  });
});

describe('countTripsForDate', () => {
  it('counts trips for given date', () => {
    const trips = [
      makeTrip({ date: '2024-10-21', page_id: 'p1' }),
      makeTrip({ date: '2024-10-21', page_id: 'p1' }),
      makeTrip({ date: '2024-10-22', page_id: 'p1' }),
    ];
    expect(countTripsForDate(trips, '2024-10-21')).toBe(2);
    expect(countTripsForDate(trips, '2024-10-22')).toBe(1);
    expect(countTripsForDate(trips, '2024-10-23')).toBe(0);
  });
});

describe('validateTripForPage - page boundary validation', () => {
  it('allows trip on same page when under 4 days limit', () => {
    const page = makePage({ page_number: 1, month: '2024-10' });
    const trips = [
      makeTrip({ date: '2024-10-21', page_id: page.id }),
      makeTrip({ date: '2024-10-22', page_id: page.id }),
      makeTrip({ date: '2024-10-23', page_id: page.id }),
    ];
    const result = validateTripForPage(trips, page, '2024-10-24');
    expect(result.allowed).toBe(true);
    expect(result.requiresNewPage).toBe(false);
  });

  it('requires new page when adding 5th distinct day', () => {
    const page = makePage({ page_number: 1, month: '2024-10' });
    const trips = [
      makeTrip({ date: '2024-10-21', page_id: page.id }),
      makeTrip({ date: '2024-10-22', page_id: page.id }),
      makeTrip({ date: '2024-10-23', page_id: page.id }),
      makeTrip({ date: '2024-10-24', page_id: page.id }),
    ];
    const result = validateTripForPage(trips, page, '2024-10-25');
    expect(result.allowed).toBe(true);
    expect(result.requiresNewPage).toBe(true);
    expect(result.reason).toBe('MAX_DAYS');
  });

  it('allows additional trip on existing day even when page has 4 days', () => {
    const page = makePage({ page_number: 1, month: '2024-10' });
    const trips = [
      makeTrip({ date: '2024-10-21', page_id: page.id }),
      makeTrip({ date: '2024-10-22', page_id: page.id }),
      makeTrip({ date: '2024-10-23', page_id: page.id }),
      makeTrip({ date: '2024-10-24', page_id: page.id }),
    ];
    const result = validateTripForPage(trips, page, '2024-10-22');
    expect(result.allowed).toBe(true);
    expect(result.requiresNewPage).toBe(false);
  });

  it('rejects when 13 trips already on same day', () => {
    const page = makePage({ page_number: 1, month: '2024-10' });
    const trips = Array.from({ length: 13 }, () => makeTrip({ date: '2024-10-21', page_id: page.id }));
    const result = validateTripForPage(trips, page, '2024-10-21');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('MAX_TRIPS_PER_DAY');
  });

  it('allows 13th trip but blocks 14th (boundary)', () => {
    const page = makePage({ page_number: 1, month: '2024-10' });
    const trips12 = Array.from({ length: 12 }, () => makeTrip({ date: '2024-10-21', page_id: page.id }));
    const ok = validateTripForPage(trips12, page, '2024-10-21');
    expect(ok.allowed).toBe(true);
    const trips13 = Array.from({ length: 13 }, () => makeTrip({ date: '2024-10-21', page_id: page.id }));
    const blocked = validateTripForPage(trips13, page, '2024-10-21');
    expect(blocked.allowed).toBe(false);
  });
});

describe('validateTripForPage - month-change rollover', () => {
  it('forces new page on calendar month change', () => {
    const page = makePage({ page_number: 1, month: '2024-10' });
    const trips = [makeTrip({ date: '2024-10-31', page_id: page.id })];
    const result = validateTripForPage(trips, page, '2024-11-01');
    expect(result.requiresNewPage).toBe(true);
    expect(result.reason).toBe('MONTH_ROLLOVER');
    expect(result.allowed).toBe(true);
  });

  it('does not force new page when same month', () => {
    const page = makePage({ page_number: 5, month: '2024-10' });
    const trips = [makeTrip({ date: '2024-10-21', page_id: page.id })];
    const result = validateTripForPage(trips, page, '2024-10-22');
    expect(result.requiresNewPage).toBe(false);
  });

  it('month rollover takes precedence even if days limit not reached', () => {
    const page = makePage({ page_number: 1, month: '2024-10' });
    const trips = [makeTrip({ date: '2024-10-21', page_id: page.id })];
    const result = validateTripForPage(trips, page, '2024-11-01');
    expect(result.requiresNewPage).toBe(true);
    expect(result.reason).toBe('MONTH_ROLLOVER');
  });
});

describe('odometer continuity - End KM Page N = Start KM Page N+1', () => {
  it('validates continuity across sorted pages', () => {
    const pages = [
      makePage({ page_number: 1, start_km: 100, end_km: 200 }),
      makePage({ page_number: 2, start_km: 200, end_km: 350 }),
      makePage({ page_number: 3, start_km: 350, end_km: 400 }),
    ];
    const res = validateOdometerContinuity(pages);
    expect(res.isValid).toBe(true);
    expect(res.breaks).toEqual([]);
  });

  it('detects break in odometer continuity', () => {
    const pages = [
      makePage({ page_number: 1, start_km: 100, end_km: 200 }),
      makePage({ page_number: 2, start_km: 210, end_km: 350 }), // break: expected 200 got 210
    ];
    const res = validateOdometerContinuity(pages);
    expect(res.isValid).toBe(false);
    expect(res.breaks.length).toBe(1);
    expect(res.breaks[0].expected).toBe(200);
    expect(res.breaks[0].actual).toBe(210);
    expect(res.breaks[0].pageNumber).toBe(2);
  });

  it('returns valid for single or no pages', () => {
    expect(validateOdometerContinuity([]).isValid).toBe(true);
    expect(validateOdometerContinuity([makePage({ page_number: 1 })]).isValid).toBe(true);
  });

  it('getNextPageStartKm returns last page end_km or fallback', () => {
    const pages = [makePage({ page_number: 1, end_km: 142875.0 }), makePage({ page_number: 2, end_km: 143000.5 })];
    expect(getNextPageStartKm(pages, 100)).toBe(143001);
    expect(getNextPageStartKm([], 12500.0)).toBe(12500);
  });
});

describe('fuel continuity - End Balance Page N = Start Position Page N+1 Day1', () => {
  it('validates fuel continuity', () => {
    const pages = [
      makePage({ page_number: 1, start_fuel_balance: 30, end_fuel_balance: 25.4 }),
      makePage({ page_number: 2, start_fuel_balance: 25.4, end_fuel_balance: 54.2 }),
      makePage({ page_number: 3, start_fuel_balance: 54.2, end_fuel_balance: 48.3 }),
    ];
    const res = validateFuelContinuity(pages);
    expect(res.isValid).toBe(true);
  });

  it('detects fuel continuity break', () => {
    const pages = [
      makePage({ page_number: 1, end_fuel_balance: 25.4 }),
      makePage({ page_number: 2, start_fuel_balance: 30.0, end_fuel_balance: 20 }),
    ];
    const res = validateFuelContinuity(pages);
    expect(res.isValid).toBe(false);
    expect(res.breaks[0].expected).toBe(25.4);
    expect(res.breaks[0].actual).toBe(30.0);
  });

  it('getNextPageStartFuel returns last balance or fallback', () => {
    const pages = [makePage({ page_number: 1, end_fuel_balance: 48.3 })];
    expect(getNextPageStartFuel(pages, 65.0)).toBe(48.3);
    expect(getNextPageStartFuel([], 65.0)).toBe(65.0);
  });
});

describe('fuel consumption formulas (1 decimal)', () => {
  it('calculates consumed as distance / economy rounded to 1 decimal', () => {
    expect(calculateConsumed(62.6, 10.5)).toBe(6.0); // 62.6/10.5=5.96 -> 6.0
    expect(calculateConsumed(65.2, 10.5)).toBe(6.2); // 6.21 ->6.2
    expect(calculateConsumed(38.4, 10.8)).toBe(3.6); // 3.55 ->3.6
    expect(calculateConsumed(24.6, 10.8)).toBe(2.3); // 2.277 ->2.3
  });

  it('handles zero or invalid economy', () => {
    expect(calculateConsumed(100, 0)).toBe(0);
    expect(calculateConsumed(0, 10.5)).toBe(0);
  });

  it('calculates balance as start + drawn - consumed rounded to 1 decimal', () => {
    // Page example: start 31.4 +0 -6.0 =25.4
    expect(calculateBalance(31.4, 0, 6.0)).toBe(25.4);
    // Day2: 25.4+35.0-6.2=54.2
    expect(calculateBalance(25.4, 35.0, 6.2)).toBe(54.2);
    // Day3: 54.2+0-3.6=50.6
    expect(calculateBalance(54.2, 0, 3.6)).toBe(50.6);
    // Day4: 50.6+0-2.3=48.3
    expect(calculateBalance(50.6, 0, 2.3)).toBe(48.3);
  });
});

describe('assignPageForNewTrip integration', () => {
  it('assigns first page when no existing pages', () => {
    const result = assignPageForNewTrip({ pages: [], trips: [], newTripDate: '2024-10-21' }) as any;
    expect(result.requiresNewPage).toBe(true);
    expect(result.pageNumber).toBe(1);
    expect(result.dayIndex).toBe(1);
    expect(result.tripIndex).toBe(1);
    expect(result.reason).toBe('NEW_BOOK');
  });

  it('assigns same page for second day within limits', () => {
    const page1 = makePage({ id: 'p1', page_number: 1, month: '2024-10', start_km: 142684.2, end_km: 142746.8 });
    const trips = [makeTrip({ date: '2024-10-21', page_id: 'p1', day_index: 1, trip_index: 1 })];
    const result = assignPageForNewTrip({ pages: [page1], trips, newTripDate: '2024-10-22' }) as any;
    expect(result.pageNumber).toBe(1);
    expect(result.dayIndex).toBe(2);
    expect(result.tripIndex).toBe(1);
    expect(result.requiresNewPage).toBe(false);
  });

  it('assigns new page when 4 days already filled', () => {
    const page1 = makePage({ id: 'p1', page_number: 1, month: '2024-10' });
    const trips = [
      makeTrip({ date: '2024-10-21', page_id: 'p1', day_index: 1, trip_index: 1 }),
      makeTrip({ date: '2024-10-22', page_id: 'p1', day_index: 2, trip_index: 1 }),
      makeTrip({ date: '2024-10-23', page_id: 'p1', day_index: 3, trip_index: 1 }),
      makeTrip({ date: '2024-10-24', page_id: 'p1', day_index: 4, trip_index: 1 }),
    ];
    const result = assignPageForNewTrip({ pages: [page1], trips, newTripDate: '2024-10-25' }) as any;
    expect(result.requiresNewPage).toBe(true);
    expect(result.pageNumber).toBe(2);
    expect(result.dayIndex).toBe(1);
    expect(result.reason).toBe('MAX_DAYS');
  });

  it('assigns new page on month rollover and carries over km/fuel', () => {
    const page1 = makePage({ id: 'p1', page_number: 1, month: '2024-10', start_km: 100, end_km: 500, start_fuel_balance: 30, end_fuel_balance: 20 });
    const trips = [makeTrip({ date: '2024-10-31', page_id: 'p1', day_index: 1, trip_index: 1 })];
    const result = assignPageForNewTrip({ pages: [page1], trips, newTripDate: '2024-11-01' }) as any;
    expect(result.requiresNewPage).toBe(true);
    expect(result.pageNumber).toBe(2);
    expect(result.reason).toBe('MONTH_ROLLOVER');
  });

  it('increments tripIndex for same day', () => {
    const page1 = makePage({ id: 'p1', page_number: 1, month: '2024-10' });
    const trips = [
      makeTrip({ date: '2024-10-21', page_id: 'p1', day_index: 1, trip_index: 1 }),
      makeTrip({ date: '2024-10-21', page_id: 'p1', day_index: 1, trip_index: 2 }),
    ];
    const result = assignPageForNewTrip({ pages: [page1], trips, newTripDate: '2024-10-21' }) as any;
    expect(result.pageNumber).toBe(1);
    expect(result.dayIndex).toBe(1);
    expect(result.tripIndex).toBe(3);
  });

  it('blocks when exceeding 13 trips per day', () => {
    const page1 = makePage({ id: 'p1', page_number: 1, month: '2024-10' });
    const trips = Array.from({ length: 13 }, (_, i) => makeTrip({ date: '2024-10-21', page_id: 'p1', day_index: 1, trip_index: i + 1 }));
    const result = assignPageForNewTrip({ pages: [page1], trips, newTripDate: '2024-10-21' });
    expect((result as any).allowed).toBe(false);
    expect((result as any).reason).toBe('MAX_TRIPS_PER_DAY');
  });

  it('calculates correct dayIndex for middle insertion (sorted distinct)', () => {
    const page1 = makePage({ id: 'p1', page_number: 1, month: '2024-10' });
    const trips = [
      makeTrip({ date: '2024-10-21', page_id: 'p1', day_index: 1, trip_index: 1 }),
      makeTrip({ date: '2024-10-23', page_id: 'p1', day_index: 2, trip_index: 1 }),
    ];
    // Adding 2024-10-22 should be dayIndex 2 (between 21 and 23) -> but we compute via sorted distinct; implementation may treat chronological order
    const result = assignPageForNewTrip({ pages: [page1], trips, newTripDate: '2024-10-22' }) as any;
    // Should be 2 (sorted: 21,22,23)
    expect(result.dayIndex).toBe(2);
  });
});

describe('assignPageForBackdatedTrip', () => {  const page1 = makePage({ id: 'p1', page_number: 1, month: '2024-09', start_km: 100, end_km: 240 });
  const page2 = makePage({ id: 'p2', page_number: 2, month: '2024-10', start_km: 240, end_km: 400 });
  const sepTrips = [
    makeTrip({ date: '2024-09-21', page_id: 'p1', day_index: 1, trip_index: 1, start_km: 100, end_km: 150 }),
    makeTrip({ date: '2024-09-22', page_id: 'p1', day_index: 2, trip_index: 1, start_km: 160, end_km: 200 }),
  ];
  const octTrips = [
    makeTrip({ date: '2024-10-05', page_id: 'p2', day_index: 1, trip_index: 1, start_km: 240, end_km: 300 }),
  ];

  it('assigns a back-dated gap to the predecessor Page, not the current last Page', () => {
    const result = assignPageForBackdatedTrip({
      pages: [page1, page2],
      trips: [...sepTrips, ...octTrips],
      tripDate: '2024-09-21',
      anchorPageId: 'p1',
    }) as PageAssignment;
    expect(result.pageId).toBe('p1');
    expect(result.requiresNewPage).toBe(false);
    // 2024-09-21 already exists on p1 -> day 1, next trip index
    expect(result.dayIndex).toBe(1);
    expect(result.tripIndex).toBe(2);
  });

  it('resolves the Page by month when the anchor Page month differs from the date', () => {
    const result = assignPageForBackdatedTrip({
      pages: [page1, page2],
      trips: [...sepTrips, ...octTrips],
      tripDate: '2024-10-06',
      anchorPageId: 'p1',
    }) as PageAssignment;
    expect(result.pageId).toBe('p2');
    expect(result.dayIndex).toBe(2);
    expect(result.tripIndex).toBe(1);
  });

  it('computes a new middle date index on the target Page', () => {
    const result = assignPageForBackdatedTrip({
      pages: [page1, page2],
      trips: [...sepTrips, ...octTrips],
      tripDate: '2024-09-25',
      anchorPageId: 'p1',
    }) as PageAssignment;
    // p1 distinct: 21,22 -> adding 25 -> day 3
    expect(result.pageId).toBe('p1');
    expect(result.dayIndex).toBe(3);
    expect(result.tripIndex).toBe(1);
  });

  it('blocks when the target Page already has MAX_TRIPS_PER_DAY on the date', () => {
    const full = Array.from({ length: MAX_TRIPS_PER_DAY }, (_, i) =>
      makeTrip({ date: '2024-09-21', page_id: 'p1', day_index: 1, trip_index: i + 1 })
    );
    const result = assignPageForBackdatedTrip({
      pages: [page1, page2],
      trips: [...full, ...octTrips],
      tripDate: '2024-09-21',
      anchorPageId: 'p1',
    });
    if (!('allowed' in result)) throw new Error('expected blocked assignment');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('MAX_TRIPS_PER_DAY');
  });
});

describe('ledger columns consume day-slots (issue #11)', () => {
  function pumped(over: Partial<Trip> & { date: string; page_id: string }): Trip {
    return makeTrip({ ...over, fuel_pumped_amount: 20, pump_timing: 'END' });
  }

  it('counts one slot per date, two for a split large day over 40 km', () => {
    const trips = [
      makeTrip({ date: '2024-10-21', page_id: 'p1', trip_index: 1, trip_distance: 10 }),
      pumped({ date: '2024-10-22', page_id: 'p1', trip_index: 1, trip_distance: 30, start_km: 10, end_km: 40, id: 'x1' }),
      makeTrip({ date: '2024-10-22', page_id: 'p1', trip_index: 2, trip_distance: 30, start_km: 40, end_km: 70, id: 'x2' }),
    ];
    // 2024-10-22 totals 60 km with a mid-day pump -> 2 slots; total 3
    expect(countLedgerColumnSlots(trips)).toBe(3);
  });

  it('a split small day (40 km or less) still consumes a single slot', () => {
    const trips = [
      pumped({ date: '2024-10-21', page_id: 'p1', trip_index: 1, trip_distance: 10, id: 's1' }),
      makeTrip({ date: '2024-10-21', page_id: 'p1', trip_index: 2, trip_distance: 10, fuel_pumped_amount: 10, pump_timing: 'START', id: 's2' }),
      makeTrip({ date: '2024-10-21', page_id: 'p1', trip_index: 3, trip_distance: 10, id: 's3' }),
    ];
    expect(countLedgerColumnSlots(trips)).toBe(1);
  });

  it('flags MAX_DAYS when columns exceed 4 even with 4 distinct dates', () => {
    const page = makePage({ id: 'p1', page_number: 1, month: '2024-10' });
    const trips = [
      makeTrip({ date: '2024-10-21', page_id: 'p1', trip_index: 1, trip_distance: 10, id: 'a1' }),
      makeTrip({ date: '2024-10-22', page_id: 'p1', trip_index: 1, trip_distance: 10, id: 'a2' }),
      makeTrip({ date: '2024-10-23', page_id: 'p1', trip_index: 1, trip_distance: 10, id: 'a3' }),
      pumped({ date: '2024-10-24', page_id: 'p1', trip_index: 1, trip_distance: 30, start_km: 30, end_km: 60, id: 'b1' }),
      makeTrip({ date: '2024-10-24', page_id: 'p1', trip_index: 2, trip_distance: 30, start_km: 60, end_km: 90, id: 'b2' }),
      makeTrip({ date: '2024-10-24', page_id: 'p1', trip_index: 3, trip_distance: 30, start_km: 90, end_km: 120, id: 'b3' }),
    ];
    const violations = validatePaginationConstraints([page], trips);
    expect(violations.length).toBe(1);
    expect(violations[0].violation).toContain('MAX_DAYS');
  });

  it('requires a new page when day-slots (not just dates) are full', () => {
    const page = makePage({ id: 'p1', page_number: 1, month: '2024-10' });
    const trips = [
      makeTrip({ date: '2024-10-21', page_id: 'p1', trip_index: 1, trip_distance: 10, id: 'a1' }),
      makeTrip({ date: '2024-10-22', page_id: 'p1', trip_index: 1, trip_distance: 10, id: 'a2' }),
      makeTrip({ date: '2024-10-23', page_id: 'p1', trip_index: 1, trip_distance: 10, id: 'a3' }),
      pumped({ date: '2024-10-24', page_id: 'p1', trip_index: 1, trip_distance: 30, start_km: 30, end_km: 60, id: 'b1' }),
      makeTrip({ date: '2024-10-24', page_id: 'p1', trip_index: 2, trip_distance: 30, start_km: 60, end_km: 90, id: 'b2' }),
      makeTrip({ date: '2024-10-24', page_id: 'p1', trip_index: 3, trip_distance: 30, start_km: 90, end_km: 120, id: 'b3' }),
    ];
    // 3 small dates + 1 split large date = 5 slots -> a 5th date needs a new page
    const result = validateTripForPage(trips, page, '2024-10-25');
    expect(result.requiresNewPage).toBe(true);
    expect(result.reason).toBe('MAX_DAYS');
  });

  it('month rollover still forces a new page regardless of slots', () => {
    const page = makePage({ id: 'p1', page_number: 1, month: '2024-10' });
    const trips = [makeTrip({ date: '2024-10-31', page_id: 'p1', id: 'm1' })];
    const result = validateTripForPage(trips, page, '2024-11-01');
    expect(result.requiresNewPage).toBe(true);
    expect(result.reason).toBe('MONTH_ROLLOVER');
  });
});
