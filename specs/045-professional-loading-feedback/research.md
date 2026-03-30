# Research: Professional Dashboard Loading Feedback

## R-001: Loading State Architecture — Per-Region vs Dashboard-Level

**Decision**: Dashboard-level state machine with per-region CSS presentation.

**Rationale**: One refresh token (monotonic counter) controls all loading behavior — overlay visibility, `aria-busy`, live-region announcements, and stale-result discard. Per-region execution would invite parity drift where some regions dim and others don't. The visual effect is per-region (each chart container and the summary-cards section gets a CSS class), but the trigger/clear logic is centralized.

**Alternatives considered**:
- Per-region state machines: Rejected — adds complexity, invites split-brain states, no benefit since all regions load/clear together in `refreshMetrics()`.
- Global overlay (single dimming layer over entire metrics tab): Rejected — obscures spatial context, feels heavier than per-card dimming.

## R-002: Stale Request Supersession Mechanism

**Decision**: Monotonic refresh counter (token). Each `refreshMetrics()` call increments the counter. At the end of the async work, if the current counter differs from the counter at call start, discard results silently.

**Rationale**: This is the simplest correct approach for fire-and-forget async patterns. No AbortController needed since the dataset-loader fetches from pipeline artifacts (already-downloaded JSON in many cases). The cost of letting a stale fetch complete is negligible; the important thing is not rendering its results.

**Alternatives considered**:
- AbortController: Rejected — adds complexity, not supported by the VSS SDK fetch layer, and stale fetch completion is cheap.
- Promise cancellation library: Rejected — external dependency, violates zero-deps constraint.
- Debounce-only (no supersession): Rejected — debounce reduces frequency but doesn't prevent stale renders if two requests are separated by more than the debounce window.

## R-003: No-Op Guard Strategy

**Decision**: Compare serialized effective state (filters + date range + comparison mode) before and after user interaction. If identical, skip refresh entirely — no loading state, no network request.

**Rationale**: Prevents false loading flashes from re-selecting the same value. The comparison is cheap (JSON.stringify of the state object). This also prevents wasted network calls.

**Alternatives considered**:
- Deep equality check: Functionally equivalent but more code; stringify is sufficient for this flat structure.
- Skip guard entirely: Rejected — spec explicitly requires FR-002 (no-op guard).

## R-004: Visual Loading Pattern

**Decision**: Content dimming (CSS opacity ~0.5) on chart containers + optional small spinner per region. Applied via a single CSS class (e.g., `.metrics-loading`) on a parent container, with descendant selectors for per-region dimming.

**Rationale**: Matches Grafana (per-panel spinner) and Power BI (cross-filter dimming) patterns. Preserves spatial context — users see stale data at reduced opacity, maintaining orientation. Zero layout shift since dimensions are unchanged. CSS-only implementation using `opacity` transition (GPU-composited).

**Alternatives considered**:
- Skeleton screens: Rejected — better for initial loads where no prior content exists. For filter re-renders, dimming stale content is industry best practice.
- Global overlay spinner: Rejected — loses spatial context, feels modal/blocking.
- Progress bar: Rejected — indeterminate duration makes progress bars unhelpful; spinner is more honest.

## R-005: Timing Thresholds

**Decision**: Defer exact timing guarantees (300ms show-delay, 350ms minimum-visible) to a follow-up. Initial implementation shows loading state immediately when refresh starts.

**Rationale**: The spin-delay pattern is good UX but tricky to implement correctly across rapid superseding loads without a deterministic timer abstraction. The initial implementation will focus on the state machine correctness (supersession, no-op guard, clear on success/failure). Timing polish can be layered on after the state machine is proven testable.

**Alternatives considered**:
- Implement spin-delay immediately: Rejected — risk of flaky behavior with rapid supersession; adds test complexity before the core state machine is stable.

## R-006: Accessibility Approach

**Decision**: Minimal and deterministic — `aria-busy="true"` on the `#tab-metrics` section during refresh, one polite `aria-live` region announcement when the winning refresh completes. No announcements for superseded intermediate loads.

**Rationale**: Over-announcing creates noise for screen reader users. Only the winning refresh result matters. The `aria-busy` attribute tells assistive tech to hold off reading changes until the update is complete.

**Alternatives considered**:
- Announce every state change: Rejected — rapid filter changes would spam the user.
- `aria-live="assertive"`: Rejected — dashboard refreshes are not urgent enough to interrupt.

## R-007: Reduced Motion Support

**Decision**: Respect `prefers-reduced-motion` media query. When active, suppress spinner animation but keep static dimming. The non-negotiable part is visible in-progress state without layout shift.

**Rationale**: ~70 million people have vestibular disorders. CSS media query is zero-cost to add. The dimming effect (opacity transition) can be replaced with an instant opacity change under reduced-motion.

**Alternatives considered**:
- Ignore reduced-motion: Rejected — accessibility requirement.
- Remove all visual feedback under reduced-motion: Rejected — users still need to know something is loading; just disable animation.

## R-008: Initial Bootstrap Separation

**Decision**: The in-page refresh loading state uses completely separate flags from the initial bootstrap spinner. The existing `showLoading()`/`showContent()` functions in `errors.ts` and the `#loading-state` element remain untouched. The new loading module manages its own state on `#tab-metrics` children.

**Rationale**: Mixing flags risks regressions in first-load behavior. The initial bootstrap shows/hides `#loading-state` and `#main-content` — a fundamentally different scope from dimming chart containers within an already-visible `#main-content`.

**Alternatives considered**:
- Reuse `#loading-state` element: Rejected — it hides `#main-content` entirely, which is the wrong UX for in-page refreshes.
