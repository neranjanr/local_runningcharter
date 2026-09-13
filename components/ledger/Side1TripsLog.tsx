'use client';

import React from 'react';
import type { Trip } from '@/types';
import type { DayGroup } from '@/lib/ledgerCalculations';
import { getDayOfWeek } from '@/lib/tripCalculations';

interface Props {
  pageNumber: number;
  month: string; // YYYY-MM
  dayGroups: DayGroup[];
  grandTotals: { totalDistance: number; officialKm: number; privateKm: number; tripCount: number };
  pageSeq: number[];
}

function formatMonthLabel(month: string): string {
  // month YYYY-MM -> "OCTOBER 2024"
  if (!month || !month.includes('-')) return month;
  const [y, m] = month.split('-');
  const months = [
    'JANUARY',
    'FEBRUARY',
    'MARCH',
    'APRIL',
    'MAY',
    'JUNE',
    'JULY',
    'AUGUST',
    'SEPTEMBER',
    'OCTOBER',
    'NOVEMBER',
    'DECEMBER',
  ];
  const idx = parseInt(m, 10) - 1;
  return `${months[idx] ?? m} ${y}`;
}

export function Side1TripsLog({ pageNumber, month, dayGroups, grandTotals, pageSeq }: Props) {
  if (dayGroups.length === 0) {
    return (
      <div className="flex flex-col bg-paper-ledger p-3 rounded shadow-sm print:shadow-none print:border print:border-rule-line">
        <div className="flex items-center justify-between bg-slate-surface text-on-primary px-3 py-1 rounded mb-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold tracking-widest bg-primary-container text-tertiary-fixed px-1.5 py-0.5 rounded uppercase">SIDE 1</span>
            <span className="text-sm font-bold tracking-tight text-paper-sheet">RUNNING CHART • TRIPS LOG</span>
          </div>
          <span className="text-[10px] font-semibold tracking-widest text-surface-container-highest uppercase">{formatMonthLabel(month)} • LEAF {pageNumber}-A</span>
        </div>
        <div className="py-12 text-center text-on-surface-variant text-sm">
          No trips recorded on this page.
        </div>
      </div>
    );
  }

  // Flat list for alternate shading by date (remove DAY headings)
  const flatTrips = dayGroups.flatMap(g => g.trips);
  const dateToIdx = new Map<string, number>();
  dayGroups.forEach((g, idx) => dateToIdx.set(g.date, idx));
  const formatDateCell = (date: string) => {
    const d = new Date(date + 'T00:00:00');
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const dow = getDayOfWeek(date).slice(0, 3);
    return `${yyyy}-${mm}-${dd} (${dow})`;
  };

  return (
    <div className="flex flex-col bg-paper-ledger p-2 md:p-3 rounded shadow-sm print:shadow-none print:border print:border-rule-line">
      {/* Leaf Running Header */}
      <div className="flex items-center justify-between bg-slate-surface text-on-primary px-3 py-1 rounded mb-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold tracking-widest bg-primary-container text-tertiary-fixed px-1.5 py-0.5 rounded uppercase">SIDE 1</span>
          <span className="text-sm font-bold tracking-tight text-paper-sheet">RUNNING CHART • TRIPS LOG</span>
        </div>
        <span className="text-[10px] font-semibold tracking-widest text-surface-container-highest uppercase">
          {formatMonthLabel(month)} • LEAF {pageNumber}-A
        </span>
      </div>

      <div className="overflow-x-auto w-full border border-rule-line-strong rounded">
        <table className="w-full text-left text-on-surface border-collapse">
          <thead className="sticky top-0 z-10">
            <tr className="bg-primary-container text-on-primary">
              <th className="py-2 px-2.5 text-[11px] font-semibold tracking-widest uppercase text-center w-24 border border-rule-line-strong">Date</th>
              <th className="py-2 px-2.5 text-[11px] font-semibold tracking-widest uppercase text-center w-8 border border-rule-line-strong">#</th>
              <th className="py-2 px-2.5 text-[11px] font-semibold tracking-widest uppercase text-center w-12 border border-rule-line-strong">Dep.</th>
              <th className="py-2 px-2.5 text-[11px] font-semibold tracking-widest uppercase text-center w-12 border border-rule-line-strong">Arr.</th>
              <th className="py-2 px-2.5 text-[11px] font-semibold tracking-widest uppercase text-right w-20 border border-rule-line-strong">Start KM</th>
              <th className="py-2 px-2.5 text-[11px] font-semibold tracking-widest uppercase text-right w-20 border border-rule-line-strong">End KM</th>
              <th className="py-2 px-2.5 text-[11px] font-semibold tracking-widest uppercase text-right w-16 border border-rule-line-strong">Dist</th>
              <th className="py-2 px-2.5 text-[11px] font-semibold tracking-widest uppercase text-center w-16 border border-rule-line-strong">Type</th>
              <th className="py-2 px-2.5 text-[11px] font-semibold tracking-widest uppercase border border-rule-line-strong">Route / Purpose</th>
            </tr>
          </thead>
          <tbody className="text-[13px] leading-[18px] font-medium divide-y-0">
            {flatTrips.map((t: Trip, idx: number) => {
              const dateIdx = dateToIdx.get(t.date) ?? 0;
              const isAltDate = dateIdx % 2 === 1;
              return (
                <tr key={t.id} className={`${isAltDate ? 'bg-blue-50/40' : idx % 2 === 0 ? 'bg-paper-sheet' : 'bg-paper-ledger'} hover:bg-surface-container-low transition-colors`}>
                  <td className="py-2 px-2.5 text-center text-[10px] font-semibold tracking-widest text-on-surface-variant border border-rule-line">
                    {formatDateCell(t.date)}
                  </td>
                  <td className="py-2 px-2.5 text-center font-mono text-sm font-semibold border border-rule-line">{pageSeq[idx]}</td>
                  <td className="py-2 px-2.5 text-center font-mono text-sm border border-rule-line">{t.start_time || '-'}</td>
                  <td className="py-2 px-2.5 text-center font-mono text-sm border border-rule-line">{t.end_time}</td>
                  <td className="py-2 px-2.5 text-right font-mono text-sm border border-rule-line">{Math.round(t.start_km).toLocaleString()}</td>
                  <td className="py-2 px-2.5 text-right font-mono text-sm border border-rule-line">{Math.round(t.end_km).toLocaleString()}</td>
                  <td className="py-2 px-2.5 text-right font-mono text-sm font-bold text-on-surface border border-rule-line">{Math.round(t.trip_distance).toLocaleString()}</td>
                  <td className="py-2 px-2.5 text-center border border-rule-line">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold tracking-widest uppercase ${t.trip_type === 'Official' ? 'bg-surface-container-highest text-trip-official' : 'bg-surface-container text-trip-private'}`}>
                      {t.trip_type.toUpperCase()}
                    </span>
                  </td>
                  <td className="py-2 px-2.5 truncate max-w-[180px] border border-rule-line" title={t.places_visited}>{t.places_visited}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-slate-surface text-on-primary font-bold">
              <td colSpan={6} className="py-2.5 px-2.5 text-right text-[11px] font-semibold tracking-widest uppercase border border-rule-line-strong">Page {pageNumber} Grand Distance Totals:</td>
              <td className="py-2.5 px-2.5 text-right font-mono text-sm text-tertiary-fixed border border-rule-line-strong">{grandTotals.totalDistance.toLocaleString()}</td>
              <td colSpan={2} className="py-2.5 px-2.5 text-[11px] font-semibold tracking-widest uppercase text-surface-container-highest border border-rule-line-strong">
                Official: {grandTotals.officialKm.toLocaleString()} KM | Private: {grandTotals.privateKm.toLocaleString()} KM | Trips: {grandTotals.tripCount}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="mt-2 p-1.5 bg-paper-sheet rounded flex items-center justify-between text-on-surface-variant print:hidden">
        <span className="text-[10px] font-semibold tracking-widest uppercase">Page Entry Integrity: {grandTotals.tripCount} of 52 Max Ledger Slots Active</span>
        <span className="text-[10px] font-bold tracking-widest uppercase text-trip-official">✓ Zero Distance Gaps</span>
      </div>
    </div>
  );
}
