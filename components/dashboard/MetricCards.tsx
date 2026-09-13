'use client';

import React from 'react';
import type { DashboardMetrics } from '@/lib/dashboardCalculations';

interface Props {
  metrics: DashboardMetrics;
}

export function MetricCards({ metrics }: Props) {
  // ODO graphic: 6-digit mechanical odometer
  const odoStr = String(Math.round(metrics.lastOdo)).padStart(6, '0');
  const odoDateLabel = metrics.lastOdoDate ? `as at ${metrics.lastOdoDate}` : 'as at —';
  const fuelPct = Math.min(100, Math.max(0, metrics.fuelLevelPercent));
  // Gauge needle angle: -90deg (empty) to +90deg (full), 0deg = 50%
  const needleAngle = (fuelPct / 100) * 180 - 90;

  const cards = [
    {
      label: 'Official Distance (This Month)',
      value: `${Math.round(metrics.officialKm)} KM`,
      sub: `${metrics.tripCount} trips tracked`,
      accent: 'text-trip-official',
      bg: 'bg-surface-container-highest',
      border: 'border-trip-official/20',
      testId: 'metric-official',
    },
    {
      label: 'Private Mileage (This Month)',
      value: `${Math.round(metrics.privateKm)} KM`,
      sub: 'Personal usage',
      accent: 'text-trip-private',
      bg: 'bg-surface-container',
      border: 'border-trip-private/20',
      testId: 'metric-private',
    },
    {
      label: 'Total (This Month)',
      value: `${Math.round(metrics.totalKm)} KM`,
      sub: 'Ledger-verified odometer span',
      accent: 'text-primary',
      bg: 'bg-slate-surface',
      textLight: true,
      border: 'border-slate-700',
      testId: 'metric-total',
    },
    {
      label: 'Last ODO Meter',
      value: `${Math.round(metrics.lastOdo).toLocaleString()} KM`,
      sub: odoDateLabel,
      accent: 'text-on-surface',
      bg: 'bg-paper-sheet',
      border: 'border-rule-line',
      testId: 'metric-odo',
      isOdo: true,
    },
    {
      label: 'Fuel Gauge',
      value: `${metrics.fuelLevel.toFixed(1)} L`,
      sub: `${metrics.tankCapacity.toFixed(1)} L tank • ${metrics.fuelLevelPercent.toFixed(1)}%`,
      accent: 'text-telemetry-cyan',
      bg: 'bg-paper-sheet',
      border: 'border-rule-line',
      testId: 'metric-fuel',
      isFuelGauge: true,
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
      {cards.map((c) => (
        <div
          key={c.label}
          data-testid={c.testId}
          className={`rounded-xl p-4 border shadow-sm flex flex-col gap-2 ${c.bg} ${c.border} ${(c as any).textLight ? 'text-on-primary' : 'text-on-surface'}`}
        >
          <span className={`text-[10px] font-bold tracking-widest uppercase ${(c as any).textLight ? 'text-surface-container-highest' : 'text-on-surface-variant'}`}>{c.label}</span>
          {(c as any).isOdo ? (
            <>
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
              <span className="text-2xl font-bold font-mono tracking-tight text-on-surface">{c.value}</span>
              <span className="text-xs text-on-surface-variant">{c.sub}</span>
            </>
          ) : (c as any).isFuelGauge ? (
            <>
              <span className={`text-2xl font-bold font-mono tracking-tight ${(c as any).textLight ? 'text-paper-sheet' : c.accent}`}>{c.value}</span>
              <span className="text-xs text-on-surface-variant">{c.sub}</span>
              <div className="mt-1 flex flex-col items-center">
                {/* Vehicle fuel gauge mimic */}
                <svg width="120" height="70" viewBox="0 0 120 70" className="overflow-visible">
                  <path d="M 10 60 A 50 50 0 0 1 110 60" fill="none" stroke="#e5e7eb" strokeWidth="8" strokeLinecap="round" />
                  <path d="M 10 60 A 50 50 0 0 1 110 60" fill="none" stroke={fuelPct > 20 ? '#06b6d4' : '#ef4444'} strokeWidth="8" strokeLinecap="round" strokeDasharray={`${(fuelPct/100)*157} 157`} />
                  {/* ticks */}
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
                  {/* needle */}
                  <g transform={`rotate(${needleAngle} 60 60)`}>
                    <line x1="60" y1="60" x2="60" y2="16" stroke="#1e293b" strokeWidth="2.5" strokeLinecap="round" />
                    <circle cx="60" cy="60" r="4" fill="#1e293b" />
                  </g>
                </svg>
                <div className="w-full h-2 bg-paper-gutter rounded-full overflow-hidden mt-1">
                  <div className="h-full bg-telemetry-cyan rounded-full transition-all" style={{ width: `${fuelPct}%` }} />
                </div>
              </div>
            </>
          ) : (
            <>
              <span className={`text-2xl font-bold font-mono tracking-tight ${(c as any).textLight ? 'text-paper-sheet' : c.accent}`}>{c.value}</span>
              <span className={`text-xs ${(c as any).textLight ? 'text-surface-container-highest/80' : 'text-on-surface-variant'}`}>{c.sub}</span>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
