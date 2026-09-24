'use client';

import React, { useMemo, useState } from 'react';
import type { BookPage, Trip, Vehicle } from '@/types';
import { estimateFuelEconomies, type SegmentEstimate } from '@/lib/estimateFuelEconomy';
import { getFuelEconomiesForPage, saveFuelEconomiesForPage } from '@/lib/fuelEconomyStore';
import { getDistinctDates } from '@/lib/pagination';

function formatDdMmYyyy(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}

interface Props {
  trips: Trip[];
  pages: BookPage[];
  vehicle: Vehicle | null;
  onApplied?: () => void;
}

export function EstimateFuelEconomy({ trips, pages, vehicle, onApplied }: Props) {
  const [open, setOpen] = useState(false);
  const [estimates, setEstimates] = useState<SegmentEstimate[] | null>(null);

  const handleEstimate = () => {
    const effTank = vehicle?.tank_capacity ?? 75;
    const est = estimateFuelEconomies({ trips, pages, vehicle, tankCapacityOverride: effTank });
    setEstimates(est);
    setOpen(true);
  };

  const handleApply = (idx: number) => {
    if (!estimates) return;
    const seg = estimates[idx];
    applySegment(seg);
    onApplied?.();
  };

  const handleApplyAll = () => {
    if (!estimates) return;
    for (const seg of estimates) applySegment(seg);
    onApplied?.();
    setOpen(false);
  };

  const applySegment = (seg: SegmentEstimate) => {
    // Find all dates in segment
    const allSortedDates = Array.from(new Set(trips.map(t => t.date))).sort();
    const targetDates = allSortedDates.filter(d => d >= seg.fromDate && d <= seg.toDate);
    // Group by pageId
    const pageForDate = new Map<string, string>();
    for (const d of targetDates) {
      const t = trips.find(x => x.date === d);
      if (t) pageForDate.set(d, t.page_id);
    }
    // For each page, map dates to dayIndex then write economy
    const byPage = new Map<string, string[]>(); // pageId -> dates
    for (const d of targetDates) {
      const pid = pageForDate.get(d);
      if (!pid) continue;
      if (!byPage.has(pid)) byPage.set(pid, []);
      byPage.get(pid)!.push(d);
    }
    for (const [pageId, dates] of byPage) {
      const pageTrips = trips.filter(t => t.page_id === pageId);
      const distinct = getDistinctDates(pageTrips);
      const arr = getFuelEconomiesForPage(pageId);
      while (arr.length < distinct.length) arr.push(null);
      for (const d of dates) {
        const dayIdx = distinct.indexOf(d); // 0-based
        if (dayIdx >= 0) arr[dayIdx] = seg.suggested;
      }
      saveFuelEconomiesForPage(pageId, arr);
    }
  };

  const hasData = trips.some(t => (t.fuel_pumped_amount ?? 0) > 0);

  return (
    <>
      <button
        onClick={handleEstimate}
        disabled={!hasData}
        title={hasData ? 'Estimate Fuel Economies per Fuel-In Segment' : 'Need at least one fuel-in to estimate'}
        className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border transition shadow-2xs cursor-pointer ${hasData ? 'bg-amber-50 text-amber-900 border-amber-200 hover:bg-amber-100' : 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'}`}
      >
        <svg className={`w-3.5 h-3.5 shrink-0 ${hasData ? 'text-amber-600' : 'text-slate-400'}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z"></path></svg>
        <span>Estimate Fuel Economies</span>
      </button>
      {open && estimates && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="bg-paper-sheet rounded-xl shadow-xl w-full max-w-4xl max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-rule-line flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-on-surface">Estimated Fuel Economies — per Fuel-In Segment</h3>
                <p className="text-xs text-on-surface-variant">One economy per fuel-in section (1-dec km/L). Keeps balance in [1, {vehicle?.tank_capacity?.toFixed(1) ?? '75.0'}]L, closest to previous economy (7.5–8 typical). Apply writes Adjusted economies.</p>
              </div>
              <button onClick={() => setOpen(false)} className="text-on-surface-variant hover:text-on-surface">✕</button>
            </div>
            <div className="overflow-auto flex-1 p-3">
              {estimates.length === 0 ? (
                <p className="text-sm text-on-surface-variant p-6 text-center">No fuel-in segments found — add trips with Fuel Pumped &gt; 0.</p>
              ) : (
                <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0 bg-paper-gutter z-10">
                    <tr className="text-[10px] font-bold tracking-widest uppercase text-on-surface-variant border-b border-rule-line-strong">
                      <th className="py-2 px-2 border-r border-rule-line">From</th>
                      <th className="py-2 px-2 border-r border-rule-line">To</th>
                      <th className="py-2 px-2 text-right border-r border-rule-line">Distance</th>
                      <th className="py-2 px-2 text-right border-r border-rule-line">Fuel Fed</th>
                      <th className="py-2 px-2 text-right border-r border-rule-line">Prev</th>
                      <th className="py-2 px-2 text-right border-r border-rule-line">Suggested</th>
                      <th className="py-2 px-2 border-r border-rule-line">Note</th>
                      <th className="py-2 px-2">Apply</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-rule-line text-sm">
                    {estimates.map((e, idx) => (
                      <tr key={e.fromDate} className={e.feasible ? 'bg-white' : 'bg-amber-50'}>
                        <td className="py-2 px-2 font-mono text-xs whitespace-nowrap">{formatDdMmYyyy(e.fromDate)}</td>
                        <td className="py-2 px-2 font-mono text-xs whitespace-nowrap">{formatDdMmYyyy(e.toDate)}</td>
                        <td className="py-2 px-2 text-right font-mono text-xs">{e.distance} KM</td>
                        <td className="py-2 px-2 text-right font-mono text-xs">{e.fuelFed.toFixed(1)} L</td>
                        <td className="py-2 px-2 text-right font-mono text-xs">{e.prevEconomy !== null ? e.prevEconomy.toFixed(1) : '—'}</td>
                        <td className="py-2 px-2 text-right font-mono text-xs font-bold text-primary">{e.suggested.toFixed(1)} km/L</td>
                        <td className="py-2 px-2 text-xs max-w-[220px] truncate" title={e.warning ?? ''}>
                          {e.warning ? <span className="text-amber-700 font-semibold">{e.warning}</span> : e.feasible ? <span className="text-on-surface-variant">feasible [{e.feasibleMin?.toFixed(1)}–{e.feasibleMax?.toFixed(1)}]</span> : '—'}
                        </td>
                        <td className="py-2 px-2">
                          <button onClick={() => handleApply(idx)} className="px-2 py-1 bg-telemetry-cyan text-white rounded text-xs font-semibold hover:bg-telemetry-cyan/90">Apply</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="p-3 border-t border-rule-line flex items-center justify-between">
              <span className="text-xs text-on-surface-variant">Applying overwrites Adjusted economies in the segment. Check KM/Fuel gaps if large step.</span>
              <div className="flex gap-2">
                <button onClick={() => setOpen(false)} className="px-4 py-2 text-sm font-semibold text-on-surface-variant hover:bg-paper-gutter rounded-lg">Close</button>
                <button onClick={handleApplyAll} disabled={estimates.length === 0} className="px-4 py-2 text-sm font-semibold text-on-primary bg-slate-surface rounded-lg hover:bg-primary disabled:opacity-50">Apply All</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
