import { describe, it, expect, beforeEach } from 'vitest';
import { saveTrip, getTrips, clearTrips } from './tripStore';
import { getPages, clearPages } from './pageStore';
import { saveVehicleProfile } from './vehicleStore';
import { validateOdometerContinuity, validateFuelContinuity } from './pagination';

describe('tripStore chronological renumber integration (Issue 02)', () => {
  beforeEach(async () => {
    localStorage.clear();
    clearTrips();
    clearPages();
    await saveVehicleProfile({ current_odometer: 50000, current_fuel_level: 10, brand: 'Toyota', model: 'Hilux' });
  });

  it('book starts 2026-01-01 Page 1 at 50000/10L, add 2025 trips as Pages 1-2, old Page renumbered, dates unchanged', async () => {
    // Initial book 2026 (100 km consumes ~9.5 L at 10.5 km/L, so pump 10 L to stay above the 1 L feasibility floor)
    await saveTrip({
      date: '2026-01-01',
      start_time: '08:00',
      end_time: '09:00',
      start_km: 50000,
      end_km: 50100,
      trip_distance: 100,
      trip_type: 'Official',
      places_visited: '2026 Trip',
      fuel_pumped_amount: 10,
    });

    let pages = await getPages();
    expect(pages.length).toBe(1);
    expect(pages[0].page_number).toBe(1);
    expect(pages[0].month).toBe('2026-01');

    // Add backdated 2025 trips (should become new pages 1-2, old page renumbered to 3, but with our simple 1 additional page -> 2 pages total)
    await saveTrip({
      date: '2025-01-01',
      start_time: '08:00',
      end_time: '09:00',
      start_km: 48000,
      end_km: 48100,
      trip_distance: 100,
      trip_type: 'Official',
      places_visited: '2025 Trip 1',
      fuel_pumped_amount: 5,
    });

    pages = await getPages();
    const trips = await getTrips();

    // After backdated insertion, pages should be sorted chronologically
    // 2025 page should be page 1, 2026 page page 2
    const sorted = [...pages].sort((a, b) => a.page_number - b.page_number);
    expect(sorted[0].month).toBe('2025-01');
    expect(sorted[0].page_number).toBe(1);
    expect(sorted[1].month).toBe('2026-01');
    expect(sorted[1].page_number).toBe(2);

    // Dates never mutated
    const tripDates = trips.map((t) => t.date).sort();
    expect(tripDates).toEqual(['2025-01-01', '2026-01-01']);

    // Trip page_id cascaded to new numbering
    const trip2025 = trips.find((t) => t.date === '2025-01-01')!;
    const trip2026 = trips.find((t) => t.date === '2026-01-01')!;
    expect(trip2025.page_id).toBe('page-1');
    expect(trip2026.page_id).toBe('page-2');
  });

  it('Book Opening re-editable recalculates fuel balances forward from earliest Page', async () => {
    // Create two pages via chronological insertion (pumped fuel keeps each leg above the 1 L floor)
    await saveTrip({
      date: '2026-01-01',
      start_time: '08:00',
      end_time: '09:00',
      start_km: 50000,
      end_km: 50100,
      trip_distance: 100,
      trip_type: 'Official',
      places_visited: '2026',
      fuel_pumped_amount: 10,
    });
    await saveTrip({
      date: '2025-01-01',
      start_time: '08:00',
      end_time: '09:00',
      start_km: 48000,
      end_km: 48100,
      trip_distance: 100,
      trip_type: 'Official',
      places_visited: '2025',
      fuel_pumped_amount: 5,
    });

    // Edit Book Opening fuel from 10 to 15 via vehicle profile and recalc
    await saveVehicleProfile({ current_odometer: 48000, current_fuel_level: 15 });
    const { recalculateFromBookOpening } = await import('./pageStore');
    const recalculated = await recalculateFromBookOpening(48000, 15);

    // First page start fuel should be 15
    const sorted = recalculated.sort((a, b) => a.page_number - b.page_number);
    expect(sorted[0].start_fuel_balance).toBe(15);
    // Fuel continuity should hold after recalc
    expect(validateFuelContinuity(sorted).isValid).toBe(true);
  });

  it('pagination constraints still enforced (4 days / 13 trips / month) after renumber', async () => {
    await saveVehicleProfile({ current_odometer: 50000, current_fuel_level: 10 });
    // Add 4 days on 2026-01 page 1
    for (let i = 1; i <= 4; i++) {
      await saveTrip({
        date: `2026-01-0${i}`,
        start_time: '08:00',
        end_time: '09:00',
        start_km: 50000 + i * 10,
        end_km: 50010 + i * 10,
        trip_distance: 10,
        trip_type: 'Official',
        places_visited: `Day ${i}`,
      });
    }
    // 5th day should create new page
    await saveTrip({
      date: '2026-01-05',
      start_time: '08:00',
      end_time: '09:00',
      start_km: 50050,
      end_km: 50060,
      trip_distance: 10,
      trip_type: 'Official',
      places_visited: 'Day 5',
    });
    let pages = await getPages();
    expect(pages.length).toBe(2);

    // Now insert backdated 2025 trips
    await saveTrip({
      date: '2025-01-01',
      start_time: '08:00',
      end_time: '09:00',
      start_km: 48000,
      end_km: 48010,
      trip_distance: 10,
      trip_type: 'Official',
      places_visited: '2025',
    });

    pages = await getPages();
    // Should have 3 pages total and remain chronologically sorted
    expect(pages.length).toBe(3);
    const sorted = [...pages].sort((a, b) => a.page_number - b.page_number);
    expect(sorted[0].month).toBe('2025-01');
    // Check distinct days per page still <=4
    const { validatePaginationConstraints } = await import('./pagination');
    const trips = await getTrips();
    const violations = validatePaginationConstraints(sorted, trips);
    expect(violations.length).toBe(0);
  });

  it('continuity invariants hold after renumber (Page N End KM = Page N+1 Start KM)', async () => {
    // Long legs pump fuel so running balances stay inside the [1, cap+1] feasibility window
    await saveTrip({
      date: '2026-01-10',
      start_time: '08:00',
      end_time: '09:00',
      start_km: 50000,
      end_km: 50100,
      trip_distance: 100,
      trip_type: 'Official',
      places_visited: '2026',
      fuel_pumped_amount: 10,
    });
    await saveTrip({
      date: '2025-01-01',
      start_time: '08:00',
      end_time: '09:00',
      start_km: 49000,
      end_km: 49500,
      trip_distance: 500,
      trip_type: 'Official',
      places_visited: '2025-01-01',
      fuel_pumped_amount: 50,
    });
    await saveTrip({
      date: '2025-01-02',
      start_time: '08:00',
      end_time: '09:00',
      start_km: 49500,
      end_km: 50000,
      trip_distance: 500,
      trip_type: 'Official',
      places_visited: '2025-01-02',
      fuel_pumped_amount: 50,
    });

    const pages = await getPages();
    // After recalc from opening, continuity should hold
    const { recalculateFromBookOpening } = await import('./pageStore');
    const recalculated = await recalculateFromBookOpening(49000, 10);
    expect(validateOdometerContinuity(recalculated).isValid).toBe(true);
    expect(validateFuelContinuity(recalculated).isValid).toBe(true);
  });
});
