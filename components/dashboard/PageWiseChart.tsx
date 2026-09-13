'use client';

import React, { useState } from 'react';
import type { PageDistance } from '@/lib/dashboardCalculations';
import { getLast12PageDistances } from '@/lib/dashboardCalculations';

interface Props {
  data: PageDistance[];
}

export function PageWiseChart({ data }: Props) {
  const [showAll, setShowAll] = useState(false);

  if (data.length === 0) {
    return (
      <div className="bg-paper-sheet rounded-xl border border-rule-line p-6 text-center">
        <p className="text-sm text-on-surface-variant">No pages yet. Distance per page will appear here.</p>
      </div>
    );
  }

  // Latest 6 pages, latest on top for consistency (colorful More button)
  const displayed = data.length > 6 ? [...data.slice(-6)].reverse() : [...data].reverse();
  const maxDistance = Math.max(...displayed.map((d) => d.distance), 1);
  const hasMore = data.length > 6;

  return (
    <div className="bg-paper-sheet rounded-xl border border-rule-line shadow-sm p-4 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold tracking-tight text-on-surface">Page-wise Distance Visualization</h3>
        <span className="text-[10px] font-semibold tracking-widest uppercase text-on-surface-variant">
          {hasMore ? `Last 12 of ${data.length}` : `${data.length} pages`}
        </span>
      </div>

      <div className="flex items-end gap-1.5 h-40 px-1 overflow-x-auto">
        {displayed.map((p) => {
          const heightPct = (p.distance / maxDistance) * 100;
          return (
            <div key={p.pageNumber} data-testid={`page-bar-${p.pageNumber}`} className="flex flex-col items-center gap-1 min-w-[40px] flex-1">
              <span className="text-[10px] font-mono font-bold text-on-surface">{Math.round(p.distance)}</span>
              <div className="w-full flex flex-col justify-end items-center gap-0" style={{ height: '100px' }}>
                <div
                  className="w-full rounded-t bg-slate-surface flex flex-col overflow-hidden"
                  style={{ height: `${Math.max(6, heightPct)}%` }}
                  title={`Page ${p.pageNumber} • ${p.monthLabel} • Total ${Math.round(p.distance)} KM (Off ${Math.round(p.officialKm)} / Priv ${Math.round(p.privateKm)}) • ${p.tripCount} trips`}
                >
                  {p.privateKm > 0 && p.distance > 0 && (
                    <div className="w-full bg-trip-private" style={{ height: `${(p.privateKm / p.distance) * 100}%` }} />
                  )}
                  {p.officialKm > 0 && p.distance > 0 && (
                    <div className="w-full bg-trip-official flex-1" />
                  )}
                  {p.distance === 0 && <div className="w-full h-full bg-paper-gutter border border-dashed border-rule-line" />}
                </div>
              </div>
              <span className="text-[10px] font-bold text-on-surface">P{p.pageNumber}</span>
              <span className="text-[9px] font-semibold tracking-widest uppercase text-on-surface-variant">{p.monthLabel}</span>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-4 justify-center text-[10px] font-semibold tracking-widest uppercase text-on-surface-variant">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-trip-official inline-block" /> Official</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-trip-private inline-block" /> Private</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-slate-surface inline-block" /> Total stacked</span>
      </div>

      {hasMore && (
        <button
          data-testid="more-pagewise-button"
          onClick={() => setShowAll(true)}
          className="self-center px-4 py-1.5 bg-amber-500 text-white border border-amber-500 rounded-lg text-xs font-semibold hover:bg-amber-600 shadow-sm"
        >
          More ({data.length} pages) →
        </button>
      )}

      <div className="overflow-x-auto border border-rule-line rounded-lg">
        <table className="w-full text-left text-[13px]">
          <thead className="sticky top-0">
            <tr className="bg-paper-gutter text-on-surface-variant text-[11px] font-bold tracking-widest uppercase border-b border-rule-line-strong">
              <th className="py-2 px-3 whitespace-nowrap border-r border-rule-line">Page</th>
              <th className="py-2 px-3 whitespace-nowrap border-r border-rule-line">Month</th>
              <th className="py-2 px-3 text-right whitespace-nowrap border-r border-rule-line">Distance</th>
              <th className="py-2 px-3 text-right whitespace-nowrap border-r border-rule-line">Official</th>
              <th className="py-2 px-3 text-right whitespace-nowrap border-r border-rule-line">Private</th>
              <th className="py-2 px-3 text-right whitespace-nowrap">Trips</th>
            </tr>
          </thead>
          <tbody className="font-mono text-on-surface divide-y divide-rule-line">
            {displayed.map((p) => (
              <tr key={`tbl-p-${p.pageNumber}`} className="hover:bg-paper-ledger">
                <td className="py-2 px-3 font-bold border-r border-rule-line">P{p.pageNumber}</td>
                <td className="py-2 px-3 border-r border-rule-line">{p.monthLabel}</td>
                <td className="py-2 px-3 text-right font-bold border-r border-rule-line">{Math.round(p.distance)}</td>
                <td className="py-2 px-3 text-right text-trip-official border-r border-rule-line">{Math.round(p.officialKm)}</td>
                <td className="py-2 px-3 text-right text-trip-private border-r border-rule-line">{Math.round(p.privateKm)}</td>
                <td className="py-2 px-3 text-right">{p.tripCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showAll && (
        <div
          data-testid="pagewise-more-modal"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setShowAll(false)}
          role="dialog"
          aria-modal="true"
          aria-label="All pages breakdown"
        >
          <div
            className="bg-paper-sheet rounded-xl border border-rule-line shadow-lg w-full max-w-3xl max-h-[70vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-rule-line bg-paper-gutter sticky top-0">
              <h4 className="text-sm font-bold text-on-surface">All Pages ({data.length})</h4>
              <button
                data-testid="pagewise-modal-close"
                onClick={() => setShowAll(false)}
                className="px-3 py-1 text-xs font-semibold border border-rule-line rounded-lg hover:bg-paper-sheet"
                aria-label="Close pagewise modal"
              >
                Close
              </button>
            </div>
            <div className="overflow-auto flex-1">
              <table className="w-full text-left text-[13px]">
                <thead className="sticky top-0 z-10 bg-paper-gutter">
                  <tr className="text-on-surface-variant text-[11px] font-bold tracking-widest uppercase border-b border-rule-line-strong">
                    <th className="py-2 px-3 whitespace-nowrap border-r border-rule-line">Page</th>
                    <th className="py-2 px-3 whitespace-nowrap border-r border-rule-line">Month</th>
                    <th className="py-2 px-3 text-right whitespace-nowrap border-r border-rule-line">Distance</th>
                    <th className="py-2 px-3 text-right whitespace-nowrap border-r border-rule-line">Official</th>
                    <th className="py-2 px-3 text-right whitespace-nowrap border-r border-rule-line">Private</th>
                    <th className="py-2 px-3 text-right whitespace-nowrap">Trips</th>
                  </tr>
                </thead>
                <tbody className="font-mono text-on-surface divide-y divide-rule-line">
                  {data.map((p) => (
                    <tr key={`modal-p-${p.pageNumber}`} data-testid={`pagewise-modal-row-${p.pageNumber}`} className="hover:bg-paper-ledger">
                      <td className="py-2 px-3 font-bold border-r border-rule-line">P{p.pageNumber}</td>
                      <td className="py-2 px-3 border-r border-rule-line">{p.monthLabel}</td>
                      <td className="py-2 px-3 text-right font-bold border-r border-rule-line">{Math.round(p.distance)}</td>
                      <td className="py-2 px-3 text-right text-trip-official border-r border-rule-line">{Math.round(p.officialKm)}</td>
                      <td className="py-2 px-3 text-right text-trip-private border-r border-rule-line">{Math.round(p.privateKm)}</td>
                      <td className="py-2 px-3 text-right">{p.tripCount}</td>
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
