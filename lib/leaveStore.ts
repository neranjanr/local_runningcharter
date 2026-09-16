import type { LeaveDay } from '@/types';
import { CALENDAR_RANGE } from './sriLankanHolidays';

const LOCAL_KEY = 'fleetledger_leaves';

function readLocalLeaves(): LeaveDay[] {
  if (typeof window === 'undefined') return [];
  const raw = localStorage.getItem(LOCAL_KEY);
  if (!raw) return [];
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v as LeaveDay[] : []; } catch { return []; }
}
function writeLocalLeaves(leaves: LeaveDay[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(LOCAL_KEY, JSON.stringify(leaves));
}

async function apiFetch(url: string, opts?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 1500);
  try { return await fetch(url, { ...opts, signal: controller.signal, headers: { 'Content-Type': 'application/json', ...opts?.headers } }); }
  finally { clearTimeout(t); }
}

export async function getLeaves(): Promise<LeaveDay[]> {
  let apiLeaves: LeaveDay[] = [];
  try {
    const res = await apiFetch('/api/leaves');
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) apiLeaves = data;
    }
  } catch { /* ignore */ }
  const local = readLocalLeaves();
  if (apiLeaves.length > 0) return apiLeaves;
  if (local.length > 0) return local;
  return apiLeaves;
}

export async function getLeaveSet(): Promise<Set<string>> {
  const leaves = await getLeaves();
  return new Set(leaves.map(l => l.date));
}

export async function saveLeave(date: string, note?: string): Promise<LeaveDay> {
  const existing = (await getLeaves()).find(l => l.date === date);
  if (existing) {
    // update note
    const updated: LeaveDay = { ...existing, note: note ?? existing.note ?? '' };
    try {
      const res = await apiFetch('/api/leaves', { method: 'PUT', body: JSON.stringify(updated) });
      if (res.ok) return (await res.json()) as LeaveDay;
    } catch {}
    const local = readLocalLeaves();
    const idx = local.findIndex(l => l.date === date);
    if (idx >= 0) { local[idx] = updated; writeLocalLeaves(local); }
    return updated;
  }
  const newLeave: LeaveDay = { id: `leave-${date}-${Date.now()}`, date, note: note ?? '', created_at: new Date().toISOString() };
  try {
    const res = await apiFetch('/api/leaves', { method: 'POST', body: JSON.stringify(newLeave) });
    if (res.ok) return (await res.json()) as LeaveDay;
  } catch {}
  const updated = [...readLocalLeaves(), newLeave];
  writeLocalLeaves(updated);
  return newLeave;
}

export async function deleteLeave(date: string): Promise<boolean> {
  try {
    const res = await apiFetch(`/api/leaves?date=${encodeURIComponent(date)}`, { method: 'DELETE' });
    if (res.ok) return true;
  } catch {}
  const local = readLocalLeaves();
  const idx = local.findIndex(l => l.date === date);
  if (idx >= 0) { local.splice(idx, 1); writeLocalLeaves(local); return true; }
  return false;
}

export async function toggleLeave(date: string, note?: string): Promise<{ isLeave: boolean; leave?: LeaveDay }> {
  const set = await getLeaveSet();
  if (set.has(date)) {
    await deleteLeave(date);
    return { isLeave: false };
  } else {
    const lv = await saveLeave(date, note);
    return { isLeave: true, leave: lv };
  }
}

export function validateLeaveDate(date: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'Invalid date format YYYY-MM-DD';
  const [y, m, d] = date.split('-').map(Number);
  const endYear = CALENDAR_RANGE.endYear;
  if (y < CALENDAR_RANGE.startYear || y > endYear) return `Leaves allowed only ${CALENDAR_RANGE.startYear}-${endYear}`;
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() + 1 !== m || dt.getDate() !== d) return 'Invalid date';
  return null;
}
