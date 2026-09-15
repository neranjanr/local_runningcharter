/**
  * All Trips Workbook Contract (Phase 3 #05 / Spec section 26-28)
  * Pure utilities for exporting and importing the All Trips master workbook.
  */
import ExcelJS from 'exceljs';
import type { Trip, BookPage } from '@/types';
import { estimateStartTime, roundToIntegerKm, roundToOneDecimal } from './tripCalculations';
import {
  assignPageForNewTrip,
  isBackdatedInsertion,
  renumberPagesChronologically,
  recalculatePageBalancesFromOpening,
  MAX_TRIPS_PER_DAY,
  getMonthKey,
} from './pagination';
import type { BookOpening } from './pagination';

export const ALL_TRIPS_HEADERS = [
  'Date',
  'Start KM',
  'End KM',
  'Distance',
  'Start Time',
  'End Time',
  'Private / Official',
  'Places Visited',
  'Fuel Pumped',
  'Fuel Order No',
];

export function getAllTripsFileName(vehicle?: { brand: string; model: string } | null, dateStr?: string): string {
  const datePart = dateStr ?? new Date().toISOString().slice(0, 10);
  if (!vehicle) return `AllTrips_${datePart}.xlsx`;
  const safeBrand = vehicle.brand.replace(/\s+/g, '_');
  const safeModel = vehicle.model.replace(/\s+/g, '_');
  return `AllTrips_${safeBrand}_${safeModel}_${datePart}.xlsx`;
}

export function generateAllTripsWorkbook(trips: Trip[], vehicle?: { brand: string; model: string; registration_no?: string } | null): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'FleetLedger';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('All Trips', {
    properties: { tabColor: { argb: '0EA5E9' } },
  });

  sheet.columns = [
    { key: 'date', width: 12 },
    { key: 'startKm', width: 12 },
    { key: 'endKm', width: 12 },
    { key: 'distance', width: 12 },
    { key: 'startTime', width: 12 },
    { key: 'endTime', width: 12 },
    { key: 'type', width: 12 },
    { key: 'placesVisited', width: 28 },
    { key: 'fuelPumped', width: 14 },
    { key: 'fuelOrderNo', width: 16 },
  ];

  // Header row
  const headerRow = sheet.addRow(ALL_TRIPS_HEADERS);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } } as ExcelJS.Fill;
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
  headerRow.height = 18;

  const sortedTrips = [...trips].sort((a, b) => a.date.localeCompare(b.date) || a.start_km - b.start_km);

  for (const t of sortedTrips) {
    const row = sheet.addRow([
      t.date,
      roundToIntegerKm(t.start_km),
      roundToIntegerKm(t.end_km),
      roundToIntegerKm(t.trip_distance),
      t.start_time ?? '',
      t.end_time,
      t.trip_type ?? 'Official',
      t.places_visited,
      t.fuel_pumped_amount ? roundToOneDecimal(t.fuel_pumped_amount) : 0,
      t.fuel_order_no ?? '',
    ]);

    row.eachCell((cell, colNum) => {
      cell.font = { size: 9 };
      if (colNum === 2 || colNum === 3 || colNum === 4) {
        cell.numFmt = '0';
        cell.alignment = { horizontal: 'right' };
      } else if (colNum === 9) {
        cell.numFmt = '0.0';
        cell.alignment = { horizontal: 'right' };
      } else if (colNum === 1 || colNum === 5 || colNum === 6 || colNum === 7) {
        cell.alignment = { horizontal: 'center' };
      } else {
        cell.alignment = { horizontal: 'left' };
      }
    });
    row.height = 14;
  }

  sheet.pageSetup = {
    paperSize: 9,
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
  };

  return workbook;
}

export async function generateAllTripsBuffer(trips: Trip[], vehicle?: { brand: string; model: string; registration_no?: string } | null): Promise<ArrayBuffer> {
  const wb = generateAllTripsWorkbook(trips, vehicle);
  const buf = await wb.xlsx.writeBuffer();
  return buf as ArrayBuffer;
}

export interface ImportError {
  row: number;
  field: string;
  message: string;
}

export interface ImportParseResult {
  valid: boolean;
  trips: Partial<Trip>[];
  errors: ImportError[];
}

export interface ImportResult {
  success: boolean;
  appendedCount: number;
  skippedDuplicates: number;
  updatedCount: number;
  errors: ImportError[];
  pages: BookPage[];
  trips: Trip[];
}

export function parseInteger(val: any): number {
  if (val === null || val === undefined || val === '') return NaN;
  if (typeof val === 'number') return Math.round(val);
  const cleaned = String(val).replace(/,/g, '').trim();
  return parseInt(cleaned, 10);
}

export function parseFloatNum(val: any): number {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return val;
  const cleaned = String(val).replace(/,/g, '').replace(/[^\d.-]/g, '').trim();
  return parseFloat(cleaned);
}

export function parseExcelDate(v: any): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) {
    const yyyy = v.getFullYear();
    const mm = String(v.getMonth() + 1).padStart(2, '0');
    const dd = String(v.getDate()).padStart(2, '0');
    // Filter out Excel time-only dates (1899-12-30) – not a real trip date
    if (yyyy === 1899) return '';
    return `${yyyy}-${mm}-${dd}`;
  }
  if (typeof v === 'number' && v > 30000 && v < 60000) {
    const excelEpoch = new Date(1899, 11, 30);
    const d = new Date(excelEpoch.getTime() + v * 86400000);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  const str = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    const yyyy = parsed.getFullYear();
    const mm = String(parsed.getMonth() + 1).padStart(2, '0');
    const dd = String(parsed.getDate()).padStart(2, '0');
    if (yyyy >= 2000 && yyyy <= 2100) {
      return `${yyyy}-${mm}-${dd}`;
    }
  }
  return str;
}

export function parseExcelTime(v: any): string {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date) {
    // Excel time stored as Date on 1899-12-30 – use UTC to avoid TZ shift
    const hh = String(v.getUTCHours()).padStart(2, '0');
    const mm = String(v.getUTCMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }
  if (typeof v === 'number' && v >= 0 && v < 1) {
    // Excel fractional day (e.g. 0.0833 = 02:00)
    const totalMinutes = Math.round(v * 1440);
    const hh = String(Math.floor(totalMinutes / 60) % 24).padStart(2, '0');
    const mm = String(totalMinutes % 60).padStart(2, '0');
    return `${hh}:${mm}`;
  }
  const str = String(v).trim();
  // Already HH:MM or HH:MM:SS
  const m = str.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (m) return `${m[1].padStart(2, '0')}:${m[2]}`;
  // Locale long date string from Date.toString fallback – try Date parse
  const d = new Date(str);
  if (!isNaN(d.getTime()) && d.getFullYear() === 1899) {
    return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  }
  return str;
}

const FUEL_PUMPED_ALIASES = new Set(['fuelpumped', 'fueldrawn', 'fueldraw', 'fuelpumpeddrawn', 'drawn', 'fuelpumpedl', 'fueldrawnl']);
const TYPE_ALIASES = new Set(['type', 'triptype', 'privateofficial', 'privateofficialstatus', 'status', 'triptypestatus', 'officialprivate']);

function normHeader(h: string): string { return String(h).toLowerCase().replace(/[^a-z0-9]/g, ''); }

/**
 * Validate header row is case-insensitive and order-enforced.
 * Returns true if headers match (case-insensitive, normalized).
 * Col 7 (Type) also accepts aliases Private / Official, Status etc.
 * Col 9 (Fuel Pumped) also accepts alias Fuel Drawn.
 */
export function validateHeaders(rowValues: string[]): boolean {
  const trimmed = [...rowValues];
  while (trimmed.length > 0 && String(trimmed[trimmed.length - 1]).trim() === '') {
    trimmed.pop();
  }
  if (trimmed.length !== ALL_TRIPS_HEADERS.length) return false;
  const expectedNorm = ALL_TRIPS_HEADERS.map(h => normHeader(h));
  const actualNorm = trimmed.map(v => normHeader(v));
  return expectedNorm.every((exp, idx) => {
    if (idx === 6) return actualNorm[idx] === exp || TYPE_ALIASES.has(actualNorm[idx]);
    if (idx === 8) return actualNorm[idx] === exp || FUEL_PUMPED_ALIASES.has(actualNorm[idx]);
    return actualNorm[idx] === exp;
  });
}

/**
 * Generate a duplicate key from trip fields for deduplication.
 */
export function getDuplicateKey(trip: Partial<Trip>): string {
  return `${trip.date}|${trip.start_km}|${trip.end_km}|${trip.end_time}`;
}

export function getOdoKey(trip: Partial<Trip>): string {
  const d = String(trip.date ?? '').trim();
  const s = trip.start_km !== undefined && trip.start_km !== null ? Math.round(Number(trip.start_km)) : '';
  const e = trip.end_km !== undefined && trip.end_km !== null ? Math.round(Number(trip.end_km)) : '';
  return `${d}|${s}|${e}`;
}

export async function parseAllTripsWorkbook(buffer: ArrayBuffer): Promise<ImportParseResult> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as any);
  } catch {
    return { valid: false, trips: [], errors: [{ row: 0, field: 'file', message: 'Invalid Excel file format (.xlsx required)' }] };
  }

  const sheet = workbook.getWorksheet('All Trips') || workbook.worksheets[0];
  if (!sheet) {
    return { valid: false, trips: [], errors: [{ row: 0, field: 'sheet', message: 'No sheet found in workbook' }] };
  }

  const errors: ImportError[] = [];
  const parsedTrips: Partial<Trip>[] = [];

  let headerRowIndex = 0;

  sheet.eachRow((row, rowIdx) => {
    if (headerRowIndex > 0) return;
    const vals: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell) => {
      vals.push(String(cell.value ?? ''));
    });
    if (vals.some(v => v.toLowerCase() === 'date')) {
      headerRowIndex = rowIdx;
    }
  });

  if (headerRowIndex === 0) headerRowIndex = 1;

  // Validate header row (case-insensitive, order-enforced)
  const headerRow = sheet.getRow(headerRowIndex);
  const headerValues: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell) => {
    headerValues.push(String(cell.value ?? ''));
  });

  if (!validateHeaders(headerValues)) {
    return {
      valid: false,
      trips: [],
      errors: [{ row: headerRowIndex, field: 'headers', message: `Invalid header row. Expected: ${ALL_TRIPS_HEADERS.join(', ')}` }],
    };
  }

  sheet.eachRow((row, rowIdx) => {
    if (rowIdx <= headerRowIndex) return;

    const getVal = (colIdx: number) => {
      const cell = row.getCell(colIdx);
      const v: any = cell.value;
      if (colIdx === 1) return parseExcelDate(v);
      if (colIdx === 5 || colIdx === 6) return parseExcelTime(v);
      if (v === null || v === undefined) return '';
      if (typeof v === 'object' && 'text' in v) return String((v as any).text).trim();
      if (typeof v === 'object' && 'result' in v) {
        const r: any = (v as any).result;
        // Formula result could be Date for time cols
        if (colIdx === 5 || colIdx === 6) return parseExcelTime(r);
        if (r instanceof Date) return parseExcelDate(r);
        return String(r ?? '').trim();
      }
      return String(v).trim();
    };

    const dateStr = getVal(1);
    const startKmStr = getVal(2);
    const endKmStr = getVal(3);

    const distanceStr = getVal(4);
    const startTimeStr = getVal(5);
    const endTimeStr = getVal(6);
    const typeStr = getVal(7) || 'Official';
    const placesVisited = getVal(8);
    const fuelPumpedStr = getVal(9);
    const fuelOrderNo = getVal(10);

    // Skip trailing/empty rows
    if (!dateStr && !startKmStr && !endKmStr && !endTimeStr && !placesVisited && !fuelPumpedStr) {
      return;
    }

    // Validate essential fields: Date, Start KM, End KM, End Time, Places Visited
    if (!dateStr) errors.push({ row: rowIdx, field: 'Date', message: 'Date is required (YYYY-MM-DD)' });
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) errors.push({ row: rowIdx, field: 'Date', message: `Invalid date format: ${dateStr} (expected YYYY-MM-DD)` });

    if (!startKmStr) errors.push({ row: rowIdx, field: 'Start KM', message: 'Start KM is required' });
    const startKm = parseInteger(startKmStr);
    if (isNaN(startKm)) errors.push({ row: rowIdx, field: 'Start KM', message: `Invalid Start KM: ${startKmStr}` });

    if (!endKmStr) errors.push({ row: rowIdx, field: 'End KM', message: 'End KM is required' });
    const endKm = parseInteger(endKmStr);
    if (isNaN(endKm)) errors.push({ row: rowIdx, field: 'End KM', message: `Invalid End KM: ${endKmStr}` });

    if (!isNaN(startKm) && !isNaN(endKm) && endKm < startKm) {
      errors.push({ row: rowIdx, field: 'End KM', message: `End KM (${endKm}) cannot be less than Start KM (${startKm})` });
    }

    let distance = distanceStr ? parseInteger(distanceStr) : NaN;
    if (isNaN(distance) && !isNaN(startKm) && !isNaN(endKm)) {
      distance = roundToIntegerKm(endKm - startKm);
    } else if (isNaN(distance)) {
      errors.push({ row: rowIdx, field: 'Distance', message: 'Distance could not be derived' });
    }

    if (!endTimeStr) errors.push({ row: rowIdx, field: 'End Time', message: 'End Time is required (HH:MM)' });

    if (!placesVisited) errors.push({ row: rowIdx, field: 'Places Visited', message: 'Places Visited is required' });

    const tripType = typeStr.toLowerCase().includes('priv') ? 'Private' : 'Official';
    const fuelPumped = parseFloatNum(fuelPumpedStr);

    // Canonical Estimated Start Time: fill when source Start Time empty but End Time + distance estimatable (Q1/Q2)
    let effectiveStart = startTimeStr;
    if ((!effectiveStart || String(effectiveStart).trim() === '') && endTimeStr && Number.isFinite(distance) && distance > 0) {
      const est = estimateStartTime(endTimeStr, Number(distance));
      if (est) effectiveStart = est;
    }

    parsedTrips.push({
      date: dateStr,
      start_km: startKm,
      end_km: endKm,
      trip_distance: distance,
      start_time: effectiveStart || undefined,
      end_time: endTimeStr,
      trip_type: tripType,
      places_visited: placesVisited,
      fuel_pumped_amount: isNaN(fuelPumped) ? 0 : roundToOneDecimal(fuelPumped),
      fuel_order_no: fuelOrderNo || undefined,
    });
  });

  return {
    valid: errors.length === 0,
    trips: parsedTrips,
    errors,
  };
}

/**
 * Create a Trip object from a Partial<Trip> with defaults.
 */
function createTripFromPartial(partial: Partial<Trip>, vehicleId: string, pageId: string, dayIndex: number, tripIndex: number, idPrefix: string, index: number): Trip {
  return {
    id: `${idPrefix}-${index}`,
    page_id: pageId,
    vehicle_id: vehicleId,
    date: partial.date ?? '',
    day_index: dayIndex,
    trip_index: tripIndex,
    start_time: partial.start_time ?? '',
    end_time: partial.end_time ?? '',
    start_km: partial.start_km ?? 0,
    end_km: partial.end_km ?? 0,
    trip_distance: partial.trip_distance ?? 0,
    trip_type: partial.trip_type ?? 'Official',
    places_visited: partial.places_visited ?? '',
    fuel_pumped_amount: partial.fuel_pumped_amount,
    fuel_order_no: partial.fuel_order_no,
  };
}

/**
 * Create a BookPage object for a new page.
 */
function createBookPage(pageId: string, vehicleId: string, pageNumber: number, date: string, startKm: number, endKm: number): BookPage {
  return {
    id: pageId,
    vehicle_id: vehicleId,
    page_number: pageNumber,
    month: getMonthKey(date),
    start_km: startKm,
    end_km: endKm,
    start_fuel_balance: 0,
    end_fuel_balance: 0,
  };
}

/**
 * Check if any imported trip's [start_km, end_km] range overlaps an existing trip on the same date.
 * Strict overlap: any overlap = reject. Different dates can have overlapping KM ranges (different pages).
 */
export function validateNoOverlap(existingTrips: Trip[], importedTrips: Partial<Trip>[]): ImportError[] {
  const errors: ImportError[] = [];

  // Group existing trips by date for fast lookup
  const existingByDate = new Map<string, Trip[]>();
  for (const t of existingTrips) {
    const list = existingByDate.get(t.date) || [];
    list.push(t);
    existingByDate.set(t.date, list);
  }

  for (let i = 0; i < importedTrips.length; i++) {
    const trip = importedTrips[i];
    if (!trip.date || trip.start_km === undefined || trip.end_km === undefined) continue;

    const sameDateTrips = existingByDate.get(trip.date) || [];
    for (const existing of sameDateTrips) {
      // Exact same odo on same date is an update, not an overlap – skip (upsert allowed)
      if (Math.round(existing.start_km) === Math.round(Number(trip.start_km)) && Math.round(existing.end_km) === Math.round(Number(trip.end_km))) continue;
      // Overlap check on integer KM (focus on start/end): [a,b) overlaps [c,d) if a < d && c < b
      const a = Math.round(Number(trip.start_km));
      const b = Math.round(Number(trip.end_km));
      const c = Math.round(existing.start_km);
      const d = Math.round(existing.end_km);
      const overlaps = a < d && c < b;
      if (overlaps) {
        errors.push({
          row: i + 2,
          field: 'KM Range',
          message: `Import ${a}–${b} on ${trip.date} overlaps DB ${c}–${d} on ${existing.date}`,
        });
        break; // One error per imported row is enough
      }
    }
  }

  return errors;
}

/**
 * Pre-flight pagination validation for imported trips.
 * Checks 4/13/month constraints as if trips were added chronologically.
 * Returns errors if any pagination rule would be violated.
 */
export function validatePaginationForImport(
  existingTrips: Trip[],
  existingPages: BookPage[],
  importedTrips: Partial<Trip>[]
): ImportError[] {
  const errors: ImportError[] = [];

  // Sort imported trips chronologically
  const sorted = [...importedTrips]
    .filter(t => t.date && t.start_km !== undefined)
    .sort((a, b) => (a.date!).localeCompare(b.date!) || (a.start_km ?? 0) - (b.start_km ?? 0));

  // Simulate adding trips one by one to check pagination
  let simulatedTrips = [...existingTrips];
  let simulatedPages = [...existingPages];

  for (let i = 0; i < sorted.length; i++) {
    const trip = sorted[i];
    const result = assignPageForNewTrip({
      pages: simulatedPages,
      trips: simulatedTrips,
      newTripDate: trip.date!,
    });

    if ('allowed' in result && !result.allowed) {
      errors.push({
        row: i + 2, // +2 for 1-indexed and header row
        field: 'pagination',
        message: `Trip would violate ${result.reason}: max ${MAX_TRIPS_PER_DAY} trips per day`,
      });
    } else if ('pageId' in result) {
      const vehicleId = existingTrips[0]?.vehicle_id ?? '';
      const tempTrip = createTripFromPartial(trip, vehicleId, result.pageId, result.dayIndex, result.tripIndex, 'temp', i);

      if (result.requiresNewPage) {
        const newPage = createBookPage(result.pageId, vehicleId, result.pageNumber, trip.date!, trip.start_km ?? 0, trip.end_km ?? 0);
        simulatedPages.push(newPage);
      }

      simulatedTrips.push(tempTrip);
    }
  }

  return errors;
}

/**
 * Import trips from a parsed workbook result.
 * Appends trips chronologically, handles backdated renumber, and detects duplicates.
 * This is a pure function that returns the new state without mutating inputs.
 */
export function importTripsFromWorkbook(params: {
  existingTrips: Trip[];
  existingPages: BookPage[];
  parsedTrips: Partial<Trip>[];
  vehicleId: string;
  opening: BookOpening;
  economy?: number;
  inTanksByPage?: Record<string, (number | null | undefined)[]>;
}): ImportResult {
  const { existingTrips, existingPages, parsedTrips, vehicleId, opening, economy = 10.5, inTanksByPage } = params;

  // Odo-based upsert: re-importing same date+odo updates times/fuel/order instead of being rejected
  const odoMap = new Map<string, number>();
  existingTrips.forEach((t, idx) => odoMap.set(getOdoKey(t), idx));
  // Work on mutable clones so updates are visible in result
  let currentTripsForUpdate = [...existingTrips];
  let updatedCount = 0;
  let skippedDuplicates = 0;
  const existingKeys = new Set(existingTrips.map(getDuplicateKey));
  const uniqueTrips: Partial<Trip>[] = [];

  for (const trip of parsedTrips) {
    const odoKey = getOdoKey(trip);
    const existingIdx = odoMap.get(odoKey);
    if (existingIdx !== undefined) {
      const existing = currentTripsForUpdate[existingIdx];
      const incomingFuel = trip.fuel_pumped_amount;
      const incomingOrderNo = trip.fuel_order_no;
      // Only fields present in import can trigger an update; empty cells keep existing value
      const sameFuel = incomingFuel === undefined || (existing.fuel_pumped_amount ?? 0) === incomingFuel;
      const sameOrder = incomingOrderNo === undefined || (existing.fuel_order_no ?? '') === incomingOrderNo;
      const sameStart = trip.start_time === undefined || (existing.start_time ?? '') === trip.start_time;
      const sameEnd = trip.end_time === undefined || (existing.end_time ?? '') === trip.end_time;
      const sameType = trip.trip_type === undefined || (existing.trip_type ?? 'Official') === trip.trip_type;
      const samePlaces = trip.places_visited === undefined || (existing.places_visited ?? '') === trip.places_visited;
      if (sameFuel && sameOrder && sameStart && sameEnd && sameType && samePlaces) {
        skippedDuplicates++;
        continue;
      }
      // Upsert in place – keep id/page_id/day_index/trip_index, update mutable fields
      currentTripsForUpdate[existingIdx] = {
        ...existing,
        start_time: trip.start_time ?? existing.start_time,
        end_time: trip.end_time ?? existing.end_time,
        trip_type: trip.trip_type ?? existing.trip_type,
        places_visited: trip.places_visited ?? existing.places_visited,
        fuel_pumped_amount: incomingFuel !== undefined ? incomingFuel : existing.fuel_pumped_amount,
        fuel_order_no: incomingOrderNo !== undefined ? incomingOrderNo : existing.fuel_order_no,
      };
      updatedCount++;
      // Also keep duplicate set in sync so a second imported row with same odo doesn't create a new trip
      existingKeys.add(getDuplicateKey(trip));
      continue;
    }
    const key = getDuplicateKey(trip);
    if (existingKeys.has(key)) {
      skippedDuplicates++;
      continue;
    }
    existingKeys.add(key);
    uniqueTrips.push(trip);
  }

  if (uniqueTrips.length === 0) {
    return {
      success: true,
      appendedCount: 0,
      skippedDuplicates,
      updatedCount,
      errors: [],
      pages: existingPages,
      trips: currentTripsForUpdate,
    };
  }

  // Sort trips chronologically
  const sorted = [...uniqueTrips].sort((a, b) =>
    (a.date ?? '').localeCompare(b.date ?? '') || (a.start_km ?? 0) - (b.start_km ?? 0)
  );

  // Append new trips one by one, paginating via assignPageForNewTrip (updates already applied to currentTripsForUpdate)
  let currentTrips = [...currentTripsForUpdate];
  let currentPages = [...existingPages];
  const newTrips: Trip[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const trip = sorted[i];
    const result = assignPageForNewTrip({
      pages: currentPages,
      trips: currentTrips,
      newTripDate: trip.date!,
    });

    if ('allowed' in result && !result.allowed) {
      // Should not happen after pre-flight validation, but handle gracefully
      continue;
    }

    if ('pageId' in result) {
      const newTrip = createTripFromPartial(trip, vehicleId, result.pageId, result.dayIndex, result.tripIndex, `import-${Date.now()}`, i);

      if (result.requiresNewPage) {
        const newPage = createBookPage(result.pageId, vehicleId, result.pageNumber, trip.date!, trip.start_km ?? 0, trip.end_km ?? 0);
        currentPages.push(newPage);
      }

      currentTrips.push(newTrip);
      newTrips.push(newTrip);
    }
  }

  // Check if backdated insertion occurred (only if there are new trips)
  const backdated = sorted.length > 0 && isBackdatedInsertion(currentPages, currentTrips, sorted[0].date!);

  // If backdated, renumber pages and recalculate balances
  if (backdated) {
    const renumbered = renumberPagesChronologically(currentPages, currentTrips);
    currentPages = renumbered.pages;
    currentTrips = renumbered.trips;

    const recalculated = recalculatePageBalancesFromOpening({
      pages: currentPages,
      trips: currentTrips,
      opening,
      economy,
      inTanksByPage,
    });
    currentPages = recalculated;
  }

  return {
    success: true,
    appendedCount: newTrips.length,
    skippedDuplicates,
    updatedCount,
    errors: [],
    pages: currentPages,
    trips: currentTrips,
  };
}
