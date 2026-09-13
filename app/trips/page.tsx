'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import type { BookPage, Trip } from '@/types';
import { getPages } from '@/lib/pageStore';
import { getTrips } from '@/lib/tripStore';
import { AllTripsMasterTable } from '@/components/dashboard/AllTripsMasterTable';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ContinuityAlertBanner } from '@/components/ContinuityAlertBanner';

export default function TripsMasterPage() {
  const [pages, setPages] = useState<BookPage[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => {
    Promise.all([getPages(), getTrips()]).then(([p, t]) => {
      setPages(p);
      setTrips(t);
      setRefreshKey((k) => k + 1);
    });
  }, []);

  useEffect(() => {
    let mounted = true;
    Promise.all([getPages(), getTrips()]).then(([p, t]) => {
      if (!mounted) return;
      setPages(p);
      setTrips(t);
      setLoading(false);
    });
    return () => {
      mounted = false;
    };
  }, []);

  if (loading) {
    return <div className="p-8 text-center text-on-surface-variant">Loading trips...</div>;
  }

  return (
    <ProtectedRoute>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-on-surface">All Trips Master Table</h1>
            <p className="text-sm text-on-surface-variant">Scrollable historical ledger with search, type and month filters, and column sorting.</p>
          </div>
          <Link href="/trips/new" className="px-4 py-2 bg-slate-surface text-on-primary rounded-lg text-sm font-semibold hover:bg-primary transition-colors">
            + New Trip
          </Link>
        </div>

        <ContinuityAlertBanner pages={pages} trips={trips} />

        {trips.length === 0 && (
          <div className="bg-paper-sheet rounded-xl border border-rule-line p-12 text-center flex flex-col items-center gap-3">
            <span className="text-4xl">📋</span>
            <h2 className="text-lg font-bold text-on-surface">No trips recorded</h2>
            <p className="text-sm text-on-surface-variant">Your master table will populate as you add trips or import Excel.</p>
            <Link href="/trips/new" className="mt-2 px-5 py-2 bg-slate-surface text-on-primary rounded-lg text-sm font-semibold hover:bg-primary">
              Enter First Trip
            </Link>
          </div>
        )}
        <AllTripsMasterTable key={refreshKey} trips={trips} pages={pages} compact={false} onDataChanged={refresh} />
      </div>
    </ProtectedRoute>
  );
}
