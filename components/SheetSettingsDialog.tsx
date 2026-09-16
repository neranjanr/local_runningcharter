'use client';
import React, { useState, useEffect } from 'react';
import { getSheetSettings, saveSheetSettings, DEFAULT_SHEET_ID, DEFAULT_SHEET_URL, DEFAULT_SCRIPT_URL } from '@/lib/sheetClient';

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

export function SheetSettingsDialog({ open, onClose, onSaved }: Props) {
  const [sheetId, setSheetId] = useState('');
  const [scriptUrl, setScriptUrl] = useState('');
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    if (open) {
      const s = getSheetSettings();
      setSheetId(s.sheetId);
      setScriptUrl(s.scriptUrl);
      setTestMsg(null);
    }
  }, [open]);

  if (!open) return null;

  const handleSave = async () => {
    saveSheetSettings(sheetId, scriptUrl);
    // probe
    if (scriptUrl.trim()) {
      setTesting(true);
      setTestMsg(null);
      try {
        const url = scriptUrl.trim() + (scriptUrl.includes('?') ? '&' : '?') + 'action=allRows';
        const r = await fetch(url, { method: 'GET' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json().catch(() => ({}));
        if (j.ok === false) throw new Error(j.error || 'Sheet rejected');
        setTestMsg({ ok: true, msg: `Connected — ${ (j.rows||[]).length } rows in Buffer Sheet` });
      } catch (e: unknown) {
        const m = e instanceof Error ? e.message : String(e);
        setTestMsg({ ok: false, msg: `Save OK but probe failed: ${m} — verify Apps Script deployed as "Anyone with link"` });
      }
      setTesting(false);
    }
    onSaved?.();
  };

  const handleUseDefaults = async () => {
    setTesting(true);
    setTestMsg(null);
    try {
      const r = await fetch('/api/sheet-config');
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      const j = await r.json();
      // j: { sheetId, sheetUrl, scriptUrl, source }
      const id = (j.sheetId || '').trim();
      const url = (j.sheetUrl || '').trim();
      const su = (j.scriptUrl || '').trim();
      const nextSheetId = url || id || DEFAULT_SHEET_ID;
      const nextScriptUrl = su || DEFAULT_SCRIPT_URL;
      setSheetId(nextSheetId);
      setScriptUrl(nextScriptUrl);
      if (!id && !su) {
        setTestMsg({ ok: false, msg: 'No defaults found in config/sheet.local.json or env — paste values manually.' });
      } else {
        // Live-apply immediately so Export is unblocked without extra rebuild; also persist
        saveSheetSettings(nextSheetId, nextScriptUrl);
        // probe live
        if (nextScriptUrl) {
          try {
            const probeUrl = nextScriptUrl + (nextScriptUrl.includes('?') ? '&' : '?') + 'action=allRows';
            const pr = await fetch(probeUrl, { method: 'GET' });
            if (!pr.ok) throw new Error(`HTTP ${pr.status}`);
            const pj = await pr.json().catch(() => ({}));
            if (pj.ok === false) throw new Error(pj.error || 'Sheet rejected');
            setTestMsg({ ok: true, msg: `Defaults applied from ${j.source} — ${id ? 'Sheet ' + id.slice(0, 8) + '…' : ''} — Connected (${(pj.rows||[]).length} rows). Saved.` });
          } catch (pe: unknown) {
            const pm = pe instanceof Error ? pe.message : String(pe);
            setTestMsg({ ok: true, msg: `Defaults loaded from ${j.source} and saved — probe: ${pm}. Verify Apps Script is "Anyone with link".` });
          }
        } else {
          setTestMsg({ ok: true, msg: `Loaded defaults from ${j.source} — ${id ? 'Sheet ' + id.slice(0, 8) + '…' : 'no sheet'} — saved.` });
        }
        onSaved?.();
      }
    } catch (e: unknown) {
      const m = e instanceof Error ? e.message : String(e);
      setTestMsg({ ok: false, msg: `Failed to load defaults: ${m}` });
    }
    setTesting(false);
  };

  const isDefault = sheetId.trim() === DEFAULT_SHEET_ID && scriptUrl.trim() === DEFAULT_SCRIPT_URL;

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" data-testid="sheet-settings-dialog" onClick={onClose}>
      <div className="bg-paper-sheet rounded-xl shadow-xl p-6 max-w-lg w-full" onClick={e=>e.stopPropagation()}>
        <h3 className="text-sm font-bold text-on-surface mb-1">Buffer Sheet Settings</h3>
        <p className="text-xs text-on-surface-variant mb-3">Paste Buffer Sheet URL (or ID) and Apps Script Web App URL. Same values as QuickTrip Mobile — stored locally. Default is pre-configured.</p>
        <div className="flex gap-2 mb-3">
          <button onClick={handleUseDefaults} disabled={testing} className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold border transition-colors disabled:opacity-50 ${isDefault ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-paper-gutter text-on-surface-variant border-rule-line hover:bg-emerald-50 hover:text-emerald-700'}`} data-testid="sheet-use-defaults">
            {testing ? 'Loading defaults…' : isDefault ? '✓ Using defaults' : 'Use defaults'}
          </button>
          <span className="text-[11px] text-on-surface-variant self-center">Default Sheet: 1-TxFy…174a9E</span>
        </div>
        <div className="space-y-3">
          <label className="flex flex-col gap-1 text-xs font-semibold">Sheet ID or URL
            <input value={sheetId} onChange={e=>setSheetId(e.target.value)} placeholder={DEFAULT_SHEET_URL} className="border border-rule-line rounded px-2 py-1.5 text-sm font-mono" data-testid="sheet-id-input" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold">Apps Script Web App URL
            <input value={scriptUrl} onChange={e=>setScriptUrl(e.target.value)} placeholder={DEFAULT_SCRIPT_URL} className="border border-rule-line rounded px-2 py-1.5 text-sm font-mono" data-testid="sheet-script-input" />
          </label>
          {testMsg && <div className={`text-xs px-2 py-1 rounded border ${testMsg.ok ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`} data-testid="sheet-settings-test-msg">{testMsg.msg}</div>}
          <p className="text-[11px] text-on-surface-variant">Setup: Sheet must have header row <code>Date | Start KM | End KM | Distance | Start Time | End Time | Private / Official | Places Visited | Fuel Pumped | Fuel Order No</code>. Apps Script: Extensions → Apps Script → paste <code>quicktrip-mobile/apps-script/Code.gs</code> → Deploy → Web App → Execute as you, Anyone with link. Defaults point to the team’s shared Buffer Sheet.</p>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-4 py-2 text-sm font-semibold text-on-surface-variant hover:bg-paper-gutter rounded-lg">Cancel</button>
          <button onClick={handleSave} disabled={testing} className="px-4 py-2 text-sm font-semibold text-on-primary bg-slate-surface rounded-lg hover:bg-primary disabled:opacity-50" data-testid="sheet-settings-save">{testing ? 'Testing…' : 'Save & Test'}</button>
        </div>
      </div>
    </div>
  );
}
