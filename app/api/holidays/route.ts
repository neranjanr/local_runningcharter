import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { query } from '@/lib/db';
import { SRI_LANKAN_HOLIDAYS, type SriLankanHoliday } from '@/lib/sriLankanHolidays';

async function validateSession(): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get('session_token')?.value;
  if (!token) return false;
  const { rows } = await query('SELECT 1 FROM sessions WHERE token = $1 AND datetime(expires_at) > datetime(\'now\')', [token]);
  return rows.length > 0;
}

export async function GET() {
  if (!(await validateSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // Return DB holidays (dynamic) merged with static for client convenience
  const { rows: dbRows } = await query('SELECT date, name, kinds, isPoya, source FROM holidays ORDER BY date ASC');
  const dbHolidays: SriLankanHoliday[] = dbRows.map((r: any) => ({
    date: r.date,
    name: r.name,
    kinds: JSON.parse(r.kinds) as SriLankanHoliday['kinds'],
    isPoya: !!r.isPoya,
  }));
  // Merge static + dynamic (dynamic wins)
  const map = new Map<string, SriLankanHoliday>();
  for (const h of SRI_LANKAN_HOLIDAYS) {
    const ex = map.get(h.date);
    if (ex) {
      map.set(h.date, {
        date: h.date,
        name: `${ex.name} / ${h.name}`,
        kinds: Array.from(new Set([...ex.kinds, ...h.kinds])) as SriLankanHoliday['kinds'],
        isPoya: ex.isPoya || h.isPoya,
      });
    } else map.set(h.date, h);
  }
  for (const h of dbHolidays) map.set(h.date, h);
  const merged = Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
  return NextResponse.json({ holidays: merged, dbCount: dbRows.length, staticCount: SRI_LANKAN_HOLIDAYS.length });
}

export async function POST(req: Request) {
  if (!(await validateSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: any = {};
  try { body = await req.json(); } catch {}
  const list: SriLankanHoliday[] = Array.isArray(body.holidays) ? body.holidays : Array.isArray(body) ? body : [];
  if (list.length === 0) return NextResponse.json({ error: 'No holidays provided (expected {holidays: [...]})' }, { status: 400 });
  let upserted = 0;
  for (const h of list) {
    if (!h.date || !/^\d{4}-\d{2}-\d{2}$/.test(h.date)) continue;
    const kinds = JSON.stringify((h.kinds || ['B']).filter((k: string) => ['B','P','M'].includes(k)));
    const isPoya = h.isPoya ? 1 : 0;
    const name = String(h.name || h.date).slice(0, 200);
    await query(
      `INSERT INTO holidays (date, name, kinds, isPoya, source, updated_at) VALUES ($1,$2,$3,$4,'manual', datetime('now'))
       ON CONFLICT(date) DO UPDATE SET name=excluded.name, kinds=excluded.kinds, isPoya=excluded.isPoya, source='manual', updated_at=datetime('now')`,
      [h.date, name, kinds, isPoya]
    );
    upserted++;
  }
  return NextResponse.json({ success: true, upserted });
}
