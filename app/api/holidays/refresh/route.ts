import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { query } from '@/lib/db';
import type { SriLankanHoliday, HolidayKind } from '@/lib/sriLankanHolidays';

async function validateSession(): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get('session_token')?.value;
  if (!token) return false;
  const { rows } = await query('SELECT 1 FROM sessions WHERE token = $1 AND datetime(expires_at) > datetime(\'now\')', [token]);
  return rows.length > 0;
}

// Map Nager.Date types to B/P/M + Poya detection
function mapNagerToKinds(types: string[], name: string): { kinds: HolidayKind[]; isPoya: boolean } {
  const lower = types.map((t) => t.toLowerCase());
  const isPoya = /poya/i.test(name);
  let kinds: HolidayKind[] = [];
  if (lower.includes('public')) kinds.push('P', 'B');
  else kinds.push('B');
  // Nager doesn't distinguish Mercantile; keep B/P only. User can edit to M later.
  if (isPoya && !kinds.includes('P')) kinds.push('P');
  // Mercantile not auto-detected; leave as is
  kinds = Array.from(new Set(kinds)) as HolidayKind[];
  return { kinds, isPoya };
}

export async function POST(req: Request) {
  if (!(await validateSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let year: number | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    if (body.year) year = Number(body.year);
  } catch {}
  if (!year) {
    const url = new URL(req.url);
    const y = url.searchParams.get('year');
    if (y) year = Number(y);
  }
  if (!year) {
    // default to next auto-extended year or current year
    year = new Date().getFullYear();
    // if Dec, also fetch next year
    if (new Date().getMonth() === 11) year = year + 1;
  }
  if (!Number.isFinite(year) || year < 2024 || year > 2100) return NextResponse.json({ error: 'Invalid year' }, { status: 400 });

  // Fetch from Nager.Date (free, no key) — https://date.nager.at/api/v3/PublicHolidays/{year}/LK
  const url = `https://date.nager.at/api/v3/PublicHolidays/${year}/LK`;
  let fetched: any[] = [];
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 8000);
    const r = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    clearTimeout(t);
    if (!r.ok) throw new Error(`Source HTTP ${r.status}`);
    fetched = await r.json();
    if (!Array.isArray(fetched)) throw new Error('Unexpected source format');
  } catch (e: unknown) {
    const m = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `Failed to query source (${url}): ${m}. You can instead add holidays manually via POST /api/holidays.` }, { status: 502 });
  }

  let upserted = 0;
  const toReturn: SriLankanHoliday[] = [];
  for (const item of fetched) {
    const date = String(item.date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const name = String(item.localName || item.name || date).slice(0, 200);
    const types: string[] = Array.isArray(item.types) ? item.types : item.type ? [item.type] : ['Public'];
    const { kinds, isPoya } = mapNagerToKinds(types, name);
    const kindsJson = JSON.stringify(kinds);
    await query(
      `INSERT INTO holidays (date, name, kinds, isPoya, source, updated_at) VALUES ($1,$2,$3,$4,$5, datetime('now'))
       ON CONFLICT(date) DO UPDATE SET name=excluded.name, kinds=excluded.kinds, isPoya=excluded.isPoya, source=excluded.source, updated_at=datetime('now')`,
      [date, name, kindsJson, isPoya ? 1 : 0, 'nager']
    );
    upserted++;
    toReturn.push({ date, name, kinds, isPoya });
  }

  return NextResponse.json({ success: true, year, fetched: fetched.length, upserted, holidays: toReturn, source: url });
}

export async function GET(req: Request) {
  // Allow GET ?year=2028 as alias to POST
  return POST(req);
}
