# ADR 0025: Configurable Speed Slabs, Transient Traffic Mode, and Typical Economy Range

Date: 2026-09-22
Status: Accepted

## Context

Hard-coded `getSpeedForDistance` tiered `<10→15 <20→20 <40→25 ≤60→30 >60→35` (`lib/tripCalculations.ts:31`, duplicated in `quicktrip-mobile/dist/mobile_app_public.html:142`) and emerald-relative graph shading (`FuelEconomyGraph.tsx:30`) prevented user tuning for route traffic and vehicle-specific economy bands. Grill 2026-09-22 specified configurable slabs, traffic-aware dual sets, start-time nudges, confirmation-gated mobile rebuild, and per-vehicle `[low,high]` range coloring.

## Decision

**Speed Slabs**: Three modes — `default` (locked display of current table + 5-min ceiling), `custom` (single set, up to 4 half-open intervals `0→upper1, upper1→upper2 … ≥last`, speeds 1–80 km/h int), `traffic` (two independent `custom` sets: `Traffic` default and `Light Traffic`, transient per-entry selector `traffic|light` not persisted to `Trip`/DB/Excel, UI only in Add-Trip forms when mode is traffic). Ceiling fixed 5 min for all; intervals validated contiguous, covering `0→∞`. Hybrid storage: `app_config` single-row JSONB `{mode, slabs}` + `localStorage app.speedConfig` cache; bulk import empty `start_time` falls back to `Traffic` set when traffic mode active.

**Start-time nudges**: `+5/+10/-5/-10` beside Start Time (desktop + mobile), enabled only when `startTime` present, apply `formatMinutesToTime` wrap + `calculateDurationMinutes` refresh.

**Mobile sync**: Mode or slab save triggers confirmation dialog ("Switch ... rebuild Mobile entry form ... copy ..."), then `scripts/build-mobile.js` injects slab tables + traffic selector + nudge logic into `mobile_app_public.html` (and private `Mobile_with_url_private.html` if `config/sheet.local.json` present), toast with filename.

**Economy band**: Per-Vehicle `typical_economy_low/high` (0.1–50, 1-dec, `low<high`, default 7.0–9.0, validated `roundToOneDecimal`) drives `FuelEconomyGraph` absolute coloring over emerald bars: green `low≤econ≤high`, amber within `margin=((low+high)/2)*0.20` outside, red beyond; legend added.

## Consequences

Contiguous slab validation and transient Traffic Mode avoid DB migration for traffic; only `app_config` + two vehicle columns migrate. Mobile template becomes generated artifact requiring copy to phone after each Settings change. Alternative of persisting Traffic per Trip rejected for audit-free estimation helper semantics. Fixed 5-min ceiling deferrable.

