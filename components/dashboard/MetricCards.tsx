'use client';

import React from 'react';
import type { DashboardMetrics } from '@/lib/dashboardCalculations';
import type { Vehicle } from '@/types';

interface Props {
  metrics: DashboardMetrics;
  prevMetrics?: DashboardMetrics;
  thisMonthLabel?: string;
  prevMonthLabel?: string;
  vehicle?: Vehicle | null;
}

function formatDdMmYyyy(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}

export function MetricCards({ metrics, prevMetrics, thisMonthLabel, prevMonthLabel, vehicle }: Props) {
  const odoStr = String(Math.round(metrics.lastOdo)).padStart(6, '0');
  const odoDateLabel = metrics.lastOdoDate ? `as at ${formatDdMmYyyy(metrics.lastOdoDate)}` : 'as at —';
  // Gauge: 0% (even if balance <0) → flat LEFT, 50% → top, 100% (even if >capacity) → flat RIGHT — clamped
  const fuelPct = Math.min(100, Math.max(0, metrics.fuelLevelPercent));
  const needleAngle = (fuelPct / 100) * 180; // 0→LEFT (0deg), 90→TOP, 180→RIGHT (line initially points LEFT)
  const prev = prevMetrics ?? { officialKm: 0, privateKm: 0, totalKm: 0, tripCount: 0 } as DashboardMetrics;
  const thisBusinessPct = metrics.totalKm > 0 ? (metrics.officialKm / metrics.totalKm) * 100 : 0;
  const thisPrivatePct = 100 - thisBusinessPct;
  const totalLabel = thisMonthLabel ?? 'This Month Stats';
  const prevLabel = prevMonthLabel ?? 'Previous Month Stats';

  const brandModel = vehicle ? `${vehicle.brand} ${vehicle.model}`.trim() : '—';
  const typeFuelTank = vehicle ? `${vehicle.vehicle_type} • ${vehicle.fuel_type} • ${vehicle.tank_capacity.toFixed(1)} L` : '—';
  const regNo = vehicle?.registration_no?.trim() ?? '';

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Monthly Distances — dark card */}
      <section className="lg:col-span-4 bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col justify-between" data-purpose="distance-analytics-summary">
        <div>
          <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
            <h2 className="text-xs font-bold uppercase tracking-widest text-amber-400 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-400"></span>
              Monthly Distances
            </h2>
            <span className="text-xs text-slate-400 font-mono bg-slate-800 px-2.5 py-0.5 rounded border border-slate-700">{new Date().getFullYear()}</span>
          </div>
          {/* This Month */}
          <div className="bg-slate-950/60 rounded-xl p-4 border border-slate-800/80 mb-4">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-400 mb-3 uppercase tracking-wider">
              <span>{totalLabel}</span>
              <span className="text-[10px] text-emerald-400 bg-emerald-950/80 border border-emerald-800 px-1.5 py-0.5 rounded">In Progress</span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center divide-x divide-slate-800">
              <div className="px-1" data-testid="metric-official">
                <span className="block text-[10px] font-medium text-slate-400 uppercase tracking-tight">Official</span>
                <span className="block text-xl font-bold font-mono text-emerald-400 mt-1">{Math.round(metrics.officialKm)} <span className="text-xs text-emerald-300">KM</span></span>
                <span className="inline-block text-[11px] text-slate-400 mt-0.5 font-medium">{metrics.tripCount} trips</span>
              </div>
              <div className="px-1" data-testid="metric-private">
                <span className="block text-[10px] font-medium text-slate-400 uppercase tracking-tight">Private</span>
                <span className="block text-xl font-bold font-mono text-amber-400 mt-1">{Math.round(metrics.privateKm)} <span className="text-xs text-amber-300">KM</span></span>
                <span className="inline-block text-[11px] text-slate-400 mt-0.5 font-medium">Personal</span>
              </div>
              <div className="px-1" data-testid="metric-total">
                <span className="block text-[10px] font-medium text-slate-400 uppercase tracking-tight">Total</span>
                <span className="block text-xl font-bold font-mono text-white mt-1">{Math.round(metrics.totalKm)} <span className="text-xs text-slate-400">KM</span></span>
                <span className="inline-block text-[11px] text-slate-400 mt-0.5 font-medium">Ledger span</span>
              </div>
            </div>
            <div className="mt-4 pt-3 border-t border-slate-800/60">
              <div className="flex justify-between text-[11px] text-slate-400 mb-1.5">
                <span className="text-emerald-400 font-medium">{thisBusinessPct.toFixed(1)}% Business</span>
                <span className="text-amber-400 font-medium">{thisPrivatePct.toFixed(1)}% Private</span>
              </div>
              <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden flex">
                <div className="bg-emerald-500 h-full" style={{ width: `${thisBusinessPct}%` }}></div>
                <div className="bg-amber-500 h-full" style={{ width: `${thisPrivatePct}%` }}></div>
              </div>
            </div>
          </div>
          {/* Previous Month */}
          <div className="bg-slate-950/40 rounded-xl p-4 border border-slate-800/60">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-400 mb-3 uppercase tracking-wider">
              <span>{prevLabel}</span>
              <span className="text-[10px] text-slate-400 bg-slate-800 border border-slate-700 px-1.5 py-0.5 rounded">Audited</span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center divide-x divide-slate-800">
              <div className="px-1" data-testid="metric-prev-official">
                <span className="block text-[10px] font-medium text-slate-400 uppercase tracking-tight">Official</span>
                <span className="block text-lg font-bold font-mono text-emerald-400 mt-1">{Math.round(prev.officialKm)} <span className="text-xs text-emerald-300">KM</span></span>
                <span className="inline-block text-[11px] text-slate-500 mt-0.5 font-medium">{(prev as any).tripCount ?? 0} trips</span>
              </div>
              <div className="px-1" data-testid="metric-prev-private">
                <span className="block text-[10px] font-medium text-slate-400 uppercase tracking-tight">Private</span>
                <span className="block text-lg font-bold font-mono text-amber-400 mt-1">{Math.round(prev.privateKm)} <span className="text-xs text-amber-300">KM</span></span>
                <span className="inline-block text-[11px] text-slate-400 mt-0.5 font-medium">—</span>
              </div>
              <div className="px-1" data-testid="metric-prev-total">
                <span className="block text-[10px] font-medium text-slate-400 uppercase tracking-tight">Total</span>
                <span className="block text-lg font-bold font-mono text-white mt-1">{Math.round(prev.totalKm)} <span className="text-xs text-slate-400">KM</span></span>
                <span className="inline-block text-[11px] text-slate-500 mt-0.5 font-medium">Month closed</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Digital Vehicle Cluster — dark bezel */}
      <section className="lg:col-span-8 bg-cluster-bezel rounded-2xl p-3 sm:p-5 border border-slate-700 shadow-2xl relative overflow-hidden" data-purpose="automotive-digital-cluster">
        <div className="absolute top-3 left-3 w-4 h-4 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center" style={{ boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.9), 0 1px 1px rgba(255,255,255,0.2)' }}>
          <div className="w-1.5 h-0.5 bg-slate-600 rotate-45"></div>
        </div>
        <div className="absolute top-3 right-3 w-4 h-4 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center" style={{ boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.9), 0 1px 1px rgba(255,255,255,0.2)' }}>
          <div className="w-1.5 h-0.5 bg-slate-600 -rotate-12"></div>
        </div>
        <div className="absolute bottom-3 left-3 w-4 h-4 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center" style={{ boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.9), 0 1px 1px rgba(255,255,255,0.2)' }}>
          <div className="w-1.5 h-0.5 bg-slate-600 rotate-90"></div>
        </div>
        <div className="absolute bottom-3 right-3 w-4 h-4 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center" style={{ boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.9), 0 1px 1px rgba(255,255,255,0.2)' }}>
          <div className="w-1.5 h-0.5 bg-slate-600 rotate-30"></div>
        </div>
        <div className="bg-gradient-to-b from-slate-950 via-[#0a0f18] to-slate-950 rounded-xl border border-slate-800 p-4 sm:p-6 relative" style={{ boxShadow: 'inset 0 2px 4px 0 rgba(0,0,0,0.8), inset 0 -1px 2px 0 rgba(255,255,255,0.05)' }}>
          {/* Visor Bar */}
          <div className="border-b border-slate-800/80 pb-3 mb-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3" data-purpose="cluster-visor-bar">
            <div className="flex items-center gap-2 order-2 sm:order-1">
              <div className="p-1 rounded bg-slate-900 border border-slate-800 text-slate-600" title="Check Engine: OK"><span className="text-xs">⚙</span></div>
              <div className="p-1 rounded bg-slate-900 border border-slate-800 text-emerald-500/80" title="Battery: Normal"><span className="text-xs">▭</span></div>
              <span className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-[10px] font-bold font-mono text-slate-600">ABS</span>
            </div>
            <div className="order-1 sm:order-2 flex items-center gap-3">
              <div className="text-left sm:text-right">
                <div className="text-xs font-bold text-white tracking-wide uppercase">{brandModel}</div>
                <div className="text-[11px] text-slate-400 font-mono">{typeFuelTank}</div>
              </div>
              {regNo && (
                <div className="bg-slate-100 border border-slate-300 px-2 py-0.5 rounded text-slate-950 font-mono font-black text-xs tracking-wider shadow-inner">
                  {regNo}
                </div>
              )}
            </div>
          </div>
          {/* Dual Core */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
            {/* ODO */}
            <div className="md:col-span-6 bg-slate-900/60 rounded-xl p-4 sm:p-5 border border-slate-800 shadow-inner" data-testid="metric-odo" data-purpose="odometer-subpanel">
              <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
                <span className="flex items-center gap-1.5 text-cyan-400">◷ Last Odo Meter</span>
                <span className="text-[11px] font-mono text-slate-400">ODO HUD</span>
              </div>
              <div className="bg-black/90 p-3 rounded-lg border-2 border-slate-800/90 shadow-2xl flex items-center justify-between">
                <span className="text-xs font-mono font-bold text-slate-400 tracking-wider">ODO</span>
                <div className="flex items-center space-x-1">
                  {odoStr.split('').map((ch, i) => (
                    <div
                      key={i}
                      className={`w-7 sm:w-8 h-10 sm:h-11 rounded border flex items-center justify-center font-mono text-xl sm:text-2xl font-black shadow-inner ${i === odoStr.length - 1 ? 'bg-slate-800 border-slate-600 text-white' : 'bg-slate-900 border-slate-700/80 text-cyan-300'}`}
                      style={{ background: i === odoStr.length - 1 ? undefined : 'linear-gradient(180deg, #05070a 0%, #151a24 45%, #1c2433 52%, #05070a 100%)', textShadow: i !== odoStr.length - 1 ? '0 0 8px rgba(0,229,255,0.6)' : undefined, boxShadow: 'inset 0 3px 6px rgba(0,0,0,0.9), 0 1px 1px rgba(255,255,255,0.08)' }}
                    >
                      {ch}
                    </div>
                  ))}
                </div>
                <span className="text-xs font-mono font-bold text-cyan-400">KM</span>
              </div>
              <div className="mt-4 flex items-baseline justify-between border-t border-slate-800/80 pt-3">
                <div>
                  <div className="text-2xl font-black font-mono tracking-tight text-white">
                    {Math.round(metrics.lastOdo).toLocaleString()} <span className="text-sm font-semibold text-cyan-400">KM</span>
                  </div>
                  <div className="text-[11px] text-slate-400 font-mono mt-0.5">{odoDateLabel}</div>
                </div>
                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">Verified</span>
              </div>
            </div>
            {/* Fuel */}
            <div className="md:col-span-6 bg-slate-900/60 rounded-xl p-4 sm:p-5 border border-slate-800 shadow-inner flex flex-col justify-between" data-testid="metric-fuel" data-purpose="fuel-gauge-subpanel">
              <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                <span className="flex items-center gap-1.5 text-cyan-400">⛽ Fuel Gauge</span>
                <span className="text-[11px] font-mono text-slate-400">Cap: {metrics.tankCapacity.toFixed(1)} L</span>
              </div>
              <div className="flex items-baseline justify-between mt-1 mb-2">
                <div>
                  <div className="text-2xl sm:text-3xl font-black font-mono text-cyan-400 tracking-tight">
                    {metrics.fuelLevel.toFixed(1)} <span className="text-lg font-bold">L</span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-mono text-slate-300">{metrics.tankCapacity.toFixed(1)} L tank • <strong className="text-white">{fuelPct.toFixed(1)}%</strong></div>
                  {fuelPct <= 20 && <span className="text-[10px] text-red-400 font-mono bg-red-950/60 border border-red-900 px-1.5 py-0.5 rounded">Low Fuel</span>}
                </div>
              </div>
              <div className="relative flex flex-col items-center justify-center pt-2 pb-1">
                <svg className="w-64 h-32 overflow-visible" viewBox="0 0 200 100">
                  <path d="M 20 90 A 80 80 0 0 1 180 90" fill="none" stroke="#1e293b" strokeLinecap="round" strokeWidth="12"></path>
                  <line stroke="#f87171" strokeWidth="2" x1="22" x2="10" y1="90" y2="90"></line>
                  <line stroke="#64748b" strokeWidth="1.5" x1="45" x2="36" y1="45" y2="38"></line>
                  <line stroke="#94a3b8" strokeWidth="2" x1="100" x2="100" y1="10" y2="2"></line>
                  <line stroke="#64748b" strokeWidth="1.5" x1="155" x2="164" y1="45" y2="38"></line>
                  <line stroke="#0ea5e9" strokeWidth="2" x1="178" x2="190" y1="90" y2="90"></line>
                  <text fill="#ef4444" fontFamily="'Share Tech Mono', monospace" fontSize="10" fontWeight="bold" x="18" y="98">E</text>
                  <text fill="#94a3b8" fontFamily="'Share Tech Mono', monospace" fontSize="9" x="96" y="24">½</text>
                  <text fill="#38bdf8" fontFamily="'Share Tech Mono', monospace" fontSize="10" fontWeight="bold" x="176" y="98">F</text>
                  <g transform={`rotate(${needleAngle} 100 90)`}>
                    <line stroke="#f43f5e" strokeLinecap="round" strokeWidth="3.5" x1="100" x2="25" y1="90" y2="90" style={{ filter: 'drop-shadow(0 0 3px rgba(244,63,94,0.8))' }}></line>
                    <circle cx="100" cy="90" fill="#0f172a" r="7" stroke="#cbd5e1" strokeWidth="2"></circle>
                    <circle cx="100" cy="90" fill="#f43f5e" r="2.5"></circle>
                  </g>
                </svg>
              </div>
              <div className="w-full h-2 bg-paper-gutter rounded-full overflow-hidden mt-1">
                <div className="h-full bg-telemetry-cyan rounded-full transition-all" style={{ width: `${fuelPct}%` }} />
              </div>
              <div className="mt-1 pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs">
                <span className="text-slate-400 font-mono">Fuel:</span>
                <span className={`font-mono font-bold tracking-wide ${fuelPct <= 20 ? 'text-rose-400' : 'text-emerald-400'}`}>{fuelPct <= 20 ? 'Low' : 'Normal'} • {fuelPct.toFixed(0)}%</span>
              </div>
            </div>
          </div>
          <div className="mt-5 pt-3 border-t border-slate-800/60 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping"></span>
              <span className="text-[10px] font-mono uppercase tracking-widest text-slate-400">• TELEMETRY ONLINE</span>
            </div>
            <div className="text-[11px] font-bold tracking-widest uppercase text-slate-400 flex items-center gap-3">
              <span className="h-px w-8 bg-slate-800 hidden sm:inline-block"></span>
              — VEHICLE CLUSTER —
              <span className="h-px w-8 bg-slate-800 hidden sm:inline-block"></span>
            </div>
            <div className="text-[10px] font-mono text-slate-400 hidden sm:block">FLEET</div>
          </div>
        </div>
      </section>
    </div>
  );
}
