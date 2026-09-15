import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { cookies } from 'next/headers';

async function validateSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get('session_token')?.value;
  if (!token) return false;
  const { rows } = await query('SELECT 1 FROM sessions WHERE token = $1 AND datetime(expires_at) > datetime(\'now\')', [token]);
  return rows.length > 0;
}

export async function GET() {
  if (!(await validateSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { rows } = await query('SELECT * FROM leaves ORDER BY date ASC');
  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  if (!(await validateSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json();
  if (!body.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
  const y = Number(body.date.slice(0,4));
  if (y < 2024 || y > 2027) return NextResponse.json({ error: 'Leaves allowed 2024-2027 only' }, { status: 400 });
  const note = String(body.note ?? '').slice(0, 200);
  const id = body.id || `leave-${body.date}-${Date.now()}`;
  const { rows } = await query(
    `INSERT INTO leaves (id, date, note) VALUES ($1,$2,$3)
     ON CONFLICT(date) DO UPDATE SET note=excluded.note RETURNING *`,
    [id, body.date, note]
  );
  return NextResponse.json(rows[0]);
}

export async function PUT(request: NextRequest) {
  if (!(await validateSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json();
  if (!body.date) return NextResponse.json({ error: 'Missing date' }, { status: 400 });
  const note = String(body.note ?? '').slice(0, 200);
  const { rows } = await query(`UPDATE leaves SET note=$1 WHERE date=$2 RETURNING *`, [note, body.date]);
  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(rows[0]);
}

export async function DELETE(request: NextRequest) {
  if (!(await validateSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date');
  if (!date) return NextResponse.json({ error: 'Missing date' }, { status: 400 });
  await query('DELETE FROM leaves WHERE date=$1', [date]);
  return NextResponse.json({ success: true });
}
