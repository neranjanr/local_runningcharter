import Database from 'better-sqlite3';
import path from 'path';
import crypto from 'crypto';

const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'runningcharter.db');
const db = new Database(dbPath);

db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS vehicles (
    id TEXT PRIMARY KEY,
    brand TEXT NOT NULL DEFAULT 'Toyota',
    model TEXT NOT NULL DEFAULT 'Hilux',
    vehicle_type TEXT NOT NULL DEFAULT 'Double Cab',
    fuel_type TEXT NOT NULL DEFAULT 'Diesel',
    tank_capacity REAL NOT NULL DEFAULT 80.0,
    current_odometer REAL NOT NULL DEFAULT 0.0,
    current_fuel_level REAL NOT NULL DEFAULT 10.0,
    registration_no TEXT DEFAULT 'CAB-1234',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS book_pages (
    id TEXT PRIMARY KEY,
    vehicle_id TEXT NOT NULL,
    page_number INTEGER NOT NULL,
    month TEXT NOT NULL,
    start_km REAL NOT NULL DEFAULT 0.0,
    end_km REAL NOT NULL DEFAULT 0.0,
    start_fuel_balance REAL NOT NULL DEFAULT 0.0,
    end_fuel_balance REAL NOT NULL DEFAULT 0.0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(vehicle_id, page_number),
    FOREIGN KEY(vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS trips (
    id TEXT PRIMARY KEY,
    page_id TEXT NOT NULL,
    vehicle_id TEXT NOT NULL,
    date TEXT NOT NULL,
    day_index INTEGER NOT NULL,
    trip_index INTEGER NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    start_km REAL NOT NULL,
    end_km REAL NOT NULL,
    trip_distance REAL NOT NULL,
    trip_type TEXT NOT NULL DEFAULT 'Official',
    places_visited TEXT NOT NULL,
    fuel_pumped_amount REAL DEFAULT 0.0,
    fuel_order_no TEXT DEFAULT '',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(page_id) REFERENCES book_pages(id) ON DELETE CASCADE,
    FOREIGN KEY(vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS fuel_logs (
    id TEXT PRIMARY KEY,
    page_id TEXT NOT NULL,
    vehicle_id TEXT NOT NULL,
    day_index INTEGER NOT NULL,
    start_km_of_day REAL NOT NULL DEFAULT 0.0,
    end_km_of_day REAL NOT NULL DEFAULT 0.0,
    distance_travelled REAL NOT NULL DEFAULT 0.0,
    fuel_economy REAL NOT NULL DEFAULT 10.0,
    fuel_position REAL NOT NULL DEFAULT 0.0,
    drawn_amount REAL NOT NULL DEFAULT 0.0,
    fuel_order_no TEXT DEFAULT '',
    consumed_amount REAL NOT NULL DEFAULT 0.0,
    balance_amount REAL NOT NULL DEFAULT 0.0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(page_id, day_index),
    FOREIGN KEY(page_id) REFERENCES book_pages(id) ON DELETE CASCADE,
    FOREIGN KEY(vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS super_admin (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL DEFAULT 'Neranjan',
    password_hash TEXT NOT NULL,
    must_change_password BOOLEAN NOT NULL DEFAULT 1,
    totp_secret_encrypted TEXT,
    totp_enabled BOOLEAN NOT NULL DEFAULT 0,
    totp_verified_at DATETIME,
    recovery_code_hash TEXT,
    recovery_code_created_at DATETIME,
    recovery_code_used_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_role TEXT NOT NULL DEFAULT 'super_admin',
    expires_at DATETIME NOT NULL,
    last_active_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

// Seed default super admin if not exists
const adminCount = db.prepare('SELECT COUNT(*) as count FROM super_admin WHERE username = ?').get('Neranjan') as { count: number };
if (adminCount.count === 0) {
  db.prepare(`
    INSERT INTO super_admin (id, username, password_hash, must_change_password, totp_enabled)
    VALUES (?, 'Neranjan', '3eec12103e18ed4b583491fd33733ab1e0c94a20aaf6c45b9515996066f7bd69', 1, 0)
  `).run(crypto.randomUUID ? crypto.randomUUID() : 'super-admin-id-1');
} else {
  // Update legacy placeholder hash if present
  db.prepare(`
    UPDATE super_admin SET password_hash = '3eec12103e18ed4b583491fd33733ab1e0c94a20aaf6c45b9515996066f7bd69'
    WHERE username = 'Neranjan' AND password_hash = '$2b$12$bootstrap_placeholder_will_be_rehashed_on_first_login'
  `).run();
}

// Seed default vehicle if none exists
const vehicleCount = db.prepare('SELECT COUNT(*) as count FROM vehicles').get() as { count: number };
if (vehicleCount.count === 0) {
  db.prepare(`
    INSERT INTO vehicles (id, brand, model, vehicle_type, fuel_type, tank_capacity, current_odometer, current_fuel_level, registration_no)
    VALUES (?, 'Toyota', 'Hilux', 'Double Cab', 'Diesel', 80.0, 50000.0, 10.0, 'CAB-1234')
  `).run(crypto.randomUUID ? crypto.randomUUID() : 'default-vehicle-1');
}

export async function query(text: string, params?: unknown[]): Promise<{ rows: any[] }> {
  let sql = text
    .replace(/NOW\(\)/gi, "datetime('now')")
    .replace(/COUNT\(\*\)::int/gi, "COUNT(*)");

  const paramValues = params ? [...params] : [];
  if (sql.includes('$')) {
    const matches = [...sql.matchAll(/\$(\d+)/g)];
    if (matches.length > 0 && params && params.length > 0) {
      let isSequential = true;
      matches.forEach((m, idx) => {
        if (parseInt(m[1], 10) !== idx + 1) isSequential = false;
      });
      if (isSequential) {
        sql = sql.replace(/\$\d+/g, '?');
      } else {
        const newParams: unknown[] = [];
        sql = sql.replace(/\$(\d+)/g, (_, group) => {
          const pIdx = parseInt(group, 10) - 1;
          newParams.push(params[pIdx]);
          return '?';
        });
        paramValues.length = 0;
        paramValues.push(...newParams);
      }
    } else {
      sql = sql.replace(/\$\d+/g, '?');
    }
  }

  sql = sql.replace(/datetime\('now'\)\s*-\s*'\+7 days'/gi, "datetime('now', '-7 days')");
  sql = sql.replace(/datetime\('now'\)\s*-\s*INTERVAL\s+'7 days'/gi, "datetime('now', '-7 days')");
  sql = sql.replace(/NOW\(\)\s*-\s*INTERVAL\s+'7 days'/gi, "datetime('now', '-7 days')");
  sql = sql.replace(/expires_at > NOW\(\)/gi, "datetime(expires_at) > datetime('now')");
  sql = sql.replace(/last_active_at > NOW\(\)\s*-\s*INTERVAL\s+'7 days'/gi, "datetime(last_active_at) > datetime('now', '-7 days')");

  const trimmed = sql.trim().toLowerCase();
  const isSelect = trimmed.startsWith('select') || trimmed.startsWith('with');
  const isReturning = trimmed.includes('returning');

  try {
    const stmt = db.prepare(sql);
    if (isSelect || isReturning) {
      const rows = stmt.all(...paramValues);
      return { rows };
    } else {
      stmt.run(...paramValues);
      return { rows: [] };
    }
  } catch (err) {
    console.error('SQL Error:', sql, paramValues, err);
    throw err;
  }
}

export async function getClient() {
  return {
    query,
    release: () => {},
  };
}

export default db;
