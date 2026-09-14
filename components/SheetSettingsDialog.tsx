'use client';
import React, { useState, useEffect } from 'react';
import { getSheetSettings, saveSheetSettings } from '@/lib/sheetClient';

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

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" data-testid="sheet-settings-dialog" onClick={onClose}>
      <div className="bg-paper-sheet rounded-xl shadow-xl p-6 max-w-lg w-full" onClick={e=>e.stopPropagation()}>
        <h3 className="text-sm font-bold text-on-surface mb-1">Buffer Sheet Settings</h3>
        <p className="text-xs text-on-surface-variant mb-3">Paste Buffer Sheet URL (or ID) and Apps Script Web App URL. Same values as QuickTrip Mobile — stored locally.</p>
        <div className="space-y-3">
          <label className="flex flex-col gap-1 text-xs font-semibold">Sheet ID or URL
            <input value={sheetId} onChange={e=>setSheetId(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/... or ID" className="border border-rule-line rounded px-2 py-1.5 text-sm font-mono" data-testid="sheet-id-input" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold">Apps Script Web App URL
            <input value={scriptUrl} onChange={e=>setScriptUrl(e.target.value)} placeholder="https://script.google.com/macros/s/.../exec" className="border border-rule-line rounded px-2 py-1.5 text-sm font-mono" data-testid="sheet-script-input" />
          </label>
          {testMsg && <div className={`text-xs px-2 py-1 rounded border ${testMsg.ok ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`} data-testid="sheet-settings-test-msg">{testMsg.msg}</div>}
          <p className="text-[11px] text-on-surface-variant">Setup: Sheet must have header row <code>Date | Start KM | End KM | Distance | Start Time | End Time | Private / Official | Places Visited | Fuel Pumped | Fuel Order No</code>. Apps Script: Extensions → Apps Script → paste <code>quicktrip-mobile/apps-script/Code.gs</code> → Deploy → Web App → Execute as you, Anyone with link.</p>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-4 py-2 text-sm font-semibold text-on-surface-variant hover:bg-paper-gutter rounded-lg">Cancel</button>
          <button onClick={handleSave} disabled={testing} className="px-4 py-2 text-sm font-semibold text-on-primary bg-slate-surface rounded-lg hover:bg-primary disabled:opacity-50" data-testid="sheet-settings-save">{testing ? 'Testing…' : 'Save & Test'}</button>
        </div>
      </div>
    </div>
  );
}
