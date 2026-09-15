/**
 * Sheet Client for Buffer Sheet (main app + QuickTrip Mobile shared)
 * Reuses same localStorage keys as quicktrip-mobile/lib/sheetClient.ts
 * Talks to Apps Script Web App — no Google credentials.
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
  date: string;
  start_km: number;
  end_km: number;
  trip_distance: number;
  start_time: string;
  end_time: string;
  trip_type: 'Official' | 'Private';
  places_visited: string;
  fuel_pumped_amount?: number;
  fuel_order_no?: string;
}

// Defaults loaded from gitignored config/sheet.local.json via lib/sheetConfig.ts (see config/sheet.example.json)
import { DEFAULT_SHEET_ID, DEFAULT_SHEET_URL, DEFAULT_SCRIPT_URL } from './sheetConfig';
export { DEFAULT_SHEET_ID, DEFAULT_SHEET_URL, DEFAULT_SCRIPT_URL };

export function getSheetSettings(): { sheetId: string; scriptUrl: string } {
  if (typeof window === 'undefined') return { sheetId: DEFAULT_SHEET_ID, scriptUrl: DEFAULT_SCRIPT_URL };
  return {
    sheetId: localStorage.getItem('mobile.sheetId') || process.env.NEXT_PUBLIC_SHEET_ID || DEFAULT_SHEET_ID,
    scriptUrl: localStorage.getItem('mobile.scriptUrl') || process.env.NEXT_PUBLIC_SCRIPT_URL || DEFAULT_SCRIPT_URL,
  };
}

export function hasCustomSheetSettings(): boolean {
  if (typeof window === 'undefined') return false;
  return !!localStorage.getItem('mobile.sheetId') || !!localStorage.getItem('mobile.scriptUrl');
}

export function useDefaultSheetSettings() {
  saveSheetSettings(DEFAULT_SHEET_ID, DEFAULT_SCRIPT_URL);
}

export function saveSheetSettings(sheetIdOrUrl: string, scriptUrl: string) {
  let id = sheetIdOrUrl.trim();
  const m = id.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (m) id = m[1];
  localStorage.setItem('mobile.sheetId', id);
  localStorage.setItem('mobile.scriptUrl', scriptUrl.trim());
}

export async function fetchAllRows(): Promise<BufferTrip[]> {
  const { scriptUrl } = getSheetSettings();
  if (!scriptUrl) throw new Error('Sheet Proxy URL not configured — open Settings');
  const url = scriptUrl + (scriptUrl.includes('?') ? '&' : '?') + 'action=allRows';
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) throw new Error(`Sheet fetch failed: ${res.status} — verify Apps Script deployed as "Anyone with link"`);
  const j = await res.json().catch(() => ({}));
  if (j.ok === false) throw new Error(j.error || 'Sheet rejected request');
  return (j.rows || j.trips || []) as BufferTrip[];
}

export async function fetchLast10(): Promise<BufferTrip[]> {
  const { scriptUrl } = getSheetSettings();
  if (!scriptUrl) return [];
  const url = scriptUrl + (scriptUrl.includes('?') ? '&' : '?') + 'action=last10';
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) return [];
  const j = await res.json();
  return (j.rows || j.trips || []) as BufferTrip[];
}

export function getLastPullAt(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('mobile.lastSheetPullAt');
}

export function setLastPullAt(iso: string) {
  if (typeof window === 'undefined') return;
  localStorage.setItem('mobile.lastSheetPullAt', iso);
}

export function getLastPushAt(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('mobile.lastSheetPushAt');
}

export function setLastPushAt(iso: string) {
  if (typeof window === 'undefined') return;
  localStorage.setItem('mobile.lastSheetPushAt', iso);
}

export async function pushAllRows(rows: BufferTrip[]): Promise<void> {
  const { scriptUrl } = getSheetSettings();
  if (!scriptUrl) throw new Error('Sheet Proxy URL not configured — open Settings');
  const url = scriptUrl + (scriptUrl.includes('?') ? '&' : '?') + 'action=rewriteSheet';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'rewriteSheet', rows }),
  });
  if (!res.ok) throw new Error(`Sheet push failed: ${res.status} — verify Apps Script deployed as "Anyone with link"`);
  const j = await res.json().catch(() => ({}));
  if (j.ok === false) {
    const err = String(j.error || 'Sheet rejected push');
    if (err.includes('expected {action:appendTrip')) {
      throw new Error('Your Apps Script deployment is OUTDATED — it only handles appendTrip. Update Apps Script: copy quicktrip-mobile/apps-script/Code.gs (v2 with rewriteSheet) → Deploy → New version → Anyone with link → copy new URL into config/sheet.local.json + Sheet Settings.');
    }
    throw new Error(err);
  }
}
