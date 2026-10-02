/**
  * Two-Color Continuity Gaps & Alerts Engine (Phase 3 #06 / Spec section 30-33)
  * Pure functions for detecting Page-to-Page and Trip-to-Trip KM (RED) and Fuel (AMBER) gaps.
  */
import type { BookPage, Trip } from '@/types';
import type { LedgerDay } from '@/lib/ledgerCalculations';
import { roundToIntegerKm, roundToOneDecimal } from './tripCalculations';

export interface PageGap {
  kind: 'km' | 'fuel';
  pageNumber: number;
  expected: number;
  actual: number;
  message: string;
}

export interface TripGap {
  kind: 'km' | 'fuel';
  tripId?: string;
  date: string;
  expected: number;
  actual: number;
  message: string;
}

export function detectPageGaps(pages: BookPage[]): PageGap[] {
  const sorted = [...pages].sort((a, b) => a.page_number - b.page_number);
  const gaps: PageGap[] = [];

  for (let i = 0; i < sorted.length - 1; i++) {
    const cur = sorted[i];
    const next = sorted[i + 1];

    const expectedKm = roundToIntegerKm(cur.end_km);
    const actualKm = roundToIntegerKm(next.start_km);
    if (expectedKm !== actualKm) {
      gaps.push({
        kind: 'km',
        pageNumber: next.page_number,
        expected: expectedKm,
        actual: actualKm,
        message: `Page ${next.page_number} Start KM (${actualKm}) does not match Page ${cur.page_number} End KM (${expectedKm})`,
      });
    }

    const expectedFuel = roundToOneDecimal(cur.end_fuel_balance);
    const actualFuel = roundToOneDecimal(next.start_fuel_balance);
    if (expectedFuel !== actualFuel) {
      gaps.push({
        kind: 'fuel',
        pageNumber: next.page_number,
        expected: expectedFuel,
        actual: actualFuel,
        message: `Page ${next.page_number} Start Fuel (${actualFuel} L) does not match Page ${cur.page_number} End Fuel (${expectedFuel} L)`,
      });
    }
  }

  return gaps;
}

export function detectTripGaps(trips: Trip[]): TripGap[] {
  const sorted = [...trips].sort((a, b) => a.date.localeCompare(b.date) || a.start_km - b.start_km);
  const gaps: TripGap[] = [];

  for (let i = 0; i < sorted.length - 1; i++) {
    const cur = sorted[i];
    const next = sorted[i + 1];

    const expectedEnd = roundToIntegerKm(cur.end_km);
    const actualStart = roundToIntegerKm(next.start_km);
    if (expectedEnd !== actualStart) {
      gaps.push({
        kind: 'km',
        tripId: next.id,
        date: next.date,
        expected: expectedEnd,
        actual: actualStart,
        message: `Trip on ${next.date} Start KM (${actualStart}) does not match previous Trip End KM (${expectedEnd})`,
      });
    }
  }

  return gaps;
}

export interface FuelGap {
  kind: 'fuel';
  date: string;
  dayIndex: number;
  expected: number;
  actual: number;
  message: string;
}

export function detectDayGroupFuelGaps(ledgerDays: LedgerDay[]): FuelGap[] {
  if (ledgerDays.length < 2) return [];
  const gaps: FuelGap[] = [];

  for (let i = 0; i < ledgerDays.length - 1; i++) {
    const cur = ledgerDays[i];
    const next = ledgerDays[i + 1];

    const expectedBalance = roundToOneDecimal(cur.balance);
    const actualPosition = roundToOneDecimal(next.fuelPosition);
    if (expectedBalance !== actualPosition) {
      gaps.push({
        kind: 'fuel',
        date: next.date,
        dayIndex: next.dayIndex,
        expected: expectedBalance,
        actual: actualPosition,
        message: `Day ${next.dayIndex} (${next.date}) Fuel Position (${actualPosition} L) does not match previous Day closing Balance (${expectedBalance} L)`,
      });
    }
  }

  return gaps;
}

/**
 * Split calculation chains into independent islands (Island Before Gap, Island After Gap)
 * based on odometer discontinuities (end_km != next.start_km).
 */
export function splitTripsIntoIslands(trips: Trip[]): Trip[][] {
  if (!trips || trips.length === 0) return [];
  const sorted = [...trips].sort((a, b) => a.date.localeCompare(b.date) || a.start_km - b.start_km);
  const islands: Trip[][] = [];
  let currentIsland: Trip[] = [sorted[0]];

  for (let i = 0; i < sorted.length - 1; i++) {
    const cur = sorted[i];
    const next = sorted[i + 1];
    const expectedEnd = roundToIntegerKm(cur.end_km);
    const actualStart = roundToIntegerKm(next.start_km);

    if (expectedEnd !== actualStart) {
      islands.push(currentIsland);
      currentIsland = [next];
    } else {
      currentIsland.push(next);
    }
  }
  if (currentIsland.length > 0) {
    islands.push(currentIsland);
  }
  return islands;
}
