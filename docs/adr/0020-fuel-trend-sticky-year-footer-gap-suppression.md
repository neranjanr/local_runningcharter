# ADR 0020: Fuel Economy Trend Sticky Year Footer with Gap Suppression

Date: 2026-09-15
Status: Accepted
Deciders: Neranjan

## Context

`FuelEconomyGraph` previously rendered a single fixed range footer `YYYY` or `MMM YYYY — MMM YYYY` outside the scroll container (`FuelEconomyGraph.tsx:230-258`). When the timeline spans 2–3 calendar years, scrolling hid the year context and gaps (odometer-loss KM Gaps) had no visual interruption in the footer. `sampletrend.html` defines a scroll-synced sticky footer: each year’s `Year Track` carries a `Sticky Year Label` (`position:sticky; left:24px; right:24px`) that stays pinned to its track’s visible portion, so 1–3 labels remain in viewport under their correct stems; every gap column (`Gap Span` `w-24 gap-stripe-bg`) has a blank footer cell (no year).

## Decision

- Replace `FuelEconomyGraph` chrome with `sampletrend.html` parity inside the existing 70:30 dashboard split: header with per-year filter presets + chevron scrollers, dashed `14 km/L max` / `10 km/L average` baselines, stems row (`w-8` stems, `w-5` bars `bg-emerald-600` on `bg-slate-100 h-48`), daily dates row (`DD Mon` + italic `Gap Period` `w-24` under gaps), and a dedicated year footer row **inside** the scroll container (`sticky bottom-0` + `inline-flex min-w-max`) interrupted by blank `w-24 bg-rose-50/40` cells under gaps.
- Year colors cycle deterministically by ascending year index: `slate → amber → emerald → sky → violet` applied to both stem group tint (`/60`) and footer track (`/80`) and label text, so adjacent years are always distinct; bar color stays independent `emerald-600`.
- Scroll remains **middle-mouse drag only** (user decision Q7) plus wheel and button scrolling; `left-drag` not adopted (`FuelEconomyGraph.tsx:139-174` middle-button path retained) and `custom-h-scrollbar` `7px` slate thumb from `sampletrend.html:9` is ported.
- Synchronization: `scrollToYear(year)` via `segment-${year}` `offsetLeft`; presets are data-driven (one button per `yearBlocks[].year`).

## Alternatives Considered

- Fixed footer outside scroll — rejected: label scrolls away, fails “year always visible under correct stems”.
- JS IntersectionObserver per label — rejected: CSS sticky suffices, less churn.
- Left-drag — rejected per user constraint; middle-mouse preserves existing ergonomics.

## Consequences

- `CONTEXT.md` updated: `Fuel Economy Trend` now documents sticky footer + gap suppression; new terms `Year Track`, `Sticky Year Label`, `Gap Span`.
- `FuelEconomyGraph` snapshot/layout tests must expect sticky labels, gap stripe, dynamic presets, and baselines.
- Reversal requires rebuilding the fixed range footer and removing sticky/gap CSS.
