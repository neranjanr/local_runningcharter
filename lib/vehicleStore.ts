import { Vehicle } from '@/types';

const LOCAL_STORAGE_KEY = 'fleetledger_vehicle_profile';

export const DEFAULT_VEHICLE: Vehicle = {
  id: 'default-vehicle-1',
  brand: 'Toyota',
  model: 'Hilux',
  vehicle_type: 'Double Cab',
  fuel_type: 'Diesel',
  tank_capacity: 80.0,
  current_odometer: 50000,
  current_fuel_level: 10.0,
  registration_no: 'CAB-1234',
  typical_economy_low: 7.0,
  typical_economy_high: 9.0,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

async function apiFetch(url: string, opts?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1000);
  try {
    return await fetch(url, { ...opts, signal: controller.signal, headers: { 'Content-Type': 'application/json', ...opts?.headers } });
  } finally {
    clearTimeout(timeout);
  }
}

export async function getVehicleProfile(): Promise<Vehicle> {
  try {
    const res = await apiFetch('/api/vehicles');
    if (res.ok) {
      const data = await res.json();
      if (data) {
        const v = data as Vehicle;
        if (v.typical_economy_low == null) v.typical_economy_low = DEFAULT_VEHICLE.typical_economy_low;
        if (v.typical_economy_high == null) v.typical_economy_high = DEFAULT_VEHICLE.typical_economy_high;
        if (!v.registration_no) v.registration_no = DEFAULT_VEHICLE.registration_no;
        return v;
      }
    }
  } catch {
    // Fall through to localStorage
  }

  // Fallback to localStorage (offline / unauthenticated)
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as Vehicle;
        if (!parsed.registration_no) parsed.registration_no = DEFAULT_VEHICLE.registration_no;
        if (parsed.typical_economy_low == null) parsed.typical_economy_low = DEFAULT_VEHICLE.typical_economy_low;
        if (parsed.typical_economy_high == null) parsed.typical_economy_high = DEFAULT_VEHICLE.typical_economy_high;
        return parsed;
      } catch {
        // ignore
      }
    } else {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(DEFAULT_VEHICLE));
    }
  }

  return DEFAULT_VEHICLE;
}

export async function saveVehicleProfile(vehicle: Partial<Vehicle>): Promise<Vehicle> {
  const current = await getVehicleProfile();
  const updated: Vehicle = { ...current, ...vehicle, updated_at: new Date().toISOString() };

  try {
    const res = await apiFetch('/api/vehicles', { method: 'PUT', body: JSON.stringify(updated) });
    if (res.ok) {
      const data = await res.json();
      if (data) return data as Vehicle;
    }
  } catch {
    // Fall through to localStorage
  }

  if (typeof window !== 'undefined') {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updated));
  }

  return updated;
}
