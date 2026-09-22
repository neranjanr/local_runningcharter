'use client';

import React, { useEffect } from 'react';

type Props = { open: boolean; onClose: () => void };

type Insight = {
  icon: string;
  title: string;
  blurb: string;
  accent: string;
};

const insights: Insight[] = [
  {
    icon: '📖',
    title: 'Living Ledger',
    blurb: 'Mimics the paper book — 4 dates and 13 trips per page, month forces a new page. Drop a back-dated trip and pages renumber 1…N without touching dates.',
    accent: 'border-slate-200 bg-slate-50',
  },
  {
    icon: '⏱',
    title: 'Time That Thinks',
    blurb: 'Empty start time is derived from distance with tiered speeds (15–35 km/h) and ceiled to 5 minutes. Your manual time is never auto-clobbered.',
    accent: 'border-sky-200 bg-sky-50',
  },
  {
    icon: '⛽',
    title: 'Fuel That Balances',
    blurb: 'Closing = Position + In-Tank + Drawn − Consumed (1 decimal). Economy inherits forward; nudge it ±0.1 and an Adjusted badge appears until you revert to the inherited value.',
    accent: 'border-teal-200 bg-teal-50',
  },
  {
    icon: '🟠',
    title: 'Private at a Glance',
    blurb: 'Private rows glow orange in ledger and All Trips. In calendar, black Xn (official) and orange Xm badges sit side-by-side — even X1 — with an orange dot on private trips in the expanded month.',
    accent: 'border-orange-200 bg-orange-50',
  },
  {
    icon: '📅',
    title: 'Calendar That Knows',
    blurb: '2024–2027 Sri Lankan holidays tint each cell (Poya rose, mercantile amber, weekend slate). Leaves outrank everything. Hit ⛶ on any month to see fuel, order no, route and km per trip.',
    accent: 'border-amber-200 bg-amber-50',
  },
  {
    icon: '🩹',
    title: 'Gap Healing',
    blurb: 'Red means km gap, amber means fuel gap. Fill a gap with no shift, insert after with downstream +Δ, or remove with −Δ — all with a 3-trip preview and page refuel.',
    accent: 'border-rose-200 bg-rose-50',
  },
  {
    icon: '📊',
    title: 'Dashboard That Speaks',
    blurb: 'This vs last month, monthly breakdown, page-wise distances, and a fuel-trend ribbon (gaps = odometer loss) — continuity alerts surface before they snowball.',
    accent: 'border-indigo-200 bg-indigo-50',
  },
  {
    icon: '🔗',
    title: 'Sheets Without Tangle',
    blurb: 'One Excel template; one Google Buffer Sheet via an Apps Script proxy (GET allRows / POST rewriteSheet). Push preserves un-imported phone rows; pull diffs by Odo Key.',
    accent: 'border-emerald-200 bg-emerald-50',
  },
  {
    icon: '📱',
    title: 'Pocket Entry',
    blurb: 'A single-file PWA built from your config — Add to Home Screen, works offline with IndexedDB queue, seeds start-km from last 10 sheet rows.',
    accent: 'border-violet-200 bg-violet-50',
  },
  {
    icon: '🖥',
    title: 'Service That Stays',
    blurb: 'start-service.ps1 prints its launch time in cmd, builds, registers a logon task (SYSTEM, restart ×3) and opens localhost:8082 — DB and storage are never wiped.',
    accent: 'border-zinc-200 bg-zinc-50',
  },
];

export function FeatureInsightsDialog({ open, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-3 sm:p-4" onClick={onClose} data-testid="feature-insights-dialog">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="feature-insights-title"
        className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="h-1.5 w-full bg-gradient-to-r from-slate-900 via-indigo-600 to-sky-500" />
        <div className="px-6 sm:px-7 py-5 flex items-start justify-between gap-4 border-b border-slate-100">
          <div>
            <h2 id="feature-insights-title" className="text-xl font-bold tracking-tight text-slate-900">
              Feature Insights
            </h2>
            <p className="text-sm text-slate-500 mt-1 leading-relaxed">
              A quick tour of what FleetLedger does for you — <span className="font-medium text-slate-700">why it exists</span>, not how to click it. For steps, see <span className="font-semibold">Help (?).</span>
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            data-testid="feature-insights-close"
            className="shrink-0 w-9 h-9 flex items-center justify-center rounded-full bg-slate-900 text-white hover:bg-slate-800 border border-slate-700"
          >
            ✕
          </button>
        </div>

        <div className="overflow-auto flex-1 p-5 sm:p-6 bg-slate-50/60">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {insights.map(it => (
              <div key={it.title} className={`rounded-xl border ${it.accent} p-4 flex gap-3`}>
                <div className="w-10 h-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-lg shrink-0 shadow-sm">
                  {it.icon}
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-slate-900 tracking-tight">{it.title}</h3>
                  <p className="text-[13px] leading-relaxed text-slate-600 mt-1">{it.blurb}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <p className="text-xs leading-relaxed text-slate-500">
              <span className="font-semibold text-slate-700">Tip:</span> Insights are look-only. Edits, gaps, and imports still happen where they belong — ledger, All Trips, calendar, and your sheet.
            </p>
            <button
              onClick={onClose}
              className="shrink-0 px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 border border-slate-700"
            >
              Got it
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
