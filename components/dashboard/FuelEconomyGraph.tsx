'use client';

import React, { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import type { Trip, BookPage } from '@/types';
import { computeLedgerDays, computeTripFuelMap } from '@/lib/ledgerCalculations';
import { getFuelEconomiesForPage } from '@/lib/fuelEconomyStore';
import { getInTanksForPage } from '@/lib/inTankStore';
import { detectTripGaps } from '@/lib/continuityAlerts';

interface Props {
  trips: Trip[];
  pages: BookPage[];
}

function formatDayLabel(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { day: '2-digit', month: 'short' });
}

const YEAR_PALETTE: Array<{ group: string; track: string; text: string; border: string }> = [
  { group: 'bg-slate-100/60', track: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-200' },
  { group: 'bg-amber-50/50', track: 'bg-amber-50/80', text: 'text-amber-900/90', border: 'border-amber-200' },
  { group: 'bg-emerald-50/40', track: 'bg-emerald-50/70', text: 'text-emerald-900/80', border: 'border-emerald-200' },
  { group: 'bg-sky-50/50', track: 'bg-sky-50/80', text: 'text-sky-900/80', border: 'border-sky-200' },
  { group: 'bg-violet-50/50', track: 'bg-violet-50/80', text: 'text-violet-900/80', border: 'border-violet-200' },
];

export function FuelEconomyGraph({ trips, pages }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ active: boolean; startX: number; startScroll: number }>({ active: false, startX: 0, startScroll: 0 });
  const [activeYear, setActiveYear] = useState<string | null>(null);

  const { days, gapsByDate, maxEconomy, sortedYears, distinctDateCount } = useMemo(() => {
    const sortedPages = [...pages].sort((a, b) => a.page_number - b.page_number);
    const dateEconomy = new Map<string, number>();
    const dateInTank = new Map<string, number>();
    let openingFuel = sortedPages.length > 0 ? sortedPages[0].start_fuel_balance : 10;
    for (const page of sortedPages) {
      try {
        const economies = getFuelEconomiesForPage(page.id);
        const inTanks = getInTanksForPage(page.id);
        const ledgerDays = computeLedgerDays({ page, trips, economies, inTanks });
        for (const d of ledgerDays) {
          if (!dateEconomy.has(d.date)) dateEconomy.set(d.date, d.fuelEconomy);
          if (!dateInTank.has(d.date)) dateInTank.set(d.date, d.inTank);
        }
      } catch {}
    }
    let tripMap: Map<string, { economy: number }>;
    try {
      const tm = computeTripFuelMap({ trips, pages, dateEconomy, dateInTank, openingFuel });
      tripMap = new Map(Array.from(tm.entries()).map(([id, v]) => [id, { economy: v.economy }]));
    } catch {
      tripMap = new Map();
    }
    const sortedTrips = [...trips].sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      if (a.trip_index !== b.trip_index) return a.trip_index - b.trip_index;
      return a.start_km - b.start_km;
    });
    const dateToEconomies = new Map<string, number[]>();
    const seenPerDate = new Map<string, Set<number>>();
    for (const t of sortedTrips) {
      const econ = tripMap.get(t.id)?.economy ?? dateEconomy.get(t.date) ?? 10.5;
      const set = seenPerDate.get(t.date) ?? new Set<number>();
      if (!set.has(econ)) {
        set.add(econ);
        seenPerDate.set(t.date, set);
        const arr = dateToEconomies.get(t.date) ?? [];
        arr.push(econ);
        dateToEconomies.set(t.date, arr);
      }
    }
    const allDays: Array<{ fuelEconomy: number; date: string; key: string }> = [];
    if (dateToEconomies.size > 0) {
      const sortedDates = Array.from(dateToEconomies.keys()).sort();
      for (const d of sortedDates) {
        const ecos = dateToEconomies.get(d)!;
        for (let idx = 0; idx < ecos.length; idx++) {
          const econ = ecos[idx];
          allDays.push({ fuelEconomy: econ, date: d, key: `${d}#${idx}:${econ}` });
        }
      }
    } else {
      const dayMap = new Map<string, { fuelEconomy: number; date: string }>();
      for (const [d, econ] of dateEconomy.entries()) dayMap.set(d, { fuelEconomy: econ, date: d });
      const tmp = Array.from(dayMap.values()).sort((a, b) => a.date.localeCompare(b.date));
      for (const v of tmp) allDays.push({ ...v, key: v.date });
    }
    const max = allDays.length ? Math.max(...allDays.map(d => d.fuelEconomy), 10) : 10;
    const tripGaps = detectTripGaps(trips).filter(g => g.kind === 'km');
    const gapsByDate = new Map<string, { expected: number; actual: number; delta: number }>();
    for (const g of tripGaps) {
      const delta = g.actual - g.expected;
      const succ = trips.find(t => t.id === g.tripId);
      if (succ) {
        const existing = gapsByDate.get(succ.date);
        if (!existing || Math.abs(delta) > Math.abs(existing.delta)) {
          gapsByDate.set(succ.date, { expected: g.expected, actual: g.actual, delta });
        }
      }
    }
    const yearSet = new Set<string>();
    for (const d of allDays) yearSet.add(d.date.slice(0, 4));
    const sortedYears = Array.from(yearSet).sort();
    const distinctDateCount = new Set(allDays.map(d => d.date)).size;
    return { days: allDays, gapsByDate, maxEconomy: Math.ceil(max), sortedYears, distinctDateCount };
  }, [trips, pages]);

  // map year -> palette index
  const yearColor = useMemo(() => {
    const m = new Map<string, typeof YEAR_PALETTE[number]>();
    sortedYears.forEach((y, i) => m.set(y, YEAR_PALETTE[i % YEAR_PALETTE.length]));
    return m;
  }, [sortedYears]);

  // ordered items interleaving gaps before successor date's first stem
  const orderedItems = useMemo(() => {
    const items: Array<{ kind: 'gap'; date: string; gap: { expected: number; actual: number; delta: number } } | { kind: 'stem'; day: typeof days[number] }> = [];
    const seenGapDate = new Set<string>();
    for (const d of days) {
      const gap = gapsByDate.get(d.date);
      if (gap && !seenGapDate.has(d.date)) {
        seenGapDate.add(d.date);
        items.push({ kind: 'gap', date: d.date, gap });
      }
      items.push({ kind: 'stem', day: d });
    }
    return items;
  }, [days, gapsByDate]);

  // Build upper row groups: consecutive stems of same year chunked; gaps split chunks
  const upperGroups = useMemo(() => {
    const groups: Array<{ kind: 'year'; year: string; stems: typeof days } | { kind: 'gap'; date: string; gap: { delta: number; expected: number; actual: number } }> = [];
    let cur: { year: string; stems: typeof days } | null = null;
    const flush = () => {
      if (cur && cur.stems.length) {
        groups.push({ kind: 'year', year: cur.year, stems: cur.stems });
        cur = null;
      }
    };
    for (const it of orderedItems) {
      if (it.kind === 'gap') {
        flush();
        groups.push({ kind: 'gap', date: it.date, gap: it.gap });
      } else {
        const y = it.day.date.slice(0, 4);
        if (!cur || cur.year !== y) {
          flush();
          cur = { year: y, stems: [] };
        }
        cur.stems.push(it.day);
      }
    }
    flush();
    return groups;
  }, [orderedItems]);

  // Footer segments mirror upperGroups but year segments become Year Track cells; gaps become blank
  const footerSegments = upperGroups;

  const minWidthPx = useMemo(() => {
    // grouped calc: year groups (32 w-8 +6 gap-1.5 per stem +8 px-1) + gaps (96 w-24 +8 mx-1) + inter-group gaps
    const groups = upperGroups;
    if (groups.length === 0) return 320;
    let w = 0;
    for (const g of groups) {
      if (g.kind === 'gap') w += 96 + 8;
      else w += g.stems.length * 32 + Math.max(0, g.stems.length - 1) * 6 + 8;
    }
    w += Math.max(0, groups.length - 1) * 6; // flex gap-1.5 between groups
    return Math.max(w + 48, 320);
  }, [upperGroups]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
    if (sortedYears.length && !activeYear) setActiveYear(sortedYears[sortedYears.length - 1]);
  }, [days, sortedYears, activeYear]);

  // middle-mouse drag only
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 1) return;
      e.preventDefault();
      dragRef.current = { active: true, startX: e.clientX, startScroll: el.scrollLeft };
      el.style.cursor = 'grabbing';
      el.style.userSelect = 'none';
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!dragRef.current.active) return;
      const dx = e.clientX - dragRef.current.startX;
      el.scrollLeft = dragRef.current.startScroll - dx;
    };
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 1 || dragRef.current.active) {
        dragRef.current.active = false;
        el.style.cursor = '';
        el.style.userSelect = '';
      }
    };
    const onAuxClick = (e: MouseEvent) => {
      if (e.button === 1) e.preventDefault();
    };
    el.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    el.addEventListener('auxclick', onAuxClick);
    return () => {
      el.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      el.removeEventListener('auxclick', onAuxClick);
    };
  }, []);

  const scrollToYear = useCallback((year: string) => {
    const el = scrollRef.current;
    if (!el) return;
    const target = document.getElementById(`segment-${year}`);
    if (target) {
      const leftPos = target.offsetLeft - 24;
      el.scrollTo({ left: Math.max(0, leftPos), behavior: 'smooth' });
      setActiveYear(year);
    }
  }, []);

  if (days.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 flex flex-col gap-2 h-full">
        <h3 className="text-sm font-bold tracking-tight text-slate-900 flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
          Fuel Economy Trend
        </h3>
        <p className="text-xs text-slate-500">No fuel economy data yet — add trips with ledger to see per-day km/L.</p>
        <div className="flex-1 flex items-center justify-center py-8 text-xs text-slate-400 border border-dashed border-slate-200 rounded-lg">No data</div>
      </div>
    );
  }

  return (
    <article className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col" data-purpose="trend-card">
      <style>{`
        .custom-h-scrollbar::-webkit-scrollbar { height: 7px; }
        .custom-h-scrollbar::-webkit-scrollbar-track { background: #f1f5f9; border-radius: 4px; }
        .custom-h-scrollbar::-webkit-scrollbar-thumb { background: #64748b; border-radius: 4px; }
        .custom-h-scrollbar::-webkit-scrollbar-thumb:hover { background: #475569; }
        .gap-stripe-bg {
          background: repeating-linear-gradient(45deg, rgba(254,226,226,0.4), rgba(254,226,226,0.4) 8px, rgba(254,242,242,0.2) 8px, rgba(254,242,242,0.2) 16px);
        }
        .sticky-year-label {
          position: sticky;
          left: 24px;
          right: 24px;
          display: inline-block;
          width: fit-content;
          margin: 0 auto;
        }
      `}</style>

      {/* Header */}
      <header className="px-6 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-4 bg-white">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
              Fuel Economy Trend
            </h1>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">
              {distinctDateCount} days logged
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1 flex items-center gap-1.5">
            <span className="font-medium text-slate-600">Per DayGroup km/L</span>
            <span className="text-slate-300">•</span>
            <span>gaps show odometer loss / missing sync periods</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="inline-flex p-0.5 bg-slate-100 rounded-lg border border-slate-200 text-xs font-medium text-slate-600" id="filter-presets">
            {sortedYears.map(y => {
              const isActive = activeYear ? activeYear === y : false;
              return (
                <button
                  key={y}
                  className={`px-3 py-1 rounded-md transition-colors ${isActive ? 'bg-white shadow-sm text-slate-900 font-semibold' : 'text-slate-500 hover:text-slate-800'}`}
                  onClick={() => scrollToYear(y)}
                >
                  {y}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-1 border-l border-slate-200 pl-3">
            <button
              className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition"
              title="Scroll left"
              onClick={() => scrollRef.current?.scrollBy({ left: -320, behavior: 'smooth' })}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M15 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} /></svg>
            </button>
            <button
              className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition"
              title="Scroll right"
              onClick={() => scrollRef.current?.scrollBy({ left: 320, behavior: 'smooth' })}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} /></svg>
            </button>
          </div>
        </div>
      </header>

      {/* Viewport with baselines */}
      <div className="relative bg-white pt-6 pb-2">
        <div className="absolute left-6 right-6 top-10 pointer-events-none border-b border-dashed border-slate-200 z-0 flex justify-end">
          <span className="text-[11px] font-mono text-slate-400 bg-white px-2 -translate-y-2.5">14.0 km/L (Rated Max Target)</span>
        </div>
        <div className="absolute left-6 right-6 top-28 pointer-events-none border-b border-slate-100 z-0 flex justify-end">
          <span className="text-[10px] font-mono text-slate-300 bg-white px-2 -translate-y-2">10.0 km/L Average Baseline</span>
        </div>

        <div
          ref={scrollRef}
          className="custom-h-scrollbar overflow-x-auto overflow-y-hidden select-none px-6"
          id="timeline-scroll-container"
          onMouseDown={e => { if (e.button === 1) e.preventDefault(); }}
          title="Middle-mouse drag to pan • scroll to see history"
        >
          <div className="inline-flex flex-col min-w-max pb-1" id="chart-track" style={{ minWidth: `${minWidthPx}px` }}>
            {/* UPPER ROW: stems + gaps, tinted per year */}
            <div className="flex items-end h-64 gap-1.5 border-b border-slate-300 relative pt-8">
              {upperGroups.map((g, idx) => {
                if (g.kind === 'gap') {
                  return (
                    <div
                      key={`gap-${g.date}-${idx}`}
                      className="relative flex flex-col items-center justify-end h-48 w-24 gap-stripe-bg border-x border-dashed border-rose-300 mx-1 rounded-sm shrink-0"
                      data-purpose="data-gap-marker"
                    >
                      <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 border-r-2 border-dashed border-rose-400" />
                      <div className="relative z-10 mb-6 bg-white border border-rose-300 rounded px-1.5 py-0.5 shadow-sm text-center">
                        <p className="text-[9px] font-bold uppercase tracking-wider text-rose-600">GAP</p>
                        <p className="text-[10px] font-black text-rose-600 whitespace-nowrap">{Math.abs(g.gap.delta)}KM</p>
                      </div>
                    </div>
                  );
                }
                const pal = yearColor.get(g.year) ?? YEAR_PALETTE[0];
                const isFirstOfYear = upperGroups.findIndex(x => x.kind === 'year' && x.year === g.year) === idx;
                return (
                  <div
                    key={`yg-${g.year}-${idx}`}
                    id={isFirstOfYear ? `segment-${g.year}` : undefined}
                    data-purpose={`year-group-${g.year}`}
                    className={`inline-flex items-end gap-1.5 rounded-lg px-1 pb-1 pt-1 shrink-0 ${pal.group}`}
                  >
                    {g.stems.map(d => {
                      const barPct = maxEconomy > 0 ? (d.fuelEconomy / maxEconomy) * 100 : 0;
                      return (
                        <div key={d.key} className="group relative flex flex-col items-center w-8 shrink-0">
                          <span className="text-[11px] font-mono font-medium text-slate-600 mb-1">{d.fuelEconomy.toFixed(1)}</span>
                          <div className="w-5 bg-slate-100 rounded-t-sm h-48 flex items-end">
                            <div
                              className="w-full bg-emerald-600 rounded-t-sm hover:brightness-110 transition-all"
                              style={{ height: `${Math.max(6, barPct)}%` }}
                              title={`${d.date}: ${d.fuelEconomy.toFixed(1)} km/L`}
                            />
                          </div>
                          <div className="pointer-events-none absolute bottom-full mb-6 hidden group-hover:flex flex-col bg-slate-900 text-white text-[10px] rounded py-1 px-2 z-30 shadow-lg whitespace-nowrap">
                            <span className="font-bold text-emerald-400">{d.fuelEconomy.toFixed(1)} km/L</span>
                            <span>{d.date}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>

            {/* MIDDLE ROW: dates */}
            <div className="flex items-center gap-1.5 py-2 text-[10px] text-slate-600 font-mono" data-purpose="daily-date-labels">
              {upperGroups.map((g, idx) => {
                if (g.kind === 'gap') {
                  return (
                    <div key={`d-gap-${idx}`} className="w-24 text-center text-rose-400 font-sans text-[9px] font-semibold italic shrink-0 mx-1">
                      Gap Period
                    </div>
                  );
                }
                return (
                  <div key={`d-yg-${g.year}-${idx}`} className="inline-flex items-center gap-1.5 shrink-0">
                    {g.stems.map(d => (
                      <span key={`dl-${d.key}`} className="w-8 text-center shrink-0">
                        {formatDayLabel(d.date)}
                      </span>
                    ))}
                  </div>
                );
              })}
            </div>

            {/* BOTTOM ROW: sticky year footer interrupted by gaps - labels use position:sticky per track */}
            <div className="flex items-stretch text-xs font-bold border-t border-slate-200 sticky bottom-0 z-10 bg-white shadow-[0_-4px_12px_rgba(0,0,0,0.04)]" data-purpose="sticky-year-footer-row">
              {footerSegments.map((seg, idx) => {
                if (seg.kind === 'gap') {
                  return (
                    <div key={`f-gap-${idx}`} className="w-24 bg-rose-50/40 border-r border-slate-200 py-1.5 flex items-center justify-center shrink-0 mx-1">
                      {/* intentionally blank */}
                    </div>
                  );
                }
                const pal = yearColor.get(seg.year) ?? YEAR_PALETTE[0];
                const totalStems = seg.stems.length;
                // width: 32 per stem + 6 per inter-stem gap + 8 px-1 padding
                const widthPx = totalStems * 32 + Math.max(0, totalStems - 1) * 6 + 8;
                return (
                  <div
                    key={`f-year-${seg.year}-${idx}`}
                    className={`relative ${pal.track} ${pal.border} border-r py-1.5 px-3 flex items-center justify-center overflow-hidden shrink-0`}
                    style={{ width: `${widthPx}px` }}
                  >
                    <span className={`sticky-year-label ${pal.text} font-mono tracking-widest text-[13px]`}>{seg.year}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <footer className="px-6 py-2 flex items-center justify-between text-xs text-slate-400 font-mono border-t border-slate-100 bg-slate-50/50">
          <span>0 km/L</span>
          <span className="text-[11px] font-sans text-slate-500 font-normal">← Middle-drag or scroll to browse historical logs →</span>
          <span>{maxEconomy} km/L max</span>
        </footer>
      </div>
    </article>
  );
}
