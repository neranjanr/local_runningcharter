'use client';

import React, { useEffect, useState } from 'react';
import { Slab, SpeedConfig, DEFAULT_SLABS, PRESET_CUSTOM_SLABS, PRESET_TRAFFIC_SLABS, PRESET_LIGHT_SLABS, DEFAULT_CONFIG, validateConfig, loadSpeedConfig, saveSpeedConfig } from '@/lib/speedConfig';

function SlabEditor({ slabs, onChange, label }: { slabs: Slab[]; onChange: (s: Slab[]) => void; label: string }) {
  const updateUpper = (idx: number, val: string) => {
    const num = val === '' ? null : Math.round(Number(val));
    const next = slabs.map((s, i) => (i === idx ? { ...s, upper: num } : s));
    onChange(next);
  };
  const updateSpeed = (idx: number, val: string) => {
    const num = Math.round(Number(val) || 0);
    const next = slabs.map((s, i) => (i === idx ? { ...s, speed: num } : s));
    onChange(next);
  };
  const addSlab = () => {
    if (slabs.length >= 4) return;
    const lastUpper = slabs[slabs.length - 1]?.upper;
    const prevUpper = slabs.length >= 2 ? slabs[slabs.length - 2].upper : 0;
    const newUpper = prevUpper != null && lastUpper == null ? (prevUpper + 30) : 100;
    // Insert before last (which is open-ended)
    const newSlabs = [...slabs];
    const open = newSlabs.pop()!;
    newSlabs.push({ upper: newUpper, speed: 25 });
    newSlabs.push(open);
    // Ensure sorted
    newSlabs.sort((a, b) => {
      if (a.upper == null) return 1;
      if (b.upper == null) return -1;
      return a.upper - b.upper;
    });
    onChange(newSlabs);
  };
  const removeSlab = (idx: number) => {
    if (slabs.length <= 1) return;
    const next = slabs.filter((_, i) => i !== idx);
    // Ensure last is open-ended
    if (next[next.length - 1].upper != null) next[next.length - 1].upper = null;
    onChange(next);
  };
  return (
    <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg p-3 bg-zinc-50 dark:bg-zinc-800/50">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-bold uppercase tracking-widest text-zinc-600 dark:text-zinc-300">{label}</h4>
        <div className="flex gap-1">
          <button type="button" onClick={addSlab} disabled={slabs.length >= 4} className="px-2 py-1 text-xs font-semibold border rounded-lg bg-white dark:bg-zinc-700 disabled:opacity-50">+ Add</button>
        </div>
      </div>
      <div className="space-y-2">
        {slabs.map((s, idx) => {
          const lower = idx === 0 ? 0 : slabs[idx - 1].upper;
          const isLast = idx === slabs.length - 1;
          return (
            <div key={idx} className="flex items-center gap-2">
              <span className="text-xs font-mono w-24 shrink-0">
                {isLast ? `≥ ${lower}` : `${lower} – ${s.upper}`}
              </span>
              <div className="flex items-center gap-1 flex-1">
                {!isLast ? (
                  <input type="number" value={s.upper ?? ''} onChange={e => updateUpper(idx, e.target.value)} placeholder="upper" className="w-20 px-2 py-1 border rounded-lg text-sm font-mono" />
                ) : (
                  <span className="w-20 px-2 py-1 text-xs text-zinc-500">∞</span>
                )}
                <span className="text-xs">→</span>
                <input type="number" min={1} max={80} value={s.speed} onChange={e => updateSpeed(idx, e.target.value)} className="w-20 px-2 py-1 border rounded-lg text-sm font-mono" />
                <span className="text-xs">km/h</span>
              </div>
              <button type="button" onClick={() => removeSlab(idx)} disabled={slabs.length <= 1} className="px-2 py-1 text-xs border rounded-lg bg-white dark:bg-zinc-700 disabled:opacity-50">Remove</button>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-zinc-500 mt-2 uppercase tracking-wider">Ceiled to nearest 5 min • speeds 1–80 km/h • up to 4 slabs</p>
    </div>
  );
}

export default function SpeedSlabSettings() {
  const [cfg, setCfg] = useState<SpeedConfig>(DEFAULT_CONFIG);
  const [draft, setDraft] = useState<SpeedConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  const [pending, setPending] = useState<SpeedConfig | null>(null);

  useEffect(() => {
    loadSpeedConfig().then(c => {
      setCfg(c);
      setDraft(c);
      setLoading(false);
    });
  }, []);

  const handleModeChange = (mode: SpeedConfig['mode']) => {
    let next: SpeedConfig;
    if (mode === 'default') next = { mode: 'default' };
    else if (mode === 'custom') next = { mode: 'custom', slabs: PRESET_CUSTOM_SLABS };
    else next = { mode: 'traffic', traffic: PRESET_TRAFFIC_SLABS, light: PRESET_LIGHT_SLABS };
    // If draft already has slabs for that mode, preserve them? For now use preset
    // But if cfg already had that mode, reuse
    if (cfg.mode === mode) next = cfg;
    setDraft(next);
  };

  const requestSave = () => {
    const err = validateConfig(draft);
    if (err) {
      setMsg(err);
      return;
    }
    setPending(draft);
    setShowConfirm(true);
  };

  const confirmSave = async () => {
    if (!pending) return;
    setSaving(true);
    setShowConfirm(false);
    try {
      const saved = await saveSpeedConfig(pending);
      setCfg(saved);
      setDraft(saved);
      setMsg('Saved — Mobile Trip entry form has been updated in quicktrip-mobile/dist/mobile_app_public.html. Please copy this file to your mobile device to have updated time estimation logic. You have to copy this each time when you change this logic in this page.');
      // Trigger rebuild toast via API side? The PUT already rebuilt file server-side. Dispatch event for live refresh.
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('fleetledger:speed-config-changed'));
      setTimeout(() => setMsg(''), 8000);
    } catch (e) {
      setMsg(String(e));
    } finally {
      setSaving(false);
      setPending(null);
    }
  };

  if (loading) return <div className="p-6 text-sm text-zinc-500">Loading speed config…</div>;

  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 shadow-sm">
      <h3 className="text-sm font-bold tracking-tight text-zinc-900 dark:text-zinc-100">Estimated Start Time — Speed Slabs</h3>
      <p className="text-xs text-zinc-500 mb-4">Choose mode and define speed per distance. Ceiled to nearest 5 min.</p>

      <div className="flex flex-wrap gap-2 mb-4">
        {(['default', 'custom', 'traffic'] as const).map(m => (
          <label key={m} className={`px-3 py-2 rounded-lg border text-sm font-semibold cursor-pointer ${draft.mode === m ? 'bg-cyan-600 text-white border-cyan-600' : 'bg-white dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700'}`}>
            <input type="radio" name="speedMode" value={m} checked={draft.mode === m} onChange={() => handleModeChange(m)} className="mr-2 accent-cyan-600" />
            {m === 'default' ? 'Use default speed' : m === 'custom' ? 'Define Speed slabs' : 'Time based slabs (Traffic / Light)'}
          </label>
        ))}
      </div>

      {draft.mode === 'default' && (
        <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg p-3 bg-zinc-50 dark:bg-zinc-800/50 text-sm">
          <p className="text-xs font-mono">{DEFAULT_SLABS.map(s => (s.upper == null ? `> ${DEFAULT_SLABS[DEFAULT_SLABS.length - 2].upper}` : `<${s.upper} → ${s.speed} km/h`)).join(' • ')} • Ceiled 5 min</p>
          <p className="text-[11px] text-zinc-500 mt-1">Read-only default values.</p>
        </div>
      )}

      {draft.mode === 'custom' && (
        <SlabEditor slabs={(draft as Extract<SpeedConfig, {mode:'custom'}>).slabs} onChange={slabs => setDraft({ mode: 'custom', slabs })} label="Custom slabs" />
      )}

      {draft.mode === 'traffic' && (
        <div className="space-y-3">
          <SlabEditor slabs={(draft as Extract<SpeedConfig, {mode:'traffic'}>).traffic} onChange={slabs => setDraft({ ...(draft as Extract<SpeedConfig, {mode:'traffic'}>), traffic: slabs })} label="Traffic day slabs" />
          <SlabEditor slabs={(draft as Extract<SpeedConfig, {mode:'traffic'}>).light} onChange={slabs => setDraft({ ...(draft as Extract<SpeedConfig, {mode:'traffic'}>), light: slabs })} label="Light Traffic day slabs" />
          <p className="text-xs text-zinc-500">Add-Trip form will show Traffic / Light Traffic selector (default Traffic) to pick set for this entry.</p>
        </div>
      )}

      {msg && <div className={`mt-4 p-3 rounded-lg text-sm ${msg.startsWith('Saved') ? 'bg-emerald-50 border border-emerald-200 text-emerald-800' : 'bg-amber-50 border border-amber-200 text-amber-800'}`}>{msg}</div>}

      <div className="flex justify-end gap-2 mt-4">
        <button onClick={() => setDraft(cfg)} className="px-4 py-2 border rounded-lg text-sm">Reset</button>
        <button onClick={requestSave} disabled={saving || JSON.stringify(draft) === JSON.stringify(cfg)} className="px-5 py-2 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-lg text-sm font-semibold disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
      </div>

      {showConfirm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowConfirm(false)}>
          <div className="bg-white dark:bg-zinc-900 rounded-xl p-5 max-w-md w-full" onClick={e => e.stopPropagation()}>
            <h4 className="font-bold mb-2">Confirm change?</h4>
            <p className="text-sm text-zinc-600 dark:text-zinc-300 mb-4">Switch Estimated Start Time mode? This will update the app’s time-estimation logic and rebuild the Mobile entry form (quicktrip-mobile/dist/mobile_app_public.html). You’ll need to copy the updated file to your phone after.</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowConfirm(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
              <button onClick={confirmSave} className="px-4 py-2 bg-cyan-600 text-white rounded-lg text-sm font-semibold">Confirm & Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
