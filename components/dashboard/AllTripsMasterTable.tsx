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
import { computeGlobalSeq } from '@/lib/ledgerCalculations';
import { detectTripGaps } from '@/lib/continuityAlerts';
import { updateTrip, type TripUpdateFields } from '@/lib/tripStore';
import {
  generateAllTripsBuffer,
  getAllTripsFileName,
  parseAllTripsWorkbook,
  validateNoOverlap,
  validatePaginationForImport,
  importTripsFromWorkbook,
} from '@/lib/allTripsWorkbook';
import { getPages, savePage } from '@/lib/pageStore';
import { getVehicleProfile } from '@/lib/vehicleStore';
import { getTrips } from '@/lib/tripStore';

interface Props {
  trips: Trip[];
  pages: BookPage[];
  title?: string;
  compact?: boolean;
  onDataChanged?: () => void;
}

type EditableField = 'start_km' | 'end_km' | 'start_time' | 'end_time' | 'trip_type' | 'fuel_pumped_amount' | 'fuel_order_no' | 'places_visited';

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
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const availableMonths = useMemo(() => getAvailableMonths(trips, pages), [trips, pages]);

  const filtered = useMemo(() => {
    return filterAndSortTrips(trips, { search, tripType, month, sortColumn, sortDirection });
  }, [trips, search, tripType, month, sortColumn, sortDirection]);

  const sums = useMemo(() => computeFilteredSums(filtered), [filtered]);

  const globalSeqMap = useMemo(() => computeGlobalSeq(trips), [trips]);

  const tripKmGaps = useMemo(() => detectTripGaps(trips), [trips]);
  const tripKmGapIds = useMemo(() => new Set(tripKmGaps.filter((g) => g.kind === 'km').map((g) => g.tripId)), [tripKmGaps]);

  // Group trips by date for alternating row backgrounds
  const dateGroups = useMemo(() => {
    const groups = new Map<string, number>();
    let idx = 0;
    for (const t of filtered) {
      if (!groups.has(t.date)) groups.set(t.date, idx++);
    }
    return groups;
  }, [filtered]);

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
      fields[field] = value.trim();
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

      // Overlap validation
      const overlapErrors = validateNoOverlap(trips, parseResult.trips);
      if (overlapErrors.length > 0) {
        setImportMsg(`Overlap detected: ${overlapErrors.map((e) => e.message).join('; ')}`);
        setImporting(false);
        return;
      }

      // Pagination validation
      const vehicle = await getVehicleProfile();
      const allPages = await getPages();
      const paginationErrors = validatePaginationForImport(trips, allPages, parseResult.trips);
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
            const j = await bulkRes.json();
            persisted = j.trips ?? result.appendedCount;
          } else {
            const j = await bulkRes.json().catch(() => ({}));
            throw new Error(j.error || `Bulk import HTTP ${bulkRes.status}`);
          }
        } catch (err: any) {
          bulkError = err?.message || String(err);
          // Per-page/per-trip fallback (handles 401 auth case with explicit message)
          if (bulkError && bulkError.includes('Unauthorized')) {
            setImportMsg(`Import failed to save — session expired. Please log in again and re-import. (${bulkError})`);
            setImporting(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
            return;
          }
          // Try per-entity fallback
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
          persisted = 0;
          for (const tr of newTrips) {
            try {
              const res = await fetch('/api/trips', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(tr),
              });
              if (res.status === 401) throw new Error('Unauthorized — please re-login');
              if (!res.ok) throw new Error(`API ${res.status}`);
              persisted++;
            } catch (e: any) {
              if (String(e?.message || e).includes('Unauthorized')) {
                bulkError = e.message;
                break;
              }
              try {
                const raw = localStorage.getItem('fleetledger_trips');
                const arr = raw ? (JSON.parse(raw) as typeof result.trips) : [];
                if (!arr.find((x) => x.id === tr.id)) {
                  arr.push(tr);
                  localStorage.setItem('fleetledger_trips', JSON.stringify(arr));
                  persisted++;
                }
              } catch { /* ignore */ }
            }
          }
          if (bulkError && bulkError.includes('Unauthorized')) {
            setImportMsg(`Import failed to save — session expired. Please log in again and re-import.`);
            setImporting(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
            return;
          }
        }

        if (bulkError && persisted === 0) {
          setImportMsg(`Import computed ${result.appendedCount} trips but failed to persist: ${bulkError}`);
        } else {
          const failed = result.appendedCount - persisted;
          if (result.appendedCount === 0 && result.skippedDuplicates > 0) {
            setImportMsg(`Imported 0 new trips (${result.skippedDuplicates} duplicate records skipped from workbook).`);
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
      return (
        <input
          autoFocus
          type={field === 'fuel_pumped_amount' ? 'text' : 'text'}
          value={editState!.value}
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
        onClick={() => startEdit(trip.id, field, String(trip[field] ?? ''))}
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
              <th className="py-2.5 px-3 border-r border-rule-line">
                <button onClick={() => handleSort('date')} className="flex items-center hover:text-on-surface">
                  Date <SortIcon col="date" />
                </button>
              </th>
              <th className="py-2.5 px-2 text-center border-r border-rule-line">#</th>
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
              <th className="py-2.5 px-3 border-r border-rule-line">
                <button onClick={() => handleSort('places_visited')} className="flex items-center hover:text-on-surface">
                  Route & Purpose <SortIcon col="places_visited" />
                </button>
              </th>
              <th className="py-2.5 px-2 text-right border-r border-rule-line">
                <button onClick={() => handleSort('fuel_pumped_amount')} className="flex items-center ml-auto hover:text-on-surface">
                  Fuel <SortIcon col="fuel_pumped_amount" />
                </button>
              </th>
              <th className="py-2.5 px-2 border-r border-rule-line">Order No</th>
              <th className="py-2.5 px-2">Page</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-rule-line font-body-sm text-sm text-on-surface">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={12} className="py-12 text-center text-sm text-on-surface-variant">
                  No trips match your search and filters.
                </td>
              </tr>
            ) : (
              filtered.map((t) => {
                const hasKmGap = tripKmGapIds.has(t.id);
                const groupIdx = dateGroups.get(t.date) ?? 0;
                const isAltDay = groupIdx % 2 === 1;
                return (
                <tr
                  key={t.id}
                  data-testid={`trip-row-${t.id}`}
                  className={`hover:bg-surface-container-lowest/60 transition-colors ${isAltDay ? 'bg-blue-50/40' : 'bg-white'}`}
                >
                  <td className="py-2 px-3 whitespace-nowrap border-r border-rule-line">
                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-label-caps text-[10px] font-bold uppercase tracking-tight ${isAltDay ? 'bg-surface-container-high text-secondary' : 'bg-surface-container-low text-secondary'}`}>
                      {new Date(t.date + 'T00:00:00').toLocaleDateString('en-US', { day: 'numeric', month: 'short', weekday: 'short' })}
                    </span>
                  </td>
                  <td className="py-2 px-2 text-center font-mono text-xs text-outline border-r border-rule-line">
                    {String(globalSeqMap.get(t.id) ?? '-').padStart(2, '0')}
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
                  <td className="py-2 px-2 border-r border-rule-line">
                    {renderEditableCell(t, 'trip_type', t.trip_type)}
                  </td>
                  <td className="py-2 px-3 max-w-[220px] border-r border-rule-line" title={t.places_visited}>
                    {renderEditableCell(t, 'places_visited', t.places_visited)}
                  </td>
                  <td className="py-2 px-2 text-right font-mono text-xs border-r border-rule-line">
                    {renderEditableCell(t, 'fuel_pumped_amount', (t.fuel_pumped_amount ?? 0) > 0 ? `${(t.fuel_pumped_amount ?? 0).toFixed(1)}L` : '0.0L', 'right')}
                  </td>
                  <td className="py-2 px-2 text-xs font-mono text-on-surface-variant border-r border-rule-line">
                    {renderEditableCell(t, 'fuel_order_no', t.fuel_order_no || '-')}
                  </td>
                  <td className="py-2 px-2 text-xs font-mono">
                    {t.page_id.replace('page-', 'P')}
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
    </div>
  );
}
