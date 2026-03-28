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
    return config.mode === "multi" && selected.length > 0 && selected.length === options.length;
  }

  // --- Render helpers ---

  function renderChips(): void {
    chipsArea.innerHTML = "";
    if (config.mode !== "multi") return;
    if (isAllSelected()) return; // FR-011: canonical "All" state = no chips

    selected.forEach((id) => {
      const opt = options.find((o) => o.id === id);
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
      remove.addEventListener("click", (e) => {
        e.stopPropagation();
        deselectOption(id);
      }, { signal });

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
      item.setAttribute("aria-selected", selected.includes(opt.id) ? "true" : "false");
      item.setAttribute("data-testid", `typeahead-option-${opt.id}`);
      item.dataset.optionId = opt.id;

      if (selected.includes(opt.id)) {
        item.classList.add("typeahead-option-selected");
      }

      // Highlight matching text using safe DOM construction (no innerHTML)
      const searchVal = input.value.toLowerCase();
      if (searchVal) {
        const idx = opt.displayName.toLowerCase().indexOf(searchVal);
        if (idx >= 0) {
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
      } else {
        item.textContent = opt.displayName;
      }

      item.addEventListener("pointerdown", (e) => {
        e.preventDefault(); // Prevent input blur
        toggleOption(opt.id);
      }, { signal });

      dropdown.appendChild(item);
    });
  }

  function updateInputDisplay(): void {
    if (config.mode === "single") {
      if (selected.length > 0) {
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

  function selectOption(id: string): void {
    if (config.mode === "single") {
      selected = [id];
      updateInputDisplay();
      closeDropdown();
    } else {
      if (!selected.includes(id)) {
        selected.push(id);
      }
      input.value = "";
      filterOptions(""); // calls renderDropdown() — syncs checkmarks
      renderChips();
      updateInputDisplay(); // Sync placeholder for partial ↔ all-selected transitions
    }
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
      // Single-select: always replace
      if (selected[0] === id) {
        selected = [];
        updateInputDisplay();
      } else {
        selectOption(id);
        return;
      }
    } else {
      // Multi-select: toggle
      if (selected.includes(id)) {
        deselectOption(id);
        return;
      } else {
        selectOption(id);
        return;
      }
    }
    normalizeAndEmit();
  }

  // --- Dropdown open/close ---

  function openDropdown(): void {
    if (isOpen) return;
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

  input.addEventListener("focus", () => {
    if (config.mode === "single") {
      input.value = "";
    }
    openDropdown();
  }, { signal });

  input.addEventListener("blur", () => {
    // Defer to next frame so pointerdown handlers on dropdown options
    // complete before the dropdown is removed. closeDropdown() is
    // idempotent (guards with isOpen check) so double-call is safe.
    requestAnimationFrame(() => {
      closeDropdown();
    });
  }, { signal });

  input.addEventListener("input", () => {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      filterOptions(input.value);
      if (!isOpen) openDropdown();
    }, DEBOUNCE_MS);
  }, { signal });

  input.addEventListener("keydown", (e: KeyboardEvent) => {
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
        // eslint-disable-next-line security/detect-object-injection -- SECURITY: highlightIndex is a bounds-checked numeric index, not user input
        const opt = filteredOptions[highlightIndex];
        if (opt) toggleOption(opt.id);
      }
    } else if (e.key === "Escape") {
      closeDropdown();
      input.blur();
    } else if (e.key === "Backspace" && input.value === "" && config.mode === "multi" && selected.length > 0) {
      // Remove last chip on backspace in empty input
      const last = selected[selected.length - 1];
      if (last) deselectOption(last);
    }
  }, { signal });

  // Close on outside click
  document.addEventListener("pointerdown", (e: PointerEvent) => {
    if (!container.contains(e.target as Node)) {
      closeDropdown();
    }
  }, { signal });

  function updateHighlight(items: NodeListOf<Element>): void {
    items.forEach((item, i) => {
      (item as HTMLElement).classList.toggle(
        "typeahead-option-highlighted",
        i === highlightIndex,
      );
    });
    // Scroll highlighted item into view
    // eslint-disable-next-line security/detect-object-injection -- SECURITY: highlightIndex is a bounds-checked numeric index
    const highlighted = items[highlightIndex] as HTMLElement | undefined;
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
      filteredOptions = [...options];
      renderChips();
      updateInputDisplay();
      if (isOpen) renderDropdown();
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
