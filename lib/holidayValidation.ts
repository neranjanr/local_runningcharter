import type { Trip } from '@/types';
import { getDayTypeInfo, CALENDAR_RANGE } from './sriLankanHolidays';

export interface OffDaySummary {
  totalTrips: number;
  offDayTrips: number;
  workingDayTrips: number;
  onWeekend: number;
  onBankHoliday: number;
  onPublicHoliday: number;
  onMercantile: number;
  onPoya: number;
  onLeave: number;
  offDayKm: number;
  workingDayKm: number;
  offDayList: Trip[];
  byMonth: Record<string, { off: number; working: number; offKm: number; workingKm: number }>;
}

export function validateTripsOnOffDays(trips: Trip[], leaveSet: Set<string>): OffDaySummary {
  let onWeekend = 0, onBankHoliday = 0, onPublicHoliday = 0, onMercantile = 0, onPoya = 0, onLeave = 0;
  let offDayKm = 0, workingDayKm = 0;
  const offDayList: Trip[] = [];
  const byMonth: Record<string, { off: number; working: number; offKm: number; workingKm: number }> = {};

  for (const t of trips) {
    const info = getDayTypeInfo(t.date, leaveSet);
    const month = t.date.slice(0,7);
    if (!byMonth[month]) byMonth[month] = { off: 0, working: 0, offKm: 0, workingKm: 0 };
    const km = Math.round(t.trip_distance);
    if (info.isOffDay) {
      offDayList.push(t);
      byMonth[month].off += 1;
      byMonth[month].offKm += km;
      offDayKm += km;
      // counts — note a date can be multiple kinds but we bucket by primary dayType
      if (info.isLeave) onLeave += 1;
      else if (info.holiday?.kinds.includes('M')) onMercantile += 1;
      else if (info.holiday?.kinds.includes('P')) { onPublicHoliday += 1; if (info.holiday.isPoya) onPoya += 1; }
      else if (info.holiday?.kinds.includes('B')) { onBankHoliday += 1; if (info.holiday?.isPoya) onPoya += 1; }
      else if (info.isWeekend) onWeekend += 1;
      // Poya also counted separately if weekend-poya? already covered via holiday
      if (info.holiday?.isPoya && info.dayType !== 'PublicHoliday' && info.dayType !== 'BankHoliday') {
        // leave+ poya already counted? keep onPoya separate
      }
      if (info.dayType === 'Saturday' || info.dayType === 'Sunday') {
        // if not holiday/leave, weekend already counted; if holiday we count as holiday not double
        if (!info.holiday && !info.isLeave) {
          // onWeekend already +1 above via isWeekend path
        }
      }
    } else {
      byMonth[month].working += 1;
      byMonth[month].workingKm += km;
      workingDayKm += km;
    }
  }

  // Weekend count should include holidays falling on weekend? We already bucket by holiday priority.
  // For summary clarity, compute pure weekend trips separately (Sat/Sun regardless of holiday/leave)
  // Add a second pass for pure weekend if needed — but keep primary buckets non-overlapping.

  return {
    totalTrips: trips.length,
    offDayTrips: offDayList.length,
    workingDayTrips: trips.length - offDayList.length,
    onWeekend,
    onBankHoliday,
    onPublicHoliday,
    onMercantile,
    onPoya,
    onLeave,
    offDayKm,
    workingDayKm,
    offDayList,
    byMonth,
  };
}

export interface NoTripWorkingDay {
  date: string;
  dayOfWeek: string;
}

export interface OffDayGroup {
  date: string;
  dayOfWeek: string;
  reason: string;
  label: string;
  holidayName?: string;
  trips: Trip[];
  totalKm: number;
}

export function getTripsOnOffDaysGrouped(trips: Trip[], leaveSet: Set<string>): OffDayGroup[] {
  const byDate = new Map<string, Trip[]>();
  for (const t of trips) {
    const info = getDayTypeInfo(t.date, leaveSet);
    if (!info.isOffDay) continue;
    if (!byDate.has(t.date)) byDate.set(t.date, []);
    byDate.get(t.date)!.push(t);
  }
  const groups: OffDayGroup[] = [];
  for (const [date, list] of Array.from(byDate.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    list.sort((a, b) => a.start_km - b.start_km);
    const info = getDayTypeInfo(date, leaveSet);
    const reason = info.isLeave ? 'Leave' : info.holiday ? `${info.holiday.name} (${info.holiday.kinds.join('/')})${info.holiday.isPoya ? ' • Poya' : ''}` : info.dayType;
    groups.push({
      date,
      dayOfWeek: info.dayOfWeek,
      reason,
      label: info.label,
      holidayName: info.holiday?.name,
      trips: list,
      totalKm: list.reduce((s, t) => s + Math.round(t.trip_distance), 0),
    });
  }
  return groups;
}

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function getNoTripWorkingDays(trips: Trip[], leaveSet: Set<string>): NoTripWorkingDay[] {
  if (trips.length === 0) return [];
  const sorted = [...trips].sort((a, b) => a.date.localeCompare(b.date) || a.start_km - b.start_km);
  const firstDate = sorted[0].date;
  const lastDate = sorted[sorted.length - 1].date;
  const tripDateSet = new Set(trips.map(t => t.date));

  // Build ODO gap intervals (exclusive) from Trip gaps where dates differ
  const intervals: Array<{ start: string; end: string }> = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const cur = sorted[i];
    const nxt = sorted[i + 1];
    if (Math.round(cur.end_km) !== Math.round(nxt.start_km)) {
      if (cur.date !== nxt.date) {
        intervals.push({ start: cur.date, end: nxt.date });
      }
    }
  }

  const isInsideGap = (d: string): boolean => {
    for (const iv of intervals) {
      if (d > iv.start && d < iv.end) return true;
    }
    return false;
  };

  // Clamp to CALENDAR_RANGE
  const rangeStart = CALENDAR_RANGE.startDate;
  const rangeEnd = CALENDAR_RANGE.endDate;
  const effStart = firstDate < rangeStart ? rangeStart : firstDate;
  const effEnd = lastDate > rangeEnd ? rangeEnd : lastDate;

  const result: NoTripWorkingDay[] = [];
  const cur = new Date(effStart + 'T00:00:00');
  const end = new Date(effEnd + 'T00:00:00');
  for (let d = new Date(cur); d <= end; d.setDate(d.getDate() + 1)) {
    const ds = toDateStr(d);
    if (tripDateSet.has(ds)) continue;
    const info = getDayTypeInfo(ds, leaveSet);
    if (info.isOffDay) continue;
    if (isInsideGap(ds)) continue;
    result.push({ date: ds, dayOfWeek: info.dayOfWeek });
  }
  return result;
}
