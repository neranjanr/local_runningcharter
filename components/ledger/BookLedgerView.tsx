'use client';

import React, { useEffect, useMemo, useState } from 'react';
import type { BookPage, Trip, Vehicle } from '@/types';
import { Side1TripsLog } from './Side1TripsLog';
import { Side2FuelTables } from './Side2FuelTables';
import { PageNavigation } from './PageNavigation';
import { computeLedgerDays, computeLedgerSummary, groupTripsByDateForSide1, computePageSeq } from '@/lib/ledgerCalculations';
import { getFuelEconomiesForPage, saveFuelEconomiesForPage } from '@/lib/fuelEconomyStore';
import { getInTanksForPage, saveInTanksForPage } from '@/lib/inTankStore';
import { roundToOneDecimal, roundToIntegerKm } from '@/lib/tripCalculations';
import { ExcelExportButton } from '@/components/ExcelExportButton';
import { EstimateFuelEconomy } from '@/components/ledger/EstimateFuelEconomy';
import { detectPageGaps, detectDayGroupFuelGaps } from '@/lib/continuityAlerts';
import { validatePaginationConstraints } from '@/lib/pagination';
import { rebuildLedger } from '@/lib/pageStore';

interface Props {
  pages: BookPage[];
  trips: Trip[];
  vehicle: Vehicle | null;
  initialPageNumber?: number;
}

export function BookLedgerView({ pages, trips, vehicle, initialPageNumber }: Props) {
  const sortedPages = useMemo(() => [...pages].sort((a, b) => a.page_number - b.page_number), [pages]);

  const [currentPageNumber, setCurrentPageNumber] = useState<number>(() => {
    if (initialPageNumber) return initialPageNumber;
    if (sortedPages.length > 0) return sortedPages[sortedPages.length - 1].page_number;
    return 1;
  });

  // Navigate to initial page when URL search param changes (e.g., Jump to Page from continuity banner)
  useEffect(() => {
    if (initialPageNumber && initialPageNumber !== currentPageNumber) {
      setCurrentPageNumber(initialPageNumber);
    }
  }, [initialPageNumber]);

  // Keep currentPageNumber in sync if pages load later
  useEffect(() => {
    if (sortedPages.length > 0) {
      const exists = sortedPages.some((p) => p.page_number === currentPageNumber);
      if (!exists) setCurrentPageNumber(sortedPages[sortedPages.length - 1].page_number);
    }
  }, [sortedPages, currentPageNumber]);

  const currentPage = useMemo(() => sortedPages.find((p) => p.page_number === currentPageNumber) ?? null, [sortedPages, currentPageNumber]);

  // Fuel economy raw overrides per day for current page
  const [rawEconomies, setRawEconomies] = useState<(number | null)[]>([]);
  const [rawInTanks, setRawInTanks] = useState<(number | null)[]>([]);

  // Load per-page economies and In-Tank when page changes
  useEffect(() => {
    if (!currentPage) {
      setRawEconomies([]);
      setRawInTanks([]);
      return;
    }
    const stored = getFuelEconomiesForPage(currentPage.id);
    // Align length to distinct dates count (if stored shorter, pad)
    setRawEconomies(stored);
    const storedInTank = getInTanksForPage(currentPage.id);
    setRawInTanks(storedInTank);
  }, [currentPage?.id]);

  const handleEconomyChange = (dayIdx: number, value: string) => {
    if (!currentPage) return;
    const next = [...rawEconomies];
    // Ensure array length covers dayIdx
    while (next.length <= dayIdx) next.push(null);
    if (value === '' || value.trim() === '') {
      next[dayIdx] = null;
    } else {
      const n = parseFloat(value);
      next[dayIdx] = isNaN(n) ? null : roundToOneDecimal(n);
    }
    setRawEconomies(next);
    saveFuelEconomiesForPage(currentPage.id, next);
  };

  const handleInTankChange = (dayIdx: number, value: string) => {
    if (!currentPage) return;
    const next = [...rawInTanks];
    while (next.length <= dayIdx) next.push(null);
    if (value === '' || value.trim() === '') {
      next[dayIdx] = null;
    } else {
      const n = parseFloat(value);
      next[dayIdx] = isNaN(n) ? null : roundToOneDecimal(n);
    }
    setRawInTanks(next);
    saveInTanksForPage(currentPage.id, next);
  };

  const ledgerDays = useMemo(() => {
    if (!currentPage) return [];
    return computeLedgerDays({ page: currentPage, trips, economies: rawEconomies, inTanks: rawInTanks });
  }, [currentPage, trips, rawEconomies, rawInTanks]);

  const summary = useMemo(() => computeLedgerSummary(ledgerDays), [ledgerDays]);

  const dayGroups = useMemo(() => {
    if (!currentPage) return [];
    return groupTripsByDateForSide1(trips, currentPage.id);
  }, [currentPage, trips]);

  const grandTotals = useMemo(() => {
    if (dayGroups.length === 0) return { totalDistance: 0, officialKm: 0, privateKm: 0, tripCount: 0 };
    const totalDistance = roundToIntegerKm(dayGroups.reduce((s, g) => s + g.distance, 0));
    const officialKm = roundToIntegerKm(dayGroups.reduce((s, g) => s + g.officialKm, 0));
    const privateKm = roundToIntegerKm(dayGroups.reduce((s, g) => s + g.privateKm, 0));
    const tripCount = dayGroups.reduce((s, g) => s + g.trips.length, 0);
    return { totalDistance, officialKm, privateKm, tripCount };
  }, [dayGroups]);

  const pageSeq = useMemo(() => computePageSeq(dayGroups), [dayGroups]);

  const pageGaps = useMemo(() => detectPageGaps(sortedPages), [sortedPages]);
  const dayGroupFuelGaps = useMemo(() => detectDayGroupFuelGaps(ledgerDays), [ledgerDays]);

  // Pagination rebuild-required warning (5th/6th distinct date per requirement)
  const paginationViolations = useMemo(() => validatePaginationConstraints(sortedPages, trips), [sortedPages, trips]);
  const [rebuildRequired, setRebuildRequired] = useState(false);
  const [rebuildReason, setRebuildReason] = useState<string | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildMsg, setRebuildMsg] = useState<string | null>(null);
  useEffect(() => {
    const check = () => {
      try {
        const flag = typeof window !== 'undefined' && localStorage.getItem('fleetledger.rebuildRequired') === '1';
        const reason = typeof window !== 'undefined' ? localStorage.getItem('fleetledger.rebuildReason') : null;
        const hasViolations = paginationViolations.length > 0;
        setRebuildRequired(flag || hasViolations);
        if (flag && reason) setRebuildReason(reason);
        else if (hasViolations) setRebuildReason(paginationViolations.map(v => `Page ${v.pageNumber}: ${v.violation}`).join('; '));
        else setRebuildReason(null);
      } catch {
        setRebuildRequired(paginationViolations.length > 0);
        setRebuildReason(paginationViolations.length ? paginationViolations.map(v => `Page ${v.pageNumber}: ${v.violation}`).join('; ') : null);
      }
    };
    check();
    const handler = () => check();
    window.addEventListener('fleetledger:rebuild-required', handler);
    window.addEventListener('storage', handler);
    window.addEventListener('fleetledger:data-changed', handler);
    return () => {
      window.removeEventListener('fleetledger:rebuild-required', handler);
      window.removeEventListener('storage', handler);
      window.removeEventListener('fleetledger:data-changed', handler);
    };
  }, [paginationViolations]);

  const handleRebuildFromLedger = async () => {
    setRebuilding(true);
    setRebuildMsg(null);
    try {
      const res = await rebuildLedger();
      setRebuildMsg(res.message);
      if (res.success) {
        try { localStorage.removeItem('fleetledger.rebuildRequired'); localStorage.removeItem('fleetledger.rebuildReason'); } catch {}
        setRebuildRequired(false);
        setRebuildReason(null);
        // Dispatch to refresh other views
        window.dispatchEvent(new CustomEvent('fleetledger:data-changed'));
      }
    } catch (e: any) {
      setRebuildMsg(e?.message || 'Rebuild failed');
    } finally {
      setRebuilding(false);
    }
  };

  const handlePrevPage = () => setCurrentPageNumber((n) => Math.max(1, n - 1));
  const handleNextPage = () => setCurrentPageNumber((n) => Math.min(sortedPages.length, n + 1));
  const handleSelectPage = (num: number) => setCurrentPageNumber(num);

  const handlePrevMonth = () => {
    if (!currentPage) return;
    const months = [...new Set(sortedPages.map((p) => p.month))].sort();
    const idx = months.indexOf(currentPage.month);
    if (idx > 0) {
      const prevMonth = months[idx - 1];
      const firstOfPrevMonth = sortedPages.find((p) => p.month === prevMonth);
      if (firstOfPrevMonth) setCurrentPageNumber(firstOfPrevMonth.page_number);
    }
  };
  const handleNextMonth = () => {
    if (!currentPage) return;
    const months = [...new Set(sortedPages.map((p) => p.month))].sort();
    const idx = months.indexOf(currentPage.month);
    if (idx < months.length - 1) {
      const nextMonth = months[idx + 1];
      const firstOfNextMonth = sortedPages.find((p) => p.month === nextMonth);
      if (firstOfNextMonth) setCurrentPageNumber(firstOfNextMonth.page_number);
    }
  };

  if (sortedPages.length === 0 || !currentPage) {
    return (
      <div className="flex flex-col gap-4">
        <div className="bg-paper-sheet p-8 rounded shadow-sm text-center">
          <h2 className="text-lg font-bold text-on-surface mb-2">No Book Pages Yet</h2>
          <p className="text-sm text-on-surface-variant mb-4">Add your first trip to generate the physical book ledger. Pages are created automatically with strict 4-day and 13-trip constraints.</p>
          <a href="/trips/new" className="inline-flex items-center gap-2 px-4 py-2 bg-slate-surface text-on-primary rounded font-semibold text-sm hover:bg-primary transition-colors">
            + Enter First Trip
          </a>
        </div>
      </div>
    );
  }

  const vehicleLabel = vehicle ? `${vehicle.brand} ${vehicle.model} ${vehicle.registration_no ? `• ${vehicle.registration_no}` : ''} • ${vehicle.tank_capacity.toFixed(1)} L` : undefined;

  return (
    <div className="flex flex-col">
      {/* Print-only vehicle reg header — top right */}
      <div className="hidden print:flex print:justify-end print:mb-2 print:text-xs print:font-bold print:text-black">
        {vehicle?.registration_no && <span>Vehicle: {vehicle.registration_no}</span>}
      </div>
      <PageNavigation
        pages={sortedPages}
        currentPage={currentPage}
        onSelectPage={handleSelectPage}
        onPrevPage={handlePrevPage}
        onNextPage={handleNextPage}
        onPrevMonth={handlePrevMonth}
        onNextMonth={handleNextMonth}
        vehicleLabel={vehicleLabel}
      />
      <div className="flex flex-wrap items-center justify-end gap-2 mb-3 print:hidden">
        <EstimateFuelEconomy trips={trips} pages={sortedPages} vehicle={vehicle} onApplied={() => { if(currentPage){ setRawEconomies([...getFuelEconomiesForPage(currentPage.id)]); }}} />
        <ExcelExportButton pages={sortedPages} trips={trips} vehicle={vehicle} />
      </div>

      {(rebuildRequired || paginationViolations.length > 0) && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm mb-3" data-testid="ledger-rebuild-banner">
          <div className="flex items-start gap-2.5">
            <span className="text-amber-600 text-lg leading-none mt-0.5">⚠️</span>
            <div>
              <p className="text-sm font-bold text-amber-900">Ledger rebuild is required</p>
              <p className="text-xs text-amber-800 mt-0.5">{rebuildReason || paginationViolations.map(v => `Page ${v.pageNumber}: ${v.violation}`).join('; ')} — ledger has 5+ distinct dates on a page (max 4). Please rebuild to re-paginate.</p>
              {rebuildMsg && <p className="text-xs mt-1 font-medium text-amber-900">{rebuildMsg}</p>}
            </div>
          </div>
          <button onClick={handleRebuildFromLedger} disabled={rebuilding} className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold shadow-sm disabled:opacity-50 shrink-0">
            {rebuilding ? 'Rebuilding…' : 'Rebuild Ledger'}
          </button>
        </div>
      )}

      {/* Print: Page 1 = Side1 (Table 1), Page 2 = Side2 Tables side-by-side */}
      <div className="flex flex-col gap-6 print:gap-0">
        <div className="print:break-after-page">
          <Side1TripsLog pageNumber={currentPage.page_number} month={currentPage.month} dayGroups={dayGroups} grandTotals={grandTotals} pageSeq={pageSeq} />
        </div>
        <div className="print:break-before-page">
          <Side2FuelTables
            pageNumber={currentPage.page_number}
            ledgerDays={ledgerDays}
            summary={summary}
            vehicleTankCapacity={vehicle?.tank_capacity ?? 65}
            rawEconomies={rawEconomies}
            rawInTanks={rawInTanks}
            onEconomyChange={handleEconomyChange}
            onInTankChange={handleInTankChange}
            pageGaps={pageGaps}
            dayGroupFuelGaps={dayGroupFuelGaps}
          />
        </div>
      </div>

      {/* Print helper style — dual-page: Side1 page1, Side2 tables side-by-side page2 */}
      <style>{`
        @media print {
          @page { size: landscape; margin: 0.5cm; }
          body { background: white !important; }
          aside, header { display: none !important; }
          main { padding: 0 !important; max-width: none !important; }
          tr.font-semibold { font-weight: 600 !important; }
          [data-testid="continuity-alert-banner"] { display: none !important; }
        }
      `}</style>
    </div>
  );
}
