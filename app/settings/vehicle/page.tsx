'use client';

import VehicleProfileForm from '@/components/VehicleProfileForm';
import SpeedSlabSettings from '@/components/SpeedSlabSettings';
import Link from 'next/link';
import { ProtectedRoute } from '@/components/ProtectedRoute';

export default function VehicleSettingsPage() {
  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-zinc-50 dark:bg-black py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto mb-8 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">FleetLedger Settings</h1>
          <Link
            href="/"
            className="text-sm font-medium text-cyan-600 dark:text-cyan-400 hover:underline flex items-center gap-1"
          >
            ← Back to Dashboard
          </Link>
        </div>
        <div className="max-w-3xl mx-auto space-y-6">
          <SpeedSlabSettings />
          <VehicleProfileForm />
        </div>
      </div>
    </ProtectedRoute>
  );
}
