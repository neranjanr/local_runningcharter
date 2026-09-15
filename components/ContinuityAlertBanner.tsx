'use client';

import React, { useMemo } from 'react';
import type { BookPage, Trip } from '@/types';
import { detectPageGaps, detectTripGaps } from '@/lib/continuityAlerts';
import { computeGlobalSeq } from '@/lib/ledgerCalculations';
import Link from 'next/link';

interface Props {
  pages: BookPage[];
  trips: Trip[];
  compact?: boolean;
}

export function ContinuityAlertBanner({ pages, trips, compact = false }: Props) {
  const pageGaps = useMemo(() => detectPageGaps(pages), [pages]);
  const tripGaps = useMemo(() => detectTripGaps(trips), [trips]);

  const kmGapsCount = pageGaps.filter((g) => g.kind === 'km').length + tripGaps.filter((g) => g.kind === 'km').length;
  const fuelGapsCount = pageGaps.filter((g) => g.kind === 'fuel').length + tripGaps.filter((g) => g.kind === 'fuel').length;

  if (pageGaps.length === 0 && tripGaps.length === 0) {
    return null;
  }

  if (compact) {
    return (
      <div data-testid="continuity-alert-banner" className="bg-amber-50 dark:bg-amber-950/30 border-2 border-amber-400 dark:border-amber-600 rounded-xl p-4 shadow-md flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl">⚠️</span>
          <div>
            <h2 className="text-sm font-bold text-amber-900 dark:text-amber-200 tracking-tight">
              Continuity Gaps Detected ({kmGapsCount} KM Gaps · {fuelGapsCount} Fuel Gaps)
            </h2>
            <p className="text-xs text-amber-700 dark:text-amber-300">
              Odometer or fuel discrepancies found. Click to inspect in All Trips.
            </p>
          </div>
        </div>
        <Link
          href="/trips"
          className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors"
          data-testid="view-all-trips-btn"
        >
          View All Trips
        </Link>
      </div>
    );
  }

  const globalSeq = useMemo(() => computeGlobalSeq(trips), [trips]);
  const tripsById = useMemo(() => new Map(trips.map((t) => [t.id, t])), [trips]);
  const pageById = useMemo(() => new Map(pages.map((p) => [p.id, p])), [pages]);
  const sortedTrips = useMemo(() => [...trips].sort((a, b) => a.date.localeCompare(b.date) || a.start_km - b.start_km), [trips]);

  function findNearestTripByOdo(targetOdo: number): Trip | null {
    if (sortedTrips.length === 0) return null;
    let best: Trip | null = null;
    let bestDiff = Infinity;
    for (const t of sortedTrips) {
      const d = Math.abs(t.start_km - targetOdo);
      if (d < bestDiff) { bestDiff = d; best = t; }
    }
    return best;
  }

  return (
    <div data-testid="continuity-alert-banner" className="bg-amber-50 dark:bg-amber-950/30 border-2 border-amber-400 dark:border-amber-600 rounded-xl p-4 shadow-md flex flex-col gap-3 print:hidden">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl">⚠️</span>
          <div>
            <h2 className="text-sm font-bold text-amber-900 dark:text-amber-200 tracking-tight">
              Continuity Gaps Detected ({kmGapsCount} KM Gaps · {fuelGapsCount} Fuel Gaps)
            </h2>
            <p className="text-xs text-amber-700 dark:text-amber-300">
              Odometer (RED) and Fuel (AMBER) discrepancies found across pages or trips. Persistent until corrected.
            </p>
          </div>
        </div>
      </div>

      <div className="max-h-40 overflow-y-auto divide-y divide-amber-200/60 dark:divide-amber-800/40 border-t border-amber-200 dark:border-amber-800/50 pt-2 text-xs">
        {pageGaps.map((g, idx) => {
          const page = pages.find((p) => p.page_number === g.pageNumber);
          const tripsOnPage = page ? sortedTrips.filter((t) => t.page_id === page.id).sort((a, b) => a.start_km - b.start_km) : [];
          let target: Trip | null = tripsOnPage[0] ?? null;
          if (!target) target = findNearestTripByOdo(g.actual);
          const seq = target ? globalSeq.get(target.id) : undefined;
          return (
          <div key={`pg-${idx}`} className="py-1.5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${g.kind === 'km' ? 'bg-red-600' : 'bg-amber-600'}`}></span>
              <span className="font-medium text-on-surface">Page {g.pageNumber} ({g.kind.toUpperCase()} Gap):</span>
              <span className="text-on-surface-variant">{g.message}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-mono font-bold text-on-surface">Expected: {g.expected} | Actual: {g.actual}</span>
              <Link
                href={`/ledger?page=${g.pageNumber}`}
                className="px-2 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded text-[10px] font-semibold shadow-sm transition-colors"
                data-testid={`jump-to-page-${g.pageNumber}`}
              >
                Jump to page {g.pageNumber}
              </Link>
              {target && seq && (
                <Link
                  href={`/trips?focus=${target.id}`}
                  className="px-2 py-1 bg-slate-800 hover:bg-slate-900 text-white rounded text-[10px] font-semibold shadow-sm transition-colors"
                  data-testid={`goto-record-${seq}`}
                >
                  Goto Record {seq}
                </Link>
              )}
            </div>
          </div>
          );
        })}
        {tripGaps.map((g, idx) => {
          let target: Trip | null = g.tripId ? tripsById.get(g.tripId) ?? null : null;
          if (!target) target = findNearestTripByOdo(g.actual);
          const seq = target ? globalSeq.get(target.id) : undefined;
          const pageNumber = target ? pageById.get(target.page_id)?.page_number : undefined;
          return (
          <div key={`tg-${idx}`} className="py-1.5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${g.kind === 'km' ? 'bg-red-600' : 'bg-amber-600'}`}></span>
              <span className="font-medium text-on-surface">Trip on {g.date} ({g.kind.toUpperCase()} Gap):</span>
              <span className="text-on-surface-variant">{g.message}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-mono font-bold text-on-surface">Expected: {g.expected} | Actual: {g.actual}</span>
              {pageNumber && (
                <Link
                  href={`/ledger?page=${pageNumber}`}
                  className="px-2 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded text-[10px] font-semibold shadow-sm transition-colors"
                  data-testid={`jump-to-page-${pageNumber}`}
                >
                  Jump to page {pageNumber}
                </Link>
              )}
              {target && seq && (
                <Link
                  href={`/trips?focus=${target.id}`}
                  className="px-2 py-1 bg-slate-800 hover:bg-slate-900 text-white rounded text-[10px] font-semibold shadow-sm transition-colors"
                  data-testid={`goto-record-${seq}`}
                >
                  Goto Record {seq}
                </Link>
              )}
            </div>
          </div>
          );
        })}
      </div>
    </div>
  );
}
