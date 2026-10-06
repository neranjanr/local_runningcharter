/**
 * Pagination, Page-Rollover & Continuity Engine
 * Pure functions enforcing physical book constraints:
 * - Max 4 days per page
 * - Max 13 trips per day
 * - New month forces new page
 * - Cross-page odometer & fuel continuity
 */
import type { BookPage, Trip } from '@/types';
import { roundToOneDecimal, roundToIntegerKm } from './tripCalculations';

export const MAX_DAYS_PER_PAGE = 4;
export const MAX_TRIPS_PER_DAY = 13;

// Day-slot counting with the 40 km split-collapse rule (Spec #6,
// Issue #11, ADR-0035) lives in `./tripCycleSlots`, shared with the ledger
// engine so validation and display cannot drift. Re-exported here so
// pagination callers keep a single import site.
export { countLedgerColumnSlots, SPLIT_DAY_THRESHOLD_KM as SPLIT_DAY_COLUMN_THRESHOLD_KM } from './tripCycleSlots';
import { countLedgerColumnSlots as countSlots } from './tripCycleSlots';

// ---------------------------------------------------------------------------
// Date / pagination helpers
// ---------------------------------------------------------------------------

export function getMonthKey(dateStr: string): string {
  // Expect YYYY-MM-DD, slice first 7 chars -> YYYY-MM
  return dateStr.slice(0, 7);
}

export function getDistinctDates(trips: Trip[]): string[] {
  const set = new Set<string>();
  for (const t of trips) set.add(t.date);
  return Array.from(set).sort();
}

export function countTripsForDate(trips: Trip[], date: string): number {
  let c = 0;
  for (const t of trips) if (t.date === date) c++;
  return c;
}

// ---------------------------------------------------------------------------
// Fuel calculations (rounded to 1 decimal)
// ---------------------------------------------------------------------------

export function calculateConsumed(distance: number, economy: number): number {
  if (!economy || economy <= 0 || !distance || distance <= 0) return 0;
  return roundToOneDecimal(distance / economy);
}

export function calculateBalance(
  previousBalance: number,
  drawn: number,
  consumed: number,
  inTank: number = 0,
  tankCapacity: number = 75,
  isFullTank: boolean = false
): number {
  const cap = tankCapacity > 0 ? tankCapacity : 75;
  const ceil = isFullTank && drawn > 0 ? cap + 1 : cap;
  let base = isFullTank && drawn > 0 ? cap : previousBalance + inTank + drawn;
  const raw = base - consumed;
  return roundToOneDecimal(Math.min(ceil, raw));
}

export interface FuelValidationResult {
  isValid: boolean;
  error?: string;
}

export function validateFuelFeasibility(
  trips: Trip[],
  tankCapacity: number = 75,
  openingFuel: number = 10,
  defaultEconomy: number = 10.5
): FuelValidationResult {
  const cap = tankCapacity > 0 ? tankCapacity : 75;
  const strictMin = Math.max(1, cap - 3);
  const strictMax = cap + 1;
  let bal = roundToOneDecimal(openingFuel);
  const sorted = [...trips].sort((a, b) => a.date.localeCompare(b.date) || a.start_km - b.start_km);

  for (const t of sorted) {
    const dist = roundToIntegerKm(t.trip_distance);
    const pumped = roundToOneDecimal(t.fuel_pumped_amount ?? 0);
    const isFull = !!t.is_full_tank && pumped > 0;
    const timing = t.pump_timing ?? 'END';
    const consumed = calculateConsumed(dist, defaultEconomy);

    if (pumped > 0 && timing === 'START' && dist > 20) {
      const postPump = roundToOneDecimal(bal + pumped);
      if (isFull) {
        if (postPump < strictMin || postPump > strictMax) {
          return {
            isValid: false,
            error: `Strict full-tank post-pump balance ${postPump.toFixed(1)}L at trip ${t.date} outside full-tank window [${strictMin.toFixed(1)}, ${strictMax.toFixed(1)}]L`,
          };
        }
      }
      bal = roundToOneDecimal(Math.min(isFull ? strictMax : cap, postPump));
      bal = roundToOneDecimal(bal - consumed);
    } else {
      bal = roundToOneDecimal(bal - consumed);
      if (pumped > 0) {
        const postPump = roundToOneDecimal(bal + pumped);
        if (isFull) {
          if (postPump < strictMin || postPump > strictMax) {
            return {
              isValid: false,
              error: `Strict full-tank post-pump balance ${postPump.toFixed(1)}L at trip ${t.date} outside full-tank window [${strictMin.toFixed(1)}, ${strictMax.toFixed(1)}]L`,
            };
          }
        }
        bal = roundToOneDecimal(Math.min(isFull ? strictMax : cap, postPump));
      }
    }

    if (bal < 1 || bal > strictMax) {
      return {
        isValid: false,
        error: `Intermediate fuel balance ${bal.toFixed(1)}L at trip ${t.date} outside [1, ${strictMax.toFixed(1)}]L range`,
      };
    }
  }

  return { isValid: true };
}

// ---------------------------------------------------------------------------
// Page boundary validation
// ---------------------------------------------------------------------------

export interface ValidateResult {
  allowed: boolean;
  requiresNewPage: boolean;
  reason?: 'MAX_DAYS' | 'MONTH_ROLLOVER' | 'MAX_TRIPS_PER_DAY' | 'NEW_BOOK';
}

export function validateTripForPage(
  tripsOnCurrentPage: Trip[],
  currentPage: BookPage,
  newTripDate: string
): ValidateResult {
  const countForDate = countTripsForDate(tripsOnCurrentPage, newTripDate);
  if (countForDate >= MAX_TRIPS_PER_DAY) {
    return { allowed: false, requiresNewPage: false, reason: 'MAX_TRIPS_PER_DAY' };
  }

  const newMonth = getMonthKey(newTripDate);
  if (newMonth !== currentPage.month) {
    return { allowed: true, requiresNewPage: true, reason: 'MONTH_ROLLOVER' };
  }

  const distinct = getDistinctDates(tripsOnCurrentPage);
  const isNewDistinctDay = !distinct.includes(newTripDate);
  if (isNewDistinctDay) {
    // A new date always needs at least one more day-slot; a split large
    // day can need several, but its pumps/distances are unknown until the
    // trips exist — the overflow then surfaces via
    // `validatePaginationConstraints` (rebuild warning).
    const before = countSlots(tripsOnCurrentPage);
    if (before + 1 > MAX_DAYS_PER_PAGE) {
      return { allowed: true, requiresNewPage: true, reason: 'MAX_DAYS' };
    }
  }

  return { allowed: true, requiresNewPage: false };
}

// ---------------------------------------------------------------------------
// Continuity checks
// ---------------------------------------------------------------------------

export interface ContinuityResult {
  isValid: boolean;
  breaks: Array<{ pageNumber: number; expected: number; actual: number }>;
}

function sortedPages(pages: BookPage[]): BookPage[] {
  return [...pages].sort((a, b) => a.page_number - b.page_number);
}

export function validateOdometerContinuity(pages: BookPage[]): ContinuityResult {
  const sorted = sortedPages(pages);
  const breaks: ContinuityResult['breaks'] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const cur = sorted[i];
    const next = sorted[i + 1];
    const expected = roundToIntegerKm(cur.end_km);
    const actual = roundToIntegerKm(next.start_km);
    if (expected !== actual) {
      breaks.push({ pageNumber: next.page_number, expected, actual });
    }
  }
  return { isValid: breaks.length === 0, breaks };
}

export function validateFuelContinuity(pages: BookPage[]): ContinuityResult {
  const sorted = sortedPages(pages);
  const breaks: ContinuityResult['breaks'] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const cur = sorted[i];
    const next = sorted[i + 1];
    const expected = roundToOneDecimal(cur.end_fuel_balance);
    const actual = roundToOneDecimal(next.start_fuel_balance);
    if (expected !== actual) {
      breaks.push({ pageNumber: next.page_number, expected, actual });
    }
  }
  return { isValid: breaks.length === 0, breaks };
}

export function getNextPageStartKm(pages: BookPage[], fallbackOdometer: number): number {
  if (pages.length === 0) return roundToIntegerKm(fallbackOdometer);
  const sorted = sortedPages(pages);
  return roundToIntegerKm(sorted[sorted.length - 1].end_km);
}

export function getNextPageStartFuel(pages: BookPage[], fallbackFuel: number): number {
  if (pages.length === 0) return roundToOneDecimal(fallbackFuel);
  const sorted = sortedPages(pages);
  return roundToOneDecimal(sorted[sorted.length - 1].end_fuel_balance);
}

// ---------------------------------------------------------------------------
// Chronological renumbering & Book Opening (Phase 2 Issue 02)
// ---------------------------------------------------------------------------

export interface BookOpening {
  openingKm: number; // Integer KM
  openingFuel: number; // 1 decimal
}

export function getPageEarliestDate(page: BookPage, trips: Trip[]): string {
  const pageTrips = trips.filter((t) => t.page_id === page.id);
  if (pageTrips.length === 0) {
    // Fallback to month prefix as earliest date for empty page
    return `${page.month}-01`;
  }
  let earliest = pageTrips[0].date;
  for (const t of pageTrips) {
    if (t.date < earliest) earliest = t.date;
  }
  return earliest;
}

export function getEarliestOverallDate(pages: BookPage[], trips: Trip[]): string | null {
  if (pages.length === 0) return null;
  let earliest: string | null = null;
  for (const p of pages) {
    const d = getPageEarliestDate(p, trips);
    if (earliest === null || d < earliest) earliest = d;
  }
  return earliest;
}

export function isBackdatedInsertion(pages: BookPage[], trips: Trip[], newDate: string): boolean {
  const earliest = getEarliestOverallDate(pages, trips);
  if (earliest === null) return false;
  return newDate < earliest;
}

export function renumberPagesChronologically(
  pages: BookPage[],
  trips: Trip[]
): { pages: BookPage[]; trips: Trip[] } {
  if (pages.length <= 1) {
    return { pages: [...pages], trips: [...trips] };
  }
  const pagesWithEarliest = pages.map((p) => ({
    p,
    earliest: getPageEarliestDate(p, trips),
  }));
  pagesWithEarliest.sort((a, b) => {
    if (a.earliest < b.earliest) return -1;
    if (a.earliest > b.earliest) return 1;
    return a.p.page_number - b.p.page_number;
  });

  const oldIdToNew = new Map<string, { newId: string; newNumber: number }>();
  const newPages: BookPage[] = pagesWithEarliest.map(({ p }, idx) => {
    const newNumber = idx + 1;
    const newId = `page-${newNumber}`;
    oldIdToNew.set(p.id, { newId, newNumber });
    return {
      ...p,
      page_number: newNumber,
      id: newId,
    };
  });

  const newTrips: Trip[] = trips.map((t) => {
    const mapping = oldIdToNew.get(t.page_id);
    if (mapping) {
      return { ...t, page_id: mapping.newId };
    }
    return { ...t };
  });

  newPages.sort((a, b) => a.page_number - b.page_number);
  return { pages: newPages, trips: newTrips };
}

/**
 * Recalculate fuel balances forward from Book Opening.
 * Assumes pages are already sorted chronologically by page_number (1..N).
 * For each page:
 *   start_km = opening.openingKm for first page else prev end_km
 *   start_fuel = opening.openingFuel for first page else prev end_fuel
 *   totalDistance = sum trip_distance (Integer KM) for page
 *   totalDrawn = sum fuel_pumped_amount for page
 *   consumed = distance / economy (default 10.5) rounded 1 dec
 *   end_fuel = start_fuel + totalDrawn - consumed
 *   end_km = last trip end_km if trips exist else start_km
 * Dates are never mutated.
 * Only fuel and odometer continuity are recomputed; pagination grouping (4/13/month) is preserved.
 */
export function recalculatePageBalancesFromOpening(params: {
  pages: BookPage[];
  trips: Trip[];
  opening: BookOpening;
  economy?: number;
  inTanksByPage?: Record<string, (number | null | undefined)[]>;
  tankCapacity?: number;
}): BookPage[] {
  const { trips, opening, economy = 10.5, inTanksByPage, tankCapacity = 75 } = params;
  const cap = tankCapacity > 0 ? tankCapacity : 75;
  const sorted = [...params.pages].sort((a, b) => a.page_number - b.page_number);
  if (sorted.length === 0) return [];

  const result: BookPage[] = [];
  let prevEndKm = roundToIntegerKm(opening.openingKm);
  let prevEndFuel = roundToOneDecimal(opening.openingFuel);

  for (let i = 0; i < sorted.length; i++) {
    const page = { ...sorted[i] };
    // Set start from opening or previous end (continuity)
    if (i === 0) {
      page.start_km = roundToIntegerKm(opening.openingKm);
      page.start_fuel_balance = roundToOneDecimal(opening.openingFuel);
    } else {
      page.start_km = roundToIntegerKm(prevEndKm);
      page.start_fuel_balance = roundToOneDecimal(prevEndFuel);
    }

    const pageTrips = trips
      .filter((t) => {
        return t.page_id === page.id;
      })
      .sort((a, b) => a.date.localeCompare(b.date) || a.trip_index - b.trip_index);

    let totalDistance = 0;
    let totalDrawn = 0;
    let totalInTank = 0;
    let endKm = page.start_km;
    let isFullTank = false;

    if (pageTrips.length > 0) {
      totalDistance = pageTrips.reduce((s, t) => s + roundToIntegerKm(t.trip_distance), 0);
      totalDrawn = roundToOneDecimal(
        pageTrips.reduce((s, t) => s + roundToOneDecimal(t.fuel_pumped_amount ?? 0), 0)
      );
      isFullTank = pageTrips.some(t => !!t.is_full_tank && (t.fuel_pumped_amount ?? 0) > 0);
      // Sum In-Tank per distinct date for this page if provided
      if (inTanksByPage && inTanksByPage[page.id]) {
        const rawIn = inTanksByPage[page.id];
        const distinctForPage = getDistinctDates(pageTrips);
        for (let d = 0; d < distinctForPage.length; d++) {
          const v = rawIn[d];
          if (v !== null && v !== undefined && !isNaN(Number(v))) totalInTank += roundToOneDecimal(Number(v));
        }
        totalInTank = roundToOneDecimal(totalInTank);
      }
      const sortedByOrder = [...pageTrips].sort((a, b) => a.date.localeCompare(b.date) || a.trip_index - b.trip_index);
      endKm = roundToIntegerKm(sortedByOrder[sortedByOrder.length - 1].end_km);
    } else {
      totalDistance = 0;
      totalDrawn = 0;
      totalInTank = 0;
      endKm = page.start_km;
    }

    const consumed = calculateConsumed(totalDistance, economy);
    const endFuel = calculateBalance(page.start_fuel_balance, totalDrawn, consumed, totalInTank, cap, isFullTank);

    page.end_km = roundToIntegerKm(endKm);
    page.end_fuel_balance = roundToOneDecimal(endFuel);

    prevEndKm = page.end_km;
    prevEndFuel = page.end_fuel_balance;

    result.push(page);
  }

  return result.sort((a, b) => a.page_number - b.page_number);
}

/**
 * Validate pagination constraints still hold after renumber.
 * Returns list of violations if any page exceeds 4 day-slots (one per
 * date, plus one extra slot per cycle slice on split large days over
 * 40 km), 13 trips per day, or month split.
 */
export function validatePaginationConstraints(pages: BookPage[], trips: Trip[]): Array<{ pageId: string; pageNumber: number; violation: string }> {
  const violations: Array<{ pageId: string; pageNumber: number; violation: string }> = [];
  for (const page of pages) {
    const pageTrips = trips.filter((t) => t.page_id === page.id);
    const distinct = getDistinctDates(pageTrips);
    const slots = countSlots(pageTrips);
    if (slots > MAX_DAYS_PER_PAGE) {
      violations.push({ pageId: page.id, pageNumber: page.page_number, violation: `MAX_DAYS exceeded: ${slots} day-slots > ${MAX_DAYS_PER_PAGE} (${distinct.length} dates)` });
    }
    for (const d of distinct) {
      const cnt = countTripsForDate(pageTrips, d);
      if (cnt > MAX_TRIPS_PER_DAY) {
        violations.push({ pageId: page.id, pageNumber: page.page_number, violation: `MAX_TRIPS_PER_DAY exceeded on ${d}: ${cnt} > ${MAX_TRIPS_PER_DAY}` });
      }
    }
    // Month rollover check: all trips on page should share same month as page.month, or at least not cross month without new page?
    // If distinct months >1, it means page spans month boundary which should have forced new page
    const months = new Set(pageTrips.map((t) => getMonthKey(t.date)));
    if (months.size > 1) {
      violations.push({ pageId: page.id, pageNumber: page.page_number, violation: `MONTH_ROLLOVER breach: multiple months ${Array.from(months).join(', ')}` });
    }
    if (pageTrips.length > 0 && !months.has(page.month)) {
      // page month doesn't match trips months (could happen after renumber if month not updated)
      // Not strictly a violation if month field is stale, but flag for awareness
      // We skip strict check to avoid false positives after renumber where month field may lag
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Page assignment integration
// ---------------------------------------------------------------------------

export interface PageAssignment {
  pageNumber: number;
  pageId: string;
  dayIndex: number;
  tripIndex: number;
  requiresNewPage: boolean;
  reason?: 'MAX_DAYS' | 'MONTH_ROLLOVER' | 'NEW_BOOK';
}

export type AssignResult =
  | PageAssignment
  | { allowed: false; reason: 'MAX_TRIPS_PER_DAY'; pageNumber?: number; dayIndex?: number; tripIndex?: number };

function tripsForPage(trips: Trip[], pageId: string): Trip[] {
  return trips.filter((t) => t.page_id === pageId);
}

function getCurrentPage(pages: BookPage[]): BookPage | null {
  if (pages.length === 0) return null;
  const sorted = sortedPages(pages);
  return sorted[sorted.length - 1];
}

export function assignPageForNewTrip(params: {
  pages: BookPage[];
  trips: Trip[];
  newTripDate: string;
}): AssignResult {
  const { pages, trips, newTripDate } = params;

  if (pages.length === 0) {
    return {
      pageNumber: 1,
      pageId: `page-1`,
      dayIndex: 1,
      tripIndex: 1,
      requiresNewPage: true,
      reason: 'NEW_BOOK',
    };
  }

  const currentPage = getCurrentPage(pages)!;
  const tripsOnCurrent = tripsForPage(trips, currentPage.id);

  // Check max trips per day first (on current page)
  const countForDate = countTripsForDate(tripsOnCurrent, newTripDate);
  if (countForDate >= MAX_TRIPS_PER_DAY) {
    const distinct = getDistinctDates(tripsOnCurrent);
    // Compute dayIndex for completeness (even when blocked)
    const sortedDistinct = [...distinct].sort();
    if (!sortedDistinct.includes(newTripDate)) {
      // shouldn't happen when blocked, but handle
      sortedDistinct.push(newTripDate);
      sortedDistinct.sort();
    }
    const dayIdx = sortedDistinct.indexOf(newTripDate) + 1;
    return {
      allowed: false,
      reason: 'MAX_TRIPS_PER_DAY',
      pageNumber: currentPage.page_number,
      dayIndex: dayIdx,
      tripIndex: countForDate + 1,
    } as AssignResult;
  }

  const validation = validateTripForPage(tripsOnCurrent, currentPage, newTripDate);

  if (validation.requiresNewPage) {
    const nextPageNumber = currentPage.page_number + 1;
    return {
      pageNumber: nextPageNumber,
      pageId: `page-${nextPageNumber}`,
      dayIndex: 1,
      tripIndex: 1,
      requiresNewPage: true,
      reason: validation.reason as 'MAX_DAYS' | 'MONTH_ROLLOVER',
    };
  }

  // Same page - compute dayIndex and tripIndex
  const distinct = getDistinctDates(tripsOnCurrent);
  const sortedDistinct = [...distinct].sort();
  // If newTripDate not yet in distinct, it will occupy next day slot
  let dayIndex: number;
  if (sortedDistinct.includes(newTripDate)) {
    dayIndex = sortedDistinct.indexOf(newTripDate) + 1;
  } else {
    // new date insertion: find position in chronological order
    const withNew = [...sortedDistinct, newTripDate].sort();
    dayIndex = withNew.indexOf(newTripDate) + 1;
  }

  const tripIndex = countForDate + 1;

  return {
    pageNumber: currentPage.page_number,
    pageId: currentPage.id,
    dayIndex,
    tripIndex,
    requiresNewPage: false,
  };
}

/**
 * Assign a back-dated Trip to the existing Page that owns its date, rather than
 * appending to the current (last) Page. Used by Gap Fill and back-dated Insert
 * After, where the Trip belongs between existing Trips and must never spawn a new
 * Page at the end of the book.
 *
 * Resolution order: the anchor Page (the predecessor's Page) when its month
 * matches the Trip date, else the Page for that month whose Trip dates bracket
 * the date (else the last Page of that month), else the anchor Page.
 *
 * Only blocks when the target Page already holds `MAX_TRIPS_PER_DAY` on that date.
 * Exceeding `MAX_DAYS_PER_PAGE` is left to the caller's `validatePaginationConstraints`
 * so it can raise the rebuild-required warning instead of failing the save.
 */
export function assignPageForBackdatedTrip(params: {
  pages: BookPage[];
  trips: Trip[];
  tripDate: string;
  anchorPageId?: string;
}): AssignResult {
  const { pages, trips, tripDate, anchorPageId } = params;
  if (pages.length === 0) {
    return { pageNumber: 1, pageId: 'page-1', dayIndex: 1, tripIndex: 1, requiresNewPage: true, reason: 'NEW_BOOK' };
  }
  const sorted = sortedPages(pages);
  const month = getMonthKey(tripDate);
  const anchor = anchorPageId ? sorted.find((p) => p.id === anchorPageId) : undefined;
  let target: BookPage | undefined;
  if (anchor && anchor.month === month) {
    target = anchor;
  } else {
    const monthPages = sorted.filter((p) => p.month === month);
    target = monthPages.find((p) => {
      const dates = trips.filter((t) => t.page_id === p.id).map((t) => t.date).sort();
      return dates.length > 0 && tripDate >= dates[0] && tripDate <= dates[dates.length - 1];
    }) ?? monthPages[monthPages.length - 1];
  }
  if (!target) target = anchor ?? sorted[sorted.length - 1];

  const pageTrips = trips.filter((t) => t.page_id === target!.id);
  const countForDate = countTripsForDate(pageTrips, tripDate);
  if (countForDate >= MAX_TRIPS_PER_DAY) {
    return { allowed: false, reason: 'MAX_TRIPS_PER_DAY', pageNumber: target.page_number, dayIndex: 1, tripIndex: countForDate + 1 } as AssignResult;
  }
  const sortedDistinct = getDistinctDates(pageTrips);
  let dayIndex: number;
  let tripIndex: number;
  if (sortedDistinct.includes(tripDate)) {
    dayIndex = sortedDistinct.indexOf(tripDate) + 1;
    tripIndex = countForDate + 1;
  } else {
    const withNew = [...sortedDistinct, tripDate].sort();
    dayIndex = withNew.indexOf(tripDate) + 1;
    tripIndex = 1;
  }
  return { pageNumber: target.page_number, pageId: target.id, dayIndex, tripIndex, requiresNewPage: false };
}
