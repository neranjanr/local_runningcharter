import Link from 'next/link';
import QuickTripForm from '@/components/QuickTripForm';
import { ProtectedRoute } from '@/components/ProtectedRoute';

export default function NewTripPage() {
  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-slate-50/70 pb-20">
        <header className="bg-white border-b border-slate-200 sticky top-0 z-30 px-3 py-2 shadow-sm">
          <div className="max-w-3xl mx-auto flex items-center justify-between">
            <Link href="/trips" className="inline-flex items-center text-xs font-semibold text-slate-700 hover:text-slate-900 transition-colors py-0.5">
              <svg className="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M10 19l-7-7m0 0l7-7m-7 7h18" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5"></path>
              </svg>
              <span>Back to Ledger</span>
            </Link>
            <div className="flex items-center space-x-2">
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-300 tracking-wider">
                FLEET-PRO
              </span>
            </div>
          </div>
        </header>
        <QuickTripForm />
      </div>
    </ProtectedRoute>
  );
}
