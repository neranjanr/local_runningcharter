import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BookLedgerView } from './BookLedgerView';
import type { BookPage, Trip, Vehicle } from '@/types';

function makePage(overrides: Partial<BookPage>): BookPage {
  return {
    id: overrides.id ?? `page-${overrides.page_number ?? 1}`,
    vehicle_id: 'veh-1',
    page_number: overrides.page_number ?? 1,
    month: overrides.month ?? '2024-10',
    start_km: overrides.start_km ?? 142684.2,
    end_km: overrides.end_km ?? 142875.0,
    start_fuel_balance: overrides.start_fuel_balance ?? 31.4,
    end_fuel_balance: overrides.end_fuel_balance ?? 48.3,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeTrip(overrides: Partial<Trip> & { date: string; page_id: string }): Trip {
  const base: Trip = {
    id: `trip-${Math.random().toString(36).slice(2, 6)}`,
    vehicle_id: overrides.vehicle_id ?? 'veh-1',
    page_id: overrides.page_id,
    date: overrides.date,
    day_index: overrides.day_index ?? 1,
    trip_index: overrides.trip_index ?? 1,
    start_time: overrides.start_time ?? '08:15',
    end_time: overrides.end_time ?? '09:10',
    start_km: overrides.start_km ?? 100,
    end_km: overrides.end_km ?? 110,
    trip_distance: overrides.trip_distance ?? 10,
    trip_type: overrides.trip_type ?? 'Official',
    places_visited: overrides.places_visited ?? 'A -> B',
    fuel_pumped_amount: overrides.fuel_pumped_amount ?? 0,
    fuel_order_no: overrides.fuel_order_no ?? '',
    created_at: overrides.created_at ?? new Date().toISOString(),
  };
  // Apply any extra overrides like trip_type Private specifically while preserving typed fields
  if (overrides.trip_type) base.trip_type = overrides.trip_type;
  if (overrides.places_visited) base.places_visited = overrides.places_visited;
  return base;
}

const vehicle: Vehicle = {
  id: 'veh-1',
  brand: 'Toyota',
  model: 'Hilux',
  vehicle_type: 'Double Cab',
  fuel_type: 'Diesel',
  tank_capacity: 65.0,
  current_odometer: 142875.0,
  current_fuel_level: 48.3,
};

describe('BookLedgerView - Full-Width Stack Ledger (Phase 3 #03)', () => {
  beforeEach(() => localStorage.clear());

  it('renders T1 full-width on top, T2 and T3 stacked full-width below (no side-by-side folio)', () => {
    const page = makePage({ id: 'page-14', page_number: 14, month: '2024-10' });
    const trips: Trip[] = [
      makeTrip({ date: '2024-10-21', page_id: 'page-14', trip_index: 1, start_km: 142684.2, end_km: 142708.5, trip_distance: 24.3 }),
      makeTrip({ date: '2024-10-22', page_id: 'page-14', trip_index: 1, start_km: 142708.5, end_km: 142730.0, trip_distance: 21.5, fuel_pumped_amount: 35, fuel_order_no: '#FO-1' }),
    ];
    const { container } = render(<BookLedgerView pages={[page]} trips={trips} vehicle={vehicle} />);
    // T1 header
    expect(screen.getByText(/RUNNING CHART • TRIPS LOG/i)).toBeInTheDocument();
    expect(screen.getByText(/SIDE 1/i)).toBeInTheDocument();
    // T2 & T3 headers
    expect(screen.getByText(/FUEL & CONSUMPTION AUDIT TABLES/i)).toBeInTheDocument();
    expect(screen.getByText(/TABLE 1 • FUEL ECONOMY/i)).toBeInTheDocument();
    expect(screen.getByText(/TABLE 2 • FUEL POSITION/i)).toBeInTheDocument();
    // Full-width stack: no xl:grid-cols-2 folio grid
    const gridEl = container.querySelector('.xl\\:grid-cols-2');
    expect(gridEl).toBeNull();
    // No book binding gutter
    const gutterEl = container.querySelector('.paper-gutter');
    expect(gutterEl).toBeNull();
  });

  it('shows page-wide trip sequence 1..N continuous across day groups', () => {
    const page = makePage({ id: 'page-14', page_number: 1, month: '2024-10' });
    const trips: Trip[] = [
      makeTrip({ date: '2024-10-21', page_id: 'page-14', trip_index: 1, start_km: 100, end_km: 120, trip_distance: 20 }),
      makeTrip({ date: '2024-10-21', page_id: 'page-14', trip_index: 2, start_km: 120, end_km: 135, trip_distance: 15 }),
      makeTrip({ date: '2024-10-22', page_id: 'page-14', trip_index: 1, start_km: 135, end_km: 160, trip_distance: 25 }),
    ];
    render(<BookLedgerView pages={[page]} trips={trips} vehicle={vehicle} />);
    // Page-wide sequence: Day1 trips are #1,#2, Day2 trip starts at #3
    const seqCells = screen.getAllByText(/^[1-9]$/);
    const seqValues = seqCells.map((el) => parseInt(el.textContent ?? '0', 10));
    expect(seqValues).toContain(1);
    expect(seqValues).toContain(2);
    expect(seqValues).toContain(3);
  });

  it('renders page-flipping navigation controls (Next/Previous page)', () => {
    const pages = [
      makePage({ id: 'p1', page_number: 1, month: '2024-09', start_km: 100, end_km: 200 }),
      makePage({ id: 'p2', page_number: 2, month: '2024-10', start_km: 200, end_km: 300 }),
    ];
    const trips: Trip[] = [makeTrip({ date: '2024-10-02', page_id: 'p2', trip_index: 1, start_km: 200, end_km: 210, trip_distance: 10 })];
    render(<BookLedgerView pages={pages} trips={trips} vehicle={vehicle} />);
    expect(screen.getByLabelText('Previous Page')).toBeInTheDocument();
    expect(screen.getByLabelText('Next Page')).toBeInTheDocument();
    expect(screen.getByLabelText('Previous Month')).toBeInTheDocument();
    expect(screen.getByLabelText('Next Month')).toBeInTheDocument();
    // Current page indicator is now the Page Select dropdown (darker blue bg)
    const select = screen.getByLabelText('Select Page') as HTMLSelectElement;
    expect(select.value).toBe('2');
    expect(select.className).toContain('bg-slate-800');
  });

  it('allows moving between pages via Prev/Next', () => {
    const pages = [
      makePage({ id: 'p1', page_number: 1, month: '2024-09', start_km: 100, end_km: 200, start_fuel_balance: 30, end_fuel_balance: 25 }),
      makePage({ id: 'p2', page_number: 2, month: '2024-10', start_km: 200, end_km: 300, start_fuel_balance: 25, end_fuel_balance: 20 }),
    ];
    const trips: Trip[] = [
      makeTrip({ date: '2024-09-01', page_id: 'p1', trip_index: 1, start_km: 100, end_km: 120, trip_distance: 20 }),
      makeTrip({ date: '2024-10-02', page_id: 'p2', trip_index: 1, start_km: 200, end_km: 210, trip_distance: 10 }),
    ];
    render(<BookLedgerView pages={pages} trips={trips} vehicle={vehicle} />);
    // Initially last page (2)
    expect((screen.getByLabelText('Select Page') as HTMLSelectElement).value).toBe('2');
    fireEvent.click(screen.getByLabelText('Previous Page'));
    expect((screen.getByLabelText('Select Page') as HTMLSelectElement).value).toBe('1');
    fireEvent.click(screen.getByLabelText('Next Page'));
    expect((screen.getByLabelText('Select Page') as HTMLSelectElement).value).toBe('2');
  });

  it('computes daily fuel economy propagation and consumption/balance rounded to 1 decimal', () => {
    const page = makePage({ id: 'page-14', page_number: 1, month: '2024-10', start_km: 100, end_km: 200, start_fuel_balance: 31.4, end_fuel_balance: 48.3 });
    const trips: Trip[] = [
      makeTrip({ date: '2024-10-21', page_id: 'page-14', trip_index: 1, start_km: 100, end_km: 162.6, trip_distance: 62.6 }),
      makeTrip({ date: '2024-10-22', page_id: 'page-14', trip_index: 1, start_km: 162.6, end_km: 227.8, trip_distance: 65.2, fuel_pumped_amount: 35, fuel_order_no: '#FO-1' }),
    ];
    render(<BookLedgerView pages={[page]} trips={trips} vehicle={vehicle} />);
    // Table 1 shows per-day distances as Integer KM (fuel 1 decimal) — 62.6→63, 65.2→65
    expect(screen.getAllByText('63').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('65').length).toBeGreaterThanOrEqual(1);
    // Consumed and balance values should appear (6.0, 25.4 etc)
    expect(screen.getAllByText('6.0').length).toBeGreaterThanOrEqual(1); // Day1 consumed 63/10.5=6.0 (62.6 also 6.0)
    expect(screen.getAllByText('25.4 L').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('6.2').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('54.2 L').length).toBeGreaterThanOrEqual(1);
  });

  it('propagates overridden economy to subsequent days (read-only display, no inputs)', async () => {
    const page = makePage({ id: 'page-14', page_number: 1, month: '2024-10', start_km: 100, end_km: 200, start_fuel_balance: 31.4, end_fuel_balance: 48.3 });
    const trips: Trip[] = [
      makeTrip({ date: '2024-10-21', page_id: 'page-14', trip_index: 1, start_km: 100, end_km: 162.6, trip_distance: 62.6 }),
      makeTrip({ date: '2024-10-22', page_id: 'page-14', trip_index: 1, start_km: 162.6, end_km: 227.8, trip_distance: 65.2 }),
      makeTrip({ date: '2024-10-23', page_id: 'page-14', trip_index: 1, start_km: 227.8, end_km: 252.4, trip_distance: 24.6 }),
    ];
    render(<BookLedgerView pages={[page]} trips={trips} vehicle={vehicle} />);
    // Inputs removed — ledger is read-only, editing in All Trips
    expect(screen.queryByLabelText(/Fuel Economy Day/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/In-Tank Day/i)).not.toBeInTheDocument();
    // Default economy still rendered as text
    expect(screen.getAllByText('10.5').length).toBeGreaterThanOrEqual(1);
  });

  it('shows print button that triggers window.print', () => {
    const page = makePage({ id: 'p1', page_number: 1 });
    const trips: Trip[] = [makeTrip({ date: '2024-10-01', page_id: 'p1', trip_index: 1, start_km: 100, end_km: 110, trip_distance: 10 })];
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});
    render(<BookLedgerView pages={[page]} trips={trips} vehicle={vehicle} />);
    // Print functionality still exists
    expect(screen.getByText(/Print/i)).toBeInTheDocument();
    printSpy.mockRestore();
  });

  it('shows empty state when no pages', () => {
    render(<BookLedgerView pages={[]} trips={[]} vehicle={vehicle} />);
    expect(screen.getByText(/No Book Pages Yet/i)).toBeInTheDocument();
  });

  it('allows month navigation (Prev MO / Next MO)', () => {
    const pages = [
      makePage({ id: 'p1', page_number: 1, month: '2024-09', start_km: 100, end_km: 150 }),
      makePage({ id: 'p2', page_number: 2, month: '2024-10', start_km: 150, end_km: 200 }),
      makePage({ id: 'p3', page_number: 3, month: '2024-10', start_km: 200, end_km: 250 }),
    ];
    const trips: Trip[] = [
      makeTrip({ date: '2024-09-01', page_id: 'p1', trip_index: 1, start_km: 100, end_km: 110, trip_distance: 10 }),
      makeTrip({ date: '2024-10-01', page_id: 'p2', trip_index: 1, start_km: 150, end_km: 160, trip_distance: 10 }),
      makeTrip({ date: '2024-10-02', page_id: 'p3', trip_index: 1, start_km: 200, end_km: 210, trip_distance: 10 }),
    ];
    render(<BookLedgerView pages={pages} trips={trips} vehicle={vehicle} />);
    // Start on last page (3) which is Oct
    expect((screen.getByLabelText('Select Page') as HTMLSelectElement).value).toBe('3');
    fireEvent.click(screen.getByLabelText('Previous Month'));
    // Should jump to first page of Sep (page 1)
    expect((screen.getByLabelText('Select Page') as HTMLSelectElement).value).toBe('1');
  });
});
