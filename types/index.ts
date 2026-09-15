export interface Vehicle {
  id: string;
  user_id?: string | null;
  brand: string;
  model: string;
  vehicle_type: string;
  fuel_type: string;
  tank_capacity: number;
  current_odometer: number; // Book Opening KM (earliest Page start) — also tracks latest for continuity fallback
  /** @deprecated removed in Phase 2 Issue 03 — use Book Opening fuel instead; kept optional for migration */
  current_fuel_level?: number;
  registration_no?: string; // Phase 2: Vehicle Registration No (paper header)
  created_at?: string;
  updated_at?: string;
}

export interface BookPage {
  id: string;
  vehicle_id: string;
  page_number: number;
  month: string;
  start_km: number;
  end_km: number;
  start_fuel_balance: number;
  end_fuel_balance: number;
  created_at?: string;
}

export interface Trip {
  id: string;
  page_id: string;
  vehicle_id: string;
  date: string;
  day_index: number; // 1 to 4
  trip_index: number; // 1 to 13
  start_time: string; // optional: may be "" when not captured; Estimated Start Time can fill it
  end_time: string;
  start_km: number; // Integer KM
  end_km: number; // Integer KM
  trip_distance: number; // Integer KM = round(end - start)
  trip_type: 'Official' | 'Private';
  places_visited: string;
  fuel_pumped_amount?: number;
  fuel_order_no?: string;
  created_at?: string;
}

export interface FuelLog {
  id: string;
  page_id: string;
  vehicle_id: string;
  day_index: number; // 1 to 4
  start_km_of_day: number;
  end_km_of_day: number;
  distance_travelled: number;
  fuel_economy: number;
  fuel_position: number;
  drawn_amount: number;
  fuel_order_no: string;
  consumed_amount: number;
  balance_amount: number;
  created_at?: string;
}

export interface LeaveDay {
  id: string;
  date: string; // YYYY-MM-DD
  note?: string;
  created_at?: string;
}
