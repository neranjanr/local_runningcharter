'use client';

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { getLeaves, saveLeave, deleteLeave, validateLeaveDate } from '@/lib/leaveStore';
import { getTrips } from '@/lib/tripStore';
import { getDayTypeInfo, getHoliday, CALENDAR_RANGE, getYearsInRange, isWeekend, setDynamicHolidays } from '@/lib/sriLankanHolidays';
import { getHolidays, refreshHolidaysFromSource } from '@/lib/holidayStore';
import { validateTripsOnOffDays, getTripsOnOffDaysGrouped, getNoTripWorkingDays } from '@/lib/holidayValidation';
import type { LeaveDay, Trip } from '@/types';

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const WEEK_DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const LEAVE_PRESETS = ['Annual Leave', 'Casual Leave', 'Medical Leave', 'Duty Leave', 'Duty Leave (Overseas)', 'Private Overseas'] as const;

function daysInMonth(year:number, month:number): number {
  return new Date(year, month, 0).getDate();
}
function firstWeekdayMon(year:number, month:number): number {
  const d = new Date(year, month-1, 1).getDay(); // 0 Sun
  return d === 0 ? 6 : d-1; // 0 Mon ... 6 Sun
}

export default function CalendarPage() {
  const router = useRouter();
  const [leaves, setLeaves] = useState<LeaveDay[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedYears, setExpandedYears] = useState<Set<number>>(new Set([new Date().getFullYear()]));
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [editNote, setEditNote] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all'|'off'|'trips'>('all');
  const [showOffPopup, setShowOffPopup] = useState(false);
  const [showNoTripPopup, setShowNoTripPopup] = useState(false);
  const [leaveHistoryYear, setLeaveHistoryYear] = useState<string>('all');
  const [contextMenu, setContextMenu] = useState<{ date: string; x: number; y: number } | null>(null);
  const [confirmClearDate, setConfirmClearDate] = useState<string | null>(null);
  const [holidayRefreshing, setHolidayRefreshing] = useState(false);
  const [holidayMsg, setHolidayMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [lv, tr] = await Promise.all([getLeaves(), getTrips()]);
    setLeaves(lv);
    setTrips(tr);
  }, []);

  useEffect(() => {
    let mounted = true;
    Promise.all([getLeaves(), getTrips()]).then(([lv,tr]) => {
      if (!mounted) return;
      setLeaves(lv); setTrips(tr); setLoading(false);
      const cur = new Date().getFullYear();
      setExpandedYears(new Set([cur]));
      // default leave history year to current year if leaves exist, else all
      setLeaveHistoryYear(String(cur));
    });
    // Load dynamic holidays (live from DB, no rebuild) — merges into static map
    getHolidays().then((hs) => {
      if (!mounted) return;
      try { setDynamicHolidays(hs); } catch {}
    }).catch(() => {});
    return () => { mounted = false; };
  }, []);

  const leaveSet = useMemo(() => new Set(leaves.map(l=>l.date)), [leaves]);
  const leaveMap = useMemo(() => new Map(leaves.map(l=>[l.date,l])), [leaves]);
  const tripDateSet = useMemo(() => new Set(trips.map(t=>t.date)), [trips]);
  const tripCountByDate = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of trips) m.set(t.date, (m.get(t.date) ?? 0) + 1);
    return m;
  }, [trips]);
  const tripTypeCountsByDate = useMemo(() => {
    const m = new Map<string, { official: number; private: number }>();
    for (const t of trips) {
      const cur = m.get(t.date) ?? { official: 0, private: 0 };
      if ((t.trip_type as string) === 'Private') cur.private += 1;
      else cur.official += 1;
      m.set(t.date, cur);
    }
    return m;
  }, [trips]);
  const fuelPumpedByDate = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of trips) {
      const amt = Number((t as unknown as Record<string, unknown>).fuel_pumped_amount ?? 0);
      if (amt > 0) m.set(t.date, (m.get(t.date) ?? 0) + amt);
    }
    return m;
  }, [trips]);

  const summary = useMemo(() => validateTripsOnOffDays(trips, leaveSet), [trips, leaveSet]);
  const offGroups = useMemo(() => getTripsOnOffDaysGrouped(trips, leaveSet), [trips, leaveSet]);
  const noTripDays = useMemo(() => getNoTripWorkingDays(trips, leaveSet), [trips, leaveSet]);

  const filteredLeaves = useMemo(() => {
    if (leaveHistoryYear === 'all') return leaves.slice().sort((a,b)=>b.date.localeCompare(a.date));
    return leaves.filter(l=>l.date.startsWith(leaveHistoryYear)).sort((a,b)=>b.date.localeCompare(a.date));
  }, [leaves, leaveHistoryYear]);

  const handleRefreshHolidays = async () => {
    const targetYear = CALENDAR_RANGE.endYear;
    setHolidayRefreshing(true);
    setHolidayMsg(null);
    try {
      const res = await refreshHolidaysFromSource(targetYear);
      // Reload merged holidays and apply
      const hs = await getHolidays();
      setDynamicHolidays(hs);
      setHolidayMsg(`Holidays ${res.year}: ${res.upserted} upserted from ${res.source.split('/').pop()?.slice(0, 20) || 'source'} — ${res.fetched} fetched`);
      setTimeout(() => setHolidayMsg(null), 4000);
    } catch (e: unknown) {
      const m = e instanceof Error ? e.message : String(e);
      setHolidayMsg(`Holiday refresh failed: ${m}`);
      setTimeout(() => setHolidayMsg(null), 5000);
    }
    setHolidayRefreshing(false);
  };

  const toggleYear = (y:number) => {
    setExpandedYears(prev => {
      const n = new Set(prev);
      if (n.has(y)) n.delete(y); else n.add(y);
      return n;
    });
  };

  const handleCellClick = (date:string) => {
    const err = validateLeaveDate(date);
    if (err) { setMsg(err); setTimeout(()=>setMsg(null),2500); return; }
    const existing = leaveMap.get(date);
    setEditingDate(date);
    setEditNote(existing?.note ?? '');
  };

  const handleCellContextMenu = (e: React.MouseEvent, date: string) => {
    if (!tripDateSet.has(date)) return;
    e.preventDefault();
    setContextMenu({ date, x: e.clientX, y: e.clientY });
  };

  const handleShowTripsForDate = (date: string) => {
    const first = trips.filter(t => t.date === date).sort((a,b) => a.start_km - b.start_km)[0];
    const url = first ? `/trips?focus=${encodeURIComponent(first.id)}` : '/trips';
    if (typeof window !== 'undefined') {
      const win = window.open(url, '_blank', 'noopener');
      if (win) win.focus();
      else window.open(url, '_blank');
    }
    setContextMenu(null);
    // keep Calendar in place; do not clear editingDate so dialog stays if opened from warning bar
  };

  // close context menu on click/scroll/esc
  useEffect(() => {
    if (!contextMenu) return;
    const onClick = () => setContextMenu(null);
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') setContextMenu(null); };
    window.addEventListener('click', onClick);
    window.addEventListener('scroll', onClick, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', onClick);
      window.removeEventListener('scroll', onClick, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [contextMenu]);

  const handleMarkLeave = async () => {
    if (!editingDate) return;
    const err = validateLeaveDate(editingDate);
    if (err) { setMsg(err); setTimeout(()=>setMsg(null),2500); return; }
    const note = editNote.slice(0,200);
    await saveLeave(editingDate, note);
    await refresh();
    window.dispatchEvent(new CustomEvent('fleetledger:data-changed'));
    const h = getHoliday(editingDate);
    setMsg(`Leave marked ${editingDate}${h ? ` — ${h.name}`:''}`);
    setTimeout(()=>setMsg(null),2000);
    setEditingDate(null);
    setEditNote('');
  };
  const handleSaveNote = async () => {
    if (!editingDate) return;
    const note = editNote.slice(0,200);
    await saveLeave(editingDate, note);
    await refresh();
    window.dispatchEvent(new CustomEvent('fleetledger:data-changed'));
    setEditingDate(null);
    setEditNote('');
    setMsg(`Leave saved ${editingDate}`);
    setTimeout(()=>setMsg(null),2000);
  };
  const handleClearLeave = () => {
    if (!editingDate) return;
    setConfirmClearDate(editingDate);
  };
  const doConfirmClearLeave = async () => {
    const date = confirmClearDate;
    if (!date) return;
    await deleteLeave(date);
    await refresh();
    window.dispatchEvent(new CustomEvent('fleetledger:data-changed'));
    setMsg(`Leave cleared ${date}`);
    setTimeout(()=>setMsg(null),2000);
    setConfirmClearDate(null);
    setEditingDate(null);
    setEditNote('');
  };
  const handleHistoryClearClick = (date: string) => {
    setConfirmClearDate(date);
  };

  if (loading) return <div className="p-8 text-center text-on-surface-variant">Loading calendar...</div>;

  const isEditingLeave = editingDate ? leaveSet.has(editingDate) : false;

  return (
    <ProtectedRoute>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-on-surface">Holiday Calendar & Leaves</h1>
            <p className="text-sm text-on-surface-variant">{CALENDAR_RANGE.startYear}–{CALENDAR_RANGE.endYear} (auto-extends to next year on Dec 01) · Sat/Sun are Bank holidays · Click any date to mark/clear personal leave (manual-only, with note). Right-click a date with trips to Show Trip Details → All Trips.</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={()=>setShowOffPopup(true)} className="px-3 py-2 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm font-semibold hover:bg-rose-100">Trips on Off-Days ({offGroups.reduce((s,g)=>s+g.trips.length,0)})</button>
            <button onClick={()=>setShowNoTripPopup(true)} className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-50 text-sm font-semibold hover:bg-slate-800">No-Trip Working Days ({noTripDays.length})</button>
            <button onClick={handleRefreshHolidays} disabled={holidayRefreshing} data-testid="refresh-holidays-btn" className="px-3 py-2 rounded-lg bg-white border border-rule-line text-slate-700 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50" title={`Query holidays for ${CALENDAR_RANGE.endYear} from source (Nager.Date) — no rebuild`}>
              {holidayRefreshing ? 'Querying…' : `⟳ Query Holidays (${CALENDAR_RANGE.endYear})`}
            </button>
            <select value={filter} onChange={e=>setFilter(e.target.value as any)} className="px-3 py-2 border border-rule-line rounded-lg bg-paper-sheet text-sm">
              <option value="all">All days</option>
              <option value="off">Off-days only</option>
              <option value="trips">Days with trips</option>
            </select>
          </div>
        </div>

        {msg && <div className="px-4 py-2 bg-telemetry-cyan text-on-primary rounded-lg text-sm">{msg}</div>}
        {holidayMsg && <div className={`px-4 py-2 rounded-lg text-sm ${holidayMsg.includes('failed') ? 'bg-amber-50 text-amber-800 border border-amber-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}>{holidayMsg}</div>}

        {/* Legend */}
        <div className="bg-paper-sheet rounded-xl border border-rule-line p-4 flex flex-wrap gap-3 text-xs">
          <span className="flex items-center gap-1"><span className="w-4 h-4 rounded bg-slate-200 border border-slate-300"/> Sat/Sun (Bank)</span>
          <span className="flex items-center gap-1"><span className="w-4 h-4 rounded bg-rose-100 border border-rose-300"/> Poya / Bank Holiday</span>
          <span className="flex items-center gap-1"><span className="w-4 h-4 rounded bg-amber-100 border border-amber-400"/> Mercantile</span>
          <span className="flex items-center gap-1"><span className="w-4 h-4 rounded bg-teal-600"/> Public Holiday</span>
          <span className="flex items-center gap-1"><span className="w-4 h-4 rounded bg-sky-500"/> Personal Leave</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-telemetry-cyan border"/> Official trip</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-orange-400 border border-white shadow-sm"/> Private trip</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-telemetry-cyan border"/><span className="w-3 h-3 rounded-full bg-orange-400 border border-white shadow-sm -ml-1"/> Mixed</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-red-500 border border-white shadow-sm"/> Fuel pumped</span>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <div className="bg-paper-sheet rounded-xl border border-rule-line p-3">
            <div className="text-[11px] uppercase tracking-wider text-on-surface-variant">Total trips</div>
            <div className="text-xl font-bold">{summary.totalTrips}</div>
            <div className="text-xs text-on-surface-variant">{summary.offDayKm+summary.workingDayKm} km</div>
          </div>
          <div className="bg-rose-50 rounded-xl border border-rose-200 p-3">
            <div className="text-[11px] uppercase tracking-wider text-rose-700">Off-day trips</div>
            <div className="text-xl font-bold text-rose-700">{summary.offDayTrips}</div>
            <div className="text-xs text-rose-600">{summary.offDayKm} km</div>
          </div>
          <div className="bg-slate-900 rounded-xl border border-slate-700 p-3 text-slate-100">
            <div className="text-[11px] uppercase tracking-wider text-slate-300">Working-day trips</div>
            <div className="text-xl font-bold">{summary.workingDayTrips}</div>
            <div className="text-xs text-slate-300">{summary.workingDayKm} km</div>
          </div>
          <div className="bg-paper-sheet rounded-xl border border-rule-line p-3">
            <div className="text-[11px] uppercase tracking-wider text-on-surface-variant">On Leave</div>
            <div className="text-xl font-bold text-sky-600">{summary.onLeave}</div>
          </div>
          <div className="bg-paper-sheet rounded-xl border border-rule-line p-3">
            <div className="text-[11px] uppercase tracking-wider text-on-surface-variant">Poya</div>
            <div className="text-xl font-bold text-purple-700">{summary.onPoya}</div>
          </div>
          <div className="bg-paper-sheet rounded-xl border border-rule-line p-3">
            <div className="text-[11px] uppercase tracking-wider text-on-surface-variant">Weekend (pure)</div>
            <div className="text-xl font-bold">{summary.onWeekend}</div>
            <div className="text-xs text-on-surface-variant">+ banker weekends incl. holidays bucketed as holiday</div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="px-2 py-1 bg-amber-100 rounded-full">Mercantile: {summary.onMercantile}</span>
          <span className="px-2 py-1 bg-teal-50 border border-teal-200 rounded-full">Public: {summary.onPublicHoliday}</span>
          <span className="px-2 py-1 bg-rose-50 border border-rose-200 rounded-full">Bank/Poya: {summary.onBankHoliday}</span>
        </div>

        {/* Year sections */}
        <div className="flex flex-col gap-4">
          {getYearsInRange().map(year => {
            const isExpanded = expandedYears.has(year);
            const yearOffCount = trips.filter(t=>t.date.startsWith(String(year)) && getDayTypeInfo(t.date, leaveSet).isOffDay).length;
            const yearLeaves = leaves.filter(l=>l.date.startsWith(String(year))).length;
            return (
              <div key={year} className="bg-paper-sheet rounded-xl border border-rule-line overflow-hidden">
                <button onClick={()=>toggleYear(year)} className="w-full flex items-center justify-between px-4 py-3 bg-slate-surface text-on-primary hover:bg-primary transition-colors">
                  <span className="font-bold text-sm tracking-tight">{year} — Holiday Calendar</span>
                  <span className="flex items-center gap-3 text-xs">
                    <span className="hidden sm:inline">Leaves: {yearLeaves} · Off-day trips: {yearOffCount}</span>
                    <span className="w-7 h-7 flex items-center justify-center rounded-full bg-on-primary text-primary font-bold">{isExpanded ? '−' : '+'}</span>
                  </span>
                </button>
                {isExpanded && (
                  <div className="p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
                    {Array.from({length:12}, (_,i)=>i+1).map(m => {
                      const monthKey = `${year}-${String(m).padStart(2,'0')}`;
                      const dim = daysInMonth(year,m);
                      const offset = firstWeekdayMon(year,m);
                      const cells: (string|null)[] = Array(offset).fill(null);
                      for (let d=1; d<=dim; d++) cells.push(`${monthKey}-${String(d).padStart(2,'0')}`);
                      return (
                        <div key={monthKey} className="border border-rule-line rounded-lg overflow-hidden bg-paper-gutter">
                          <div className="px-3 py-2 bg-slate-900 text-slate-50 flex items-center justify-between">
                            <span className="font-semibold text-sm">{MONTH_NAMES[m-1]} {year}</span>
                            <span className="text-[11px] opacity-75">{Array.from(tripDateSet).filter(d=>d.startsWith(monthKey)).length ? `${Array.from(tripDateSet).filter(d=>d.startsWith(monthKey)).length} trip-days` : ''}</span>
                          </div>
                          <div className="grid grid-cols-7 gap-px bg-rule-line">
                            {WEEK_DAYS.map(w=> <div key={w} className="bg-paper-sheet text-center text-[11px] font-semibold py-1 text-on-surface-variant">{w.slice(0,2)}</div>)}
                            {cells.map((date, idx) => {
                              if (!date) return <div key={`empty-${idx}`} className="bg-paper-gutter h-14"/>;
                              const info = getDayTypeInfo(date, leaveSet);
                              const isLeave = leaveSet.has(date);
                              const hasTrip = tripDateSet.has(date);
                              const count = tripCountByDate.get(date) ?? 0;
                              const typeCounts = tripTypeCountsByDate.get(date) ?? { official: 0, private: 0 };
                              const hasOfficial = typeCounts.official > 0;
                              const hasPrivate = typeCounts.private > 0;
                              const fuelAmt = fuelPumpedByDate.get(date) ?? 0;
                              const hasFuel = fuelAmt > 0;
                              const holiday = getHoliday(date);
                              let bg = 'bg-paper-sheet';
                              let border = 'border-transparent';
                              if (isLeave) { bg='bg-sky-500 text-white'; border='border-sky-600'; }
                              else if (holiday?.kinds.includes('M')) { bg='bg-amber-100'; border='border-amber-400'; }
                              else if (holiday?.kinds.includes('P') || holiday?.kinds.includes('B')) { bg='bg-rose-50'; border='border-rose-300'; }
                              else if (isWeekend(date)) { bg='bg-slate-100'; border='border-slate-200'; }
                              const show = filter==='all'
                                || (filter==='off' && info.isOffDay)
                                || (filter==='trips' && hasTrip);
                              const hidden = !show;
                              const typeHover = hasTrip ? (hasOfficial && hasPrivate ? ` — ${typeCounts.official} Official + ${typeCounts.private} Private` : hasPrivate ? ' — Private' : ' — Official') : '';
                              const fuelHover = hasFuel ? ` — Pumped ${fuelAmt.toFixed(1)} L` : '';
                              return (
                                <button
                                  key={date}
                                  onClick={()=>handleCellClick(date)}
                                  onContextMenu={(e)=>handleCellContextMenu(e, date)}
                                  title={`${date} ${info.dayOfWeek}${holiday? ` — ${holiday.name} (${holiday.kinds.join('/')})`:''}${isLeave? ` — Leave: ${leaveMap.get(date)?.note ?? ''}`:''}${hasTrip? ` — ${count} trip(s)${typeHover}`:''}${fuelHover}${hasFuel ? ' ⛽' : ''}${hasTrip ? ' — Right-click: Show Trip Details' : ''}`}
                                  className={`relative h-14 p-1 text-left border ${border} ${bg} hover:brightness-95 transition ${hidden ? 'opacity-20' : ''} ${editingDate===date ? 'ring-2 ring-telemetry-cyan' : ''}`}
                                >
                                  <div className="text-xs font-semibold">{date.slice(8,10)}</div>
                                  {holiday && !isLeave && <div className="text-[8px] leading-tight line-clamp-2 font-medium text-rose-700">{holiday.name}</div>}
                                  {isLeave && <div className="text-[8px] leading-tight line-clamp-2 font-medium">{leaveMap.get(date)?.note ? leaveMap.get(date)!.note!.slice(0,18) : 'Leave'}</div>}
                                  {hasFuel && <span className="absolute top-1 right-1 w-2.5 h-2.5 rounded-full bg-red-500 border border-white shadow-sm" title={`Pumped ${fuelAmt.toFixed(1)} L`} />}
                                  {hasTrip && (
                                    <span className="absolute bottom-1 right-1 flex items-center">
                                      {hasOfficial && hasPrivate ? (
                                        <>
                                          <span className="w-2 h-2 rounded-full bg-telemetry-cyan border border-white" title={`${typeCounts.official} Official`} />
                                          <span className="w-2 h-2 rounded-full bg-orange-400 border border-white -ml-0.5 shadow-sm" title={`${typeCounts.private} Private`} />
                                        </>
                                      ) : hasPrivate ? (
                                        <span className="w-2 h-2 rounded-full bg-orange-400 border border-white shadow-sm" title={`${typeCounts.private} Private`} />
                                      ) : (
                                        <span className="w-2 h-2 rounded-full bg-telemetry-cyan border border-white" title={`${typeCounts.official} Official`} />
                                      )}
                                    </span>
                                  )}
                                  {count>1 && hasTrip && <span className="absolute bottom-1 left-1 text-[9px] font-bold bg-slate-900 text-white rounded px-1">×{count}</span>}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Leave History filtered by year */}
        <div className="bg-paper-sheet rounded-xl border border-rule-line p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-sm">Leave History</h3>
            <div className="flex items-center gap-2">
              <span className="text-xs text-on-surface-variant">Year:</span>
              <select value={leaveHistoryYear} onChange={e=>setLeaveHistoryYear(e.target.value)} className="px-3 py-1.5 border border-rule-line rounded-lg bg-paper-sheet text-sm">
                <option value="all">All</option>
                {getYearsInRange().map(y=> <option key={y} value={String(y)}>{y}</option>)}
              </select>
              <span className="text-xs text-on-surface-variant">{filteredLeaves.length} {filteredLeaves.length===1 ? 'leave' : 'leaves'}</span>
            </div>
          </div>
          {filteredLeaves.length===0 ? (
            <div className="text-sm text-on-surface-variant py-6 text-center border border-dashed border-rule-line rounded-lg">No leaves in {leaveHistoryYear==='all' ? 'any year' : leaveHistoryYear}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-on-surface-variant border-b">
                  <th className="py-2">Date</th><th className="py-2">Day</th><th className="py-2">Holiday</th><th className="py-2">Note</th><th className="py-2"></th>
                </tr></thead>
                <tbody>
                  {filteredLeaves.map(l=> {
                    const info = getDayTypeInfo(l.date, new Set());
                    const h = getHoliday(l.date);
                    return (
                      <tr key={l.date} className="border-b border-rule-line/50 hover:bg-paper-gutter">
                        <td className="py-2 font-medium">{l.date}</td>
                        <td className="py-2">{info.dayOfWeek}</td>
                        <td className="py-2 text-xs">{h ? `${h.name} (${h.kinds.join('/')})`: '—'}</td>
                        <td className="py-2 text-xs max-w-[240px] truncate" title={l.note ?? ''}>{l.note ? l.note : <span className="text-on-surface-variant">—</span>}</td>
                        <td className="py-2 text-right flex gap-1 justify-end">
                          <button onClick={()=>{ setEditingDate(l.date); setEditNote(l.note ?? ''); }} className="px-2 py-1 text-xs rounded border border-rule-line hover:bg-paper-gutter">Edit</button>
                          <button onClick={()=>handleHistoryClearClick(l.date)} className="px-2 py-1 text-xs rounded border border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100">Clear</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Edit leave dialog: redesigned like leavesample.html — grouped presets, gradient bar, rounded-2xl */}
        {editingDate && (
          <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 p-4" onClick={()=>setEditingDate(null)}>
            <div
              aria-labelledby="modal-headline"
              aria-modal="true"
              role="dialog"
              className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200/80 overflow-hidden transform transition-all duration-200 ease-out"
              onClick={e=>e.stopPropagation()}
            >
              <div className="h-1.5 w-full bg-gradient-to-r from-blue-600 via-indigo-600 to-sky-500" />
              <div className="p-6 sm:p-7">
                <header className="flex items-start justify-between pb-4 border-b border-slate-100">
                  <div className="space-y-1">
                    <h2 id="modal-headline" className="text-xl font-bold text-slate-900 tracking-tight">
                      Leave — {editingDate} <span className="font-normal text-sm text-slate-500">({getDayTypeInfo(editingDate, new Set()).dayOfWeek})</span>
                    </h2>
                    {getHoliday(editingDate) && <p className="text-xs text-rose-700 font-medium">{getHoliday(editingDate)!.name} ({getHoliday(editingDate)!.kinds.join('/')})</p>}
                    <p className="text-xs sm:text-sm text-slate-500 font-normal leading-relaxed">
                      {isEditingLeave ? 'Edit note or clear this leave. ' : 'Add a note (max 200) and mark as leave. '}
                      Tap a preset to fill the box, or type freely.
                    </p>
                  </div>
                  <button aria-label="Close modal" onClick={()=>setEditingDate(null)} className="text-slate-400 hover:text-slate-600 hover:bg-slate-100 p-1.5 rounded-lg transition-colors -mr-1 -mt-1" type="button">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </header>

                {tripDateSet.has(editingDate) && (
                  <div className="mt-4 flex items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5">
                    <p className="text-xs font-semibold text-amber-800">⚠ {tripCountByDate.get(editingDate)} trip(s) on this date</p>
                    <button
                      type="button"
                      data-testid="leave-show-trips-btn"
                      onClick={() => handleShowTripsForDate(editingDate!)}
                      className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 border border-slate-700 transition-colors"
                      title="Open All Trips and focus this date in new tab"
                    >
                      Show Trips →
                    </button>
                  </div>
                )}

                <main className="py-5 space-y-5">
                  <section className="space-y-3.5" data-testid="leave-preset-buttons">
                    <div className="flex items-center justify-between">
                      <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">Presets</label>
                      <span className="text-xs text-slate-400 font-medium">Click to fill</span>
                    </div>
                    {/* Group 1: Standard Leave */}
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Standard Leave</span>
                        <div className="h-px flex-1 bg-slate-100" />
                      </div>
                      <div aria-label="Standard leave options" className="flex flex-wrap gap-2 text-xs font-medium" role="radiogroup">
                        {(['Annual Leave','Casual Leave','Medical Leave'] as const).map(preset => {
                          const active = editNote === preset;
                          return (
                            <button
                              key={preset}
                              type="button"
                              role="radio"
                              aria-checked={active}
                              data-testid={`leave-preset-${preset.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}`}
                              onClick={() => setEditNote(preset)}
                              className={`preset-chip group inline-flex items-center gap-1.5 px-3 py-2 rounded-xl transition-all border font-medium ${active ? 'bg-blue-600 text-white border-blue-600 shadow-sm shadow-blue-500/20' : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200/90'}`}
                              title={`Fill note with "${preset}"`}
                            >
                              <svg className={`w-3.5 h-3.5 check-icon ${active ? 'text-white' : 'hidden'}`} fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                                <path d="M4.5 12.75l6 6 9-13.5" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                              <span>{preset}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    {/* Group 2: Duty & Overseas */}
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Duty & Overseas</span>
                        <div className="h-px flex-1 bg-slate-100" />
                      </div>
                      <div aria-label="Duty and overseas leave options" className="flex flex-wrap gap-2 text-xs font-medium" role="radiogroup">
                        {(['Duty Leave','Duty Leave (Overseas)','Private Overseas'] as const).map(preset => {
                          const active = editNote === preset;
                          return (
                            <button
                              key={preset}
                              type="button"
                              role="radio"
                              aria-checked={active}
                              data-testid={`leave-preset-${preset.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}`}
                              onClick={() => setEditNote(preset)}
                              className={`preset-chip group inline-flex items-center gap-1.5 px-3 py-2 rounded-xl transition-all border font-medium ${active ? 'bg-blue-600 text-white border-blue-600 shadow-sm shadow-blue-500/20' : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200/90'}`}
                              title={`Fill note with "${preset}"`}
                            >
                              <svg className={`w-3.5 h-3.5 check-icon ${active ? 'text-white' : 'hidden'}`} fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                                <path d="M4.5 12.75l6 6 9-13.5" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                              <span>{preset}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </section>

                  <section className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label htmlFor="leave-note-input" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">Note / Reason</label>
                      <span className={`text-xs font-medium tabular-nums ${editNote.length >= 190 ? 'text-amber-500 font-semibold' : 'text-slate-400'}`}>{editNote.length} / 200</span>
                    </div>
                    <div className="relative">
                      <textarea
                        id="leave-note-input"
                        data-testid="leave-note-input"
                        value={editNote}
                        onChange={e=>setEditNote(e.target.value)}
                        maxLength={200}
                        placeholder="Enter note or select preset..."
                        className="w-full px-3.5 py-2.5 bg-slate-50/60 hover:bg-slate-50 focus:bg-white text-sm text-slate-800 rounded-xl border border-slate-200 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 outline-none transition-all placeholder:text-slate-400 resize-none h-24"
                      />
                    </div>
                  </section>
                </main>

                <footer className="pt-4 border-t border-slate-100 flex items-center justify-between gap-3">
                  <div>
                    {isEditingLeave && (
                      <button onClick={handleClearLeave} className="px-4 py-2 text-sm font-medium text-rose-700 bg-rose-50 hover:bg-rose-100 active:bg-rose-100 border border-rose-200 rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-rose-300" type="button">
                        Clear Leave
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <button onClick={()=>setEditingDate(null)} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 bg-white hover:bg-slate-50 active:bg-slate-100 border border-slate-200 rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-slate-300" type="button">
                      Cancel
                    </button>
                    {isEditingLeave ? (
                      <button onClick={handleSaveNote} className="inline-flex items-center justify-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 rounded-xl shadow-md shadow-blue-500/25 transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 hover:shadow-lg" type="button">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        <span>Save</span>
                      </button>
                    ) : (
                      <button onClick={handleMarkLeave} className="inline-flex items-center justify-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 rounded-xl shadow-md shadow-blue-500/25 transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 hover:shadow-lg" type="button">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        <span>Mark as Leave</span>
                      </button>
                    )}
                  </div>
                </footer>
              </div>
            </div>
          </div>
        )}

        {/* Trips on Off-Days popup */}
        {showOffPopup && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={()=>setShowOffPopup(false)}>
            <div className="bg-paper-sheet rounded-xl border border-rule-line w-full max-w-4xl max-h-[85vh] flex flex-col shadow-xl" onClick={e=>e.stopPropagation()}>
              <div className="px-5 py-4 border-b border-rule-line flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-sm">Trips on Off-Days</h3>
                  <p className="text-xs text-on-surface-variant">{offGroups.length} dates · {offGroups.reduce((s,g)=>s+g.trips.length,0)} trips · categorized by date</p>
                </div>
                <button onClick={()=>setShowOffPopup(false)} className="px-3 py-1.5 rounded-lg border border-rule-line text-sm">Close</button>
              </div>
              <div className="overflow-auto p-4 flex-1">
                {offGroups.length===0 ? (
                  <div className="text-sm text-on-surface-variant text-center py-8">No trips on off-days</div>
                ) : offGroups.map(g=> (
                  <div key={g.date} className="mb-4 border border-rule-line rounded-lg overflow-hidden">
                    <div className="px-3 py-2 bg-slate-900 text-slate-50 flex items-center justify-between text-xs">
                      <span className="font-semibold">{g.date} · {g.dayOfWeek} · {g.reason}</span>
                      <span>{g.trips.length} trip(s) · {g.totalKm} km</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead><tr className="text-left text-on-surface-variant border-b bg-paper-gutter">
                          <th className="px-2 py-1">Start KM</th><th className="px-2 py-1">End KM</th><th className="px-2 py-1">Dist</th><th className="px-2 py-1">Type</th><th className="px-2 py-1">Places</th><th className="px-2 py-1">Fuel</th>
                        </tr></thead>
                        <tbody>
                          {g.trips.map(t=> (
                            <tr key={t.id} className="border-b border-rule-line/50">
                              <td className="px-2 py-1">{t.start_km}</td><td className="px-2 py-1">{t.end_km}</td><td className="px-2 py-1">{t.trip_distance}</td><td className="px-2 py-1">{t.trip_type}</td><td className="px-2 py-1 max-w-[240px] truncate" title={t.places_visited}>{t.places_visited}</td><td className="px-2 py-1">{t.fuel_pumped_amount ? `${t.fuel_pumped_amount} L ${t.fuel_order_no ?? ''}` : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* No-Trip Working Days popup */}
        {showNoTripPopup && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={()=>setShowNoTripPopup(false)}>
            <div className="bg-paper-sheet rounded-xl border border-rule-line w-full max-w-2xl max-h-[85vh] flex flex-col shadow-xl" onClick={e=>e.stopPropagation()}>
              <div className="px-5 py-4 border-b border-rule-line flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-sm">No-Trip Working Days</h3>
                  <p className="text-xs text-on-surface-variant">Working days with no trip, ODO-continuous only (gap periods hidden) · {noTripDays.length} dates</p>
                </div>
                <button onClick={()=>setShowNoTripPopup(false)} className="px-3 py-1.5 rounded-lg border border-rule-line text-sm">Close</button>
              </div>
              <div className="overflow-auto p-4 flex-1">
                {noTripDays.length===0 ? (
                  <div className="text-sm text-on-surface-variant text-center py-8">No idle working days in continuous ODO periods</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-xs text-on-surface-variant border-b">
                      <th className="py-2">Date</th><th className="py-2">Day</th>
                    </tr></thead>
                    <tbody>
                      {noTripDays.map(d=> (
                        <tr key={d.date} className="border-b border-rule-line/50">
                          <td className="py-2 font-medium">{d.date}</td><td className="py-2">{d.dayOfWeek}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <p className="text-[11px] text-on-surface-variant mt-3">Dates strictly inside Trip-to-Trip ODO gaps are omitted (ledger missing). Range is first to last trip, clamped to 2024–2027.</p>
              </div>
            </div>
          </div>
        )}

        {/* Monthly off-day breakdown */}
        {summary.totalTrips>0 && (
          <div className="bg-paper-sheet rounded-xl border border-rule-line p-4">
            <h3 className="font-bold text-sm mb-3">Monthly Off-day Breakdown</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-on-surface-variant border-b">
                  <th className="py-2">Month</th><th className="py-2 text-right">Off-day trips</th><th className="py-2 text-right">Working trips</th><th className="py-2 text-right">Off km</th><th className="py-2 text-right">Working km</th>
                </tr></thead>
                <tbody>
                  {Object.entries(summary.byMonth).sort().map(([k,v])=> (
                    <tr key={k} className="border-b border-rule-line/50">
                      <td className="py-2 font-medium">{k}</td>
                      <td className="py-2 text-right">{v.off}</td>
                      <td className="py-2 text-right">{v.working}</td>
                      <td className="py-2 text-right">{v.offKm}</td>
                      <td className="py-2 text-right">{v.workingKm}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Clear Leave confirmation — styled modal (grilled Q2) */}
        {confirmClearDate && (
          <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-[60] p-4" onClick={()=>setConfirmClearDate(null)}>
            <div className="bg-white rounded-2xl shadow-2xl border border-slate-200/80 w-full max-w-sm overflow-hidden" onClick={e=>e.stopPropagation()}>
              <div className="h-1.5 w-full bg-gradient-to-r from-rose-500 via-red-500 to-orange-400" />
              <div className="p-6">
                <h3 className="text-base font-bold text-slate-900">Clear leave?</h3>
                <p className="text-sm text-slate-500 mt-1">Remove leave for <span className="font-semibold text-slate-800">{confirmClearDate}</span> ({getDayTypeInfo(confirmClearDate, new Set()).dayOfWeek})? This cannot be undone.</p>
                {leaveMap.get(confirmClearDate)?.note && <p className="text-xs text-slate-600 mt-2 px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg truncate">Note: {leaveMap.get(confirmClearDate)!.note}</p>}
                <div className="flex justify-end gap-2 mt-5">
                  <button onClick={()=>setConfirmClearDate(null)} className="px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-50">Cancel</button>
                  <button onClick={doConfirmClearLeave} className="px-5 py-2 text-sm font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-xl shadow-sm">Clear Leave</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Right-click context menu: Show Trip Details */}
        {contextMenu && (
          <div
            data-testid="calendar-context-menu"
            className="fixed z-50 bg-paper-sheet border border-rule-line rounded-lg shadow-xl py-1 min-w-[200px] text-sm"
            style={{
              top: Math.min(contextMenu.y, typeof window !== 'undefined' ? window.innerHeight - 120 : contextMenu.y),
              left: Math.min(contextMenu.x, typeof window !== 'undefined' ? window.innerWidth - 220 : contextMenu.x),
            }}
            onClick={e => e.stopPropagation()}
          >
            <div className="px-3 py-1.5 text-xs font-semibold text-on-surface-variant border-b border-rule-line/50">
              {contextMenu.date} · {getDayTypeInfo(contextMenu.date, new Set()).dayOfWeek} · {tripCountByDate.get(contextMenu.date) ?? 0} trip(s)
            </div>
            <button
              data-testid="calendar-show-trip-details-btn"
              onClick={() => handleShowTripsForDate(contextMenu.date)}
              className="w-full text-left px-3 py-2 hover:bg-paper-gutter flex items-center gap-2 text-slate-900 font-medium"
            >
              <span>📋</span> Show Trip Details →
            </button>
            <button
              onClick={() => setContextMenu(null)}
              className="w-full text-left px-3 py-1.5 text-xs text-on-surface-variant hover:bg-paper-gutter"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </ProtectedRoute>
  );
}
