/**
 * Sheet Proxy client for Buffer Sheet (ADR 0014)
 * Talks to Apps Script Web App — no Google credentials in PWA.
 * Contract: headers must match ALL_TRIPS_HEADERS (lib/allTripsWorkbook.ts:18)
 */
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
] as const;

export interface BufferTrip {
  date: string; // YYYY-MM-DD
  start_km: number; // Integer KM
  end_km: number;
  trip_distance: number;
  start_time: string; // HH:MM or ""
  end_time: string; // HH:MM
  trip_type: 'Official' | 'Private';
  places_visited: string;
  fuel_pumped_amount?: number;
  fuel_order_no?: string;
}

// No hardcoded team URLs — real values live only in gitignored config/sheet.local.json (see config/sheet.example.json) or localStorage.
// Keep empty fallback for standalone PWA build; consider importing from ../../lib/sheetConfig in monorepo.
export const DEFAULT_SHEET_ID = '';
export const DEFAULT_SHEET_URL = '';
export const DEFAULT_SCRIPT_URL = '';

export function getSettings(): { sheetId: string; scriptUrl: string } {
  if (typeof window === 'undefined') return { sheetId: DEFAULT_SHEET_ID, scriptUrl: DEFAULT_SCRIPT_URL };
  return {
    sheetId: localStorage.getItem('mobile.sheetId') || process.env.NEXT_PUBLIC_SHEET_ID || DEFAULT_SHEET_ID,
    scriptUrl: localStorage.getItem('mobile.scriptUrl') || process.env.NEXT_PUBLIC_SCRIPT_URL || DEFAULT_SCRIPT_URL,
  };
}

export function saveSettings(sheetIdOrUrl: string, scriptUrl: string) {
  // Allow pasting full URL: extract /d/<id>/ 
  let id = sheetIdOrUrl.trim();
  const m = id.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (m) id = m[1];
  localStorage.setItem('mobile.sheetId', id);
  localStorage.setItem('mobile.scriptUrl', scriptUrl.trim());
}

export async function appendTrip(trip: BufferTrip): Promise<void> {
  const { scriptUrl } = getSettings();
  if (!scriptUrl) throw new Error('Sheet Proxy URL not configured — open Settings');
  const res = await fetch(scriptUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'appendTrip', trip }),
  });
  if (!res.ok) throw new Error(`Sheet append failed: ${res.status}`);
  const j = await res.json().catch(() => ({}));
  if (j.ok === false) throw new Error(j.error || 'Sheet rejected trip');
}

export async function fetchLast10(): Promise<BufferTrip[]> {
  const { scriptUrl } = getSettings();
  if (!scriptUrl) return [];
  const url = scriptUrl + (scriptUrl.includes('?') ? '&' : '?') + 'action=last10';
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) return [];
  const j = await res.json();
  return (j.rows || j.trips || []) as BufferTrip[];
}

// Offline queue (IndexedDB-lite via localStorage fallback for v1)
const QUEUE_KEY = 'mobile.queue';

export function queueTrip(trip: BufferTrip) {
  const q = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
  q.push({ ...trip, _queuedAt: new Date().toISOString() });
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
}

export function getQueue(): (BufferTrip & { _queuedAt: string })[] {
  return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
}

export async function flushQueue(): Promise<number> {
  const q = getQueue();
  if (q.length === 0) return 0;
  let flushed = 0;
  const remain: typeof q = [];
  for (const t of q) {
    try {
      const { _queuedAt, ...trip } = t as any;
      await appendTrip(trip);
      flushed++;
    } catch {
      remain.push(t);
      break; // stop on first failure, keep order
    }
  }
  localStorage.setItem(QUEUE_KEY, JSON.stringify(remain));
  return flushed;
}
