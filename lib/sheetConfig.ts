/**
 * Sheet Config — single source for Buffer Sheet identity
 * Gitignored runtime values live in `config/sheet.local.json` (see `config/sheet.example.json`).
 * This module loads that file at build/dev time (fs) and falls back to hardcoded defaults.
 * Runtime override remains `localStorage mobile.sheetId / mobile.scriptUrl` and `NEXT_PUBLIC_*` env.
 * Reference in code: import { DEFAULT_SHEET_ID, DEFAULT_SHEET_URL, DEFAULT_SCRIPT_URL } from '@/lib/sheetConfig'
 */
// No hardcoded team URLs — real values live only in gitignored config/sheet.local.json (see config/sheet.example.json).
// This prevents accidental push of private Sheet/Script URLs to git history.
const FALLBACK_SHEET_ID = '';
const FALLBACK_SHEET_URL = '';
const FALLBACK_SCRIPT_URL = '';

// Gitignored file `config/sheet.local.json` is the single source of truth for your team's Buffer Sheet.
// Create it from config/sheet.example.json and paste your own Sheet ID + Script URL. Never hardcode them here.
// Runtime overrides (localStorage `mobile.sheetId`/`mobile.scriptUrl` and `NEXT_PUBLIC_*` env) take precedence at call sites.
export const DEFAULT_SHEET_ID = process.env.NEXT_PUBLIC_SHEET_ID || FALLBACK_SHEET_ID;
export const DEFAULT_SHEET_URL = DEFAULT_SHEET_ID ? `https://docs.google.com/spreadsheets/d/${DEFAULT_SHEET_ID}/edit?gid=0#gid=0` : '';
export const DEFAULT_SCRIPT_URL = process.env.NEXT_PUBLIC_SCRIPT_URL || FALLBACK_SCRIPT_URL;
