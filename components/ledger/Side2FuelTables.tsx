'use client';

import React from 'react';
import type { LedgerDay, LedgerSummary } from '@/lib/ledgerCalculations';
import { roundToOneDecimal } from '@/lib/tripCalculations';
import type { PageGap, FuelGap } from '@/lib/continuityAlerts';

interface Props {
  pageNumber: number;
  ledgerDays: LedgerDay[];
  summary: LedgerSummary;
  vehicleTankCapacity: number;
  rawEconomies: (number | null)[];
  rawInTanks: (number | null)[];
  onEconomyChange: (dayIndex: number, value: string) => void;
  onInTankChange: (dayIndex: number, value: string) => void;
  pageGaps?: PageGap[];
  dayGroupFuelGaps?: FuelGap[];
}

export function Side2FuelTables({ pageNumber, ledgerDays, summary, vehicleTankCapacity, rawEconomies, rawInTanks, onEconomyChange, onInTankChange, pageGaps, dayGroupFuelGaps }: Props) {
  if (ledgerDays.length === 0) {
    return (
      <div className="flex flex-col bg-paper-ledger p-2 md:p-3 rounded shadow-sm print:shadow-none print:border print:border-rule-line">
        <div className="flex items-center justify-between bg-slate-surface text-on-primary px-3 py-1 rounded mb-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold tracking-widest bg-primary-container text-telemetry-cyan px-1.5 py-0.5 rounded uppercase">SIDE 2</span>
            <span className="text-sm font-bold tracking-tight text-paper-sheet">FUEL & CONSUMPTION AUDIT TABLES</span>
          </div>
          <span className="text-[10px] font-semibold tracking-widest text-surface-container-highest uppercase">PAGE {pageNumber}-B BALANCE MATRIX</span>
        </div>
        <div className="py-12 text-center text-on-surface-variant text-sm">No fuel data — add trips to generate ledger.</div>
      </div>
    );
  }

  const fuelLevelPercent = vehicleTankCapacity > 0 ? Math.min(100, Math.max(0, (summary.finalBalance / vehicleTankCapacity) * 100)) : 0;

  // Compute page-level gap for current page (KM and Fuel)
  const currentPageKmGap = pageGaps?.find((g) => g.kind === 'km' && g.pageNumber === pageNumber);
  const currentPageFuelGap = pageGaps?.find((g) => g.kind === 'fuel' && g.pageNumber === pageNumber);

  // Compute day-group-level fuel gaps (Day N closing balance vs Day N+1 position)
  const dayGroupFuelGapDates = new Set(dayGroupFuelGaps?.map((g) => g.date) ?? []);

  return (
    <div className="flex flex-col bg-paper-ledger p-2 md:p-3 rounded shadow-sm print:shadow-none print:border print:border-rule-line gap-3">
      {/* Leaf Running Header */}
      <div className="flex items-center justify-between bg-slate-surface text-on-primary px-3 py-1 rounded">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold tracking-widest bg-primary-container text-telemetry-cyan px-1.5 py-0.5 rounded uppercase">SIDE 2</span>
          <span className="text-sm font-bold tracking-tight text-paper-sheet">FUEL & CONSUMPTION AUDIT TABLES</span>
        </div>
        <span className="text-[10px] font-semibold tracking-widest text-surface-container-highest uppercase">PAGE {pageNumber}-B BALANCE MATRIX</span>
      </div>

      {/* Side-by-side Tables 2 & 3 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* TABLE 1 — Transposed: days as columns (read-only here, edit in All Trips - inputs kept for backward compat, disabled) */}
      <div>
        <div className="flex items-center justify-between bg-primary-container text-on-primary px-2 py-1 rounded-t">
          <div className="flex items-center gap-1.5">
            <span className="text-sm text-telemetry-cyan">◈</span>
            <span className="text-[10px] font-bold tracking-widest uppercase text-paper-sheet">TABLE 1 • FUEL ECONOMY & CONSUMPTION ANALYSIS</span>
          </div>
          <span className="text-[10px] font-semibold tracking-widest uppercase text-surface-container-highest">Transposed — Days as Columns</span>
        </div>
        <div className="overflow-x-auto w-full border border-rule-line-strong rounded-b">
          <table className="w-full text-left text-on-surface border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-surface-container-high text-on-surface">
                <th className="py-2 px-3 text-[11px] font-semibold tracking-widest uppercase border border-rule-line-strong bg-surface-container-high sticky left-0 z-20 min-w-[140px]">Metric</th>
                {ledgerDays.map((d) => (
                  <th key={d.date} className="py-2 px-3 text-center text-[11px] font-semibold tracking-widest uppercase border border-rule-line-strong bg-surface-container-high min-w-[90px]">
                    Day {d.dayIndex}
                    <span className="block text-[10px] font-mono normal-case tracking-normal text-on-surface-variant">{d.dayLabel}</span>
                  </th>
                ))}
                <th className="py-2 px-3 text-center text-[11px] font-semibold tracking-widest uppercase border border-rule-line-strong bg-surface-container-high min-w-[90px]">Total</th>
              </tr>
            </thead>
            <tbody className="text-[13px] leading-[18px] font-medium">
              <tr className="bg-paper-sheet">
                <td className="py-2.5 px-3 font-semibold border border-rule-line-strong sticky left-0 bg-paper-sheet z-10">Date</td>
                {ledgerDays.map((d) => (
                  <td key={d.date} className="py-2.5 px-3 text-center border border-rule-line text-[11px] font-semibold tracking-widest text-on-surface-variant">{d.dayLabel}</td>
                ))}
                <td className="py-2.5 px-3 text-center border border-rule-line-strong bg-surface-container-low text-[11px] tracking-widest">—</td>
              </tr>
              <tr className="bg-paper-ledger">
                <td className="py-2.5 px-3 font-semibold border border-rule-line-strong sticky left-0 bg-paper-ledger z-10">Start KM</td>
                {ledgerDays.map((d) => (
                  <td key={d.date} className={`py-2.5 px-3 text-right font-mono text-sm border border-rule-line ${currentPageKmGap ? 'bg-red-100' : ''}`} title={currentPageKmGap?.message}>{d.startKm.toLocaleString()}</td>
                ))}
                <td className="py-2.5 px-3 text-center border border-rule-line-strong bg-surface-container-low text-[11px]">—</td>
              </tr>
              <tr className="bg-paper-sheet">
                <td className="py-2.5 px-3 font-semibold border border-rule-line-strong sticky left-0 bg-paper-sheet z-10">End KM</td>
                {ledgerDays.map((d) => (
                  <td key={d.date} className="py-2.5 px-3 text-right font-mono text-sm border border-rule-line">{d.endKm.toLocaleString()}</td>
                ))}
                <td className="py-2.5 px-3 text-right font-mono text-sm border border-rule-line-strong bg-surface-container-low">{(ledgerDays[ledgerDays.length - 1]?.endKm ?? 0).toLocaleString()}</td>
              </tr>
              <tr className="bg-paper-ledger">
                <td className="py-2.5 px-3 font-semibold border border-rule-line-strong sticky left-0 bg-paper-ledger z-10">Daily Dist (KM)</td>
                {ledgerDays.map((d) => (
                  <td key={d.date} className="py-2.5 px-3 text-right font-mono text-sm font-bold border border-rule-line">{d.distance.toLocaleString()}</td>
                ))}
                <td className="py-2.5 px-3 text-right font-mono text-sm font-bold text-primary border border-rule-line-strong bg-surface-container-low">{summary.totalDistance.toLocaleString()} KM</td>
              </tr>
              <tr className="bg-paper-sheet">
                <td className="py-2.5 px-3 font-semibold border border-rule-line-strong sticky left-0 bg-paper-sheet z-10">Fuel Economy (km/L)</td>
                {ledgerDays.map((d, idx) => (
                  <td key={d.date} className="py-2 px-3 text-center border border-rule-line">
                    <div className="flex flex-col items-center gap-1">
                      <input
                        aria-label={`Fuel Economy Day ${d.dayIndex}`}
                        type="number"
                        step="0.1"
                        placeholder={d.fuelEconomy.toFixed(1)}
                        value={rawEconomies[idx] !== null && rawEconomies[idx] !== undefined ? String(rawEconomies[idx]) : ''}
                        onChange={(e) => onEconomyChange(idx, e.target.value)}
                        disabled
                        title="Edit in All Trips table"
                        className="w-20 px-1.5 py-0.5 border border-rule-line rounded text-center font-mono text-sm focus:ring-1 focus:ring-telemetry-cyan focus:outline-none bg-paper-gutter opacity-60 cursor-not-allowed"
                      />
                      <span className="text-[11px] font-mono text-on-surface">{d.fuelEconomy.toFixed(1)}</span>
                      <span className={`text-[9px] font-bold tracking-widest uppercase px-1 rounded ${d.economySource === 'explicit' ? 'bg-surface-container-highest text-telemetry-cyan' : 'text-on-surface-variant'}`}>
                        {d.economySource === 'explicit' ? 'Adjusted' : d.economySource === 'inherited' ? '(Inh.)' : '(Def.)'}
                      </span>
                    </div>
                  </td>
                ))}
                <td className="py-2.5 px-3 text-center font-mono text-sm text-trip-official font-bold border border-rule-line-strong bg-surface-container-low">{summary.weightedEconomy.toFixed(1)} km/L</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* TABLE 2 — Position & Balance (read-only, In-Tank now edited in All Trips) */}
      <div>
        <div className="flex items-center justify-between bg-primary-container text-on-primary px-2 py-1 rounded-t">
          <div className="flex items-center gap-1.5">
            <span className="text-sm text-trip-official">●</span>
            <span className="text-[10px] font-bold tracking-widest uppercase text-paper-sheet">TABLE 2 • FUEL POSITION & BALANCE ACCOUNT</span>
          </div>
          <span className="text-[10px] font-semibold tracking-widest uppercase text-surface-container-highest">Closing = Pos + In-Tank + Drawn − Consumed (1 Dec.)</span>
        </div>
        <div className="overflow-x-auto w-full border border-rule-line-strong rounded-b">
          <table className="w-full text-left text-on-surface border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-surface-container-high text-on-surface">
                <th className="py-2 px-3 text-[11px] font-semibold tracking-widest uppercase border border-rule-line-strong bg-surface-container-high sticky left-0 z-20 min-w-[140px]">Metric</th>
                {ledgerDays.map((d) => (
                  <th key={d.date} className="py-2 px-3 text-center text-[11px] font-semibold tracking-widest uppercase border border-rule-line-strong bg-surface-container-high min-w-[90px]">
                    Day {d.dayIndex}
                  </th>
                ))}
                <th className="py-2 px-3 text-center text-[11px] font-semibold tracking-widest uppercase border border-rule-line-strong bg-surface-container-high min-w-[90px]">Total</th>
              </tr>
            </thead>
            <tbody className="text-[13px] leading-[18px] font-medium">
              <tr className="bg-paper-sheet">
                <td className="py-2.5 px-3 font-semibold border border-rule-line-strong sticky left-0 bg-paper-sheet z-10">Start Pos. (L)</td>
                {ledgerDays.map((d) => {
                  const hasFuelGap = currentPageFuelGap || dayGroupFuelGapDates.has(d.date);
                  return (
                    <td key={d.date} className={`py-2.5 px-3 text-right font-mono text-sm border border-rule-line ${hasFuelGap ? 'bg-amber-100' : 'text-on-surface-variant'}`} title={currentPageFuelGap?.message ?? (hasFuelGap ? `Day ${d.dayIndex} fuel position gap` : undefined)}>{d.fuelPosition.toFixed(1)}</td>
                  );
                })}
                <td className="py-2.5 px-3 text-center border border-rule-line-strong bg-surface-container-low text-[11px]">—</td>
              </tr>
              <tr className="bg-paper-ledger">
                <td className="py-2.5 px-3 font-semibold border border-rule-line-strong sticky left-0 bg-paper-ledger z-10">In-Tank (L)</td>
                {ledgerDays.map((d, idx) => (
                  <td key={d.date} className="py-2 px-3 text-center border border-rule-line">
                    <input
                      aria-label={`In-Tank Day ${d.dayIndex}`}
                      type="number"
                      step="0.1"
                      placeholder="0.0"
                      value={rawInTanks[idx] !== null && rawInTanks[idx] !== undefined ? String(rawInTanks[idx]) : ''}
                      onChange={(e) => onInTankChange(idx, e.target.value)}
                      disabled
                      title="Edit in All Trips table"
                      className="w-20 px-1.5 py-0.5 border border-rule-line rounded text-center font-mono text-sm focus:ring-1 focus:ring-telemetry-cyan focus:outline-none bg-paper-gutter opacity-60 cursor-not-allowed"
                    />
                    <span className="block text-[11px] font-mono text-on-surface-variant">{d.inTank.toFixed(1)}</span>
                  </td>
                ))}
                <td className="py-2.5 px-3 text-right font-mono text-sm border border-rule-line-strong bg-surface-container-low">{roundToOneDecimal(ledgerDays.reduce((s, d) => s + d.inTank, 0)).toFixed(1)}</td>
              </tr>
              <tr className="bg-paper-sheet">
                <td className="py-2.5 px-3 font-semibold border border-rule-line-strong sticky left-0 bg-paper-sheet z-10">Pumped (L)</td>
                {ledgerDays.map((d) => (
                  <td key={d.date} className={`py-2.5 px-3 text-right font-mono text-sm border border-rule-line ${d.drawn > 0 ? 'text-trip-official font-bold' : 'text-on-surface-variant'}`}>
                    {d.drawn > 0 ? `+${d.drawn.toFixed(1)}` : '0.0'}
                  </td>
                ))}
                <td className="py-2.5 px-3 text-right font-mono text-sm font-bold text-trip-official border border-rule-line-strong bg-surface-container-low">{summary.totalDrawn.toFixed(1)}</td>
              </tr>
              <tr className="bg-paper-ledger">
                <td className="py-2.5 px-3 font-semibold border border-rule-line-strong sticky left-0 bg-paper-ledger z-10">Order No / Date</td>
                {ledgerDays.map((d) => (
                  <td key={d.date} className="py-2.5 px-3 text-center text-[11px] font-semibold tracking-widest border border-rule-line">
                    {d.drawn > 0 ? (
                      <span className="text-on-surface">{d.fuelOrderNo || '-'} {d.fuelOrderDate ? `(${d.fuelOrderDate.slice(5).replace('-','/')})` : ''}</span>
                    ) : (
                      <span className="text-on-surface-variant">-</span>
                    )}
                  </td>
                ))}
                <td className="py-2.5 px-3 text-center text-[11px] tracking-widest border border-rule-line-strong bg-surface-container-low">Total Inflow</td>
              </tr>
              <tr className="bg-paper-sheet">
                <td className="py-2.5 px-3 font-semibold border border-rule-line-strong sticky left-0 bg-paper-sheet z-10">Consumed (L)</td>
                {ledgerDays.map((d) => (
                  <td key={d.date} className="py-2.5 px-3 text-right font-mono text-sm font-semibold border border-rule-line">{d.consumed.toFixed(1)}</td>
                ))}
                <td className="py-2.5 px-3 text-right font-mono text-sm font-bold text-error border border-rule-line-strong bg-surface-container-low">{summary.totalConsumed.toFixed(1)}</td>
              </tr>
              <tr className="bg-surface-container-high font-bold">
                <td className="py-2.5 px-3 border border-rule-line-strong sticky left-0 bg-surface-container-high z-10">Closing Balance</td>
                {ledgerDays.map((d, idx) => {
                  const hasFuelGap = dayGroupFuelGapDates.has(d.date);
                  return (
                    <td key={d.date} className={`py-2.5 px-3 text-right font-mono text-sm border border-rule-line-strong ${hasFuelGap ? 'bg-amber-100' : idx === ledgerDays.length - 1 ? 'text-telemetry-cyan' : d.drawn > 0 ? 'text-trip-official' : 'text-on-surface'}`} title={hasFuelGap ? `Closing Balance does not match next Day Position` : undefined}>
                      {d.balance.toFixed(1)} L
                    </td>
                  );
                })}
                <td className="py-2.5 px-3 text-right font-mono text-sm text-primary font-bold border border-rule-line-strong bg-surface-container-high">{summary.finalBalance.toFixed(1)} L</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      </div>

      {/* Fuel Tank Level State */}
      <div className="p-2 bg-paper-sheet rounded shadow-sm print:shadow-none print:border print:border-rule-line">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] font-bold tracking-widest uppercase text-on-surface">Fuel Tank Level State</span>
          <span className="font-mono text-sm font-bold text-telemetry-cyan">
            {summary.finalBalance.toFixed(1)} L / {vehicleTankCapacity.toFixed(1)} L ({roundToOneDecimal(fuelLevelPercent).toFixed(1)}%)
          </span>
        </div>
        <div className="w-full h-3 bg-paper-gutter rounded-full overflow-hidden flex">
          <div className="h-full bg-telemetry-cyan rounded-full" style={{ width: `${Math.min(100, fuelLevelPercent)}%` }} />
        </div>
        <div className="flex items-center justify-between mt-1 text-on-surface-variant text-[10px] font-semibold tracking-widest uppercase">
          <span>Reserve Limit: 10.0 L</span>
          <span>Formula: Closing = Position + In-Tank + Drawn − Consumed</span>
          <span>Avail: {(vehicleTankCapacity - summary.finalBalance).toFixed(1)} L</span>
        </div>
      </div>

      {/* Continuity Stamp */}
      <div className="mt-auto p-3 bg-slate-surface text-on-primary rounded shadow-md flex flex-col gap-2 print:bg-white print:text-black print:border print:border-slate-400">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className="text-trip-official">✔</span>
            <div className="flex flex-col">
              <span className="text-[10px] font-semibold tracking-widest uppercase text-surface-container-highest print:text-slate-600">CONTINUITY VERIFICATION STAMP</span>
              <span className="text-sm font-bold text-paper-sheet print:text-black">Page {pageNumber} Closed & Authenticated</span>
            </div>
          </div>
          <span className="text-[10px] font-bold tracking-widest uppercase bg-primary text-tertiary-fixed px-2 py-1 rounded print:bg-slate-200 print:text-black">
            Ready for Page {pageNumber + 1}
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-2 bg-primary-container p-2 rounded print:bg-slate-100">
          <div className="flex flex-col">
            <span className="text-[10px] font-semibold tracking-widest uppercase text-on-primary-container">Carried Forward Odometer:</span>
            <span className="font-mono text-lg font-bold text-paper-sheet print:text-black">
              {ledgerDays[ledgerDays.length - 1]?.endKm ?? '-'} <span className="text-[10px] font-semibold tracking-widest text-tertiary-fixed">KM</span>
            </span>
            <span className="text-[11px] text-surface-container-highest print:text-slate-600">Identical to Page {pageNumber + 1} Day 1 Start KM</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] font-semibold tracking-widest uppercase text-on-primary-container">Carried Forward Fuel Stock:</span>
            <span className="font-mono text-lg font-bold text-telemetry-cyan">{summary.finalBalance.toFixed(1)} <span className="text-[10px] font-semibold tracking-widest text-tertiary-fixed">LITERS</span></span>
            <span className="text-[11px] text-surface-container-highest print:text-slate-600">Transferred to Page {pageNumber + 1} Opening Tank Balance</span>
          </div>
        </div>
      </div>
    </div>
  );
}
