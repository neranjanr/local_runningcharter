'use client';

import React from 'react';
import type { LedgerDay, LedgerSummary, LedgerCycleColumn } from '@/lib/ledgerCalculations';
import { roundToOneDecimal } from '@/lib/tripCalculations';
import type { PageGap, FuelGap } from '@/lib/continuityAlerts';
import { getFuelLocksForPage } from '@/lib/fuelEconomyLockStore';
import { isDateGapBlanked } from '@/lib/estimateFuelEconomy';
import type { Trip } from '@/types';

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
  trips?: Trip[];
}

function formatAuditDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}

// Issue #11: per-cycle columns share LedgerDay fields; split slices add a
// unique key, a trip range, and split/collapse flags. Plain day rows
// (legacy callers) render exactly as before.
function asCycleCol(d: LedgerDay): Partial<LedgerCycleColumn> {
  return d as Partial<LedgerCycleColumn>;
}

function colKey(d: LedgerDay): string {
  return asCycleCol(d).key ?? d.date;
}

function colTripRange(d: LedgerDay): string | null {
  return asCycleCol(d).tripRange ?? null;
}

function colLabel(d: LedgerDay): string {
  return asCycleCol(d).columnLabel ?? formatAuditDate(d.date);
}

function isCollapsedCol(d: LedgerDay): boolean {
  return !!asCycleCol(d).isCollapsed;
}

export function Side2FuelTables({ pageNumber, ledgerDays, summary, vehicleTankCapacity, rawEconomies, rawInTanks, onEconomyChange, onInTankChange, pageGaps, dayGroupFuelGaps, trips = [] }: Props) {
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

  // Legacy per-date lock slots stay date-indexed: on a split page the
  // second slice of a date shares that date's lock state instead of
  // reading the next date's slot by column position.
  const distinctDatesInOrder: string[] = [];
  for (const d of ledgerDays) {
    if (!distinctDatesInOrder.includes(d.date)) distinctDatesInOrder.push(d.date);
  }

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
      <div className="grid grid-cols-1 lg:grid-cols-2 print:grid-cols-2 gap-4 items-stretch">
      {/* TABLE 1 — Fuel Economy (read-only, edit in All Trips) */}
      <div className="flex flex-col h-full">
        <div className="flex items-center bg-primary-container text-on-primary px-2 py-1 rounded-t">
          <div className="flex items-center gap-1.5">
            <span className="text-sm text-telemetry-cyan">◈</span>
            <span className="text-[10px] font-bold tracking-widest uppercase text-paper-sheet">TABLE 1 • FUEL ECONOMY & CONSUMPTION ANALYSIS</span>
          </div>
        </div>
        <div className="overflow-x-auto w-full border border-rule-line-strong rounded-b flex-1">
          <table className="w-full text-left text-on-surface border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-surface-container-high text-on-surface">
                <th className="py-2 px-3 text-[11px] font-semibold tracking-widest uppercase border border-rule-line-strong bg-surface-container-high sticky left-0 z-20 min-w-[140px]">Metric</th>
                {ledgerDays.map((d) => (
                  <th key={colKey(d)} className="py-2 px-3 text-center text-[11px] font-semibold tracking-widest uppercase border border-rule-line-strong bg-surface-container-high min-w-[90px]" title={colLabel(d)}>
                    DAY {d.dayIndex}
                    {colTripRange(d) && <div className="text-[9px] font-bold text-telemetry-cyan">{colTripRange(d)}</div>}
                  </th>
                ))}
                <th className="py-2 px-3 text-center text-[11px] font-semibold tracking-widest uppercase border border-rule-line-strong bg-surface-container-high min-w-[90px]">Total</th>
              </tr>
            </thead>
            <tbody className="text-[13px] leading-[18px] font-medium">
              <tr className="bg-paper-sheet">
                <td className="py-2.5 px-3 font-semibold border border-rule-line-strong sticky left-0 bg-paper-sheet z-10">Date</td>
                {ledgerDays.map((d) => (
                  <td key={colKey(d)} className="py-2.5 px-3 text-center border border-rule-line text-[11px] font-semibold tracking-widest text-on-surface-variant" title={colLabel(d)}>
                    <div>{formatAuditDate(d.date)}</div>
                    {colTripRange(d) && <div className="text-[9px] font-bold text-telemetry-cyan">{colTripRange(d)}</div>}
                  </td>
                ))}
                <td className="py-2.5 px-3 text-center border border-rule-line-strong bg-surface-container-low text-[11px] tracking-widest">—</td>
              </tr>
              <tr className="bg-paper-ledger">
                <td className="py-2.5 px-3 font-semibold border border-rule-line-strong sticky left-0 bg-paper-ledger z-10">DAY</td>
                {ledgerDays.map((d) => {
                  const ddd = new Date(d.date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short' });
                  return <td key={colKey(d)} className="py-2.5 px-3 text-center border border-rule-line text-[11px] font-semibold tracking-widest text-on-surface-variant">{ddd}</td>;
                })}
                <td className="py-2.5 px-3 text-center border border-rule-line-strong bg-surface-container-low text-[11px] tracking-widest">—</td>
              </tr>
              <tr className="bg-paper-ledger">
                <td className="py-2.5 px-3 font-semibold border border-rule-line-strong sticky left-0 bg-paper-ledger z-10">Start KM</td>
                {ledgerDays.map((d) => (
                  <td key={colKey(d)} className={`py-2.5 px-3 text-right font-mono text-sm border border-rule-line ${currentPageKmGap ? 'bg-red-100' : ''}`} title={currentPageKmGap?.message ?? colLabel(d)}>{d.startKm.toLocaleString()}</td>
                ))}
                <td className="py-2.5 px-3 text-center border border-rule-line-strong bg-surface-container-low text-[11px]">—</td>
              </tr>
              <tr className="bg-paper-sheet">
                <td className="py-2.5 px-3 font-semibold border border-rule-line-strong sticky left-0 bg-paper-sheet z-10">End KM</td>
                {ledgerDays.map((d) => (
                  <td key={colKey(d)} className="py-2.5 px-3 text-right font-mono text-sm border border-rule-line">{d.endKm.toLocaleString()}</td>
                ))}
                <td className="py-2.5 px-3 text-right font-mono text-sm border border-rule-line-strong bg-surface-container-low">{(ledgerDays[ledgerDays.length - 1]?.endKm ?? 0).toLocaleString()}</td>
              </tr>
              <tr className="bg-paper-ledger">
                <td className="py-2.5 px-3 font-semibold border border-rule-line-strong sticky left-0 bg-paper-ledger z-10">Daily Dist (KM)</td>
                {ledgerDays.map((d) => (
                  <td key={colKey(d)} className="py-2.5 px-3 text-right font-mono text-sm font-bold border border-rule-line">{d.distance.toLocaleString()}</td>
                ))}
                <td className="py-2.5 px-3 text-right font-mono text-sm font-bold text-primary border border-rule-line-strong bg-surface-container-low">{summary.totalDistance.toLocaleString()} KM</td>
              </tr>
              <tr className="bg-paper-sheet">
                <td className="py-2.5 px-3 font-semibold border border-rule-line-strong sticky left-0 bg-paper-sheet z-10">Fuel Economy (km/L)</td>
                {ledgerDays.map((d, idx) => {
                  let isLocked = false;
                  try {
                    const locks = getFuelLocksForPage(`page-${pageNumber}`);
                    const dateIdx = distinctDatesInOrder.indexOf(d.date);
                    isLocked = !!(locks[dateIdx >= 0 ? dateIdx : idx]);
                  } catch {}
                  const blanked = trips ? isDateGapBlanked(d.date, trips) && d.economySource !== 'explicit' && !isLocked : false;
                  const collapsed = isCollapsedCol(d);
                  return (
                  <td key={colKey(d)} className="py-2 px-3 text-center border border-rule-line" title={blanked ? 'Economy not calculated — ODO gap' : collapsed ? 'Split day collapsed to one column — distance-weighted-average economy' : colLabel(d)}>
                    <div className="flex flex-col items-center gap-1">
                      <span className="text-[11px] font-mono text-on-surface font-bold flex items-center gap-1">
                        {blanked ? '—' : d.fuelEconomy.toFixed(1)} {isLocked && <span className="text-[9px] bg-slate-800 text-white px-1 rounded">🔒</span>}
                      </span>
                      {collapsed && (
                        <span className="text-[9px] font-bold tracking-widest uppercase px-1 rounded bg-surface-container-highest text-telemetry-cyan" title="Split day collapsed — averaged economy, exact balances">
                          ⧉ SPLIT·AVG
                        </span>
                      )}
                      <span className={`text-[9px] font-bold tracking-widest uppercase px-1 rounded ${d.economySource === 'explicit' ? 'bg-surface-container-highest text-telemetry-cyan' : 'text-on-surface-variant'}`}>
                        {isLocked ? 'Locked' : d.economySource === 'explicit' ? 'Adjusted' : d.economySource === 'inherited' ? '(Inh.)' : '(Def.)'}
                      </span>
                    </div>
                  </td>
                );})}
                <td className="py-2.5 px-3 text-center font-mono text-sm text-trip-official font-bold border border-rule-line-strong bg-surface-container-low">{summary.weightedEconomy.toFixed(1)} km/L</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* TABLE 2 — Position & Balance (read-only, In-Tank edited in All Trips) */}
      <div className="flex flex-col h-full">
        <div className="flex items-center bg-primary-container text-on-primary px-2 py-1 rounded-t">
          <div className="flex items-center gap-1.5">
            <span className="text-sm text-trip-official">●</span>
            <span className="text-[10px] font-bold tracking-widest uppercase text-paper-sheet">TABLE 2 • FUEL POSITION & BALANCE ACCOUNT</span>
          </div>
        </div>
        <div className="overflow-x-auto w-full border border-rule-line-strong rounded-b flex-1">
          <table className="w-full text-left text-on-surface border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-surface-container-high text-on-surface">
                <th className="py-2 px-3 text-[11px] font-semibold tracking-widest uppercase border border-rule-line-strong bg-surface-container-high sticky left-0 z-20 min-w-[140px]">Metric</th>
                {ledgerDays.map((d) => (
                  <th key={colKey(d)} className="py-2 px-3 text-center text-[11px] font-semibold tracking-widest uppercase border border-rule-line-strong bg-surface-container-high min-w-[90px]" title={colLabel(d)}>
                    Day {d.dayIndex}
                    {colTripRange(d) && <div className="text-[9px] font-bold text-telemetry-cyan">{colTripRange(d)}</div>}
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
                    <td key={colKey(d)} className={`py-2.5 px-3 text-right font-mono text-sm border border-rule-line ${hasFuelGap ? 'bg-amber-100' : 'text-on-surface-variant'}`} title={currentPageFuelGap?.message ?? (hasFuelGap ? `Day ${d.dayIndex} fuel position gap` : colLabel(d))}>{d.fuelPosition.toFixed(1)}</td>
                  );
                })}
                <td className="py-2.5 px-3 text-center border border-rule-line-strong bg-surface-container-low text-[11px]">—</td>
              </tr>
              <tr className="bg-paper-ledger">
                <td className="py-2.5 px-3 font-semibold border border-rule-line-strong sticky left-0 bg-paper-ledger z-10">In-Tank (L)</td>
                {ledgerDays.map((d) => (
                  <td key={colKey(d)} className="py-2 px-3 text-center border border-rule-line">
                    <span className="block text-[11px] font-mono text-on-surface-variant font-bold">{d.inTank.toFixed(1)}</span>
                  </td>
                ))}
                <td className="py-2.5 px-3 text-right font-mono text-sm border border-rule-line-strong bg-surface-container-low">{roundToOneDecimal(ledgerDays.reduce((s, d) => s + d.inTank, 0)).toFixed(1)}</td>
              </tr>
              <tr className="bg-paper-sheet">
                <td className="py-2.5 px-3 font-semibold border border-rule-line-strong sticky left-0 bg-paper-sheet z-10">Pumped (L)</td>
                {ledgerDays.map((d) => (
                  <td key={colKey(d)} className={`py-2.5 px-3 text-right font-mono text-sm border border-rule-line ${d.drawn > 0 ? 'text-trip-official font-bold' : 'text-on-surface-variant'}`}>
                    <span className="inline-flex items-center justify-end gap-1 w-full">
                      <span>{d.drawn > 0 ? `+${d.drawn.toFixed(1)}` : '0.0'}</span>
                      {d.isFullTank && d.drawn > 0 && <span className="shrink-0 inline-flex items-center px-1 py-0.5 rounded bg-emerald-100 border border-emerald-300 text-emerald-700 text-[8px] font-bold tracking-widest leading-none" title="Full Tank">★ FULL</span>}
                    </span>
                  </td>
                ))}
                <td className="py-2.5 px-3 text-right font-mono text-sm font-bold text-trip-official border border-rule-line-strong bg-surface-container-low">{summary.totalDrawn.toFixed(1)}</td>
              </tr>
              <tr className="bg-paper-ledger">
                <td className="py-2.5 px-3 font-semibold border border-rule-line-strong sticky left-0 bg-paper-ledger z-10">Order No / Date</td>
                {ledgerDays.map((d) => (
                  <td key={colKey(d)} className="py-2.5 px-3 text-center text-[11px] font-semibold tracking-widest border border-rule-line">
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
                  <td key={colKey(d)} className="py-2.5 px-3 text-right font-mono text-sm font-semibold border border-rule-line">{d.consumed.toFixed(1)}</td>
                ))}
                <td className="py-2.5 px-3 text-right font-mono text-sm font-bold text-error border border-rule-line-strong bg-surface-container-low">{summary.totalConsumed.toFixed(1)}</td>
              </tr>
              <tr className="bg-surface-container-high font-bold">
                <td className="py-2.5 px-3 border border-rule-line-strong sticky left-0 bg-surface-container-high z-10">Closing Balance</td>
                {ledgerDays.map((d, idx) => {
                  const hasFuelGap = dayGroupFuelGapDates.has(d.date);
                  return (
                    <td key={colKey(d)} className={`py-2.5 px-3 text-right font-mono text-sm border border-rule-line-strong ${hasFuelGap ? 'bg-amber-100' : idx === ledgerDays.length - 1 ? 'text-telemetry-cyan' : d.drawn > 0 ? 'text-trip-official' : 'text-on-surface'}`} title={hasFuelGap ? `Closing Balance does not match next Day Position` : colLabel(d)}>
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
          <span>Formula: Closing = Position + In-Tank + Drawn − Consumed</span>
          <span>Avail: {(vehicleTankCapacity - summary.finalBalance).toFixed(1)} L</span>
        </div>
      </div>

      {/* Continuity Stamp — hidden in print */}
      <div className="mt-auto p-3 bg-slate-surface text-on-primary rounded shadow-md flex flex-col gap-2 print:hidden">
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
