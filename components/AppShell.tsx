'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { GoogleLoginButton } from './GoogleLoginButton';
import { useAuth } from '@/lib/authContext';

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user } = useAuth();

  const navItems = [
    { label: 'Dashboard & Analytics', href: '/', icon: 'dashboard' },
    { label: 'Physical Book Ledger (Dual-Page)', href: '/ledger', icon: 'auto_stories' },
    { label: 'All Trips Master Table', href: '/trips', icon: 'table_chart' },
    { label: 'Quick Trip Data Entry', href: '/trips/new', icon: 'add_circle' },
    { label: 'Vehicle Profile & Settings', href: '/settings/vehicle', icon: 'settings' },
  ];

  return (
    <div className="min-h-screen flex bg-paper-gutter text-on-surface">
      {/* Sidebar Navigation */}
      <aside className="fixed left-0 top-0 h-full w-72 bg-slate-surface z-50 flex flex-col justify-between shadow-lg hidden lg:flex">
        <div className="flex flex-col">
          <div className="h-16 flex items-center gap-3 px-6 bg-primary-container">
            <span className="text-telemetry-cyan text-2xl font-bold">📖</span>
            <div className="flex flex-col">
              <span className="text-sm font-bold text-on-primary tracking-tight">FleetLedger</span>
              <span className="text-[10px] font-semibold text-on-primary-container tracking-widest uppercase">
                Audit Running Chart
              </span>
            </div>
          </div>
          <div className="px-6 pt-6 pb-2">
            <span className="text-[10px] font-semibold text-on-primary-container uppercase tracking-wider">
              Operational Logs
            </span>
          </div>
          <nav className="flex flex-col gap-1 px-3">
            {navItems.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded text-sm transition-colors ${
                    isActive
                      ? 'bg-primary text-on-primary font-bold'
                      : 'text-paper-ledger hover:bg-primary hover:text-on-primary'
                  }`}
                >
                  <span className="text-lg">{item.icon === 'dashboard' ? '📊' : item.icon === 'auto_stories' ? '📖' : item.icon === 'table_chart' ? '📋' : item.icon === 'add_circle' ? '➕' : '⚙️'}</span>
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="p-4 bg-primary-container text-xs text-on-primary-container border-t border-slate-700 flex flex-col gap-3">
          <GoogleLoginButton />
          <div className="flex items-center justify-between pt-2 border-t border-slate-700/50">
            <span className="uppercase tracking-wider font-semibold text-tertiary-fixed">SEC-24 Registered</span>
            <span className="text-[10px]">v0.1.0</span>
          </div>
        </div>
      </aside>

      {/* Main Content Wrapper */}
      <div className="flex-1 flex flex-col lg:pl-72">
        {/* Mobile Header Bar */}
        <header className="lg:hidden h-16 bg-slate-surface text-on-primary flex items-center justify-between px-4 sticky top-0 z-40 shadow">
          <div className="flex items-center gap-2">
            <span className="text-telemetry-cyan">📖</span>
            <span className="font-bold text-sm">FleetLedger</span>
          </div>
          <div className="flex items-center gap-2">
            {user && (
              <Link
                href="/help"
                aria-label="Help"
                data-testid="header-help-link-mobile"
                className="w-8 h-8 flex items-center justify-center rounded-full bg-primary text-on-primary font-bold text-xs"
              >
                ?
              </Link>
            )}
            <GoogleLoginButton />
          </div>
        </header>
        {/* Desktop top bar */}
        <div className="hidden lg:flex h-12 bg-paper-sheet border-b border-rule-line items-center justify-between px-6 sticky top-0 z-30">
          <div className="flex items-center gap-3">
            <span className="text-xs text-on-surface-variant">FleetLedger • Audit Running Chart</span>
          </div>
          <div className="flex items-center gap-3">
            {user && (
              <Link
                href="/help"
                aria-label="Help"
                data-testid="header-help-link"
                className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-surface text-on-primary font-bold text-sm border border-slate-600 hover:bg-primary"
                title="Help — 8 sections"
              >
                ?
              </Link>
            )}
          </div>
        </div>
        <main className="flex-1 p-4 md:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
