'use client';

import React, { useMemo, useState } from 'react';
import type { Trip } from '@/types';
import { roundToOneDecimal, roundToIntegerKm } from '@/lib/tripCalculations';
import { detectTripGaps } from '@/lib/continuityAlerts';

interface Props {
  trips: Trip[];
}

function formatDdMmYyyy(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}

interface Row {
  date: string;
  fuelIn: number;
  orderNo: string;
  lastKm: number;
}

interface IndicativeRow extends Row {
  distance: number | null;
  indicativeEconomy: number | null;
  hasGap: boolean;
  distanceNegative: boolean;
  isOutlier: boolean;
}

export function FuelInSummary({ trips }: Props) {
  const [showAll, setShowAll] = useState(false);
  const [showIndicative, setShowIndicative] = useState(false);

  const rows: Row[] = useMemo(() => {
    const map = new Map<string, Row>();
    // First pass: aggregate fuel per date
    for (const t of trips) {
      const amt = roundToOneDecimal(t.fuel_pumped_amount ?? 0);
      if (amt <= 0) continue;
      const existing = map.get(t.date);
      if (existing) {
        existing.fuelIn = roundToOneDecimal(existing.fuelIn + amt);
        if (t.fuel_order_no?.trim()) {
          existing.orderNo = existing.orderNo ? `${existing.orderNo}, ${t.fuel_order_no.trim()}` : t.fuel_order_no.trim();
        }
      } else {
        map.set(t.date, { date: t.date, fuelIn: amt, orderNo: t.fuel_order_no?.trim() ?? '', lastKm: 0 });
      }
    }
    // Second pass: compute Last KM per fuel-in date = end_km of last Trip that date (max end_km)
    const lastKmByDate = new Map<string, number>();
    for (const t of trips) {
      const cur = lastKmByDate.get(t.date) ?? Number.NEGATIVE_INFINITY;
      const ek = roundToIntegerKm(t.end_km);
      if (ek > cur) lastKmByDate.set(t.date, ek);
    }
    for (const [date, row] of map.entries()) {
      const lk = lastKmByDate.get(date);
      row.lastKm = lk !== undefined && lk !== Number.NEGATIVE_INFINITY ? lk : 0;
    }
    return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
  }, [trips]);

  const indicativeRows: IndicativeRow[] = useMemo(() => {
    if (rows.length === 0) return [];
    // gaps for ODO discontinuity
    const tripGaps = detectTripGaps(trips).filter(g => g.kind === 'km');
    // Map tripId -> date for gaps is already via g.date (successor date)
    // Ascending order for distance calc
    const asc = [...rows].sort((a, b) => a.date.localeCompare(b.date));
    // Build map date -> index in asc
    const ascIndex = new Map<string, number>();
    asc.forEach((r, idx) => ascIndex.set(r.date, idx));

    // Precompute hasGap per asc index >0 : any gap successor date in (prevDate, currDate]
    const hasGapForAscIdx = new Map<number, boolean>();
    for (let i = 1; i < asc.length; i++) {
      const prevDate = asc[i - 1].date;
      const currDate = asc[i].date;
      const hasGap = tripGaps.some(g => g.date > prevDate && g.date <= currDate);
      hasGapForAscIdx.set(i, hasGap);
    }

    const derived = new Map<string, { distance: number | null; indicativeEconomy: number | null; hasGap: boolean }>();
    for (let i = 0; i < asc.length; i++) {
      const curr = asc[i];
      if (i === 0) {
        derived.set(curr.date, { distance: null, indicativeEconomy: null, hasGap: false });
      } else {
        const prev = asc[i - 1];
        const hasGap = hasGapForAscIdx.get(i) ?? false;
        const distance = roundToIntegerKm(curr.lastKm - prev.lastKm);
        let economy: number | null = null;
        if (!hasGap && curr.fuelIn > 0 && distance > 0) {
          economy = roundToOneDecimal(distance / curr.fuelIn);
        } else if (!hasGap && curr.fuelIn > 0 && distance <= 0) {
          // negative/zero distance: still compute but will be flagged; keep null for economy if distance <=0 to avoid misleading
          // we keep null for zero/negative to show — with warning on distance
          economy = null;
        }
        // If hasGap, economy stays null per spec (insufficient)
        derived.set(curr.date, { distance, indicativeEconomy: hasGap ? null : economy, hasGap });
      }
    }

    // Map back to newest-first order for display
    return rows.map(r => {
      const d = derived.get(r.date)!;
      const isNegative = d.distance !== null && d.distance <= 0;
      const isOutlier = d.indicativeEconomy !== null && (d.indicativeEconomy < 5 || d.indicativeEconomy > 20);
      return {
        ...r,
        distance: d.distance,
        indicativeEconomy: d.indicativeEconomy,
        hasGap: d.hasGap,
        distanceNegative: isNegative,
        isOutlier,
      };
    });
  }, [rows, trips]);

  const visible = rows.slice(0, 10);
  const hasMore = rows.length > 10;

  if (rows.length === 0) return null;

  const hasAtLeastTwo = rows.length >= 2;

  return (
    <>
      <div className="bg-paper-sheet rounded-xl border border-rule-line shadow-sm flex flex-col h-full">
        <div className="p-4 flex items-center justify-between border-b border-rule-line">
          <div>
            <h3 className="text-sm font-bold tracking-tight text-on-surface">Fuel IN Summary</h3>
            <p className="text-xs text-on-surface-variant">Date • Fuel IN (L) • Ref No — newest first</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-on-surface-variant">{rows.length} fuel-ins</span>
            <button
              onClick={() => setShowIndicative(true)}
              data-testid="fuelin-indicative-economy-btn"
              title="Fuel-in distance & indicative economy (full-tank assumption)"
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors"
              aria-label="Fuel-in indicative economy"
            >
              <span aria-hidden>📊</span>
            </button>
          </div>
        </div>
        <div className="overflow-auto max-h-[368px] min-h-[280px] flex-1 scrollbar-thin" style={{ scrollbarWidth: 'thin' }}>
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-paper-gutter z-10">
              <tr className="text-[10px] font-bold tracking-widest uppercase text-on-surface-variant border-b border-rule-line-strong">
                <th className="py-2.5 px-3 border-r border-rule-line">Date</th>
                <th className="py-2.5 px-3 text-right border-r border-rule-line">Fuel IN</th>
                <th className="py-2.5 px-3">Ref No</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rule-line text-sm">
              {visible.map((r) => (
                <tr key={r.date} className="hover:bg-surface-container-low/40">
                  <td className="py-2 px-3 font-mono text-xs whitespace-nowrap">{formatDdMmYyyy(r.date)}</td>
                  <td className="py-2 px-3 text-right font-mono text-xs font-bold">{r.fuelIn.toFixed(1)} L</td>
                  <td className="py-2 px-3 text-xs font-mono truncate max-w-[200px]" title={r.orderNo}>{r.orderNo || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {hasMore && (
          <div className="p-3 border-t border-rule-line flex justify-center">
            <button onClick={() => setShowAll(true)} className="px-4 py-1.5 bg-slate-surface text-on-primary rounded-lg text-xs font-semibold hover:bg-primary transition-colors">+ MORE ({rows.length - 10} more)</button>
          </div>
        )}
      </div>
      {showAll && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowAll(false)}>
          <div className="bg-paper-sheet rounded-xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 flex items-center justify-between border-b border-rule-line">
              <h3 className="text-sm font-bold text-on-surface">All Fuel INs — {rows.length} records</h3>
              <button onClick={() => setShowAll(false)} className="text-on-surface-variant hover:text-on-surface">✕</button>
            </div>
            <div className="overflow-auto flex-1">
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 bg-paper-gutter z-10">
                  <tr className="text-[10px] font-bold tracking-widest uppercase text-on-surface-variant border-b border-rule-line-strong">
                    <th className="py-2.5 px-3 border-r border-rule-line">#</th>
                    <th className="py-2.5 px-3 border-r border-rule-line">Date</th>
                    <th className="py-2.5 px-3 text-right border-r border-rule-line">Fuel IN</th>
                    <th className="py-2.5 px-3">Ref No</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rule-line text-sm">
                  {rows.map((r, idx) => (
                    <tr key={r.date} className={idx % 2 === 0 ? 'bg-white' : 'bg-blue-50/30'}>
                      <td className="py-2 px-3 font-mono text-xs">{idx + 1}</td>
                      <td className="py-2 px-3 font-mono text-xs">{formatDdMmYyyy(r.date)}</td>
                      <td className="py-2 px-3 text-right font-mono text-xs font-bold">{r.fuelIn.toFixed(1)} L</td>
                      <td className="py-2 px-3 text-xs font-mono" title={r.orderNo}>{r.orderNo || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="p-3 border-t border-rule-line flex justify-end">
              <button onClick={() => setShowAll(false)} className="px-4 py-2 bg-slate-surface text-on-primary rounded-lg text-sm font-semibold">Close</button>
            </div>
          </div>
        </div>
      )}
      {showIndicative && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowIndicative(false)}>
          <div className="bg-paper-sheet rounded-xl shadow-xl w-full max-w-5xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 flex items-center justify-between border-b border-rule-line gap-3">
              <div>
                <h3 className="text-sm font-bold text-on-surface flex items-center gap-2">⛽ Fuel-In Indicative Economy <span className="text-xs font-normal text-on-surface-variant">— {rows.length} fuel-ins</span></h3>
                <p className="text-xs text-on-surface-variant">Full-tank assumption • newest first</p>
              </div>
              <button onClick={() => setShowIndicative(false)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-on-surface-variant hover:text-on-surface shrink-0">✕</button>
            </div>

            {/* AMBER disclaimer banner */}
            <div className="mx-4 mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 flex gap-2.5 items-start">
              <span className="text-amber-600 mt-0.5 shrink-0">⚠️</span>
              <p className="text-xs leading-relaxed text-amber-900">
                <span className="font-bold">Indicative only</span> — assumes each fuel-in was a full tank. Accurate only for <span className="font-semibold">Full tank → Full tank</span> cycles. Use to detect abnormalities or data entry mistakes.
              </p>
            </div>

            <div className="overflow-auto flex-1 p-4">
              {!hasAtLeastTwo ? (
                <div className="border border-dashed border-slate-300 rounded-lg p-6 text-center flex flex-col items-center gap-2">
                  <p className="text-sm font-semibold text-slate-700">Insufficient data to calculate economy</p>
                  <p className="text-xs text-slate-500">Need at least 2 fuel-in dates. Current: {rows.length} fuel-in{rows.length === 1 ? '' : 's'}.</p>
                  <p className="text-xs text-slate-400">Add another fuel-in to see distance between fuel-ins.</p>
                </div>
              ) : (
                <table className="w-full text-left border-collapse" data-testid="fuelin-indicative-table">
                  <thead className="sticky top-0 bg-paper-gutter z-10">
                    <tr className="text-[10px] font-bold tracking-widest uppercase text-on-surface-variant border-b border-rule-line-strong">
                      <th className="py-2.5 px-2 border-r border-rule-line w-10">#</th>
                      <th className="py-2.5 px-2 border-r border-rule-line">Date</th>
                      <th className="py-2.5 px-2 text-right border-r border-rule-line">Last KM</th>
                      <th className="py-2.5 px-2 text-right border-r border-rule-line">Fuel IN (L)</th>
                      <th className="py-2.5 px-2 text-right border-r border-rule-line">Distance Since Last (km)</th>
                      <th className="py-2.5 px-2 text-right border-r border-rule-line">Indicative Economy (km/L)</th>
                      <th className="py-2.5 px-2">Ref No</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-rule-line text-sm">
                    {indicativeRows.map((r, idx) => {
                      const isFirst = idx === indicativeRows.length - 1;
                      // indicativeRows is newest-first, so last element is earliest (no prior)
                      return (
                        <tr key={r.date} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}>
                          <td className="py-2 px-2 font-mono text-xs">{idx + 1}</td>
                          <td className="py-2 px-2 font-mono text-xs whitespace-nowrap">{formatDdMmYyyy(r.date)}</td>
                          <td className="py-2 px-2 text-right font-mono text-xs font-semibold">{r.lastKm.toLocaleString('en-US')} km</td>
                          <td className="py-2 px-2 text-right font-mono text-xs font-bold">{r.fuelIn.toFixed(1)} L</td>
                          <td className={`py-2 px-2 text-right font-mono text-xs ${r.hasGap ? 'bg-amber-100 text-amber-800' : r.distanceNegative ? 'bg-red-100 text-red-700 font-bold' : ''}`} title={r.hasGap ? 'Insufficient — ODO gap between fuel-ins' : r.distanceNegative && r.distance !== null ? 'Check odometer order — end_km should increase' : undefined}>
                            {r.distance === null ? (
                              <span className="text-slate-400">—</span>
                            ) : r.hasGap ? (
                              <span className="inline-flex items-center gap-1">— <span className="text-[10px]">⚠️ gap</span></span>
                            ) : r.distanceNegative ? (
                              <span>⚠️ {r.distance} km</span>
                            ) : (
                              `${r.distance.toLocaleString('en-US')} km`
                            )}
                          </td>
                          <td className={`py-2 px-2 text-right font-mono text-xs font-bold ${r.hasGap || r.indicativeEconomy === null ? 'text-slate-400' : r.isOutlier ? 'bg-amber-100 text-amber-800' : 'text-emerald-700'}`} title={r.hasGap ? 'Insufficient — ODO gap between fuel-ins' : r.indicativeEconomy === null && !isFirst ? 'Insufficient data to calculate economy' : r.isOutlier ? 'Outside 5–20 km/L — check for abnormality/mistake' : undefined}>
                            {r.indicativeEconomy === null ? (
                              <span className="font-normal">{r.hasGap ? '—' : '—'}</span>
                            ) : (
                              <span className={r.isOutlier ? 'inline-flex items-center gap-1' : ''}>
                                {r.indicativeEconomy.toFixed(1)} {r.isOutlier && <span>⚠️</span>}
                              </span>
                            )}
                            {r.hasGap && <span className="sr-only"> Insufficient — ODO gap</span>}
                          </td>
                          <td className="py-2 px-2 text-xs font-mono truncate max-w-[160px]" title={r.orderNo}>{r.orderNo || '-'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            <div className="px-4 pb-3 flex flex-col gap-2">
              <p className="text-[11px] text-slate-500 flex items-center gap-1.5">ℹ️ Assumes one fuel-in per day — same-day multiple pumps are summed to one row. Distance = LastKM(current) − LastKM(previous); Economy = Distance / FuelIN(current).</p>
              <div className="flex items-center justify-between border-t border-rule-line pt-3">
                <span className="text-xs text-slate-500">AMBER = outside 5–20 km/L or ODO gap; RED = zero/negative distance.</span>
                <button onClick={() => setShowIndicative(false)} className="px-4 py-2 bg-slate-surface text-on-primary rounded-lg text-sm font-semibold">Close</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
