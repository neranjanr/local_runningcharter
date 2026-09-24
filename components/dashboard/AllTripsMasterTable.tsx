'use client';

import React, { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { Trip, BookPage } from '@/types';
import {
  filterAndSortTrips,
  getAvailableMonths,
  type SortColumn,
  type SortDirection,
  computeFilteredSums,
} from '@/lib/dashboardCalculations';
import { computeGlobalSeq, computeLedgerDays, computeLedgerSummary, computeTripFuelMap } from '@/lib/ledgerCalculations';
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
import { estimateStartTime, roundToIntegerKm, roundToOneDecimal, calculateTripDistance, calculateEndKm, parseTimeToMinutes, formatMinutesToTime, calculateDurationMinutes } from '@/lib/tripCalculations';
import { getStoredSpeedConfigSync, loadSpeedConfig } from '@/lib/speedConfig';
import { getFuelEconomiesForPage, saveFuelEconomiesForPage } from '@/lib/fuelEconomyStore';
import { getInTanksForPage, saveInTanksForPage } from '@/lib/inTankStore';
import { EstimateFuelEconomy } from '@/components/ledger/EstimateFuelEconomy';
import { sortTripsChronologically, shiftForInsert, shiftForRemove } from '@/lib/tripShift';
import { validatePaginationConstraints, recalculatePageBalancesFromOpening, assignPageForNewTrip } from '@/lib/pagination';
import type { Vehicle } from '@/types';
import { SheetSettingsDialog } from '@/components/SheetSettingsDialog';
import { getSheetSettings, fetchAllRows, fetchAllWithLeaves, getLastPullAt, setLastPullAt, pushAllWithLeaves, getLastPushAt, setLastPushAt } from '@/lib/sheetClient';
import { compareBufferToDb, compareLeavesBufferToDb, type PullComparison, type LeavesPullComparison } from '@/lib/sheetPull';
import { computePreservedRows, buildDbBufferRows, buildPushPayload, computePreservedLeaves, buildDbLeavesRows, buildPushLeavesPayload } from '@/lib/sheetPush';
import type { BufferTrip, BufferLeave } from '@/lib/sheetClient';
import type { LeaveDay } from '@/types';
import { getLeaves, saveLeave } from '@/lib/leaveStore';
import { importLeavesFromWorkbook } from '@/lib/allTripsWorkbook';
import { getDayTypeInfo, getHoliday } from '@/lib/sriLankanHolidays';
import { validateTripsOnOffDays } from '@/lib/holidayValidation';

interface Props {
  trips: Trip[];
  pages: BookPage[];
  title?: string;
  compact?: boolean;
  onDataChanged?: () => void;
  initialFocusId?: string | null;
}

type EditableField = 'start_km' | 'end_km' | 'start_time' | 'end_time' | 'trip_type' | 'fuel_pumped_amount' | 'fuel_order_no' | 'places_visited' | 'fuel_position' | 'in_tank' | 'fuel_economy';

interface EditState {
  tripId: string;
  field: EditableField;
  value: string;
}

interface GapPair {
  predecessor: Trip;
  successor: Trip;
  expected: number;
  actual: number;
  delta: number;
}

export function AllTripsMasterTable({ trips, pages, title = 'All Trips Master Table', compact = false, onDataChanged, initialFocusId }: Props) {
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

  // Gap / Insert / Remove states
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [menuAnchorRect, setMenuAnchorRect] = useState<DOMRect | null>(null);
  const menuButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  // Row right-click Private/Official toggle
  const [rowContextMenu, setRowContextMenu] = useState<{ tripId: string; x: number; y: number } | null>(null);
  const [confirmToggle, setConfirmToggle] = useState<Trip | null>(null);
  const [gapFillTarget, setGapFillTarget] = useState<GapPair | null>(null);
  const [gapFillForm, setGapFillForm] = useState<{ date: string; places_visited: string; start_time: string; end_time: string; trip_type: 'Official' | 'Private'; fuel_pumped_amount: string; fuel_order_no: string }>({ date: '', places_visited: '', start_time: '', end_time: '', trip_type: 'Official', fuel_pumped_amount: '0', fuel_order_no: '' });
  const [gapFillError, setGapFillError] = useState<string | null>(null);
  const [insertTarget, setInsertTarget] = useState<{ anchor: Trip; sortedIdx: number } | null>(null);
  const [insertForm, setInsertForm] = useState<{ date: string; start_km: string; end_km: string; distance: string; places_visited: string; start_time: string; end_time: string; trip_type: 'Official' | 'Private'; fuel_pumped_amount: string; fuel_order_no: string }>({ date: '', start_km: '', end_km: '', distance: '', places_visited: '', start_time: '', end_time: '', trip_type: 'Official', fuel_pumped_amount: '0', fuel_order_no: '' });
  const [insertError, setInsertError] = useState<string | null>(null);
  const [insertConfirm, setInsertConfirm] = useState<{ delta: number; downstreamCount: number; preview: Array<{ before: Trip; after: Trip }>; newTrip: Trip } | null>(null);
  const [removeTarget, setRemoveTarget] = useState<{ trip: Trip; sortedIdx: number; delta: number; downstream: Trip[] } | null>(null);
  // Insert After — Speed Slab / Traffic parity with QuickTripForm
  const [insertTrafficMode, setInsertTrafficMode] = useState<'traffic' | 'light'>('traffic');
  const [isInsertTrafficMode, setIsInsertTrafficMode] = useState<boolean>(false);
  useEffect(() => {
    loadSpeedConfig().then(c => setIsInsertTrafficMode(c.mode === 'traffic')).catch(()=>{});
    const handler = () => setIsInsertTrafficMode(getStoredSpeedConfigSync().mode === 'traffic');
    window.addEventListener('fleetledger:speed-config-changed', handler);
    window.addEventListener('storage', handler as EventListener);
    return () => {
      window.removeEventListener('fleetledger:speed-config-changed', handler);
      window.removeEventListener('storage', handler as EventListener);
    };
  }, []);

  // Focus retention (Inserted → new row, Remove/Delete → predecessor)
  const [focusedTripId, setFocusedTripId] = useState<string | null>(null);
  const [importedIds, setImportedIds] = useState<Set<string>>(new Set());
  const rowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const preserveScrollRef = useRef(false);
  const savedScrollTopRef = useRef<number | null>(null);

  // Sheet Pull state
  const [showSheetSettings, setShowSheetSettings] = useState(false);
  const [sheetPulling, setSheetPulling] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [pullComparison, setPullComparison] = useState<PullComparison | null>(null);
  const [leavesPullComparison, setLeavesPullComparison] = useState<LeavesPullComparison | null>(null);
  const [showPullPreview, setShowPullPreview] = useState(false);
  const [selectedNew, setSelectedNew] = useState<Set<string>>(new Set());
  const [selectedChanged, setSelectedChanged] = useState<Set<string>>(new Set());
  const [selectedLeaveNew, setSelectedLeaveNew] = useState<Set<string>>(new Set());
  const [selectedLeaveChanged, setSelectedLeaveChanged] = useState<Set<string>>(new Set());
  const [lastPullAt, setLastPullAtState] = useState<string | null>(null);
  const [lastPushAt, setLastPushAtState] = useState<string | null>(null);
  React.useEffect(() => { setLastPullAtState(getLastPullAt()); setLastPushAtState(getLastPushAt()); }, []);
  // Holiday/Leave state
  const [leaveDates, setLeaveDates] = useState<Set<string>>(new Set());
  const [dayTypeFilter, setDayTypeFilter] = useState<'All' | 'Off' | 'Working'>('All');
  useEffect(() => { getLeaves().then(lvs => setLeaveDates(new Set(lvs.map(l=>l.date)))).catch(()=>{}); }, [trips]);
  useEffect(() => {
    const h = () => getLeaves().then(lvs => setLeaveDates(new Set(lvs.map(l=>l.date)))).catch(()=>{});
    window.addEventListener('fleetledger:data-changed', h);
    window.addEventListener('storage', h);
    return () => { window.removeEventListener('fleetledger:data-changed', h); window.removeEventListener('storage', h); };
  }, []);
  // Start Time Audit state
  // Start Time Audit state (types + state only; handlers after focus helpers)
  type AuditReason = 'Empty' | 'Equal' | 'Inverted' | 'Short';
  interface AuditRow { trip: Trip; reason: AuditReason; estimated: string | null; durationMin: number | null; estMin: number | null; deltaMin: number | null; }
  const [showStartAudit, setShowStartAudit] = useState(false);
  const [startAuditRows, setStartAuditRows] = useState<AuditRow[]>([]);
  const [selectedStartIds, setSelectedStartIds] = useState<Set<string>>(new Set());
  const [auditFixing, setAuditFixing] = useState(false);
  const [auditFilter, setAuditFilter] = useState<'All' | AuditReason>('All');

  // Sheet Push state
  const [sheetPushing, setSheetPushing] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  const [showPushPreview, setShowPushPreview] = useState(false);
  const [pushPreview, setPushPreview] = useState<{ dbCount: number; preserved: BufferTrip[]; overwritingCount: number; invalidIgnored: number; mergedRows: BufferTrip[]; mergedRowsExact: BufferTrip[]; dbRows: BufferTrip[]; leavesDbCount: number; leavesPreserved: BufferLeave[]; leavesOverwriting: number; leavesInvalid: number; mergedLeaves: BufferLeave[]; mergedLeavesExact: BufferLeave[]; leavesDbRows: BufferLeave[] } | null>(null);
  const [pushExpanded, setPushExpanded] = useState(false);
  const [pushExactMirror, setPushExactMirror] = useState(false);

  const availableMonths = useMemo(() => getAvailableMonths(trips, pages), [trips, pages]);

  const filteredBase = useMemo(() => {
    return filterAndSortTrips(trips, { search, tripType, month, sortColumn, sortDirection });
  }, [trips, search, tripType, month, sortColumn, sortDirection]);

  const filtered = useMemo(() => {
    if (dayTypeFilter === 'All') return filteredBase;
    return filteredBase.filter(t => {
      const info = getDayTypeInfo(t.date, leaveDates);
      return dayTypeFilter === 'Off' ? info.isOffDay : !info.isOffDay;
    });
  }, [filteredBase, dayTypeFilter, leaveDates]);

  const sums = useMemo(() => computeFilteredSums(filtered), [filtered]);
  const offDaySummary = useMemo(() => validateTripsOnOffDays(filtered, leaveDates), [filtered, leaveDates]);

  const globalSeqMap = useMemo(() => computeGlobalSeq(trips), [trips]);

  const tripKmGaps = useMemo(() => detectTripGaps(trips), [trips]);
  const tripKmGapIds = useMemo(() => new Set(tripKmGaps.filter((g) => g.kind === 'km').map((g) => g.tripId)), [tripKmGaps]);

  // Chronological sorted trips and gap pairs for Fill Gap / Shift
  const sortedAll = useMemo(() => sortTripsChronologically(trips), [trips]);
  const sortedIdToIndex = useMemo(() => {
    const m = new Map<string, number>();
    sortedAll.forEach((t, i) => m.set(t.id, i));
    return m;
  }, [sortedAll]);

  const gapPairs: GapPair[] = useMemo(() => {
    const pairs: GapPair[] = [];
    for (let i = 0; i < sortedAll.length - 1; i++) {
      const cur = sortedAll[i];
      const nxt = sortedAll[i + 1];
      const expected = roundToIntegerKm(cur.end_km);
      const actual = roundToIntegerKm(nxt.start_km);
      if (expected !== actual) {
        pairs.push({ predecessor: cur, successor: nxt, expected, actual, delta: actual - expected });
      }
    }
    return pairs;
  }, [sortedAll]);

  const predecessorGapMap = useMemo(() => {
    const m = new Map<string, GapPair>();
    for (const p of gapPairs) m.set(p.predecessor.id, p);
    return m;
  }, [gapPairs]);

  const successorGapMap = useMemo(() => {
    const m = new Map<string, GapPair>();
    for (const p of gapPairs) m.set(p.successor.id, p);
    return m;
  }, [gapPairs]);

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
  const { fuelMap, tripFuelMap } = useMemo(() => {
    const map = new Map<string, { position: number; inTank: number; pumped: number; economy: number; balance: number }>();
    const dateEconomy = new Map<string, number>();
    const dateInTank = new Map<string, number>();
    const sortedPages = [...pages].sort((a,b)=>a.page_number-b.page_number);
    let runningFuelPos: number | null = null;
    let openingFuel = sortedPages.length > 0 ? sortedPages[0].start_fuel_balance : 10;
    for (const page of sortedPages) {
      try {
        const economies = getFuelEconomiesForPage(page.id);
        const inTanks = getInTanksForPage(page.id);
        // Continuous carry-forward: use computed running pos instead of stored start_fuel_balance for pages > 1
        const pageForCompute = runningFuelPos !== null ? { ...page, start_fuel_balance: runningFuelPos } : page;
        const days = computeLedgerDays({ page: pageForCompute, trips, economies, inTanks });
        for (const d of days) {
          if (!map.has(d.date)) map.set(d.date, { position: d.fuelPosition, inTank: d.inTank, pumped: d.drawn, economy: d.fuelEconomy, balance: d.balance });
          if (!dateEconomy.has(d.date)) dateEconomy.set(d.date, d.fuelEconomy);
          if (!dateInTank.has(d.date)) dateInTank.set(d.date, d.inTank);
        }
        if (days.length > 0) runningFuelPos = days[days.length - 1].balance;
        else if (runningFuelPos === null) runningFuelPos = page.start_fuel_balance;
      } catch {}
    }
    // Trip-level map with economy after pumped trip (intra-day split)
    let tripFuelMap = new Map<string, { position: number; economy: number; balance: number; pumped: number; inTank: number; drawn: number }>();
    try {
      tripFuelMap = computeTripFuelMap({ trips, pages, dateEconomy, dateInTank, openingFuel });
    } catch {}
    return { fuelMap: map, tripFuelMap };
  }, [trips, pages]);

  const focusTrip = useCallback((tripId: string | null, opts?: { clearFilter?: boolean }) => {
    if (!tripId) return;
    // If filtered view hides the row, clear filters per Q1
    if (opts?.clearFilter) {
      setSearch('');
      setMonth('All');
      setSortColumn('date');
      setSortDirection('asc');
      setImportMsg('Filter cleared to show focused row');
    }
    setFocusedTripId(tripId);
    // flash imported set also
    setTimeout(() => setFocusedTripId(null), 3200);
    // scroll after render
    requestAnimationFrame(() => {
      setTimeout(() => {
        const el = rowRefs.current.get(tripId);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 150);
    });
  }, []);

  React.useEffect(() => {
    if (!focusedTripId) return;
    const t = setTimeout(() => setFocusedTripId(null), 3200);
    return () => clearTimeout(t);
  }, [focusedTripId]);

  React.useEffect(() => {
    if (importedIds.size === 0) return;
    const t = setTimeout(() => setImportedIds(new Set()), 3200);
    return () => clearTimeout(t);
  }, [importedIds]);

  // Preserve scroll position for inline edits — stay on same row instead of jumping to top
  React.useEffect(() => {
    if (preserveScrollRef.current && savedScrollTopRef.current !== null && tableContainerRef.current) {
      const top = savedScrollTopRef.current;
      requestAnimationFrame(() => {
        if (tableContainerRef.current) tableContainerRef.current.scrollTop = top;
      });
      preserveScrollRef.current = false;
      savedScrollTopRef.current = null;
    }
  }, [trips]);

  // Deep-link focus from Continuity banner (?focus=tripId)
  React.useEffect(() => {
    if (!initialFocusId || trips.length === 0) return;
    const exists = trips.some((t) => t.id === initialFocusId);
    if (exists) {
      focusTrip(initialFocusId, { clearFilter: true });
    } else {
      // fallback: nearest ODO/trip
      const sorted = [...trips].sort((a, b) => a.date.localeCompare(b.date) || a.start_km - b.start_km);
      const fallback = sorted[0]?.id;
      if (fallback) focusTrip(fallback, { clearFilter: true });
    }
  }, [initialFocusId, trips]);

  const notifyDataChanged = useCallback(() => {
    onDataChanged?.();
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('fleetledger:data-changed'));
  }, [onDataChanged]);

  const preserveTableScroll = useCallback(() => {
    if (tableContainerRef.current) {
      savedScrollTopRef.current = tableContainerRef.current.scrollTop;
      preserveScrollRef.current = true;
    }
  }, []);

  const handleSort = (col: SortColumn) => {
    if (sortColumn === col) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(col);
      setSortDirection(col === 'date' ? 'asc' : 'asc');
    }
  };

  // Start Time Audit handlers (after focus helpers)
  const computeAuditRows = useCallback((): AuditRow[] => {
    const cfg = getStoredSpeedConfigSync();
    const tm = cfg.mode === 'traffic' ? 'traffic' as const : undefined;
    const rows: AuditRow[] = [];
    const sorted = sortTripsChronologically(trips);
    for (const t of sorted) {
      const dist = roundToIntegerKm(Number(t.trip_distance) || 0);
      const est = t.end_time && dist > 0 ? estimateStartTime(t.end_time, dist, tm) : null;
      const s = (t.start_time || '').trim();
      const e = (t.end_time || '').trim();
      if (!s) {
        if (est) {
          rows.push({ trip: t, reason: 'Empty', estimated: est, durationMin: null, estMin: est ? calculateDurationMinutes(est, e) : null, deltaMin: null });
        }
        continue;
      }
      if (s === e) {
        const dur = e ? calculateDurationMinutes(s, e) : null;
        const estMin = est && e ? calculateDurationMinutes(est, e) : null;
        rows.push({ trip: t, reason: 'Equal', estimated: est, durationMin: dur, estMin, deltaMin: estMin!=null && dur!=null ? estMin - dur : null });
        continue;
      }
      if (e && parseTimeToMinutes(s) > parseTimeToMinutes(e)) {
        const dur = calculateDurationMinutes(s, e);
        const isShortOvernight = dur < 360;
        if (!isShortOvernight) {
          const estMin = est && e ? calculateDurationMinutes(est, e) : null;
          rows.push({ trip: t, reason: 'Inverted', estimated: est, durationMin: dur, estMin, deltaMin: estMin!=null ? estMin - dur : null });
          continue;
        }
      }
      if (est && e) {
        const actualDur = calculateDurationMinutes(s, e);
        const estDur = calculateDurationMinutes(est, e);
        if (actualDur < estDur) {
          rows.push({ trip: t, reason: 'Short', estimated: est, durationMin: actualDur, estMin: estDur, deltaMin: estDur - actualDur });
        }
      }
    }
    return rows;
  }, [trips]);
  const handleOpenStartAudit = useCallback(() => {
    const rows = computeAuditRows();
    setStartAuditRows(rows);
    setSelectedStartIds(new Set(rows.filter(r=>r.estimated).map(r=>r.trip.id)));
    setAuditFilter('All');
    setShowStartAudit(true);
  }, [computeAuditRows]);
  const handleFixSelectedStarts = useCallback(async () => {
    const toFix = startAuditRows.filter(r=> selectedStartIds.has(r.trip.id) && r.estimated);
    if (toFix.length===0) return;
    setAuditFixing(true);
    let fixed = 0;
    let earliestId: string | null = null;
    let earliestDate = '';
    for (const row of toFix) {
      const tid = row.trip.id;
      const newStart = row.estimated!;
      try {
        preserveTableScroll();
        await updateTrip(tid, { start_time: newStart });
        fixed++;
        if (!earliestId || row.trip.date < earliestDate) { earliestId = tid; earliestDate = row.trip.date; }
      } catch {}
    }
    setAuditFixing(false);
    setShowStartAudit(false);
    setImportMsg(`Fixed ${fixed} start time${fixed!==1?'s':''} (Traffic estimate)`);
    notifyDataChanged();
    if (earliestId) focusTrip(earliestId);
  }, [startAuditRows, selectedStartIds, preserveTableScroll, notifyDataChanged, focusTrip]);

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
      preserveTableScroll();
      setEditState(null);
      // highlight edited row without scrolling away
      setFocusedTripId(tripId);
      setTimeout(() => setFocusedTripId(null), 2200);
      notifyDataChanged();
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
    const savedId = confirmSave.tripId;
    preserveTableScroll();
    await updateTrip(confirmSave.tripId, confirmSave.fields);
    setConfirmSave(null);
    // Run gap detection and alert
    const gaps = detectTripGaps([...trips.filter(t=>t.id!==savedId), {...trips.find(t=>t.id===savedId)!, ...confirmSave.fields} as Trip]);
    if (gaps.length > 0) {
      const kmGaps = gaps.filter(g=>g.kind==='km').length;
      const fuelGaps = gaps.filter(g=>g.kind==='fuel').length;
      if (kmGaps || fuelGaps) setImportMsg(`Gap detected after edit: ${kmGaps} KM gaps, ${fuelGaps} fuel gaps — check ledger continuity`);
    }
    // stay on same row — highlight without scrolling away
    setFocusedTripId(savedId);
    setTimeout(() => setFocusedTripId(null), 2200);
    notifyDataChanged();
  };

  const handleDelete = async (tripId: string) => {
    const idx = sortedIdToIndex.get(tripId) ?? -1;
    let focusId: string | null = null;
    let needsClear = false;
    if (idx >= 0) {
      if (idx > 0) focusId = sortedAll[idx - 1]?.id ?? null;
      else if (sortedAll.length > 1) focusId = sortedAll[1]?.id ?? null;
    }
    if (focusId && !filtered.some(t=>t.id===focusId)) needsClear = true;
    await deleteTrip(tripId);
    setConfirmDelete(null);
    setImportMsg('Record deleted');
    notifyDataChanged();
    if (focusId) focusTrip(focusId, { clearFilter: needsClear });
  };

  // Persist helper: bulk via /api/import with localStorage fallback
  const persistTripsAndPages = async (newTrips: Trip[], recomputedPages: BookPage[], toastMsg: string, removedId?: string) => {
    // Optimistic localStorage write
    try {
      localStorage.setItem('fleetledger_trips', JSON.stringify(newTrips));
      localStorage.setItem('fleetledger_book_pages', JSON.stringify(recomputedPages));
    } catch {}
    // Try bulk API
    try {
      const res = await fetch('/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pages: recomputedPages, trips: newTrips }) });
      if (!res.ok) throw new Error('bulk import failed');
    } catch {
      // fallback: try per-page save
      for (const p of recomputedPages) {
        try { await savePage(p); } catch {}
      }
      // fallback: per-trip via /api/trips PUT/POST handled by localStorage already; for removed, try DELETE
    }
    if (removedId) {
      try { await fetch(`/api/trips?id=${encodeURIComponent(removedId)}`, { method: 'DELETE' }); } catch {}
      // localStorage already removed
    }
    setImportMsg(toastMsg);
    notifyDataChanged();
  };

  const recomputePagesForTrips = async (newTrips: Trip[]): Promise<BookPage[]> => {
    const vp = await getVehicleProfile().catch(()=>null);
    const openingKm = vp ? roundToIntegerKm((vp.current_odometer ?? 0)) : 0;
    const openingFuel = vp ? roundToOneDecimal((vp as unknown as Record<string, unknown>).current_fuel_level as number ?? 10) : 10;
    return recalculatePageBalancesFromOpening({ pages, trips: newTrips, opening: { openingKm, openingFuel } });
  };

  // Gap Fill handlers
  const openGapFill = (pair: GapPair) => {
    setGapFillTarget(pair);
    setGapFillForm({ date: pair.predecessor.date, places_visited: '', start_time: '', end_time: '', trip_type: 'Official', fuel_pumped_amount: '0', fuel_order_no: '' });
    setGapFillError(null);
    setOpenMenuId(null);
  };

  const handleGapFillSave = async () => {
    if (!gapFillTarget) return;
    // Validate gap still exists
    const currentGaps = detectTripGaps(trips);
    const stillExists = currentGaps.some(g => g.tripId === gapFillTarget.successor.id && g.expected === gapFillTarget.expected && g.actual === gapFillTarget.actual);
    // Also check via sorted recompute
    if (!stillExists) {
      // re-derive via sortedAll gap check
      const check = gapPairs.find(p => p.predecessor.id === gapFillTarget.predecessor.id && p.successor.id === gapFillTarget.successor.id);
      if (!check) {
        setGapFillError('Gap no longer exists');
        return;
      }
    }
    const startKm = roundToIntegerKm(gapFillTarget.expected);
    const endKm = roundToIntegerKm(gapFillTarget.actual);
    if (endKm < startKm) { setGapFillError('End KM must be >= Start KM'); return; }
    if (!gapFillForm.places_visited.trim()) { setGapFillError('Places Visited is required'); return; }
    if (!gapFillForm.end_time.trim()) { setGapFillError('End Time is required'); return; }
    if (gapFillForm.date < gapFillTarget.predecessor.date || gapFillForm.date > gapFillTarget.successor.date) {
      setGapFillError(`Date must be between ${gapFillTarget.predecessor.date} and ${gapFillTarget.successor.date}`);
      return;
    }
    if (!['Official','Private'].includes(gapFillForm.trip_type)) { setGapFillError('Trip Type must be Official or Private'); return; }

    // Build new trip
    const vp = await getVehicleProfile().catch(()=>null);
    const vehicleId = vp?.id ?? 'veh-1';
    // Determine page assignment
    const assignment = assignPageForNewTrip({ pages, trips, newTripDate: gapFillForm.date });
    if ('allowed' in assignment && (assignment as any).allowed === false) {
      setGapFillError(`Cannot add trip: ${ (assignment as any).reason } limit reached for ${gapFillForm.date}`);
      return;
    }
    const assign = assignment as { pageId: string; dayIndex: number; tripIndex: number };
    const newTrip: Trip = {
      id: `trip-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      vehicle_id: vehicleId,
      page_id: assign.pageId,
      date: gapFillForm.date,
      day_index: assign.dayIndex,
      trip_index: assign.tripIndex,
      start_time: gapFillForm.start_time.trim(),
      end_time: gapFillForm.end_time.trim(),
      start_km: startKm,
      end_km: endKm,
      trip_distance: roundToIntegerKm(endKm - startKm),
      trip_type: gapFillForm.trip_type,
      places_visited: gapFillForm.places_visited.trim(),
      fuel_pumped_amount: parseFloat(gapFillForm.fuel_pumped_amount) || 0,
      fuel_order_no: gapFillForm.fuel_order_no.trim(),
      created_at: new Date().toISOString(),
    };
    // Validate pagination pre-flight with no-shift insertion
    // Gap fill is no-shift: insert between predecessor and successor without moving successor
    const sortedIdx = sortedIdToIndex.get(gapFillTarget.predecessor.id) ?? -1;
    const newSorted = [...sortedAll];
    newSorted.splice(sortedIdx + 1, 0, newTrip);
    // Validate pagination constraints for the newSorted set (with recomputed pages)
    const recomputed = await recomputePagesForTrips(newSorted);
    const violations = validatePaginationConstraints(recomputed, newSorted);
    if (violations.length > 0) {
      setGapFillError(`Pagination violation: ${violations.map(v=>v.violation).join('; ')}`);
      return;
    }
    // Persist
    await persistTripsAndPages(newSorted, recomputed, `Gap filled — ${newTrip.start_km}→${newTrip.end_km} (${newTrip.trip_distance} km)`);
    setGapFillTarget(null);
    const gapNeedsClear = search !== '' || month !== 'All' || tripType !== 'All';
    focusTrip(newTrip.id, { clearFilter: gapNeedsClear });
  };

  // Insert After helpers — mirror QuickTripForm reciprocal + Estimated Start Time
  const parseIntKmInsert = (str: string): number => {
    const n = parseFloat(str);
    return isNaN(n) ? NaN : Math.round(n);
  };
  const maybeAutoEstimateInsert = (nextDistanceStr: string, nextEndTime: string, currentStartTime: string) => {
    if (currentStartTime !== '') return null;
    const d = parseIntKmInsert(nextDistanceStr);
    if (isNaN(d) || d <= 0) return null;
    if (!nextEndTime || !nextEndTime.includes(':')) return null;
    const tm = isInsertTrafficMode ? insertTrafficMode : undefined;
    const estimated = estimateStartTime(nextEndTime, d, tm);
    return estimated;
  };
  const nudgeInsertStartTime = (deltaMin: number) => {
    if (!insertForm.start_time || !insertForm.start_time.includes(':')) return;
    const cur = parseTimeToMinutes(insertForm.start_time);
    const next = formatMinutesToTime(cur + deltaMin);
    setInsertForm(prev => ({ ...prev, start_time: next }));
  };
  const handleAutoInsertEstimate = () => {
    const d = parseIntKmInsert(insertForm.distance);
    // distance may be empty — derive from start/end
    let distStr = insertForm.distance;
    let distNum = d;
    if ((isNaN(distNum) || distNum <= 0) && insertForm.start_km && insertForm.end_km) {
      const s = parseIntKmInsert(insertForm.start_km);
      const e = parseIntKmInsert(insertForm.end_km);
      if (!isNaN(s) && !isNaN(e)) { distNum = calculateTripDistance(s, e); distStr = String(distNum); }
    }
    if (isNaN(distNum) || distNum <= 0) { setInsertError('Enter Distance and End Time to estimate Start Time.'); return; }
    if (!insertForm.end_time || !insertForm.end_time.includes(':')) { setInsertError('Enter End Time to estimate Start Time.'); return; }
    const tm = isInsertTrafficMode ? insertTrafficMode : undefined;
    const estimated = estimateStartTime(insertForm.end_time, distNum, tm);
    if (!estimated) { setInsertError('Cannot estimate Start Time (check Distance and End Time).'); return; }
    setInsertForm(prev => ({ ...prev, start_time: estimated }));
    setInsertError(null);
  };

  // Insert After handlers
  const openInsert = (trip: Trip) => {
    const idx = sortedIdToIndex.get(trip.id) ?? -1;
    setInsertTarget({ anchor: trip, sortedIdx: idx });
    setInsertForm({ date: trip.date, start_km: String(roundToIntegerKm(trip.end_km)), end_km: '', distance: '', places_visited: '', start_time: '', end_time: '', trip_type: 'Official', fuel_pumped_amount: '0', fuel_order_no: '' });
    setInsertError(null);
    setOpenMenuId(null);
  };

  const handleInsertPreview = () => {
    if (!insertTarget) return;
    const startNum = parseInt(insertForm.start_km, 10);
    const endNum = parseInt(insertForm.end_km, 10);
    if (isNaN(startNum) || isNaN(endNum)) { setInsertError('Start KM and End KM are required integers'); return; }
    const s = roundToIntegerKm(startNum);
    const e = roundToIntegerKm(endNum);
    if (e < s) { setInsertError('End KM must be >= Start KM'); return; }
    if (!insertForm.places_visited.trim()) { setInsertError('Places Visited is required'); return; }
    if (!insertForm.end_time.trim()) { setInsertError('End Time is required'); return; }
    if (!['Official','Private'].includes(insertForm.trip_type)) { setInsertError('Trip Type must be Official or Private'); return; }
    // date clamp: must be within [anchor date, next date]
    const nextTrip = sortedAll[insertTarget.sortedIdx + 1] ?? null;
    const minDate = insertTarget.anchor.date;
    const maxDate = nextTrip ? nextTrip.date : null;
    if (!insertForm.date) { setInsertError('Date is required'); return; }
    if (insertForm.date < minDate || (maxDate && insertForm.date > maxDate)) {
      setInsertError(`Date must be between ${minDate} and ${maxDate ?? 'future'}`);
      return;
    }
    const delta = e - s;
    const downstream = sortedAll.slice(insertTarget.sortedIdx + 1);
    // Build preview trips for first 3 downstream
    const preview = downstream.slice(0, 3).map(t => ({
      before: t,
      after: { ...t, start_km: roundToIntegerKm(t.start_km + delta), end_km: roundToIntegerKm(t.end_km + delta), trip_distance: roundToIntegerKm(t.trip_distance) },
    }));
    // Build newTrip for confirm (page assignment deferred to confirm)
    const newTripTemp: Trip = {
      id: `trip-preview`,
      vehicle_id: 'veh-1',
      page_id: insertTarget.anchor.page_id,
      date: insertForm.date,
      day_index: 1,
      trip_index: 1,
      start_time: insertForm.start_time.trim(),
      end_time: insertForm.end_time.trim(),
      start_km: s,
      end_km: e,
      trip_distance: roundToIntegerKm(e - s),
      trip_type: insertForm.trip_type,
      places_visited: insertForm.places_visited.trim(),
      fuel_pumped_amount: parseFloat(insertForm.fuel_pumped_amount) || 0,
      fuel_order_no: insertForm.fuel_order_no.trim(),
    };
    setInsertConfirm({ delta, downstreamCount: downstream.length, preview, newTrip: newTripTemp });
    setInsertError(null);
  };

  const handleInsertConfirm = async () => {
    if (!insertTarget || !insertConfirm) return;
    const s = roundToIntegerKm(parseInt(insertForm.start_km, 10));
    const e = roundToIntegerKm(parseInt(insertForm.end_km, 10));
    const delta = e - s;
    const vp = await getVehicleProfile().catch(()=>null);
    const vehicleId = vp?.id ?? 'veh-1';
    const assignment = assignPageForNewTrip({ pages, trips, newTripDate: insertForm.date });
    const sortedPages = [...pages].sort((a,b)=>a.page_number-b.page_number);
    const last = sortedPages[sortedPages.length-1];
    const nextNumber = last ? last.page_number + 1 : 1;

    // Auto-split cases: MAX_TRIPS blocked OR requiresNewPage (MAX_DAYS / MONTH_ROLLOVER)
    const needsNewPage = ('allowed' in assignment && (assignment as any).allowed === false) || (assignment as any).requiresNewPage;
    if (needsNewPage) {
      const isBlocked = 'allowed' in assignment && (assignment as any).allowed === false;
      const targetPageId = isBlocked ? `page-${nextNumber}` : (assignment as any).pageId;
      const targetPageNumber = isBlocked ? nextNumber : (assignment as any).pageNumber;
      const newTrip: Trip = {
        id: `trip-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        vehicle_id: vehicleId,
        page_id: targetPageId,
        date: insertForm.date,
        day_index: isBlocked ? 1 : ((assignment as any).dayIndex ?? 1),
        trip_index: isBlocked ? 1 : ((assignment as any).tripIndex ?? 1),
        start_time: insertForm.start_time.trim(),
        end_time: insertForm.end_time.trim(),
        start_km: s,
        end_km: e,
        trip_distance: roundToIntegerKm(e - s),
        trip_type: insertForm.trip_type,
        places_visited: insertForm.places_visited.trim(),
        fuel_pumped_amount: parseFloat(insertForm.fuel_pumped_amount) || 0,
        fuel_order_no: insertForm.fuel_order_no.trim(),
        created_at: new Date().toISOString(),
      };
      const result = shiftForInsert(sortedAll, insertTarget.sortedIdx, newTrip);
      let recomputed = await recomputePagesForTrips(result.trips);
      if (!recomputed.find(p=>p.id===newTrip.page_id)) {
        const month = insertForm.date.slice(0,7);
        const newPage: BookPage = { id: newTrip.page_id, vehicle_id: vehicleId, page_number: targetPageNumber, month, start_km: s, end_km: e, start_fuel_balance: 10, end_fuel_balance: 10, created_at: new Date().toISOString() };
        recomputed = [...recomputed, newPage].sort((a,b)=>a.page_number-b.page_number);
        const openingKm = vp ? roundToIntegerKm((vp.current_odometer ?? 0)) : 0;
        const openingFuel = vp ? roundToOneDecimal((vp as unknown as Record<string, unknown>).current_fuel_level as number ?? 10) : 10;
        recomputed = recalculatePageBalancesFromOpening({ pages: recomputed, trips: result.trips, opening: { openingKm, openingFuel } });
      }
      await persistTripsAndPages(result.trips, recomputed, `Trip inserted — ${insertConfirm.downstreamCount} trips shifted by ${delta} km`);
      setInsertConfirm(null);
      setInsertTarget(null);
      setInsertError(null);
      const needsClear1 = search !== '' || month !== 'All' || tripType !== 'All';
      focusTrip(newTrip.id, { clearFilter: needsClear1 });
      return;
    }
    const assign = assignment as { pageId: string; dayIndex: number; tripIndex: number };
    const newTrip: Trip = {
      id: `trip-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      vehicle_id: vehicleId,
      page_id: assign.pageId,
      date: insertForm.date,
      day_index: assign.dayIndex,
      trip_index: assign.tripIndex,
      start_time: insertForm.start_time.trim(),
      end_time: insertForm.end_time.trim(),
      start_km: s,
      end_km: e,
      trip_distance: roundToIntegerKm(e - s),
      trip_type: insertForm.trip_type,
      places_visited: insertForm.places_visited.trim(),
      fuel_pumped_amount: parseFloat(insertForm.fuel_pumped_amount) || 0,
      fuel_order_no: insertForm.fuel_order_no.trim(),
      created_at: new Date().toISOString(),
    };
    const result = shiftForInsert(sortedAll, insertTarget.sortedIdx, newTrip);
    const recomputed = await recomputePagesForTrips(result.trips);
    const violations = validatePaginationConstraints(recomputed, result.trips);
    if (violations.length > 0) {
      setInsertError(`Pagination violation: ${violations.map(v=>v.violation).join('; ')}`);
      return;
    }
    await persistTripsAndPages(result.trips, recomputed, `Trip inserted — ${insertConfirm.downstreamCount} trips shifted by ${delta} km`);
    setInsertConfirm(null);
    setInsertTarget(null);
    const needsClear2 = search !== '' || month !== 'All' || tripType !== 'All';
    focusTrip(newTrip.id, { clearFilter: needsClear2 });
  };

  // Remove & Shift handlers
  const openRemoveShift = (trip: Trip) => {
    const idx = sortedIdToIndex.get(trip.id) ?? -1;
    const delta = roundToIntegerKm(trip.end_km) - roundToIntegerKm(trip.start_km);
    const downstream = sortedAll.slice(idx + 1);
    setRemoveTarget({ trip, sortedIdx: idx, delta, downstream });
    setOpenMenuId(null);
  };

  const handleRemoveConfirm = async () => {
    if (!removeTarget) return;
    const result = shiftForRemove(sortedAll, removeTarget.sortedIdx);
    const recomputed = await recomputePagesForTrips(result.trips);
    // No pagination violation expected on remove (reduces counts), but validate for safety
    const violations = validatePaginationConstraints(recomputed, result.trips);
    if (violations.length > 0) {
      setImportMsg(`Pagination violation after remove: ${violations.map(v=>v.violation).join('; ')}`);
      // continue anyway; empty pages retained
    }
    const focusAfterRemove = (() => {
      const idx = removeTarget.sortedIdx;
      if (idx > 0) return sortedAll[idx - 1]?.id ?? null;
      // if earliest removed, focus the trip that slid into its place (new first)
      return result.trips[0]?.id ?? null;
    })();
    const needsClearR = search !== '' || month !== 'All' || tripType !== 'All';
    await persistTripsAndPages(result.trips, recomputed, `Trip removed — ${removeTarget.downstream.length} trips shifted by ${result.delta} km`, removeTarget.trip.id);
    setRemoveTarget(null);
    if (focusAfterRemove) focusTrip(focusAfterRemove, { clearFilter: needsClearR });
  };

  // Go to Latest (last row of current filtered view, else chronological latest)
  const handleGoToLatest = useCallback(() => {
    const targetList = filtered.length > 0 ? filtered : sortedAll;
    if (targetList.length === 0) return;
    const last = targetList[targetList.length - 1];
    // if filtered hides chronological latest, we could also jump to global latest; prefer filtered's last as "last row of the table"
    const el = rowRefs.current.get(last.id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setFocusedTripId(last.id);
      setTimeout(() => setFocusedTripId(null), 2800);
    } else {
      // fallback via focusTrip
      focusTrip(last.id);
    }
  }, [filtered, sortedAll, focusTrip]);

  // Portal menu: update anchor rect on open, close on scroll/resize
  useEffect(() => {
    if (!openMenuId) { setMenuAnchorRect(null); return; }
    const btn = menuButtonRefs.current.get(openMenuId);
    if (btn) setMenuAnchorRect(btn.getBoundingClientRect());
    const onScrollOrResize = () => {
      const b = openMenuId ? menuButtonRefs.current.get(openMenuId) : null;
      if (b) setMenuAnchorRect(b.getBoundingClientRect());
      else setMenuAnchorRect(null);
    };
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [openMenuId]);

  const closeMenu = useCallback(() => { setOpenMenuId(null); setMenuAnchorRect(null); }, []);
  const closeRowMenu = useCallback(() => setRowContextMenu(null), []);
  const handleRowContextMenu = useCallback((e: React.MouseEvent, trip: Trip) => {
    e.preventDefault();
    closeMenu();
    setRowContextMenu({ tripId: trip.id, x: e.clientX, y: e.clientY });
  }, [closeMenu]);

  const handleToggleTripType = useCallback((trip: Trip) => {
    setRowContextMenu(null);
    setConfirmToggle(trip);
  }, []);

  const doToggleTripType = useCallback(async () => {
    if (!confirmToggle) return;
    const newType = confirmToggle.trip_type === 'Private' ? 'Official' : 'Private';
    const tripId = confirmToggle.id;
    setConfirmToggle(null);
    preserveTableScroll();
    await updateTrip(tripId, { trip_type: newType });
    setFocusedTripId(tripId);
    setTimeout(() => setFocusedTripId(null), 2200);
    notifyDataChanged();
    setImportMsg(`Trip on ${confirmToggle.date} marked as ${newType}`);
  }, [confirmToggle, preserveTableScroll, notifyDataChanged]);

  // Close row context menu on scroll/resize/Escape/click
  useEffect(() => {
    if (!rowContextMenu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRowMenu(); };
    const onScroll = () => closeRowMenu();
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [rowContextMenu, closeRowMenu]);

  // Helper: compact Day badge per spec - Weekday empty, Sat/Sun RED, Poya YELLOW, MH AMBER, PH BLUE, BH RED, HOL SLATE, Leave ORANGE
  const getDayBadge = (date: string) => {
    const info = getDayTypeInfo(date, leaveDates);
    const hol = getHoliday(date);
    if (info.isLeave) {
      return { text: 'Leave', cls: 'bg-orange-100 border-orange-300 text-orange-700', dot: 'bg-orange-500' };
    }
    if (hol?.isPoya) {
      return { text: 'Poya', cls: 'bg-yellow-100 border-yellow-300 text-yellow-800', dot: 'bg-yellow-500' };
    }
    if (hol?.kinds.includes('M')) {
      return { text: 'MH', cls: 'bg-amber-100 border-amber-300 text-amber-800', dot: 'bg-amber-500' };
    }
    if (hol?.kinds.includes('P')) {
      return { text: 'PH', cls: 'bg-sky-100 border-sky-300 text-sky-800', dot: 'bg-sky-600' };
    }
    if (hol?.kinds.includes('B')) {
      return { text: 'BH', cls: 'bg-red-100 border-red-300 text-red-700', dot: 'bg-red-500' };
    }
    if (hol) {
      return { text: 'HOL', cls: 'bg-slate-100 border-slate-300 text-slate-700', dot: 'bg-slate-500' };
    }
    if (info.isWeekend) {
      const isSat = info.dayOfWeek === 'Saturday';
      return { text: isSat ? 'Sat' : 'Sun', cls: 'bg-red-100 border-red-300 text-red-700', dot: 'bg-red-500' };
    }
    return null; // Weekday -> no badge
  };

  // Export Excel
  const handleExport = async () => {
    let leaves: { date: string; note?: string }[] = [];
    try { leaves = await getLeaves(); } catch {}
    const buffer = await generateAllTripsBuffer(trips, vehicle ? { brand: vehicle.brand, model: vehicle.model } : null, leaves);
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = getAllTripsFileName(vehicle ? { brand: vehicle.brand, model: vehicle.model } : null);
    a.click();
    URL.revokeObjectURL(url);
  };

  // Push Preview + Export to Google Sheet (preserving unimported rows — dual-sheet)
  const handlePushToSheet = async () => {
    const { scriptUrl } = getSheetSettings();
    if (!scriptUrl) { setShowSheetSettings(true); return; }
    setPushError(null);
    setImportMsg(null);
    setSheetPushing(true);
    try {
      let bufferRows: BufferTrip[] = [];
      let bufferLeaves: BufferLeave[] = [];
      try {
        const fetched = await fetchAllWithLeaves();
        bufferRows = fetched.rows;
        bufferLeaves = fetched.leaves;
      } catch (e: unknown) {
        // fallback to trips-only fetch for old script
        try {
          bufferRows = await fetchAllRows();
        } catch (e2: unknown) {
          const m = e2 instanceof Error ? e2.message : String(e2);
          const hint = m.includes('Anyone with link') ? m : m + ' — verify Apps Script deployed as "Anyone with link"';
          setPushError(hint);
          setImportMsg(`Sheet not modified: ${hint}`);
          setShowSheetSettings(true);
          setSheetPushing(false);
          return;
        }
      }
      const payload = buildPushPayload({ dbTrips: trips, bufferRows });
      let dbLeaves: LeaveDay[] = [];
      try { dbLeaves = await getLeaves(); } catch {}
      const leavesPayload = buildPushLeavesPayload({ dbLeaves, bufferLeaves });
      setPushPreview({
        dbCount: trips.length,
        preserved: payload.preserved,
        overwritingCount: payload.overwritingCount,
        invalidIgnored: payload.invalidIgnored,
        mergedRows: payload.rows,
        mergedRowsExact: payload.rowsExact,
        dbRows: payload.dbRows,
        leavesDbCount: dbLeaves.length,
        leavesPreserved: leavesPayload.preserved,
        leavesOverwriting: leavesPayload.overwritingCount,
        leavesInvalid: leavesPayload.invalidIgnored,
        mergedLeaves: leavesPayload.leaves,
        mergedLeavesExact: leavesPayload.leavesExact,
        leavesDbRows: leavesPayload.dbRows,
      });
      setPushExpanded(false);
      setPushExactMirror(false);
      setShowPushPreview(true);
    } catch (e: unknown) {
      const m = e instanceof Error ? e.message : String(e);
      setPushError(m);
      setImportMsg(`Sheet not modified: ${m}`);
    }
    setSheetPushing(false);
  };

  const handlePushConfirm = async () => {
    if (!pushPreview) return;
    const { sheetId, scriptUrl } = getSheetSettings();
    if (!sheetId || !scriptUrl) {
      setPushError('Blocked by: Settings — configure Sheet ID and Apps Script URL');
      setImportMsg('Sheet not modified: Blocked by: Settings');
      return;
    }
    setSheetPushing(true);
    setPushError(null);
    try {
      const rowsToPush = pushExactMirror ? pushPreview.mergedRowsExact : pushPreview.mergedRows;
      const leavesToPush = pushExactMirror ? pushPreview.mergedLeavesExact : pushPreview.mergedLeaves;
      await pushAllWithLeaves(rowsToPush, leavesToPush);
      const iso = new Date().toISOString();
      setLastPushAt(iso);
      setLastPushAtState(iso);
      if (pushExactMirror) {
        const leavesMsg = pushPreview.leavesDbCount > 0 ? ` + ${pushPreview.leavesDbCount} leaves` : '';
        setImportMsg(`Exported (exact mirror) — ${pushPreview.dbCount} rows${leavesMsg} — sheet now == app DB`);
      } else {
        const preservedMsg = pushPreview.preserved.length > 0 ? ` (+${pushPreview.preserved.length} preserved)` : '';
        const leavesPreservedMsg = pushPreview.leavesPreserved.length > 0 ? ` (+${pushPreview.leavesPreserved.length} leaves preserved)` : '';
        const leavesMsg = pushPreview.leavesDbCount > 0 || pushPreview.leavesPreserved.length > 0 ? ` + ${pushPreview.leavesDbCount} leaves${leavesPreservedMsg}` : '';
        setImportMsg(`Exported — ${pushPreview.dbCount} rows${preservedMsg}${leavesMsg}`);
      }
      setShowPushPreview(false);
      setPushPreview(null);
    } catch (e: unknown) {
      const m = e instanceof Error ? e.message : String(e);
      setPushError(m);
      setImportMsg(`Sheet not modified: ${m}`);
      setShowSheetSettings(true);
    }
    setSheetPushing(false);
  };

  const handleRebuildLedger = async () => {
    setImporting(true);
    setImportMsg(null);
    const res = await rebuildLedger();
    setImportMsg(res.message);
    setImporting(false);
    notifyDataChanged();
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
      // Independent pipelines: trips and leaves validated separately (Q5)
      let tripsImportMsg: string | null = null;
      let leavesImportMsg: string | null = null;
      let tripsSuccess = false;
      let leavesSuccess = false;

      // --- Trips pipeline ---
      if (parseResult.errors.length > 0) {
        tripsImportMsg = `Trips import failed: ${parseResult.errors.map((e) => `Row ${e.row}: ${e.message}`).join('; ')}`;
      } else if (parseResult.trips.length > 0) {
        for (const t of parseResult.trips) {
          if ((!t.start_time || String(t.start_time).trim() === '') && t.end_time && t.trip_distance) {
            const est = estimateStartTime(t.end_time!, Number(t.trip_distance));
            if (est) t.start_time = est;
          }
        }
        const isExactOdoMatch = (t: Partial<Trip>) => trips.some(e => e.date === t.date && Math.round(e.start_km) === Math.round(Number(t.start_km ?? NaN)) && Math.round(e.end_km) === Math.round(Number(t.end_km ?? NaN)));
        const newOnlyTrips = parseResult.trips.filter(t => !isExactOdoMatch(t));
        const overlapErrors = validateNoOverlap(trips, newOnlyTrips);
        if (overlapErrors.length > 0) {
          tripsImportMsg = `Overlap detected: ${overlapErrors.map((e) => e.message).join('; ')}`;
        } else {
          const vehicle = await getVehicleProfile();
          const allPages = await getPages();
          const paginationErrors = validatePaginationForImport(trips, allPages, newOnlyTrips);
          if (paginationErrors.length > 0) {
            tripsImportMsg = `Pagination error: ${paginationErrors.map((e) => e.message).join('; ')}`;
          } else {
            const result = importTripsFromWorkbook({
              existingTrips: trips,
              existingPages: allPages,
              parsedTrips: parseResult.trips,
              vehicleId: vehicle.id,
              opening: { openingKm: vehicle.current_odometer, openingFuel: (vehicle as unknown as Record<string, unknown>).current_fuel_level as number ?? 10 },
            });
            if (result.success) {
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
                const existingPageIds = new Set(allPages.map((p) => p.id));
                for (const pg of result.pages) {
                  if (!existingPageIds.has(pg.id)) {
                    try { await savePage(pg); } catch { }
                  } else {
                    const orig = allPages.find((p) => p.id === pg.id);
                    if (orig && (orig.page_number !== pg.page_number || orig.start_km !== pg.start_km || orig.end_km !== pg.end_km || orig.start_fuel_balance !== pg.start_fuel_balance || orig.end_fuel_balance !== pg.end_fuel_balance || orig.month !== pg.month)) {
                      try { await savePage(pg); } catch { }
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
                for (const tr of [...newTrips, ...updatedTrips]) {
                  const isUpdate = existingTripIds.has(tr.id);
                  let apiOk = false;
                  try {
                    const res = await fetch('/api/trips', {
                      method: isUpdate ? 'PUT' : 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(tr),
                    });
                    if (res.ok) { apiOk = true; persisted++; continue; }
                    if (res.status === 401) authWarning = ' (session expired – saved locally)';
                  } catch { }
                  if (!apiOk) {
                    try {
                      const raw = localStorage.getItem('fleetledger_trips');
                      const arr = raw ? (JSON.parse(raw) as typeof result.trips) : [];
                      const idx = arr.findIndex((x: any) => x.id === tr.id);
                      if (idx >= 0) arr[idx] = tr; else arr.push(tr);
                      localStorage.setItem('fleetledger_trips', JSON.stringify(arr));
                      persisted++;
                    } catch { }
                  }
                }
                if (!bulkError) persisted = result.appendedCount + result.updatedCount;
                else if (persisted === 0 && result.updatedCount > 0) {
                  try {
                    localStorage.setItem('fleetledger_trips', JSON.stringify(result.trips));
                    localStorage.setItem('fleetledger_book_pages', JSON.stringify(result.pages));
                    persisted = result.appendedCount + result.updatedCount;
                  } catch { }
                }
                if (authWarning) bulkError = bulkError ? bulkError + authWarning : authWarning;
              }
              if (bulkError && persisted === 0) {
                tripsImportMsg = `Import computed ${result.appendedCount} trips but failed to persist: ${bulkError}`;
              } else {
                const failed = (result.appendedCount + result.updatedCount) - persisted;
                if (result.appendedCount === 0 && result.updatedCount === 0 && result.skippedDuplicates > 0) {
                  tripsImportMsg = `Imported 0 new trips (${result.skippedDuplicates} duplicate records skipped from workbook).`;
                } else if (result.updatedCount > 0) {
                  tripsImportMsg = `Imported ${result.appendedCount} new, updated ${result.updatedCount} existing (${result.skippedDuplicates} duplicates skipped)${failed > 0 ? ` — ${failed} failed to save${bulkError ? `: ${bulkError}` : ''}` : ''}${bulkError && bulkError.includes('saved locally') ? bulkError : ''}`;
                } else {
                  tripsImportMsg = `Imported ${persisted} trips (${result.skippedDuplicates} duplicates skipped)${failed > 0 ? ` — ${failed} failed to save${bulkError ? `: ${bulkError}` : ''}` : ''}`;
                }
              }
              tripsSuccess = true;
              notifyDataChanged();
            } else {
              tripsImportMsg = `Import failed: ${result.errors.map((e) => e.message).join('; ')}`;
            }
          }
        }
      } else {
        // No trips in file — not an error, just skip trips pipeline
      }

      // --- Leaves pipeline (independent) ---
      if (parseResult.leafErrors.length > 0) {
        leavesImportMsg = `Leaves import failed: ${parseResult.leafErrors.map((e) => `Row ${e.row}: ${e.message}`).join('; ')}`;
      } else if (parseResult.leaves.length > 0) {
        let existingLeaves: { date: string; note?: string }[] = [];
        try { existingLeaves = await getLeaves(); } catch {}
        const imp = importLeavesFromWorkbook({ existingLeaves, parsedLeaves: parseResult.leaves });
        // Persist leaves one by one (POST upsert) — only appended/updated dates
        let leavesPersisted = 0;
        let leavesError: string | null = null;
        const changedDates = new Set<string>();
        // Determine which dates were actually appended/updated via comparing imp
        const beforeMap = new Map(existingLeaves.map(l=>[l.date,l.note??''] as const));
        for (const l of imp.leaves) {
          const before = beforeMap.get(l.date);
          if (before === undefined || before !== (l.note ?? '')) changedDates.add(l.date);
        }
        for (const date of changedDates) {
          const lv = imp.leaves.find(x=>x.date===date)!;
          try {
            await saveLeave(lv.date, lv.note ?? '');
            leavesPersisted++;
          } catch (e:any) {
            leavesError = e?.message || String(e);
          }
        }
        // Also update local leaves via saving already handled localStorage fallback in saveLeave
        if (imp.appendedCount === 0 && imp.updatedCount === 0 && imp.skippedDuplicates > 0) {
          leavesImportMsg = `Leaves: 0 new (${imp.skippedDuplicates} duplicates skipped).`;
        } else if (imp.appendedCount > 0 || imp.updatedCount > 0) {
          leavesImportMsg = `Leaves: imported ${imp.appendedCount} new, updated ${imp.updatedCount} (${imp.skippedDuplicates} skipped)${leavesError ? ` — ${leavesError}` : ''}`;
        }
        if (changedDates.size > 0) {
          leavesSuccess = true;
          notifyDataChanged();
          // Refresh leaveDates set
          try { const lvs = await getLeaves(); setLeaveDates(new Set(lvs.map(l=>l.date))); } catch {}
        }
      }

      // Combine messages
      const combined = [tripsImportMsg, leavesImportMsg].filter(Boolean).join(' | ');
      if (combined) setImportMsg(combined);
      else if (!tripsSuccess && !leavesSuccess && parseResult.trips.length===0 && parseResult.leaves.length===0) {
        setImportMsg('Import: no new rows found (all duplicates or empty).');
      }
    } catch {
      setImportMsg('Failed to read file');
    }
    setImporting(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Sheet Pull handlers
  const handlePullFromSheet = async () => {
    const { scriptUrl } = getSheetSettings();
    if (!scriptUrl) { setShowSheetSettings(true); return; }
    setSheetPulling(true);
    setSheetError(null);
    setImportMsg(null);
    try {
      let rows: BufferTrip[] = [];
      let leaves: BufferLeave[] = [];
      try {
        const fetched = await fetchAllWithLeaves();
        rows = fetched.rows;
        leaves = fetched.leaves;
      } catch {
        rows = await fetchAllRows();
      }
      const comp = compareBufferToDb({ bufferRows: rows, existingTrips: trips });
      let leavesComp: LeavesPullComparison | null = null;
      try {
        const existingLeaves = await getLeaves();
        leavesComp = compareLeavesBufferToDb({ bufferLeaves: leaves, existingLeaves });
      } catch {}
      setPullComparison(comp);
      setLeavesPullComparison(leavesComp);
      const iso = new Date().toISOString();
      setLastPullAt(iso);
      setLastPullAtState(iso);
      const hasTripChanges = comp.newRows.length > 0 || comp.changedRows.length > 0;
      const hasLeaveChanges = leavesComp ? (leavesComp.newRows.length > 0 || leavesComp.changedRows.length > 0) : false;
      if (!hasTripChanges && !hasLeaveChanges) {
        setImportMsg(`Buffer Sheet up to date — 0 new rows (${comp.totalFetched} total, ${comp.skippedRows.length} already imported)${leavesComp ? ` · Leaves 0 new (${leavesComp.totalFetched} total)` : ''}`);
        setSheetPulling(false);
        return;
      }
      setSelectedNew(new Set(comp.newRows.map((r) => `${r.partial.date}|${r.partial.start_km}|${r.partial.end_km}`)));
      setSelectedChanged(new Set());
      if (leavesComp) {
        setSelectedLeaveNew(new Set(leavesComp.newRows.map(l => l.date)));
        setSelectedLeaveChanged(new Set());
      }
      setShowPullPreview(true);
    } catch (e: unknown) {
      const m = e instanceof Error ? e.message : String(e);
      setSheetError(m);
      setImportMsg(`Sheet pull failed: ${m}`);
    }
    setSheetPulling(false);
  };

  const handleSheetImportConfirm = async () => {
    if (!pullComparison && !leavesPullComparison) return;
    // Build selected partials
    const keyOf = (p: Partial<Trip>) => `${p.date}|${p.start_km}|${p.end_km}`;
    const selectedPartials: Partial<Trip>[] = [];
    if (pullComparison) {
      for (const r of pullComparison.newRows) {
        if (selectedNew.has(keyOf(r.partial))) selectedPartials.push(r.partial);
      }
      for (const r of pullComparison.changedRows) {
        if (selectedChanged.has(keyOf(r.partial))) selectedPartials.push(r.partial);
      }
    }
    const selectedLeavesForCheck: BufferLeave[] = [];
    if (leavesPullComparison) {
      for (const l of leavesPullComparison.newRows) if (selectedLeaveNew.has(l.date)) selectedLeavesForCheck.push(l);
      for (const l of leavesPullComparison.changedRows) if (selectedLeaveChanged.has(l.bufferLeave.date)) selectedLeavesForCheck.push(l.bufferLeave);
    }
    if (selectedPartials.length === 0 && selectedLeavesForCheck.length === 0) { setSheetError('Select at least one row'); return; }

    // Estimate start times if missing (same as file import)
    for (const t of selectedPartials) {
      if ((!t.start_time || String(t.start_time).trim() === '') && t.end_time && t.trip_distance) {
        const est = estimateStartTime(t.end_time!, Number(t.trip_distance));
        if (est) t.start_time = est;
      }
    }

    // Pre-flight validation: only new rows affect overlap/pagination; changed rows are upserts
    const isExactOdoMatch = (t: Partial<Trip>) => trips.some(e => e.date === t.date && Math.round(e.start_km) === Math.round(Number(t.start_km ?? NaN)) && Math.round(e.end_km) === Math.round(Number(t.end_km ?? NaN)));
    const newOnly = selectedPartials.filter(t => !isExactOdoMatch(t));
    const overlapErrors = validateNoOverlap(trips, newOnly);
    if (overlapErrors.length > 0) { setSheetError(`Overlap: ${overlapErrors.map(e=>e.message).join('; ')}`); return; }
    const vehicle = await getVehicleProfile();
    const allPages = await getPages();
    const paginationErrors = validatePaginationForImport(trips, allPages, newOnly);
    if (paginationErrors.length > 0) { setSheetError(`Pagination: ${paginationErrors.map(e=>e.message).join('; ')}`); return; }

    setSheetPulling(true);
    setSheetError(null);
    try {
      const result = importTripsFromWorkbook({
        existingTrips: trips,
        existingPages: allPages,
        parsedTrips: selectedPartials,
        vehicleId: vehicle.id,
        opening: { openingKm: vehicle.current_odometer, openingFuel: (vehicle as unknown as Record<string, unknown>).current_fuel_level as number ?? 10 },
      });
      if (!result.success) { setSheetError(result.errors.map(e=>e.message).join('; ')); setSheetPulling(false); return; }

      // Persist same as handleImportFile bulk path
      let persisted = 0;
      let bulkError: string | null = null;
      try {
        const bulkRes = await fetch('/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pages: result.pages, trips: result.trips }) });
        if (!bulkRes.ok) { const j = await bulkRes.json().catch(()=>({})); throw new Error(j.error || `Bulk import HTTP ${bulkRes.status}`); }
        await bulkRes.json().catch(()=>({}));
        persisted = result.appendedCount + result.updatedCount;
        try { localStorage.setItem('fleetledger_trips', JSON.stringify(result.trips)); localStorage.setItem('fleetledger_book_pages', JSON.stringify(result.pages)); } catch {}
      } catch (err: unknown) {
        bulkError = err instanceof Error ? err.message : String(err);
        // fallback localStorage
        try { localStorage.setItem('fleetledger_trips', JSON.stringify(result.trips)); localStorage.setItem('fleetledger_book_pages', JSON.stringify(result.pages)); } catch {}
        persisted = result.appendedCount + result.updatedCount;
        // per-trip fallback for API
        const existingTripIds = new Set(trips.map(t=>t.id));
        for (const tr of result.trips.filter(t=>!existingTripIds.has(t.id))) {
          try { await fetch('/api/trips', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(tr) }); } catch {}
        }
      }

      const failed = (result.appendedCount + result.updatedCount) - persisted;
      setImportMsg(`Pulled from Sheet — ${result.appendedCount} new, ${result.updatedCount} updated (${result.skippedDuplicates} already imported)${failed>0?` — ${failed} failed`:''}${bulkError?`: ${bulkError}`:''}`);
      // Focus earliest of newly added (chronologically smallest per Q9 a)
      const newIds = result.trips.filter(t=>!trips.some(o=>o.id===t.id)).map(t=>t.id);
      if (newIds.length > 0) {
        // find earliest among new
        const newTrips = result.trips.filter(t=>newIds.includes(t.id)).sort((a,b)=>a.date.localeCompare(b.date)||a.start_km-b.start_km);
        const earliestId = newTrips[0]?.id ?? newIds[0];
        const needsClear = search !== '' || month !== 'All' || tripType !== 'All';
        // highlight all imported briefly
        setImportedIds(new Set(newIds));
        focusTrip(earliestId, { clearFilter: needsClear });
      } else if (result.updatedCount>0) {
        // focus first updated (earliest)
        const updatedIds = result.trips.filter(t=>trips.some(o=>o.id===t.id && (o.places_visited!==t.places_visited || o.end_time!==t.end_time))).map(t=>t.id);
        if (updatedIds.length>0) focusTrip(updatedIds[0], { clearFilter: search!==''||month!=='All'||tripType!=='All' });
      }
      // --- Leaves sheet import (independent, after trips)
      if (leavesPullComparison) {
        const selectedLeaves: BufferLeave[] = [];
        for (const l of leavesPullComparison.newRows) if (selectedLeaveNew.has(l.date)) selectedLeaves.push(l);
        for (const l of leavesPullComparison.changedRows) if (selectedLeaveChanged.has(l.bufferLeave.date)) selectedLeaves.push(l.bufferLeave);
        if (selectedLeaves.length > 0) {
          let existingLeaves: { date: string; note?: string }[] = [];
          try { existingLeaves = await getLeaves(); } catch {}
          const leafImp = importLeavesFromWorkbook({ existingLeaves, parsedLeaves: selectedLeaves });
          let leavesChanged = 0;
          const beforeMap = new Map(existingLeaves.map(l=>[l.date,l.note??''] as const));
          for (const lv of leafImp.leaves) {
            const before = beforeMap.get(lv.date);
            if (before !== undefined && before === (lv.note ?? '')) continue;
            try { await saveLeave(lv.date, lv.note ?? ''); leavesChanged++; } catch {}
          }
          if (leavesChanged > 0) {
            try { const lvs = await getLeaves(); setLeaveDates(new Set(lvs.map(l=>l.date))); } catch {}
          }
        }
      }
      setShowPullPreview(false);
      setPullComparison(null);
      setLeavesPullComparison(null);
      notifyDataChanged();
    } catch (e: unknown) {
      setSheetError(e instanceof Error ? e.message : String(e));
    }
    setSheetPulling(false);
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

  // KPI derived - matches alltripsample KPI bar (Total, Working, Off-day, Telemetry, Discrepancy)
  const kpiTotal = trips.length;
  const kpiWorking = offDaySummary.workingDayKm;
  const kpiOffDay = offDaySummary.offDayKm;
  const kpiGapCount = gapPairs.length;
  const kpiGapKm = gapPairs.reduce((s, g) => s + Math.abs(g.delta), 0);
  const liveTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return (
    <div className="flex flex-col gap-4">
      <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImportFile} />

      {/* Header — matches addtripsample.html MainHeader (two-row, non-messy) */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-4 sm:px-6 lg:px-8 py-3.5 space-y-3">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <button type="button" className="inline-flex items-center justify-center h-9 w-9 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 hover:text-slate-900 transition shadow-sm shrink-0" title="Toggle Navigation Menu">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"></path></svg>
              </button>
              <div className="space-y-1">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h3 className="text-xl font-bold tracking-tight text-slate-900">{title}</h3>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/80 shadow-sm"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>v4.2 Live Ledger</span>
                </div>
                <p className="text-xs text-slate-500 flex items-center gap-2 flex-wrap"><span>Scrollable historical ledger with odometer continuity tracking, telemetry sync, and fuel logs</span><span className="text-slate-300 font-bold">·</span><span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200" data-testid="master-visible-count">{filtered.length} of {trips.length} trips</span></p>
              </div>
            </div>
            <div className="flex items-center flex-wrap gap-2.5 shrink-0">
              <EstimateFuelEconomy trips={trips} pages={pages} vehicle={vehicle} onApplied={() => notifyDataChanged()} />
              <button type="button" onClick={handleOpenStartAudit} disabled={auditFixing} className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 shadow-sm transition cursor-pointer disabled:opacity-50" data-testid="verify-start-times-btn" title="Audit Start Time Issues — scan Empty/Equal/Inverted/Short via Traffic slabs">
                <svg className="w-3.5 h-3.5 text-slate-600 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"></path><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3"></path></svg>
                <span>Audit Start Time Issues</span>
              </button>
              <button type="button" onClick={handleRebuildLedger} disabled={importing || sheetPulling || sheetPushing} className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 shadow-sm transition cursor-pointer disabled:opacity-50">
                <svg className="w-3.5 h-3.5 text-slate-500 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"></path></svg>
                <span>Rebuild Ledger</span>
              </button>
              <a href="/trips/new" className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-bold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white shadow transition shrink-0">
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15"></path></svg>
                <span>New Trip</span>
              </a>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 p-2.5 sm:px-3.5 bg-blue-950 border border-blue-900 rounded-xl shadow-sm text-xs">
            <div className="flex items-center flex-wrap gap-2.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-blue-200 mr-1"><svg className="w-3.5 h-3.5 text-blue-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5"></path></svg><span>Sync &amp; Integrations:</span></div>
              <div className="inline-flex items-center rounded-lg border border-blue-800/80 bg-blue-900/60 p-0.5 shadow-sm">
                <button type="button" onClick={() => fileInputRef.current?.click()} disabled={importing || sheetPulling || sheetPushing} className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-emerald-400 hover:text-emerald-300 hover:bg-blue-800/80 rounded-md transition cursor-pointer disabled:opacity-50"><svg className="w-3.5 h-3.5 text-emerald-400 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.5V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"></path></svg><span>Import Excel</span></button>
                <span className="h-3.5 w-px bg-blue-800"></span>
                <button type="button" onClick={handleExport} className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-emerald-400 hover:text-emerald-300 hover:bg-blue-800/80 rounded-md transition cursor-pointer"><svg className="w-3.5 h-3.5 text-emerald-400 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.5V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"></path></svg><span>Export Excel</span></button>
              </div>
              <div className="inline-flex items-center rounded-lg border border-blue-800/80 bg-blue-900/60 p-0.5 shadow-sm">
                <button type="button" onClick={handlePullFromSheet} disabled={sheetPulling || importing || sheetPushing} className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-cyan-300 hover:text-cyan-200 hover:bg-blue-800/80 rounded-md transition cursor-pointer disabled:opacity-50" data-testid="pull-from-sheet-btn"><svg className="w-3.5 h-3.5 text-cyan-400 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.75 3.75 0 0118 19.5H6.75z"></path></svg><span>Import Sheet</span></button>
                <span className="h-3.5 w-px bg-blue-800"></span>
                <button type="button" onClick={handlePushToSheet} disabled={sheetPushing || importing || sheetPulling} className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-cyan-300 hover:text-cyan-200 hover:bg-blue-800/80 rounded-md transition cursor-pointer disabled:opacity-50" data-testid="push-to-sheet-btn"><svg className="w-3.5 h-3.5 text-cyan-400 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9.75v6.75m0 0l-3-3m3 3l3-3m-8.25 3a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.75 3.75 0 0118 19.5H6.75z"></path></svg><span>Export Sheet</span></button>
              </div>
              <button type="button" onClick={() => setShowSheetSettings(true)} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-blue-200 bg-blue-900/60 hover:bg-blue-800 hover:text-white border border-blue-800 rounded-lg transition shadow-sm cursor-pointer" data-testid="sheet-settings-btn"><svg className="w-3.5 h-3.5 text-blue-300 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z"></path><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg><span>Sheet Settings</span></button>
            </div>
            <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-blue-900/80 border border-blue-700 text-[11px] text-blue-200 font-medium shadow-sm shrink-0 whitespace-nowrap"><span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0"></span><span className="text-white font-medium whitespace-nowrap">Cloud Sync Active</span><span className="text-blue-300 font-normal hidden sm:inline whitespace-nowrap">· Last synced {lastPushAt ? new Date(lastPushAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : lastPullAt ? new Date(lastPullAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : 'just now'}</span></div>
          </div>
        </div>
      </div>

      {/* KPI Bar — matches alltripsample QuickKPIBar */}
      <section aria-label="Ledger KPI Metrics" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3" data-purpose="kpi-metrics-grid">
        <div className="bg-white rounded-xl border border-slate-200/80 p-3.5 flex items-center justify-between shadow-sm">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Total Entries</p>
            <p className="text-xl font-bold tracking-tight text-slate-900 mt-0.5 font-mono">{kpiTotal.toLocaleString()}</p>
          </div>
          <div className="h-9 w-9 rounded-lg bg-slate-100 flex items-center justify-center text-slate-600">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" strokeLinecap="round" strokeLinejoin="round"></path></svg>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200/80 p-3.5 flex items-center justify-between shadow-sm">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Working Dist.</p>
            <div className="flex items-baseline gap-1 mt-0.5">
              <p className="text-xl font-bold tracking-tight text-slate-900 font-mono">{kpiWorking.toLocaleString()}</p>
              <span className="text-xs text-slate-400 font-medium">km</span>
            </div>
          </div>
          <div className="h-9 w-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center font-medium text-xs">{sums.officialKm.toLocaleString().slice(0,4)}</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200/80 p-3.5 flex items-center justify-between shadow-sm">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Off-day Dist.</p>
            <div className="flex items-baseline gap-1 mt-0.5">
              <p className="text-xl font-bold tracking-tight text-slate-900 font-mono">{kpiOffDay.toLocaleString()}</p>
              <span className="text-xs text-slate-400 font-medium">km</span>
            </div>
          </div>
          <div className="h-9 w-9 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center font-medium text-xs">{offDaySummary.offDayTrips} tr</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200/80 p-3.5 flex items-center justify-between shadow-sm">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Telemetry Health</p>
            <div className="flex items-center gap-1.5 mt-1">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="text-xs font-semibold text-slate-800">Live {liveTime}</span>
            </div>
          </div>
          <div className="h-9 w-9 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" strokeLinecap="round" strokeLinejoin="round"></path></svg>
          </div>
        </div>
        <div className={`rounded-xl border p-3.5 flex items-center justify-between shadow-sm col-span-2 sm:col-span-1 ${kpiGapCount>0 ? 'bg-amber-50/60 border-amber-300/70' : 'bg-white border-slate-200/80'}`}>
          <div>
            <p className={`text-[11px] font-semibold uppercase tracking-wider ${kpiGapCount>0 ? 'text-amber-800' : 'text-slate-400'}`}>Discrepancy</p>
            <p className={`text-xs font-medium mt-1 ${kpiGapCount>0 ? 'text-amber-900' : 'text-slate-600'}`}>{kpiGapCount>0 ? `${kpiGapCount} Gap${kpiGapCount>1?'s':''} (${kpiGapKm.toLocaleString()} km)` : 'No gaps — ledger clean'}</p>
          </div>
          <span className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-bold shadow-sm ${kpiGapCount>0 ? 'bg-amber-500 text-white' : 'bg-emerald-500 text-white'}`}>{kpiGapCount>0 ? 'Action Req' : 'Clean'}</span>
        </div>
      </section>

      {/* Continuity Gap Banner — matches alltripsample ContinuityGapBanner */}
      {gapPairs.length > 0 && (
        <section aria-label="Continuity Gap Alert" className="rounded-xl border-l-4 border-l-rose-600 bg-gradient-to-r from-rose-50/90 via-amber-50/60 to-white border border-rose-200/70 p-4 shadow-sm" data-purpose="continuity-gap-alert">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <div className="p-2 rounded-lg bg-rose-100 text-rose-700 shrink-0 mt-0.5">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" strokeLinecap="round" strokeLinejoin="round"></path></svg>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-bold text-slate-900">Continuity Gap Detected: {gapPairs.length} Odometer Mismatch{gapPairs.length>1?'es':''}</h2>
                  <span className="text-[11px] px-2 py-0.5 rounded bg-rose-100 text-rose-800 font-semibold uppercase tracking-wide">Row #{globalSeqMap.get(gapPairs[0].successor.id) ?? '?'}</span>
                </div>
                <p className="text-xs text-slate-600 mt-1">
                  Trip on <strong className="text-slate-800 font-medium">{new Date(gapPairs[0].successor.date+'T00:00:00').toLocaleDateString('en-US',{weekday:'short', month:'short', day:'numeric', year:'numeric'})}</strong> Start ODO (<span className="font-mono font-medium text-rose-700">{gapPairs[0].actual.toLocaleString()}</span>) does not match previous End ODO (<span className="font-mono font-medium text-slate-800">{gapPairs[0].expected.toLocaleString()}</span>). <span className="text-rose-700 font-semibold font-mono">Missing: +{Math.abs(gapPairs[0].delta).toLocaleString()} km.</span>
                </p>
              </div>
            </div>
            <div className="flex items-center flex-wrap gap-2.5 shrink-0">
              <button onClick={() => openGapFill(gapPairs[0])} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-rose-600 text-white hover:bg-rose-700 shadow-sm transition" type="button">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M12 4.5v15m7.5-7.5h-15" strokeLinecap="round" strokeLinejoin="round"></path></svg>
                <span>Auto-Fill Missing {Math.abs(gapPairs[0].delta).toLocaleString()} KM</span>
              </button>
              <button onClick={() => { const id=gapPairs[0].successor.id; focusTrip(id, {clearFilter: false}); }} className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 transition shadow-sm" type="button">
                <span>Jump to Row #{globalSeqMap.get(gapPairs[0].successor.id) ?? '?'}</span>
                <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M19.5 8.25l-7.5 7.5-7.5-7.5" strokeLinecap="round" strokeLinejoin="round"></path></svg>
              </button>
              <span className="text-xs text-slate-500 px-2 font-medium">{gapPairs.length>1 ? `+${gapPairs.length-1} more` : ''}</span>
            </div>
          </div>
        </section>
      )}

        {importMsg && (
          <div className={`text-xs px-3 py-2 rounded-lg ${importMsg.includes('failed') || importMsg.includes('error') || importMsg.includes('Overlap') || importMsg.includes('Sheet not modified') ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-green-50 text-green-700 border border-green-200'}`}>
            {importMsg}
            <button onClick={() => setImportMsg(null)} className="ml-2 font-bold">✕</button>
          </div>
        )}
        {sheetError && (
          <div className="text-xs px-3 py-2 rounded-lg bg-red-50 text-red-700 border border-red-200">
            {sheetError} <button onClick={() => setSheetError(null)} className="ml-2 font-bold">✕</button>
          </div>
        )}
        {pushError && (
          <div className="text-xs px-3 py-2 rounded-lg bg-red-50 text-red-700 border border-red-200" data-testid="sheet-push-error">
            {pushError} <button onClick={() => setPushError(null)} className="ml-2 font-bold">✕</button>
          </div>
        )}
        {(lastPullAt || lastPushAt) && (
          <div className="flex gap-4 text-[10px] text-on-surface-variant">
            {lastPullAt && <span>Last Sheet pull: {new Date(lastPullAt).toLocaleString()}</span>}
            {lastPushAt && <span>Last Sheet push: {new Date(lastPushAt).toLocaleString()}</span>}
          </div>
        )}

      {/* FilterAndControlBar — matches alltripsample */}
      <section className="bg-white rounded-xl border border-slate-200 p-3 shadow-sm space-y-3" data-purpose="ledger-filter-controls">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-xl">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
              <svg className="h-4 w-4 text-slate-400" fill="currentColor" viewBox="0 0 20 20"><path clipRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" fillRule="evenodd"></path></svg>
            </div>
            <input aria-label="Search trips" className="block w-full rounded-lg border-0 py-1.5 pl-9 pr-8 text-xs text-slate-800 ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 bg-slate-50/50 hover:bg-white transition" placeholder="Search places (e.g. HO, Panni), date, distance, order no..." type="text" value={search} onChange={(e) => setSearch(e.target.value)} />
            {search ? (
              <button className="absolute inset-y-0 right-0 flex items-center pr-2.5 text-slate-400 hover:text-slate-600" type="button" onClick={() => setSearch('')} aria-label="Clear search">✕</button>
            ) : (
              <span className="absolute inset-y-0 right-0 flex items-center pr-2.5 text-slate-400"><span className="text-[10px] bg-slate-200/80 px-1.5 py-0.5 rounded text-slate-600 font-mono">⌘K</span></span>
            )}
          </div>
          <div className="flex items-center flex-wrap gap-2">
            <div className="relative inline-block">
              <select aria-label="Filter by trip type" value={tripType} onChange={(e) => setTripType(e.target.value as typeof tripType)} className="text-xs rounded-lg border-slate-300 py-1.5 pl-2.5 pr-8 font-medium text-slate-700 bg-white focus:border-indigo-500 focus:ring-indigo-500 shadow-sm cursor-pointer">
                <option value="All">All Types</option>
                <option value="Official">Official</option>
                <option value="Private">Private</option>
              </select>
            </div>
            <div className="relative inline-block">
              <select aria-label="Filter by month" value={month} onChange={(e) => setMonth(e.target.value)} className="text-xs rounded-lg border-slate-300 py-1.5 pl-2.5 pr-8 font-medium text-slate-700 bg-white focus:border-indigo-500 focus:ring-indigo-500 shadow-sm cursor-pointer">
                <option value="All">All Months</option>
                {availableMonths.map((m) => (<option key={m} value={m}>{m}</option>))}
              </select>
            </div>
            <div className="relative inline-block">
              <select aria-label="Filter by day type" value={dayTypeFilter} onChange={(e) => setDayTypeFilter(e.target.value as typeof dayTypeFilter)} className="text-xs rounded-lg border-slate-300 py-1.5 pl-2.5 pr-8 font-medium text-slate-700 bg-white focus:border-indigo-500 focus:ring-indigo-500 shadow-sm cursor-pointer">
                <option value="All">All Days</option>
                <option value="Off">Off-days only</option>
                <option value="Working">Working days only</option>
              </select>
            </div>
            <a href="/calendar" className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg text-slate-700 hover:bg-slate-100 transition border border-slate-200">
              <svg className="w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 9v7.5" strokeLinecap="round" strokeLinejoin="round"></path></svg>
              <span>Calendar</span>
            </a>
            <button onClick={handleGoToLatest} data-testid="go-to-latest-btn" className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition border border-indigo-200/60" type="button">
              <span>Latest Records</span>
              <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M19.5 13.5L12 21m0 0l-7.5-7.5M12 21V3" strokeLinecap="round" strokeLinejoin="round"></path></svg>
            </button>
          </div>
        </div>
        <div className="flex items-center flex-wrap gap-2 pt-2 border-t border-slate-100 text-xs">
          <span className="text-slate-400 text-[11px] font-medium uppercase tracking-wider mr-1">Quick Filters:</span>
          <button onClick={() => { setTripType('All'); setDayTypeFilter('All'); }} className={`px-2.5 py-1 rounded-md text-xs font-medium shadow-sm border ${tripType==='All' && dayTypeFilter==='All' ? 'bg-slate-900 text-white border-slate-900' : 'bg-slate-100 text-slate-700 hover:bg-slate-200/80 border-slate-200'}`}>
            All <span className="ml-1 opacity-70">{filtered.length}</span>
          </button>
          <button onClick={() => { setTripType('Official'); }} className="px-2.5 py-1 rounded-md text-xs font-medium bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition border border-emerald-200/80">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5"></span>
            Working: {offDaySummary.workingDayTrips} <span className="text-emerald-600/70 text-[11px] ml-1">({offDaySummary.workingDayKm.toLocaleString()} km)</span>
          </button>
          <button onClick={() => setDayTypeFilter(dayTypeFilter==='Off' ? 'All' : 'Off')} className={`px-2.5 py-1 rounded-md text-xs font-medium transition border ${dayTypeFilter==='Off' ? 'bg-amber-100 text-amber-800 border-amber-200' : 'bg-slate-100 text-slate-700 hover:bg-slate-200/80 border-slate-200'}`}>
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 mr-1.5"></span>
            Off-day: {offDaySummary.offDayTrips} <span className="text-slate-400 text-[11px] ml-1">({offDaySummary.offDayKm.toLocaleString()} km)</span>
          </button>
          <button className="px-2.5 py-1 rounded-md text-xs font-medium bg-slate-100 text-slate-700 hover:bg-slate-200/80 transition border border-slate-200">Leave: {offDaySummary.onLeave}</button>
          <button className="px-2.5 py-1 rounded-md text-xs font-medium bg-slate-100 text-slate-700 hover:bg-slate-200/80 transition border border-slate-200">Mercantile: {offDaySummary.onMercantile}</button>
          <button className="px-2.5 py-1 rounded-md text-xs font-medium bg-slate-100 text-slate-700 hover:bg-slate-200/80 transition border border-slate-200">Poya: {offDaySummary.onPoya}</button>
          <div className="ml-auto text-[11px] text-slate-400 flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500"></span>
            <span>Sheet Push: {lastPushAt ? new Date(lastPushAt).toLocaleString() : '—'}</span>
          </div>
        </div>
      </section>

      {/* LedgerMasterTable — matches alltripsample */}
      <section className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden" data-purpose="ledger-table-container">
        <div ref={tableContainerRef} className={`overflow-x-auto overflow-y-auto ${compact ? 'max-h-[420px]' : 'max-h-[640px] min-h-[280px]'} relative`} style={{ scrollbarWidth: 'thin' }}>
          <table className="w-full text-left border-collapse text-xs table-sticky-header">
            <thead>
              <tr className="bg-slate-100 text-slate-700 border-b border-slate-200 uppercase font-semibold text-[11px] tracking-wider select-none sticky top-0 z-20 shadow-sm">
              <th className="py-2.5 px-2 text-center border-r border-rule-line w-12">#</th>
              <th className="py-2.5 px-2 border-r border-rule-line w-40">
                <button onClick={() => handleSort('date')} className="flex items-center hover:text-on-surface">
                  Date <SortIcon col="date" />
                </button>
              </th>
              <th className="py-2.5 px-1 border-r border-rule-line w-16 min-w-[56px] max-w-[64px] text-center">DAY</th>
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
              <th className="py-2.5 px-2 border-r border-rule-line w-[6%] max-w-[6%]">
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
              <th className="py-2.5 px-1 w-10 min-w-[40px] text-center bg-paper-gutter sticky right-0 z-10 shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.08)]">⋯</th>
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
                const tripFuel = tripFuelMap.get(t.id);
                const fuel = tripFuel ?? fuelMap.get(t.date);
                const isEarliest = earliestDate === t.date;
                const dayInfo = getDayTypeInfo(t.date, leaveDates);
                const holiday = getHoliday(t.date);
                const isPrivateType = t.trip_type === 'Private';
                const isBlueDesc = /\b(dummy|bus|private)\b/i.test(t.places_visited ?? '');
                const rowBg = isBlueDesc ? 'bg-blue-100' : isAltDay ? 'bg-slate-200' : 'bg-white';
                const succGap = successorGapMap.get(t.id);
                const predGap = predecessorGapMap.get(t.id);
                const isFocused = focusedTripId === t.id;
                const isJustImported = importedIds.has(t.id);
                const isFuelPumped = (t.fuel_pumped_amount ?? 0) > 0;
                return (
                <tr
                  key={t.id}
                  data-testid={`trip-row-${t.id}`}
                  ref={(el) => { if (el) rowRefs.current.set(t.id, el); else rowRefs.current.delete(t.id); }}
                  onContextMenu={(e) => handleRowContextMenu(e, t)}
                  className={`transition-colors border-b border-rule-line/60 ${isFocused ? 'ring-2 ring-telemetry-cyan bg-cyan-50' : isJustImported ? 'bg-cyan-50' : rowBg} ${isFuelPumped ? 'text-blue-900' : ''} hover:bg-amber-50/40`}
                >
                  <td className="py-2 px-2 text-center font-mono text-xs text-outline border-r border-rule-line">
                    <span className="inline-flex items-center justify-center gap-0.5">
                      <span>{String(globalSeqMap.get(t.id) ?? '-').padStart(2, '0')}</span>
                      {(t.fuel_pumped_amount ?? 0) > 0 && <span title={`Fuel pumped ${t.fuel_pumped_amount?.toFixed(1)} L`} className="text-[11px] leading-none">⛽</span>}
                    </span>
                  </td>
                  <td className="py-2 px-2 whitespace-nowrap border-r border-rule-line">
                    <span className="inline-flex items-center gap-1 px-1 py-0.5 rounded font-label-caps text-[10px] uppercase tracking-tight text-on-surface-variant">
                      {new Date(t.date + 'T00:00:00').toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric', weekday: 'short' })}
                    </span>
                  </td>
                  <td className="py-2 px-1 whitespace-nowrap border-r border-rule-line text-[9px] text-center w-16 min-w-[56px] max-w-[64px]" title={holiday ? `${holiday.name} (${holiday.kinds.join('/')})${dayInfo.isLeave ? ` • Leave: ${leaveDates.has(t.date) ? 'personal' : ''}` : ''}` : dayInfo.label}>
                    {(() => {
                      const badge = getDayBadge(t.date);
                      if (!badge) return <span className="text-on-surface-variant">—</span>;
                      return <span className={`inline-flex items-center justify-center gap-0.5 px-1.5 py-0.5 rounded-full border font-semibold leading-none ${badge.cls}`}><span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />{badge.text}</span>;
                    })()}
                  </td>
                  <td className="py-2 px-2 whitespace-nowrap font-mono text-xs text-outline border-r border-rule-line">
                    {renderEditableCell(t, 'start_time', t.start_time || '-')}
                  </td>
                  <td className="py-2 px-2 whitespace-nowrap font-mono text-xs text-outline border-r border-rule-line">
                    {renderEditableCell(t, 'end_time', t.end_time || '-')}
                  </td>
                  <td className={`py-2 px-2 text-right font-odometer-sm text-xs border-r border-rule-line ${hasKmGap ? 'bg-red-100 font-bold' : ''}`}>
                    <div className="flex flex-col items-end gap-1">
                      {renderEditableCell(t, 'start_km', Math.round(t.start_km).toLocaleString(), 'right')}
                      {succGap && (
                        <button
                          data-testid={`fill-gap-chip-${t.id}`}
                          onClick={() => openGapFill(succGap)}
                          className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-600 text-white hover:bg-red-700"
                          title={`Fill Gap ${succGap.expected}→${succGap.actual}`}
                        >
                          + Fill Gap {succGap.delta} km
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="py-2 px-2 text-right font-odometer-sm text-xs border-r border-rule-line">
                    {renderEditableCell(t, 'end_km', Math.round(t.end_km).toLocaleString(), 'right')}
                  </td>
                  <td className="py-2 px-2 text-right font-odometer-sm text-xs font-bold text-slate-surface border-r border-rule-line">
                    {Math.round(t.trip_distance).toLocaleString()}
                  </td>
                  <td className="py-2 px-2 max-w-[6%] w-[6%] border-r border-rule-line text-xs" title={t.places_visited}>
                    <span className="inline-flex items-center gap-1 min-w-0 max-w-full">
                      <span className="truncate min-w-0">{renderEditableCell(t, 'places_visited', t.places_visited)}</span>
                      {isPrivateType && <span className="text-red-600 font-bold text-[10px] leading-none shrink-0" data-testid={`prv-tag-${t.id}`}>[PRV]</span>}
                    </span>
                  </td>
                  <td className="py-2 px-2 text-right font-mono text-xs border-r border-rule-line">
                    {renderEditableCell(t, 'fuel_pumped_amount', (t.fuel_pumped_amount ?? 0) > 0 ? `${(t.fuel_pumped_amount ?? 0).toFixed(1)}` : '-', 'right')}
                  </td>
                  <td className="py-2 px-1 text-xs font-mono text-on-surface-variant border-r border-rule-line">
                    {renderEditableCell(t, 'fuel_order_no', t.fuel_order_no || '-')}
                  </td>
                  <td className="py-2 px-2 text-right font-mono text-xs border-r border-rule-line" title={isEarliest ? 'Click to edit opening fuel (auto-counts downstream)' : 'Auto-calculated from opening fuel — edit earliest date only'}>
                    {isEarliest ? renderEditableCell(t, 'fuel_position', fuel ? fuel.position.toFixed(1) : '-', 'right') : <span className="font-mono">{fuel ? fuel.position.toFixed(1) : '-'}</span>}
                  </td>
                  <td className="py-2 px-2 text-right font-mono text-xs border-r border-rule-line">
                    {renderEditableCell(t, 'in_tank', fuel && fuel.inTank > 0 ? fuel.inTank.toFixed(1) : '-', 'right')}
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
                  <td className="py-2 px-1 text-center w-10 min-w-[40px] bg-paper-gutter sticky right-0 z-[5] shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.08)]">
                    <button
                      ref={(el) => { if (el) menuButtonRefs.current.set(t.id, el); else menuButtonRefs.current.delete(t.id); }}
                      data-testid={`row-menu-${t.id}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (openMenuId === t.id) { closeMenu(); return; }
                        setOpenMenuId(t.id);
                        requestAnimationFrame(() => {
                          const b = menuButtonRefs.current.get(t.id);
                          if (b) setMenuAnchorRect(b.getBoundingClientRect());
                        });
                      }}
                      className="px-2 py-1.5 text-xs font-bold rounded bg-paper-sheet border border-rule-line shadow-sm hover:bg-paper-gutter"
                      aria-label="Actions"
                    >
                      ⋯
                    </button>
                  </td>
                </tr>
                );
              })
            )}
          </tbody>
          </table>
        </div>
        <footer className="bg-slate-50 border-t border-slate-200 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-slate-600 sticky bottom-0 z-20 shadow-sm" data-purpose="continuous-scroll-bar" data-testid="master-footer-sums">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/80"><span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>Continuous Ledger</span>
            <span className="text-slate-700 font-medium" data-testid="master-footer-count">{filtered.length} rows • Sorted by {sortColumn} ({sortDirection}) • Displaying {filtered.length} of {trips.length} trips</span>
          </div>
          <div className="flex items-center gap-3 self-end sm:self-auto">
            <span data-testid="master-footer-distances" className="font-mono text-slate-500 font-medium bg-slate-100 px-2 py-0.5 rounded text-[11px] border border-slate-200/80">Official {sums.officialKm.toLocaleString()} KM • Private {sums.privateKm.toLocaleString()} KM • Total {sums.totalKm.toLocaleString()} KM</span>
            <button onClick={() => { tableContainerRef.current?.scrollTo({top:0, behavior:'smooth'}); window.scrollTo({top:0, behavior:'smooth'}); }} className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 transition shadow-sm cursor-pointer" type="button">
              <svg className="w-3.5 h-3.5 text-slate-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5"></path></svg>
              <span>Scroll to Top</span>
            </button>
          </div>
        </footer>
      </section>

      {/* Portal ⋯ menu - fixed outside scroll container to avoid clipping, auto-flips above for last rows */}
      {openMenuId && menuAnchorRect && typeof document !== 'undefined' && createPortal(
        <>
          <div className="fixed inset-0 z-30" onClick={closeMenu} aria-hidden />
          {(() => {
            const tripForMenu = filtered.find(x => x.id === openMenuId) ?? sortedAll.find(x => x.id === openMenuId);
            const gapForMenu = predecessorGapMap.get(openMenuId) ?? null;
            const menuW = 192;
            const menuH = gapForMenu ? 160 : 132;
            const gap = 6;
            const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
            const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
            let top = menuAnchorRect.bottom + gap;
            let left = menuAnchorRect.right - menuW;
            if (left < 8) left = 8;
            if (left + menuW > vw - 8) left = vw - menuW - 8;
            const willClipBottom = top + menuH > vh - 8;
            if (willClipBottom) top = menuAnchorRect.top - menuH - gap;
            if (top < 8) top = 8;
            return (
              <div
                data-testid={`row-menu-portal-${openMenuId}`}
                className="fixed z-40 bg-paper-sheet border border-rule-line rounded-lg shadow-xl py-1 w-48 text-left"
                style={{ top, left }}
                onClick={e => e.stopPropagation()}
              >
                {gapForMenu && (
                  <button
                    data-testid={`fill-gap-menu-${openMenuId}`}
                    onClick={() => { closeMenu(); openGapFill(gapForMenu); }}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-paper-gutter"
                  >
                    Fill Gap ({gapForMenu.expected}→{gapForMenu.actual})
                  </button>
                )}
                <button
                  data-testid={`insert-after-menu-${openMenuId}`}
                  onClick={() => { if (!tripForMenu) { closeMenu(); return; } closeMenu(); openInsert(tripForMenu); }}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-paper-gutter"
                >
                  Insert After
                </button>
                <button
                  data-testid={`remove-shift-menu-${openMenuId}`}
                  onClick={() => { if (!tripForMenu) { closeMenu(); return; } closeMenu(); openRemoveShift(tripForMenu); }}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-paper-gutter text-amber-700"
                >
                  Remove &amp; Shift
                </button>
                <button
                  data-testid={`delete-menu-${openMenuId}`}
                  onClick={() => { const id = openMenuId; closeMenu(); setConfirmDelete(id); }}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-paper-gutter text-red-600"
                >
                  Delete
                </button>
              </div>
            );
          })()}
        </>,
        document.body
      )}

      {/* Row right-click: Private/Official toggle */}
      {rowContextMenu && typeof document !== 'undefined' && createPortal(
        <>
          <div className="fixed inset-0 z-30" onClick={closeRowMenu} aria-hidden />
          {(() => {
            const trip = filtered.find(x => x.id === rowContextMenu.tripId) ?? sortedAll.find(x => x.id === rowContextMenu.tripId);
            if (!trip) return null;
            const isPrivate = trip.trip_type === 'Private';
            const label = isPrivate ? 'Mark as Official Trip' : 'Mark as Private Trip';
            const menuW = 200;
            const menuH = 36;
            const gap = 4;
            const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
            const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
            let top = rowContextMenu.y + gap;
            let left = rowContextMenu.x + gap;
            if (left + menuW > vw - 8) left = vw - menuW - 8;
            if (top + menuH > vh - 8) top = rowContextMenu.y - menuH - gap;
            if (top < 8) top = 8;
            if (left < 8) left = 8;
            return (
              <div
                data-testid={`row-context-menu-${rowContextMenu.tripId}`}
                className="fixed z-40 bg-paper-sheet border border-rule-line rounded-lg shadow-xl py-1 w-52 text-left"
                style={{ top, left }}
                onClick={e => e.stopPropagation()}
              >
                <button
                  data-testid={`toggle-trip-type-${rowContextMenu.tripId}`}
                  onClick={() => handleToggleTripType(trip)}
                  className={`w-full text-left px-3 py-2 text-xs font-semibold hover:bg-paper-gutter flex items-center gap-2 ${isPrivate ? 'text-slate-700' : 'text-orange-700'}`}
                >
                  <span className={`w-2 h-2 rounded-full ${isPrivate ? 'bg-slate-700' : 'bg-orange-500'}`} />
                  {label}
                </button>
              </div>
            );
          })()}
        </>,
        document.body
      )}

      {/* Confirm Private/Official toggle */}
      {confirmToggle && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" data-testid="confirm-toggle-dialog" onClick={() => setConfirmToggle(null)}>
          <div className="bg-paper-sheet rounded-xl shadow-xl p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-on-surface mb-2">Confirm Change</h3>
            <p className="text-sm text-on-surface-variant mb-4">
              Mark trip on <span className="font-semibold text-on-surface">{confirmToggle.date}</span> ({Math.round(confirmToggle.start_km)}–{Math.round(confirmToggle.end_km)} • {confirmToggle.places_visited}) as <span className="font-bold">{confirmToggle.trip_type === 'Private' ? 'Official' : 'Private'}</span>? Current: <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${confirmToggle.trip_type === 'Private' ? 'bg-orange-200 text-orange-800' : 'bg-slate-200 text-slate-700'}`}>{confirmToggle.trip_type}</span>
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmToggle(null)} className="px-4 py-2 text-sm font-semibold text-on-surface-variant hover:bg-paper-gutter rounded-lg transition-colors" data-testid="confirm-toggle-cancel">Cancel</button>
              <button onClick={doToggleTripType} className={`px-4 py-2 text-sm font-semibold text-white rounded-lg transition-colors ${confirmToggle.trip_type === 'Private' ? 'bg-slate-700 hover:bg-slate-800' : 'bg-orange-600 hover:bg-orange-700'}`} data-testid="confirm-toggle-ok">{confirmToggle.trip_type === 'Private' ? 'Mark as Official' : 'Mark as Private'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Dialog for inline edit */}
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

      {/* Gap Fill Dialog */}
      {gapFillTarget && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" data-testid="gap-fill-dialog">
          <div className="bg-paper-sheet rounded-xl shadow-xl p-6 max-w-lg w-full max-h-[90vh] overflow-auto" onClick={(e)=>e.stopPropagation()}>
            <h3 className="text-sm font-bold text-on-surface mb-1">Fill Gap ({gapFillTarget.expected}→{gapFillTarget.actual})</h3>
            <p className="text-xs text-on-surface-variant mb-3">Gap {gapFillTarget.delta} km between {gapFillTarget.predecessor.date} ({gapFillTarget.predecessor.start_km}→{gapFillTarget.predecessor.end_km}) and {gapFillTarget.successor.date} ({gapFillTarget.successor.start_km}→{gapFillTarget.successor.end_km}). No downstream shift — consumes gap exactly.</p>
            {gapFillError && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1 mb-2" data-testid="gap-fill-error">{gapFillError}</div>}
            <div className="grid grid-cols-2 gap-3 text-xs">
              <label className="flex flex-col gap-1">Date
                <input type="date" value={gapFillForm.date} min={gapFillTarget.predecessor.date} max={gapFillTarget.successor.date} onChange={e=>setGapFillForm({...gapFillForm, date:e.target.value})} className="border border-rule-line rounded px-2 py-1" data-testid="gap-fill-date" />
              </label>
              <label className="flex flex-col gap-1">Trip Type
                <select value={gapFillForm.trip_type} onChange={e=>setGapFillForm({...gapFillForm, trip_type:e.target.value as any})} className="border border-rule-line rounded px-2 py-1" data-testid="gap-fill-type">
                  <option value="Official">Official</option>
                  <option value="Private">Private</option>
                </select>
              </label>
              <label className="flex flex-col gap-1">Start KM (auto)
                <input value={String(gapFillTarget.expected)} disabled className="border border-rule-line rounded px-2 py-1 bg-paper-gutter" data-testid="gap-fill-start" />
              </label>
              <label className="flex flex-col gap-1">End KM (auto)
                <input value={String(gapFillTarget.actual)} disabled className="border border-rule-line rounded px-2 py-1 bg-paper-gutter" data-testid="gap-fill-end" />
              </label>
              <label className="flex flex-col gap-1">Distance (auto)
                <input value={String(gapFillTarget.delta)} disabled className="border border-rule-line rounded px-2 py-1 bg-paper-gutter" />
              </label>
              <label className="flex flex-col gap-1">End Time *
                <input type="time" value={gapFillForm.end_time} onChange={e=>setGapFillForm({...gapFillForm, end_time:e.target.value})} className="border border-rule-line rounded px-2 py-1" data-testid="gap-fill-end-time" />
              </label>
              <label className="flex flex-col gap-1">Start Time
                <input type="time" value={gapFillForm.start_time} onChange={e=>setGapFillForm({...gapFillForm, start_time:e.target.value})} className="border border-rule-line rounded px-2 py-1" />
              </label>
              <label className="flex flex-col gap-1">Fuel Pumped
                <input type="number" step="0.1" value={gapFillForm.fuel_pumped_amount} onChange={e=>setGapFillForm({...gapFillForm, fuel_pumped_amount:e.target.value})} className="border border-rule-line rounded px-2 py-1" />
              </label>
              <label className="col-span-2 flex flex-col gap-1">Places Visited *
                <input value={gapFillForm.places_visited} onChange={e=>setGapFillForm({...gapFillForm, places_visited:e.target.value})} placeholder="e.g., Colombo -> Kandy" className="border border-rule-line rounded px-2 py-1" data-testid="gap-fill-places" />
              </label>
              <label className="flex flex-col gap-1">Fuel Order No
                <input value={gapFillForm.fuel_order_no} onChange={e=>setGapFillForm({...gapFillForm, fuel_order_no:e.target.value})} className="border border-rule-line rounded px-2 py-1" />
              </label>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={()=>setGapFillTarget(null)} className="px-4 py-2 text-sm font-semibold text-on-surface-variant hover:bg-paper-gutter rounded-lg">Cancel</button>
              <button data-testid="confirm-gap-fill" onClick={handleGapFillSave} className="px-4 py-2 text-sm font-semibold text-on-primary bg-slate-surface rounded-lg hover:bg-primary">Confirm Gap Fill</button>
            </div>
          </div>
        </div>
      )}

      {/* Insert After Dialog */}
      {insertTarget && !insertConfirm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" data-testid="insert-dialog">
          <div className="bg-paper-sheet rounded-xl shadow-xl p-6 max-w-lg w-full max-h-[90vh] overflow-auto" onClick={e=>e.stopPropagation()}>
            <h3 className="text-sm font-bold text-on-surface mb-1">Insert After {insertTarget.anchor.date} ({insertTarget.anchor.start_km}→{insertTarget.anchor.end_km})</h3>
            <p className="text-xs text-on-surface-variant mb-3">Downstream trips will shift by Δ = End − Start. Confirmation shows preview.</p>
            {insertError && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1 mb-2" data-testid="insert-error">{insertError}</div>}
            {/* ODO Reciprocal — Start + Distance = End (Integer KM) */}
            <div className="p-3 bg-paper-ledger dark:bg-zinc-800/50 rounded-lg border border-rule-line mb-3">
              <h4 className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-2">Odometer Reciprocal — Start + Distance = End</h4>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <label className="flex flex-col gap-1">Date *
                  <input type="date" value={insertForm.date} min={insertTarget.anchor.date} max={sortedAll[insertTarget.sortedIdx+1]?.date} onChange={e=>setInsertForm({...insertForm, date:e.target.value})} className="border border-rule-line rounded px-2 py-1" data-testid="insert-date" />
                </label>
                <label className="flex flex-col gap-1">Trip Type
                  <select value={insertForm.trip_type} onChange={e=>setInsertForm({...insertForm, trip_type:e.target.value as any})} className="border border-rule-line rounded px-2 py-1" data-testid="insert-type">
                    <option value="Official">Official</option>
                    <option value="Private">Private</option>
                  </select>
                </label>
              </div>
              <div className="grid grid-cols-3 gap-3 text-xs mt-3">
                <label className="flex flex-col gap-1">Start KM *
                  <input type="number" step="1" value={insertForm.start_km} onChange={e=>{
                    const val=e.target.value;
                    const s=parseIntKmInsert(val);
                    let nextEnd=insertForm.end_km;
                    let nextDist=insertForm.distance;
                    if(!isNaN(s)){
                      if(insertForm.distance!=='' && !isNaN(parseIntKmInsert(insertForm.distance))){
                        const d=parseIntKmInsert(insertForm.distance);
                        nextEnd=String(calculateEndKm(s,d));
                        nextDist=String(d);
                      } else if(insertForm.end_km!=='' && !isNaN(parseIntKmInsert(insertForm.end_km))){
                        const eKm=parseIntKmInsert(insertForm.end_km);
                        nextDist=String(calculateTripDistance(s,eKm));
                      }
                    }
                    const est = !isNaN(parseIntKmInsert(nextDist)) && insertForm.end_time && insertForm.start_time==='' ? maybeAutoEstimateInsert(nextDist, insertForm.end_time, '') : null;
                    setInsertForm(prev=>({ ...prev, start_km: val, end_km: nextEnd, distance: nextDist, ...(est ? { start_time: est } : {}) }));
                  }} className="border border-rule-line rounded px-2 py-1" data-testid="insert-start" />
                </label>
                <label className="flex flex-col gap-1">End KM *
                  <input type="number" step="1" value={insertForm.end_km} onChange={e=>{
                    const val=e.target.value;
                    const end=parseIntKmInsert(val);
                    const start=parseIntKmInsert(insertForm.start_km);
                    let nextDist=insertForm.distance;
                    if(!isNaN(end) && !isNaN(start)){
                      nextDist=String(calculateTripDistance(start,end));
                    } else if(val===''){ nextDist=''; }
                    const est = nextDist && insertForm.end_time && insertForm.start_time==='' ? maybeAutoEstimateInsert(nextDist, insertForm.end_time, '') : null;
                    setInsertForm(prev=>({ ...prev, end_km: val, distance: nextDist, ...(est ? { start_time: est } : {}) }));
                  }} className="border border-rule-line rounded px-2 py-1" data-testid="insert-end" />
                </label>
                <label className="flex flex-col gap-1">Distance (KM) *
                  <input type="number" step="1" value={insertForm.distance} onChange={e=>{
                    const val=e.target.value;
                    const d=parseIntKmInsert(val);
                    const start=parseIntKmInsert(insertForm.start_km);
                    let nextEnd=insertForm.end_km;
                    if(!isNaN(d) && !isNaN(start)){
                      nextEnd=String(calculateEndKm(start,d));
                    }
                    const est = val && insertForm.end_time && insertForm.start_time==='' ? maybeAutoEstimateInsert(val, insertForm.end_time, '') : null;
                    setInsertForm(prev=>({ ...prev, distance: val, end_km: nextEnd, ...(est ? { start_time: est } : {}) }));
                  }} placeholder="Enter Distance" className="border border-rule-line rounded px-2 py-1" data-testid="insert-distance" />
                </label>
              </div>
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mt-2">Formula: Distance (int) = round(End − Start) • Integer KM</p>
            </div>
            {/* Time Reciprocal — End − Duration = Start • Estimated Start Time */}
            {isInsertTrafficMode && (
              <div className="flex items-center gap-3 px-2 py-2 bg-amber-50 border border-amber-200 rounded-lg mb-3">
                <span className="text-xs font-bold uppercase tracking-wider text-amber-800">Traffic Mode</span>
                <label className="flex items-center gap-1.5 cursor-pointer text-xs">
                  <input type="radio" name="insertTrafficMode" value="traffic" checked={insertTrafficMode === 'traffic'} onChange={() => setInsertTrafficMode('traffic')} className="accent-amber-600" />
                  <span className="text-sm font-medium">Traffic</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer text-xs">
                  <input type="radio" name="insertTrafficMode" value="light" checked={insertTrafficMode === 'light'} onChange={() => setInsertTrafficMode('light')} className="accent-emerald-600" />
                  <span className="text-sm font-medium">Light Traffic</span>
                </label>
                <span className="text-[10px] text-zinc-500 ml-auto">Selects Speed Slab set for Auto estimate</span>
              </div>
            )}
            <div className="p-3 bg-paper-ledger dark:bg-zinc-800/50 rounded-lg border border-rule-line mb-3">
              <h4 className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-2">Time Reciprocal — Estimated Start Time</h4>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="flex flex-col gap-1">
                  <label>Start Time <span className="text-zinc-400 font-normal text-[10px]">Optional</span></label>
                  <div className="flex gap-1">
                    <input type="time" value={insertForm.start_time} onChange={e=>setInsertForm({...insertForm, start_time:e.target.value})} className="flex-1 border border-rule-line rounded px-2 py-1" data-testid="insert-start-time" />
                    <button type="button" aria-label="Auto" onClick={handleAutoInsertEstimate} className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider border border-zinc-300 rounded bg-white hover:bg-zinc-50" title="Estimate Start Time as End − (Distance/speed) ceil 5 min" data-testid="insert-auto-btn">Auto</button>
                  </div>
                  <div className="flex gap-1 mt-1">
                    <button type="button" onClick={()=>nudgeInsertStartTime(-10)} disabled={!insertForm.start_time} className="flex-1 py-0.5 text-[10px] font-mono border rounded bg-white disabled:opacity-40" title="-10 min" data-testid="insert-nudge-m10">−10</button>
                    <button type="button" onClick={()=>nudgeInsertStartTime(-5)} disabled={!insertForm.start_time} className="flex-1 py-0.5 text-[10px] font-mono border rounded bg-white disabled:opacity-40" title="-5 min" data-testid="insert-nudge-m5">−5</button>
                    <button type="button" onClick={()=>nudgeInsertStartTime(5)} disabled={!insertForm.start_time} className="flex-1 py-0.5 text-[10px] font-mono border rounded bg-white disabled:opacity-40" title="+5 min" data-testid="insert-nudge-p5">+5</button>
                    <button type="button" onClick={()=>nudgeInsertStartTime(10)} disabled={!insertForm.start_time} className="flex-1 py-0.5 text-[10px] font-mono border rounded bg-white disabled:opacity-40" title="+10 min" data-testid="insert-nudge-p10">+10</button>
                  </div>
                  <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Auto: End − (Distance/speed) ceil 5 min</span>
                </div>
                <label className="flex flex-col gap-1">End Time *
                  <input type="time" value={insertForm.end_time} onChange={e=>{
                    const val=e.target.value;
                    const dStr = insertForm.distance !== '' ? insertForm.distance : (insertForm.start_km && insertForm.end_km && !isNaN(parseIntKmInsert(insertForm.start_km)) && !isNaN(parseIntKmInsert(insertForm.end_km)) ? String(calculateTripDistance(parseIntKmInsert(insertForm.start_km), parseIntKmInsert(insertForm.end_km))) : '');
                    const est = dStr && insertForm.start_time==='' ? maybeAutoEstimateInsert(dStr, val, '') : null;
                    setInsertForm(prev=>({ ...prev, end_time: val, ...(est ? { start_time: est } : {}) }));
                  }} className="border border-rule-line rounded px-2 py-1" data-testid="insert-end-time" />
                  <span className="text-[10px] text-zinc-500">defaults to entry • empty Start auto-fills</span>
                </label>
              </div>
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mt-2">Formula: Estimated Start = End − ceil((Distance/speed)*60 /5)*5 • Supports overnight wrap • Only auto-fills when Start empty</p>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <label className="flex flex-col gap-1">Fuel Pumped
                <input type="number" step="0.1" value={insertForm.fuel_pumped_amount} onChange={e=>setInsertForm({...insertForm, fuel_pumped_amount:e.target.value})} className="border border-rule-line rounded px-2 py-1" />
              </label>
              <label className="flex flex-col gap-1">Fuel Order No
                <input value={insertForm.fuel_order_no} onChange={e=>setInsertForm({...insertForm, fuel_order_no:e.target.value})} className="border border-rule-line rounded px-2 py-1" />
              </label>
              <div className="col-span-2 flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium">Places Visited / Route & Purpose <span className="text-red-500">*</span></span>
                  <div className="flex gap-1.5">
                    <button type="button" data-testid="insert-quick-places-home-office" onClick={()=>setInsertForm(prev=>({ ...prev, places_visited: 'Home - Office' }))} className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition ${insertForm.places_visited === 'Home - Office' ? 'bg-sky-600 border-sky-600 text-white' : 'bg-zinc-50 border-zinc-300 text-zinc-700 hover:bg-sky-50 hover:border-sky-300'}`} title="Fill Places Visited with Home - Office">Home - Office</button>
                    <button type="button" data-testid="insert-quick-places-office-home" onClick={()=>setInsertForm(prev=>({ ...prev, places_visited: 'Office - Home' }))} className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition ${insertForm.places_visited === 'Office - Home' ? 'bg-sky-600 border-sky-600 text-white' : 'bg-zinc-50 border-zinc-300 text-zinc-700 hover:bg-sky-50 hover:border-sky-300'}`} title="Fill Places Visited with Office - Home">Office - Home</button>
                  </div>
                </div>
                <input value={insertForm.places_visited} onChange={e=>setInsertForm({...insertForm, places_visited:e.target.value})} placeholder="e.g., HQ Fleet Yard → Regional Port Customs" className="border border-rule-line rounded px-2 py-1" data-testid="insert-places" />
                <p className="text-[11px] text-zinc-500">Tap a chip to fill — you can still edit freely after.</p>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={()=>setInsertTarget(null)} className="px-4 py-2 text-sm font-semibold text-on-surface-variant hover:bg-paper-gutter rounded-lg">Cancel</button>
              <button data-testid="insert-preview-btn" onClick={handleInsertPreview} className="px-4 py-2 text-sm font-semibold text-on-primary bg-slate-surface rounded-lg hover:bg-primary">Preview Shift</button>
            </div>
          </div>
        </div>
      )}

      {/* Insert Confirmation Preview */}
      {insertConfirm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" data-testid="insert-confirm-modal">
          <div className="bg-paper-sheet rounded-xl shadow-xl p-6 max-w-2xl w-full max-h-[90vh] overflow-auto" onClick={e=>e.stopPropagation()}>
            <h3 className="text-sm font-bold text-on-surface mb-2">Insert Trip — Shift {insertConfirm.downstreamCount} trips by {insertConfirm.delta} km?</h3>
            <p className="text-xs text-on-surface-variant mb-3">This will insert a new trip and shift all later trips chronologically. Fuel chain will be recomputed forward.</p>
            <div className="border border-rule-line rounded-lg overflow-hidden mb-3">
              <table className="w-full text-xs">
                <thead className="bg-paper-gutter">
                  <tr><th className="px-2 py-1 text-left">Trip</th><th className="px-2 py-1 text-right">Before</th><th className="px-2 py-1 text-right">After</th></tr>
                </thead>
                <tbody>
                  {insertConfirm.preview.map((p, i) => (
                    <tr key={p.before.id} data-testid={`shift-preview-row-${i}`} className="border-t border-rule-line">
                      <td className="px-2 py-1">{p.before.date} {p.before.start_km}→{p.before.end_km}</td>
                      <td className="px-2 py-1 text-right font-mono">{p.before.start_km}→{p.before.end_km}</td>
                      <td className="px-2 py-1 text-right font-mono font-bold">{p.after.start_km}→{p.after.end_km}</td>
                    </tr>
                  ))}
                  {insertConfirm.downstreamCount > 3 && (
                    <tr className="border-t border-rule-line"><td colSpan={3} className="px-2 py-1 text-center text-on-surface-variant">+{insertConfirm.downstreamCount - 3} more trips will shift</td></tr>
                  )}
                  {insertConfirm.downstreamCount === 0 && (
                    <tr><td colSpan={3} className="px-2 py-2 text-center text-on-surface-variant">No downstream trips to shift (insert at end)</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {insertError && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1 mb-2">{insertError}</div>}
            <div className="flex justify-end gap-2">
              <button onClick={()=>setInsertConfirm(null)} className="px-4 py-2 text-sm font-semibold text-on-surface-variant hover:bg-paper-gutter rounded-lg">Cancel</button>
              <button data-testid="confirm-insert-shift" onClick={handleInsertConfirm} className="px-4 py-2 text-sm font-semibold text-white bg-slate-surface rounded-lg hover:bg-primary">Confirm Insert &amp; Shift</button>
            </div>
          </div>
        </div>
      )}

      {/* Remove & Shift Confirmation */}
      {removeTarget && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" data-testid="remove-confirm-modal">
          <div className="bg-paper-sheet rounded-xl shadow-xl p-6 max-w-2xl w-full max-h-[90vh] overflow-auto" onClick={e=>e.stopPropagation()}>
            <h3 className="text-sm font-bold text-on-surface mb-2">Remove Trip — Shift {removeTarget.downstream.length} trips by −{removeTarget.delta} km?</h3>
            <p className="text-xs text-on-surface-variant mb-2">Remove {removeTarget.trip.date} ({removeTarget.trip.start_km}→{removeTarget.trip.end_km}, {removeTarget.delta} km) and shift downstream down by Δ. This cannot be undone without re-inserting. Empty Pages retained.</p>
            <div className="border border-rule-line rounded-lg overflow-hidden mb-3">
              <table className="w-full text-xs">
                <thead className="bg-paper-gutter">
                  <tr><th className="px-2 py-1 text-left">Trip</th><th className="px-2 py-1 text-right">Before</th><th className="px-2 py-1 text-right">After</th></tr>
                </thead>
                <tbody>
                  {removeTarget.downstream.slice(0,3).map((t,i) => {
                    const afterStart = roundToIntegerKm(t.start_km - removeTarget.delta);
                    const afterEnd = roundToIntegerKm(t.end_km - removeTarget.delta);
                    return (
                      <tr key={t.id} data-testid={`remove-preview-row-${i}`} className="border-t border-rule-line">
                        <td className="px-2 py-1">{t.date} {t.start_km}→{t.end_km}</td>
                        <td className="px-2 py-1 text-right font-mono">{t.start_km}→{t.end_km}</td>
                        <td className="px-2 py-1 text-right font-mono font-bold">{afterStart}→{afterEnd}</td>
                      </tr>
                    );
                  })}
                  {removeTarget.downstream.length > 3 && <tr className="border-t border-rule-line"><td colSpan={3} className="px-2 py-1 text-center text-on-surface-variant">+{removeTarget.downstream.length - 3} more trips will shift</td></tr>}
                  {removeTarget.downstream.length === 0 && <tr><td colSpan={3} className="px-2 py-2 text-center text-on-surface-variant">No downstream trips to shift</td></tr>}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-on-surface-variant mb-3">Plain Delete (no shift) remains available in the ⋯ menu and may leave a new RED gap.</p>
            <div className="flex justify-end gap-2">
              <button onClick={()=>setRemoveTarget(null)} className="px-4 py-2 text-sm font-semibold text-on-surface-variant hover:bg-paper-gutter rounded-lg">Cancel</button>
              <button data-testid="confirm-remove-shift" onClick={handleRemoveConfirm} className="px-4 py-2 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700">Remove &amp; Shift</button>
            </div>
          </div>
        </div>
      )}

      {/* Sheet Settings Dialog */}
      <SheetSettingsDialog open={showSheetSettings} onClose={() => setShowSheetSettings(false)} onSaved={() => { setShowSheetSettings(false); setLastPullAtState(getLastPullAt()); setLastPushAtState(getLastPushAt()); }} />

      {/* Push Preview */}
      {showPushPreview && pushPreview && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" data-testid="sheet-push-preview" onClick={() => { setShowPushPreview(false); setPushPreview(null); }}>
          <div className="bg-paper-sheet rounded-xl shadow-xl p-6 max-w-3xl w-full max-h-[90vh] overflow-auto" onClick={e=>e.stopPropagation()}>
            <h3 className="text-sm font-bold text-on-surface mb-1">Export to Google Sheet — Preview</h3>
            <p className="text-xs text-on-surface-variant mb-1">
              Trips — DB {pushPreview.dbCount} | Preserved {pushPreview.preserved.length} (unimported) | Overwriting {pushPreview.overwritingCount} | Invalid {pushPreview.invalidIgnored}
            </p>
            <p className="text-xs text-on-surface-variant mb-2">
              Leaves — DB {pushPreview.leavesDbCount} | Preserved {pushPreview.leavesPreserved.length} | Overwriting {pushPreview.leavesOverwriting} | Invalid {pushPreview.leavesInvalid} · Leaves total {pushExactMirror ? pushPreview.mergedLeavesExact.length : pushPreview.mergedLeaves.length}
            </p>
            <label className="flex items-start gap-2 px-3 py-2 mb-3 rounded-lg border bg-white cursor-pointer" data-testid="push-exact-mirror-toggle">
              <input type="checkbox" checked={pushExactMirror} onChange={e=>setPushExactMirror(e.target.checked)} className="mt-0.5" data-testid="push-exact-mirror-checkbox" />
              <span className="flex flex-col">
                <span className="text-xs font-bold text-slate-800">Exact mirror — make sheet exactly equal app DB (delete preserved rows)</span>
                <span className="text-[11px] text-on-surface-variant">Uncheck = default safe merge (DB + preserved unimported buffer rows appended). Check = sheet will be cleared and rewritten with only {pushPreview.dbCount} DB trips + {pushPreview.leavesDbCount} leaves — the 2026-09-20 {pushPreview.preserved.length>0 ? `and ${pushPreview.preserved.length} preserved` : ''} row(s) will be removed. Use this to propagate deletions like your 2026-09-20 SLIIT record.</span>
              </span>
            </label>
            <p className={`text-xs font-semibold rounded px-2 py-1 mb-3 border ${pushExactMirror ? 'text-red-700 bg-red-50 border-red-200' : 'text-amber-700 bg-amber-50 border-amber-200'}`}>Sheet will be cleared and rewritten atomically (LockService, {pushExactMirror ? pushPreview.mergedRowsExact.length : pushPreview.mergedRows.length} trips + {pushExactMirror ? pushPreview.mergedLeavesExact.length : pushPreview.mergedLeaves.length} leaves){pushExactMirror ? ' — EXACT MIRROR (preserved rows will be deleted)' : ''}.</p>
            {(() => { const { sheetId, scriptUrl } = getSheetSettings(); if (!sheetId || !scriptUrl) return <div className="text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1 mb-3" data-testid="push-blocked-banner">Blocked by: Settings — configure Sheet ID and Apps Script URL</div>; return null; })()}
            {pushError && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1 mb-2" data-testid="sheet-push-preview-error">{pushError}</div>}

            <div className="mb-3">
              <button onClick={()=>setPushExpanded(v=>!v)} className="text-xs font-semibold text-cyan-700 hover:underline" data-testid="push-preserved-toggle">
                {pushExpanded ? 'Hide preserved rows' : `Show preserved rows (${pushPreview.preserved.length})`}
              </button>
              {pushExpanded && (
                <div className="mt-2 border border-rule-line rounded max-h-[260px] overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-paper-gutter sticky top-0"><tr><th className="px-2 py-1 text-left">Date</th><th className="px-2 py-1 text-right">KM</th><th className="px-2 py-1 text-left">Places</th></tr></thead>
                    <tbody>
                      {pushPreview.preserved.length===0 ? <tr><td colSpan={3} className="text-center py-2 text-on-surface-variant">No preserved rows — all buffer rows already in DB</td></tr> :
                        pushPreview.preserved.map((r,i)=>(
                          <tr key={`${r.date}|${r.start_km}|${r.end_km}|${i}`} className="border-t border-rule-line" data-testid={`push-preserved-${i}`}>
                            <td className="px-2 py-1 whitespace-nowrap">{r.date}</td>
                            <td className="px-2 py-1 font-mono text-right">{r.start_km}→{r.end_km}</td>
                            <td className="px-2 py-1 truncate max-w-[200px]">{r.places_visited}</td>
                          </tr>
                        ))
                      }
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 mt-4">
              <button onClick={()=>{ setShowPushPreview(false); setPushPreview(null); }} className="px-4 py-2 text-sm font-semibold text-on-surface-variant hover:bg-paper-gutter rounded-lg">Cancel</button>
              <button
                disabled={(()=>{ const { sheetId, scriptUrl } = getSheetSettings(); return !sheetId || !scriptUrl || sheetPushing; })()}
                onClick={handlePushConfirm}
                className={`px-4 py-2 text-sm font-semibold text-white rounded-lg disabled:opacity-50 ${pushExactMirror ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}
                data-testid="confirm-sheet-push"
              >
                {sheetPushing ? 'Exporting…' : pushExactMirror ? `Confirm Exact Mirror (${pushPreview.mergedRowsExact.length} rows — delete ${pushPreview.preserved.length} preserved)` : `Confirm Export (${pushPreview.mergedRows.length} rows)`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sheet Pull Preview */}
      {showPullPreview && pullComparison && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" data-testid="sheet-pull-preview">
          <div className="bg-paper-sheet rounded-xl shadow-xl p-6 max-w-3xl w-full max-h-[90vh] overflow-auto" onClick={e=>e.stopPropagation()}>
            <h3 className="text-sm font-bold text-on-surface mb-1">Import from Google Sheet — Preview</h3>
            <p className="text-xs text-on-surface-variant mb-3">
              Fetched {pullComparison.totalFetched} rows — <span className="font-bold text-emerald-700">{pullComparison.newRows.length} new</span>, <span className="font-bold text-amber-600">{pullComparison.changedRows.length} changed</span>, {pullComparison.skippedRows.length} already imported (Odo Key). New are checked, changed unchecked. Pagination/overlap validated on confirm.
            </p>
            {sheetError && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1 mb-2" data-testid="sheet-pull-error">{sheetError}</div>}

            {/* New rows */}
            <div className="mb-3">
              <div className="flex items-center justify-between mb-1">
                <h4 className="text-xs font-bold">New Trips ({pullComparison.newRows.length})</h4>
                <label className="text-[11px] flex items-center gap-1"><input type="checkbox" checked={pullComparison.newRows.length>0 && selectedNew.size===pullComparison.newRows.length} onChange={e=>{ if(e.target.checked) setSelectedNew(new Set(pullComparison.newRows.map(r=>`${r.partial.date}|${r.partial.start_km}|${r.partial.end_km}`))); else setSelectedNew(new Set()); }} /> {selectedNew.size===pullComparison.newRows.length?'Deselect all':'Select all'}</label>
              </div>
              <div className="border border-rule-line rounded max-h-[220px] overflow-auto">
                <table className="w-full text-xs">
                  <thead className="bg-paper-gutter sticky top-0"><tr><th className="px-1 py-1"></th><th className="px-1 py-1 text-left">Date</th><th className="px-1 py-1 text-right">KM</th><th className="px-1 py-1 text-left">Places</th><th className="px-1 py-1 text-left">Type</th><th className="px-1 py-1 text-right">Fuel</th></tr></thead>
                  <tbody>
                    {pullComparison.newRows.length===0 ? <tr><td colSpan={6} className="text-center py-2 text-on-surface-variant">No new rows</td></tr> : pullComparison.newRows.map((r,i)=>{
                      const k=`${r.partial.date}|${r.partial.start_km}|${r.partial.end_km}`;
                      const checked=selectedNew.has(k);
                      return <tr key={k} className="border-t border-rule-line"><td className="px-1"><input type="checkbox" checked={checked} onChange={e=>{ const ns=new Set(selectedNew); if(e.target.checked) ns.add(k); else ns.delete(k); setSelectedNew(ns); }} data-testid={`sheet-new-${i}`} /></td><td className="px-1 whitespace-nowrap">{r.partial.date}</td><td className="px-1 font-mono text-right">{r.partial.start_km}→{r.partial.end_km} ({r.partial.trip_distance})</td><td className="px-1 truncate max-w-[160px]">{r.partial.places_visited}</td><td className="px-1">{r.partial.trip_type}</td><td className="px-1 text-right">{r.partial.fuel_pumped_amount?.toFixed(1) ?? '0.0'}</td></tr>;
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Changed rows */}
            {pullComparison.changedRows.length>0 && (
              <div className="mb-3">
                <div className="flex items-center justify-between mb-1">
                  <h4 className="text-xs font-bold text-amber-700">Changed (same odo, diff fields) ({pullComparison.changedRows.length})</h4>
                  <label className="text-[11px] flex items-center gap-1"><input type="checkbox" checked={pullComparison.changedRows.length>0 && selectedChanged.size===pullComparison.changedRows.length} onChange={e=>{ if(e.target.checked) setSelectedChanged(new Set(pullComparison.changedRows.map(r=>`${r.partial.date}|${r.partial.start_km}|${r.partial.end_km}`))); else setSelectedChanged(new Set()); }} /> {selectedChanged.size===pullComparison.changedRows.length?'Deselect all':'Select all'}</label>
                </div>
                <div className="border border-amber-200 rounded max-h-[200px] overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-amber-50 sticky top-0"><tr><th className="px-1 py-1"></th><th className="px-1 py-1 text-left">Date</th><th className="px-1 py-1 text-right">KM</th><th className="px-1 py-1 text-left">Diff</th></tr></thead>
                    <tbody>
                      {pullComparison.changedRows.map((r,i)=>{
                        const k=`${r.partial.date}|${r.partial.start_km}|${r.partial.end_km}`;
                        const checked=selectedChanged.has(k);
                        return <tr key={k} className="border-t border-rule-line"><td className="px-1"><input type="checkbox" checked={checked} onChange={e=>{ const ns=new Set(selectedChanged); if(e.target.checked) ns.add(k); else ns.delete(k); setSelectedChanged(ns); }} data-testid={`sheet-changed-${i}`} /></td><td className="px-1 whitespace-nowrap">{r.partial.date}</td><td className="px-1 font-mono text-right">{r.partial.start_km}→{r.partial.end_km}</td><td className="px-1 text-[11px] text-amber-700 max-w-[260px] truncate" title={r.diff}>{r.diff}</td></tr>;
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Leaves — only if fetched */}
            {leavesPullComparison && (
              <div className="mt-4 border-t border-rule-line pt-3">
                <p className="text-xs text-on-surface-variant mb-2">
                  Leaves — Fetched {leavesPullComparison.totalFetched} · <span className="font-bold text-emerald-700">{leavesPullComparison.newRows.length} new</span>, <span className="font-bold text-amber-600">{leavesPullComparison.changedRows.length} changed</span>, {leavesPullComparison.skippedRows.length} already imported
                </p>
                <div className="mb-2">
                  <div className="flex items-center justify-between mb-1">
                    <h4 className="text-xs font-bold">New Leaves ({leavesPullComparison.newRows.length})</h4>
                    <label className="text-[11px] flex items-center gap-1"><input type="checkbox" checked={leavesPullComparison.newRows.length>0 && selectedLeaveNew.size===leavesPullComparison.newRows.length} onChange={e=>{ if(e.target.checked) setSelectedLeaveNew(new Set(leavesPullComparison.newRows.map(l=>l.date))); else setSelectedLeaveNew(new Set()); }} /> {selectedLeaveNew.size===leavesPullComparison.newRows.length?'Deselect all':'Select all'}</label>
                  </div>
                  <div className="border border-rule-line rounded max-h-[140px] overflow-auto">
                    <table className="w-full text-xs"><thead className="bg-paper-gutter sticky top-0"><tr><th className="px-1 py-1"></th><th className="px-1 py-1 text-left">Date</th><th className="px-1 py-1 text-left">Note</th></tr></thead><tbody>
                      {leavesPullComparison.newRows.length===0 ? <tr><td colSpan={3} className="text-center py-2 text-on-surface-variant">No new leaves</td></tr> : leavesPullComparison.newRows.map((l,i)=>{ const checked=selectedLeaveNew.has(l.date); return <tr key={l.date} className="border-t border-rule-line"><td className="px-1"><input type="checkbox" checked={checked} onChange={e=>{ const ns=new Set(selectedLeaveNew); if(e.target.checked) ns.add(l.date); else ns.delete(l.date); setSelectedLeaveNew(ns); }} data-testid={`sheet-leave-new-${i}`} /></td><td className="px-1 whitespace-nowrap">{l.date}</td><td className="px-1 truncate max-w-[200px]">{l.note}</td></tr>; })}
                    </tbody></table>
                  </div>
                </div>
                {leavesPullComparison.changedRows.length>0 && (
                  <div className="mb-2">
                    <div className="flex items-center justify-between mb-1"><h4 className="text-xs font-bold text-amber-700">Changed Leaves ({leavesPullComparison.changedRows.length})</h4><label className="text-[11px] flex items-center gap-1"><input type="checkbox" checked={leavesPullComparison.changedRows.length>0 && selectedLeaveChanged.size===leavesPullComparison.changedRows.length} onChange={e=>{ if(e.target.checked) setSelectedLeaveChanged(new Set(leavesPullComparison.changedRows.map(r=>r.bufferLeave.date))); else setSelectedLeaveChanged(new Set()); }} /> {selectedLeaveChanged.size===leavesPullComparison.changedRows.length?'Deselect all':'Select all'}</label></div>
                    <div className="border border-amber-200 rounded max-h-[140px] overflow-auto"><table className="w-full text-xs"><thead className="bg-amber-50 sticky top-0"><tr><th className="px-1 py-1"></th><th className="px-1 py-1 text-left">Date</th><th className="px-1 py-1 text-left">Diff</th></tr></thead><tbody>
                      {leavesPullComparison.changedRows.map((r,i)=>{ const k=r.bufferLeave.date; const checked=selectedLeaveChanged.has(k); return <tr key={k} className="border-t border-rule-line"><td className="px-1"><input type="checkbox" checked={checked} onChange={e=>{ const ns=new Set(selectedLeaveChanged); if(e.target.checked) ns.add(k); else ns.delete(k); setSelectedLeaveChanged(ns); }} data-testid={`sheet-leave-changed-${i}`} /></td><td className="px-1 whitespace-nowrap">{r.bufferLeave.date}</td><td className="px-1 text-[11px] text-amber-700" title={r.diff}>{r.diff}</td></tr>; })}
                    </tbody></table></div>
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2 mt-4">
              <button onClick={()=>{ setShowPullPreview(false); setPullComparison(null); setLeavesPullComparison(null); }} className="px-4 py-2 text-sm font-semibold text-on-surface-variant hover:bg-paper-gutter rounded-lg">Cancel</button>
              <button disabled={sheetPulling || (selectedNew.size===0 && selectedChanged.size===0 && selectedLeaveNew.size===0 && selectedLeaveChanged.size===0)} onClick={handleSheetImportConfirm} className="px-4 py-2 text-sm font-semibold text-white bg-cyan-600 rounded-lg hover:bg-cyan-700 disabled:opacity-50" data-testid="confirm-sheet-pull">{sheetPulling?'Importing…':`Import Selected (${selectedNew.size+selectedChanged.size+selectedLeaveNew.size+selectedLeaveChanged.size})`}</button>
            </div>
          </div>
        </div>
      )}

      {/* Start Time Audit Modal */}
      {showStartAudit && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" data-testid="start-audit-modal" onClick={()=>setShowStartAudit(false)}>
          <div className="bg-paper-sheet rounded-xl shadow-xl p-6 max-w-4xl w-full max-h-[90vh] overflow-auto" onClick={e=>e.stopPropagation()}>
            <h3 className="text-sm font-bold text-on-surface mb-1">Verify Start Times — Audit (Traffic)</h3>
            <p className="text-xs text-on-surface-variant mb-2">Scanned {trips.length} trips • Found {startAuditRows.length} anomalies via Traffic slabs (End − Distance/speed ceil 5 min). Check to fix Start → Estimated.</p>
            <div className="flex flex-wrap gap-1.5 mb-3 text-[11px] items-center">
              {(() => {
                const Pill = ({ reason, label, cls }: { reason: AuditReason, label: string, cls: string }) => {
                  const count = startAuditRows.filter(r=>r.reason===reason).length;
                  const active = auditFilter === reason;
                  return (
                    <button
                      type="button"
                      onClick={() => setAuditFilter(active ? 'All' : reason)}
                      className={`px-2.5 py-1 rounded-full border font-semibold transition cursor-pointer flex items-center gap-1 ${cls} ${active ? 'ring-2 ring-slate-800 ring-offset-1' : 'hover:brightness-95'} ${count===0 ? 'opacity-50' : ''}`}
                      title={active ? 'Click to show All' : `Filter to ${label} only`}
                      data-testid={`audit-pill-${reason}`}
                    >
                      <span>{label}</span>
                      <span className="bg-white/70 px-1 py-0 rounded text-[10px] font-bold">{count}</span>
                      {active && <span className="ml-1 text-[10px]">✕</span>}
                    </button>
                  );
                };
                return (
                  <>
                    <Pill reason="Empty" label="Empty" cls="bg-sky-100 border-sky-300 text-sky-800" />
                    <Pill reason="Equal" label="Same" cls="bg-red-100 border-red-300 text-red-800" />
                    <Pill reason="Inverted" label="Inverted" cls="bg-red-100 border-red-300 text-red-800" />
                    <Pill reason="Short" label="Short" cls="bg-amber-100 border-amber-300 text-amber-800" />
                    {auditFilter !== 'All' && (
                      <button type="button" onClick={() => setAuditFilter('All')} className="ml-1 px-2 py-1 rounded-full bg-slate-800 text-white text-[11px] font-semibold hover:bg-slate-900">Show All ({startAuditRows.length}) ✕</button>
                    )}
                    <span className="ml-auto text-on-surface-variant text-[11px] hidden sm:inline">
                      {auditFilter==='All' ? `Est via Traffic slabs • ${startAuditRows.length} total` : `Filtered: ${startAuditRows.filter(r=>r.reason===auditFilter).length} ${auditFilter==='Equal' ? 'Same' : auditFilter} • click pill again to clear`}
                    </span>
                  </>
                );
              })()}
            </div>
            {(() => {
              const displayAuditRows = auditFilter==='All' ? startAuditRows : startAuditRows.filter(r=>r.reason===auditFilter);
              const hasFiltered = displayAuditRows.length===0 && startAuditRows.length>0;
              if (startAuditRows.length===0) {
                return <div className="text-center py-8 text-sm text-on-surface-variant border border-dashed rounded-lg">No anomalies — all Start times consistent with Traffic estimate and End.</div>;
              }
              if (hasFiltered) {
                return <div className="text-center py-8 text-sm text-on-surface-variant border border-dashed rounded-lg">No {auditFilter==='Equal' ? 'Same' : auditFilter} anomalies — click pill again or Show All to clear filter. ({startAuditRows.length} total anomalies hidden)</div>;
              }
              return (
              <div className="border border-rule-line rounded-lg overflow-auto max-h-[52vh]">
                <table className="w-full text-xs">
                  <thead className="bg-paper-gutter sticky top-0">
                    <tr>
                      <th className="px-1 py-1"><input type="checkbox" checked={displayAuditRows.filter(r=>r.estimated).length>0 && displayAuditRows.every(r=>!r.estimated || selectedStartIds.has(r.trip.id))} onChange={e=>{
                        if(e.target.checked) {
                          const ns=new Set(selectedStartIds);
                          displayAuditRows.filter(r=>r.estimated).forEach(r=>ns.add(r.trip.id));
                          setSelectedStartIds(ns);
                        } else {
                          const ns=new Set(selectedStartIds);
                          displayAuditRows.forEach(r=>ns.delete(r.trip.id));
                          setSelectedStartIds(ns);
                        }
                      }} data-testid="audit-select-all" /></th>
                      <th className="px-1 py-1 text-left">#</th>
                      <th className="px-1 py-1 text-left">Date</th>
                      <th className="px-1 py-1 text-right">KM</th>
                      <th className="px-1 py-1 text-left">Reason</th>
                      <th className="px-1 py-1 font-mono">Start</th>
                      <th className="px-1 py-1 font-mono">End</th>
                      <th className="px-1 py-1 font-mono">Est(Traffic)</th>
                      <th className="px-1 py-1 font-mono">Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayAuditRows.map((row, i)=>{
                      const t=row.trip;
                      const checked=selectedStartIds.has(t.id);
                      const disabled=!row.estimated;
                      const reasonCls = row.reason==='Empty' ? 'bg-sky-100 border-sky-300 text-sky-800' : row.reason==='Equal' || row.reason==='Inverted' ? 'bg-red-100 border-red-300 text-red-800' : 'bg-amber-100 border-amber-300 text-amber-800';
                      const displayReason = row.reason==='Equal' ? 'Same' : row.reason;
                      return (
                        <tr key={t.id} className="border-t border-rule-line" data-testid={`audit-row-${i}`}>
                          <td className="px-1 py-1 text-center"><input type="checkbox" disabled={disabled} checked={checked} onChange={e=>{
                            const ns=new Set(selectedStartIds); if(e.target.checked) ns.add(t.id); else ns.delete(t.id); setSelectedStartIds(ns);
                          }} data-testid={`audit-check-${i}`} title={disabled?'Cannot estimate — check End/Distance':''} /></td>
                          <td className="px-1 py-1 font-mono">{String((globalSeqMap.get(t.id) ?? i+1)).padStart(2,'0')}</td>
                          <td className="px-1 py-1 whitespace-nowrap">{t.date}</td>
                          <td className="px-1 py-1 font-mono text-right">{Math.round(t.start_km)}→{Math.round(t.end_km)} ({Math.round(t.trip_distance)})</td>
                          <td className="px-1 py-1"><span className={`px-1.5 py-0.5 rounded-full border text-[10px] font-bold ${reasonCls}`}>{displayReason}</span></td>
                          <td className="px-1 py-1 font-mono">{t.start_time || '—'}</td>
                          <td className="px-1 py-1 font-mono">{t.end_time || '—'}</td>
                          <td className="px-1 py-1 font-mono font-bold">{row.estimated ?? '—'}</td>
                          <td className="px-1 py-1 font-mono">{row.durationMin!=null && row.estMin!=null ? `${row.durationMin}m → ${row.estMin}m${row.deltaMin!=null && row.deltaMin>0 ? ` (+${row.deltaMin}m)` : ''}` : row.durationMin!=null ? `${row.durationMin}m` : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              );
            })()}
            <div className="flex flex-wrap gap-2 mt-3">
              <button onClick={()=>{
                const by=(r:AuditReason)=> startAuditRows.filter(x=>x.reason===r && x.estimated).map(x=>x.trip.id);
                setSelectedStartIds(new Set(by('Empty')));
              }} className="px-2 py-1 text-xs border rounded hover:bg-paper-gutter">Select Empty</button>
              <button onClick={()=>{
                const by=(r:AuditReason)=> startAuditRows.filter(x=>x.reason===r && x.estimated).map(x=>x.trip.id);
                setSelectedStartIds(new Set([...by('Equal'), ...by('Inverted')]));
              }} className="px-2 py-1 text-xs border rounded hover:bg-paper-gutter">Select Equal/Inverted</button>
              <button onClick={()=>{
                const by=(r:AuditReason)=> startAuditRows.filter(x=>x.reason===r && x.estimated).map(x=>x.trip.id);
                setSelectedStartIds(new Set(by('Short')));
              }} className="px-2 py-1 text-xs border rounded hover:bg-paper-gutter">Select Short</button>
              <span className="ml-auto text-xs text-on-surface-variant">{selectedStartIds.size} selected</span>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={()=>setShowStartAudit(false)} className="px-4 py-2 text-sm font-semibold text-on-surface-variant hover:bg-paper-gutter rounded-lg">Close</button>
              <button disabled={auditFixing || selectedStartIds.size===0} onClick={handleFixSelectedStarts} className="px-4 py-2 text-sm font-semibold text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-50" data-testid="audit-fix-btn">
                {auditFixing ? 'Fixing…' : `Fix Selected (${selectedStartIds.size}) → Estimated`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
