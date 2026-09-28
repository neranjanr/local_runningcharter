'use client';

import React, { useMemo, useState, useEffect } from 'react';
import type { BookPage, Trip, Vehicle } from '@/types';
import { estimateFuelEconomies, type SegmentEstimate } from '@/lib/estimateFuelEconomy';
import { getFuelEconomiesForPage, saveFuelEconomiesForPage } from '@/lib/fuelEconomyStore';
import { getDistinctDates } from '@/lib/pagination';
import { getLockedDates, setLocksForDateRange, getFuelLocksForPage } from '@/lib/fuelEconomyLockStore';

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
  const [strict, setStrict] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [lockedDates, setLockedDatesState] = useState<Set<string>>(new Set());
  const effTank = vehicle?.tank_capacity ?? 75;
  const strictMin = Math.max(1, effTank - 3);

  useEffect(() => {
    if (open) {
      try { setLockedDatesState(getLockedDates()); } catch {}
    }
  }, [open, trips, pages]);

  const buildLockedMap = () => {
    const map = new Map<string, number>();
    for (const p of pages) {
      const arr = getFuelEconomiesForPage(p.id);
      const pageTrips = trips.filter(t => t.page_id === p.id);
      const distinct = getDistinctDates(pageTrips);
      const locks = getFuelLocksForPage(p.id);
      distinct.forEach((d, idx) => {
        if (locks[idx] && arr[idx] != null) map.set(d, arr[idx] as number);
      });
    }
    return map;
  };

  const runEstimate = (useStrict: boolean) => {
    const lockedSet = (() => { try { return getLockedDates(); } catch { return new Set<string>(); } })();
    const lockedMap = buildLockedMap();
    const est = estimateFuelEconomies({ trips, pages, vehicle, tankCapacityOverride: effTank, strictFullTank: useStrict, lockedDatesSet: lockedSet, lockedEconomyMap: lockedMap });
    setEstimates(est);
  };

  const handleEstimate = () => {
    runEstimate(strict);
    setOpen(true);
  };

  const toggleStrict = () => {
    const next = !strict;
    setStrict(next);
    runEstimate(next);
  };

  const isSegmentLocked = (seg: SegmentEstimate) => {
    const allDates = Array.from(new Set(trips.map(t => t.date))).sort();
    const segDates = allDates.filter(d => d >= seg.fromDate && d <= seg.toDate);
    return segDates.length > 0 && segDates.every(d => lockedDates.has(d));
  };

  const handleApply = (idx: number) => {
    if (!estimates) return;
    const seg = estimates[idx];
    if (isSegmentLocked(seg)) return;
    applySegment(seg);
    onApplied?.();
    runEstimate(strict);
  };

  const handleApplyAll = () => {
    if (!estimates) return;
    for (const seg of estimates) if (!isSegmentLocked(seg)) applySegment(seg);
    onApplied?.();
    runEstimate(strict);
  };

  const handleLockSelected = () => {
    if (!estimates) return;
    const toLock: string[] = [];
    const allDates = Array.from(new Set(trips.map(t => t.date))).sort();
    estimates.forEach((seg, idx) => {
      if (!selected.has(idx)) return;
      const segDates = allDates.filter(d => d >= seg.fromDate && d <= seg.toDate);
      toLock.push(...segDates);
    });
    if (toLock.length === 0) return;
    setLocksForDateRange(trips, Array.from(new Set(toLock)), true);
    setLockedDatesState(getLockedDates());
    runEstimate(strict);
    onApplied?.();
  };

  const handleUnlockSelected = () => {
    if (!estimates) return;
    const toUnlock: string[] = [];
    const allDates = Array.from(new Set(trips.map(t => t.date))).sort();
    estimates.forEach((seg, idx) => {
      if (!selected.has(idx)) return;
      const segDates = allDates.filter(d => d >= seg.fromDate && d <= seg.toDate);
      toUnlock.push(...segDates);
    });
    if (toUnlock.length === 0) return;
    setLocksForDateRange(trips, Array.from(new Set(toUnlock)), false);
    setLockedDatesState(getLockedDates());
    runEstimate(strict);
    onApplied?.();
  };

  const toggleSelect = (idx: number) => {
    const ns = new Set(selected);
    if (ns.has(idx)) ns.delete(idx); else ns.add(idx);
    setSelected(ns);
  };

  const toggleSelectAll = () => {
    if (!estimates) return;
    if (selected.size === estimates.length) setSelected(new Set());
    else setSelected(new Set(estimates.map((_, i) => i)));
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
            <div className="p-4 border-b border-rule-line flex items-center justify-between gap-3">
              <div className="flex-1">
                <h3 className="text-sm font-bold text-on-surface">Estimated Fuel Economies — per Fuel-In Segment</h3>
                <p className="text-xs text-on-surface-variant">
                  {strict ? (
                    <>Strict Full-Tank ON — Full Tank segments constrained to [{strictMin.toFixed(1)}, {effTank.toFixed(1)}]L after pump (tankCap−3→cap), others [1, {effTank.toFixed(1)}]L. <span className="font-semibold text-emerald-700">★ Full</span> = source pump flagged Full Tank.</>
                  ) : (
                    <>One economy per fuel-in section (1-dec km/L). Keeps balance in [1, {effTank.toFixed(1)}]L, closest to previous economy (7.5–8 typical). Apply writes Adjusted economies.</>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <label className="inline-flex items-center gap-1.5 text-xs font-semibold cursor-pointer select-none">
                  <input type="checkbox" checked={strict} onChange={toggleStrict} className="w-3.5 h-3.5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" data-testid="strict-full-tank-toggle" />
                  <span className={strict ? 'text-emerald-700' : 'text-slate-600'}>Strict Full-Tank</span>
                </label>
                <button onClick={() => setOpen(false)} className="text-on-surface-variant hover:text-on-surface">✕</button>
              </div>
            </div>
            {strict && estimates && !estimates.some(e=>e.isFullTank) && (
              <div className="mx-4 mt-3 p-2 bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded">No Full Tank marks in ledger — strict has no effect (using lenient [1, {effTank.toFixed(1)}]L). Mark pumped trips as ★ Full Tank via All Trips right-click.</div>
            )}
            <div className="overflow-auto flex-1 p-3">
              {estimates.length === 0 ? (
                <p className="text-sm text-on-surface-variant p-6 text-center">No fuel-in segments found — add trips with Fuel Pumped &gt; 0.</p>
              ) : (
                <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0 bg-paper-gutter z-10">
                    <tr className="text-[10px] font-bold tracking-widest uppercase text-on-surface-variant border-b border-rule-line-strong">
                      <th className="py-2 px-2 border-r border-rule-line"><input type="checkbox" checked={estimates.length>0 && selected.size===estimates.length} onChange={toggleSelectAll} /></th>
                      <th className="py-2 px-2 border-r border-rule-line">From</th>
                      <th className="py-2 px-2 border-r border-rule-line">To</th>
                      <th className="py-2 px-2 text-center border-r border-rule-line" title="Source pump flagged Full Tank">Full?</th>
                      <th className="py-2 px-2 text-center border-r border-rule-line" title="Pump Timing START vs END">Timing</th>
                      <th className="py-2 px-2 text-right border-r border-rule-line">Distance</th>
                      <th className="py-2 px-2 text-right border-r border-rule-line">Fuel Fed</th>
                      <th className="py-2 px-2 text-right border-r border-rule-line">Prev</th>
                      <th className="py-2 px-2 text-right border-r border-rule-line">Suggested</th>
                      <th className="py-2 px-2 border-r border-rule-line">Lock</th>
                      <th className="py-2 px-2 border-r border-rule-line">Note</th>
                      <th className="py-2 px-2">Apply</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-rule-line text-sm">
                    {estimates.map((e, idx) => {
                      const locked = isSegmentLocked(e);
                      return (
                      <tr key={e.fromDate} className={locked ? 'bg-slate-100 opacity-80' : e.feasible ? 'bg-white' : 'bg-amber-50'}>
                        <td className="py-2 px-2 text-center"><input type="checkbox" checked={selected.has(idx)} onChange={()=>toggleSelect(idx)} /></td>
                        <td className="py-2 px-2 font-mono text-xs whitespace-nowrap">{formatDdMmYyyy(e.fromDate)}</td>
                        <td className="py-2 px-2 font-mono text-xs whitespace-nowrap">{formatDdMmYyyy(e.toDate)}</td>
                        <td className="py-2 px-2 text-center">
                          {e.isFullTank ? <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-emerald-100 border border-emerald-300 text-emerald-700 text-[10px] font-bold" title="Full Tank pump">★ FULL</span> : <span className="text-on-surface-variant text-xs">—</span>}
                        </td>
                        <td className="py-2 px-2 text-center">
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-bold ${e.pumpTiming==='START' ? 'bg-sky-100 border-sky-300 text-sky-700' : 'bg-slate-100 border-slate-300 text-slate-600'}`} title={e.pumpTiming==='START' ? 'Fueled at Start (distance charged to next economy, fuel before consume)' : 'Fueled at End (distance charged to previous economy)'}>{e.pumpTiming}</span>
                        </td>
                        <td className="py-2 px-2 text-right font-mono text-xs">{e.distance} KM</td>
                        <td className="py-2 px-2 text-right font-mono text-xs">{e.fuelFed.toFixed(1)} L</td>
                        <td className="py-2 px-2 text-right font-mono text-xs">{e.prevEconomy !== null ? e.prevEconomy.toFixed(1) : '—'}</td>
                        <td className="py-2 px-2 text-right font-mono text-xs font-bold text-primary">{e.suggested.toFixed(1)} km/L</td>
                        <td className="py-2 px-2 text-center">{locked ? <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-slate-800 text-white text-[10px] font-bold">🔒 Locked</span> : <span className="text-on-surface-variant text-xs">—</span>}</td>
                        <td className="py-2 px-2 text-xs max-w-[220px] truncate" title={e.warning ?? ''}>
                          {e.warning ? <span className="text-amber-700 font-semibold">{e.warning}</span> : e.feasible ? <span className="text-on-surface-variant">feasible [{e.feasibleMin?.toFixed(1)}–{e.feasibleMax?.toFixed(1)}]</span> : '—'}
                        </td>
                        <td className="py-2 px-2">
                          <button onClick={() => handleApply(idx)} disabled={locked} className={`px-2 py-1 rounded text-xs font-semibold ${locked ? 'bg-slate-200 text-slate-400 cursor-not-allowed' : 'bg-telemetry-cyan text-white hover:bg-telemetry-cyan/90'}`}>Apply</button>
                        </td>
                      </tr>
                    );})}
                  </tbody>
                </table>
              )}
            </div>
            <div className="p-3 border-t border-rule-line flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-on-surface-variant">Applying overwrites Adjusted economies in the segment. Locked segments are skipped. Check KM/Fuel gaps if large step.</span>
                <div className="flex gap-2">
                  <button onClick={handleLockSelected} disabled={selected.size===0} className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50">🔒 Lock Selected</button>
                  <button onClick={handleUnlockSelected} disabled={selected.size===0} className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-amber-300 bg-amber-50 hover:bg-amber-100 disabled:opacity-50">🔓 Unlock Selected</button>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-on-surface-variant">Select segments to lock/unlock after writing to book. Next estimation will anchor to last locked balance.</span>
                <div className="flex gap-2">
                  <button onClick={() => setOpen(false)} className="px-4 py-2 text-sm font-semibold text-on-surface-variant hover:bg-paper-gutter rounded-lg">Close</button>
                  <button onClick={handleApplyAll} disabled={estimates.length === 0} className="px-4 py-2 text-sm font-semibold text-on-primary bg-slate-surface rounded-lg hover:bg-primary disabled:opacity-50">Apply All Unlocked</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
