'use client';

import React, { useState } from 'react';
import type { MonthlyBreakdown } from '@/lib/dashboardCalculations';
import { getLast12MonthlyBreakdown } from '@/lib/dashboardCalculations';

interface Props {
  data: MonthlyBreakdown[];
}

export function MonthlyBreakdownChart({ data }: Props) {
  const [showAll, setShowAll] = useState(false);

  if (data.length === 0) {
    return (
      <div className="bg-paper-sheet rounded-xl border border-rule-line p-6 text-center">
        <p className="text-sm text-on-surface-variant">No monthly data yet. Add trips to see breakdown.</p>
      </div>
    );
  }

  // Latest 6 months, latest on top
  const latest6 = data.length > 6 ? data.slice(-6).reverse() : [...data].reverse();
  const displayed = latest6;
  const maxTotal = Math.max(...displayed.map((d) => d.totalKm), 1);
  const hasMore = data.length > 6;

  return (
    <div className="bg-paper-sheet rounded-xl border border-rule-line shadow-sm p-4 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold tracking-tight text-on-surface">Monthly Breakdown</h3>
        <span className="text-[10px] font-semibold tracking-widest uppercase text-on-surface-variant">
          Official vs Private (KM) • {hasMore ? `Last 12 of ${data.length}` : `${data.length} months`}
        </span>
      </div>

      <div className="flex flex-col gap-3">
        {displayed.map((m) => {
          const officialWidth = m.totalKm > 0 ? (m.officialKm / m.totalKm) * 100 : 0;
          const privateWidth = m.totalKm > 0 ? (m.privateKm / m.totalKm) * 100 : 0;
          const barWidth = (m.totalKm / maxTotal) * 100;
          return (
            <div key={m.monthKey} data-testid={`monthly-row-${m.monthKey}`} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-on-surface">{m.monthLabel}</span>
                <span className="text-[11px] font-mono font-semibold text-on-surface-variant">
                  {Math.round(m.totalKm)} KM • {m.tripCount} trips • {m.pageCount} pages
                </span>
              </div>
              <div className="w-full h-5 bg-paper-gutter rounded-full overflow-hidden flex" style={{ width: `${Math.max(20, barWidth)}%` }}>
                {m.officialKm > 0 && (
                  <div className="h-full bg-trip-official flex items-center justify-center" style={{ width: `${officialWidth}%` }} title={`Official ${Math.round(m.officialKm)} KM`}>
                    {officialWidth > 18 && <span className="text-[9px] font-bold text-white tracking-widest">OFF {Math.round(m.officialKm)}</span>}
                  </div>
                )}
                {m.privateKm > 0 && (
                  <div className="h-full bg-trip-private flex items-center justify-center" style={{ width: `${privateWidth}%` }} title={`Private ${Math.round(m.privateKm)} KM`}>
                    {privateWidth > 18 && <span className="text-[9px] font-bold text-white tracking-widest">PRIV {Math.round(m.privateKm)}</span>}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-3 text-[10px] font-semibold tracking-widest uppercase text-on-surface-variant">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-trip-official inline-block" /> Off {Math.round(m.officialKm)}</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-trip-private inline-block" /> Priv {Math.round(m.privateKm)}</span>
                {m.fuelDrawn > 0 && <span className="ml-auto text-trip-official">+{m.fuelDrawn.toFixed(1)} L drawn</span>}
              </div>
            </div>
          );
        })}
      </div>

      {hasMore && (
        <button
          data-testid="more-monthly-button"
          onClick={() => setShowAll(true)}
          className="self-center px-4 py-1.5 bg-amber-500 text-white border border-amber-500 rounded-lg text-xs font-semibold hover:bg-amber-600 shadow-sm"
        >
          More ({data.length} months) →
        </button>
      )}

      {/* Table fallback for precise values — last 12 */}
      <div className="overflow-x-auto border border-rule-line rounded-lg">
        <table className="w-full text-left text-[13px]">
          <thead className="sticky top-0">
            <tr className="bg-paper-gutter text-on-surface-variant text-[11px] font-bold tracking-widest uppercase border-b border-rule-line-strong">
              <th className="py-2 px-3 border-r border-rule-line">Month</th>
              <th className="py-2 px-3 text-right border-r border-rule-line">Official</th>
              <th className="py-2 px-3 text-right border-r border-rule-line">Private</th>
              <th className="py-2 px-3 text-right border-r border-rule-line">Total</th>
              <th className="py-2 px-3 text-right border-r border-rule-line">Trips</th>
              <th className="py-2 px-3 text-right">Fuel Drawn</th>
            </tr>
          </thead>
          <tbody className="font-mono text-on-surface divide-y divide-rule-line">
            {displayed.map((m) => (
              <tr key={`tbl-${m.monthKey}`} className="hover:bg-paper-ledger">
                <td className="py-2 px-3 font-semibold border-r border-rule-line">{m.monthLabel}</td>
                <td className="py-2 px-3 text-right text-trip-official font-bold border-r border-rule-line">{Math.round(m.officialKm)}</td>
                <td className="py-2 px-3 text-right text-trip-private font-bold border-r border-rule-line">{Math.round(m.privateKm)}</td>
                <td className="py-2 px-3 text-right font-bold border-r border-rule-line">{Math.round(m.totalKm)}</td>
                <td className="py-2 px-3 text-right border-r border-rule-line">{m.tripCount}</td>
                <td className="py-2 px-3 text-right">{m.fuelDrawn.toFixed(1)} L</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* More modal — full history */}
      {showAll && (
        <div
          data-testid="monthly-more-modal"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setShowAll(false)}
          role="dialog"
          aria-modal="true"
          aria-label="All months breakdown"
        >
          <div
            className="bg-paper-sheet rounded-xl border border-rule-line shadow-lg w-full max-w-3xl max-h-[70vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-rule-line bg-paper-gutter sticky top-0">
              <h4 className="text-sm font-bold text-on-surface">All Months ({data.length})</h4>
              <button
                data-testid="monthly-modal-close"
                onClick={() => setShowAll(false)}
                className="px-3 py-1 text-xs font-semibold border border-rule-line rounded-lg hover:bg-paper-sheet"
                aria-label="Close monthly modal"
              >
                Close
              </button>
            </div>
            <div className="overflow-auto flex-1">
              <table className="w-full text-left text-[13px]">
                <thead className="sticky top-0 z-10 bg-paper-gutter">
                  <tr className="text-on-surface-variant text-[11px] font-bold tracking-widest uppercase border-b border-rule-line-strong">
                    <th className="py-2 px-3 whitespace-nowrap border-r border-rule-line">Month</th>
                    <th className="py-2 px-3 text-right whitespace-nowrap border-r border-rule-line">Official</th>
                    <th className="py-2 px-3 text-right whitespace-nowrap border-r border-rule-line">Private</th>
                    <th className="py-2 px-3 text-right whitespace-nowrap border-r border-rule-line">Total</th>
                    <th className="py-2 px-3 text-right whitespace-nowrap border-r border-rule-line">Trips</th>
                    <th className="py-2 px-3 text-right whitespace-nowrap">Fuel Drawn</th>
                  </tr>
                </thead>
                <tbody className="font-mono text-on-surface divide-y divide-rule-line">
                  {data.map((m) => (
                    <tr key={`modal-${m.monthKey}`} data-testid={`monthly-modal-row-${m.monthKey}`} className="hover:bg-paper-ledger">
                      <td className="py-2 px-3 font-semibold border-r border-rule-line">{m.monthLabel}</td>
                      <td className="py-2 px-3 text-right text-trip-official font-bold border-r border-rule-line">{Math.round(m.officialKm)}</td>
                      <td className="py-2 px-3 text-right text-trip-private font-bold border-r border-rule-line">{Math.round(m.privateKm)}</td>
                      <td className="py-2 px-3 text-right font-bold border-r border-rule-line">{Math.round(m.totalKm)}</td>
                      <td className="py-2 px-3 text-right border-r border-rule-line">{m.tripCount}</td>
                      <td className="py-2 px-3 text-right">{m.fuelDrawn.toFixed(1)} L</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
