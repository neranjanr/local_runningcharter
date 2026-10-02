import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AllTripsMasterTable } from './AllTripsMasterTable';
import type { BookPage, Trip } from '@/types';
import { updateTrip } from '@/lib/tripStore';

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
    start_km: over.start_km ?? 100, end_km: over.end_km ?? 110, trip_distance: over.trip_distance ?? 10,
    trip_type: 'Official', places_visited: 'A -> B', fuel_pumped_amount: 0, fuel_order_no: '',
  };
  return { ...base, ...over };
}
const page: BookPage = { id: 'page-1', vehicle_id: 'veh-1', page_number: 1, month: '2024-10', start_km: 100, end_km: 110, start_fuel_balance: 40, end_fuel_balance: 39 };

function renderOneTrip() {
  render(<AllTripsMasterTable trips={[trip({ id: 't1', date: '2024-10-21' })]} pages={[page]} compact={false} />);
  const row = screen.getByTestId('trip-row-t1');
  fireEvent.click(within(row).getByText('100'));
  const input = screen.getByDisplayValue('100') as HTMLInputElement;
  fireEvent.change(input, { target: { value: '102' } });
  return input;
}

describe('AllTripsMasterTable — inline edit confirm', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
  });

  it('plain Enter opens the Confirm Save dialog instead of saving', async () => {
    const input = renderOneTrip();
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.getByText('Confirm Save')).toBeTruthy());
    expect(updateTrip).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Save Changes'));
    await waitFor(() => expect(updateTrip).toHaveBeenCalledWith('t1', expect.objectContaining({ start_km: 102 })));
  });

  it('Ctrl+Enter saves directly without the Confirm Save dialog', async () => {
    const input = renderOneTrip();
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(updateTrip).toHaveBeenCalledWith('t1', expect.objectContaining({ start_km: 102 })));
    expect(screen.queryByText('Confirm Save')).toBeNull();
    expect(updateTrip).toHaveBeenCalledTimes(1);
  });
});
