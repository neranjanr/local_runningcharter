import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { cookies } from 'next/headers';

async function validateSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get('session_token')?.value;
  if (!token) return false;
  const { rows } = await query('SELECT 1 FROM sessions WHERE token = $1 AND expires_at > NOW()', [token]);
  return rows.length > 0;
}

export async function GET() {
  if (!(await validateSession())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { rows } = await query('SELECT * FROM trips ORDER BY date ASC, start_km ASC');
  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  if (!(await validateSession())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = await request.json();
  // Guard: is_full_tank ⇒ pumped>0
  if (body.is_full_tank && !(body.fuel_pumped_amount > 0)) {
    return NextResponse.json({ error: 'is_full_tank requires fuel_pumped_amount > 0' }, { status: 400 });
  }
  // Normalize pump_timing
  const pumpedForTiming = body.fuel_pumped_amount ?? 0;
  let pumpTiming: string = 'END';
  if (pumpedForTiming > 0) {
    const v = String(body.pump_timing ?? 'END').trim().toUpperCase();
    pumpTiming = v === 'START' ? 'START' : 'END';
  }
  const { rows } = await query(
    `INSERT INTO trips (id, page_id, vehicle_id, date, day_index, trip_index, start_time, end_time, start_km, end_km, trip_distance, trip_type, places_visited, fuel_pumped_amount, fuel_order_no, is_full_tank, pump_timing)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
    [body.id, body.page_id, body.vehicle_id, body.date, body.day_index, body.trip_index,
     body.start_time, body.end_time, body.start_km, body.end_km, body.trip_distance,
     body.trip_type, body.places_visited, body.fuel_pumped_amount ?? 0, body.fuel_order_no ?? '', body.is_full_tank ? 1 : 0, pumpTiming]
  );
  return NextResponse.json(rows[0]);
}

export async function PUT(request: NextRequest) {
  if (!(await validateSession())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = await request.json();
  const { id, ...fields } = body;
  if (!id) return NextResponse.json({ error: 'Missing trip id' }, { status: 400 });
  if (fields.is_full_tank && !(fields.fuel_pumped_amount > 0) && !(fields.fuel_pumped_amount === undefined)) {
    // need existing pumped check - fetch existing
    const { rows: existingRows } = await query('SELECT fuel_pumped_amount FROM trips WHERE id = $1', [id]);
    const existingPumped = existingRows[0]?.fuel_pumped_amount ?? 0;
    const pumped = fields.fuel_pumped_amount ?? existingPumped;
    if (!(pumped > 0)) return NextResponse.json({ error: 'is_full_tank requires fuel_pumped_amount > 0' }, { status: 400 });
  }
  // Normalize is_full_tank to 0/1
  if ('is_full_tank' in fields) fields.is_full_tank = fields.is_full_tank ? 1 : 0;
  // Normalize pump_timing; only when pumped>0 else force END
  if ('pump_timing' in fields) {
    const pumpedProvided = fields.fuel_pumped_amount;
    let effectivePumped: number;
    if (pumpedProvided !== undefined) effectivePumped = pumpedProvided;
    else {
      const { rows: er } = await query('SELECT fuel_pumped_amount FROM trips WHERE id = $1', [id]);
      effectivePumped = er[0]?.fuel_pumped_amount ?? 0;
    }
    if (!(effectivePumped > 0)) fields.pump_timing = 'END';
    else {
      const v = String(fields.pump_timing ?? 'END').trim().toUpperCase();
      fields.pump_timing = v === 'START' ? 'START' : 'END';
    }
  }

  const setClauses: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  for (const [key, val] of Object.entries(fields)) {
    setClauses.push(`${key} = $${idx}`);
    values.push(val);
    idx++;
  }
  values.push(id);
  const { rows } = await query(
    `UPDATE trips SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );
  return NextResponse.json(rows[0] ?? null);
}

export async function DELETE(request: NextRequest) {
  if (!(await validateSession())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing trip id' }, { status: 400 });
  await query('DELETE FROM trips WHERE id = $1', [id]);
  return NextResponse.json({ success: true });
}
