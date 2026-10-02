# Specification: Strict Fuel Logic & Multi-Segment Smoothing

**Author / Context:** Adaptation of strict fuel calculation logic for Running Chart digital ledger.

## Overview

This specification defines the strict fuel economy calculation model combining **Gap Boundary Island Isolation** and **Full-Tank Weighted Multi-Segment Smoothing**. This approach addresses erratic fuel economy fluctuations between consecutive fuel-in segments by establishing gravitational anchors at `★ Full Tank` trips and applying exponential smoothing with global delta constraints across segments, while strictly isolating calculation chains across odometer gaps.

---

## 1. Handling Missing Data (The Gap Rule)

When trip data contains a disconnected block of trips where distance and fuel inputs are missing (an odometer discontinuity or KM Gap where `end_km ≠ next.start_km`):

*   **Gap Boundary Detection:** Any missing sequence / odometer discrepancy in trip records is detected and treated as a Gap Boundary (`detectTripGaps`).
*   **Island Isolation:** 
    *   The app stops calculating fuel economy across the gap.
    *   The calculation chain is split into two independent islands: **Island Before Gap** and **Island After Gap**.
    *   The gap acts as a locked boundary or reset point. Calculation resumes fresh after the gap, typically starting from the next recorded `★ Full Tank` trip.
*   **Display Rule:** Segments and dates crossing or falling within unanchored gap spans display an em dash (`—`) with an amber tooltip *"Economy not calculated — ODO gap"*.

---

## 2. Full-Tank Weighting & Smooth Multi-Segment Blending

To prevent wild segment-to-segment bouncing (e.g., 10 → 7 → 11 km/L) and honor the high reliability of `★ Full Tank` anchor points:

### A. Raw Anchored Averages
The log is divided into segments bounded by `★ Full Tank` trips (ignoring gaps, with island separation). Raw mathematical economy is computed for each segment independently:
$$\text{Raw}_1 = \frac{D_1}{F_1}, \quad \text{Raw}_2 = \frac{D_2}{F_2}, \quad \text{Raw}_3 = \frac{D_3}{F_3}, \dots$$
where $D_i$ is total distance and $F_i$ is total fuel pumped in segment $i$.

### B. Weighted Moving Average (Smoothing Filter)
Instead of forcing vehicle economy to snap instantly to $\text{Raw}_i$, a dampening function / exponential smoothing is applied where `★ Full Tank` trips carry higher statistical weight:
$$\text{Final}_{\text{segment}} = (\alpha \times \text{Raw}_{\text{segment}}) + ((1 - \alpha) \times \text{Final}_{\text{previous}})$$
*   **Weight Factor ($\alpha$):** Controls how fast economy shifts. Because `★ Full Tank` trips are high-confidence anchors, they are assigned higher weight (e.g., $\alpha = 0.7$).
*   **Lookback:** The formula looks back at the previous segment's final economy to prevent violent, unrealistic spikes.

### C. Global Constraint Enforcement
A final pass runs over the calculated block to check the delta between adjacent segments:
*   If $|\text{Final}_2 - \text{Final}_1| > \text{MaxDelta}$ (e.g., $\text{MaxDelta} = 1.5\text{ km/L}$), pull the values closer together by distributing variance across intermediate partial fills.
*   This ensures progressive, natural book values (e.g., grading smoothly from $10.0 \rightarrow 10.3 \rightarrow 10.5\text{ km/L}$) rather than erratic jumps.

---

## 3. Integration & Feasibility

*   **Feasibility Checks:** Intermediate per-trip fuel balances must remain within $[1, \text{tankCapacity}]$ (or strict full-tank post-pump window $[\text{tankCapacity} - 3, \text{tankCapacity}]$).
*   **Operator Override & Locking:** Explicitly locked fuel economies (🔒) and adjusted manual economies take precedence over automated smoothing.
