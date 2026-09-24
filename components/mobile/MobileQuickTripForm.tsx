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
import { getStoredSpeedConfigSync, loadSpeedConfig } from '@/lib/speedConfig';

type BufferTrip = {
  date: string; start_km: number; end_km: number; trip_distance: number;
  start_time: string; end_time: string; trip_type: 'Official'|'Private';
  places_visited: string; fuel_pumped_amount?: number; fuel_order_no?: string;
};

const QUEUE_KEY='mobile.queue';
function getSettings(){ if(typeof window==='undefined') return {sheetId:'',scriptUrl:''}; return {sheetId: localStorage.getItem('mobile.sheetId')||process.env.NEXT_PUBLIC_SHEET_ID||'', scriptUrl: localStorage.getItem('mobile.scriptUrl')||process.env.NEXT_PUBLIC_SCRIPT_URL||''}; }

export default function MobileQuickTripForm(){
  const [date,setDate]=useState(getTodayDateString());
  const [dayOfWeek,setDayOfWeek]=useState(getDayOfWeek(getTodayDateString()));
  const [startKm,setStartKm]=useState('');
  const [endKm,setEndKm]=useState('');
  const [distance,setDistance]=useState('');
  const [startTime,setStartTime]=useState('');
  const [endTime,setEndTime]=useState(getCurrentTimeString());
  const [duration,setDuration]=useState('');
  const [tripType,setTripType]=useState<'Official'|'Private'>('Official');
  const [placesVisited,setPlacesVisited]=useState('');
  const [fuelPumped,setFuelPumped]=useState('');
  const [fuelOrderNo,setFuelOrderNo]=useState('');
  const [isAutoStart,setIsAutoStart]=useState(true);
  const [last10,setLast10]=useState<BufferTrip[]>([]);
  const [queueLen,setQueueLen]=useState(0);
  const [saving,setSaving]=useState(false);
  const [msg,setMsg]=useState<{t:'ok'|'err',m:string}|null>(null);
  const [showSettings,setShowSettings]=useState(false);
  const [sheetId,setSheetId]=useState('');
  const [scriptUrl,setScriptUrl]=useState('');
  const [trafficMode,setTrafficMode]=useState<'traffic'|'light'>('traffic');
  const [isTrafficMode,setIsTrafficMode]=useState(false);

  useEffect(()=>{
    const s=getSettings(); setSheetId(s.sheetId); setScriptUrl(s.scriptUrl);
    try{ setQueueLen(JSON.parse(localStorage.getItem(QUEUE_KEY)||'[]').length);}catch{}
    fetchLast10();
    loadSpeedConfig().then(c=> setIsTrafficMode(c.mode==='traffic'));
    const handler=()=>{ const c=getStoredSpeedConfigSync(); setIsTrafficMode(c.mode==='traffic'); };
    window.addEventListener('fleetledger:speed-config-changed', handler);
    window.addEventListener('storage', handler as EventListener);
    const id=setInterval(flushQueue, 30000);
    window.addEventListener('online', flushQueue);
    return ()=>{ clearInterval(id); window.removeEventListener('online', flushQueue); window.removeEventListener('fleetledger:speed-config-changed', handler); window.removeEventListener('storage', handler as EventListener); };
  },[]);

  async function fetchLast10(){
    const {scriptUrl:u}=getSettings();
    if(!u) return;
    try{
      const url=u+(u.includes('?')?'&':'?')+'action=last10';
      const r=await fetch(url); if(!r.ok) return;
      const j=await r.json(); const rows=(j.rows||j.trips||[]) as BufferTrip[];
      setLast10(rows.slice(-10).reverse());
      if(rows.length>0){
        const last = rows[rows.length-1];
        setStartKm(String(roundToIntegerKm(last.end_km)));
        setIsAutoStart(true);
      }
      setQueueLen(JSON.parse(localStorage.getItem(QUEUE_KEY)||'[]').length);
    }catch{}
  }

  async function flushQueue(){
    const q: (BufferTrip & {_queuedAt:string})[] = JSON.parse(localStorage.getItem(QUEUE_KEY)||'[]');
    if(q.length===0) return;
    const {scriptUrl:u}=getSettings(); if(!u) return;
    let flushed=0; const remain: typeof q=[]; let failed=false;
    for(const item of q){ if(failed){ remain.push(item); continue; }
      const {_queuedAt, ...trip}=item as any;
      try{
        const r=await fetch(u,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action:'appendTrip',trip})});
        if(!r.ok) throw new Error(''+r.status);
        const j=await r.json().catch(()=>({ok:true})); if(j.ok===false) throw new Error(j.error);
        flushed++;
      }catch{ remain.push(item); failed=true; }
    }
    localStorage.setItem(QUEUE_KEY, JSON.stringify(remain));
    if(flushed>0){ setQueueLen(remain.length); fetchLast10(); setMsg({t:'ok',m:`Synced ${flushed} queued trip(s)`}); setTimeout(()=>setMsg(null),3000); }
  }

  const parseIntKm=(s:string)=>{ const n=parseFloat(s); return isNaN(n)?NaN:Math.round(n); };
  const maybeAutoEstimate=(nextDist:string,nextEnd:string,curStart:string)=>{
    if(curStart!=='') return;
    const d=parseIntKm(nextDist); if(isNaN(d)||d<=0) return;
    if(!nextEnd||!nextEnd.includes(':')) return;
    const tm=isTrafficMode?trafficMode:undefined;
    const est=estimateStartTime(nextEnd,d,tm); if(!est) return;
    setStartTime(est); setDuration(formatDurationMinutes(calculateDurationMinutes(est,nextEnd)));
  };
  const nudgeStartTime=(delta:number)=>{
    if(!startTime||!startTime.includes(':')) return;
    const cur=parseTimeToMinutes(startTime);
    const nxt=formatMinutesToTime(cur+delta);
    setStartTime(nxt);
    if(endTime) setDuration(formatDurationMinutes(calculateDurationMinutes(nxt,endTime)));
  };

  const handleClear = () => {
    setEndKm(''); setDistance(''); setPlacesVisited(''); setFuelPumped(''); setFuelOrderNo(''); setStartTime(''); setDuration(''); setEndTime(getCurrentTimeString()); setMsg(null);
  };

  const onSubmit=async(e:React.FormEvent)=>{
    e.preventDefault(); setMsg(null);
    if(!placesVisited.trim()){ setMsg({t:'err',m:'Places visited is required'}); return; }
    const sKm=parseIntKm(startKm), eKm=parseIntKm(endKm), dist=parseIntKm(distance);
    if(isNaN(sKm)||isNaN(eKm)||isNaN(dist)){ setMsg({t:'err',m:'Provide valid odometer values'}); return; }
    if(!date||!endTime){ setMsg({t:'err',m:'Date and End Time required'}); return; }
    if(eKm < sKm){ setMsg({t:'err',m:'End KM cannot be < Start KM'}); return; }
    setSaving(true);
    const trip: BufferTrip={ date, start_km: roundToIntegerKm(sKm), end_km: roundToIntegerKm(eKm), trip_distance: roundToIntegerKm(dist), start_time: startTime||'', end_time: endTime, trip_type: tripType, places_visited: placesVisited, fuel_pumped_amount: fuelPumped?roundToOneDecimal(parseFloat(fuelPumped)):0, fuel_order_no: fuelOrderNo };
    try{
      const online=navigator.onLine;
      const {scriptUrl:u}=getSettings();
      if(!u) throw new Error('Configure Sheet Proxy URL in Settings');
      if(!online){ throw new Error('offline'); }
      const r=await fetch(u,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action:'appendTrip',trip})});
      if(!r.ok) throw new Error('Sheet append failed '+r.status);
      const j=await r.json().catch(()=>({ok:true})); if(j.ok===false) throw new Error(j.error);
      setMsg({t:'ok',m:'Saved to Buffer Sheet'});
      await fetchLast10();
    }catch(err){
      const q=JSON.parse(localStorage.getItem(QUEUE_KEY)||'[]'); q.push({...trip,_queuedAt:new Date().toISOString()}); localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
      setQueueLen(q.length);
      setMsg({t:'ok',m:(err as Error).message==='offline'?'Offline — queued locally, will sync when online':'Queued locally (sheet unreachable) — will sync'});
    }finally{ setSaving(false);
      setStartKm(String(roundToIntegerKm(parseIntKm(endKm)||trip.end_km)));
      setIsAutoStart(true); setEndKm(''); setDistance(''); setPlacesVisited(''); setFuelPumped(''); setFuelOrderNo(''); setStartTime(''); setDuration(''); setEndTime(getCurrentTimeString());
      setTimeout(()=>setMsg(null),4000);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-2.5 pt-2 pb-24 space-y-2">
      {/* TitleAndStatusCard */}
      <section className="rounded-lg shadow-sm border border-slate-800 bg-slate-900 text-white px-3 py-2.5 flex items-center justify-between gap-2" data-purpose="card-banner">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-indigo-300 font-bold shrink-0">
            <svg className="w-3.5 h-3.5 text-indigo-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M12 4v16m8-8H4" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path></svg>
          </div>
          <div>
            <h1 className="text-xs sm:text-sm font-bold tracking-tight leading-none">Quick Trip — Buffer Sheet</h1>
            <p className="text-[10px] text-slate-300 leading-tight">Same maths as web • {queueLen>0?`${queueLen} queued`:'Online'} • Works offline — no login</p>
          </div>
        </div>
        <button onClick={()=>setShowSettings(v=>!v)} className="text-[10px] font-bold tracking-wider px-2 py-1 rounded bg-slate-800 border border-slate-700 text-cyan-400 hover:bg-slate-700">Settings</button>
      </section>

      {showSettings && (
        <section className="bg-white rounded-lg p-3 border border-slate-200 shadow-sm text-sm space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">Buffer Sheet Settings</h3>
          <div>
            <label className="block text-[11px] font-bold text-slate-600 mb-1">Sheet ID or URL</label>
            <input value={sheetId} onChange={e=>setSheetId(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/... or ID" className="w-full px-2 py-1.5 border border-slate-300 rounded-md text-sm bg-white"/>
          </div>
          <div>
            <label className="block text-[11px] font-bold text-slate-600 mb-1">Apps Script Web App URL</label>
            <input value={scriptUrl} onChange={e=>setScriptUrl(e.target.value)} placeholder="https://script.google.com/macros/s/.../exec" className="w-full px-2 py-1.5 border border-slate-300 rounded-md text-sm bg-white"/>
          </div>
          <div className="flex gap-2">
            <button onClick={()=>{ let id=sheetId.trim(); const m=id.match(/\/d\/([a-zA-Z0-9-_]+)/); if(m) id=m[1]; localStorage.setItem('mobile.sheetId',id); localStorage.setItem('mobile.scriptUrl',scriptUrl.trim()); setMsg({t:'ok',m:'Settings saved'}); setShowSettings(false); fetchLast10(); }} className="px-3 py-1.5 bg-sky-600 text-white rounded-md text-xs font-bold">Save</button>
            <button onClick={flushQueue} className="px-3 py-1.5 bg-slate-100 border border-slate-300 rounded-md text-xs font-semibold">Flush queue now</button>
            <button onClick={fetchLast10} className="px-3 py-1.5 bg-white border border-slate-300 rounded-md text-xs">Refresh</button>
          </div>
          <p className="text-[11px] text-slate-500">Seed via NEXT_PUBLIC_SHEET_ID / NEXT_PUBLIC_SCRIPT_URL env as well.</p>
        </section>
      )}

      {msg && <div className={`p-2.5 rounded-lg text-xs font-medium border ${msg.t==='ok'?'bg-emerald-50 text-emerald-700 border-emerald-200':'bg-red-50 text-red-700 border-red-200'}`}>{msg.m}</div>}

      <form onSubmit={onSubmit} noValidate className="space-y-2">
        {/* Metadata */}
        <section className="bg-white rounded-lg p-2.5 border border-slate-200/90 shadow-sm" data-purpose="trip-metadata">
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 leading-none">Trip Date</label>
                <span className="text-[10px] font-bold text-sky-600 uppercase tracking-tight">{dayOfWeek}</span>
              </div>
              <input className="w-full bg-slate-50 border border-slate-300 rounded-md py-1 px-2 font-medium text-slate-800 focus:bg-white focus:ring-1 focus:ring-indigo-500 text-xs h-8" type="date" value={date} onChange={e=>{setDate(e.target.value); setDayOfWeek(getDayOfWeek(e.target.value));}} required />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 leading-none">Trip Type</label>
                <span className="text-[9px] text-slate-400">Ledger</span>
              </div>
              <div className="grid grid-cols-2 p-0.5 bg-slate-100 rounded-md border border-slate-200 gap-1 h-8 items-center" role="radiogroup">
                <div>
                  <input checked={tripType==='Official'} onChange={()=>setTripType('Official')} className="sr-only" id="m-type-official" name="m_trip_type" type="radio" value="official" />
                  <label htmlFor="m-type-official" onClick={()=>setTripType('Official')} className={`flex items-center justify-center gap-1 py-1 px-1.5 rounded text-[11px] font-semibold cursor-pointer transition-all select-none leading-none ${tripType==='Official' ? 'bg-white text-slate-900 shadow-sm font-bold' : 'text-slate-600'}`}>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Official <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold">OFF</span>
                  </label>
                </div>
                <div>
                  <input checked={tripType==='Private'} onChange={()=>setTripType('Private')} className="sr-only" id="m-type-private" name="m_trip_type" type="radio" value="private" />
                  <label htmlFor="m-type-private" onClick={()=>setTripType('Private')} className={`flex items-center justify-center gap-1 py-1 px-1.5 rounded text-[11px] font-semibold cursor-pointer transition-all select-none leading-none ${tripType==='Private' ? 'bg-white text-slate-900 shadow-sm font-bold' : 'text-slate-600'}`}>
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span> Private <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-amber-100 text-amber-800 font-bold">PRI</span>
                  </label>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Odometer */}
        <section className="bg-white rounded-lg p-2.5 border border-sky-200 shadow-sm relative overflow-hidden" data-purpose="odometer-reciprocal">
          <div className="flex items-center justify-between pb-1.5 mb-2 border-b border-sky-100">
            <div className="flex items-center gap-1.5">
              <span className="p-0.5 rounded bg-sky-100 text-sky-700"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M13 10V3L4 14h7v7l9-11h-7z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path></svg></span>
              <h2 className="text-[11px] font-bold uppercase tracking-wider text-sky-950 leading-none">Odometer Reciprocal <span className="text-slate-400 font-normal">— START + DISTANCE = END</span></h2>
            </div>
            <span className="text-[9px] font-mono font-medium px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-200">Auto Sync</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <div className="flex items-center justify-between mb-0.5"><label className="text-[11px] font-bold text-slate-700 leading-none">Start KM</label><span className="text-[9px] font-bold text-amber-700 bg-amber-50 px-1 py-0.5 rounded border border-amber-200 leading-none">LOCKED</span></div>
              <input type="number" step="1" value={startKm} onChange={e=>{setStartKm(e.target.value); setIsAutoStart(false); const s=parseIntKm(e.target.value); if(isNaN(s)) return; if(endKm&&!isNaN(parseIntKm(endKm))){ const d=calculateTripDistance(s,parseIntKm(endKm)); setDistance(String(d)); maybeAutoEstimate(String(d),endTime,startTime);} else if(distance) setEndKm(String(calculateEndKm(s,parseIntKm(distance))));}} className={`w-full border font-mono font-bold text-sm rounded-md py-1 px-2 focus:outline-none h-8 ${isAutoStart?'bg-amber-50/50 border-amber-400 ring-2 ring-amber-400':'bg-white border-slate-300'}`} required />
              <span className="inline-block text-[9px] font-bold tracking-tight text-amber-800 bg-amber-100/80 px-1 py-0.5 rounded mt-0.5 truncate w-full">{isAutoStart?'Auto-filled':'Manual override'}</span>
            </div>
            <div>
              <div className="flex items-center justify-between mb-0.5"><label className="text-[11px] font-bold text-slate-700 leading-none">End KM</label><span className="text-[9px] text-slate-400 leading-none">Auto</span></div>
              <input type="number" step="1" value={endKm} onChange={e=>{setEndKm(e.target.value); const en=parseIntKm(e.target.value), st=parseIntKm(startKm); if(!isNaN(en)&&!isNaN(st)){ const d=calculateTripDistance(st,en); setDistance(String(d)); maybeAutoEstimate(String(d),endTime,startTime);}}} placeholder="End" className="w-full bg-white border border-slate-300 text-slate-900 font-mono font-semibold text-sm rounded-md py-1 px-2 placeholder-slate-400 focus:ring-1 focus:ring-sky-500 h-8" />
              <p className="text-[9px] text-slate-400 mt-0.5 truncate">Reciprocal</p>
            </div>
            <div>
              <div className="flex items-center justify-between mb-0.5"><label className="text-[11px] font-bold text-slate-700 leading-none">Distance</label><span className="text-[9px] text-slate-400 leading-none">KM</span></div>
              <input type="number" step="1" value={distance} onChange={e=>{setDistance(e.target.value); const d=parseIntKm(e.target.value), st=parseIntKm(startKm); if(!isNaN(d)&&!isNaN(st)){ setEndKm(String(calculateEndKm(st,d))); maybeAutoEstimate(e.target.value,endTime,startTime);}}} placeholder="Distance" className="w-full bg-white border border-slate-300 text-slate-900 font-mono font-semibold text-sm rounded-md py-1 px-2 placeholder-slate-400 focus:ring-1 focus:ring-sky-500 h-8" />
              <p className="text-[9px] text-slate-400 mt-0.5 truncate">Integer</p>
            </div>
          </div>
          <div className="mt-1.5 pt-1 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-500 font-mono leading-none"><span>DISTANCE = ROUND(END - START)</span><span className="font-bold text-slate-600">INTEGER KM</span></div>
        </section>

        {/* Time */}
        <section className="bg-white rounded-lg p-2.5 border border-slate-200/90 shadow-sm" data-purpose="time-reciprocal">
          <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-slate-100">
            <div className="flex items-center gap-1.5">
              <span className="p-0.5 rounded bg-indigo-100 text-indigo-700"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path></svg></span>
              <h2 className="text-[11px] font-bold uppercase tracking-wider text-slate-800 leading-none">Time Reciprocal <span className="text-slate-400 font-normal">— END - DURATION = START</span></h2>
            </div>
            {isTrafficMode && (
              <div className="flex items-center space-x-2 bg-amber-50/70 border border-amber-200/80 rounded px-1.5 py-0.5">
                <label className="inline-flex items-center cursor-pointer text-[10px] font-bold text-slate-800"><input checked={trafficMode==='traffic'} onChange={()=>setTrafficMode('traffic')} className="text-amber-600 focus:ring-0 w-3 h-3 mr-1" type="radio" value="traffic" /> Traffic</label>
                <label className="inline-flex items-center cursor-pointer text-[10px] text-slate-600"><input checked={trafficMode==='light'} onChange={()=>setTrafficMode('light')} className="text-amber-600 focus:ring-0 w-3 h-3 mr-1" type="radio" value="light" /> Light</label>
              </div>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2 items-start">
            <div>
              <div className="flex items-center justify-between mb-0.5"><label className="text-[11px] font-bold text-slate-700 leading-none">Start Time</label><button type="button" onClick={()=>{ const d=parseIntKm(distance); if(isNaN(d)||d<=0||!endTime.includes(':')){ setMsg({t:'err',m:'Need Distance & End Time'}); return; } const tm=isTrafficMode?trafficMode:undefined; const est=estimateStartTime(endTime,d,tm); if(est){ setStartTime(est); setDuration(formatDurationMinutes(calculateDurationMinutes(est,endTime)));}}} className="px-1.5 py-0.5 bg-slate-800 hover:bg-slate-900 active:scale-95 text-white text-[9px] font-bold rounded leading-none">AUTO</button></div>
              <input type="time" value={startTime} onChange={e=>{setStartTime(e.target.value); if(e.target.value&&endTime) setDuration(formatDurationMinutes(calculateDurationMinutes(e.target.value,endTime)));}} className="w-full bg-slate-50 border border-slate-300 text-slate-800 font-mono font-semibold rounded-md py-1 px-1.5 text-xs focus:bg-white focus:ring-1 focus:ring-indigo-500 h-8" />
              <div className="grid grid-cols-4 gap-0.5 mt-1">
                <button type="button" onClick={()=>nudgeStartTime(-10)} disabled={!startTime} className="py-0.5 px-0.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[9px] font-mono font-semibold leading-none text-center disabled:opacity-40">-10</button>
                <button type="button" onClick={()=>nudgeStartTime(-5)} disabled={!startTime} className="py-0.5 px-0.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[9px] font-mono font-semibold leading-none text-center disabled:opacity-40">-5</button>
                <button type="button" onClick={()=>nudgeStartTime(5)} disabled={!startTime} className="py-0.5 px-0.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[9px] font-mono font-semibold leading-none text-center disabled:opacity-40">+5</button>
                <button type="button" onClick={()=>nudgeStartTime(10)} disabled={!startTime} className="py-0.5 px-0.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[9px] font-mono font-semibold leading-none text-center disabled:opacity-40">+10</button>
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-0.5"><label className="text-[11px] font-bold text-slate-700 leading-none">End Time</label><span className="text-[9px] font-bold text-sky-600 leading-none">NOW</span></div>
              <input type="time" value={endTime} onChange={e=>{setEndTime(e.target.value); if(startTime) setDuration(formatDurationMinutes(calculateDurationMinutes(startTime,e.target.value))); else maybeAutoEstimate(distance,e.target.value,startTime);}} className="w-full bg-white border border-slate-300 text-slate-900 font-mono font-semibold rounded-md py-1 px-2 text-xs focus:ring-1 focus:ring-indigo-500 h-8" required />
              <p className="text-[9px] text-sky-600 font-medium mt-1 truncate">Current time</p>
            </div>
            <div>
              <div className="flex items-center justify-between mb-0.5"><label className="text-[11px] font-bold text-slate-700 leading-none">Duration</label><span className="text-[9px] text-slate-400 leading-none">HH:MM</span></div>
              <input type="text" placeholder="00:55" value={duration} onChange={e=>{setDuration(e.target.value); const m=parseDurationToMinutes(e.target.value); if(endTime) setStartTime(calculateStartTimeFromEndAndDuration(endTime,m));}} className="w-full bg-slate-50 border border-slate-300 text-slate-900 font-mono font-semibold rounded-md py-1 px-2 text-xs focus:bg-white focus:ring-1 focus:ring-indigo-500 h-8" />
              <p className="text-[9px] text-slate-500 mt-1 truncate">Span calc</p>
            </div>
          </div>
          <div className="mt-1 pt-1 border-t border-slate-100 text-[9px] text-slate-400 leading-none font-mono truncate">FORMULA: START = END - CEIL((KM/SPEED)*60 /5)*5 • OVERNIGHT OK</div>
        </section>

        {/* Route */}
        <section className="bg-white rounded-lg p-2.5 border border-slate-200/90 shadow-sm" data-purpose="route-details">
          <div className="flex items-center justify-between gap-1 mb-1">
            <label className="text-[11px] font-bold uppercase tracking-wider text-slate-700 leading-none">Route &amp; Purpose <span className="text-red-500 font-bold">*</span></label>
            <span className="text-[9px] text-slate-400 italic">Tap preset to fill</span>
          </div>
          <div className="flex items-center gap-1 overflow-x-auto pb-1 pt-0.5" data-purpose="preset-chips" style={{scrollbarWidth:'none'}}>
            <button type="button" onClick={()=>setPlacesVisited('Home - Office')} data-testid="quick-places-home-office" className={`whitespace-nowrap px-2 py-0.5 rounded-full text-[10px] font-medium border active:scale-95 transition leading-tight ${placesVisited==='Home - Office' ? 'bg-sky-600 border-sky-600 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200'}`}>Home - Office</button>
            <button type="button" onClick={()=>setPlacesVisited('Office - Home')} data-testid="quick-places-office-home" className={`whitespace-nowrap px-2 py-0.5 rounded-full text-[10px] font-medium border active:scale-95 transition leading-tight ${placesVisited==='Office - Home' ? 'bg-sky-600 border-sky-600 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200'}`}>Office - Home</button>
            <button type="button" onClick={()=>setPlacesVisited('HO - Panni')} className={`whitespace-nowrap px-2 py-0.5 rounded-full text-[10px] font-medium border active:scale-95 transition leading-tight ${placesVisited==='HO - Panni' ? 'bg-sky-600 border-sky-600 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200'}`}>HO - Panni</button>
            <button type="button" onClick={()=>setPlacesVisited('Panni - HO')} className={`whitespace-nowrap px-2 py-0.5 rounded-full text-[10px] font-medium border active:scale-95 transition leading-tight ${placesVisited==='Panni - HO' ? 'bg-sky-600 border-sky-600 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200'}`}>Panni - HO</button>
            <button type="button" onClick={()=>setPlacesVisited('Port Customs')} className={`whitespace-nowrap px-2 py-0.5 rounded-full text-[10px] font-medium border active:scale-95 transition leading-tight ${placesVisited==='Port Customs' ? 'bg-sky-600 border-sky-600 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200'}`}>Port Customs</button>
          </div>
          <input value={placesVisited} onChange={e=>setPlacesVisited(e.target.value)} placeholder="HQ → Port Customs" className="w-full bg-white border border-slate-300 rounded-md py-1 px-2.5 text-xs text-slate-800 placeholder-slate-400 focus:ring-1 focus:ring-indigo-500 h-8" required />
          <p className="mt-1 text-[11px] text-slate-500">Tap a chip to fill — editable after.</p>
        </section>

        {/* Fuel */}
        <section className="bg-white rounded-lg p-2.5 border border-slate-200/90 shadow-sm" data-purpose="fuel-card">
          <div className="flex items-center justify-between mb-1.5">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1 leading-none"><svg className="w-3 h-3 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path></svg>Fuel Refill <span className="text-slate-400 font-normal">(Optional)</span></h3>
            <span className="text-[9px] text-slate-400">Order Date = Trip Date</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="relative"><input type="number" step="0.1" value={fuelPumped} onChange={e=>setFuelPumped(e.target.value)} placeholder="Pumped (L) e.g. 35.0" className="w-full bg-white border border-slate-300 rounded-md py-1 px-2 font-mono text-slate-800 text-xs focus:ring-1 focus:ring-indigo-500 h-8" /><span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400 pointer-events-none">LTR</span></div>
            </div>
            <div><input value={fuelOrderNo} onChange={e=>setFuelOrderNo(e.target.value)} placeholder="Order # e.g. #FO-88912" className="w-full bg-white border border-slate-300 rounded-md py-1 px-2 font-mono text-slate-800 text-xs focus:ring-1 focus:ring-indigo-500 h-8" /></div>
          </div>
        </section>
      </form>

      {/* Sticky bottom bar */}
      <aside className="fixed bottom-0 inset-x-0 bg-white/95 backdrop-blur-md border-t border-slate-200 px-3 py-2 z-40 shadow-lg" data-purpose="form-actions">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-2">
          <button type="button" onClick={handleClear} className="px-3 py-1.5 rounded-md border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-50 active:bg-slate-100 transition-colors h-9 leading-none">Clear / Reset</button>
          <div className="flex items-center gap-1.5 flex-1 sm:flex-initial justify-end">
            <button type="submit" onClick={onSubmit as any} disabled={saving} className="w-full sm:w-auto px-5 py-1.5 bg-slate-900 hover:bg-black active:scale-[0.98] text-white text-xs sm:text-sm font-bold rounded-md shadow-sm transition-all flex items-center justify-center gap-1.5 h-9 leading-none disabled:opacity-50">
              <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5"></path></svg>
              <span>{saving?'Saving…':'Save to Buffer Sheet'}</span>
            </button>
          </div>
        </div>
      </aside>

      <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-3">
        <div className="flex items-center justify-between mb-2"><h3 className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Last 10 in Buffer Sheet</h3><button onClick={fetchLast10} className="text-xs text-sky-600 hover:underline font-medium">Refresh</button></div>
        {last10.length===0 ? <p className="text-sm text-slate-400">No records yet — check Settings / Script URL.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-xs border-collapse"><thead><tr className="bg-slate-50 text-slate-600 text-left"><th className="px-2 py-1">Date</th><th className="px-2 py-1">KM</th><th className="px-2 py-1">Dist</th><th className="px-2 py-1">Places</th></tr></thead><tbody>{last10.map((r,i)=><tr key={i} className="border-t border-slate-100"><td className="px-2 py-1 whitespace-nowrap">{r.date}</td><td className="px-2 py-1 font-mono">{r.start_km}→{r.end_km}</td><td className="px-2 py-1 font-mono">{r.trip_distance}</td><td className="px-2 py-1 truncate max-w-[160px]">{r.places_visited} {r.trip_type==='Private'&&<span className="ml-1 bg-amber-100 text-amber-700 px-1 rounded text-[10px] font-bold">PRI</span>}</td></tr>)}</tbody></table></div>
        )}
        {queueLen>0 && <p className="mt-2 text-xs text-amber-600 font-medium">{queueLen} trip(s) queued — tap Refresh or wait for online sync.</p>}
      </div>
    </div>
  );
}
