# Local Running Charter — Ledger (SQLite + Buffer Sheet)

Single-operator Next.js ledger that mirrors the physical Running Chart book (4 days / 13 trips / month — `lib/pagination.ts:12`). DB is local SQLite (`runningcharter.db`, `lib/db.ts:1` — no cloud DB). No Railway / Supabase / Vercel deploy is needed; all previous `supabase/` + `railway.json` + `vercel.svg` attachments have been removed.

## Start here

**New user? Read only one file:** `docs/manuals/user-setup.md:1` — it walks you from a blank Google Sheet (header row + Apps Script proxy) through getting both URLs, running on Windows (dev `npm run dev` + persistent `start-service.ps1` on `:8082`), and copying the single-file PWA to the phone — then separately explains **Calculate Fuel** (`lib/estimateFuelEconomy.ts:191`) and **Rebuild Ledger** (`lib/pagination.ts:236`) so you know when to press which.

Small in-app help lives at `/help` (`app/help/page.tsx:1` — sections 14–16 cover Sheet Pull/Push & Focused Trip). The full self-serve guide is the manual above.

## Getting Started (Windows)

```bash
npm install
Copy-Item config\sheet.example.json config\sheet.local.json
# paste your Sheet ID + Script URL into config/sheet.local.json (gitignored)
npm run dev          # → http://localhost:3000
# or persistent background:
# PowerShell as Admin → .\start-service.ps1  → http://localhost:8082
```

Phone PWA: `npm run build:mobile` → `quicktrip-mobile/dist/Mobile_with_url_private.html` (gitignored private file, URL hard-coded) → copy that single file to the phone → Chrome → Add to Home Screen. Public template `quicktrip-mobile/dist/mobile_app_public.html` is the safe-to-push version that asks for the URL once via Settings.

## Private URLs — never push them

Real Sheet ID / Script URL live **only** in gitignored `config/sheet.local.json` (see `config/sheet.example.json`) or at runtime in `localStorage mobile.sheetId/mobile.scriptUrl` (Sheet Settings dialog) or `NEXT_PUBLIC_*` env. `lib/sheetConfig.ts:1` FALLBACKs are empty `''` on purpose so `git log` never contains your team’s URLs. `quicktrip-mobile/dist/Mobile_with_url_private.html` is also ignored (`.gitignore:51`). Before `git push`, `git status` should not list either.

## Scripts

- `npm run dev` — Next.js dev (`--webpack`)
- `npm run build && npm start` — production build
- `npm run build:mobile` — inject private Script URL into `Mobile_with_url_private.html`
- `npm test` — vitest

## Docs

- `docs/manuals/user-setup.md` — the self-serve manual (new)
- `quicktrip-mobile/README.md` — phone PWA contract
- `quicktrip-mobile/apps-script/Code.gs` — Sheet Proxy source (copy to Apps Script)
- `CONTEXT.md` — domain glossary (Book, Page, Trip, Fuel-IN Segment, Focused Trip…)
- `docs/adr/` — architecture decisions (0011 for fuel economy, 0013 for gaps, 0014 for PWA…)
