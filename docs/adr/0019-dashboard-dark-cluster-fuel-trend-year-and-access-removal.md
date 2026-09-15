# ADR 0019: Dashboard Dark Cluster, Fuel Trend Year Footer & Palette Alignment, and Hard Removal of Access List

Date: 2026-09-15
Status: Accepted
Deciders: Neranjan

## Context

Dashboard used light `bg-paper-sheet`/`bg-amber-50` `MetricCards` (Monthly Distances + Vehicle Cluster) with vehicle strip `app/page.tsx:112-123` (`Brand Model | Type•Fuel | Odo•Tank`, no Reg No) below the 70:30 Fuel IN/Trend split. `FuelEconomyGraph.tsx:152` used `bg-telemetry-cyan` bars and per-stem `DD Mon` labels (`formatDayLabel`) with no year, mismatching Monthly/PageWise `trip-official (#059669)`/`trip-private (#D97706)` palette. Sample reference `dashsample.html` defines a 12-col dark automotive layout (`lg:col-span-4` Monthly card + `lg:col-span-8` `bg-cluster-bezel` cluster with visor `Brand Model` + `Reg badge` + ODO barrel + semicircular fuel gauge). `Access — Allow-list` (`AppShell.tsx:19`, `app/settings/access/page.tsx`) was already deprecated to placeholder (ADR 0010) but still routed.

Options:
- Keep light `MetricCards` vs full swap to dark `dashsample` bezel vocabulary (requires porting `cluster.bezel/panel/border/cyan` tokens to `globals.css`)
- Fuel trend palette: keep `telemetry-cyan` vs align to `trip-official` green vs threshold gradient
- Year: per-stem `DD Mon YYYY` vs single range footer vs year divider
- Vehicle identity: keep separate strip vs move into cluster visor with `Brand, Model, Fuel Type, Reg No, Tank Capacity` (no ODO duplication)
- Access List: keep placeholder vs hard delete route + nav + help references

## Decision

- **Layout:** Replace dashboard grid with `dashsample` 12-col: `Monthly Distances` dark card `lg:col-span-4` (`bg-slate-900/90`, two virtual rows `This Month (MMM YYYY) In Progress` / `Previous Month Audited` with `Official|Private|Total`, trip counts, and `Business/Private` progress bar; omit fabricated `Fiscal Period/Avg Economy/Next Service`) + `Digital Vehicle Cluster` `lg:col-span-8` (`bg-cluster-bezel`, visor with `Brand Model` + `Type • Fuel Type • Tank` + `Reg No` plate badge, left ODO barrel `lastOdo` + `as at DD-MM-YYYY`, right fuel gauge arc + level bar). Delete `app/page.tsx:112-123` strip; cluster is the canonical vehicle identity surface. Tokens ported from `dashsample.html:23-33` to `globals.css`.
- **Fuel Economy Trend:** Bars → `bg-trip-official` on `bg-paper-gutter` to match Monthly/PageWise official green; RED gap column unchanged. X labels stay `DD Mon` per `w-9` stem (two stems for pre/post-pump same date share label); add single year/range footer `YYYY` or `MMM YYYY — MMM YYYY` (derived from `days[0].date` to `days[last].date`) below scroll container. No per-stem year duplication.
- **Access List:** Hard delete: remove `AppShell.tsx:19` conditional nav, delete `app/settings/access/page.tsx` folder, clean `lib/authAccess.ts:238` `SsoCheckResult` stub, remove `app/help/page.tsx:60-61` allow-list chapter text. `/settings/access` 404s.

## Alternatives Considered

- Per-stem `DD Mon 'YY` — rejected: doubles label width, noisy for two-stem dates.
- Keep light MetricCards and only copy grid proportions — rejected: user explicitly requested full dark for this part.
- Keep placeholder Access page hidden — rejected: leaves dead route and confuses single-operator model (ADR 0010).

## Consequences

- `CONTEXT.md` updated: `Monthly Distances Tile` (dark card + counts + bar), new `Digital Vehicle Cluster` (bezel + visor fields), `Fuel Economy Trend` (year footer + green palette).
- Visual regression: snapshot tests for `MetricCards`/`FuelEconomyGraph` need update (colors, structure, footer).
- Reversal: revert `MetricCards` to light, restore strip, remove footer, restore `access` route/nav.
