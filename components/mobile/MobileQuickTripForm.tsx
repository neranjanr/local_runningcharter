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
} from '@/lib/tripCalculations';

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

  useEffect(()=>{
    const s=getSettings(); setSheetId(s.sheetId); setScriptUrl(s.scriptUrl);
    // hydrate queue len
    try{ setQueueLen(JSON.parse(localStorage.getItem(QUEUE_KEY)||'[]').length);}catch{}
    fetchLast10();
    const id=setInterval(flushQueue, 30000);
    window.addEventListener('online', flushQueue);
    return ()=>{ clearInterval(id); window.removeEventListener('online', flushQueue);};
  },[]);

  async function fetchLast10(){
    const {scriptUrl:u}=getSettings();
    if(!u) return;
    try{
      const url=u+(u.includes('?')?'&':'?')+'action=last10';
      const r=await fetch(url); if(!r.ok) return;
      const j=await r.json(); const rows=(j.rows||j.trips||[]) as BufferTrip[];
      setLast10(rows.slice(-10).reverse()); // newest first for display but keep sheet order for Start KM
      if(rows.length>0){
        const last = rows[rows.length-1];
        setStartKm(String(roundToIntegerKm(last.end_km)));
        setIsAutoStart(true);
      }
      // also update queue len
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
    const est=estimateStartTime(nextEnd,d); if(!est) return;
    setStartTime(est); setDuration(formatDurationMinutes(calculateDurationMinutes(est,nextEnd)));
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
      // queue offline
      const q=JSON.parse(localStorage.getItem(QUEUE_KEY)||'[]'); q.push({...trip,_queuedAt:new Date().toISOString()}); localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
      setQueueLen(q.length);
      setMsg({t:'ok',m:(err as Error).message==='offline'?'Offline — queued locally, will sync when online':'Queued locally (sheet unreachable) — will sync'});
    }finally{ setSaving(false);
      // reset for next entry keep continuity: new start is previous end
      setStartKm(String(roundToIntegerKm(parseIntKm(endKm)||trip.end_km)));
      setIsAutoStart(true); setEndKm(''); setDistance(''); setPlacesVisited(''); setFuelPumped(''); setFuelOrderNo(''); setStartTime(''); setDuration(''); setEndTime(getCurrentTimeString());
      setTimeout(()=>setMsg(null),4000);
    }
  };

  return (
    <div className="max-w-3xl mx-auto bg-white dark:bg-zinc-900 shadow-xl rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
      <div className="bg-slate-800 text-white px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2"><span className="text-cyan-400">➕</span><div><h2 className="text-sm font-bold">Quick Trip — Buffer Sheet</h2><p className="text-[11px] text-zinc-300">Same maths as web • {queueLen>0?`${queueLen} queued`:'Online'}</p></div></div>
        <button onClick={()=>setShowSettings(v=>!v)} className="text-xs bg-zinc-700 hover:bg-zinc-600 px-2 py-1 rounded">Settings</button>
      </div>

      {showSettings && (
        <div className="mx-4 mt-4 p-3 bg-zinc-50 dark:bg-zinc-800 rounded border text-sm space-y-2">
          <label className="block text-xs font-semibold">Sheet ID or URL</label><input value={sheetId} onChange={e=>setSheetId(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/... or ID" className="w-full px-2 py-1 border rounded text-sm"/>
          <label className="block text-xs font-semibold">Apps Script Web App URL</label><input value={scriptUrl} onChange={e=>setScriptUrl(e.target.value)} placeholder="https://script.google.com/macros/s/.../exec" className="w-full px-2 py-1 border rounded text-sm"/>
          <div className="flex gap-2"><button onClick={()=>{ let id=sheetId.trim(); const m=id.match(/\/d\/([a-zA-Z0-9-_]+)/); if(m) id=m[1]; localStorage.setItem('mobile.sheetId',id); localStorage.setItem('mobile.scriptUrl',scriptUrl.trim()); setMsg({t:'ok',m:'Settings saved'}); setShowSettings(false); fetchLast10(); }} className="px-3 py-1 bg-cyan-600 text-white rounded text-xs">Save</button><button onClick={flushQueue} className="px-3 py-1 bg-zinc-200 dark:bg-zinc-700 rounded text-xs">Flush queue now</button></div>
          <p className="text-[11px] text-zinc-500">Seed via NEXT_PUBLIC_SHEET_ID / NEXT_PUBLIC_SCRIPT_URL env as well.</p>
        </div>
      )}

      {msg && <div className={`mx-4 mt-4 p-2 rounded text-sm ${msg.t==='ok'?'bg-emerald-50 text-emerald-700 border border-emerald-200':'bg-red-50 text-red-700 border border-red-200'}`}>{msg.m}</div>}

      <form onSubmit={onSubmit} className="p-4 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-xs font-medium">Date</label><input type="date" value={date} onChange={e=>{setDate(e.target.value); setDayOfWeek(getDayOfWeek(e.target.value));}} className="w-full px-2 py-1.5 border rounded text-sm" required/><p className="text-[10px] text-cyan-600 font-bold uppercase">{dayOfWeek}</p></div>
          <div><label className="text-xs font-medium">Trip Type</label><div className="flex gap-3 mt-1"><label className="flex items-center gap-1 text-sm"><input type="radio" checked={tripType==='Official'} onChange={()=>setTripType('Official')}/>Official</label><label className="flex items-center gap-1 text-sm"><input type="radio" checked={tripType==='Private'} onChange={()=>setTripType('Private')}/>Private</label></div></div>
        </div>

        <div className="p-3 bg-zinc-50 dark:bg-zinc-800 rounded border space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Odometer — Start + Distance = End (Integer KM)</p>
          <div className="grid grid-cols-3 gap-2">
            <div><label className="text-xs">Start KM</label><input type="number" step="1" value={startKm} onChange={e=>{setStartKm(e.target.value); setIsAutoStart(false); const s=parseIntKm(e.target.value); if(isNaN(s)) return; if(endKm&&!isNaN(parseIntKm(endKm))){ const d=calculateTripDistance(s,parseIntKm(endKm)); setDistance(String(d)); maybeAutoEstimate(String(d),endTime,startTime);} else if(distance) setEndKm(String(calculateEndKm(s,parseIntKm(distance))));}} className={`w-full px-2 py-1.5 border rounded font-mono text-sm ${isAutoStart?'bg-amber-50 border-amber-300':''}`} required/><span className="text-[9px] uppercase font-bold">{isAutoStart?'Auto from last End':'Manual'}</span></div>
            <div><label className="text-xs">End KM</label><input type="number" step="1" value={endKm} onChange={e=>{setEndKm(e.target.value); const en=parseIntKm(e.target.value), st=parseIntKm(startKm); if(!isNaN(en)&&!isNaN(st)){ const d=calculateTripDistance(st,en); setDistance(String(d)); maybeAutoEstimate(String(d),endTime,startTime);}}} placeholder="End" className="w-full px-2 py-1.5 border rounded font-mono text-sm"/></div>
            <div><label className="text-xs">Distance</label><input type="number" step="1" value={distance} onChange={e=>{setDistance(e.target.value); const d=parseIntKm(e.target.value), st=parseIntKm(startKm); if(!isNaN(d)&&!isNaN(st)){ setEndKm(String(calculateEndKm(st,d))); maybeAutoEstimate(e.target.value,endTime,startTime);}}} placeholder="Distance" className="w-full px-2 py-1.5 border rounded font-mono text-sm"/></div>
          </div>
        </div>

        <div className="p-3 bg-zinc-50 dark:bg-zinc-800 rounded border space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Time — End − Duration = Start • Estimated Start</p>
          <div className="grid grid-cols-3 gap-2">
            <div><label className="text-xs">Start <span className="text-zinc-400">Opt</span></label><div className="flex gap-1"><input type="time" value={startTime} onChange={e=>{setStartTime(e.target.value); if(e.target.value&&endTime) setDuration(formatDurationMinutes(calculateDurationMinutes(e.target.value,endTime)));}} className="flex-1 px-2 py-1.5 border rounded font-mono text-sm"/><button type="button" onClick={()=>{ const d=parseIntKm(distance); if(isNaN(d)||d<=0||!endTime.includes(':')){ setMsg({t:'err',m:'Need Distance & End Time'}); return; } const est=estimateStartTime(endTime,d); if(est){ setStartTime(est); setDuration(formatDurationMinutes(calculateDurationMinutes(est,endTime)));}}} className="px-2 py-1 text-[10px] font-bold border rounded bg-white">Auto</button></div></div>
            <div><label className="text-xs">End</label><input type="time" value={endTime} onChange={e=>{setEndTime(e.target.value); if(startTime) setDuration(formatDurationMinutes(calculateDurationMinutes(startTime,e.target.value))); else maybeAutoEstimate(distance,e.target.value,startTime);}} className="w-full px-2 py-1.5 border rounded font-mono text-sm" required/></div>
            <div><label className="text-xs">Duration</label><input type="text" placeholder="00:55" value={duration} onChange={e=>{setDuration(e.target.value); const m=parseDurationToMinutes(e.target.value); if(endTime) setStartTime(calculateStartTimeFromEndAndDuration(endTime,m));}} className="w-full px-2 py-1.5 border rounded font-mono text-sm"/></div>
          </div>
        </div>

        <div><label className="text-xs font-medium">Places Visited *</label><input value={placesVisited} onChange={e=>setPlacesVisited(e.target.value)} placeholder="HQ → Port Customs" className="w-full px-2 py-1.5 border rounded text-sm" required/></div>
        <div className="grid grid-cols-2 gap-2"><div><label className="text-xs">Fuel Pumped (L)</label><input type="number" step="0.1" value={fuelPumped} onChange={e=>setFuelPumped(e.target.value)} placeholder="35.0" className="w-full px-2 py-1.5 border rounded font-mono text-sm"/></div><div><label className="text-xs">Fuel Order No</label><input value={fuelOrderNo} onChange={e=>setFuelOrderNo(e.target.value)} placeholder="#FO-88912" className="w-full px-2 py-1.5 border rounded text-sm"/></div></div>

        <button type="submit" disabled={saving} className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded font-semibold disabled:opacity-50">{saving?'Saving…':'Save to Buffer Sheet'}</button>
      </form>

      <div className="border-t p-4">
        <div className="flex items-center justify-between mb-2"><h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500">Last 10 in Buffer Sheet</h3><button onClick={fetchLast10} className="text-xs text-cyan-600 hover:underline">Refresh</button></div>
        {last10.length===0 ? <p className="text-sm text-zinc-400">No records yet — check Settings / Script URL.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-xs border-collapse"><thead><tr className="bg-zinc-100 dark:bg-zinc-800 text-left"><th className="px-1 py-1">Date</th><th className="px-1 py-1">KM</th><th className="px-1 py-1">Dist</th><th className="px-1 py-1">Places</th></tr></thead><tbody>{last10.map((r,i)=><tr key={i} className="border-t"><td className="px-1 py-1 whitespace-nowrap">{r.date}</td><td className="px-1 py-1 font-mono">{r.start_km}→{r.end_km}</td><td className="px-1 py-1 font-mono">{r.trip_distance}</td><td className="px-1 py-1 truncate max-w-[160px]">{r.places_visited} {r.trip_type==='Private'&&<span className="ml-1 bg-amber-100 text-amber-700 px-1 rounded text-[10px]">PRI</span>}</td></tr>)}</tbody></table></div>
        )}
        {queueLen>0 && <p className="mt-2 text-xs text-amber-600">{queueLen} trip(s) queued — tap Refresh or wait for online sync.</p>}
      </div>
    </div>
  );
}
