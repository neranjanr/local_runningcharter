'use client';

import React from 'react';
import type { DashboardMetrics } from '@/lib/dashboardCalculations';

interface Props {
  metrics: DashboardMetrics;
  prevMetrics?: DashboardMetrics;
  thisMonthLabel?: string;
  prevMonthLabel?: string;
}

function formatDdMmYyyy(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}

export function MetricCards({ metrics, prevMetrics, thisMonthLabel, prevMonthLabel }: Props) {
  const odoStr = String(Math.round(metrics.lastOdo)).padStart(6, '0');
  const odoDateLabel = metrics.lastOdoDate ? `as at ${formatDdMmYyyy(metrics.lastOdoDate)}` : 'as at —';
  const fuelPct = Math.min(100, Math.max(0, metrics.fuelLevelPercent));
  const needleAngle = (fuelPct / 100) * 180 - 90;
  const prev = prevMetrics ?? { officialKm: 0, privateKm: 0, totalKm: 0, tripCount: 0 } as DashboardMetrics;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Combined Monthly Distances — two virtual rows: This Month + Previous Month */}
      <div className="rounded-xl p-4 border shadow-sm bg-amber-50/60 border-amber-200 flex flex-col gap-3">
        <span className="text-[10px] font-bold tracking-widest uppercase text-on-surface-variant">Monthly Distances</span>
        {/* This Month Row */}
        <div className="flex flex-col gap-1">
          <span className="text-[9px] font-bold tracking-widest uppercase text-primary">{thisMonthLabel ?? 'This Month Stats'}</span>
          <div className="grid grid-cols-3 gap-2 divide-x divide-amber-200">
            <div data-testid="metric-official" className="flex flex-col items-center text-center px-1">
              <span className="text-[9px] font-bold tracking-widest uppercase text-on-surface-variant">Official Distance (This Month)</span>
              <span className="text-lg font-bold font-mono tracking-tight text-trip-official">{Math.round(metrics.officialKm)} KM</span>
              <span className="text-[10px] text-on-surface-variant">{metrics.tripCount} trips</span>
            </div>
            <div data-testid="metric-private" className="flex flex-col items-center text-center px-1">
              <span className="text-[9px] font-bold tracking-widest uppercase text-on-surface-variant">Private Mileage (This Month)</span>
              <span className="text-lg font-bold font-mono tracking-tight text-trip-private">{Math.round(metrics.privateKm)} KM</span>
              <span className="text-[10px] text-on-surface-variant">Personal</span>
            </div>
            <div data-testid="metric-total" className="flex flex-col items-center text-center px-1">
              <span className="text-[9px] font-bold tracking-widest uppercase text-on-surface-variant">Total (This Month)</span>
              <span className="text-lg font-bold font-mono tracking-tight text-primary">{Math.round(metrics.totalKm)} KM</span>
              <span className="text-[10px] text-on-surface-variant">Ledger span</span>
            </div>
          </div>
        </div>
        {/* Previous Month Row */}
        <div className="flex flex-col gap-1 border-t border-amber-200 pt-2">
          <span className="text-[9px] font-bold tracking-widest uppercase text-on-surface-variant">{prevMonthLabel ?? 'Previous Month Stats'}</span>
          <div className="grid grid-cols-3 gap-2 divide-x divide-amber-200">
            <div data-testid="metric-prev-official" className="flex flex-col items-center text-center px-1">
              <span className="text-[8px] font-bold tracking-widest uppercase text-on-surface-variant">Official</span>
              <span className="text-base font-bold font-mono tracking-tight text-trip-official">{Math.round(prev.officialKm)} KM</span>
            </div>
            <div data-testid="metric-prev-private" className="flex flex-col items-center text-center px-1">
              <span className="text-[8px] font-bold tracking-widest uppercase text-on-surface-variant">Private</span>
              <span className="text-base font-bold font-mono tracking-tight text-trip-private">{Math.round(prev.privateKm)} KM</span>
            </div>
            <div data-testid="metric-prev-total" className="flex flex-col items-center text-center px-1">
              <span className="text-[8px] font-bold tracking-widest uppercase text-on-surface-variant">Total</span>
              <span className="text-base font-bold font-mono tracking-tight text-primary">{Math.round(prev.totalKm)} KM</span>
            </div>
          </div>
          <span className="text-[9px] text-on-surface-variant text-center">{(prev.tripCount ?? 0)} trips</span>
        </div>
      </div>

      {/* Vehicle-mimicking cluster for ODO + Fuel Gauge */}
      <div className="lg:col-span-2 rounded-xl border shadow-sm bg-paper-sheet border-rule-line flex flex-col relative overflow-hidden">
        {/* Vehicle roof / windows */}
        <div className="h-6 bg-slate-800 rounded-t-xl flex items-center justify-center gap-3 px-4">
          <span className="w-12 h-3 bg-sky-200/50 rounded-sm border border-white/30"></span>
          <span className="w-12 h-3 bg-sky-200/50 rounded-sm border border-white/30"></span>
          <span className="text-[8px] font-bold tracking-widest text-white/70 uppercase ml-2">Vehicle</span>
        </div>
        <div className="grid grid-cols-2 gap-4 p-4 flex-1">
          {/* ODO */}
          <div data-testid="metric-odo" className="flex flex-col gap-2">
            <span className="text-[10px] font-bold tracking-widest uppercase text-on-surface-variant">Last ODO Meter</span>
            <div className="bg-black rounded-lg px-2 py-2 flex items-center justify-between border-2 border-zinc-700 shadow-inner">
              <span className="text-[8px] font-bold tracking-widest text-zinc-400 uppercase">ODO</span>
              <span className="font-mono text-lg font-bold tracking-widest text-white flex gap-0.5">
                {odoStr.split('').map((ch, i) => (
                  <span key={i} className="bg-zinc-900 border border-zinc-700 rounded-sm px-1 py-0.5 min-w-[18px] text-center">
                    {ch}
                  </span>
                ))}
              </span>
              <span className="text-[8px] font-bold text-zinc-400">KM</span>
            </div>
            <span className="text-xl font-bold font-mono tracking-tight text-on-surface">{Math.round(metrics.lastOdo).toLocaleString()} KM</span>
            <span className="text-xs text-on-surface-variant">{odoDateLabel}</span>
          </div>
          {/* Fuel Gauge */}
          <div data-testid="metric-fuel" className="flex flex-col gap-2">
            <span className="text-[10px] font-bold tracking-widest uppercase text-on-surface-variant">Fuel Gauge</span>
            <span className="text-xl font-bold font-mono tracking-tight text-telemetry-cyan">{metrics.fuelLevel.toFixed(1)} L</span>
            <span className="text-xs text-on-surface-variant">{metrics.tankCapacity.toFixed(1)} L tank • {metrics.fuelLevelPercent.toFixed(1)}%</span>
            <div className="flex flex-col items-center">
              <svg width="120" height="70" viewBox="0 0 120 70" className="overflow-visible">
                <path d="M 10 60 A 50 50 0 0 1 110 60" fill="none" stroke="#e5e7eb" strokeWidth="8" strokeLinecap="round" />
                <path d="M 10 60 A 50 50 0 0 1 110 60" fill="none" stroke={fuelPct > 20 ? '#06b6d4' : '#ef4444'} strokeWidth="8" strokeLinecap="round" strokeDasharray={`${(fuelPct/100)*157} 157`} />
                <g stroke="#9ca3af" strokeWidth="1.5">
                  <line x1="10" y1="60" x2="16" y2="55" />
                  <line x1="35" y1="22" x2="39" y2="27" />
                  <line x1="60" y1="10" x2="60" y2="16" />
                  <line x1="85" y1="22" x2="81" y2="27" />
                  <line x1="110" y1="60" x2="104" y2="55" />
                </g>
                <text x="10" y="68" fontSize="7" fill="#9ca3af" textAnchor="middle">E</text>
                <text x="60" y="8" fontSize="6" fill="#9ca3af" textAnchor="middle">½</text>
                <text x="110" y="68" fontSize="7" fill="#9ca3af" textAnchor="middle">F</text>
                <g transform={`rotate(${needleAngle} 60 60)`}>
                  <line x1="60" y1="60" x2="60" y2="16" stroke="#1e293b" strokeWidth="2.5" strokeLinecap="round" />
                  <circle cx="60" cy="60" r="4" fill="#1e293b" />
                </g>
              </svg>
              <div className="w-full h-2 bg-paper-gutter rounded-full overflow-hidden mt-1">
                <div className="h-full bg-telemetry-cyan rounded-full transition-all" style={{ width: `${fuelPct}%` }} />
              </div>
            </div>
          </div>
        </div>
        {/* Wheels */}
        <div className="flex justify-between px-8 py-2 bg-slate-800/5 border-t border-rule-line">
          <span className="w-10 h-10 bg-zinc-700 rounded-full border-4 border-zinc-500 shadow-inner flex items-center justify-center">
            <span className="w-3 h-3 bg-zinc-400 rounded-full"></span>
          </span>
          <span className="text-[9px] font-bold tracking-widest uppercase text-on-surface-variant self-center">— Vehicle Cluster —</span>
          <span className="w-10 h-10 bg-zinc-700 rounded-full border-4 border-zinc-500 shadow-inner flex items-center justify-center">
            <span className="w-3 h-3 bg-zinc-400 rounded-full"></span>
          </span>
        </div>
      </div>
    </div>
  );
}
