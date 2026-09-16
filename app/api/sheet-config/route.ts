import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { query } from '@/lib/db';
import fs from 'fs';
import path from 'path';

async function validateSession(): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get('session_token')?.value;
  if (!token) return false;
  const { rows } = await query('SELECT 1 FROM sessions WHERE token = $1 AND datetime(expires_at) > datetime(\'now\')', [token]);
  return rows.length > 0;
}

export async function GET() {
  if (!(await validateSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let fileConfig: { sheetId?: string; sheetUrl?: string; scriptUrl?: string } | null = null;
  try {
    const p = path.join(process.cwd(), 'config', 'sheet.local.json');
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf8');
      fileConfig = JSON.parse(raw);
    }
  } catch {
    // ignore parse errors, fall through to env fallback
  }

  const sheetId = fileConfig?.sheetId || process.env.NEXT_PUBLIC_SHEET_ID || '';
  let sheetUrl = fileConfig?.sheetUrl || '';
  // derive url from id if missing
  if (!sheetUrl && sheetId) sheetUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/edit?gid=0#gid=0`;
  if (!sheetUrl) sheetUrl = process.env.NEXT_PUBLIC_SHEET_ID ? `https://docs.google.com/spreadsheets/d/${process.env.NEXT_PUBLIC_SHEET_ID}/edit?gid=0#gid=0` : '';

  const scriptUrl = fileConfig?.scriptUrl || process.env.NEXT_PUBLIC_SCRIPT_URL || '';

  // also support sheetUrl containing id extraction if sheetId empty but url provided
  let resolvedId = sheetId;
  if (!resolvedId && fileConfig?.sheetUrl) {
    const m = fileConfig.sheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (m) resolvedId = m[1];
  }

  return NextResponse.json({
    sheetId: resolvedId || sheetId,
    sheetUrl,
    scriptUrl,
    source: fileConfig ? 'file' : (process.env.NEXT_PUBLIC_SHEET_ID || process.env.NEXT_PUBLIC_SCRIPT_URL ? 'env' : 'empty'),
  });
}
