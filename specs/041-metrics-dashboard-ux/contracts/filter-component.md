# Contract: Unified Typeahead Filter Component

**Feature**: 041-metrics-dashboard-ux
**Date**: 2026-03-27

## Overview

A single typeahead dropdown component replaces four inconsistent filter implementations (Author `<datalist>`, Repo/Team `<select multiple>`, Reviewer `<select>`). Supports single-select and multi-select modes with searchable options and chip display.

## Component Interface

### Initialization

```
initTypeaheadDropdown(config: TypeaheadConfig): TypeaheadInstance
```

**TypeaheadConfig**:
| Field | Type | Description |
|-------|------|-------------|
| containerId | string | DOM element ID to mount the component |
| options | FilterOption[] | Available options (`{ id: string, displayName: string }`) |
| mode | "single" \| "multi" | Selection mode |
| placeholder | string | Input placeholder text (e.g., "Search repositories...") |
| initialSelection | string[] | Pre-selected option IDs (from URL restoration) |
| onChange | (selectedIds: string[]) => void | Callback when selection changes |

### TypeaheadInstance

| Method | Description |
|--------|-------------|
| getSelected(): string[] | Returns current selected option IDs |
| setSelected(ids: string[]): void | Programmatically set selection (for URL restore, constraint resolver) |
| setOptions(options: FilterOption[]): void | Update available options (for dimension changes) |
| clear(): void | Remove all selections |
| destroy(): void | Remove component from DOM, clean up listeners |

## Selection Behavior

### Single-Select Mode (Reviewer, Author)
- Selecting a new option replaces the previous selection
- Input clears after selection
- Selected value displayed in input field
- Maximum one `onChange` callback per user action

### Multi-Select Mode (Repository, Team)
- Selecting an option adds it to the selection set
- Selected options appear as removable chips below the input
- Options already selected are visually distinguished in the dropdown
- Clicking a chip's remove button deselects that option
- Input clears after each selection (ready for next search)

### All-Selected Normalization
- When all available options are selected in multi-select mode, the component MUST emit an empty array `[]` via `onChange`, not the full list
- This normalization happens at the component level, before the callback fires
- Rationale: Empty array means "no filter" at the data layer

## Typeahead Search Behavior

- Input is debounced (150-300ms) before filtering the options list
- Filtering is case-insensitive substring match on `displayName`
- Zero matches shows "No matching options" message in dropdown
- Empty input shows all (unselected) options
- For option sets > 200 items, dropdown uses windowed rendering (only visible items in DOM)

## URL Serialization Contract

### Canonical Format

| Dimension | Parameter | Format | Example |
|-----------|-----------|--------|---------|
| Repository | `repos` | Comma-separated, sorted, URI-encoded | `repos=backend-api,frontend-app` |
| Team | `teams` | Comma-separated, sorted, URI-encoded | `teams=platform,web` |
| Reviewer | `reviewers` | Single value, URI-encoded | `reviewers=abc-123` |
| Author | `author` | Single value, URI-encoded | `author=john.doe` |

### Serialization Rules
1. Values are URI-encoded via `encodeURIComponent()`
2. Multi-select values are sorted lexicographically (ascending, case-sensitive) before joining with `,`
3. Empty selection: parameter is **deleted** from URL (not serialized as empty string)
4. Single-select: only first value serialized (additional values impossible via UI)

### Deserialization Rules
1. Split on `,`
2. Apply `decodeURIComponent()` to each value
3. Strip empty and whitespace-only values
4. Validate each value against current dimension options; drop invalid values silently
5. For single-select dimensions, keep only first valid value

### Round-Trip Guarantee
`serialize(deserialize(serialize(state))) === serialize(state)` for all valid states.

## Constraint Resolver Contract

### resolveFilterConstraints(raw: FilterState, availableDimensions: DimensionsData): FilterConstraintResult

**Input**: Raw filter state after all-selected normalization
**Output**: Effective filter state + constraint notices

**Rules** (evaluated in order):
1. **Author + Team**: If both non-empty, clear teams. Notice: "Using author-only metrics; team selection retained for display."
2. **Reviewer + Team**: If both non-empty, clear teams. Notice: "Reviewer and team filtering cannot be combined; team cleared."
3. **Reviewer + Repo**: If both non-empty, keep both in state but notice: "Using reviewer-only metrics; repository selection retained for display."

**Sole authority**: ALL consumers (UI, metrics, URL serializer, URL deserializer) MUST call this function. No consumer may implement constraint logic independently.

## Performance Contract

| Metric | Threshold | Measurement |
|--------|-----------|-------------|
| Keystroke → dropdown update (≤200 options) | < 100ms | Automated performance test |
| Keystroke → dropdown update (≤1000 options) | < 200ms | Automated performance test |
| Continuous typing jank (1000 options) | 0 dropped frames | Automated performance test |
| Component initialization | < 50ms | Manual verification acceptable |

## Accessibility

- Input has `role="combobox"` and `aria-expanded`
- Dropdown list has `role="listbox"`
- Options have `role="option"` and `aria-selected`
- Chips have remove buttons with `aria-label="Remove [option name]"`
- Arrow keys navigate dropdown options
- Enter selects highlighted option
- Escape closes dropdown
