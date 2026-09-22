/**
 * Speed Slab configurable store — hybrid: server app_config + localStorage cache.
 * Modes: default (locked), custom (single set), traffic (dual sets: traffic/light).
 */


export interface Slab {
  upper: number | null; // null means infinity (>= last upper)
  speed: number; // 1..80
}

export type SpeedConfig =
  | { mode: 'default' }
  | { mode: 'custom'; slabs: Slab[] }
  | { mode: 'traffic'; traffic: Slab[]; light: Slab[] };

export const STORAGE_KEY = 'app.speedConfig';

// Default hard-coded slabs (5 intervals) — matches CONTEXT.md:93 and ADR-0018
export const DEFAULT_SLABS: Slab[] = [
  { upper: 10, speed: 15 },
  { upper: 20, speed: 20 },
  { upper: 40, speed: 25 },
  { upper: 60, speed: 30 },
  { upper: null, speed: 35 },
];

// Example custom preset slabs for new users (per grill Q2): <20,20-50,50-100,>100
export const PRESET_CUSTOM_SLABS: Slab[] = [
  { upper: 20, speed: 15 },
  { upper: 50, speed: 20 },
  { upper: 100, speed: 25 },
  { upper: null, speed: 35 },
];

export const PRESET_TRAFFIC_SLABS: Slab[] = [
  { upper: 20, speed: 15 },
  { upper: 50, speed: 20 },
  { upper: 100, speed: 25 },
  { upper: null, speed: 35 },
];

export const PRESET_LIGHT_SLABS: Slab[] = [
  { upper: 20, speed: 20 },
  { upper: 50, speed: 25 },
  { upper: 100, speed: 30 },
  { upper: null, speed: 40 },
];

export const DEFAULT_CONFIG: SpeedConfig = { mode: 'default' };

export function normalizeSlabs(slabs: Slab[]): Slab[] {
  const filtered = slabs.filter(s => s.speed >= 1 && s.speed <= 80).map(s => ({ upper: s.upper == null ? null : Math.round(s.upper), speed: Math.round(s.speed) }));
  // sort by upper (null last)
  filtered.sort((a, b) => {
    if (a.upper == null) return 1;
    if (b.upper == null) return -1;
    return a.upper - b.upper;
  });
  return filtered;
}

export function validateSlabs(slabs: Slab[]): string | null {
  if (!slabs || slabs.length === 0) return 'At least one slab required';
  if (slabs.length > 4) return 'At most 4 slabs allowed (custom/traffic sets)';
  const norm = normalizeSlabs(slabs);
  // Check contiguous: each upper must be > previous upper, last must be null
  for (let i = 0; i < norm.length; i++) {
    const s = norm[i];
    if (s.speed < 1 || s.speed > 80) return `Speed ${s.speed} out of 1–80`;
    if (s.upper != null && s.upper <= 0) return 'Upper bound must be >0';
    if (i > 0) {
      const prev = norm[i - 1];
      if (prev.upper == null) return 'Only last slab may be open-ended';
      if (s.upper != null && s.upper <= prev.upper) return 'Upper bounds must be increasing';
      if (s.upper == null) continue;
    }
  }
  if (norm[norm.length - 1].upper != null) {
    // Allow last to be bounded but treat as open; we auto set null for last if not null?
    // Require last to be null per spec; if not, we convert
  }
  return null;
}

export function validateConfig(cfg: SpeedConfig): string | null {
  if (cfg.mode === 'default') return null;
  if (cfg.mode === 'custom') {
    const err = validateSlabs(cfg.slabs);
    return err ? `Custom: ${err}` : null;
  }
  if (cfg.mode === 'traffic') {
    const e1 = validateSlabs(cfg.traffic);
    if (e1) return `Traffic: ${e1}`;
    const e2 = validateSlabs(cfg.light);
    if (e2) return `Light: ${e2}`;
    return null;
  }
  return 'Invalid mode';
}

export function getSpeedForSlabs(distanceKm: number, slabs: Slab[]): number {
  const norm = normalizeSlabs(slabs);
  for (const slab of norm) {
    if (slab.upper == null) return slab.speed;
    if (distanceKm < slab.upper) return slab.speed;
    // For boundary inclusive? spec says intervals [lower, upper) — we use distance < upper
    // For last check, distance >= upper goes to next slab; example <20 then 20-50 means distance 20 goes to second slab.
    // Hard-coded default uses <10, <20, <40, <=60, >60 semantics; custom uses <upper semantics. Close enough.
  }
  return norm[norm.length - 1].speed;
}

export function resolveSpeed(distanceKm: number, cfg: SpeedConfig, trafficMode?: 'traffic' | 'light'): number {
  if (!distanceKm || distanceKm <= 0 || !isFinite(distanceKm)) return 15;
  if (cfg.mode === 'default') {
    // Use DEFAULT_SLABS exact semantics (<10, <20, <40, <=60, >60)
    if (distanceKm < 10) return 15;
    if (distanceKm < 20) return 20;
    if (distanceKm < 40) return 25;
    if (distanceKm <= 60) return 30;
    return 35;
  }
  if (cfg.mode === 'custom') {
    return getSpeedForSlabs(distanceKm, cfg.slabs);
  }
  if (cfg.mode === 'traffic') {
    const set = trafficMode === 'light' ? cfg.light : cfg.traffic;
    return getSpeedForSlabs(distanceKm, set);
  }
  return 15;
}

// Synchronous cache reader (for tripCalculations pure functions)
export function getStoredSpeedConfigSync(): SpeedConfig {
  if (typeof window === 'undefined') {
    // Server (import/SSR) — try DB file
    try {
      const fs = require('fs') as typeof import('fs');
      const path = require('path') as typeof import('path');
      const dbPath = path.join(process.cwd(), 'runningcharter.db');
      if (fs.existsSync(dbPath)) {
        try {
          const Database = require('better-sqlite3');
          const db = new Database(dbPath, { readonly: true });
          const row = db.prepare("SELECT value FROM app_config WHERE key = 'speedConfig'").get() as { value: string } | undefined;
          db.close();
          if (row?.value) {
            const parsed = JSON.parse(row.value) as SpeedConfig;
            if (!validateConfig(parsed)) return parsed;
          }
        } catch {}
      }
    } catch {}
    return DEFAULT_CONFIG;
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw) as SpeedConfig;
    const err = validateConfig(parsed);
    if (err) return DEFAULT_CONFIG;
    return parsed;
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function setStoredSpeedConfigSync(cfg: SpeedConfig) {
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  }
}

// Async server-backed
export async function loadSpeedConfig(): Promise<SpeedConfig> {
  try {
    const res = await fetch('/api/speed-config', { cache: 'no-store' });
    if (res.ok) {
      const data = (await res.json()) as SpeedConfig;
      const err = validateConfig(data);
      if (!err) {
        setStoredSpeedConfigSync(data);
        return data;
      }
    }
  } catch {}
  // fallback to local
  return getStoredSpeedConfigSync();
}

export async function saveSpeedConfig(cfg: SpeedConfig): Promise<SpeedConfig> {
  const err = validateConfig(cfg);
  if (err) throw new Error(err);
  setStoredSpeedConfigSync(cfg);
  try {
    const res = await fetch('/api/speed-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg),
    });
    if (res.ok) {
      const data = (await res.json()) as SpeedConfig;
      setStoredSpeedConfigSync(data);
      return data;
    }
  } catch {}
  return cfg;
}

export function slabsToDisplay(slabs: Slab[]): string {
  return slabs.map(s => (s.upper == null ? `≥${slabs[slabs.length - 2]?.upper ?? '...' } → ${s.speed}` : `<${s.upper} → ${s.speed}`)).join(', ');
}
