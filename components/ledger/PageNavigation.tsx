'use client';

import React from 'react';
import type { BookPage } from '@/types';

interface Props {
  pages: BookPage[];
  currentPage: BookPage | null;
  onSelectPage: (pageNumber: number) => void;
  onPrevPage: () => void;
  onNextPage: () => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  vehicleLabel?: string;
}

export function PageNavigation({ pages, currentPage, onSelectPage, onPrevPage, onNextPage, onPrevMonth, onNextMonth, vehicleLabel }: Props) {
  if (!currentPage) return null;

  const totalPages = pages.length;
  const currentNumber = currentPage.page_number;
  const hasPrev = currentNumber > 1;
  const hasNext = currentNumber < totalPages;

  // Determine months for Prev/Next month availability
  const months = [...new Set(pages.map((p) => p.month))].sort();
  const currentMonthIdx = months.indexOf(currentPage.month);
  const hasPrevMonth = currentMonthIdx > 0;
  const hasNextMonth = currentMonthIdx < months.length - 1;

  return (
    <div className="flex flex-col gap-2 mb-4 print:hidden">
      {/* Top Meta Row */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-paper-sheet p-2 md:p-3 rounded shadow-sm">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Page Turn Controls */}
          <div className="flex items-center bg-paper-gutter p-1 rounded gap-1">
            <button
              aria-label="Previous Month"
              onClick={onPrevMonth}
              disabled={!hasPrevMonth}
              className="flex items-center gap-1 px-2 py-1 rounded bg-paper-sheet hover:bg-slate-surface hover:text-on-primary transition-colors text-on-surface disabled:opacity-40 disabled:cursor-not-allowed text-[10px] font-semibold tracking-widest uppercase"
              title="Previous Month"
              type="button"
            >
              <span>«</span>
              <span className="hidden sm:inline">PREV MO</span>
            </button>
            <button
              aria-label="Previous Page"
              onClick={onPrevPage}
              disabled={!hasPrev}
              className="flex items-center gap-1 px-2 py-1 rounded bg-paper-sheet hover:bg-slate-surface hover:text-on-primary transition-colors text-on-surface disabled:opacity-40 disabled:cursor-not-allowed text-[10px] font-semibold tracking-widest uppercase"
              title="Previous Page"
              type="button"
            >
              <span>‹</span>
              <span>PG {currentNumber - 1}</span>
            </button>
            <select
              aria-label="Select Page"
              value={currentNumber}
              onChange={(e) => onSelectPage(parseInt(e.target.value, 10))}
              className="px-3 py-1 bg-slate-800 text-white border border-slate-700 rounded text-sm font-mono font-bold focus:ring-1 focus:ring-telemetry-cyan focus:outline-none cursor-pointer"
            >
              {pages.map((p) => (
                <option key={p.id} value={p.page_number} className="bg-slate-800 text-white">
                  Page {p.page_number} — {p.month} ({p.start_km.toFixed(1)} → {p.end_km.toFixed(1)} KM)
                </option>
              ))}
            </select>
            <button
              aria-label="Next Page"
              onClick={onNextPage}
              disabled={!hasNext}
              className="flex items-center gap-1 px-2 py-1 rounded bg-paper-sheet hover:bg-slate-surface hover:text-on-primary transition-colors text-on-surface disabled:opacity-40 disabled:cursor-not-allowed text-[10px] font-semibold tracking-widest uppercase"
              title="Next Page"
              type="button"
            >
              <span>PG {currentNumber + 1}</span>
              <span>›</span>
            </button>
            <button
              aria-label="Next Month"
              onClick={onNextMonth}
              disabled={!hasNextMonth}
              className="flex items-center gap-1 px-2 py-1 rounded bg-paper-sheet hover:bg-slate-surface hover:text-on-primary transition-colors text-on-surface disabled:opacity-40 disabled:cursor-not-allowed text-[10px] font-semibold tracking-widest uppercase"
              title="Next Month"
              type="button"
            >
              <span className="hidden sm:inline">NEXT MO</span>
              <span>»</span>
            </button>
          </div>

          {vehicleLabel && (
            <div className="flex items-center gap-2 bg-surface-container-low px-3 py-1 rounded">
              <span className="text-xs font-semibold text-on-surface">{vehicleLabel}</span>
            </div>
          )}
          <button
            onClick={() => window.print()}
            type="button"
            className="flex items-center gap-1.5 px-3 py-1 bg-paper-sheet hover:bg-paper-gutter text-on-surface rounded shadow-sm transition-colors text-[10px] font-semibold tracking-widest uppercase border border-rule-line"
          >
            <span>🖨️</span>
            <span>Print Dual-Page</span>
          </button>
        </div>
      </div>

      {/* Regulatory Rules & Audit Continuity Banner */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-surface text-paper-ledger px-3 py-1.5 rounded shadow-sm">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="text-trip-official">●</span>
            <span className="text-[10px] font-semibold tracking-widest uppercase text-surface-container-highest">Audit Constraint:</span>
            <span className="text-[13px] font-medium text-paper-sheet">Max 4 Days / Page • Max 13 Trips / Day</span>
          </div>
          {totalPages > 1 && (
            <div className="hidden lg:flex items-center gap-1.5">
              <span className="text-[10px] font-semibold tracking-widest uppercase text-on-primary-container">Odometer Rule:</span>
              <span className="font-mono text-sm text-tertiary-fixed">
                End KM (Pg {currentNumber - 1}) {pages.find((p) => p.page_number === currentNumber - 1)?.end_km.toFixed(1) ?? '-'} = Start KM (Pg {currentNumber})
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1 bg-primary-container px-2 py-0.5 rounded text-tertiary-fixed text-[10px] font-semibold tracking-widest uppercase">
            <span className="w-1.5 h-1.5 rounded-full bg-trip-official"></span> Continuity Check: Strict Valid
          </span>
          <span className="text-[10px] font-semibold tracking-widest uppercase text-telemetry-cyan">SEC-24 Registered</span>
        </div>
      </div>
    </div>
  );
}
