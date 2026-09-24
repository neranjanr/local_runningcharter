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
  const [saveMode, setSaveMode] = useState<'single' | 'another'>('single');
  const [successMessage, setSuccessMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [trafficMode, setTrafficMode] = useState<'traffic' | 'light'>('traffic');
  const [isTrafficMode, setIsTrafficMode] = useState<boolean>(false);

  useEffect(() => {
    let mounted = true;
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
    setDistance(val);
    const d = parseIntKm(val);
    const start = parseIntKm(startKm);
    if (!isNaN(d) && !isNaN(start)) {
      const end = calculateEndKm(start, d);
      setEndKm(String(end));
      maybeAutoEstimate(String(d), endTime, startTime);
    }
  };

  const handleStartTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setStartTime(val);
    if (val && endTime) {
      const dur = calculateDurationMinutes(val, endTime);
      setDuration(formatDurationMinutes(dur));
    }
  };

  const handleEndTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setEndTime(val);
    if (val && startTime) {
      const dur = calculateDurationMinutes(startTime, val);
      setDuration(formatDurationMinutes(dur));
    } else if (val && duration) {
      const durMin = parseDurationToMinutes(duration);
      const start = calculateStartTimeFromEndAndDuration(val, durMin);
      setStartTime(start);
    } else {
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

  const resetForNext = (prevEndKm: number) => {
    setStartKm(String(roundToIntegerKm(prevEndKm)));
    setIsAutoStartKm(true);
    setEndKm('');
    setDistance('');
    setPlacesVisited('');
    setFuelPumped('');
    setFuelOrderNo('');
    setStartTime('');
    setDuration('');
    setEndTime(getCurrentTimeString());
  };

  const handleClear = async () => {
    const lastEnd = await getLastEndKm();
    const rounded = roundToIntegerKm(lastEnd);
    setStartKm(String(rounded));
    setIsAutoStartKm(true);
    setEndKm('');
    setDistance('');
    setPlacesVisited('');
    setFuelPumped('');
    setFuelOrderNo('');
    setStartTime('');
    setDuration('');
    setEndTime(getCurrentTimeString());
    setErrorMessage('');
    setSuccessMessage('');
  };

  const doSave = async (mode: 'single' | 'another') => {
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
    setSaving(true);
    setSaveMode(mode);
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
      setSuccessMessage(mode === 'another' ? 'Trip saved — ready for next entry.' : 'Trip saved successfully!');
      showToast('Trip Added', 2000);
      if (mode === 'single') {
        setTimeout(() => {
          if (typeof window !== 'undefined') window.location.href = '/';
        }, 2100);
      }
      const prevEnd = eKm;
      resetForNext(prevEnd);
      if (onSuccess) onSuccess();
      setTimeout(() => setSuccessMessage(''), 4000);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to save trip');
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await doSave('single');
  };

  if (loading) {
    return <div className="p-8 text-center text-zinc-500">Loading trip form...</div>;
  }

  return (
    <div className="max-w-3xl mx-auto px-2.5 pt-2 pb-24 space-y-2">
      {/* TitleAndStatusCard — matches alltripsample.html (now New Trip) TitleAndStatusCard */}
      <section className="rounded-lg shadow-sm border border-slate-700/80 bg-slate-900 text-white px-3 py-2 flex items-center justify-between gap-2" data-purpose="card-banner">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-md bg-indigo-500/20 border border-indigo-400/40 flex items-center justify-center text-indigo-300 font-bold shrink-0">
            <svg className="w-4 h-4 text-indigo-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path d="M12 4v16m8-8H4" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5"></path>
            </svg>
          </div>
          <div>
            <h1 className="text-xs sm:text-sm font-bold tracking-tight text-white leading-none">Quick Trip Data Entry</h1>
            <p className="text-[10px] text-slate-300 mt-0.5 leading-tight font-medium">Reciprocal calculations • Ledger continuity</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5"><span className="text-[10px] font-mono font-bold tracking-wider px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-emerald-400">SEC-24</span></div>
      </section>

      {successMessage && (
        <div className="p-2.5 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg text-xs font-medium">
          {successMessage}
        </div>
      )}
      {errorMessage && (
        <div className="p-2.5 bg-red-50 border border-red-200 text-red-700 rounded-lg text-xs font-medium">
          {errorMessage}
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate className="space-y-2">
        {/* MetadataSection */}
        <section className="bg-white rounded-lg p-2.5 border border-slate-200/90 shadow-sm" data-purpose="trip-metadata">
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 leading-none" htmlFor="trip-date">
                  Trip Date
                </label>
                <span className="text-[10px] font-bold text-sky-600 uppercase tracking-tight">{dayOfWeek}</span>
              </div>
              <div className="relative">
                <input className="w-full bg-slate-50 border border-slate-300 rounded-md py-1 px-2 font-medium text-slate-800 focus:bg-white focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 text-xs transition-all h-8" id="trip-date" name="trip_date" type="date" value={date} onChange={handleDateChange} required />
              </div>
              <p className="text-[9px] text-slate-400 mt-0.5">Fiscal Q3</p>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 leading-none">
                  Trip Type
                </label>
                <span className="text-[9px] text-slate-400">Ledger</span>
              </div>
              <div className="grid grid-cols-2 p-0.5 bg-slate-100 rounded-md border border-slate-200 gap-1 h-8 items-center" role="radiogroup">
                <div>
                  <input checked={tripType==='Official'} onChange={()=>setTripType('Official')} className="sr-only" id="type-official" name="trip_type" type="radio" value="official" />
                  <label htmlFor="type-official" onClick={()=>setTripType('Official')} className={`flex items-center justify-center gap-1 py-1 px-1.5 rounded text-[11px] font-semibold cursor-pointer transition-all select-none leading-none ${tripType==='Official' ? 'bg-white text-slate-900 shadow-sm font-bold' : 'text-slate-600'}`}>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                    <span>Official</span>
                    <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold">OFF</span>
                  </label>
                </div>
                <div>
                  <input checked={tripType==='Private'} onChange={()=>setTripType('Private')} className="sr-only" id="type-private" name="trip_type" type="radio" value="private" />
                  <label htmlFor="type-private" onClick={()=>setTripType('Private')} className={`flex items-center justify-center gap-1 py-1 px-1.5 rounded text-[11px] font-semibold cursor-pointer transition-all select-none leading-none ${tripType==='Private' ? 'bg-white text-slate-900 shadow-sm font-bold' : 'text-slate-600'}`}>
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                    <span>Private</span>
                    <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-amber-100 text-amber-800 font-bold">PRI</span>
                  </label>
                </div>
              </div>
              <p className="text-[9px] text-slate-400 mt-0.5 truncate">Official requires logging</p>
            </div>
          </div>
        </section>

        {/* OdometerReciprocalCard — matches latest sample: bg-sky-50 border-l-4 brand */}
        <section className="rounded-lg p-2.5 bg-sky-50 border border-sky-100 shadow-sm relative overflow-hidden border-l-4 border-l-brand-500" data-purpose="odometer-reciprocal">
          <div className="flex items-center justify-between pb-1.5 mb-2 border-b border-sky-100">
            <div className="flex items-center gap-1.5">
              <span className="p-1 rounded bg-brand-500 text-white shadow-sm">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M13 10V3L4 14h7v7l9-11h-7z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path>
                </svg>
              </span>
              <h2 className="text-[11px] font-bold uppercase tracking-wider text-slate-900 leading-none">Odometer Reciprocal <span className="text-slate-500 font-normal">— START + DISTANCE = END</span></h2>
            </div>
            <span className="text-[9px] font-mono font-bold px-1.5 py-0.2 rounded bg-sky-100 text-brand-800 border border-brand-500/30">Auto Sync</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <div className="flex items-center justify-between mb-0.5">
                <label className="text-[11px] font-bold text-slate-700 leading-none" htmlFor="start-km">Start KM</label>
                <span className="text-[9px] font-bold text-slate-600 bg-slate-200 px-1 py-0.2 rounded border border-slate-300 leading-none">LOCKED</span>
              </div>
              <input
                className={`w-full border text-slate-900 font-mono font-bold text-sm rounded-md py-1 px-2 focus:outline-none h-8 shadow-sm ${isAutoStartKm ? 'bg-white border-slate-300' : 'bg-white border-slate-300'}`}
                id="start-km"
                aria-label="Start KM"
                name="start_km"
                type="number"
                step="1"
                value={startKm}
                onChange={handleStartKmChange}
                required
              />
              <span className="inline-block text-[9px] font-bold tracking-tight text-sky-700 bg-sky-100 px-1 py-0.2 rounded mt-0.5 truncate w-full">{isAutoStartKm ? 'Auto-filled from last End KM' : 'Manual override'}</span>
            </div>
            <div>
              <div className="flex items-center justify-between mb-0.5">
                <label className="text-[11px] font-bold text-slate-700 leading-none" htmlFor="end-km">End KM</label>
                <span className="text-[9px] text-slate-400 leading-none font-mono">Auto</span>
              </div>
              <input className="w-full bg-white border border-slate-300 text-slate-900 font-mono font-semibold text-sm rounded-md py-1 px-2 placeholder-slate-400 focus:ring-1 focus:ring-slate-800 h-8 shadow-sm" id="end-km" aria-label="End KM" inputMode="numeric" name="end_km" placeholder="End KM" type="number" value={endKm} onChange={handleEndKmChange} />
              <p className="text-[9px] text-slate-400 mt-0.5 truncate">Reciprocal</p>
            </div>
            <div>
              <div className="flex items-center justify-between mb-0.5">
                <label className="text-[11px] font-bold text-slate-700 leading-none" htmlFor="trip-distance">Distance</label>
                <span className="text-[9px] text-slate-400 leading-none">KM</span>
              </div>
              <input className="w-full bg-white border border-slate-300 text-slate-900 font-mono font-semibold text-sm rounded-md py-1 px-2 placeholder-slate-400 focus:ring-1 focus:ring-slate-800 h-8 shadow-sm" id="trip-distance" aria-label="Trip Distance" inputMode="numeric" name="distance_km" placeholder="KM" type="number" value={distance} onChange={handleDistanceChange} />
              <p className="text-[9px] text-slate-400 mt-0.5 truncate">Integer</p>
            </div>
          </div>
          <div className="mt-1.5 pt-1 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-500 font-mono leading-none">
            <span>DISTANCE = ROUND(END - START)</span>
            <span className="font-bold text-slate-600">INTEGER KM</span>
          </div>
        </section>

        {/* TimeReciprocalCard — matches latest sample: bg-slate-50 border-l-4 emerald */}
        <section className="rounded-lg p-2.5 bg-slate-50 border border-slate-200 shadow-sm border-l-4 border-l-emerald-500" data-purpose="time-reciprocal">
          <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-slate-200">
            <div className="flex items-center gap-1.5">
              <span className="p-1 rounded bg-emerald-500 text-white shadow-sm">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path>
                </svg>
              </span>
              <h2 className="text-[11px] font-bold uppercase tracking-wider text-slate-900 leading-none">Time Reciprocal <span className="text-slate-500 font-normal">— END - DURATION = START</span></h2>
            </div>
            {isTrafficMode && (
              <div className="flex items-center space-x-2 bg-white rounded border border-slate-200 px-1.5 py-0.5 shadow-sm">
                <label className="inline-flex items-center cursor-pointer text-[10px] font-bold text-slate-900"><input checked={trafficMode==='traffic'} onChange={()=>setTrafficMode('traffic')} className="text-brand-500 focus:ring-0 w-3 h-3 mr-1" name="trafficModeMain" type="radio" value="traffic" />Traffic</label>
                <label className="inline-flex items-center cursor-pointer text-[10px] text-slate-600"><input checked={trafficMode==='light'} onChange={()=>setTrafficMode('light')} className="text-brand-500 focus:ring-0 w-3 h-3 mr-1" name="trafficModeMain" type="radio" value="light" />Light</label>
              </div>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2 items-start">
            <div>
              <div className="flex items-center justify-between mb-0.5">
                <label className="text-[11px] font-bold text-slate-700 leading-none" htmlFor="start-time">
                  Start Time
                </label>
                <button type="button" aria-label="Auto" onClick={handleAutoEstimate} className="px-1.5 py-0.5 bg-slate-800 hover:bg-slate-900 active:scale-95 text-white text-[9px] font-bold rounded leading-none" title="Auto Estimate Start Time">
                  AUTO
                </button>
              </div>
              <div className="relative">
                <input className="w-full bg-slate-50 border border-slate-300 text-slate-800 font-mono font-semibold rounded-md py-1 px-1.5 text-xs focus:bg-white focus:ring-1 focus:ring-indigo-500 h-8" id="start-time" aria-label="Start Time" name="start_time" placeholder="--:--" type="time" value={startTime} onChange={handleStartTimeChange} />
              </div>
              <div className="grid grid-cols-4 gap-0.5 mt-1">
                <button type="button" onClick={()=>nudgeStartTime(-10)} className="py-0.5 px-0.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[9px] font-mono font-semibold leading-none text-center">-10</button>
                <button type="button" onClick={()=>nudgeStartTime(-5)} className="py-0.5 px-0.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[9px] font-mono font-semibold leading-none text-center">-5</button>
                <button type="button" onClick={()=>nudgeStartTime(5)} className="py-0.5 px-0.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[9px] font-mono font-semibold leading-none text-center">+5</button>
                <button type="button" onClick={()=>nudgeStartTime(10)} className="py-0.5 px-0.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[9px] font-mono font-semibold leading-none text-center">+10</button>
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-0.5">
                <label className="text-[11px] font-bold text-slate-700 leading-none" htmlFor="end-time">End Time</label>
                <span className="text-[9px] font-bold text-sky-600 leading-none">NOW</span>
              </div>
              <div className="relative">
                <input className="w-full bg-white border border-slate-300 text-slate-900 font-mono font-semibold rounded-md py-1 px-2 text-xs focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 h-8" id="end-time" aria-label="End Time" name="end_time" type="time" value={endTime} onChange={handleEndTimeChange} required />
              </div>
              <p className="text-[9px] text-sky-600 font-medium mt-1 truncate">Current time</p>
            </div>
            <div>
              <div className="flex items-center justify-between mb-0.5">
                <label className="text-[11px] font-bold text-slate-700 leading-none" htmlFor="duration">Duration</label>
                <span className="text-[9px] text-slate-400 leading-none">HH:MM</span>
              </div>
              <input className="w-full bg-slate-50 border border-slate-300 text-slate-900 font-mono font-semibold rounded-md py-1 px-2 text-xs focus:bg-white focus:ring-1 focus:ring-indigo-500 h-8" id="duration" aria-label="Duration" name="duration" placeholder="00:00" type="text" value={duration} onChange={handleDurationChange} />
              <p className="text-[9px] text-slate-500 mt-1 truncate">Span calc</p>
            </div>
          </div>
          <div className="mt-1 pt-1 border-t border-slate-100 text-[9px] text-slate-400 leading-none font-mono truncate">
            FORMULA: START = END - CEIL((KM/SPEED)*60 /5)*5 • OVERNIGHT OK
          </div>
        </section>

        {/* RouteAndPurposeSection — matches latest sample: border-l-4 indigo */}
        <section className="rounded-lg p-2.5 bg-white border border-slate-200 shadow-sm border-l-4 border-l-indigo-400/40" data-purpose="route-details">
          <div className="flex items-center justify-between gap-1 mb-1">
            <label className="text-[11px] font-bold uppercase tracking-wider text-slate-800 leading-none flex items-center gap-1.5" htmlFor="places-visited"><span className="w-1.5 h-1.5 rounded-full bg-brand-500"></span>Route &amp; Purpose <span className="text-red-500 font-bold">*</span></label>
            <span className="text-[9px] text-slate-500 font-medium">Tap preset to fill</span>
          </div>
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar pb-1 pt-0.5" data-purpose="preset-chips">
            <button type="button" onClick={()=>setPlacesVisited('Home - Office')} data-testid="quick-places-home-office" className={`whitespace-nowrap px-2.5 py-1 rounded-full text-[10px] font-semibold border shadow-sm active:scale-95 transition leading-tight ${placesVisited==='Home - Office' ? 'bg-sky-600 border-sky-600 text-white' : 'bg-slate-100 hover:bg-brand-50 text-slate-800 border-slate-300'}`}>Home - Office</button>
            <button type="button" onClick={()=>setPlacesVisited('Office - Home')} data-testid="quick-places-office-home" className={`whitespace-nowrap px-2.5 py-1 rounded-full text-[10px] font-semibold border shadow-sm active:scale-95 transition leading-tight ${placesVisited==='Office - Home' ? 'bg-sky-600 border-sky-600 text-white' : 'bg-slate-100 hover:bg-brand-50 text-slate-800 border-slate-300'}`}>Office - Home</button>
            <button type="button" onClick={()=>setPlacesVisited('HO - Panni')} className={`whitespace-nowrap px-2.5 py-1 rounded-full text-[10px] font-semibold border shadow-sm active:scale-95 transition leading-tight ${placesVisited==='HO - Panni' ? 'bg-sky-600 border-sky-600 text-white' : 'bg-slate-100 hover:bg-brand-50 text-slate-800 border-slate-300'}`}>HO - Panni</button>
            <button type="button" onClick={()=>setPlacesVisited('Panni - HO')} className={`whitespace-nowrap px-2.5 py-1 rounded-full text-[10px] font-semibold border shadow-sm active:scale-95 transition leading-tight ${placesVisited==='Panni - HO' ? 'bg-sky-600 border-sky-600 text-white' : 'bg-slate-100 hover:bg-brand-50 text-slate-800 border-slate-300'}`}>Panni - HO</button>
            <button type="button" onClick={()=>setPlacesVisited('Port Customs')} className={`whitespace-nowrap px-2.5 py-1 rounded-full text-[10px] font-semibold border shadow-sm active:scale-95 transition leading-tight ${placesVisited==='Port Customs' ? 'bg-sky-600 border-sky-600 text-white' : 'bg-slate-100 hover:bg-brand-50 text-slate-800 border-slate-300'}`}>Port Customs</button>
          </div>
          <div>
            <input className="w-full bg-slate-50 border border-slate-300 rounded-md py-1 px-2.5 text-xs text-slate-800 placeholder-slate-400 focus:bg-white focus:ring-1 focus:ring-brand-500 h-8 shadow-sm" id="places-visited" aria-label="Places Visited" name="route_purpose" placeholder="e.g., HQ Fleet Yard → Regional Port Customs" required type="text" value={placesVisited} onChange={(e)=>setPlacesVisited(e.target.value)} />
          </div>
        </section>

        {/* FuelDetailsSection — matches latest sample: bg-slate-50 */}
        <section className="bg-slate-50 rounded-lg p-2.5 border border-slate-200 shadow-sm" data-purpose="fuel-card">
          <div className="flex items-center justify-between mb-1.5">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5 leading-none"><span className="p-0.5 rounded bg-slate-200 text-slate-700 border border-slate-300"><svg className="w-3 h-3 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path></svg></span>Fuel Refill <span className="text-slate-400 font-normal">(Optional)</span></h3>
            <span className="text-[9px] text-slate-400 font-mono">Order Date = Trip Date</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="relative">
                <input className="w-full bg-white border border-slate-300 rounded-md py-1 px-2 font-mono text-slate-800 text-xs focus:bg-white focus:ring-1 focus:ring-brand-500 h-8" id="fuel-pumped" aria-label="Fuel Pumped" inputMode="decimal" name="fuel_pumped_l" placeholder="Pumped (L) e.g. 35.0" step="0.01" type="number" value={fuelPumped} onChange={(e)=>setFuelPumped(e.target.value)} />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400 pointer-events-none">LTR</span>
              </div>
            </div>
            <div>
              <input className="w-full bg-white border border-slate-300 rounded-md py-1 px-2 font-mono text-slate-800 text-xs focus:bg-white focus:ring-1 focus:ring-brand-500 h-8" id="fuel-order-no" aria-label="Fuel Order No" name="fuel_order_no" placeholder="Order # e.g. #FO-88912" type="text" value={fuelOrderNo} onChange={(e)=>setFuelOrderNo(e.target.value)} />
            </div>
          </div>
        </section>
      </form>

      {/* StickyBottomActionBar — matches addtripsample StickyBottomActionBar */}
      <aside className="fixed bottom-0 inset-x-0 bg-white/95 backdrop-blur-md border-t border-slate-200 px-3 py-2 z-40 shadow-lg" data-purpose="form-actions">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-2">
          <button type="button" onClick={handleClear} className="px-3 py-1.5 rounded-md border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-50 active:bg-slate-100 transition-colors h-9 leading-none">
            Clear / Reset
          </button>
          <div className="flex items-center gap-1.5 flex-1 sm:flex-initial justify-end">
            <button type="button" onClick={()=>doSave('another')} disabled={saving} className="hidden sm:inline-flex items-center justify-center px-3 py-1.5 rounded-md border border-indigo-500/30 text-indigo-800 text-xs font-bold hover:bg-indigo-50 transition-colors h-9 leading-none disabled:opacity-50">
              {saving && saveMode==='another' ? 'Saving...' : 'Save & Add Another'}
            </button>
            <button type="button" onClick={()=>doSave('another')} disabled={saving} className="sm:hidden inline-flex items-center justify-center px-3 py-1.5 rounded-md border border-indigo-500/30 text-indigo-800 text-[11px] font-bold hover:bg-indigo-50 transition-colors h-9 leading-none disabled:opacity-50">
              + Another
            </button>
            <button type="submit" onClick={(e)=>{ e.preventDefault(); doSave('single'); }} disabled={saving} className="w-full sm:w-auto px-5 py-1.5 bg-slate-900 hover:bg-black active:scale-[0.98] text-white text-xs sm:text-sm font-bold rounded-md shadow-sm transition-all flex items-center justify-center gap-1.5 h-9 leading-none disabled:opacity-50">
              <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5"></path>
              </svg>
              <span>{saving && saveMode==='single' ? 'Saving...' : 'Save Trip'}</span>
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
