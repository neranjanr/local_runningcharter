import type { SriLankanHoliday } from './sriLankanHolidays';

async function apiFetch(url: string, opts?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 8000);
  try {
    return await fetch(url, { ...opts, signal: controller.signal, headers: { 'Content-Type': 'application/json', ...opts?.headers } });
  } finally {
    clearTimeout(t);
  }
}

export async function getHolidays(): Promise<SriLankanHoliday[]> {
  const res = await apiFetch('/api/holidays');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  return (j.holidays || []) as SriLankanHoliday[];
}

export async function refreshHolidaysFromSource(year?: number): Promise<{ year: number; fetched: number; upserted: number; holidays: SriLankanHoliday[]; source: string }> {
  const res = await apiFetch('/api/holidays/refresh', {
    method: 'POST',
    body: JSON.stringify(year ? { year } : {}),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
  return j;
}

export async function saveHolidays(holidays: SriLankanHoliday[]): Promise<void> {
  const res = await apiFetch('/api/holidays', { method: 'POST', body: JSON.stringify({ holidays }) });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || `HTTP ${res.status}`);
  }
}
