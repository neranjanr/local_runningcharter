# ADR 0014: QuickTrip Mobile PWA with Buffer Sheet and Apps Script Proxy

Date: 2026-09-14
Status: Accepted
Deciders: Neranjan (Super Admin / single operator)

## Context

Operator cannot reach the deployment DB from the phone on the road, but needs the same QuickTripForm capture (Integer KM reciprocal `Start+Distance=End`, Estimated Start Time `End − Distance/20 ceil 5min`, Date/DayOfWeek, Trip Type, Places Visited, Drawn Fuel) and to see the last 10 records. The Book lives in Postgres/Railway behind Landing Gate (`docs/adr/0005`, `0010`), so a phone-native workaround was needed without exposing DB credentials.

Options for the phone app:
1. Native APK (Capacitor/Expo) — install friction, store signing, separate skillset.
2. Separate React Native app — heaviest.
3. **PWA (Add to Home Screen) in sibling folder `quicktrip-mobile/` (v1 as `app/mobile/` route sharing `lib/tripCalculations.ts`)** — zero store, HTTPS, service-worker offline, reuses existing `components/QuickTripForm.tsx:21`.

Options for Google Sheet auth:
1. OAuth client in PWA — requires Google Cloud console, token refresh in service worker.
2. Service Account via Next backend `api/mobile/sheetProxy` — couples mobile to main deployment availability.
3. **Apps Script Web App bound to Buffer Sheet** — one deploy, single URL + optional shared secret, no credentials in PWA, works when main deployment is down.

Options for import closure:
1. Direct DB push from PWA — would bypass pagination/continuity validation.
2. **Buffer Sheet with identical `ALL_TRIPS_HEADERS` (`lib/allTripsWorkbook.ts:18`) imported via existing Trip Import validation (`parseAllTripsWorkbook`)** — zero transform, manual .xlsx download v1, future direct pull v2.

## Decision

- **App** is a PWA (`quicktrip-mobile/` sibling, v1 shipped as `app/mobile/` sharing `lib/`) mirroring full `QuickTripForm` parity, with Settings screen persisting Sheet ID + Apps Script URL in `localStorage` (seeded from `NEXT_PUBLIC_SHEET_ID`/`SCRIPT_URL`).
- **Buffer Sheet** uses exact `All Trips` headers (order-enforced) so `validateHeaders` passes; re-import is `Download as .xlsx → All Trips Import` v1.
- **Sheet Proxy** is Apps Script `doPost`/`doGet` that re-applies `roundToIntegerKm`/`roundToOneDecimal`, rejects `End < Start` and missing `Places Visited`/`End Time`, and serves `last10` sorted by sheet row order (chronological).
- **Continuity**: PWA fetches last row's `End KM` for auto Start KM (amber badge); offline falls back to last queued Trip. Offline queue is IndexedDB with online retry (`navigator.onLine` + periodic flush).
- Glossary added to `CONTEXT.md` under `Mobile Capture`: `QuickTrip Mobile`, `Buffer Sheet`, `Sheet Proxy`, `Mobile Queue`.

## Alternatives Considered

- Native wrappers rejected: slower iteration, APK distribution outweighs benefit for single-operator internal tool.
- Pure OAuth rejected v1 for setup cost; can layer later alongside Script URL if needed.
- Direct Sheet API from PWA rejected for credential exposure.
- Per-Vehicle tabs deferred: single global sheet v1, `registration_no` stays in memo/Places or future tab.

## Consequences

- Positive: Captures while deployment unreachable; import reuses battle-tested `validatePaginationForImport`/`validateNoOverlap`; last-10 continuity matches web amber logic.
- Negative/Risk: Two sources of truth until import; manual download step until `Pull from Buffer Sheet` button lands; Sheet Proxy URL is effectively public unless shared secret added — acceptable for single operator but must not be committed.
- Reversal: Remove `app/mobile/` (or `quicktrip-mobile/`), glossary entries, and Script; Book remains authoritative. Buffer rows are append-only so no migration needed.

## Reversal

See Consequences. No DB schema change; reversal deletes PWA route and Buffer Sheet reference.
