# ADR 0026: Gap-Aware Insert Shift (Bounded vs Unbounded)

Decided: gap-aware Insert After offers both Gap-Absorbed Insert (bounded, vacuum-consuming) and Gap-Preserving Shift (unbounded, legacy) when downstream contains a KM Gap. Bounded shifts contiguous block until next gap by Δ, reduces gap G→max(0,G-Δ), spills S=max(0,Δ-G) beyond gap; unbounded shifts all downstream by Δ preserving gap. Default is bounded when Δ≤G, unbounded with warning when Δ>G; dual preview shown only when downstream gap exists.

Context: Insert After (`CONTEXT.md:177`, `lib/tripShift.ts:35`) uniformly shifted all downstream Trips, so inserting a missed Trip into an ODO vacuum (e.g. gap 650→700, insert 650→690 Δ=40) moved downstream 700→800 to 740→840 instead of shrinking the gap to 690→700. Operators needed a choice: fill/reduce the vacuum vs preserve/move it. Pure no-shift Gap Fill (`CONTEXT.md:174`) only handles exact gap closure, not partial fills or insertions before a gap with intermediate Trips.
