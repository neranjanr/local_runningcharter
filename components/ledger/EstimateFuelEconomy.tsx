'use client';

import React, { useState } from 'react';
import type { BookPage, Trip, Vehicle } from '@/types';
import { estimateFuelEconomies, type SegmentEstimate } from '@/lib/estimateFuelEconomy';
import { getFuelEconomiesForPage, saveFuelEconomiesForPage } from '@/lib/fuelEconomyStore';
import { getDistinctDates } from '@/lib/pagination';
import { getLockedDates, setLocksForDateRange, getFuelLocksForPage } from '@/lib/fuelEconomyLockStore';

function formatDdMmYyyy(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}

type ApplyMode = 'normal' | 'strict';

interface Props {
  trips: Trip[];
  pages: BookPage[];
  vehicle: Vehicle | null;
  onApplied?: () => void;
}

export function EstimateFuelEconomy({ trips, pages, vehicle, onApplied }: Props) {
  const [open, setOpen] = useState(false);
  const [estimates, setEstimates] = useState<SegmentEstimate[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [lockedDates, setLockedDatesState] = useState<Set<string>>(new Set());
  const [applyMsg, setApplyMsg] = useState<string | null>(null);
  const effTank = vehicle?.tank_capacity ?? 75;
  const strictMin = Math.max(1, effTank - 3);

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

  const buildAppliedSeed = (): number[] | undefined => {
    const entries: { date: string; econ: number }[] = [];
    for (const p of pages) {
      const arr = getFuelEconomiesForPage(p.id);
      const pageTrips = trips.filter(t => t.page_id === p.id);
      const distinct = getDistinctDates(pageTrips);
      const locks = getFuelLocksForPage(p.id);
      distinct.forEach((d, idx) => {
        if (arr[idx] != null && !locks[idx]) entries.push({ date: d, econ: arr[idx] as number });
      });
    }
    if (entries.length === 0) return undefined;
    entries.sort((a, b) => a.date.localeCompare(b.date));
    // Seed the chain from the earliest written (unlocked) economy; the estimator
    // still re-estimates every unlocked segment, but stays anchored to the book.
    return [entries[0].econ];
  };

  const runEstimate = () => {
    const lockedSet = (() => { try { return getLockedDates(); } catch { return new Set<string>(); } })();
    const lockedMap = buildLockedMap();
    const prevEconomies = buildAppliedSeed();
    const est = estimateFuelEconomies({ trips, pages, vehicle, tankCapacityOverride: effTank, prevEconomies, lockedDatesSet: lockedSet, lockedEconomyMap: lockedMap });
    setEstimates(est);
  };

  const handleEstimate = () => {
    try { setLockedDatesState(getLockedDates()); } catch {}
    runEstimate();
    setApplyMsg(null);
    setOpen(true);
  };

  const isSegmentLocked = (seg: SegmentEstimate) => {
    const allDates = Array.from(new Set(trips.map(t => t.date))).sort();
    const segDates = allDates.filter(d => d >= seg.fromDate && d <= seg.toDate);
    return segDates.length > 0 && segDates.every(d => lockedDates.has(d));
  };

  const applySegment = (seg: SegmentEstimate, mode: ApplyMode) => {
    const val = mode === 'strict' ? seg.suggestedStrict : seg.suggested;
    const allSortedDates = Array.from(new Set(trips.map(t => t.date))).sort();
    const targetDates = allSortedDates.filter(d => d >= seg.fromDate && d <= seg.toDate);
    const pageForDate = new Map<string, string>();
    for (const d of targetDates) {
      const t = trips.find(x => x.date === d);
      if (t) pageForDate.set(d, t.page_id);
    }
    const byPage = new Map<string, string[]>();
    for (const d of targetDates) {
      const pid = pageForDate.get(d);
      if (!pid) continue;
      if (!byPage.has(pid)) byPage.set(pid, []);
      byPage.get(pid)!.push(d);
    }
    let wrote = 0;
    for (const [pageId, dates] of byPage) {
      const pageTrips = trips.filter(t => t.page_id === pageId);
      const distinct = getDistinctDates(pageTrips);
      const arr = getFuelEconomiesForPage(pageId);
      while (arr.length < distinct.length) arr.push(null);
      for (const d of dates) {
        const dayIdx = distinct.indexOf(d);
        if (dayIdx >= 0) { arr[dayIdx] = val; wrote++; }
      }
      saveFuelEconomiesForPage(pageId, arr);
    }
    return { val, wrote };
  };

  const handleApply = (idx: number, mode: ApplyMode) => {
    if (!estimates) return;
    const seg = estimates[idx];
    if (isSegmentLocked(seg)) return;
    const { val, wrote } = applySegment(seg, mode);
    setApplyMsg(`Applied ${val.toFixed(1)} km/L (${mode === 'strict' ? 'Strict Full-Tank' : 'Normal'}) to ${formatDdMmYyyy(seg.fromDate)} → ${formatDdMmYyyy(seg.toDate)} (${wrote} day${wrote === 1 ? '' : 's'})`);
    onApplied?.();
    runEstimate();
  };

  const handleApplyAll = (mode: ApplyMode) => {
    if (!estimates) return;
    let count = 0;
    for (const seg of estimates) {
      if (isSegmentLocked(seg)) continue;
      applySegment(seg, mode);
      count++;
    }
    setApplyMsg(`Applied ${mode === 'strict' ? 'Strict Full-Tank' : 'Normal'} economies to ${count} segment${count === 1 ? '' : 's'}`);
    onApplied?.();
    runEstimate();
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
    runEstimate();
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
    runEstimate();
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
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-3 sm:p-6 overflow-y-auto" onClick={() => setOpen(false)}>
          <div className="bg-paper-sheet rounded-xl shadow-xl w-full max-w-[96vw] max-h-[92vh] flex flex-col my-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-rule-line flex items-center justify-between gap-3">
              <div className="flex-1">
                <h3 className="text-sm font-bold text-on-surface">Estimated Fuel Economies — per Fuel-In Segment</h3>
                <p className="text-xs text-on-surface-variant">
                  Two suggestions per segment: <span className="font-semibold text-sky-700">Normal</span> keeps balances in [1, {effTank.toFixed(1)}]L (closest to previous economy, small steps); <span className="font-semibold text-emerald-700">Strict Full-Tank</span> also balances the tank near full ([{strictMin.toFixed(1)}, {effTank.toFixed(1)}]L) after a ★ Full Tank pump. Pick either column and Apply.
                </p>
                <p className="text-[11px] text-on-surface-variant mt-0.5">
                  Distance badges: <span className="inline-flex items-center px-1 py-0.5 rounded bg-amber-100 border border-amber-300 text-amber-700 text-[9px] font-bold">N× &gt;40</span> counts trips over 40 km, <span className="inline-flex items-center px-1 py-0.5 rounded bg-emerald-100 border border-emerald-300 text-emerald-700 text-[9px] font-bold">N× ≥100</span> counts trips 100 km or longer — long runs usually give better economy.
                </p>
              </div>
              <button onClick={() => setOpen(false)} className="text-on-surface-variant hover:text-on-surface text-lg leading-none shrink-0">✕</button>
            </div>
            {estimates && !estimates.some(e => e.isFullTank) && (
              <div className="mx-4 mt-3 p-2 bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded">No ★ Full Tank marks in ledger — Strict equals Normal (both use [1, {effTank.toFixed(1)}]L). Mark pumped trips as ★ Full Tank via All Trips right-click to enable strict balancing.</div>
            )}
            {applyMsg && (
              <div className="mx-4 mt-3 p-2 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded font-medium" data-testid="estimate-apply-msg">{applyMsg}</div>
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
                      <th className="py-2 px-2 text-right border-r border-rule-line" title="Normal: balances in [1, cap], closest to previous economy">Normal</th>
                      <th className="py-2 px-2 text-center border-r border-rule-line">Apply Normal</th>
                      <th className="py-2 px-2 text-right border-r border-rule-line" title="Strict Full-Tank: post-pump balance near tankCapacity">Strict ★</th>
                      <th className="py-2 px-2 text-center border-r border-rule-line">Apply Strict</th>
                      <th className="py-2 px-2 border-r border-rule-line">Lock</th>
                      <th className="py-2 px-2 border-r border-rule-line">Note</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-rule-line text-sm">
                    {estimates.map((e, idx) => {
                      const locked = isSegmentLocked(e);
                      const sameSuggestion = Math.abs(e.suggested - e.suggestedStrict) < 0.05;
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
                        <td className="py-2 px-2 text-right font-mono text-xs">
                          <span className="inline-flex items-center justify-end gap-1 w-full flex-wrap">
                            <span>{e.distance} KM</span>
                            {e.longTripCount > 0 && <span className="shrink-0 inline-flex items-center px-1 py-0.5 rounded bg-amber-100 border border-amber-300 text-amber-700 text-[8px] font-bold tracking-widest leading-none" title={`${e.longTripCount} trip(s) over 40 km (longest ${e.maxTripDistance} km)`}>{e.longTripCount}× &gt;40</span>}
                            {e.veryLongTripCount > 0 && <span className="shrink-0 inline-flex items-center px-1 py-0.5 rounded bg-emerald-100 border border-emerald-300 text-emerald-700 text-[8px] font-bold tracking-widest leading-none" title={`${e.veryLongTripCount} trip(s) 100 km or longer (longest ${e.maxTripDistance} km) — long runs usually show better economy`}>{e.veryLongTripCount}× ≥100</span>}
                          </span>
                        </td>
                        <td className="py-2 px-2 text-right font-mono text-xs">{e.fuelFed.toFixed(1)} L</td>
                        <td className="py-2 px-2 text-right font-mono text-xs">{e.prevEconomy !== null ? e.prevEconomy.toFixed(1) : '—'}</td>
                        <td className="py-2 px-2 text-right font-mono text-xs font-bold text-sky-700">{e.suggested !== null ? e.suggested.toFixed(1) : '—'}</td>
                        <td className="py-2 px-2 text-center">
                          <button onClick={() => handleApply(idx, 'normal')} disabled={locked || e.suggested === null} className={`px-2 py-1 rounded text-xs font-semibold ${locked || e.suggested === null ? 'bg-slate-200 text-slate-400 cursor-not-allowed' : 'bg-sky-600 text-white hover:bg-sky-700'}`} data-testid={`apply-normal-${idx}`}>Apply</button>
                        </td>
                        <td className={`py-2 px-2 text-right font-mono text-xs font-bold ${sameSuggestion ? 'text-on-surface-variant' : 'text-emerald-700'}`}>{e.suggestedStrict !== null ? e.suggestedStrict.toFixed(1) : '—'}</td>
                        <td className="py-2 px-2 text-center">
                          <button onClick={() => handleApply(idx, 'strict')} disabled={locked || e.suggestedStrict === null} className={`px-2 py-1 rounded text-xs font-semibold ${locked || e.suggestedStrict === null ? 'bg-slate-200 text-slate-400 cursor-not-allowed' : 'bg-emerald-600 text-white hover:bg-emerald-700'}`} data-testid={`apply-strict-${idx}`}>Apply</button>
                        </td>
                        <td className="py-2 px-2 text-center">{locked ? <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-slate-800 text-white text-[10px] font-bold">🔒</span> : <span className="text-on-surface-variant text-xs">—</span>}</td>
                        <td className="py-2 px-2 text-xs max-w-[260px] truncate" title={[e.warning, e.warningStrict].filter(Boolean).join(' | ')}>
                          {e.warning ? <span className="text-amber-700 font-semibold">{e.warning}</span> : e.warningStrict ? <span className="text-emerald-700 font-semibold">{e.warningStrict}</span> : e.feasible ? <span className="text-on-surface-variant">feasible [{e.feasibleMin?.toFixed(1)}–{e.feasibleMax?.toFixed(1)}]</span> : '—'}
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
                  <button onClick={() => handleApplyAll('normal')} disabled={estimates.length === 0} className="px-4 py-2 text-sm font-semibold text-white bg-sky-600 rounded-lg hover:bg-sky-700 disabled:opacity-50" data-testid="apply-all-normal">Apply All Normal</button>
                  <button onClick={() => handleApplyAll('strict')} disabled={estimates.length === 0} className="px-4 py-2 text-sm font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50" data-testid="apply-all-strict">Apply All Strict</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
