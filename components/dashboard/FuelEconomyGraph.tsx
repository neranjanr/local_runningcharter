'use client';

import React, { useMemo, useRef, useEffect } from 'react';
import type { Trip, BookPage } from '@/types';
import { computeLedgerDays } from '@/lib/ledgerCalculations';
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

export function FuelEconomyGraph({ trips, pages }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const { days, gapsByDate, maxEconomy } = useMemo(() => {
    const sortedPages = [...pages].sort((a, b) => a.page_number - b.page_number);
    const dayMap = new Map<string, { fuelEconomy: number; date: string }>();
    for (const page of sortedPages) {
      try {
        const economies = getFuelEconomiesForPage(page.id);
        const inTanks = getInTanksForPage(page.id);
        const ledgerDays = computeLedgerDays({ page, trips, economies, inTanks });
        for (const d of ledgerDays) {
          if (!dayMap.has(d.date)) dayMap.set(d.date, { fuelEconomy: d.fuelEconomy, date: d.date });
        }
      } catch {}
    }
    const allDays = Array.from(dayMap.values()).sort((a, b) => a.date.localeCompare(b.date));
    const max = allDays.length ? Math.max(...allDays.map(d => d.fuelEconomy), 10) : 10;

    // Odometer gaps: map successor date -> gap info (odometer loss)
    const tripGaps = detectTripGaps(trips).filter(g => g.kind === 'km');
    const gapsByDate = new Map<string, { expected: number; actual: number; delta: number }>();
    for (const g of tripGaps) {
      const delta = g.actual - g.expected;
      // find successor trip date
      const succ = trips.find(t => t.id === g.tripId);
      if (succ) {
        // if multiple gaps map to same date, keep largest delta
        const existing = gapsByDate.get(succ.date);
        if (!existing || Math.abs(delta) > Math.abs(existing.delta)) {
          gapsByDate.set(succ.date, { expected: g.expected, actual: g.actual, delta });
        }
      }
    }
    return { days: allDays, gapsByDate, maxEconomy: Math.ceil(max) };
  }, [trips, pages]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      // show latest data at default view (scroll to right)
      el.scrollLeft = el.scrollWidth;
    }
  }, [days]);

  if (days.length === 0) {
    return (
      <div className="bg-paper-sheet rounded-xl border border-rule-line shadow-sm p-6 flex flex-col gap-2 h-full">
        <h3 className="text-sm font-bold tracking-tight text-on-surface">Fuel Economy Trend</h3>
        <p className="text-xs text-on-surface-variant">No fuel economy data yet — add trips with ledger to see per-day km/L.</p>
        <div className="flex-1 flex items-center justify-center py-8 text-xs text-on-surface-variant border border-dashed border-rule-line rounded-lg">No data</div>
      </div>
    );
  }

  return (
    <div className="bg-paper-sheet rounded-xl border border-rule-line shadow-sm flex flex-col h-full">
      <div className="p-4 flex items-center justify-between border-b border-rule-line">
        <div>
          <h3 className="text-sm font-bold tracking-tight text-on-surface">Fuel Economy Trend</h3>
          <p className="text-xs text-on-surface-variant">Per DayGroup km/L • gaps show odometer loss</p>
        </div>
        <span className="text-xs font-mono text-on-surface-variant">{days.length} days</span>
      </div>
      <div ref={scrollRef} className="overflow-x-auto overflow-y-hidden scrollbar-thin flex-1" style={{ scrollbarWidth: 'thin' }}>
        <div className="flex items-end gap-1 px-3 py-4 h-[220px]" style={{ minWidth: `${Math.max(days.length * 36 + gapsByDate.size * 48, 320)}px` }}>
          {days.map((d) => {
            const gap = gapsByDate.get(d.date);
            const barPct = maxEconomy > 0 ? (d.fuelEconomy / maxEconomy) * 100 : 0;
            return (
              <React.Fragment key={d.date}>
                {gap && (
                  <div className="flex flex-col items-center justify-end h-full pb-6 shrink-0 w-12">
                    <div className="w-full flex-1 flex items-center justify-center">
                      <div className="w-0.5 h-full bg-red-300/60 border-l-2 border-dashed border-red-400" title={`ODO gap ${gap.expected}→${gap.actual} (${gap.delta > 0 ? '+' : ''}${gap.delta} km)`}></div>
                    </div>
                    <span className="text-[8px] font-bold tracking-widest uppercase text-red-600 bg-red-50 border border-red-200 rounded px-1 py-0.5 mt-1">gap {gap.delta}km</span>
                  </div>
                )}
                <div className="flex flex-col items-center gap-1 shrink-0 w-9">
                  <span className="text-[9px] font-mono font-bold text-on-surface">{d.fuelEconomy.toFixed(1)}</span>
                  <div className="w-full flex items-end justify-center h-28 bg-paper-gutter rounded">
                    <div className="w-6 bg-telemetry-cyan rounded-t transition-all" style={{ height: `${Math.max(6, barPct)}%` }} title={`${d.date}: ${d.fuelEconomy.toFixed(1)} km/L`}></div>
                  </div>
                  <span className="text-[8px] font-mono text-on-surface-variant whitespace-nowrap">{formatDayLabel(d.date)}</span>
                </div>
              </React.Fragment>
            );
          })}
        </div>
      </div>
      <div className="px-4 py-2 border-t border-rule-line flex items-center justify-between text-[10px] text-on-surface-variant">
        <span>0 km/L</span>
        <span className="font-bold">{maxEconomy} km/L max</span>
      </div>
    </div>
  );
}
