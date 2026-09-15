import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import QuickTripForm from './QuickTripForm';

vi.mock('@/lib/tripStore', () => ({
  getLastEndKm: vi.fn().mockResolvedValue(12500.0),
  saveTrip: vi.fn().mockResolvedValue({ id: 'trip-1' }),
  getTrips: vi.fn().mockResolvedValue([]),
  clearTrips: vi.fn(),
}));

vi.mock('@/lib/tripCalculations', async () => {
  const actual = await vi.importActual('@/lib/tripCalculations') as any;
  return {
    ...actual,
    getTodayDateString: vi.fn().mockReturnValue('2024-10-21'),
    getCurrentTimeString: vi.fn().mockReturnValue('09:30'),
  };
});

describe('QuickTripForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('auto-selects today date and displays day of week', async () => {
    render(<QuickTripForm />);
    await waitFor(() => {
      const dateInput = screen.getByLabelText(/Date/i) as HTMLInputElement;
      expect(dateInput.value).toBe('2024-10-21');
    });
    // Monday for 2024-10-21
    expect(screen.getByText(/Monday/i)).toBeInTheDocument();
  });

  it('updates day of week when date changes', async () => {
    render(<QuickTripForm />);
    await waitFor(() => expect((screen.getByLabelText(/Date/i) as HTMLInputElement).value).toBe('2024-10-21'));
    const dateInput = screen.getByLabelText(/Date/i) as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: '2024-10-22' } });
    await waitFor(() => {
      expect(screen.getByText(/Tuesday/i)).toBeInTheDocument();
    });
  });

  it('auto-defaults Start KM to previous End KM with visual highlighting', async () => {
    render(<QuickTripForm />);
    await waitFor(() => {
      const startKm = screen.getByLabelText(/Start KM/i) as HTMLInputElement;
      expect(startKm.value).toBe('12500');
    });
    // Visual highlighting: badge text
    expect(screen.getByText(/Auto-filled from last End KM/i)).toBeInTheDocument();
  });

  it('shows manual override indicator after editing Start KM', async () => {
    render(<QuickTripForm />);
    await waitFor(() => expect((screen.getByLabelText(/Start KM/i) as HTMLInputElement).value).toBe('12500'));
    const startKm = screen.getByLabelText(/Start KM/i) as HTMLInputElement;
    fireEvent.change(startKm, { target: { value: '12600' } });
    await waitFor(() => {
      expect(screen.getByText(/Manual override/i)).toBeInTheDocument();
    });
  });

  it('reciprocal odometer: entering End KM calculates Trip Distance', async () => {
    render(<QuickTripForm />);
    await waitFor(() => expect((screen.getByLabelText(/Start KM/i) as HTMLInputElement).value).toBe('12500'));
    const endKm = screen.getByLabelText(/End KM/i) as HTMLInputElement;
    fireEvent.change(endKm, { target: { value: '12550' } });
    await waitFor(() => {
      const distance = screen.getByLabelText(/Trip Distance/i) as HTMLInputElement;
      expect(distance.value).toBe('50');
    });
  });

  it('reciprocal odometer: entering Trip Distance calculates End KM', async () => {
    render(<QuickTripForm />);
    await waitFor(() => expect((screen.getByLabelText(/Start KM/i) as HTMLInputElement).value).toBe('12500'));
    const distance = screen.getByLabelText(/Trip Distance/i) as HTMLInputElement;
    fireEvent.change(distance, { target: { value: '24' } });
    await waitFor(() => {
      const endKm = screen.getByLabelText(/End KM/i) as HTMLInputElement;
      expect(endKm.value).toBe('12524');
    });
  });

  it('integer KM: distance 24.3 rounds to int 24 and End KM integer', async () => {
    render(<QuickTripForm />);
    await waitFor(() => expect((screen.getByLabelText(/Start KM/i) as HTMLInputElement).value).toBe('12500'));
    const distance = screen.getByLabelText(/Trip Distance/i) as HTMLInputElement;
    fireEvent.change(distance, { target: { value: '24.3' } });
    await waitFor(() => {
      const endKm = screen.getByLabelText(/End KM/i) as HTMLInputElement;
      // 24.3 rounds to 24 via integer KM engine
      expect(endKm.value).toBe('12524');
    });
  });

  it('defaults End Time to current time', async () => {
    render(<QuickTripForm />);
    await waitFor(() => {
      const endTime = screen.getByLabelText(/End Time/i) as HTMLInputElement;
      expect(endTime.value).toBe('09:30');
    });
  });

  it('reciprocal time: entering Duration calculates Start Time', async () => {
    render(<QuickTripForm />);
    await waitFor(() => expect((screen.getByLabelText(/End Time/i) as HTMLInputElement).value).toBe('09:30'));
    const duration = screen.getByLabelText(/Duration/i) as HTMLInputElement;
    fireEvent.change(duration, { target: { value: '00:55' } });
    await waitFor(() => {
      const startTime = screen.getByLabelText(/Start Time/i) as HTMLInputElement;
      expect(startTime.value).toBe('08:35');
    });
  });

  it('reciprocal time: entering Start Time calculates Duration', async () => {
    render(<QuickTripForm />);
    await waitFor(() => expect((screen.getByLabelText(/End Time/i) as HTMLInputElement).value).toBe('09:30'));
    const startTime = screen.getByLabelText(/Start Time/i) as HTMLInputElement;
    fireEvent.change(startTime, { target: { value: '08:15' } });
    await waitFor(() => {
      const duration = screen.getByLabelText(/Duration/i) as HTMLInputElement;
      expect(duration.value).toBe('01:15');
    });
  });

  it('defaults trip type to Official and allows switching to Private', async () => {
    render(<QuickTripForm />);
    await waitFor(() => expect(screen.getByLabelText(/Official/i)).toBeInTheDocument());
    const official = screen.getByLabelText(/Official/i) as HTMLInputElement;
    const privateRadio = screen.getByLabelText(/Private/i) as HTMLInputElement;
    expect(official.checked).toBe(true);
    expect(privateRadio.checked).toBe(false);
    fireEvent.click(privateRadio);
    expect(privateRadio.checked).toBe(true);
  });

  it('has fuel pumped and fuel order fields', async () => {
    render(<QuickTripForm />);
    await waitFor(() => expect((screen.getByLabelText(/Start KM/i) as HTMLInputElement).value).toBe('12500'));
    expect(screen.getByLabelText(/Fuel Pumped/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Fuel Order No/i)).toBeInTheDocument();
  });

  it('submits trip data', async () => {
    const { saveTrip } = await import('@/lib/tripStore');
    render(<QuickTripForm />);
    await waitFor(() => expect((screen.getByLabelText(/Start KM/i) as HTMLInputElement).value).toBe('12500'));

    const places = screen.getByLabelText(/Places Visited/i) as HTMLInputElement;
    fireEvent.change(places, { target: { value: 'HQ -> Port' } });

    const endKm = screen.getByLabelText(/End KM/i) as HTMLInputElement;
    fireEvent.change(endKm, { target: { value: '12530' } });
    await waitFor(() => expect((screen.getByLabelText(/Trip Distance/i) as HTMLInputElement).value).toBe('30'));

    // need start time for validation
    const startTime = screen.getByLabelText(/Start Time/i) as HTMLInputElement;
    fireEvent.change(startTime, { target: { value: '08:15' } });
    await waitFor(() => expect((screen.getByLabelText(/Start Time/i) as HTMLInputElement).value).toBe('08:15'));

    // Places visited required; fill it and submit
    const submit = screen.getByRole('button', { name: /Save Trip/i });
    fireEvent.click(submit);

    await waitFor(() => {
      expect(saveTrip).toHaveBeenCalledWith(
        expect.objectContaining({
          start_km: 12500,
          end_km: 12530,
          trip_distance: 30,
          places_visited: 'HQ -> Port',
          trip_type: 'Official',
        })
      );
    });
  });

  it('allows saving without Start Time (nullable) - persists empty string', async () => {
    const { saveTrip } = await import('@/lib/tripStore');
    render(<QuickTripForm />);
    await waitFor(() => expect((screen.getByLabelText(/Start KM/i) as HTMLInputElement).value).toBe('12500'));
    const places = screen.getByLabelText(/Places Visited/i) as HTMLInputElement;
    fireEvent.change(places, { target: { value: 'HQ -> Port' } });
    const endKm = screen.getByLabelText(/End KM/i) as HTMLInputElement;
    fireEvent.change(endKm, { target: { value: '12540' } });
    await waitFor(() => expect((screen.getByLabelText(/Trip Distance/i) as HTMLInputElement).value).toBe('40'));
    // After distance change, start was auto-estimated; clear it to test nullable save
    const startTime = screen.getByLabelText(/Start Time/i) as HTMLInputElement;
    fireEvent.change(startTime, { target: { value: '' } });
    await waitFor(() => expect(startTime.value).toBe(''));
    const submit = screen.getByRole('button', { name: /Save Trip/i });
    fireEvent.click(submit);
    await waitFor(() => {
      expect(saveTrip).toHaveBeenCalledWith(
        expect.objectContaining({
          start_time: '',
          end_time: '09:30',
          start_km: 12500,
          end_km: 12540,
          trip_distance: 40,
        })
      );
    });
  });

  it('auto-suggests Estimated Start Time when Distance and End Time present and Start Time empty', async () => {
    render(<QuickTripForm />);
    await waitFor(() => expect((screen.getByLabelText(/Start KM/i) as HTMLInputElement).value).toBe('12500'));
    // Ensure Start Time is empty
    const startTime = screen.getByLabelText(/Start Time/i) as HTMLInputElement;
    expect(startTime.value).toBe('');
    // Enter distance 9 km => <10→15 => 36 min ceiled to 40 => with end 09:30 => start 08:50
    const distance = screen.getByLabelText(/Trip Distance/i) as HTMLInputElement;
    fireEvent.change(distance, { target: { value: '9' } });
    await waitFor(() => {
      expect(screen.getByLabelText(/Start Time/i)).toHaveValue('08:50');
    });
  });

  it('Auto button recomputes Estimated Start Time even when Start Time filled', async () => {
    render(<QuickTripForm />);
    await waitFor(() => expect((screen.getByLabelText(/Start KM/i) as HTMLInputElement).value).toBe('12500'));
    const startTime = screen.getByLabelText(/Start Time/i) as HTMLInputElement;
    fireEvent.change(startTime, { target: { value: '08:00' } });
    await waitFor(() => expect(startTime.value).toBe('08:00'));
    const distance = screen.getByLabelText(/Trip Distance/i) as HTMLInputElement;
    fireEvent.change(distance, { target: { value: '10' } });
    // Start already filled, so auto-suggest should NOT clobber
    await waitFor(() => expect(startTime.value).toBe('08:00'));
    // Click Auto button should recompute to 09:00 (end 09:30 - 30 min)
    const autoBtn = screen.getByLabelText(/Auto/i);
    fireEvent.click(autoBtn);
    await waitFor(() => expect(startTime.value).toBe('09:00'));
  });

  it('manual edit to Start Time is not auto-clobbered by distance change when already filled', async () => {
    render(<QuickTripForm />);
    await waitFor(() => expect((screen.getByLabelText(/Start KM/i) as HTMLInputElement).value).toBe('12500'));
    const startTime = screen.getByLabelText(/Start Time/i) as HTMLInputElement;
    fireEvent.change(startTime, { target: { value: '07:30' } });
    await waitFor(() => expect(startTime.value).toBe('07:30'));
    const distance = screen.getByLabelText(/Trip Distance/i) as HTMLInputElement;
    fireEvent.change(distance, { target: { value: '9' } });
    // Should remain 07:30, not auto-estimated
    await waitFor(() => expect(startTime.value).toBe('07:30'));
  });

  it('has Auto button in time section', async () => {
    render(<QuickTripForm />);
    await waitFor(() => expect((screen.getByLabelText(/Start KM/i) as HTMLInputElement).value).toBe('12500'));
    expect(screen.getByLabelText(/Auto/i)).toBeInTheDocument();
  });
});
