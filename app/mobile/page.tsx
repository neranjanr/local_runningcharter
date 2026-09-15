import Link from 'next/link';
import MobileEntry from '@/components/mobile/MobileQuickTripForm';

export default function MobilePage() {
  return (
    <div className="min-h-full py-6">
      <div className="max-w-3xl mx-auto mb-4 flex items-center justify-between px-2">
        <div>
          <h1 className="text-xl font-bold tracking-tight">QuickTrip Mobile</h1>
          <p className="text-xs text-zinc-500">Buffer Sheet staging — works when deployment DB is unreachable (ADR 0014)</p>
        </div>
        <Link href="/" className="text-sm text-telemetry-cyan hover:underline">← Dashboard</Link>
      </div>
      <MobileEntry />
      <p className="max-w-3xl mx-auto mt-6 px-2 text-[11px] text-zinc-400">
        Standalone PWA lives in <code>quicktrip-mobile/</code> sibling folder. This <code>/mobile</code> route reuses the same Sheet Proxy + queue logic for single-deploy installs. Configure Sheet URL in Settings.
      </p>
    </div>
  );
}
