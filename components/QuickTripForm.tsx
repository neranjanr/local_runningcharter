'use client';

import React, { useEffect, useState } from 'react';
import {
  calculateTripDistance,
  calculateEndKm,
  estimateStartTime,
  getDayOfWeek,
  getTodayDateString,
  getCurrentTimeString,
  calculateDurationMinutes,
  calculateStartTimeFromEndAndDuration,
  parseDurationToMinutes,
  formatDurationMinutes,
  roundToIntegerKm,
  roundToOneDecimal,
  parseTimeToMinutes,
  formatMinutesToTime,
} from '@/lib/tripCalculations';
import { getLastEndKm, saveTrip } from '@/lib/tripStore';
import { useToast } from '@/lib/toastContext';
import { getStoredSpeedConfigSync, loadSpeedConfig } from '@/lib/speedConfig';

export default function QuickTripForm({ onSuccess }: { onSuccess?: () => void }) {
  const { showToast } = useToast();
  const [date, setDate] = useState<string>(getTodayDateString());
  const [dayOfWeek, setDayOfWeek] = useState<string>(getDayOfWeek(getTodayDateString()));
  const [startKm, setStartKm] = useState<string>('');
  const [endKm, setEndKm] = useState<string>('');
  const [distance, setDistance] = useState<string>('');
  const [startTime, setStartTime] = useState<string>('');
  const [endTime, setEndTime] = useState<string>(getCurrentTimeString());
  const [duration, setDuration] = useState<string>('');
  const [tripType, setTripType] = useState<'Official' | 'Private'>('Official');
  const [placesVisited, setPlacesVisited] = useState<string>('');
  const [fuelPumped, setFuelPumped] = useState<string>('');
  const [fuelOrderNo, setFuelOrderNo] = useState<string>('');
  const [isAutoStartKm, setIsAutoStartKm] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [successMessage, setSuccessMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [trafficMode, setTrafficMode] = useState<'traffic' | 'light'>('traffic');
  const [isTrafficMode, setIsTrafficMode] = useState<boolean>(false);

  useEffect(() => {
    let mounted = true;
    // Initialize defaults
    const today = getTodayDateString();
    const currentTime = getCurrentTimeString();
    if (mounted) {
      setDate(today);
      setDayOfWeek(getDayOfWeek(today));
      setEndTime(currentTime);
    }
    getLastEndKm().then((lastEnd) => {
      if (!mounted) return;
      const rounded = roundToIntegerKm(lastEnd);
      setStartKm(String(rounded));
      setIsAutoStartKm(true);
      setLoading(false);
    });
    // Load speed config to know if Traffic selector should show
    loadSpeedConfig().then(c => {
      if (!mounted) return;
      setIsTrafficMode(c.mode === 'traffic');
    });
    const handler = () => {
      const c = getStoredSpeedConfigSync();
      setIsTrafficMode(c.mode === 'traffic');
    };
    window.addEventListener('fleetledger:speed-config-changed', handler);
    window.addEventListener('storage', handler as EventListener);
    return () => {
      mounted = false;
      window.removeEventListener('fleetledger:speed-config-changed', handler);
      window.removeEventListener('storage', handler as EventListener);
    };
  }, []);

  useEffect(() => {
    if (date) {
      setDayOfWeek(getDayOfWeek(date));
    }
  }, [date]);

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setDate(val);
    if (val) setDayOfWeek(getDayOfWeek(val));
  };

  const parseIntKm = (str: string): number => {
    const n = parseFloat(str);
    return isNaN(n) ? NaN : Math.round(n);
  };

  // Helper: auto-suggest Estimated Start Time only when Start Time is empty
  const maybeAutoEstimate = (nextDistanceStr: string, nextEndTime: string, currentStartTime: string) => {
    if (currentStartTime !== '') return;
    const d = parseIntKm(nextDistanceStr);
    if (isNaN(d) || d <= 0) return;
    if (!nextEndTime || !nextEndTime.includes(':')) return;
    const tm = isTrafficMode ? trafficMode : undefined;
    const estimated = estimateStartTime(nextEndTime, d, tm);
    if (estimated) {
      setStartTime(estimated);
      const dur = calculateDurationMinutes(estimated, nextEndTime);
      setDuration(formatDurationMinutes(dur));
    }
  };

  const nudgeStartTime = (deltaMin: number) => {
    if (!startTime || !startTime.includes(':')) return;
    const cur = parseTimeToMinutes(startTime);
    const next = formatMinutesToTime(cur + deltaMin);
    setStartTime(next);
    if (endTime) {
      const dur = calculateDurationMinutes(next, endTime);
      setDuration(formatDurationMinutes(dur));
    }
  };

  const handleStartKmChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setStartKm(val);
    setIsAutoStartKm(false);
    const s = parseIntKm(val);
    if (isNaN(s)) return;
    if (endKm !== '' && !isNaN(parseIntKm(endKm))) {
      const d = calculateTripDistance(s, parseIntKm(endKm));
      const dStr = String(d);
      setDistance(dStr);
      maybeAutoEstimate(dStr, endTime, startTime);
    } else if (distance !== '' && !isNaN(parseIntKm(distance))) {
      const end = calculateEndKm(s, parseIntKm(distance));
      setEndKm(String(end));
    }
  };

  const handleEndKmChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setEndKm(val);
    const end = parseIntKm(val);
    const start = parseIntKm(startKm);
    if (!isNaN(end) && !isNaN(start)) {
      const d = calculateTripDistance(start, end);
      const dStr = String(d);
      setDistance(dStr);
      maybeAutoEstimate(dStr, endTime, startTime);
    } else if (val === '') {
      setDistance('');
    }
  };

  const handleDistanceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    // allow integer input; keep raw string but parse int for calc
    setDistance(val);
    const d = parseIntKm(val);
    const start = parseIntKm(startKm);
    if (!isNaN(d) && !isNaN(start)) {
      const end = calculateEndKm(start, d);
      setEndKm(String(end));
      maybeAutoEstimate(String(d), endTime, startTime);
    } else if (val === '') {
      // don't auto clear end
    }
  };

  const handleStartTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setStartTime(val);
    if (val && endTime) {
      const dur = calculateDurationMinutes(val, endTime);
      setDuration(formatDurationMinutes(dur));
    } else if (val === '' ) {
      // if cleared, keep duration as is? Don't auto-clear duration
      // but clearing startTime does not block save (optional)
    }
  };

  const handleEndTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setEndTime(val);
    if (val && startTime) {
      const dur = calculateDurationMinutes(startTime, val);
      setDuration(formatDurationMinutes(dur));
    } else if (val && duration) {
      // if duration exists but start empty, recalc start
      const durMin = parseDurationToMinutes(duration);
      const start = calculateStartTimeFromEndAndDuration(val, durMin);
      setStartTime(start);
    } else {
      // Auto-estimate when start empty and distance present
      maybeAutoEstimate(distance, val, startTime);
    }
  };

  const handleDurationChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setDuration(val);
    const durMin = parseDurationToMinutes(val);
    if (endTime) {
      const start = calculateStartTimeFromEndAndDuration(endTime, durMin);
      setStartTime(start);
    }
  };

  const handleAutoEstimate = () => {
    const d = parseIntKm(distance);
    if (isNaN(d) || d <= 0) {
      setErrorMessage('Enter Distance and End Time to estimate Start Time.');
      return;
    }
    if (!endTime || !endTime.includes(':')) {
      setErrorMessage('Enter End Time to estimate Start Time.');
      return;
    }
    const tm = isTrafficMode ? trafficMode : undefined;
    const estimated = estimateStartTime(endTime, d, tm);
    if (!estimated) {
      setErrorMessage('Cannot estimate Start Time (check Distance and End Time).');
      return;
    }
    setStartTime(estimated);
    const dur = calculateDurationMinutes(estimated, endTime);
    setDuration(formatDurationMinutes(dur));
    setErrorMessage('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');

    if (!placesVisited.trim()) {
      setErrorMessage('Places visited is required.');
      return;
    }
    const sKm = parseIntKm(startKm);
    const eKm = parseIntKm(endKm);
    const dist = parseIntKm(distance);
    if (isNaN(sKm) || isNaN(eKm) || isNaN(dist)) {
      setErrorMessage('Please provide valid odometer values.');
      return;
    }
    if (!date || !endTime) {
      setErrorMessage('Please fill date and End Time fields.');
      return;
    }
    // startTime is now optional - empty string allowed

    setSaving(true);
    try {
      const fuelAmt = fuelPumped ? parseFloat(fuelPumped) : 0;
      await saveTrip({
        date,
        start_time: startTime ?? '',
        end_time: endTime,
        start_km: roundToIntegerKm(sKm),
        end_km: roundToIntegerKm(eKm),
        trip_distance: roundToIntegerKm(dist),
        trip_type: tripType,
        places_visited: placesVisited,
        fuel_pumped_amount: isNaN(fuelAmt) ? 0 : roundToOneDecimal(fuelAmt),
        fuel_order_no: fuelOrderNo,
      });
      setSuccessMessage('Trip saved successfully!');
      showToast('Trip Added', 2000);
      // Redirect to Dashboard after toast visible (~2s)
      setTimeout(() => {
        if (typeof window !== 'undefined') window.location.href = '/';
      }, 2100);
      // Reset end/distance/places for next entry, keep continuity: new start is previous end
      setStartKm(String(roundToIntegerKm(eKm)));
      setIsAutoStartKm(true);
      setEndKm('');
      setDistance('');
      setPlacesVisited('');
      setFuelPumped('');
      setFuelOrderNo('');
      // Keep times? Reset start/duration but keep end as current time for next
      setStartTime('');
      setDuration('');
      setEndTime(getCurrentTimeString());
      if (onSuccess) onSuccess();
      setTimeout(() => setSuccessMessage(''), 4000);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to save trip');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-zinc-500">Loading trip form...</div>;
  }

  return (
    <div className="max-w-3xl mx-auto bg-paper-sheet dark:bg-zinc-900 shadow-xl rounded-xl border border-rule-line dark:border-zinc-800 overflow-hidden">
      <div className="bg-slate-surface text-on-primary px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-telemetry-cyan text-xl">➕</span>
          <div>
            <h2 className="text-base font-bold tracking-tight">Quick Trip Data Entry</h2>
            <p className="text-xs text-on-primary-container">Smart reciprocal calculations • Ledger continuity</p>
          </div>
        </div>
        <span className="hidden sm:inline-flex items-center gap-1 text-xs bg-primary-container text-tertiary-fixed px-2.5 py-1 rounded-full font-semibold uppercase tracking-wider">
          SEC-24
        </span>
      </div>

      {successMessage && (
        <div className="mx-6 mt-6 p-3 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 rounded-lg text-sm font-medium">
          {successMessage}
        </div>
      )}
      {errorMessage && (
        <div className="mx-6 mt-6 p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-lg text-sm font-medium">
          {errorMessage}
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate className="p-6 space-y-6">
        {/* Date Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label htmlFor="trip-date" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              Date
            </label>
            <input
              id="trip-date"
              aria-label="Date"
              type="date"
              value={date}
              onChange={handleDateChange}
              required
              className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-cyan-500 focus:outline-none"
            />
            <p className="mt-1 text-xs font-semibold text-telemetry-cyan uppercase tracking-wider">
              {dayOfWeek}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Trip Type</label>
            <div className="flex items-center gap-4 mt-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="tripType"
                  value="Official"
                  checked={tripType === 'Official'}
                  onChange={() => setTripType('Official')}
                  className="accent-teal-600"
                />
                <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">Official</span>
                <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 text-[10px] font-bold uppercase">OFF</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="tripType"
                  value="Private"
                  checked={tripType === 'Private'}
                  onChange={() => setTripType('Private')}
                  className="accent-amber-600"
                />
                <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">Private</span>
                <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-[10px] font-bold uppercase">PRI</span>
              </label>
            </div>
          </div>
        </div>

        {/* Odometer Section */}
        <div className="p-4 bg-paper-ledger dark:bg-zinc-800/50 rounded-xl border border-rule-line dark:border-zinc-700 space-y-4">
          <h3 className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">Odometer Reciprocal — Start + Distance = End (Integer KM)</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label htmlFor="start-km" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Start KM
              </label>
              <input
                id="start-km"
                aria-label="Start KM"
                type="number"
                step="1"
                value={startKm}
                onChange={handleStartKmChange}
                required
                className={`w-full px-3 py-2 border rounded-lg font-mono focus:ring-2 focus:outline-none ${
                  isAutoStartKm
                    ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-100 focus:ring-amber-500'
                    : 'bg-white dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:ring-cyan-500'
                }`}
              />
              <span className={`mt-1 inline-block text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${isAutoStartKm ? 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200' : 'bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300'}`}>
                {isAutoStartKm ? 'Auto-filled from last End KM' : 'Manual override'}
              </span>
            </div>

            <div>
              <label htmlFor="end-km" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                End KM
              </label>
              <input
                id="end-km"
                aria-label="End KM"
                type="number"
                step="1"
                value={endKm}
                onChange={handleEndKmChange}
                placeholder="Enter End KM"
                className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-mono focus:ring-2 focus:ring-cyan-500 focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="trip-distance" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Trip Distance (KM)
              </label>
              <input
                id="trip-distance"
                aria-label="Trip Distance"
                type="number"
                step="1"
                value={distance}
                onChange={handleDistanceChange}
                placeholder="Enter Distance"
                className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-mono focus:ring-2 focus:ring-cyan-500 focus:outline-none"
              />
            </div>
          </div>
          <p className="text-[10px] text-zinc-500 dark:text-zinc-400 uppercase tracking-wider font-semibold">
            Formula: Distance (int) = round(End − Start) • Integer KM
          </p>
        </div>

        {/* Time Section */}
        <div className="p-4 bg-paper-ledger dark:bg-zinc-800/50 rounded-xl border border-rule-line dark:border-zinc-700 space-y-4">
          <h3 className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">Time Reciprocal — End − Duration = Start • Estimated Start Time</h3>
          {isTrafficMode && (
            <div className="flex items-center gap-3 px-2 py-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
              <span className="text-xs font-bold uppercase tracking-wider text-amber-800 dark:text-amber-200">Traffic Mode</span>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" name="trafficMode" value="traffic" checked={trafficMode === 'traffic'} onChange={() => setTrafficMode('traffic')} className="accent-amber-600" />
                <span className="text-sm font-medium">Traffic</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" name="trafficMode" value="light" checked={trafficMode === 'light'} onChange={() => setTrafficMode('light')} className="accent-emerald-600" />
                <span className="text-sm font-medium">Light Traffic</span>
              </label>
              <span className="text-[10px] text-zinc-500 ml-auto">Selects Speed Slab set for Auto estimate</span>
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label htmlFor="start-time" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Start Time <span className="text-zinc-400 font-normal text-xs">Optional</span>
              </label>
              <div className="flex gap-2">
                <input
                  id="start-time"
                  aria-label="Start Time"
                  type="time"
                  value={startTime}
                  onChange={handleStartTimeChange}
                  className="flex-1 px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-mono focus:ring-2 focus:ring-cyan-500 focus:outline-none"
                />
                <button
                  type="button"
                  aria-label="Auto"
                  onClick={handleAutoEstimate}
                  className="px-3 py-2 text-xs font-bold uppercase tracking-wider border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-600 transition-colors"
                  title="Estimate Start Time as End − (Distance/speed) configurable slabs ceiled to 5 min"
                >
                  Auto
                </button>
              </div>
              <div className="flex gap-1 mt-2">
                <button type="button" onClick={() => nudgeStartTime(-10)} disabled={!startTime} className="flex-1 py-1 text-xs font-mono border rounded-lg bg-white dark:bg-zinc-700 disabled:opacity-40" title="-10 min">−10</button>
                <button type="button" onClick={() => nudgeStartTime(-5)} disabled={!startTime} className="flex-1 py-1 text-xs font-mono border rounded-lg bg-white dark:bg-zinc-700 disabled:opacity-40" title="-5 min">−5</button>
                <button type="button" onClick={() => nudgeStartTime(5)} disabled={!startTime} className="flex-1 py-1 text-xs font-mono border rounded-lg bg-white dark:bg-zinc-700 disabled:opacity-40" title="+5 min">+5</button>
                <button type="button" onClick={() => nudgeStartTime(10)} disabled={!startTime} className="flex-1 py-1 text-xs font-mono border rounded-lg bg-white dark:bg-zinc-700 disabled:opacity-40" title="+10 min">+10</button>
              </div>
              <span className="mt-1 inline-block text-[10px] text-zinc-500 uppercase tracking-wider">Auto: End − (Distance/speed) slabs ceil 5 min • Empty allowed</span>
            </div>

            <div>
              <label htmlFor="end-time" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                End Time
              </label>
              <input
                id="end-time"
                aria-label="End Time"
                type="time"
                value={endTime}
                onChange={handleEndTimeChange}
                required
                className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-mono focus:ring-2 focus:ring-cyan-500 focus:outline-none"
              />
              <span className="mt-1 inline-block text-[10px] font-semibold text-telemetry-cyan uppercase">defaults to current time</span>
            </div>

            <div>
              <label htmlFor="duration" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Duration (HH:MM)
              </label>
              <input
                id="duration"
                aria-label="Duration"
                type="text"
                placeholder="00:55"
                value={duration}
                onChange={handleDurationChange}
                className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-mono focus:ring-2 focus:ring-cyan-500 focus:outline-none"
              />
              <span className="mt-1 inline-block text-[10px] text-zinc-500 uppercase tracking-wider">Enter Duration to compute Start</span>
            </div>
          </div>
          <p className="text-[10px] text-zinc-500 dark:text-zinc-400 uppercase tracking-wider font-semibold">
            Formula: Estimated Start = End − ceil((Distance/speed)*60 /5)*5 • speed &lt;10→15 &lt;20→20 &lt;40→25 ≤60→30 &gt;60→35 • Supports overnight wrap • Only auto-fills when Start empty
          </p>
        </div>

        {/* Places & Fuel */}
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between gap-2 mb-1">
              <label htmlFor="places-visited" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Places Visited / Route & Purpose <span className="text-red-500">*</span>
              </label>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  data-testid="quick-places-home-office"
                  onClick={() => setPlacesVisited('Home - Office')}
                  className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition ${placesVisited === 'Home - Office' ? 'bg-sky-600 border-sky-600 text-white' : 'bg-zinc-50 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 hover:bg-sky-50 dark:hover:bg-zinc-700 hover:border-sky-300'}`}
                  title="Fill Places Visited with Home - Office"
                >
                  Home - Office
                </button>
                <button
                  type="button"
                  data-testid="quick-places-office-home"
                  onClick={() => setPlacesVisited('Office - Home')}
                  className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition ${placesVisited === 'Office - Home' ? 'bg-sky-600 border-sky-600 text-white' : 'bg-zinc-50 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 hover:bg-sky-50 dark:hover:bg-zinc-700 hover:border-sky-300'}`}
                  title="Fill Places Visited with Office - Home"
                >
                  Office - Home
                </button>
              </div>
            </div>
            <input
              id="places-visited"
              aria-label="Places Visited"
              type="text"
              value={placesVisited}
              onChange={(e) => setPlacesVisited(e.target.value)}
              placeholder="e.g., HQ Fleet Yard → Regional Port Customs"
              required
              className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-cyan-500 focus:outline-none"
            />
            <p className="mt-1 text-[11px] text-zinc-500">Tap a chip to fill — you can still edit freely after.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="fuel-pumped" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Fuel Pumped (L) <span className="text-zinc-400 font-normal text-xs">Optional</span>
              </label>
              <input
                id="fuel-pumped"
                aria-label="Fuel Pumped"
                type="number"
                step="0.1"
                value={fuelPumped}
                onChange={(e) => setFuelPumped(e.target.value)}
                placeholder="e.g., 35.0"
                className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-mono focus:ring-2 focus:ring-cyan-500 focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="fuel-order-no" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Fuel Order No <span className="text-zinc-400 font-normal text-xs">Optional</span>
              </label>
              <input
                id="fuel-order-no"
                aria-label="Fuel Order No"
                type="text"
                value={fuelOrderNo}
                onChange={(e) => setFuelOrderNo(e.target.value)}
                placeholder="e.g., #FO-88912"
                className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-cyan-500 focus:outline-none"
              />
              <span className="mt-1 inline-block text-[10px] text-zinc-500 uppercase">Fuel Order Date = Trip Date</span>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t border-rule-line dark:border-zinc-800">
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-2.5 bg-slate-surface hover:bg-primary text-on-primary font-semibold rounded-lg transition-colors shadow-sm disabled:opacity-50 flex items-center gap-2"
          >
            {saving ? 'Saving...' : 'Save Trip'}
          </button>
        </div>
      </form>
    </div>
  );
}
