/**
 * Sri Lankan Bank / Public / Mercantile holidays 2024-2027
 * Source: CBSL Bank Holidays pages (cbsl.gov.lk) + Gazette + Commissioner of Labour notices.
 * - B = Bank Holiday, P = Public Holiday, M = Mercantile Holiday
 * - All Saturdays and Sundays are implicitly Bank holidays (handled via isWeekend).
 * - This file is the offline source of truth; no API key required.
 */

export type HolidayKind = 'B' | 'P' | 'M';

export interface SriLankanHoliday {
  date: string; // YYYY-MM-DD
  name: string;
  kinds: HolidayKind[];
  isPoya: boolean;
}

// Raw dataset 2024-2027 inclusive — per CBSL publications.
export const SRI_LANKAN_HOLIDAYS: SriLankanHoliday[] = [
  // 2024
  { date: '2024-01-15', name: 'Tamil Thai Pongal Day', kinds: ['B','P','M'], isPoya: false },
  { date: '2024-01-25', name: 'Duruthu Full Moon Poya Day', kinds: ['B','P'], isPoya: true },
  { date: '2024-02-04', name: 'Independence Day', kinds: ['B','P','M'], isPoya: false },
  { date: '2024-02-23', name: 'Navam Full Moon Poya Day', kinds: ['B','P'], isPoya: true },
  { date: '2024-03-08', name: 'Mahasivarathri Day', kinds: ['B','P'], isPoya: false },
  { date: '2024-03-24', name: 'Medin Full Moon Poya Day', kinds: ['B','P'], isPoya: true },
  { date: '2024-03-29', name: 'Good Friday', kinds: ['B','P'], isPoya: false },
  { date: '2024-04-11', name: 'Id-Ul-Fitr (Ramazan Festival Day)', kinds: ['B','P'], isPoya: false },
  { date: '2024-04-12', name: 'Day prior to Sinhala & Tamil New Year Day', kinds: ['B','P','M'], isPoya: false },
  { date: '2024-04-13', name: 'Sinhala & Tamil New Year Day', kinds: ['B','P','M'], isPoya: false },
  { date: '2024-04-23', name: 'Bak Full Moon Poya Day', kinds: ['B','P'], isPoya: true },
  { date: '2024-05-01', name: 'May Day (International Workers’ Day)', kinds: ['B','P','M'], isPoya: false },
  { date: '2024-05-23', name: 'Vesak Full Moon Poya Day', kinds: ['B','P'], isPoya: true },
  { date: '2024-05-24', name: 'Day following Vesak Full Moon Poya Day', kinds: ['B','P','M'], isPoya: false },
  { date: '2024-06-17', name: 'Id-Ul-Alha (Hadji Festival Day)', kinds: ['B','P'], isPoya: false },
  { date: '2024-06-21', name: 'Poson Full Moon Poya Day', kinds: ['B','P'], isPoya: true },
  { date: '2024-07-20', name: 'Esala Full Moon Poya Day', kinds: ['B','P'], isPoya: true },
  { date: '2024-08-19', name: 'Nikini Full Moon Poya Day', kinds: ['B','P'], isPoya: true },
  { date: '2024-09-16', name: 'Milad-Un-Nabi (Holy Prophet’s Birthday)', kinds: ['B','P','M'], isPoya: false },
  { date: '2024-09-17', name: 'Binara Full Moon Poya Day', kinds: ['B','P'], isPoya: true },
  { date: '2024-10-17', name: 'Vap Full Moon Poya Day', kinds: ['B','P'], isPoya: true },
  { date: '2024-10-31', name: 'Deepavali Festival Day', kinds: ['B','P'], isPoya: false },
  { date: '2024-11-15', name: 'Ill Full Moon Poya Day', kinds: ['B','P'], isPoya: true },
  { date: '2024-12-14', name: 'Unduvap Full Moon Poya Day', kinds: ['B','P'], isPoya: true },
  { date: '2024-12-25', name: 'Christmas Day', kinds: ['B','P','M'], isPoya: false },

  // 2025
  { date: '2025-01-13', name: 'Duruthu Full Moon Poya Day', kinds: ['B','P'], isPoya: true },
  { date: '2025-01-14', name: 'Tamil Thai Pongal Day', kinds: ['B','P','M'], isPoya: false },
  { date: '2025-02-04', name: 'Independence Day', kinds: ['B','P','M'], isPoya: false },
  { date: '2025-02-12', name: 'Navam Full Moon Poya Day', kinds: ['B','P'], isPoya: true },
  { date: '2025-02-26', name: 'Mahasivarathri Day', kinds: ['B','P'], isPoya: false },
  { date: '2025-03-13', name: 'Medin Full Moon Poya Day', kinds: ['B','P'], isPoya: true },
  { date: '2025-03-31', name: 'Id-Ul-Fitr (Ramazan Festival Day)', kinds: ['B','P'], isPoya: false },
  { date: '2025-04-12', name: 'Bak Full Moon Poya Day', kinds: ['B','P'], isPoya: true },
  { date: '2025-04-13', name: 'Day prior to Sinhala & Tamil New Year Day', kinds: ['B','P','M'], isPoya: false },
  { date: '2025-04-14', name: 'Sinhala & Tamil New Year Day', kinds: ['B','P','M'], isPoya: false },
  { date: '2025-04-15', name: 'Special Bank Holiday', kinds: ['B'], isPoya: false },
  { date: '2025-04-18', name: 'Good Friday', kinds: ['B','P'], isPoya: false },
  { date: '2025-05-01', name: 'May Day (International Workers’ Day)', kinds: ['B','P','M'], isPoya: false },
  { date: '2025-05-12', name: 'Vesak Full Moon Poya Day', kinds: ['B','P'], isPoya: true },
  { date: '2025-05-13', name: 'Day following Vesak Full Moon Poya Day', kinds: ['B','P','M'], isPoya: false },
  { date: '2025-06-07', name: 'Id-Ul-Alha (Hadji Festival Day)', kinds: ['B','P'], isPoya: false },
  { date: '2025-06-10', name: 'Poson Full Moon Poya Day', kinds: ['B','P'], isPoya: true },
  { date: '2025-07-10', name: 'Esala Full Moon Poya Day', kinds: ['B','P'], isPoya: true },
  { date: '2025-08-08', name: 'Nikini Full Moon Poya Day', kinds: ['B','P'], isPoya: true },
  { date: '2025-09-05', name: 'Milad-Un-Nabi (Holy Prophet’s Birthday)', kinds: ['B','P','M'], isPoya: false },
  { date: '2025-09-07', name: 'Binara Full Moon Poya Day', kinds: ['B','P'], isPoya: true },
  { date: '2025-10-06', name: 'Vap Full Moon Poya Day', kinds: ['B','P'], isPoya: true },
  { date: '2025-10-20', name: 'Deepavali Festival Day', kinds: ['B','P'], isPoya: false },
  { date: '2025-11-05', name: 'Ill Full Moon Poya Day', kinds: ['B','P'], isPoya: true },
  { date: '2025-12-04', name: 'Unduvap Full Moon Poya Day', kinds: ['B','P'], isPoya: true },
  { date: '2025-12-25', name: 'Christmas Day', kinds: ['B','P','M'], isPoya: false },

  // 2026
  { date: '2026-01-03', name: 'Duruthu Full Moon Poya Day', kinds: ['B','P'], isPoya: true },
  { date: '2026-01-15', name: 'Tamil Thai Pongal Day', kinds: ['B','P','M'], isPoya: false },
  { date: '2026-02-01', name: 'Navam Full Moon Poya Day', kinds: ['B','P'], isPoya: true },
  { date: '2026-02-04', name: 'Independence Day', kinds: ['B','P','M'], isPoya: false },
  { date: '2026-02-15', name: 'Mahasivarathri Day', kinds: ['B','P'], isPoya: false },
  { date: '2026-03-02', name: 'Medin Full Moon Poya Day', kinds: ['B','P'], isPoya: true },
  { date: '2026-03-21', name: 'Id-Ul-Fitr (Ramazan Festival Day)', kinds: ['B','P'], isPoya: false },
  { date: '2026-04-01', name: 'Bak Full Moon Poya Day', kinds: ['B','P'], isPoya: true },
  { date: '2026-04-03', name: 'Good Friday', kinds: ['B','P'], isPoya: false },
  { date: '2026-04-13', name: 'Day prior to Sinhala & Tamil New Year Day', kinds: ['B','P','M'], isPoya: false },
  { date: '2026-04-14', name: 'Sinhala & Tamil New Year Day', kinds: ['B','P','M'], isPoya: false },
  { date: '2026-05-01', name: 'Vesak Full Moon Poya Day', kinds: ['B','P'], isPoya: true },
  // 2026-05-01 is also May Day — same date, merge kinds B,P,M
  { date: '2026-05-02', name: 'Day following Vesak Full Moon Poya Day', kinds: ['B','P','M'], isPoya: false },
  { date: '2026-05-28', name: 'Id-Ul-Alha (Hadji Festival Day)', kinds: ['B','P'], isPoya: false },
  { date: '2026-05-30', name: 'Adhi Poson Full Moon Poya Day', kinds: ['B','P'], isPoya: true },
  { date: '2026-06-29', name: 'Poson Full Moon Poya Day', kinds: ['B','P'], isPoya: true },
  { date: '2026-07-29', name: 'Esala Full Moon Poya Day', kinds: ['B','P'], isPoya: true },
  { date: '2026-08-26', name: 'Milad-Un-Nabi (Holy Prophet’s Birthday)', kinds: ['B','P','M'], isPoya: false },
  { date: '2026-08-27', name: 'Nikini Full Moon Poya Day', kinds: ['B','P'], isPoya: true },
  { date: '2026-09-26', name: 'Binara Full Moon Poya Day', kinds: ['B','P'], isPoya: true },
  { date: '2026-10-25', name: 'Vap Full Moon Poya Day', kinds: ['B','P'], isPoya: true },
  { date: '2026-11-08', name: 'Deepavali Festival Day', kinds: ['B','P'], isPoya: false },
  { date: '2026-11-24', name: 'Ill Full Moon Poya Day', kinds: ['B','P'], isPoya: true },
  { date: '2026-12-23', name: 'Unduvap Full Moon Poya Day', kinds: ['B','P'], isPoya: true },
  { date: '2026-12-25', name: 'Christmas Day', kinds: ['B','P','M'], isPoya: false },

  // 2027
  { date: '2027-01-15', name: 'Tamil Thai Pongal Day', kinds: ['B','P','M'], isPoya: false },
  { date: '2027-01-22', name: 'Duruthu Full Moon Poya Day', kinds: ['B','P'], isPoya: true },
  { date: '2027-02-04', name: 'Independence Day', kinds: ['B','P','M'], isPoya: false },
  { date: '2027-02-20', name: 'Navam Full Moon Poya Day', kinds: ['B','P'], isPoya: true },
  { date: '2027-03-06', name: 'Mahasivarathri Day', kinds: ['B','P'], isPoya: false },
  { date: '2027-03-10', name: 'Id-Ul-Fitr (Ramazan Festival Day)', kinds: ['B','P'], isPoya: false },
  { date: '2027-03-22', name: 'Medin Full Moon Poya Day', kinds: ['B','P'], isPoya: true },
  { date: '2027-03-26', name: 'Good Friday', kinds: ['B','P'], isPoya: false },
  { date: '2027-04-13', name: 'Day prior to Sinhala & Tamil New Year Day', kinds: ['B','P','M'], isPoya: false },
  { date: '2027-04-14', name: 'Sinhala & Tamil New Year Day', kinds: ['B','P','M'], isPoya: false },
  { date: '2027-04-20', name: 'Bak Full Moon Poya Day', kinds: ['B','P'], isPoya: true },
  { date: '2027-05-01', name: 'May Day (International Workers’ Day)', kinds: ['B','P','M'], isPoya: false },
  { date: '2027-05-17', name: 'Id-Ul-Alha (Hadji Festival Day)', kinds: ['B','P'], isPoya: false },
  { date: '2027-05-19', name: 'Vesak Full Moon Poya Day', kinds: ['B','P'], isPoya: true },
  { date: '2027-05-20', name: 'Day following Vesak Full Moon Poya Day', kinds: ['B','P','M'], isPoya: false },
  { date: '2027-06-18', name: 'Poson Full Moon Poya Day', kinds: ['B','P'], isPoya: true },
  { date: '2027-07-18', name: 'Esala Full Moon Poya Day', kinds: ['B','P'], isPoya: true },
  { date: '2027-08-15', name: 'Milad-Un-Nabi (Holy Prophet’s Birthday)', kinds: ['B','P','M'], isPoya: false },
  { date: '2027-08-16', name: 'Nikini Full Moon Poya Day', kinds: ['B','P'], isPoya: true },
  { date: '2027-09-15', name: 'Binara Full Moon Poya Day', kinds: ['B','P'], isPoya: true },
  { date: '2027-10-15', name: 'Vap Full Moon Poya Day', kinds: ['B','P'], isPoya: true },
  { date: '2027-10-28', name: 'Deepavali Festival Day', kinds: ['B','P'], isPoya: false },
  { date: '2027-11-13', name: 'Ill Full Moon Poya Day', kinds: ['B','P'], isPoya: true },
  { date: '2027-12-13', name: 'Unduvap Full Moon Poya Day', kinds: ['B','P'], isPoya: true },
  { date: '2027-12-25', name: 'Christmas Day', kinds: ['B','P','M'], isPoya: false },
];

const HOLIDAY_MAP = new Map<string, SriLankanHoliday>();
for (const h of SRI_LANKAN_HOLIDAYS) {
  const existing = HOLIDAY_MAP.get(h.date);
  if (existing) {
    // Merge duplicate date (e.g. 2026-05-01 Vesak + May Day)
    const merged: SriLankanHoliday = {
      date: h.date,
      name: `${existing.name} / ${h.name}`,
      kinds: Array.from(new Set([...existing.kinds, ...h.kinds])) as HolidayKind[],
      isPoya: existing.isPoya || h.isPoya,
    };
    HOLIDAY_MAP.set(h.date, merged);
  } else {
    HOLIDAY_MAP.set(h.date, h);
  }
}

// Special fix: 2026-05-01 should be M as well (May Day)
const may2026 = HOLIDAY_MAP.get('2026-05-01');
if (may2026 && !may2026.kinds.includes('M')) {
  may2026.kinds.push('M');
}

export function getHoliday(date: string): SriLankanHoliday | undefined {
  return HOLIDAY_MAP.get(date);
}

export function isWeekend(date: string): boolean {
  const [y, m, d] = date.split('-').map(Number);
  const day = new Date(y, m - 1, d).getDay();
  return day === 0 || day === 6; // Sunday or Saturday
}

export function isBankHoliday(date: string): boolean {
  return isWeekend(date) || (getHoliday(date)?.kinds.includes('B') ?? false);
}
export function isPublicHoliday(date: string): boolean {
  return getHoliday(date)?.kinds.includes('P') ?? false;
}
export function isMercantileHoliday(date: string): boolean {
  return getHoliday(date)?.kinds.includes('M') ?? false;
}
export function isPoya(date: string): boolean {
  return getHoliday(date)?.isPoya ?? false;
}

export type DayType =
  | 'Weekday'
  | 'Saturday'
  | 'Sunday'
  | 'BankHoliday'
  | 'PublicHoliday'
  | 'MercantileHoliday'
  | 'PersonalLeave';

export interface DayTypeInfo {
  date: string;
  dayOfWeek: string;
  isWeekend: boolean;
  holiday?: SriLankanHoliday;
  isLeave: boolean;
  dayType: DayType;
  label: string; // badge text
  isOffDay: boolean;
}

export function getDayOfWeekLabel(date: string): string {
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const [y,m,d] = date.split('-').map(Number);
  return days[new Date(y,m-1,d).getDay()];
}

/**
 * Priority: PersonalLeave > Mercantile > Public > Bank/Poya > Weekend > Weekday
 */
export function getDayTypeInfo(date: string, leaveSet: Set<string>): DayTypeInfo {
  const holiday = getHoliday(date);
  const isLeave = leaveSet.has(date);
  const weekend = isWeekend(date);
  const dayOfWeek = getDayOfWeekLabel(date);
  let dayType: DayType = 'Weekday';
  let label = 'Weekday';
  let isOffDay = false;

  if (isLeave) {
    dayType = 'PersonalLeave';
    label = 'Leave';
    isOffDay = true;
  } else if (holiday?.kinds.includes('M')) {
    dayType = 'MercantileHoliday';
    label = holiday.isPoya ? 'Mercantile • Poya' : 'Mercantile';
    isOffDay = true;
  } else if (holiday?.kinds.includes('P')) {
    dayType = 'PublicHoliday';
    label = holiday.isPoya ? 'Poya' : 'Public Holiday';
    isOffDay = true;
  } else if (holiday?.kinds.includes('B')) {
    dayType = 'BankHoliday';
    label = holiday.isPoya ? 'Poya' : 'Bank Holiday';
    isOffDay = true;
  } else if (weekend) {
    dayType = dayOfWeek === 'Saturday' ? 'Saturday' : 'Sunday';
    label = dayOfWeek;
    isOffDay = true;
  }

  if (holiday && !isLeave) {
    // Append holiday name for tooltip/badge detail where relevant — keep label short, detail via name
  }

  return { date, dayOfWeek, isWeekend: weekend, holiday, isLeave, dayType, label, isOffDay };
}

export function isOffDay(date: string, leaveSet: Set<string>): boolean {
  return getDayTypeInfo(date, leaveSet).isOffDay;
}

// Calendar helpers
export const CALENDAR_RANGE = {
  startYear: 2024,
  endYear: 2027,
  startDate: '2024-01-01',
  endDate: '2027-12-31',
};

export function getYearsInRange(): number[] {
  const years: number[] = [];
  for (let y = CALENDAR_RANGE.startYear; y <= CALENDAR_RANGE.endYear; y++) years.push(y);
  return years;
}

export function getMonthsForYear(year: number): string[] {
  const months: string[] = [];
  for (let m = 1; m <= 12; m++) months.push(`${year}-${String(m).padStart(2,'0')}`);
  return months;
}
