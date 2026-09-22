import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { cookies } from 'next/headers';
import fs from 'fs';
import path from 'path';

const DEFAULT_CONFIG = { mode: 'default' } as const;

async function validateSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get('session_token')?.value;
  if (!token) return false;
  const { rows } = await query('SELECT 1 FROM sessions WHERE token = $1 AND expires_at > NOW()', [token]);
  return rows.length > 0;
}

export async function GET() {
  if (!(await validateSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { rows } = await query("SELECT value FROM app_config WHERE key = $1", ['speedConfig']);
    if (rows.length > 0) {
      const parsed = JSON.parse(rows[0].value);
      return NextResponse.json(parsed);
    }
  } catch {}
  return NextResponse.json(DEFAULT_CONFIG);
}

export async function PUT(request: NextRequest) {
  if (!(await validateSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await request.json();
    // basic shape validation — detailed slab validation happens client-side but re-validate minimal
    if (!body || !['default', 'custom', 'traffic'].includes(body.mode)) {
      return NextResponse.json({ error: 'Invalid mode' }, { status: 400 });
    }
    const value = JSON.stringify(body);
    await query(
      `INSERT INTO app_config (key, value, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT(key) DO UPDATE SET value = $2, updated_at = NOW()`,
      ['speedConfig', value]
    );
    // Rebuild mobile template's SPEED_CONFIG (ADR-0025) — mirror scripts/build-mobile.js injection
    try {
      const repoRoot = process.cwd();
      const templatePath = path.join(repoRoot, 'quicktrip-mobile', 'dist', 'mobile_app_public.html');
      if (fs.existsSync(templatePath)) {
        let html = fs.readFileSync(templatePath, 'utf8');
        const injected = `const SPEED_CONFIG = ${value};`;
        if (html.includes('const SPEED_CONFIG =')) {
          html = html.replace(/const SPEED_CONFIG\s*=\s*\{[^;]*\};/, injected);
        } else {
          html = html.replace('const SCRIPT_URL_DEFAULT =', `${injected}\nconst SCRIPT_URL_DEFAULT =`);
        }
        fs.writeFileSync(templatePath, html, 'utf8');
        // also patch private file if exists
        const privatePath = path.join(repoRoot, 'quicktrip-mobile', 'dist', 'Mobile_with_url_private.html');
        if (fs.existsSync(privatePath)) {
          let priv = fs.readFileSync(privatePath, 'utf8');
          if (priv.includes('const SPEED_CONFIG =')) {
            priv = priv.replace(/const SPEED_CONFIG\s*=\s*\{[^;]*\};/, injected);
          } else {
            priv = priv.replace('const SCRIPT_URL_DEFAULT =', `${injected}\nconst SCRIPT_URL_DEFAULT =`);
          }
          fs.writeFileSync(privatePath, priv, 'utf8');
        }
      }
    } catch (e) {
      console.warn('[speed-config] mobile rebuild failed', e);
    }
    return NextResponse.json(body);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
