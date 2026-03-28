# Test-First Plan: 3 Typeahead Bugs (FR-041)

**QA Expert Report** - Tests MUST be written first (failing), then fixes make them pass.

---

## Bug 1: All-Selected Split-Brain (visual/state mismatch)

**File:** `extension/ui/modules/typeahead-dropdown.ts`

**Root Cause:**
- `renderChips()` uses internal `selected` array directly (shows all 4 chips when all selected)
- `getSelected()` and `normalizeAndEmit()` return `[]` when all options selected (FR-011 normalization)
- Dashboard sees empty filter state but UI displays all selections → confusing UX

**Test File:** `extension/tests/modules/typeahead-dropdown.test.ts`

### Test 1.1: Chips should NOT render when all options selected in multi-mode
```typescript
describe("All-selected split-brain (Bug 1)", () => {
  it("renderChips does not show chips when all options are selected (FR-011)", () => {
    createContainer("split-brain-1");
    const instance = initTypeaheadDropdown(
      makeConfig("split-brain-1", { mode: "multi" }),
    );

    // Select all 4 options (alpha, beta, gamma, delta)
    instance!.setSelected(["alpha", "beta", "gamma", "delta"]);

    // When all options selected, no chips should render
    // (getSelected() returns [] — canonical "no filter")
    const chips = document.querySelectorAll(".typeahead-chip");
    expect(chips).toHaveLength(0);
  });

  it("renderChips shows chips when NOT all options are selected", () => {
    createContainer("split-brain-2");
    const instance = initTypeaheadDropdown(
      makeConfig("split-brain-2", { mode: "multi" }),
    );

    // Select 3 of 4 options
    instance!.setSelected(["alpha", "beta", "gamma"]);

    // Should render 3 chips
    const chips = document.querySelectorAll(".typeahead-chip");
    expect(chips).toHaveLength(3);
  });

  it("normalizeAndEmit emits [] when all selected, emits values when partial", () => {
    createContainer("split-brain-3");
    const onChange = jest.fn();
    const instance = initTypeaheadDropdown(
      makeConfig("split-brain-3", { mode: "multi", onChange }),
    );

    // All selected — should emit []
    instance!.setSelected(["alpha", "beta", "gamma", "delta"]);
    expect(onChange).toHaveBeenLastCalledWith([]);

    // Partial selection — should emit actual IDs
    onChange.mockClear();
    instance!.setSelected(["alpha", "beta"]);
    expect(onChange).toHaveBeenLastCalledWith(["alpha", "beta"]);
  });
});
```

**Implementation Fix:** When `selected.length === options.length` in multi-mode, `renderChips()` should return early (render no chips) because the state layer already reports "no filter" to consumers. The rendering must match the semantic meaning.

---

## Bug 2: Single-Select Blank on Blur (input not restored)

**File:** `extension/ui/modules/typeahead-dropdown.ts` (lines 306-311, 293-302)

**Root Cause:**
- `focus` handler (line 308) clears input in single-select mode: `input.value = ""`
- No `blur` or `focusout` handler restores the selected label
- `closeDropdown()` (line 293) only fires on outside-click or Escape, NOT on Tab/blur
- User tabs away → input stays blank → they don't see their current selection

**Test File:** `extension/tests/modules/typeahead-dropdown.test.ts`

### Test 2.1: Input should restore on blur in single-select mode
```typescript
describe("Single-select blur handling (Bug 2)", () => {
  it("input restores selected display name on blur in single-select mode", () => {
    createContainer("blur-single");
    const instance = initTypeaheadDropdown(
      makeConfig("blur-single", { mode: "single" }),
    );

    instance!.setSelected(["beta"]);
    const input = document.querySelector(".typeahead-input") as HTMLInputElement;

    // User focuses (input is cleared for search)
    input.dispatchEvent(new Event("focus"));
    expect(input.value).toBe("");

    // User blurs without selecting anything (e.g. tabs away)
    input.dispatchEvent(new Event("blur"));

    // Input should restore the selected label
    expect(input.value).toBe("Beta");
  });

  it("blur closes dropdown and restores input in single-select", () => {
    createContainer("blur-dropdown");
    const instance = initTypeaheadDropdown(
      makeConfig("blur-dropdown", { mode: "single" }),
    );

    instance!.setSelected(["gamma"]);
    const input = document.querySelector(".typeahead-input") as HTMLInputElement;
    const dropdown = document.querySelector(".typeahead-dropdown") as HTMLElement;

    // Open dropdown
    input.dispatchEvent(new Event("focus"));
    expect(dropdown.style.display).toBe("");
    expect(input.value).toBe("");

    // Blur should close dropdown AND restore label
    input.dispatchEvent(new Event("blur"));
    expect(dropdown.style.display).toBe("none");
    expect(input.value).toBe("Gamma");
  });

  it("blur does nothing in multi-select mode (different behavior)", () => {
    createContainer("blur-multi");
    const instance = initTypeaheadDropdown(
      makeConfig("blur-multi", { mode: "multi" }),
    );

    instance!.setSelected(["alpha", "beta"]);
    const input = document.querySelector(".typeahead-input") as HTMLInputElement;

    // Focus opens, input is empty (multi-select keeps chips on display)
    input.dispatchEvent(new Event("focus"));
    expect(input.value).toBe("");

    // Blur should just close dropdown, leave input empty
    input.dispatchEvent(new Event("blur"));

    // Input stays empty (multi-select shows chips, not the input value)
    expect(input.value).toBe("");
  });

  it("dropdown closes on blur without outside-click needed", () => {
    createContainer("blur-no-click");
    const instance = initTypeaheadDropdown(
      makeConfig("blur-no-click", { mode: "single" }),
    );

    instance!.setSelected(["delta"]);
    const input = document.querySelector(".typeahead-input") as HTMLInputElement;
    const dropdown = document.querySelector(".typeahead-dropdown") as HTMLElement;

    input.dispatchEvent(new Event("focus"));
    expect(dropdown.style.display).toBe("");

    // Blur should close — no outside-click needed
    input.dispatchEvent(new Event("blur"));
    expect(dropdown.style.display).toBe("none");
  });
});
```

**Implementation Fix:** Add a `blur` event listener to the input. On blur (single-select only):
1. Close the dropdown
2. Restore the selected label to the input
3. Fire `updateInputDisplay()` to sync UI state

---

## Bug 3: Dashboard Bypasses Canonical Serializer (unsorted URLs)

**File:** `extension/ui/dashboard.ts` lines 2015-2026

**Root Cause:**
- `updateUrlState()` writes `currentFilters.repos.join(",")` directly (unsorted)
- Should use `serializeFiltersToUrl()` from filters.ts which sorts lexicographically
- Two different filter selections in different orders produce different URLs
- Same filters applied in different orders should produce identical URLs (idempotency)

**Test File:** `extension/tests/integration/dashboard-filter-url.test.ts` (NEW file)

### Test 3.1-3.4: URL serialization must be canonical and sorted
```typescript
/**
 * Dashboard Filter URL Canonical Serialization Tests
 *
 * Verifies Bug 3: updateUrlState() uses serializeFiltersToUrl() to ensure
 * filters applied in any order produce identical URLs (idempotent).
 */

import {
  serializeFiltersToUrl,
  parseFiltersFromUrl,
  type FilterState,
} from "../../ui/modules/filters";

describe("Dashboard Filter URL Canonical Serialization (Bug 3)", () => {
  describe("updateUrlState uses canonical serializer", () => {
    it("repos are serialized in sorted order", () => {
      const state: FilterState = {
        repos: ["zebra-repo", "alpha-repo", "middle-repo"],
        teams: [],
        reviewers: [],
        authors: [],
      };

      const params = new URLSearchParams();
      serializeFiltersToUrl(state, params);
      const url = params.toString();

      // Extract repos parameter and verify order
      const reposParam = new URLSearchParams(url).get("repos") ?? "";
      const parts = reposParam.split(",");

      // Should be sorted: alpha < middle < zebra
      expect(parts).toEqual(["alpha-repo", "middle-repo", "zebra-repo"]);
    });

    it("different selection order produces same URL", () => {
      const reposOrderA = ["zebra", "alpha", "middle"];
      const reposOrderB = ["alpha", "middle", "zebra"];

      const urlA = new URLSearchParams();
      serializeFiltersToUrl(
        { repos: reposOrderA, teams: [], reviewers: [], authors: [] },
        urlA,
      );
      const stringA = urlA.toString();

      const urlB = new URLSearchParams();
      serializeFiltersToUrl(
        { repos: reposOrderB, teams: [], reviewers: [], authors: [] },
        urlB,
      );
      const stringB = urlB.toString();

      // Same filters in different orders must produce identical URLs
      expect(stringA).toBe(stringB);
    });

    it("multi-dimensional filters all sorted independently", () => {
      const state: FilterState = {
        repos: ["z-repo", "a-repo"],
        teams: ["z-team", "a-team"],
        reviewers: ["z-rev", "a-rev"],
        authors: [], // authors are single-select, not sorted
      };

      const params = new URLSearchParams();
      serializeFiltersToUrl(state, params);
      const url = params.toString();
      const parsed = new URLSearchParams(url);

      expect(parsed.get("repos")).toBe("a-repo,z-repo");
      expect(parsed.get("teams")).toBe("a-team,z-team");
      expect(parsed.get("reviewers")).toBe("a-rev,z-rev");
    });

    it("empty filters are not included in URL", () => {
      const state: FilterState = {
        repos: [],
        teams: ["team-1"],
        reviewers: [],
        authors: [],
      };

      const params = new URLSearchParams();
      serializeFiltersToUrl(state, params);

      expect(params.has("repos")).toBe(false);
      expect(params.has("teams")).toBe(true);
      expect(params.has("reviewers")).toBe(false);
      expect(params.has("authors")).toBe(false);
    });
  });

  describe("Round-trip idempotency", () => {
    it("serialize(deserialize(serialize(state))) === serialize(state)", () => {
      const state: FilterState = {
        repos: ["repo-z", "repo-a"],
        teams: ["team-2", "team-1"],
        reviewers: ["rev-x"],
        authors: [],
      };

      // First serialization
      const params1 = new URLSearchParams();
      serializeFiltersToUrl(state, params1);
      const url1 = params1.toString();

      // Deserialize
      const deserialized = parseFiltersFromUrl(new URLSearchParams(url1));

      // Second serialization
      const params2 = new URLSearchParams();
      serializeFiltersToUrl(deserialized, params2);
      const url2 = params2.toString();

      // Both serializations must produce identical URLs
      expect(url2).toBe(url1);
    });

    it("user selections in different order produce same persisted state", () => {
      // Simulate user selecting repos in order: zebra, alpha, middle
      const selectOrderA: FilterState = {
        repos: ["zebra", "alpha", "middle"],
        teams: [],
        reviewers: [],
        authors: [],
      };

      // Simulate user selecting same repos in different order: alpha, middle, zebra
      const selectOrderB: FilterState = {
        repos: ["alpha", "middle", "zebra"],
        teams: [],
        reviewers: [],
        authors: [],
      };

      const urlA = new URLSearchParams();
      serializeFiltersToUrl(selectOrderA, urlA);

      const urlB = new URLSearchParams();
      serializeFiltersToUrl(selectOrderB, urlB);

      // Both should produce identical URLs → user can bookmark either state
      expect(urlA.toString()).toBe(urlB.toString());
    });
  });
});
```

**Implementation Fix:** In `updateUrlState()` (dashboard.ts lines 2015-2026), replace:
```typescript
// OLD (unsorted, bypasses canonical serializer):
if (currentFilters.repos.length > 0) {
  newParams.set("repos", currentFilters.repos.join(","));
}
```

With:
```typescript
// NEW (uses canonical serializer):
serializeFiltersToUrl(currentFilters, newParams);
```

Then remove the individual dimension handling (repos, teams, reviewers, author) since `serializeFiltersToUrl()` handles all of them.

---

## Test Execution Order

1. **Bug 1 tests** → Run existing test (line 166-206 already passes)
   - Add new assertions for chip rendering in all-selected state

2. **Bug 2 tests** → Add new describe block to typeahead-dropdown.test.ts
   - Simulate `blur` event (JSDOM supports this natively)
   - Assert input value and dropdown visibility after blur

3. **Bug 3 tests** → Create new file: `extension/tests/integration/dashboard-filter-url.test.ts`
   - Import `serializeFiltersToUrl` from filters.ts (already exists)
   - Test sort order and idempotency
   - No need to instantiate dashboard.ts (monolithic) — test the canonical serializer in isolation

---

## Implementation Notes

- **JSDOM Blur Support**: JSDOM fully supports `blur` event, no polyfill needed
- **Bug 1 Fix**: Modify `renderChips()` to check if `selected.length === options.length` and return early
- **Bug 2 Fix**: Add blur listener to input; restore display name before closing dropdown
- **Bug 3 Fix**: Import `serializeFiltersToUrl` in dashboard.ts; use it instead of manual `join(",")`

---

## Metrics

- **Total Tests to Write:** 8
- **Test Files:** 2 (1 existing + 1 new)
- **Coverage:** All 3 bugs have visual + semantic + round-trip assertions
