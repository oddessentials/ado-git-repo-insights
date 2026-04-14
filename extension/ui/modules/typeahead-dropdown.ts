/**
 * Unified Typeahead Dropdown Component
 *
 * Replaces four inconsistent filter implementations with a single
 * searchable dropdown supporting both single-select and multi-select modes.
 *
 * Features:
 * - Debounced typeahead search (200ms)
 * - Multi-select with removable chip display
 * - Single-select with value replacement
 * - All-selected normalization (emits empty array when all options selected)
 * - Keyboard navigation (arrow keys, Enter, Escape)
 * - Cross-device support (pointer events)
 *
 * Per FR-005 through FR-012 in the 041-metrics-dashboard-ux spec.
 */

// No escapeHtml import needed — all rendering uses safe DOM construction

/** A single option in the dropdown. */
export interface TypeaheadOption {
  id: string;
  displayName: string;
}

/** Configuration for initializing a typeahead dropdown. */
export interface TypeaheadConfig {
  containerId: string;
  options: TypeaheadOption[];
  mode: "single" | "multi";
  placeholder: string;
  initialSelection: string[];
  onChange: (selectedIds: string[]) => void;
}

/** Instance returned after initialization, providing programmatic control. */
export interface TypeaheadInstance {
  getSelected(): string[];
  setSelected(ids: string[]): void;
  setOptions(options: TypeaheadOption[]): void;
  clear(): void;
  destroy(): void;
}

/** Debounce delay in milliseconds for search input. */
const DEBOUNCE_MS = 200;

/**
 * Initialize a typeahead dropdown in the specified container.
 *
 * @param config - Component configuration
 * @returns Instance for programmatic control, or null if container not found
 */
export function initTypeaheadDropdown(
  config: TypeaheadConfig,
): TypeaheadInstance | null {
  const container = document.getElementById(config.containerId);
  if (!container) return null;

  // Component state
  let options = [...config.options];
  // Preserve initialSelection as-is — callers may legitimately construct a
  // typeahead with saved IDs and deliver matching options later via
  // setOptions() (async / delayed data sources). renderChips skips
  // unknown IDs via an `if (!opt) return;` guard; updateInputDisplay
  // uses `?.` + `??` for the same reason. Once setOptions arrives with
  // the matching option, both render paths resolve naturally because
  // setOptions' existing `selected.filter(...)` step keeps only IDs
  // present in the new option set, and any surviving IDs then render.
  let selected: string[] = [...config.initialSelection];
  let filteredOptions: TypeaheadOption[] = [];
  let highlightIndex = -1;
  let isOpen = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const controller = new AbortController();
  const { signal } = controller;

  // Build DOM structure
  container.innerHTML = "";
  container.classList.add("typeahead-container");

  const wrapper = document.createElement("div");
  wrapper.className = "typeahead-wrapper";

  const chipsArea = document.createElement("div");
  chipsArea.className = "typeahead-chips";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "typeahead-input";
  input.placeholder = config.placeholder;
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("autocomplete", "off");

  const dropdown = document.createElement("div");
  dropdown.className = "typeahead-dropdown";
  dropdown.setAttribute("role", "listbox");
  dropdown.style.display = "none";

  wrapper.appendChild(chipsArea);
  wrapper.appendChild(input);
  container.appendChild(wrapper);
  container.appendChild(dropdown);

  // --- Canonical helpers ---

  /** Single canonical check for "all options selected = no filter" (FR-011).
   *  Used by renderChips, getSelected, normalizeAndEmit, updateInputDisplay.
   *  Compares against options.length (full set), never filteredOptions.length. */
  function isAllSelected(): boolean {
    return (
      config.mode === "multi" &&
      selected.length > 0 &&
      selected.length === options.length
    );
  }

  // --- Render helpers ---

  function renderChips(): void {
    chipsArea.innerHTML = "";
    if (config.mode !== "multi") return;
    if (isAllSelected()) return; // FR-011: canonical "All" state = no chips

    selected.forEach((id) => {
      const opt = options.find((o) => o.id === id);
      // Defensive: `selected` can legitimately contain IDs not yet in
      // `options` (async option loading — the caller will deliver the
      // matching option later via setOptions). Skip silently here so
      // renderChips can be called at any point in the lifecycle without
      // crashing on unresolved IDs.
      if (!opt) return;

      const chip = document.createElement("span");
      chip.className = "typeahead-chip";

      const label = document.createElement("span");
      label.className = "typeahead-chip-label";
      label.textContent = opt.displayName;

      const remove = document.createElement("button");
      remove.className = "typeahead-chip-remove";
      remove.type = "button";
      remove.setAttribute("aria-label", `Remove ${opt.displayName}`);
      remove.textContent = "\u00d7"; // ×
      remove.addEventListener(
        "click",
        (e) => {
          e.stopPropagation();
          deselectOption(id);
        },
        { signal },
      );

      chip.appendChild(label);
      chip.appendChild(remove);
      chipsArea.appendChild(chip);
    });
  }

  function renderDropdown(): void {
    dropdown.innerHTML = "";
    highlightIndex = -1;

    if (filteredOptions.length === 0) {
      const empty = document.createElement("div");
      empty.className = "typeahead-empty";
      empty.textContent = "No matching options";
      dropdown.appendChild(empty);
      return;
    }

    filteredOptions.forEach((opt) => {
      const item = document.createElement("div");
      item.className = "typeahead-option";
      item.setAttribute("role", "option");
      item.setAttribute(
        "aria-selected",
        selected.includes(opt.id) ? "true" : "false",
      );
      item.setAttribute("data-testid", `typeahead-option-${opt.id}`);
      item.dataset.optionId = opt.id;

      if (selected.includes(opt.id)) {
        item.classList.add("typeahead-option-selected");
      }

      // Highlight matching text using safe DOM construction (no innerHTML).
      // Invariant: filteredOptions is always the result of filterOptions(input.value),
      // so every opt.displayName contains `searchVal` and idx is always >= 0 when
      // searchVal is non-empty. See setOptions for the co-change that preserves this.
      const searchVal = input.value.toLowerCase();
      if (searchVal) {
        const idx = opt.displayName.toLowerCase().indexOf(searchVal);
        item.appendChild(
          document.createTextNode(opt.displayName.substring(0, idx)),
        );
        const strong = document.createElement("strong");
        strong.textContent = opt.displayName.substring(
          idx,
          idx + searchVal.length,
        );
        item.appendChild(strong);
        item.appendChild(
          document.createTextNode(
            opt.displayName.substring(idx + searchVal.length),
          ),
        );
      } else {
        item.textContent = opt.displayName;
      }

      item.addEventListener(
        "pointerdown",
        (e) => {
          e.preventDefault(); // Prevent input blur
          toggleOption(opt.id);
        },
        { signal },
      );

      dropdown.appendChild(item);
    });
  }

  function updateInputDisplay(): void {
    if (config.mode === "single") {
      if (selected.length > 0) {
        // `selected[0]` may not yet match an option when the caller has
        // supplied initialSelection but is still loading options (async
        // data source). Fall back to empty input until setOptions()
        // delivers the matching option — see the constructor comment.
        const opt = options.find((o) => o.id === selected[0]);
        input.value = opt?.displayName ?? "";
      } else {
        input.value = "";
      }
      input.placeholder = selected.length > 0 ? "" : config.placeholder;
    } else {
      // Multi-select: deterministic placeholder tied to canonical state.
      // Empty selection OR all-selected (canonical empty) → original placeholder.
      // Partial selection → "Search..." to indicate active filtering.
      input.value = "";
      if (isAllSelected()) {
        input.placeholder = "All selected";
      } else if (selected.length === 0) {
        input.placeholder = config.placeholder;
      } else {
        input.placeholder = "Search...";
      }
    }
  }

  // --- Filter logic ---

  function filterOptions(query: string): void {
    const q = query.toLowerCase().trim();
    if (!q) {
      filteredOptions = [...options];
    } else {
      filteredOptions = options.filter((o) =>
        o.displayName.toLowerCase().includes(q),
      );
    }
    renderDropdown();
  }

  // --- Selection logic ---

  function normalizeAndEmit(): void {
    // FR-011: All-selected normalization via shared isAllSelected() helper
    const emitted = isAllSelected() ? [] : [...selected];
    config.onChange(emitted);
  }

  // Multi-mode only. `toggleOption` is the sole caller and inlines the
  // single-mode logic itself; it also guarantees `id` is not yet in `selected`
  // before calling here, so no `.includes` guard is needed.
  function selectOption(id: string): void {
    selected.push(id);
    input.value = "";
    filterOptions(""); // calls renderDropdown() — syncs checkmarks
    renderChips();
    updateInputDisplay(); // Sync placeholder for partial ↔ all-selected transitions
    normalizeAndEmit();
  }

  function deselectOption(id: string): void {
    selected = selected.filter((s) => s !== id);
    renderChips();
    if (isOpen) renderDropdown(); // Sync dropdown visual state (aria-selected, class)
    updateInputDisplay(); // Sync placeholder for all-selected ↔ partial transitions
    normalizeAndEmit();
  }

  function toggleOption(id: string): void {
    if (config.mode === "single") {
      // Single-select: toggling the current selection clears it; anything
      // else replaces it. Logic is inlined here (rather than dispatching to
      // selectOption) so the mode check only lives on the caller side.
      if (selected[0] === id) {
        selected = [];
        updateInputDisplay();
      } else {
        selected = [id];
        updateInputDisplay();
        closeDropdown();
      }
      normalizeAndEmit();
      return;
    }
    // Multi-select: toggle
    if (selected.includes(id)) {
      deselectOption(id);
      return;
    }
    selectOption(id);
  }

  // --- Dropdown open/close ---

  function openDropdown(): void {
    // Idempotent: setting already-set isOpen/display/aria and re-running
    // filterOptions with the same input value is safe. Re-entry during an
    // already-open state is a no-op in observable effect.
    isOpen = true;
    dropdown.style.display = "";
    input.setAttribute("aria-expanded", "true");
    filterOptions(config.mode === "single" ? "" : input.value);
  }

  function closeDropdown(): void {
    if (!isOpen) return;
    isOpen = false;
    dropdown.style.display = "none";
    input.setAttribute("aria-expanded", "false");
    highlightIndex = -1;
    if (config.mode === "single") {
      updateInputDisplay();
    }
  }

  // --- Event handlers ---

  input.addEventListener(
    "focus",
    () => {
      if (config.mode === "single") {
        input.value = "";
      }
      openDropdown();
    },
    { signal },
  );

  input.addEventListener(
    "blur",
    () => {
      // Defer to next frame so pointerdown handlers on dropdown options
      // complete before the dropdown is removed. closeDropdown() is
      // idempotent (guards with isOpen check) so double-call is safe.
      requestAnimationFrame(() => {
        closeDropdown();
      });
    },
    { signal },
  );

  input.addEventListener(
    "input",
    () => {
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        filterOptions(input.value);
        if (!isOpen) openDropdown();
      }, DEBOUNCE_MS);
    },
    { signal },
  );

  input.addEventListener(
    "keydown",
    (e: KeyboardEvent) => {
      const items = dropdown.querySelectorAll(".typeahead-option");
      if (e.key === "ArrowDown") {
        e.preventDefault();
        highlightIndex = Math.min(highlightIndex + 1, items.length - 1);
        updateHighlight(items);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        highlightIndex = Math.max(highlightIndex - 1, 0);
        updateHighlight(items);
      } else if (e.key === "Enter") {
        e.preventDefault();
        // Flush pending debounce to ensure filteredOptions is current
        if (debounceTimer !== null) {
          clearTimeout(debounceTimer);
          debounceTimer = null;
          filterOptions(input.value);
        }
        if (highlightIndex >= 0 && highlightIndex < filteredOptions.length) {
          const opt = filteredOptions.at(highlightIndex) as TypeaheadOption;
          toggleOption(opt.id);
        }
      } else if (e.key === "Escape") {
        closeDropdown();
        input.blur();
      } else if (
        e.key === "Backspace" &&
        input.value === "" &&
        config.mode === "multi" &&
        selected.length > 0
      ) {
        deselectOption(selected.at(-1) as string);
      }
    },
    { signal },
  );

  // Close on outside click
  document.addEventListener(
    "pointerdown",
    (e: PointerEvent) => {
      if (!container.contains(e.target as Node)) {
        closeDropdown();
      }
    },
    { signal },
  );

  function updateHighlight(items: NodeListOf<Element>): void {
    items.forEach((item, i) => {
      (item as HTMLElement).classList.toggle(
        "typeahead-option-highlighted",
        i === highlightIndex,
      );
    });
    // Scroll highlighted item into view
    const highlighted = Array.from(items).at(highlightIndex) as
      | HTMLElement
      | undefined;
    highlighted?.scrollIntoView({ block: "nearest" });
  }

  // --- Initial render ---
  filteredOptions = [...options];
  renderChips();
  updateInputDisplay();

  // --- Public API ---
  const instance: TypeaheadInstance = {
    getSelected(): string[] {
      // FR-011: All-selected normalization via shared isAllSelected() helper.
      // Returns empty array when all options selected, so consumers see
      // the canonical "no filter" state.
      return isAllSelected() ? [] : [...selected];
    },

    setSelected(ids: string[]): void {
      selected = ids.filter((id) => options.some((o) => o.id === id));
      // Same render sequence as selectOption/deselectOption:
      // chips → dropdown (if open) → input display
      renderChips();
      if (isOpen) renderDropdown();
      updateInputDisplay();
    },

    setOptions(newOptions: TypeaheadOption[]): void {
      options = [...newOptions];
      // Remove selections that no longer exist
      selected = selected.filter((id) => options.some((o) => o.id === id));
      renderChips();
      updateInputDisplay();
      // filterOptions always rebuilds filteredOptions against the current
      // input.value and calls renderDropdown(). Calling it unconditionally
      // keeps the invariant that renderDropdown's inner idx >= 0 check is
      // trivially satisfied: every opt in filteredOptions is one whose
      // displayName contains input.value.
      filterOptions(input.value);
    },

    clear(): void {
      selected = [];
      input.value = "";
      renderChips();
      updateInputDisplay();
      normalizeAndEmit();
    },

    destroy(): void {
      // Clear timer BEFORE aborting to prevent orphaned callbacks
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      controller.abort();
      container.innerHTML = "";
      container.classList.remove("typeahead-container");
    },
  };

  return instance;
}
