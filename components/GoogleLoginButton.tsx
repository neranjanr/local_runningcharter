'use client';

import React from 'react';
import { useAuth } from '@/lib/authContext';

export function GoogleLoginButton() {
  const { user, signInWithGoogle, signOut, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-xs text-paper-ledger">
        <span className="animate-spin">⏳</span> Loading session...
      </div>
    );
  }

  if (user) {
    return (
      <div className="flex items-center justify-between px-3 py-2 bg-slate-800 rounded text-xs text-white">
        <div className="flex items-center gap-2 truncate">
          <span className="w-2 h-2 rounded-full bg-green-500"></span>
          <span className="truncate font-medium text-white">{user.user_metadata?.full_name || user.email || 'Signed In'}</span>
        </div>
        <button
          onClick={() => signOut()}
          className="text-red-400 hover:text-red-300 font-semibold text-[10px] uppercase tracking-wider ml-2"
        >
          Sign Out
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => signInWithGoogle()}
      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-white hover:bg-gray-100 text-gray-800 font-medium rounded text-xs transition-colors shadow-sm border border-gray-300"
    >
      <svg className="w-4 h-4" viewBox="0 0 24 24">
        <path
          fill="#4285F4"
          d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-8.87z"
        />
        <path
          fill="#34A853"
          d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.13 0-5.78-2.11-6.73-4.96H1.15v3.15C3.12 21.32 7.22 24 12 24z"
        />
        <path
          fill="#FBBC05"
          d="M5.27 14.24c-.25-.72-.38-1.49-.38-2.24s.13-1.52.38-2.24V6.61H1.15C.42 8.08 0 9.74 0 12s.42 3.92 1.15 5.39l4.12-3.15z"
        />
        <path
          fill="#EA4335"
          d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.22 0 3.12 2.68 1.15 6.61l4.12 3.15c.95-2.85 3.6-4.96 6.73-4.96z"
        />
      </svg>
      <span>Sign in with Google</span>
    </button>
  );
}
