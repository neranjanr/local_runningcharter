# Trip-delimited fuel cycles with 40 km split-day ledger columns

Fuel economy was stored per day, so a mid-day pump mis-attributed whole dates: a START pump on the 2nd of 2 trips changed nothing visible, and the 19 km START trip was silently downgraded to END by the trip_distance>20 guard. We now delimit economy cycles at the pumped Trip itself (a START pump joins the next cycle at any distance; an END pump stays in the previous one), store per-Trip overrides with cycle-write, and split Side 2 ledger columns per cycle only when the date totals over 40 km — small days collapse to one column with a distance-weighted-average economy and a split marker — because the physical book cannot fit two economies in one day-column.

Considered Options: per-trip columns always (rejected: breaks the paper mirror for ordinary days); keep per-day economy (rejected: the reported mis-attribution stands).

Consequences: the estimator, Side 2 tables, and the Trend graph move to trip-delimited segments; existing per-day values backfill to each trip of the date so displayed numbers don't shift until re-estimated; ledger columns consume day-slots toward the 4-per-page limit.
