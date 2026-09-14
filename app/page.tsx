'use client';

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import Link from 'next/link';
import type { BookPage, Trip, Vehicle } from '@/types';
import { getVehicleProfile } from '@/lib/vehicleStore';
import { getPages } from '@/lib/pageStore';
import { getTrips } from '@/lib/tripStore';
import { computeThisMonthMetrics, computeMonthlyBreakdown, computePageWiseDistances } from '@/lib/dashboardCalculations';
import { MetricCards } from '@/components/dashboard/MetricCards';
import { MonthlyBreakdownChart } from '@/components/dashboard/MonthlyBreakdownChart';
import { PageWiseChart } from '@/components/dashboard/PageWiseChart';
import { FuelInSummary } from '@/components/dashboard/FuelInSummary';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ContinuityAlertBanner } from '@/components/ContinuityAlertBanner';

export default function DashboardPage() {
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [pages, setPages] = useState<BookPage[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(() => {
    Promise.all([getVehicleProfile(), getPages(), getTrips()]).then(([v, p, t]) => {
      setVehicle(v);
      setPages(p);
      setTrips(t);
    });
  }, []);

  useEffect(() => {
    let mounted = true;
    Promise.all([getVehicleProfile(), getPages(), getTrips()]).then(([v, p, t]) => {
      if (!mounted) return;
      setVehicle(v);
      setPages(p);
      setTrips(t);
      setLoading(false);
    });
    return () => {
      mounted = false;
    };
  }, []);

  // Refresh dashboard when any import (Excel or Sheet Pull) mutates data
  useEffect(() => {
    const handler = () => refresh();
    window.addEventListener('fleetledger:data-changed', handler);
    window.addEventListener('storage', handler);
    // also listen for localStorage writes within same tab via custom poll? fleetledger event covers same-tab
    return () => {
      window.removeEventListener('fleetledger:data-changed', handler);
      window.removeEventListener('storage', handler);
    };
  }, [refresh]);

  const metrics = useMemo(() => computeThisMonthMetrics({ trips, vehicle, pages }), [trips, vehicle, pages]);
  const monthly = useMemo(() => computeMonthlyBreakdown({ trips, pages }), [trips, pages]);
  const pageWise = useMemo(() => computePageWiseDistances({ trips, pages }), [trips, pages]);

  if (loading) {
    return <div className="p-8 text-center text-on-surface-variant">Loading dashboard...</div>;
  }

  const hasData = trips.length > 0 || pages.length > 0;

  return (
    <ProtectedRoute>
      <div className="flex flex-col gap-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-on-surface">Dashboard & Analytics</h1>
            <p className="text-sm text-on-surface-variant">Summary metrics, monthly breakdown, page-wise visualization, and master trip ledger.</p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/trips/new" className="px-4 py-2 bg-slate-surface text-on-primary rounded-lg text-sm font-semibold hover:bg-primary transition-colors">
              + New Trip
            </Link>
          </div>
        </div>

        <ContinuityAlertBanner pages={pages} trips={trips} compact />

      {/* Metric cards */}
      <MetricCards metrics={metrics} />

      {/* Fuel IN Summary — 12 + MORE */}
      {hasData && <FuelInSummary trips={trips} />}

      {/* Vehicle context strip */}
      {vehicle && (
        <div className="flex flex-wrap items-center gap-3 text-xs bg-paper-sheet border border-rule-line rounded-lg px-4 py-2.5">
          <span className="font-bold text-on-surface">
            {vehicle.brand} {vehicle.model}
          </span>
          <span className="text-on-surface-variant">{vehicle.vehicle_type} • {vehicle.fuel_type}</span>
          <span className="ml-auto font-mono text-on-surface-variant">
            Odo: <span className="font-bold text-on-surface">{Math.round(vehicle.current_odometer)} KM</span> • Tank: <span className="font-bold text-on-surface">{vehicle.tank_capacity.toFixed(1)} L</span>
          </span>
        </div>
      )}

      {!hasData ? (
        <div className="bg-paper-sheet rounded-xl border border-rule-line p-12 text-center flex flex-col items-center gap-3">
          <span className="text-4xl">📊</span>
          <h2 className="text-lg font-bold text-on-surface">No trip data yet</h2>
          <p className="text-sm text-on-surface-variant max-w-md">Add your first trip to populate dashboard analytics and monthly charts. Ledger pages are generated automatically.</p>
          <Link href="/trips/new" className="mt-2 px-5 py-2 bg-slate-surface text-on-primary rounded-lg text-sm font-semibold hover:bg-primary">
            Enter First Trip
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <MonthlyBreakdownChart data={monthly} />
          <PageWiseChart data={pageWise} />
        </div>
      )}
      </div>
    </ProtectedRoute>
  );
}
