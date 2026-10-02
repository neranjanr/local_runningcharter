import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AllTripsMasterTable } from './AllTripsMasterTable';
import type { BookPage, Trip } from '@/types';

vi.mock('@/lib/vehicleStore', () => ({
  getVehicleProfile: vi.fn().mockResolvedValue({ id: 'veh-1', current_odometer: 100, current_fuel_level: 40, tank_capacity: 75 }),
  saveVehicleProfile: vi.fn().mockResolvedValue({}),
}));
vi.mock('@/lib/pageStore', () => ({
  getPages: vi.fn().mockResolvedValue([]),
  savePage: vi.fn().mockResolvedValue(undefined),
  rebuildLedger: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/tripStore', () => ({
  getTrips: vi.fn().mockResolvedValue([]),
  updateTrip: vi.fn().mockResolvedValue(undefined),
  deleteTrip: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/leaveStore', () => ({ getLeaves: vi.fn().mockResolvedValue([]), saveLeave: vi.fn().mockResolvedValue(undefined) }));

function trip(over: Partial<Trip> & { id: string; date: string }): Trip {
  const base: Trip = {
    id: over.id, page_id: over.page_id ?? 'page-1', vehicle_id: 'veh-1', date: over.date,
    day_index: over.day_index ?? 1, trip_index: over.trip_index ?? 1, start_time: '08:00', end_time: '09:00',
    start_km: over.start_km ?? 0, end_km: over.end_km ?? 0, trip_distance: over.trip_distance ?? 0,
    trip_type: 'Official', places_visited: 'A -> B', fuel_pumped_amount: 0, fuel_order_no: '',
  };
  return { ...base, ...over };
}

let fetchMock: ReturnType<typeof vi.fn>;

function importBodies(): Array<{ pages: BookPage[]; trips: Trip[] }> {
  return fetchMock.mock.calls
    .filter((c) => String(c[0]).includes('/api/import'))
    .map((c) => JSON.parse((c[1] as RequestInit).body as string));
}

async function fillGap(successorId: string) {
  fireEvent.click(screen.getByTestId(`fill-gap-chip-${successorId}`));
  await waitFor(() => expect(screen.getByTestId('gap-fill-dialog')).toBeTruthy());
  fireEvent.change(screen.getByTestId('gap-fill-end-time'), { target: { value: '10:00' } });
  fireEvent.change(screen.getByTestId('gap-fill-places'), { target: { value: 'Colombo -> Kandy' } });
  fireEvent.click(screen.getByTestId('confirm-gap-fill'));
}

describe('AllTripsMasterTable — Gap Fill', () => {
  beforeEach(() => {
    localStorage.clear();
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    vi.stubGlobal('fetch', fetchMock);
  });

  it('fills a positive gap on the current page end-to-end', async () => {
    const page: BookPage = { id: 'page-1', vehicle_id: 'veh-1', page_number: 1, month: '2024-10', start_km: 100, end_km: 240, start_fuel_balance: 40, end_fuel_balance: 30 };
    const trips: Trip[] = [
      trip({ id: 't1', date: '2024-10-21', start_km: 100, end_km: 150, trip_distance: 50, trip_index: 1 }),
      trip({ id: 't2', date: '2024-10-22', start_km: 160, end_km: 200, trip_distance: 40, trip_index: 1 }),
      trip({ id: 't3', date: '2024-10-23', start_km: 200, end_km: 240, trip_distance: 40, trip_index: 1 }),
    ];
    render(<AllTripsMasterTable trips={trips} pages={[page]} compact={false} />);
    await fillGap('t2');
    await waitFor(() => expect(importBodies().length).toBeGreaterThan(0));
    const body = importBodies().pop()!;
    const added = body.trips.find((t: Trip) => t.start_km === 150 && t.end_km === 160);
    expect(added).toBeTruthy();
    expect(added?.page_id).toBe('page-1');
    expect(screen.queryByTestId('gap-fill-error')).toBeNull();
  });

  it('assigns a gap on an older page to that page, not a non-existent new page', async () => {
    const page1: BookPage = { id: 'page-1', vehicle_id: 'veh-1', page_number: 1, month: '2024-09', start_km: 100, end_km: 240, start_fuel_balance: 40, end_fuel_balance: 30 };
    const page2: BookPage = { id: 'page-2', vehicle_id: 'veh-1', page_number: 2, month: '2024-10', start_km: 240, end_km: 400, start_fuel_balance: 30, end_fuel_balance: 20 };
    const trips: Trip[] = [
      trip({ id: 's1', page_id: 'page-1', date: '2024-09-21', start_km: 100, end_km: 150, trip_distance: 50, trip_index: 1 }),
      trip({ id: 's2', page_id: 'page-1', date: '2024-09-22', start_km: 160, end_km: 200, trip_distance: 40, trip_index: 1 }),
      trip({ id: 'o1', page_id: 'page-2', date: '2024-10-05', start_km: 240, end_km: 300, trip_distance: 60, trip_index: 1 }),
    ];
    render(<AllTripsMasterTable trips={trips} pages={[page1, page2]} compact={false} />);
    await fillGap('s2');
    await waitFor(() => expect(importBodies().length).toBeGreaterThan(0));
    const body = importBodies().pop()!;
    const added = body.trips.find((t: Trip) => t.start_km === 150 && t.end_km === 160);
    expect(added).toBeTruthy();
    expect(added?.page_id).toBe('page-1');
    // No orphan page id (e.g. page-3) is persisted alongside the trip
    expect(body.pages.map((p: BookPage) => p.id).sort()).toEqual(['page-1', 'page-2']);
    expect(screen.queryByTestId('gap-fill-error')).toBeNull();
  });
});
