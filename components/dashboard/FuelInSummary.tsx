'use client';

import React, { useMemo, useState } from 'react';
import type { Trip } from '@/types';
import { roundToOneDecimal, roundToIntegerKm } from '@/lib/tripCalculations';

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
}

export function FuelInSummary({ trips }: Props) {
  const [showAll, setShowAll] = useState(false);
  const rows: Row[] = useMemo(() => {
    const map = new Map<string, Row>();
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
        map.set(t.date, { date: t.date, fuelIn: amt, orderNo: t.fuel_order_no?.trim() ?? '' });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
  }, [trips]);

  const visible = rows.slice(0, 10);
  const hasMore = rows.length > 10;

  if (rows.length === 0) return null;

  return (
    <>
      <div className="bg-paper-sheet rounded-xl border border-rule-line shadow-sm flex flex-col h-full">
        <div className="p-4 flex items-center justify-between border-b border-rule-line">
          <div>
            <h3 className="text-sm font-bold tracking-tight text-on-surface">Fuel IN Summary</h3>
            <p className="text-xs text-on-surface-variant">Date • Fuel IN (L) • Ref No — newest first</p>
          </div>
          <span className="text-xs font-mono text-on-surface-variant">{rows.length} fuel-ins</span>
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
    </>
  );
}
