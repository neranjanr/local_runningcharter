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

      {/* Full-Width Stack: T1 on top, T2 and T3 stacked below */}
      <div className="flex flex-col gap-6">
        <Side1TripsLog pageNumber={currentPage.page_number} month={currentPage.month} dayGroups={dayGroups} grandTotals={grandTotals} pageSeq={pageSeq} />
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

      {/* Print helper style */}
      <style>{`
        @media print {
          @page { size: landscape; margin: 0.5cm; }
          body { background: white !important; }
          aside, header { display: none !important; }
          main { padding: 0 !important; max-width: none !important; }
          tr.font-semibold { font-weight: 600 !important; }
        }
      `}</style>
    </div>
  );
}
