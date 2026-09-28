/**
 * Fuel Economy Lock Store — per DayGroup lock after book write (ADR 0029)
 * Stores boolean per pageId -> (dayIndex -> locked)
 * Also supports date-keyed lookup for rebuild survival.
 */
const KEY_PREFIX = 'fleetledger_fuel_economy_locks_';
const DATE_KEY = 'fleetledger_fuel_locks_by_date';

function keyForPage(pageId: string): string {
  return `${KEY_PREFIX}${pageId}`;
}

export function getFuelLocksForPage(pageId: string): boolean[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(keyForPage(pageId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as boolean[];
    return [];
  } catch {
    return [];
  }
}

export function saveFuelLocksForPage(pageId: string, locks: boolean[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(keyForPage(pageId), JSON.stringify(locks));
  // also maintain date-keyed mirror for rebuild
  rebuildDateMirror();
}

export function clearFuelLocksForPage(pageId: string): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(keyForPage(pageId));
  rebuildDateMirror();
}

export function getLockedDates(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(DATE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return new Set(arr as string[]);
  } catch {}
  return new Set();
}

export function isDateLocked(date: string): boolean {
  return getLockedDates().has(date);
}

export function getLockedEconomyMap(trips: import('@/types').Trip[], economiesByPage: Map<string, (number | null)[]>): Map<string, number> {
  const map = new Map<string, number>();
  if (typeof window === 'undefined') return map;
  const locked = getLockedDates();
  for (const d of locked) {
    const trip = trips.find(t => t.date === d);
    if (!trip) continue;
    const arr = economiesByPage.get(trip.page_id);
    if (!arr) continue;
    // need distinct dates to map dayIndex
    // caller should build correctly; fallback: try to find index via distinct
    // For simplicity, we fetch via page trips
    const pageTrips = trips.filter(t => t.page_id === trip.page_id);
    const distinct = Array.from(new Set(pageTrips.map(t => t.date))).sort();
    const idx = distinct.indexOf(d);
    if (idx >= 0 && arr[idx] != null) map.set(d, arr[idx] as number);
  }
  return map;
}

function rebuildDateMirror(): void {
  if (typeof window === 'undefined') return;
  // Iterate all keys with prefix and build date set via current pages/trips not available here,
  // so we store locks by page but also need trips to map dates.
  // Date mirror is rebuilt by caller that knows trips/pages via saveLocksForDateRange helper.
}

export function setLocksForDateRange(trips: import('@/types').Trip[], dates: string[], locked: boolean): void {
  if (typeof window === 'undefined') return;
  // Group dates by page
  const byPage = new Map<string, string[]>();
  for (const d of dates) {
    const t = trips.find(x => x.date === d);
    if (!t) continue;
    if (!byPage.has(t.page_id)) byPage.set(t.page_id, []);
    byPage.get(t.page_id)!.push(d);
  }
  for (const [pageId, pageDates] of byPage) {
    const pageTrips = trips.filter(t => t.page_id === pageId);
    const distinct = Array.from(new Set(pageTrips.map(t => t.date))).sort();
    const arr = getFuelLocksForPage(pageId);
    while (arr.length < distinct.length) arr.push(false);
    for (const d of pageDates) {
      const idx = distinct.indexOf(d);
      if (idx >= 0) arr[idx] = locked;
    }
    localStorage.setItem(keyForPage(pageId), JSON.stringify(arr));
  }
  // Rebuild DATE_KEY
  const allLockedDates: string[] = [];
  // Scan all localStorage prefixed keys
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(KEY_PREFIX)) continue;
    const pageId = k.slice(KEY_PREFIX.length);
    const locks = getFuelLocksForPage(pageId);
    if (locks.length === 0) continue;
    // Need trips to map; use trips param if contains pageId trips
    const pageTrips = trips.filter(t => t.page_id === pageId);
    const distinct = Array.from(new Set(pageTrips.map(t => t.date))).sort();
    distinct.forEach((d, idx) => {
      if (locks[idx]) allLockedDates.push(d);
    });
  }
  localStorage.setItem(DATE_KEY, JSON.stringify(Array.from(new Set(allLockedDates))));
  // Notify
  window.dispatchEvent(new CustomEvent('fleetledger:data-changed'));
}

export function clearAllLocks(): void {
  if (typeof window === 'undefined') return;
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (k && k.startsWith(KEY_PREFIX)) localStorage.removeItem(k);
  }
  localStorage.removeItem(DATE_KEY);
}
