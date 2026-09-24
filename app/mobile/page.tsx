import Link from 'next/link';
import MobileEntry from '@/components/mobile/MobileQuickTripForm';

export default function MobilePage() {
  return (
    <div className="min-h-screen bg-slate-50/70 pb-20">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 px-3 py-2 shadow-sm">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <Link href="/trips" className="inline-flex items-center text-xs font-semibold text-slate-700 hover:text-slate-900 transition-colors py-0.5">
            <svg className="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path d="M10 19l-7-7m0 0l7-7m-7 7h18" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5"></path>
            </svg>
            <span>Back to Ledger</span>
          </Link>
          <Link href="/" className="text-xs font-semibold text-sky-600 hover:text-sky-700">← Dashboard</Link>
        </div>
      </header>
      <MobileEntry />
      <p className="max-w-3xl mx-auto mt-6 px-2 text-[11px] text-zinc-400 text-center">
        Standalone PWA lives in <code>quicktrip-mobile/</code> sibling folder — copy <code>Mobile_with_url_private.html</code> to phone. Configure Sheet URL in Settings.
      </p>
    </div>
  );
}
