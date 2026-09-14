# Running Chart

Digital counterpart to the physical vehicle running chart logbook. The system mirrors the book's pagination, continuity, and fuel arithmetic so a digital ledger prints and audits identically to the paper original.

## Language

### Core Ledger

**Book**: The complete sequence of Pages for one Vehicle, ordered chronologically by date.
_Avoid_: Ledger, logbook

**Page**: A single physical sheet holding at most 4 distinct dates and 13 Trips per date; a new calendar month always forces a new Page.
_Avoid_: Sheet, paper

**Trip**: One movement record from Start KM to End KM on a given Date, with Start/End Time, Places Visited, Trip Type, and optional fuel Drawn.
_Avoid_: Entry, log, row

**Vehicle**: The tracked asset defined by Brand, Model, Type, Fuel Type, Tank Capacity, and Registration No.
_Avoid_: Car, fleet unit

**Book Opening**: The initial odometer reading (Opening KM) and fuel in tank (Opening Fuel) that seeds Page 1; re-editable when retroactive older Pages are inserted.
_Avoid_: Starting balance, initial state

**Day Group**: All Trips sharing the same Date on a Page, numbered 1..4.
_Avoid_: Daily batch

### Fuel & Distance

**Fuel Economy**: Kilometres per litre for a Day Group, propagated forward until explicitly overridden; fallback 10.5 km/L.
_Avoid_: Mileage, efficiency

**Adjusted Fuel Economy**: A Day Group where Fuel Economy has an explicit override (stored per Page+Day, stepped ±0.1 from existing value, rounded to 1 decimal, clamped 0.1–50); rendered with an "Adjusted" badge; reverting to the inherited value deletes the override so the badge disappears and the Day inherits again.
_Avoid_: Custom economy, edited economy

**Fuel Position**: Fuel balance carried from the previous Day Group's Closing Balance; Page N+1 Day 1 inherits Page N's final Closing Balance.
_Avoid_: Opening fuel, previous balance

**In-Tank Fuel**: Fuel physically in the tank at the start of a Day Group before any Drawn fuel, default 0 unless typed.
_Avoid_: On-hand fuel, carried fuel

**Drawn Fuel**: Fuel pumped on the day, recorded per Trip as Fuel Pumped Amount with Fuel Order No.
_Avoid_: Filled fuel, pumped quantity

**Consumed Fuel**: Fuel used on the day, calculated as Distance / Fuel Economy, rounded to 1 decimal.
_Avoid_: Usage, burn

**Closing Balance**: Fuel remaining at end of a Day Group, calculated as Position + In-Tank + Drawn − Consumed, rounded to 1 decimal.
_Avoid_: Ending balance, remainder

**Integer KM**: Odometer values (Start KM, End KM, Trip Distance) stored and displayed as whole kilometres with no decimals (decimal input is rounded on blur/save, `numFmt '0'` in Excel); fuel values retain 1 decimal for consumption/balance maths.
_Avoid_: Decimal odometer, 1-dec km

**Page-Wide Trip Sequence**: Derived continuous numbering 1..N per Page across Day Groups for Ledger display (not stored, recomputed from chronological sort), replacing per-day trip_index; All Trips global sequence is separate 1..T chronologically across the Book.
_Avoid_: Day-local index, stored seq

**KM Gap**: Odometer discontinuity where a Page's End KM ≠ next Page's Start KM, or a Trip's End KM ≠ next Trip's Start KM (chronological sort); rendered in RED near the next Page/Trip's Start KM and as inline RED cell highlight.
_Avoid_: Mileage gap, odometer mismatch

**Fuel Gap**: Fuel discontinuity where a Page's End Fuel Balance ≠ next Page's Start Fuel Balance (or trip-implied fuel stock gap per Day Group); rendered in AMBER/ORANGE distinct from KM Gap, near next Page's Start Fuel and as inline AMBER cell highlight.
_Avoid_: Fuel mismatch, tank gap

### Auth & Access

**Super Admin**: The single Operator account (Neranjan) authenticated by password plus TOTP, must change bootstrap password and enroll TOTP on first login; the system is single-operator with no other users.
_Avoid_: Admin, owner

**TOTP**: Time-based one-time password (RFC 6238, 30s step, ±1 window) via Google Authenticator; secret encrypted at rest (AES-256-GCM) and required on every login after enrollment.
_Avoid_: OTP, 2FA code

**Recovery Code**: Single-use 64-character (256-bit) fallback generated once at enrollment, displayed once for offline saving, stored hashed with bcrypt; entered at /recovery it bypasses password and TOTP and creates a short recovery session that forces immediate password reset, TOTP re-enrollment, and new code generation.
_Avoid_: Backup password, long password

**Session**: Authenticated state via httpOnly Secure cookie (session_token) bound to sessions table with absolute 30-day expiry and 7-day idle timeout (sliding on activity), revoked on password, TOTP, or recovery reset.
_Avoid_: JWT, localStorage session

**Landing**: The public unauthenticated entry page showing Super Admin login (password + TOTP) and Recovery entry; no ledger data.
_Avoid_: Homepage, login screen

**Landing Gate**: Strict auth guard where every route except Landing and /recovery hard-redirects to Landing when unauthenticated, before any ledger or vehicle data fetch; no flash of data, session expiry also redirects with toast.
_Avoid_: Soft gate, lazy redirect

### UX & Operations

**Help Page**: Authenticated reference at `/help` explaining trip entry reciprocals, pagination rules, fuel formulas, import template, and auth roles.
_Avoid_: Guide, docs

**Trip Import**: Bulk creation of Trips from an Excel file validated pre-flight against essential fields and pagination rules before any write.
_Avoid_: Data import, upload

**Estimated Start Time**: Suggested Start Time derived as End Time − (Distance / 20 km/h), ceiled to the nearest 5 minutes; auto-filled only when Start Time is empty and editable.
_Avoid_: Calculated start, inferred start

**Global Search**: (Removed) Header search that previously live-filtered all Trips. Search is now available only within the All Trips Master Table section.
_Avoid_: Finder, lookup

**Continuity Break**: A ledger gap where Page N End KM ≠ Page N+1 Start KM or End Fuel Balance ≠ next Start Fuel Balance, surfaced as an alert banner with optional recalculation.
_Avoid_: Mismatch, discontinuity error

**Continuity Alert**: Persistent, non-dismissible banner/drawer listing every KM Gap (RED) and Fuel Gap (AMBER) at Page-to-Page and Trip-to-Trip levels; survives refresh, shows expected vs actual and jump-to-page/trip links, clears only when gaps are fixed or missing records are added to close them (no auto-recalc). Dashboard shows a compact alert bar ("Continuity Gaps Detected") with a "View All Trips" link; All Trips and Ledger pages show the full detailed alert.
_Avoid_: Toast alert, dismissible warning

**All Trips Workbook**: Excel file named per All Trips table with Sheet "All Trips" and header row `Date | Start KM | End KM | Distance | Start Time | End Time | Private / Official | Places Visited | Fuel Pumped | Fuel Order No` (`Type` alias accepted case-insensitive, order-enforced); export writes that sheet, import validates pre-flight and appends chronologically without overwriting.
_Avoid_: Book-Mirror sheet, generic export

**Transposed Side 2**: Side 2 Fuel Economy & Position tables rendered with days as columns to mirror the physical book's landscape layout, matching Side 1 column orientation.
_Avoid_: Rotated tables, flipped view

**Ledger Full-Width Stack**: Ledger Page View layout where Table 1 (Trips Log) occupies full width on top, with Table 2 (Fuel Economy & Consumption) and Table 3 (Fuel Position & Balance) stacked full-width beneath it, replacing the dual-column Side 1 / Side 2 folio; print and responsive rules preserve this stack.
_Avoid_: Side-by-side folio, two-column ledger

**Fuel-In Segment**: Contiguous Day Groups from a fuel-in date (Drawn>0 aggregated per date) inclusive to the day before the next fuel-in date; the final segment ends at the Book's last Day Group. One Fuel Economy value applies uniformly across the segment.
_Avoid_: Fill interval, refuel block

**Estimated Fuel Economy**: Calibrated km/L for a Fuel-In Segment suggested by the estimator, chosen as the 1-decimal value within the feasible interval that keeps every intermediate Closing Balance in [1, tankCapacity] closest to the previous segment's economy (or practical seed 7.8 km/L for the first segment). If no feasible value exists, the nearest infeasible boundary is suggested with a warning.
_Avoid_: Calculated economy, guessed economy

**Fuel-IN Summary**: Dashboard table listing fuel-in dates with aggregated Fuel IN (L) and Fuel Order No, sorted newest-first; 12 rows shown with MORE opening a full-list popup.
_Avoid_: Refuel log, fuel history

**Trip Type**: Enumerated category of a Trip, restricted to Official or Private; validated as a select list in All Trips, New Trip, and import.
_Avoid_: Category, purpose type

**Private Trip (Bold Row)**: A Trip with `Trip Type = Private`; rendered as a fully bold row weight in both Ledger (`Side1TripsLog`) and All Trips Master Table (preserving `bg-orange-200` background, RED gap cell `bg-red-100` wins on Start KM). Print retains bold.
_Avoid_: Partial bold, badge-only

**Gap Fill Trip**: A Trip inserted solely to close a detected **KM Gap** (`Trip N End KM ≠ Trip N+1 Start KM`); the dialog auto-fills `Start KM = predecessor End KM`, `End KM = successor Start KM`, `Distance = End − Start`, `Date = predecessor Date` (editable within `[predecessor Date, successor Date]`), `Trip Type = Official` default; no downstream shift — it consumes the gap extent exactly and is surfaced only in All Trips via an inline `+ Fill Gap` chip and row ⋯ menu when a KM Gap exists.
_Avoid_: Gap patch, gap insert

**Inserted Trip (Shift)**: A Trip inserted after any existing Trip at a chosen chronological position in All Trips; downstream Trips (all later in `date || start_km` order, across Page boundaries) have their `Start KM` and `End KM` increased uniformly by `Δ = new.end − new.start` (their `trip_distance` and other fields frozen), with `BookPage` start/end KM and fuel chain recomputed forward via `recalculatePageBalancesFromOpening`; pagination auto-splits (`13 trips/day`, `4 days/page`, month rollover) creating a new Page when needed. Confirmation previews `N` shifted trips and `Δ` before save.
_Avoid_: Add record in between, middle insert

**Removed Trip (Shift)**: Deletion of a Trip (the “Remove & Shift” action, distinct from plain **Delete** which leaves a gap) that shifts all downstream Trips down by `Δ = removed.end − removed.start` (`Start KM −= Δ`, `End KM −= Δ`), recomputes fuel chain forward, and patches Page continuity; confirmation previews `N` and `−Δ`; empty Pages are retained v1 (not collapsed).
_Avoid_: Delete, shift-delete

**Focused Trip**: The ephemeral highlight-and-scroll target after a mutating operation in All Trips; `Inserted Trip`/`Gap Fill Trip` focuses the new row, `Removed Trip`/`Delete` focuses the predecessor (or successor if earliest) after clearing any search/month filter so the row is visible; rendered as `ring-2 ring-telemetry-cyan` + `bg-cyan-50` flash for ~3s and scrolled to center.
_Avoid_: Selected row, active row

**Sheet Pull Import**: Direct pull from the Buffer Sheet via `GET scriptUrl?action=allRows` using the same Sheet Proxy as QuickTrip Mobile, compared by Odo Key (`date|start_km|end_km` integer) into New / Changed (same odo, diff fields) / Skipped (exact duplicate) buckets, previewed with consent, validated by the same `validateNoOverlap`/`validatePaginationForImport` pipeline and persisted via `importTripsFromWorkbook` + bulk `/api/import` (localStorage fallback), focusing the earliest newly added Trip (`date||start_km` order) and flashing all imported rows `bg-cyan-50`; triggered manually by "Import from Google Sheet" (formerly "Pull from Google Sheet") next to Import from Excel.
_Avoid_: Sheet sync, auto-pull

**Sheet Settings**: Persisted Buffer Sheet identity (`mobile.sheetId` extracted from full Sheet URL + `mobile.scriptUrl` Apps Script URL) shared between `QuickTrip Mobile` and All Trips header, editable via a shared dialog that probes `?action=allRows`; last successful pull time stored as `mobile.lastSheetPullAt` and push time as `mobile.lastSheetPushAt`.
_Avoid_: Sheet config, path

**Import Preview**: Modal shown before a Sheet Pull commit, listing New Trips (checked by default) and Changed rows (unchecked, with `old→new` diff such as `places: "A"→"B"`), supporting select/deselect all, blocking Confirm until at least one row is checked and until overlap/pagination pre-flight passes.
_Avoid_: Import dialog, confirm screen

**Sheet Push (Export to Google Sheet)**: Inverse of Sheet Pull Import; manual push that atomically rewrites the Buffer Sheet with all DB Trips sorted `date ASC → start_km ASC` plus header, preserving valid buffer rows whose Odo Key not in DB (appended at bottom in original buffer order, DB wins on same Odo Key); invalid buffer rows ignored; via `POST rewriteSheet` with `LockService`; stores `mobile.lastSheetPushAt`; triggered manually by "Export to Google Sheet" next to Import from Google Sheet.
_Avoid_: Sheet sync, auto-push

**Push Preview**: Modal shown before a Sheet Push commit, showing counts `DB rows N | Preserved M (unimported) | Overwriting K | Invalid ignored X` with expandable preserved-row list, blocking Confirm until settings configured.
_Avoid_: Export dialog, confirm screen

### Mobile Capture

**QuickTrip Mobile**: Installable PWA for Android that mirrors QuickTripForm entry (Date, Integer KM reciprocals, Estimated Start Time, Trip Type, Places Visited, Drawn Fuel) but writes to a Buffer Sheet, not the deployment DB; lives in `quicktrip-mobile/` sibling folder (or `app/mobile/` route) and is usable while deployment is unreachable.
_Avoid_: Mobile app, trip app

**Buffer Sheet**: A dedicated Google Sheet (QuickTrip Buffer) with the identical All Trips Workbook header row (`Date | Start KM | End KM | Distance | Start Time | End Time | Private / Official | Places Visited | Fuel Pumped | Fuel Order No`) used as offline staging; rows are later imported into the Book via Trip Import (manual .xlsx download or future direct pull).
_Avoid_: Staging sheet, temp sheet

**Sheet Proxy**: Google Apps Script Web App bound to the Buffer Sheet exposing `POST appendTrip` / `POST rewriteSheet` and `GET last10` / `GET allRows` over HTTPS so the PWA writes/reads without embedding Google credentials; the script re-applies Integer KM and 1-dec fuel rounding, rejects invalid `End < Start`, and uses `LockService` for atomic rewrite.
_Avoid_: Sheet API, backend proxy

**Mobile Queue**: IndexedDB-backed offline buffer in QuickTrip Mobile that stores Trips when offline and retries Sheet Proxy sync when online, preserving sheet truth for Start KM auto-fill.
_Avoid_: Offline cache, sync queue
