import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { query } from '@/lib/db';
import db from '@/lib/db';

async function validateSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get('session_token')?.value;
  if (!token) return false;
  const { rows } = await query('SELECT 1 FROM sessions WHERE token = $1 AND datetime(expires_at) > datetime(\'now\')', [token]);
  return rows.length > 0;
}

export async function POST(request: NextRequest) {
  if (!(await validateSession())) {
    return NextResponse.json({ error: 'Unauthorized — please re-login before importing' }, { status: 401 });
  }
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const pages: any[] = body.pages || [];
  const trips: any[] = body.trips || [];
  if (!Array.isArray(pages) || !Array.isArray(trips)) {
    return NextResponse.json({ error: 'pages and trips must be arrays' }, { status: 400 });
  }

  try {
    const insertPages = db.transaction((pagesToInsert: any[]) => {
      const stmt = db.prepare(`
        INSERT INTO book_pages (id, vehicle_id, page_number, month, start_km, end_km, start_fuel_balance, end_fuel_balance)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          vehicle_id=excluded.vehicle_id,
          page_number=excluded.page_number,
          month=excluded.month,
          start_km=excluded.start_km,
          end_km=excluded.end_km,
          start_fuel_balance=excluded.start_fuel_balance,
          end_fuel_balance=excluded.end_fuel_balance
      `);
      for (const p of pagesToInsert) {
        stmt.run(p.id, p.vehicle_id, p.page_number, p.month, p.start_km ?? 0, p.end_km ?? 0, p.start_fuel_balance ?? 0, p.end_fuel_balance ?? 0);
      }
    });

    const insertTrips = db.transaction((tripsToInsert: any[]) => {
      const stmt = db.prepare(`
        INSERT INTO trips (id, page_id, vehicle_id, date, day_index, trip_index, start_time, end_time, start_km, end_km, trip_distance, trip_type, places_visited, fuel_pumped_amount, fuel_order_no)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          page_id=excluded.page_id,
          vehicle_id=excluded.vehicle_id,
          date=excluded.date,
          day_index=excluded.day_index,
          trip_index=excluded.trip_index,
          start_time=excluded.start_time,
          end_time=excluded.end_time,
          start_km=excluded.start_km,
          end_km=excluded.end_km,
          trip_distance=excluded.trip_distance,
          trip_type=excluded.trip_type,
          places_visited=excluded.places_visited,
          fuel_pumped_amount=excluded.fuel_pumped_amount,
          fuel_order_no=excluded.fuel_order_no
      `);
      for (const t of tripsToInsert) {
        stmt.run(
          t.id, t.page_id, t.vehicle_id, t.date, t.day_index ?? 1, t.trip_index ?? 1,
          t.start_time ?? '', t.end_time ?? '', t.start_km ?? 0, t.end_km ?? 0, t.trip_distance ?? 0,
          t.trip_type ?? 'Official', t.places_visited ?? '', t.fuel_pumped_amount ?? 0, t.fuel_order_no ?? ''
        );
      }
    });

    insertPages(pages);
    insertTrips(trips);

    return NextResponse.json({ success: true, pages: pages.length, trips: trips.length });
  } catch (e: any) {
    console.error('Bulk import error', e);
    return NextResponse.json({ error: e?.message || 'Bulk import failed' }, { status: 500 });
  }
}
