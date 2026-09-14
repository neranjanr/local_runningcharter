'use client';

import React, { useMemo, useState, useRef, useCallback } from 'react';
import type { Trip, BookPage } from '@/types';
import {
  filterAndSortTrips,
  getAvailableMonths,
  type SortColumn,
  type SortDirection,
  computeFilteredSums,
} from '@/lib/dashboardCalculations';
import { computeGlobalSeq, computeLedgerDays, computeLedgerSummary } from '@/lib/ledgerCalculations';
import { detectTripGaps, detectPageGaps, detectDayGroupFuelGaps } from '@/lib/continuityAlerts';
import { updateTrip, deleteTrip, type TripUpdateFields } from '@/lib/tripStore';
import {
  generateAllTripsBuffer,
  getAllTripsFileName,
  parseAllTripsWorkbook,
  validateNoOverlap,
  validatePaginationForImport,
  importTripsFromWorkbook,
} from '@/lib/allTripsWorkbook';
import { getPages, savePage, rebuildLedger } from '@/lib/pageStore';
import { getVehicleProfile } from '@/lib/vehicleStore';
import { getTrips } from '@/lib/tripStore';
import { estimateStartTime } from '@/lib/tripCalculations';
import { getFuelEconomiesForPage, saveFuelEconomiesForPage } from '@/lib/fuelEconomyStore';
import { getInTanksForPage, saveInTanksForPage } from '@/lib/inTankStore';
import { EstimateFuelEconomy } from '@/components/ledger/EstimateFuelEconomy';
import type { Vehicle } from '@/types';

interface Props {
  trips: Trip[];
  pages: BookPage[];
  title?: string;
  compact?: boolean;
  onDataChanged?: () => void;
}

type EditableField = 'start_km' | 'end_km' | 'start_time' | 'end_time' | 'trip_type' | 'fuel_pumped_amount' | 'fuel_order_no' | 'places_visited' | 'fuel_position' | 'in_tank' | 'fuel_economy';

interface EditState {
  tripId: string;
  field: EditableField;
  value: string;
}

export function AllTripsMasterTable({ trips, pages, title = 'All Trips Master Table', compact = false, onDataChanged }: Props) {
  const [search, setSearch] = useState('');
  const [tripType, setTripType] = useState<'All' | 'Official' | 'Private'>('All');
  const [month, setMonth] = useState<string>('All');
  const [sortColumn, setSortColumn] = useState<SortColumn>('date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [editState, setEditState] = useState<EditState | null>(null);
  const [confirmSave, setConfirmSave] = useState<{ tripId: string; fields: TripUpdateFields } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  React.useEffect(() => { getVehicleProfile().then(setVehicle).catch(()=>{}); }, []);

  const availableMonths = useMemo(() => getAvailableMonths(trips, pages), [trips, pages]);

  const filtered = useMemo(() => {
    return filterAndSortTrips(trips, { search, tripType, month, sortColumn, sortDirection });
  }, [trips, search, tripType, month, sortColumn, sortDirection]);

  const sums = useMemo(() => computeFilteredSums(filtered), [filtered]);

  const globalSeqMap = useMemo(() => computeGlobalSeq(trips), [trips]);

  const tripKmGaps = useMemo(() => detectTripGaps(trips), [trips]);
  const tripKmGapIds = useMemo(() => new Set(tripKmGaps.filter((g) => g.kind === 'km').map((g) => g.tripId)), [tripKmGaps]);

  // Group trips by date for alternating row backgrounds — chronological distinct order among visible rows
  const dateGroups = useMemo(() => {
    const distinctSorted = Array.from(new Set(filtered.map(t => t.date))).sort();
    const map = new Map<string, number>();
    distinctSorted.forEach((d, idx) => map.set(d, idx));
    return map;
  }, [filtered]);

  // Identify earliest date (lowest ODO chronologically) — only this Pos is editable; rest auto-count
  const earliestDate = useMemo(() => {
    if (trips.length === 0) return null;
    return [...trips].map(t=>t.date).sort()[0];
  }, [trips]);

  // Fuel ledger per date — continuous chain: page N start = previous page computed balance (auto-count for continuous range)
  const fuelMap = useMemo(() => {
    const map = new Map<string, { position: number; inTank: number; pumped: number; economy: number; balance: number }>();
    const sortedPages = [...pages].sort((a,b)=>a.page_number-b.page_number);
    let runningFuelPos: number | null = null;
    for (const page of sortedPages) {
      try {
        const economies = getFuelEconomiesForPage(page.id);
        const inTanks = getInTanksForPage(page.id);
        // Continuous carry-forward: use computed running pos instead of stored start_fuel_balance for pages > 1
        const pageForCompute = runningFuelPos !== null ? { ...page, start_fuel_balance: runningFuelPos } : page;
        const days = computeLedgerDays({ page: pageForCompute, trips, economies, inTanks });
        for (const d of days) {
          if (!map.has(d.date)) map.set(d.date, { position: d.fuelPosition, inTank: d.inTank, pumped: d.drawn, economy: d.fuelEconomy, balance: d.balance });
        }
        if (days.length > 0) runningFuelPos = days[days.length - 1].balance;
        else if (runningFuelPos === null) runningFuelPos = page.start_fuel_balance;
      } catch {}
    }
    return map;
  }, [trips, pages]);

  const handleSort = (col: SortColumn) => {
    if (sortColumn === col) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(col);
      setSortDirection(col === 'date' ? 'asc' : 'asc');
    }
  };

  const SortIcon = ({ col }: { col: SortColumn }) => {
    if (sortColumn !== col) return <span className="text-rule-line-strong ml-1">↕</span>;
    return <span className="ml-1 text-telemetry-cyan">{sortDirection === 'asc' ? '↑' : '↓'}</span>;
  };

  // Inline editing
  const startEdit = (tripId: string, field: EditableField, currentValue: string) => {
    setEditState({ tripId, field, value: currentValue });
  };

  const cancelEdit = () => setEditState(null);

  const commitEdit = (tripId: string, field: EditableField, value: string) => {
    const trip = trips.find((t) => t.id === tripId);
    if (!trip) return;

    // Fuel economy / in-tank / position are per-day per-page, handle via stores directly
    if (field === 'fuel_economy' || field === 'in_tank' || field === 'fuel_position') {
      const num = parseFloat(value);
      if (isNaN(num) || num < 0) { cancelEdit(); return; }
      // Fuel Position: only earliest date (lowest ODO) is editable; rest are auto-counted continuous
      if (field === 'fuel_position' && earliestDate && trip.date !== earliestDate) {
        cancelEdit();
        return;
      }
      const dayTrips = trips.filter(t => t.page_id === trip.page_id && t.date === trip.date);
      const dayIndex = dayTrips.length > 0 ? Math.min(...dayTrips.map(d => d.day_index)) : trip.day_index;
      const pageId = trip.page_id;
      if (field === 'fuel_economy') {
        const arr = getFuelEconomiesForPage(pageId);
        while (arr.length < dayIndex) arr.push(null);
        arr[dayIndex - 1] = Math.round(num * 10) / 10;
        saveFuelEconomiesForPage(pageId, arr);
      } else if (field === 'in_tank') {
        const arr = getInTanksForPage(pageId);
        while (arr.length < dayIndex) arr.push(null);
        arr[dayIndex - 1] = Math.round(num * 10) / 10;
        saveInTanksForPage(pageId, arr);
      } else if (field === 'fuel_position') {
        // Continuous auto-count: update Book Opening (first page) and downstream pages will display via running chain
        const sorted = [...pages].sort((a,b)=>a.page_number-b.page_number);
        if (sorted.length === 0) { cancelEdit(); return; }
        const firstPage = sorted[0];
        // Only allow if this trip belongs to first page chronologically
        if (firstPage.id !== pageId) { cancelEdit(); return; }
        firstPage.start_fuel_balance = Math.round(num * 10) / 10;
        // Persist opening; downstream pages' displayed Pos will auto-count via fuelMap continuous chain
        savePage(firstPage).then(() => {
          // Optionally propagate stored start_fuel_balance downstream for continuity alerts (fire-and-forget)
          let running = Math.round(num * 10) / 10;
          (async () => {
            for (let i = 0; i < sorted.length; i++) {
              const p = sorted[i];
              if (i === 0) {
                const days = computeLedgerDays({ page: p, trips, economies: getFuelEconomiesForPage(p.id), inTanks: getInTanksForPage(p.id) });
                running = days.length > 0 ? days[days.length - 1].balance : running;
              } else {
                const updated = { ...p, start_fuel_balance: running };
                // Avoid spamming API, write local only if needed; savePage will handle
                await savePage(updated as BookPage);
                const days = computeLedgerDays({ page: updated as BookPage, trips, economies: getFuelEconomiesForPage(p.id), inTanks: getInTanksForPage(p.id) });
                running = days.length > 0 ? days[days.length - 1].balance : running;
              }
            }
          })();
        });
      }
      setEditState(null);
      onDataChanged?.();
      return;
    }

    const fields: TripUpdateFields = {};
    if (field === 'start_km' || field === 'end_km') {
      const num = parseInt(value, 10);
      if (isNaN(num) || num < 0) { cancelEdit(); return; }
      fields[field] = num;
      // Auto-recalculate distance
      const newStart = field === 'start_km' ? num : trip.start_km;
      const newEnd = field === 'end_km' ? num : trip.end_km;
      fields.trip_distance = newEnd - newStart;
    } else if (field === 'fuel_pumped_amount') {
      const num = parseFloat(value);
      fields.fuel_pumped_amount = isNaN(num) ? 0 : num;
    } else if (field === 'start_time' || field === 'end_time') {
      const v = value.trim();
      if (v === '' || v === '-') {
        // Conditioning: empty keeps existing for end_time validation downstream, start_time optional
        fields[field] = '';
      } else {
        // Conditioning: normalize H:MM / HH:M → HH:MM, reject invalid
        const m = v.match(/^(\d{1,2}):(\d{1,2})(?::\d{2})?$/);
        if (!m) { cancelEdit(); return; }
        let hh = parseInt(m[1], 10);
        let mm = parseInt(m[2], 10);
        if (hh < 0 || hh > 23 || mm < 0 || mm > 59) { cancelEdit(); return; }
        fields[field] = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
        if (field === 'end_time' && !fields[field]) { cancelEdit(); return; }
      }
    } else if (field === 'trip_type') {
      fields.trip_type = value.toLowerCase().includes('priv') ? 'Private' : 'Official';
    } else {
      (fields as Record<string, string>)[field] = value;
    }

    // Check if anything actually changed
    const unchanged = Object.entries(fields).every(([k, v]) => (trip as unknown as Record<string, unknown>)[k] === v);
    if (unchanged) { cancelEdit(); return; }

    setConfirmSave({ tripId, fields });
    setEditState(null);
  };

  const doSave = async () => {
    if (!confirmSave) return;
    await updateTrip(confirmSave.tripId, confirmSave.fields);
    setConfirmSave(null);
    // Run gap detection and alert
    const gaps = detectTripGaps([...trips.filter(t=>t.id!==confirmSave.tripId), {...trips.find(t=>t.id===confirmSave.tripId)!, ...confirmSave.fields} as Trip]);
    if (gaps.length > 0) {
      const kmGaps = gaps.filter(g=>g.kind==='km').length;
      const fuelGaps = gaps.filter(g=>g.kind==='fuel').length;
      if (kmGaps || fuelGaps) setImportMsg(`Gap detected after edit: ${kmGaps} KM gaps, ${fuelGaps} fuel gaps — check ledger continuity`);
    }
    onDataChanged?.();
  };

  const handleDelete = async (tripId: string) => {
    await deleteTrip(tripId);
    setConfirmDelete(null);
    setImportMsg('Record deleted');
    onDataChanged?.();
  };

  // Export
  const handleExport = async () => {
    const buffer = await generateAllTripsBuffer(trips);
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = getAllTripsFileName();
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleRebuildLedger = async () => {
    setImporting(true);
    setImportMsg(null);
    const res = await rebuildLedger();
    setImportMsg(res.message);
    setImporting(false);
    onDataChanged?.();
  };

  // Import
  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportMsg(null);
    try {
      const buffer = await file.arrayBuffer();
      const parseResult = await parseAllTripsWorkbook(buffer);
      if (!parseResult.valid) {
        setImportMsg(`Import failed: ${parseResult.errors.map((e) => `Row ${e.row}: ${e.message}`).join('; ')}`);
        setImporting(false);
        return;
      }

      // Conditioning: if Start Times not there, estimate via end_time - distance/20 ceiled to 5min
      for (const t of parseResult.trips) {
        if ((!t.start_time || String(t.start_time).trim() === '') && t.end_time && t.trip_distance) {
          const est = estimateStartTime(t.end_time!, Number(t.trip_distance));
          if (est) t.start_time = est;
        }
      }

      // Overlap/pagination should ignore rows that are upserts (same date+odo) – they update in place
      const isExactOdoMatch = (t: Partial<Trip>) => trips.some(e => e.date === t.date && Math.round(e.start_km) === Math.round(Number(t.start_km ?? NaN)) && Math.round(e.end_km) === Math.round(Number(t.end_km ?? NaN)));
      const newOnlyTrips = parseResult.trips.filter(t => !isExactOdoMatch(t));
      const overlapErrors = validateNoOverlap(trips, newOnlyTrips);
      if (overlapErrors.length > 0) {
        setImportMsg(`Overlap detected: ${overlapErrors.map((e) => e.message).join('; ')}`);
        setImporting(false);
        return;
      }

      // Pagination validation – only new trips affect pagination
      const vehicle = await getVehicleProfile();
      const allPages = await getPages();
      const paginationErrors = validatePaginationForImport(trips, allPages, newOnlyTrips);
      if (paginationErrors.length > 0) {
        setImportMsg(`Pagination error: ${paginationErrors.map((e) => e.message).join('; ')}`);
        setImporting(false);
        return;
      }

      const result = importTripsFromWorkbook({
        existingTrips: trips,
        existingPages: allPages,
        parsedTrips: parseResult.trips,
        vehicleId: vehicle.id,
        opening: { openingKm: vehicle.current_odometer, openingFuel: (vehicle as unknown as Record<string, unknown>).current_fuel_level as number ?? 10 },
      });

      if (result.success) {
        // Bulk persist via /api/import (transactional, single round-trip for 200+ rows)
        // Fallback to per-trip/per-page if bulk endpoint unavailable (e.g. older build)
        let persisted = 0;
        let bulkError: string | null = null;
        try {
          const bulkRes = await fetch('/api/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pages: result.pages, trips: result.trips }),
          });
          if (bulkRes.ok) {
            await bulkRes.json().catch(() => ({}));
            persisted = result.appendedCount + result.updatedCount;
          } else {
            const j = await bulkRes.json().catch(() => ({}));
            throw new Error(j.error || `Bulk import HTTP ${bulkRes.status}`);
          }
        } catch (err: any) {
          bulkError = err?.message || String(err);
          // Always try localStorage fallback even on 401 – app works offline via localStorage
          const existingPageIds = new Set(allPages.map((p) => p.id));
          for (const pg of result.pages) {
            if (!existingPageIds.has(pg.id)) {
              try { await savePage(pg); } catch { /* fallback inside savePage writes localStorage */ }
            } else {
              const orig = allPages.find((p) => p.id === pg.id);
              if (orig && (orig.page_number !== pg.page_number || orig.start_km !== pg.start_km || orig.end_km !== pg.end_km || orig.start_fuel_balance !== pg.start_fuel_balance || orig.end_fuel_balance !== pg.end_fuel_balance || orig.month !== pg.month)) {
                try { await savePage(pg); } catch { /* ignore */ }
              }
            }
          }
          const existingTripIds = new Set(trips.map((t) => t.id));
          const newTrips = result.trips.filter((t) => !existingTripIds.has(t.id));
          const updatedTrips = result.updatedCount > 0 ? result.trips.filter((t) => {
            if (!existingTripIds.has(t.id)) return false;
            const orig = trips.find(o => o.id === t.id);
            return !!orig && (orig.start_time !== t.start_time || orig.end_time !== t.end_time || orig.fuel_pumped_amount !== t.fuel_pumped_amount || (orig.fuel_order_no ?? '') !== (t.fuel_order_no ?? '') || orig.places_visited !== t.places_visited || orig.trip_type !== t.trip_type);
          }) : [];
          persisted = 0;
          let authWarning = bulkError && bulkError.includes('Unauthorized') ? ' (session expired – saved locally)' : '';
          // Persist new trips via POST and updated trips via PUT (upsert in localStorage as fallback)
          for (const tr of [...newTrips, ...updatedTrips]) {
            const isUpdate = existingTripIds.has(tr.id);
            let apiOk = false;
            try {
              const res = await fetch('/api/trips', {
                method: isUpdate ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(tr),
              });
              if (res.ok) {
                apiOk = true;
                persisted++;
                continue;
              }
              if (res.status === 401) authWarning = ' (session expired – saved locally)';
            } catch { /* fall through to localStorage */ }
            if (!apiOk) {
              try {
                const raw = localStorage.getItem('fleetledger_trips');
                const arr = raw ? (JSON.parse(raw) as typeof result.trips) : [];
                const idx = arr.findIndex((x: any) => x.id === tr.id);
                if (idx >= 0) arr[idx] = tr;
                else arr.push(tr);
                localStorage.setItem('fleetledger_trips', JSON.stringify(arr));
                persisted++;
              } catch { /* ignore */ }
            }
          }
          // If bulk succeeded there was no catch, set persisted to appended+updated for message consistency
          if (!bulkError) persisted = result.appendedCount + result.updatedCount;
          else if (persisted === 0 && result.updatedCount > 0) {
            // bulk failed but we wrote to localStorage above – ensure updated trips are also written even if newTrips empty
            try {
              localStorage.setItem('fleetledger_trips', JSON.stringify(result.trips));
              localStorage.setItem('fleetledger_book_pages', JSON.stringify(result.pages));
              persisted = result.appendedCount + result.updatedCount;
            } catch { /* ignore */ }
          }
          if (authWarning) bulkError = bulkError ? bulkError + authWarning : authWarning;
        }

        if (bulkError && persisted === 0) {
          setImportMsg(`Import computed ${result.appendedCount} trips but failed to persist: ${bulkError}`);
        } else {
          const failed = (result.appendedCount + result.updatedCount) - persisted;
          if (result.appendedCount === 0 && result.updatedCount === 0 && result.skippedDuplicates > 0) {
            setImportMsg(`Imported 0 new trips (${result.skippedDuplicates} duplicate records skipped from workbook).`);
          } else if (result.updatedCount > 0) {
            setImportMsg(`Imported ${result.appendedCount} new, updated ${result.updatedCount} existing (${result.skippedDuplicates} duplicates skipped)${failed > 0 ? ` — ${failed} failed to save${bulkError ? `: ${bulkError}` : ''}` : ''}${bulkError && bulkError.includes('saved locally') ? bulkError : ''}`);
          } else {
            setImportMsg(`Imported ${persisted} trips (${result.skippedDuplicates} duplicates skipped)${failed > 0 ? ` — ${failed} failed to save${bulkError ? `: ${bulkError}` : ''}` : ''}`);
          }
        }
        onDataChanged?.();
      } else {
        setImportMsg(`Import failed: ${result.errors.map((e) => e.message).join('; ')}`);
      }
    } catch {
      setImportMsg('Failed to read file');
    }
    setImporting(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const renderEditableCell = (trip: Trip, field: EditableField, displayValue: string, align: 'left' | 'right' = 'left') => {
    const isEditing = editState?.tripId === trip.id && editState?.field === field;
    if (isEditing) {
      if (field === 'trip_type') {
        return (
          <select
            autoFocus
            value={editState!.value}
            onChange={(e) => commitEdit(trip.id, field, e.target.value)}
            onBlur={() => cancelEdit()}
            className="w-full px-1 py-0.5 border border-telemetry-cyan rounded text-xs bg-white focus:outline-none focus:ring-1 focus:ring-telemetry-cyan"
          >
            <option value="Official">Official</option>
            <option value="Private">Private</option>
          </select>
        );
      }
      const isTime = field === 'start_time' || field === 'end_time';
      return (
        <input
          autoFocus
          type={isTime ? 'time' : field === 'fuel_pumped_amount' ? 'text' : 'text'}
          value={editState!.value === '-' ? '' : editState!.value}
          onChange={(e) => setEditState({ ...editState!, value: e.target.value })}
          onBlur={() => commitEdit(trip.id, field, editState!.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitEdit(trip.id, field, editState!.value);
            if (e.key === 'Escape') cancelEdit();
          }}
          className={`w-full px-1 py-0.5 border border-telemetry-cyan rounded text-xs font-mono bg-white focus:outline-none focus:ring-1 focus:ring-telemetry-cyan ${align === 'right' ? 'text-right' : ''}`}
        />
      );
    }
    return (
      <span
        className="cursor-pointer hover:bg-surface-container-low rounded px-1 -mx-1 py-0.5"
        onClick={() => {
          const raw = (trip as unknown as Record<string, unknown>)[field];
          const v = raw !== undefined && raw !== null && String(raw) !== '' ? String(raw) : (displayValue !== '-' ? String(displayValue).replace('L','').trim() : '');
          startEdit(trip.id, field, v);
        }}
        title="Click to edit"
      >
        {displayValue}
      </span>
    );
  };

  return (
    <div className="bg-paper-sheet rounded-xl border border-rule-line shadow-sm flex flex-col">
      <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImportFile} />

      {/* Header */}
      <div className="p-4 flex flex-col gap-3 border-b border-rule-line">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-bold tracking-tight text-on-surface">{title}</h3>
            <span className="text-xs font-mono text-on-surface-variant" data-testid="master-visible-count">
              {filtered.length} of {trips.length} trips
            </span>
          </div>
          <div className="flex items-center gap-2">
            <EstimateFuelEconomy trips={trips} pages={pages} vehicle={vehicle} onApplied={() => onDataChanged?.()} />
            <button
              onClick={handleExport}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-surface text-on-primary rounded-lg text-xs font-semibold hover:bg-primary transition-colors shadow-sm"
            >
              <span>📊</span> Export Excel
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-paper-sheet border border-rule-line text-on-surface rounded-lg text-xs font-semibold hover:bg-paper-gutter transition-colors"
            >
              <span>📥</span> {importing ? 'Importing...' : 'Import Excel'}
            </button>
            <button
              onClick={handleRebuildLedger}
              disabled={importing}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-paper-sheet border border-rule-line text-on-surface rounded-lg text-xs font-semibold hover:bg-paper-gutter transition-colors"
            >
              <span>🔄</span> Rebuild Ledger
            </button>
          </div>
        </div>

        {importMsg && (
          <div className={`text-xs px-3 py-2 rounded-lg ${importMsg.includes('failed') || importMsg.includes('error') || importMsg.includes('Overlap') ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-green-50 text-green-700 border border-green-200'}`}>
            {importMsg}
            <button onClick={() => setImportMsg(null)} className="ml-2 font-bold">✕</button>
          </div>
        )}

        <div className="flex flex-col lg:flex-row gap-2">
          <div className="flex-1 relative">
            <input
              aria-label="Search trips"
              placeholder="Search places, date, distance, order no..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full px-3 py-2 pr-8 border border-rule-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-telemetry-cyan/30 focus:border-telemetry-cyan"
            />
            {search && (
              <button
                aria-label="Clear search"
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface text-sm"
              >
                ✕
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <select
              aria-label="Filter by trip type"
              value={tripType}
              onChange={(e) => setTripType(e.target.value as typeof tripType)}
              className="px-3 py-2 border border-rule-line rounded-lg text-sm bg-paper-sheet focus:outline-none focus:ring-2 focus:ring-telemetry-cyan/30"
            >
              <option value="All">All Types</option>
              <option value="Official">Official</option>
              <option value="Private">Private</option>
            </select>
            <select
              aria-label="Filter by month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="px-3 py-2 border border-rule-line rounded-lg text-sm bg-paper-sheet focus:outline-none focus:ring-2 focus:ring-telemetry-cyan/30"
            >
              <option value="All">All Months</option>
              {availableMonths.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className={`overflow-auto ${compact ? 'max-h-[420px]' : 'max-h-[600px]'}`}>
        <table className="w-full text-left border-collapse">
          <thead className="sticky top-0 bg-paper-gutter z-10">
            <tr className="text-[10px] font-bold tracking-widest uppercase text-on-surface-variant border-b border-rule-line-strong">
              <th className="py-2.5 px-2 text-center border-r border-rule-line w-12">#</th>
              <th className="py-2.5 px-2 border-r border-rule-line w-40">
                <button onClick={() => handleSort('date')} className="flex items-center hover:text-on-surface">
                  Date <SortIcon col="date" />
                </button>
              </th>
              <th className="py-2.5 px-2 border-r border-rule-line">Start Time</th>
              <th className="py-2.5 px-2 border-r border-rule-line">End Time</th>
              <th className="py-2.5 px-2 text-right border-r border-rule-line">
                <button onClick={() => handleSort('start_km')} className="flex items-center ml-auto hover:text-on-surface">
                  Start ODO <SortIcon col="start_km" />
                </button>
              </th>
              <th className="py-2.5 px-2 text-right border-r border-rule-line">
                <button onClick={() => handleSort('end_km')} className="flex items-center ml-auto hover:text-on-surface">
                  End ODO <SortIcon col="end_km" />
                </button>
              </th>
              <th className="py-2.5 px-2 text-right border-r border-rule-line">
                <button onClick={() => handleSort('trip_distance')} className="flex items-center ml-auto hover:text-on-surface">
                  KM <SortIcon col="trip_distance" />
                </button>
              </th>
              <th className="py-2.5 px-2 border-r border-rule-line">
                <button onClick={() => handleSort('trip_type')} className="flex items-center hover:text-on-surface">
                  Type <SortIcon col="trip_type" />
                </button>
              </th>
              <th className="py-2.5 px-2 border-r border-rule-line">
                <button onClick={() => handleSort('places_visited')} className="flex items-center hover:text-on-surface">
                  Route <SortIcon col="places_visited" />
                </button>
              </th>
              <th className="py-2.5 px-2 text-right border-r border-rule-line">Pumped</th>
              <th className="py-2.5 px-2 border-r border-rule-line">Order No</th>
              <th className="py-2.5 px-2 text-right border-r border-rule-line">Pos.</th>
              <th className="py-2.5 px-2 text-right border-r border-rule-line">In-Tank</th>
              <th className="py-2.5 px-2 text-right border-r border-rule-line">Econ</th>
              <th className="py-2.5 px-2 text-right border-r border-rule-line">Balance</th>
              <th className="py-2.5 px-2 border-r border-rule-line">Page</th>
              <th className="py-2.5 px-2">Del</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-rule-line font-body-sm text-sm text-on-surface">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={17} className="py-12 text-center text-sm text-on-surface-variant">
                  No trips match your search and filters.
                </td>
              </tr>
            ) : (
              filtered.map((t) => {
                const hasKmGap = tripKmGapIds.has(t.id);
                const groupIdx = dateGroups.get(t.date) ?? 0;
                const isAltDay = groupIdx % 2 === 0;
                const fuel = fuelMap.get(t.date);
                const isEarliest = earliestDate === t.date;
                const tripName = (t.places_visited ?? '').trim().toLowerCase();
                const isDummyOrPrivateTrip = tripName === 'dummy' || tripName === 'private';
                const isPrivateType = t.trip_type === 'Private';
                const shouldOrange = isDummyOrPrivateTrip || isPrivateType;
                const rowBg = shouldOrange ? 'bg-orange-200' : isAltDay ? 'bg-slate-200' : 'bg-white';
                return (
                <tr
                  key={t.id}
                  data-testid={`trip-row-${t.id}`}
                  className={`transition-colors border-b border-rule-line/60 ${rowBg} ${isPrivateType ? 'font-semibold' : ''} ${shouldOrange ? '' : 'hover:bg-amber-50/40'}`}
                >
                  <td className="py-2 px-2 text-center font-mono text-xs text-outline border-r border-rule-line">
                    {String(globalSeqMap.get(t.id) ?? '-').padStart(2, '0')}
                  </td>
                  <td className="py-2 px-2 whitespace-nowrap border-r border-rule-line">
                    <span className="inline-flex items-center gap-1 px-1 py-0.5 rounded font-label-caps text-[10px] font-bold uppercase tracking-tight text-on-surface-variant">
                      {new Date(t.date + 'T00:00:00').toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric', weekday: 'short' })}
                    </span>
                  </td>
                  <td className="py-2 px-2 whitespace-nowrap font-mono text-xs text-outline border-r border-rule-line">
                    {renderEditableCell(t, 'start_time', t.start_time || '-')}
                  </td>
                  <td className="py-2 px-2 whitespace-nowrap font-mono text-xs text-outline border-r border-rule-line">
                    {renderEditableCell(t, 'end_time', t.end_time || '-')}
                  </td>
                  <td className={`py-2 px-2 text-right font-odometer-sm text-xs border-r border-rule-line ${hasKmGap ? 'bg-red-100 font-bold' : ''}`}>
                    {renderEditableCell(t, 'start_km', Math.round(t.start_km).toLocaleString(), 'right')}
                  </td>
                  <td className="py-2 px-2 text-right font-odometer-sm text-xs border-r border-rule-line">
                    {renderEditableCell(t, 'end_km', Math.round(t.end_km).toLocaleString(), 'right')}
                  </td>
                  <td className="py-2 px-2 text-right font-odometer-sm text-xs font-bold text-slate-surface border-r border-rule-line">
                    {Math.round(t.trip_distance).toLocaleString()}
                  </td>
                  <td className="py-2 px-1 border-r border-rule-line">
                    {renderEditableCell(t, 'trip_type', t.trip_type)}
                  </td>
                  <td className="py-2 px-2 max-w-[30%] w-[30%] border-r border-rule-line truncate" title={t.places_visited}>
                    {renderEditableCell(t, 'places_visited', t.places_visited)}
                  </td>
                  <td className="py-2 px-2 text-right font-mono text-xs border-r border-rule-line">
                    {renderEditableCell(t, 'fuel_pumped_amount', (t.fuel_pumped_amount ?? 0) > 0 ? `${(t.fuel_pumped_amount ?? 0).toFixed(1)}` : '0.0', 'right')}
                  </td>
                  <td className="py-2 px-1 text-xs font-mono text-on-surface-variant border-r border-rule-line">
                    {renderEditableCell(t, 'fuel_order_no', t.fuel_order_no || '-')}
                  </td>
                  <td className="py-2 px-2 text-right font-mono text-xs border-r border-rule-line" title={isEarliest ? 'Click to edit opening fuel (auto-counts downstream)' : 'Auto-calculated from opening fuel — edit earliest date only'}>
                    {isEarliest ? renderEditableCell(t, 'fuel_position', fuel ? fuel.position.toFixed(1) : '-', 'right') : <span className="font-mono">{fuel ? fuel.position.toFixed(1) : '-'}</span>}
                  </td>
                  <td className="py-2 px-2 text-right font-mono text-xs border-r border-rule-line">
                    {renderEditableCell(t, 'in_tank', fuel ? fuel.inTank.toFixed(1) : '0.0', 'right')}
                  </td>
                  <td className="py-2 px-2 text-right font-mono text-xs border-r border-rule-line">
                    {renderEditableCell(t, 'fuel_economy', fuel ? fuel.economy.toFixed(1) : '10.5', 'right')}
                  </td>
                  <td className="py-2 px-2 text-right font-mono text-xs font-bold border-r border-rule-line">
                    {fuel ? fuel.balance.toFixed(1) : '-'}
                  </td>
                  <td className="py-2 px-2 text-xs font-mono border-r border-rule-line">
                    {t.page_id.replace('page-', 'P')}
                  </td>
                  <td className="py-2 px-1 text-center">
                    <button onClick={() => setConfirmDelete(t.id)} className="text-red-600 hover:text-red-800 text-xs px-1" title="Delete">🗑️</button>
                  </td>
                </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="p-3 bg-paper-gutter rounded-b-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-[11px] font-semibold tracking-widest uppercase text-on-surface-variant border-t border-rule-line" data-testid="master-footer-sums">
        <span data-testid="master-footer-count">
          {filtered.length} rows • Sorted by {sortColumn} ({sortDirection})
        </span>
        <span data-testid="master-footer-distances" className="font-mono normal-case tracking-normal text-xs font-bold">
          Official {sums.officialKm.toLocaleString()} KM • Private {sums.privateKm.toLocaleString()} KM • Total {sums.totalKm.toLocaleString()} KM
        </span>
      </div>

      {/* Confirmation Dialog */}
      {confirmSave && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setConfirmSave(null)}>
          <div className="bg-paper-sheet rounded-xl shadow-xl p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-on-surface mb-2">Confirm Save</h3>
            <p className="text-sm text-on-surface-variant mb-4">
              Save changes to trip on {trips.find((t) => t.id === confirmSave.tripId)?.date}?
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmSave(null)}
                className="px-4 py-2 text-sm font-semibold text-on-surface-variant hover:bg-paper-gutter rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={doSave}
                className="px-4 py-2 text-sm font-semibold text-on-primary bg-slate-surface rounded-lg hover:bg-primary transition-colors"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setConfirmDelete(null)}>
          <div className="bg-paper-sheet rounded-xl shadow-xl p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-on-surface mb-2">Confirm Delete</h3>
            <p className="text-sm text-on-surface-variant mb-4">
              Delete trip on {trips.find((t) => t.id === confirmDelete)?.date} ({trips.find((t) => t.id === confirmDelete)?.start_km}–{trips.find((t) => t.id === confirmDelete)?.end_km})? This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmDelete(null)} className="px-4 py-2 text-sm font-semibold text-on-surface-variant hover:bg-paper-gutter rounded-lg transition-colors">Cancel</button>
              <button onClick={() => handleDelete(confirmDelete)} className="px-4 py-2 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
