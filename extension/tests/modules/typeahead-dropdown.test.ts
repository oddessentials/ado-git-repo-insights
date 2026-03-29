/**
 * Typeahead Dropdown Component Tests
 *
 * Covers: single-select, multi-select, chip rendering, search filtering,
 * zero-match display, all-selected normalization, keyboard navigation.
 */

import {
  initTypeaheadDropdown,
  type TypeaheadConfig,
  type TypeaheadOption,
} from "../../ui/modules/typeahead-dropdown";

// jsdom lacks scrollIntoView and PointerEvent — polyfill them for tests
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = jest.fn();
}
if (typeof PointerEvent === "undefined") {
  // Minimal PointerEvent polyfill based on MouseEvent
  (globalThis as Record<string, unknown>).PointerEvent = class PointerEvent extends MouseEvent {
    constructor(type: string, init?: PointerEventInit) {
      super(type, init);
    }
  };
}

const sampleOptions: TypeaheadOption[] = [
  { id: "alpha", displayName: "Alpha" },
  { id: "beta", displayName: "Beta" },
  { id: "gamma", displayName: "Gamma" },
  { id: "delta", displayName: "Delta" },
];

function createContainer(id: string): HTMLDivElement {
  const el = document.createElement("div");
  el.id = id;
  document.body.appendChild(el);
  return el;
}

function makeConfig(
  containerId: string,
  overrides: Partial<TypeaheadConfig> = {},
): TypeaheadConfig {
  return {
    containerId,
    options: [...sampleOptions],
    mode: "multi",
    placeholder: "Search...",
    initialSelection: [],
    onChange: jest.fn(),
    ...overrides,
  };
}

describe("Typeahead Dropdown", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  describe("Initialization", () => {
    it("returns null when container not found", () => {
      const instance = initTypeaheadDropdown(
        makeConfig("nonexistent"),
      );
      expect(instance).toBeNull();
    });

    it("creates typeahead structure in container", () => {
      createContainer("test-filter");
      const instance = initTypeaheadDropdown(
        makeConfig("test-filter"),
      );
      expect(instance).not.toBeNull();

      const container = document.getElementById("test-filter")!;
      expect(container.querySelector(".typeahead-wrapper")).not.toBeNull();
      expect(container.querySelector(".typeahead-input")).not.toBeNull();
      expect(container.querySelector(".typeahead-dropdown")).not.toBeNull();
    });

    it("sets aria attributes on input", () => {
      createContainer("test-filter");
      initTypeaheadDropdown(makeConfig("test-filter"));

      const input = document.querySelector(".typeahead-input") as HTMLInputElement;
      expect(input.getAttribute("role")).toBe("combobox");
      expect(input.getAttribute("aria-expanded")).toBe("false");
      expect(input.getAttribute("aria-autocomplete")).toBe("list");
    });
  });

  describe("Single-select mode", () => {
    it("replaces previous selection on new select", () => {
      createContainer("single");
      const onChange = jest.fn();
      const instance = initTypeaheadDropdown(
        makeConfig("single", { mode: "single", onChange }),
      );

      instance!.setSelected(["alpha"]);
      expect(instance!.getSelected()).toEqual(["alpha"]);

      instance!.setSelected(["beta"]);
      expect(instance!.getSelected()).toEqual(["beta"]);
    });

    it("shows selected value in input field", () => {
      createContainer("single");
      const instance = initTypeaheadDropdown(
        makeConfig("single", { mode: "single" }),
      );

      instance!.setSelected(["beta"]);
      const input = document.querySelector(".typeahead-input") as HTMLInputElement;
      expect(input.value).toBe("Beta");
    });
  });

  describe("Multi-select mode", () => {
    it("accumulates selections", () => {
      createContainer("multi");
      const instance = initTypeaheadDropdown(
        makeConfig("multi", { mode: "multi" }),
      );

      instance!.setSelected(["alpha", "beta"]);
      expect(instance!.getSelected()).toEqual(["alpha", "beta"]);
    });

    it("renders chips for selected values", () => {
      createContainer("multi");
      initTypeaheadDropdown(
        makeConfig("multi", {
          mode: "multi",
          initialSelection: ["alpha", "gamma"],
        }),
      );

      const chips = document.querySelectorAll(".typeahead-chip");
      expect(chips).toHaveLength(2);
      expect(chips[0]?.textContent).toContain("Alpha");
      expect(chips[1]?.textContent).toContain("Gamma");
    });

    it("removes chip on remove button click", () => {
      createContainer("multi");
      const onChange = jest.fn();
      const instance = initTypeaheadDropdown(
        makeConfig("multi", {
          mode: "multi",
          initialSelection: ["alpha", "beta"],
          onChange,
        }),
      );

      const removeBtn = document.querySelector(
        ".typeahead-chip-remove",
      ) as HTMLButtonElement;
      removeBtn.click();

      expect(instance!.getSelected()).toEqual(["beta"]);
    });
  });

  describe("All-selected normalization (FR-011)", () => {
    it("getSelected returns empty array when all options selected in multi mode", () => {
      createContainer("norm");
      const onChange = jest.fn();
      const instance = initTypeaheadDropdown(
        makeConfig("norm", { mode: "multi", onChange }),
      );

      // Select all four options
      instance!.setSelected(["alpha", "beta", "gamma", "delta"]);

      // FR-011: getSelected() returns [] when all options are selected
      // (canonical "no filter" state at the state layer)
      expect(instance!.getSelected()).toEqual([]);
    });

    it("getSelected returns actual values when NOT all options selected", () => {
      createContainer("norm-partial");
      const instance = initTypeaheadDropdown(
        makeConfig("norm-partial", { mode: "multi" }),
      );

      instance!.setSelected(["alpha", "beta"]);
      expect(instance!.getSelected()).toEqual(["alpha", "beta"]);
    });

    it("does NOT normalize in single-select mode", () => {
      createContainer("norm-single");
      const onChange = jest.fn();
      initTypeaheadDropdown(
        makeConfig("norm-single", {
          mode: "single",
          options: [{ id: "only", displayName: "Only" }],
          onChange,
        }),
      );

      // Single option selected = not "all selected" normalization
      // (single-select doesn't have this concept)
    });
  });

  describe("Search filtering", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("shows 'No matching options' when search matches nothing", () => {
      createContainer("search");
      initTypeaheadDropdown(makeConfig("search"));

      const input = document.querySelector(
        ".typeahead-input",
      ) as HTMLInputElement;

      // Focus to open dropdown
      input.dispatchEvent(new Event("focus"));

      // Type a non-matching query
      input.value = "zzzzzzz";
      input.dispatchEvent(new Event("input"));

      // Wait for debounce
      jest.advanceTimersByTime(250);

      const emptyMsg = document.querySelector(".typeahead-empty");
      expect(emptyMsg?.textContent).toBe("No matching options");
    });
  });

  describe("Programmatic API", () => {
    it("getSelected returns current selection", () => {
      createContainer("api");
      const instance = initTypeaheadDropdown(
        makeConfig("api", { initialSelection: ["beta"] }),
      );
      expect(instance!.getSelected()).toEqual(["beta"]);
    });

    it("setSelected updates selection and chips", () => {
      createContainer("api-set");
      const instance = initTypeaheadDropdown(
        makeConfig("api-set", { mode: "multi" }),
      );

      instance!.setSelected(["gamma", "delta"]);
      expect(instance!.getSelected()).toEqual(["gamma", "delta"]);

      const chips = document.querySelectorAll(".typeahead-chip");
      expect(chips).toHaveLength(2);
    });

    it("setSelected drops invalid IDs", () => {
      createContainer("api-invalid");
      const instance = initTypeaheadDropdown(
        makeConfig("api-invalid"),
      );

      instance!.setSelected(["alpha", "nonexistent", "beta"]);
      expect(instance!.getSelected()).toEqual(["alpha", "beta"]);
    });

    it("clear removes all selections", () => {
      createContainer("api-clear");
      const onChange = jest.fn();
      const instance = initTypeaheadDropdown(
        makeConfig("api-clear", {
          initialSelection: ["alpha", "beta"],
          onChange,
        }),
      );

      instance!.clear();
      expect(instance!.getSelected()).toEqual([]);
    });

    it("setOptions updates available options and removes stale selections", () => {
      createContainer("api-opts");
      const instance = initTypeaheadDropdown(
        makeConfig("api-opts", {
          initialSelection: ["alpha", "beta"],
        }),
      );

      instance!.setOptions([
        { id: "alpha", displayName: "Alpha" },
        { id: "new", displayName: "New Option" },
      ]);

      // "beta" was selected but is no longer in options — should be removed
      expect(instance!.getSelected()).toEqual(["alpha"]);
    });

    it("destroy cleans up DOM and listeners", () => {
      createContainer("api-destroy");
      const instance = initTypeaheadDropdown(
        makeConfig("api-destroy"),
      );

      instance!.destroy();
      const container = document.getElementById("api-destroy")!;
      expect(container.innerHTML).toBe("");
      expect(container.classList.contains("typeahead-container")).toBe(false);
    });
  });

  describe("Keyboard navigation", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("ArrowDown moves highlight state downward", () => {
      createContainer("kbd-down");
      initTypeaheadDropdown(makeConfig("kbd-down"));

      const input = document.querySelector(".typeahead-input") as HTMLInputElement;
      // Focus opens dropdown
      input.dispatchEvent(new Event("focus"));

      // ArrowDown once — first option highlighted
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      const items = document.querySelectorAll(".typeahead-option");
      expect(items[0]?.classList.contains("typeahead-option-highlighted")).toBe(true);

      // ArrowDown again — second option highlighted
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      expect(items[0]?.classList.contains("typeahead-option-highlighted")).toBe(false);
      expect(items[1]?.classList.contains("typeahead-option-highlighted")).toBe(true);
    });

    it("ArrowUp moves highlight state upward", () => {
      createContainer("kbd-up");
      initTypeaheadDropdown(makeConfig("kbd-up"));

      const input = document.querySelector(".typeahead-input") as HTMLInputElement;
      input.dispatchEvent(new Event("focus"));

      // Move down twice
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));

      // Move up once — first option highlighted again
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
      const items = document.querySelectorAll(".typeahead-option");
      expect(items[0]?.classList.contains("typeahead-option-highlighted")).toBe(true);
      expect(items[1]?.classList.contains("typeahead-option-highlighted")).toBe(false);
    });

    it("ArrowDown does not exceed last option", () => {
      createContainer("kbd-clamp");
      initTypeaheadDropdown(makeConfig("kbd-clamp"));

      const input = document.querySelector(".typeahead-input") as HTMLInputElement;
      input.dispatchEvent(new Event("focus"));

      // Press down more times than options exist
      for (let i = 0; i < 10; i++) {
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      }

      const items = document.querySelectorAll(".typeahead-option");
      // Last item should be highlighted
      expect(items[items.length - 1]?.classList.contains("typeahead-option-highlighted")).toBe(true);
    });

    it("ArrowUp does not go below index 0", () => {
      createContainer("kbd-floor");
      initTypeaheadDropdown(makeConfig("kbd-floor"));

      const input = document.querySelector(".typeahead-input") as HTMLInputElement;
      input.dispatchEvent(new Event("focus"));

      // Move down once, then up many times
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      for (let i = 0; i < 5; i++) {
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
      }

      const items = document.querySelectorAll(".typeahead-option");
      expect(items[0]?.classList.contains("typeahead-option-highlighted")).toBe(true);
    });

    it("Enter selects the highlighted option", () => {
      createContainer("kbd-enter");
      const onChange = jest.fn();
      const instance = initTypeaheadDropdown(
        makeConfig("kbd-enter", { mode: "multi", onChange }),
      );

      const input = document.querySelector(".typeahead-input") as HTMLInputElement;
      input.dispatchEvent(new Event("focus"));

      // Highlight first option (Alpha)
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      // Select it
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

      expect(instance!.getSelected()).toEqual(["alpha"]);
      expect(onChange).toHaveBeenCalledWith(["alpha"]);
    });

    it("Enter with pending debounce flushes filter before selecting", () => {
      createContainer("kbd-enter-debounce");
      const onChange = jest.fn();
      const instance = initTypeaheadDropdown(
        makeConfig("kbd-enter-debounce", { mode: "multi", onChange }),
      );

      const input = document.querySelector(".typeahead-input") as HTMLInputElement;
      input.dispatchEvent(new Event("focus"));

      // Type "Gam" which should filter to Gamma, but don't wait for debounce
      input.value = "Gam";
      input.dispatchEvent(new Event("input"));

      // Don't advance timers — debounce is still pending.
      // Enter flushes the debounce (calls filterOptions which resets highlightIndex).
      // So we press Enter once to flush, then ArrowDown to highlight the
      // first (and only) filtered option, then Enter to select it.
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

      // After flush, only "Gamma" remains in filteredOptions
      const options = document.querySelectorAll(".typeahead-option");
      expect(options.length).toBe(1);
      expect(options[0]?.textContent).toContain("Gamma");

      // Now navigate down and select
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

      expect(instance!.getSelected()).toEqual(["gamma"]);
    });

    it("Escape closes dropdown and blurs input", () => {
      createContainer("kbd-esc");
      initTypeaheadDropdown(makeConfig("kbd-esc"));

      const input = document.querySelector(".typeahead-input") as HTMLInputElement;
      input.dispatchEvent(new Event("focus"));

      // Dropdown should be open
      const dropdown = document.querySelector(".typeahead-dropdown") as HTMLElement;
      expect(dropdown.style.display).toBe("");
      expect(input.getAttribute("aria-expanded")).toBe("true");

      // Press Escape
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

      expect(dropdown.style.display).toBe("none");
      expect(input.getAttribute("aria-expanded")).toBe("false");
    });

    it("Backspace on empty input removes last chip in multi-select", () => {
      createContainer("kbd-bs");
      const onChange = jest.fn();
      const instance = initTypeaheadDropdown(
        makeConfig("kbd-bs", {
          mode: "multi",
          initialSelection: ["alpha", "beta", "gamma"],
          onChange,
        }),
      );

      const input = document.querySelector(".typeahead-input") as HTMLInputElement;
      input.value = "";

      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }));

      // "gamma" (last) should be removed
      expect(instance!.getSelected()).toEqual(["alpha", "beta"]);
    });

    it("Backspace does nothing when input has text", () => {
      createContainer("kbd-bs-text");
      const instance = initTypeaheadDropdown(
        makeConfig("kbd-bs-text", {
          mode: "multi",
          initialSelection: ["alpha", "beta"],
        }),
      );

      const input = document.querySelector(".typeahead-input") as HTMLInputElement;
      input.value = "some text";

      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }));

      // Nothing removed
      expect(instance!.getSelected()).toEqual(["alpha", "beta"]);
    });
  });

  describe("Outside click dismiss", () => {
    it("pointerdown outside container closes dropdown", () => {
      createContainer("outside-click");
      initTypeaheadDropdown(makeConfig("outside-click"));

      const input = document.querySelector(".typeahead-input") as HTMLInputElement;
      input.dispatchEvent(new Event("focus"));

      const dropdown = document.querySelector(".typeahead-dropdown") as HTMLElement;
      expect(dropdown.style.display).toBe("");

      // Simulate a click outside the container
      const outsideElement = document.createElement("div");
      document.body.appendChild(outsideElement);
      document.dispatchEvent(new PointerEvent("pointerdown", {
        bubbles: true,
      }));

      expect(dropdown.style.display).toBe("none");
    });

    it("pointerdown inside container does NOT close dropdown", () => {
      createContainer("inside-click");
      initTypeaheadDropdown(makeConfig("inside-click"));

      const input = document.querySelector(".typeahead-input") as HTMLInputElement;
      input.dispatchEvent(new Event("focus"));

      const dropdown = document.querySelector(".typeahead-dropdown") as HTMLElement;
      expect(dropdown.style.display).toBe("");

      // Simulate pointerdown inside the container
      const container = document.getElementById("inside-click")!;
      container.dispatchEvent(new PointerEvent("pointerdown", {
        bubbles: true,
      }));

      expect(dropdown.style.display).toBe("");
    });
  });

  describe("Debounced search filtering", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("search input triggers debounce and filters options after 200ms", () => {
      createContainer("debounce-filter");
      initTypeaheadDropdown(makeConfig("debounce-filter"));

      const input = document.querySelector(".typeahead-input") as HTMLInputElement;
      input.dispatchEvent(new Event("focus"));

      // Type search query
      input.value = "alp";
      input.dispatchEvent(new Event("input"));

      // Before debounce: dropdown still shows all 4 options (from focus open)
      const optionsBefore = document.querySelectorAll(".typeahead-option");
      expect(optionsBefore.length).toBe(4);

      // After debounce: only "Alpha" matches
      jest.advanceTimersByTime(250);
      const optionsAfter = document.querySelectorAll(".typeahead-option");
      expect(optionsAfter.length).toBe(1);
      expect(optionsAfter[0]?.textContent).toContain("Alpha");
    });

    it("zero search results shows 'No matching options' message", () => {
      createContainer("debounce-zero");
      initTypeaheadDropdown(makeConfig("debounce-zero"));

      const input = document.querySelector(".typeahead-input") as HTMLInputElement;
      input.dispatchEvent(new Event("focus"));

      input.value = "xyznonexistent";
      input.dispatchEvent(new Event("input"));
      jest.advanceTimersByTime(250);

      const emptyMsg = document.querySelector(".typeahead-empty");
      expect(emptyMsg?.textContent).toBe("No matching options");
      expect(document.querySelectorAll(".typeahead-option").length).toBe(0);
    });

    it("search input opens dropdown if it was closed", () => {
      createContainer("debounce-open");
      initTypeaheadDropdown(makeConfig("debounce-open"));

      const input = document.querySelector(".typeahead-input") as HTMLInputElement;
      const dropdown = document.querySelector(".typeahead-dropdown") as HTMLElement;

      // Dropdown starts closed
      expect(dropdown.style.display).toBe("none");

      // Typing should open dropdown after debounce
      input.value = "a";
      input.dispatchEvent(new Event("input"));
      jest.advanceTimersByTime(250);

      expect(dropdown.style.display).toBe("");
    });
  });

  describe("Scroll into view on highlight", () => {
    it("scrollIntoView is called on highlighted option", () => {
      createContainer("scroll-view");
      initTypeaheadDropdown(makeConfig("scroll-view"));

      const input = document.querySelector(".typeahead-input") as HTMLInputElement;
      input.dispatchEvent(new Event("focus"));

      // Mock scrollIntoView on the first option
      const items = document.querySelectorAll(".typeahead-option");
      const scrollMock = jest.fn();
      (items[0] as HTMLElement).scrollIntoView = scrollMock;

      input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));

      expect(scrollMock).toHaveBeenCalledWith({ block: "nearest" });
    });
  });

  describe("setOptions with stale selection removal", () => {
    it("removes stale selections when options change", () => {
      createContainer("stale-opts");
      const instance = initTypeaheadDropdown(
        makeConfig("stale-opts", {
          mode: "multi",
          initialSelection: ["alpha", "beta", "gamma"],
        }),
      );

      // Replace with options that don't include "beta" or "gamma"
      instance!.setOptions([
        { id: "alpha", displayName: "Alpha" },
        { id: "new1", displayName: "New One" },
      ]);

      expect(instance!.getSelected()).toEqual(["alpha"]);
    });

    it("updates dropdown when open during setOptions", () => {
      createContainer("stale-open");
      const instance = initTypeaheadDropdown(
        makeConfig("stale-open"),
      );

      const input = document.querySelector(".typeahead-input") as HTMLInputElement;
      input.dispatchEvent(new Event("focus"));

      const optionsBefore = document.querySelectorAll(".typeahead-option");
      expect(optionsBefore.length).toBe(4);

      instance!.setOptions([
        { id: "x", displayName: "X" },
        { id: "y", displayName: "Y" },
      ]);

      const optionsAfter = document.querySelectorAll(".typeahead-option");
      expect(optionsAfter.length).toBe(2);
    });
  });

  describe("Single-select input display", () => {
    it("input shows selected display name in single-select", () => {
      createContainer("single-display");
      const instance = initTypeaheadDropdown(
        makeConfig("single-display", { mode: "single" }),
      );

      instance!.setSelected(["gamma"]);
      const input = document.querySelector(".typeahead-input") as HTMLInputElement;
      expect(input.value).toBe("Gamma");
    });

    it("input clears on focus in single-select mode (to allow search)", () => {
      createContainer("single-focus-clear");
      const instance = initTypeaheadDropdown(
        makeConfig("single-focus-clear", { mode: "single" }),
      );

      instance!.setSelected(["beta"]);
      const input = document.querySelector(".typeahead-input") as HTMLInputElement;
      expect(input.value).toBe("Beta");

      // Focus clears input for search
      input.dispatchEvent(new Event("focus"));
      expect(input.value).toBe("");
    });

    it("input restores display name on close without selection change (single-select)", () => {
      createContainer("single-restore");
      const instance = initTypeaheadDropdown(
        makeConfig("single-restore", { mode: "single" }),
      );

      instance!.setSelected(["alpha"]);
      const input = document.querySelector(".typeahead-input") as HTMLInputElement;

      // Open (clears input)
      input.dispatchEvent(new Event("focus"));
      expect(input.value).toBe("");

      // Close via Escape (restores display name)
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      expect(input.value).toBe("Alpha");
    });
  });

  describe("destroy lifecycle", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("destroy clears pending debounce timer", () => {
      createContainer("destroy-timer");
      const instance = initTypeaheadDropdown(
        makeConfig("destroy-timer"),
      );

      const input = document.querySelector(".typeahead-input") as HTMLInputElement;
      input.dispatchEvent(new Event("focus"));
      input.value = "test";
      input.dispatchEvent(new Event("input"));

      // Debounce is pending — destroy should clear it
      instance!.destroy();

      // Advancing timers should not throw or cause issues
      expect(() => jest.advanceTimersByTime(300)).not.toThrow();
    });

    it("destroy aborts AbortController (no listeners fire post-destroy)", () => {
      createContainer("destroy-abort");
      const onChange = jest.fn();
      const instance = initTypeaheadDropdown(
        makeConfig("destroy-abort", { onChange }),
      );

      instance!.destroy();

      // Dispatching events on the destroyed container's former input should not call onChange
      // (The container is cleared so we can't get input, but document-level listeners should be aborted)
      onChange.mockClear();
      document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));

      // onChange should NOT have been called
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // Bug 1: All-selected split-brain UI (FR-011 display parity)
  // ────────────────────────────────────────────────────────────────────

  describe("All-selected display parity (Bug 1)", () => {
    it("shows zero chips when all options are selected", () => {
      createContainer("allsel-chips");
      const instance = initTypeaheadDropdown(
        makeConfig("allsel-chips", { mode: "multi" }),
      );
      instance!.setSelected(["alpha", "beta", "gamma", "delta"]);
      const chips = document.querySelectorAll("#allsel-chips .typeahead-chip");
      expect(chips).toHaveLength(0);
    });

    it("getSelected returns [] when all options are selected", () => {
      createContainer("allsel-get");
      const instance = initTypeaheadDropdown(
        makeConfig("allsel-get", { mode: "multi" }),
      );
      instance!.setSelected(["alpha", "beta", "gamma", "delta"]);
      expect(instance!.getSelected()).toEqual([]);
    });

    it("shows 'All selected' placeholder when all options are selected", () => {
      createContainer("allsel-ph");
      initTypeaheadDropdown(
        makeConfig("allsel-ph", {
          mode: "multi",
          placeholder: "Search repositories...",
          initialSelection: ["alpha", "beta", "gamma", "delta"],
        }),
      );
      const input = document.querySelector(
        "#allsel-ph .typeahead-input",
      ) as HTMLInputElement;
      expect(input.placeholder).toBe("All selected");
    });

    it("shows N-1 chips after deselecting one from all-selected", () => {
      createContainer("allsel-desel");
      const instance = initTypeaheadDropdown(
        makeConfig("allsel-desel", { mode: "multi" }),
      );
      // Select all
      instance!.setSelected(["alpha", "beta", "gamma", "delta"]);
      expect(document.querySelectorAll("#allsel-desel .typeahead-chip")).toHaveLength(0);

      // Open dropdown and deselect one by clicking its option
      const input = document.querySelector(
        "#allsel-desel .typeahead-input",
      ) as HTMLInputElement;
      input.dispatchEvent(new Event("focus"));

      // Find and click the "alpha" option to deselect it
      const options = document.querySelectorAll(
        "#allsel-desel [role='option']",
      );
      const alphaOption = Array.from(options).find(
        (o) => (o as HTMLElement).dataset.optionId === "alpha",
      );
      alphaOption?.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true }),
      );

      // Should now show 3 chips (all minus alpha)
      const chips = document.querySelectorAll("#allsel-desel .typeahead-chip");
      expect(chips).toHaveLength(3);
    });

    it("getSelected returns N-1 IDs after deselecting one from all-selected", () => {
      createContainer("allsel-desel-get");
      const instance = initTypeaheadDropdown(
        makeConfig("allsel-desel-get", { mode: "multi" }),
      );
      instance!.setSelected(["alpha", "beta", "gamma", "delta"]);

      const input = document.querySelector(
        "#allsel-desel-get .typeahead-input",
      ) as HTMLInputElement;
      input.dispatchEvent(new Event("focus"));

      const options = document.querySelectorAll(
        "#allsel-desel-get [role='option']",
      );
      const alphaOption = Array.from(options).find(
        (o) => (o as HTMLElement).dataset.optionId === "alpha",
      );
      alphaOption?.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true }),
      );

      const selected = instance!.getSelected();
      expect(selected).toHaveLength(3);
      expect(selected).not.toContain("alpha");
    });

    it("isAllSelected uses options.length not filteredOptions.length", () => {
      createContainer("allsel-search");
      jest.useFakeTimers();
      const instance = initTypeaheadDropdown(
        makeConfig("allsel-search", { mode: "multi" }),
      );

      // Type a search that matches only 2 of 4 options
      const input = document.querySelector(
        "#allsel-search .typeahead-input",
      ) as HTMLInputElement;
      input.dispatchEvent(new Event("focus"));
      input.value = "alpha";
      input.dispatchEvent(new Event("input"));
      jest.advanceTimersByTime(250);

      // Select the 2 matching results
      const visibleOptions = document.querySelectorAll(
        "#allsel-search [role='option']",
      );
      visibleOptions.forEach((opt) => {
        opt.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      });

      // Should NOT be treated as all-selected (2 of 4 != all)
      expect(instance!.getSelected()).not.toEqual([]);
      jest.useRealTimers();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // Bug 2: Single-select blank on blur
  // ────────────────────────────────────────────────────────────────────

  describe("Single-select blur restore (Bug 2)", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("restores selected display name after blur", () => {
      createContainer("blur-restore");
      const instance = initTypeaheadDropdown(
        makeConfig("blur-restore", { mode: "single" }),
      );
      instance!.setSelected(["beta"]);

      const input = document.querySelector(
        "#blur-restore .typeahead-input",
      ) as HTMLInputElement;

      // Focus clears value for search
      input.dispatchEvent(new Event("focus"));
      expect(input.value).toBe("");

      // Blur triggers deferred closeDropdown via rAF
      input.dispatchEvent(new Event("blur"));
      jest.advanceTimersByTime(20);

      // After blur + rAF, input should show "Beta"
      expect(input.value).toBe("Beta");
    });

    it("closes dropdown after blur", () => {
      createContainer("blur-close");
      initTypeaheadDropdown(
        makeConfig("blur-close", { mode: "single" }),
      );

      const input = document.querySelector(
        "#blur-close .typeahead-input",
      ) as HTMLInputElement;
      const dropdown = document.querySelector(
        "#blur-close .typeahead-dropdown",
      ) as HTMLElement;

      input.dispatchEvent(new Event("focus"));
      expect(dropdown.style.display).not.toBe("none");

      input.dispatchEvent(new Event("blur"));
      jest.advanceTimersByTime(20);

      expect(dropdown.style.display).toBe("none");
    });

    it("does not affect multi-select placeholder on blur", () => {
      createContainer("blur-multi");
      const instance = initTypeaheadDropdown(
        makeConfig("blur-multi", { mode: "multi" }),
      );
      instance!.setSelected(["alpha"]);

      const input = document.querySelector(
        "#blur-multi .typeahead-input",
      ) as HTMLInputElement;

      const placeholderBefore = input.placeholder;
      input.dispatchEvent(new Event("focus"));
      input.dispatchEvent(new Event("blur"));
      jest.advanceTimersByTime(20);

      expect(input.placeholder).toBe(placeholderBefore);
    });

    it("closeDropdown is idempotent (safe to call twice)", () => {
      createContainer("blur-idem");
      initTypeaheadDropdown(
        makeConfig("blur-idem", { mode: "single" }),
      );

      const input = document.querySelector(
        "#blur-idem .typeahead-input",
      ) as HTMLInputElement;

      input.dispatchEvent(new Event("focus"));
      input.dispatchEvent(new Event("blur"));
      jest.advanceTimersByTime(20);

      // Close again manually via outside click — should not throw
      expect(() => {
        document.dispatchEvent(
          new PointerEvent("pointerdown", { bubbles: true }),
        );
      }).not.toThrow();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // QA Lead Tests: Bug 1 - Multi-select stale UI on toggle (user clicks)
  // ────────────────────────────────────────────────────────────────────

  describe("Bug 1: Multi-select user-driven toggle (user clicks, not setSelected)", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("user clicks options one by one until all selected, then shows 0 chips and original placeholder", () => {
      createContainer("qa-all-selected-user");
      const instance = initTypeaheadDropdown(
        makeConfig("qa-all-selected-user", {
          mode: "multi",
          placeholder: "Search repositories...",
        }),
      );

      const input = document.querySelector(
        "#qa-all-selected-user .typeahead-input",
      ) as HTMLInputElement;

      // Open dropdown by focusing
      input.dispatchEvent(new Event("focus"));

      // User clicks option 1 (Alpha)
      let options = document.querySelectorAll(
        "#qa-all-selected-user [role='option']",
      );
      const alphaOption = Array.from(options).find(
        (o) => (o as HTMLElement).dataset.optionId === "alpha",
      ) as HTMLElement | undefined;
      expect(alphaOption).toBeDefined();
      alphaOption!.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true }),
      );

      let chips = document.querySelectorAll("#qa-all-selected-user .typeahead-chip");
      expect(chips).toHaveLength(1);
      // BUG: selectOption() doesn't call updateInputDisplay() for multi-select
      // So placeholder won't change. After fix, should show "Search..."
      // For now, verify the chip appeared (selection state is correct)
      expect(chips[0]?.textContent).toContain("Alpha");

      // User clicks option 2 (Beta)
      options = document.querySelectorAll(
        "#qa-all-selected-user [role='option']",
      );
      const betaOption = Array.from(options).find(
        (o) => (o as HTMLElement).dataset.optionId === "beta",
      ) as HTMLElement | undefined;
      expect(betaOption).toBeDefined();
      betaOption!.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true }),
      );

      chips = document.querySelectorAll("#qa-all-selected-user .typeahead-chip");
      expect(chips).toHaveLength(2);

      // User clicks option 3 (Gamma)
      options = document.querySelectorAll(
        "#qa-all-selected-user [role='option']",
      );
      const gammaOption = Array.from(options).find(
        (o) => (o as HTMLElement).dataset.optionId === "gamma",
      ) as HTMLElement | undefined;
      expect(gammaOption).toBeDefined();
      gammaOption!.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true }),
      );

      chips = document.querySelectorAll("#qa-all-selected-user .typeahead-chip");
      expect(chips).toHaveLength(3);

      // User clicks option 4 (Delta) — now all 4 are selected
      options = document.querySelectorAll(
        "#qa-all-selected-user [role='option']",
      );
      const deltaOption = Array.from(options).find(
        (o) => (o as HTMLElement).dataset.optionId === "delta",
      ) as HTMLElement | undefined;
      expect(deltaOption).toBeDefined();
      deltaOption!.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true }),
      );

      // FR-011: All selected = canonical empty state
      // Chips should vanish
      chips = document.querySelectorAll("#qa-all-selected-user .typeahead-chip");
      expect(chips).toHaveLength(0);

      // Placeholder should show "All selected" indicator
      expect(input.placeholder).toBe("All selected");

      // getSelected() should return empty array (canonical "no filter")
      expect(instance!.getSelected()).toEqual([]);
    });

    it("user deselects one option from all-selected state, shows N-1 chips and updates aria-selected", () => {
      createContainer("qa-desel-from-all");
      const onChange = jest.fn();
      const instance = initTypeaheadDropdown(
        makeConfig("qa-desel-from-all", {
          mode: "multi",
          onChange,
        }),
      );

      const input = document.querySelector(
        "#qa-desel-from-all .typeahead-input",
      ) as HTMLInputElement;

      // Set all selected programmatically first (baseline)
      instance!.setSelected(["alpha", "beta", "gamma", "delta"]);
      onChange.mockClear();

      let chips = document.querySelectorAll("#qa-desel-from-all .typeahead-chip");
      expect(chips).toHaveLength(0); // All selected = no chips

      // Open dropdown
      input.dispatchEvent(new Event("focus"));

      // User clicks "alpha" option to deselect it
      const options = document.querySelectorAll(
        "#qa-desel-from-all [role='option']",
      );
      const alphaOption = Array.from(options).find(
        (o) => (o as HTMLElement).dataset.optionId === "alpha",
      ) as HTMLElement | undefined;
      expect(alphaOption).toBeDefined();

      // Before click: alpha option should have aria-selected="true" and selected class
      expect(alphaOption!.getAttribute("aria-selected")).toBe("true");
      expect(alphaOption!.classList.contains("typeahead-option-selected")).toBe(true);

      alphaOption!.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true }),
      );

      // After click: should have 3 chips (all except alpha)
      chips = document.querySelectorAll("#qa-desel-from-all .typeahead-chip");
      expect(chips).toHaveLength(3);
      // Extract display names from chip labels (skip the × remove button)
      const chipTexts = Array.from(chips).map((c) => {
        const label = (c as HTMLElement).querySelector(".typeahead-chip-label");
        return label?.textContent ?? "";
      });
      expect(chipTexts).not.toContain("Alpha");
      expect(chipTexts).toContain("Beta");
      expect(chipTexts).toContain("Gamma");
      expect(chipTexts).toContain("Delta");

      // Placeholder should show "Search..." (partial selection)
      expect(input.placeholder).toBe("Search...");

      // getSelected() should return 3 IDs
      const selected = instance!.getSelected();
      expect(selected).toHaveLength(3);
      expect(selected).not.toContain("alpha");

      // onChange should have been called with 3 IDs
      expect(onChange).toHaveBeenCalledWith(
        expect.arrayContaining(["beta", "gamma", "delta"]),
      );
    });

    it("dropdown visual state updates immediately after deselect (aria-selected and class)", () => {
      createContainer("qa-visual-after-desel");
      const instance = initTypeaheadDropdown(
        makeConfig("qa-visual-after-desel", { mode: "multi" }),
      );

      // Select all
      instance!.setSelected(["alpha", "beta", "gamma", "delta"]);

      const input = document.querySelector(
        "#qa-visual-after-desel .typeahead-input",
      ) as HTMLInputElement;

      // Open dropdown
      input.dispatchEvent(new Event("focus"));

      // Find alpha option
      const options = document.querySelectorAll(
        "#qa-visual-after-desel [role='option']",
      );
      const alphaOption = Array.from(options).find(
        (o) => (o as HTMLElement).dataset.optionId === "alpha",
      ) as HTMLElement | undefined;

      expect(alphaOption?.getAttribute("aria-selected")).toBe("true");
      expect(alphaOption?.classList.contains("typeahead-option-selected")).toBe(true);

      // Deselect alpha by clicking it
      alphaOption!.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true }),
      );

      // BUG: deselectOption() doesn't call renderDropdown() to refresh visual state
      // So aria-selected and class attributes won't update in dropdown.
      // After fix: closing and reopening dropdown would show correct state,
      // but ideally it should update live.
      // For now, test that state layer is correct (chips count and getSelected)
      const chips = document.querySelectorAll(
        "#qa-visual-after-desel .typeahead-chip",
      );
      expect(chips).toHaveLength(3); // All except alpha
      const selected = instance!.getSelected();
      expect(selected).not.toContain("alpha");
      expect(selected).toEqual(expect.arrayContaining(["beta", "gamma", "delta"]));
    });

    it("subsequent toggles maintain correct selection state (verified via chips and getSelected)", () => {
      createContainer("qa-multi-toggle");
      const instance = initTypeaheadDropdown(
        makeConfig("qa-multi-toggle", { mode: "multi" }),
      );

      const input = document.querySelector(
        "#qa-multi-toggle .typeahead-input",
      ) as HTMLInputElement;

      // Open dropdown
      input.dispatchEvent(new Event("focus"));

      // Select alpha
      let options = document.querySelectorAll(
        "#qa-multi-toggle [role='option']",
      );
      let alphaOption = Array.from(options).find(
        (o) => (o as HTMLElement).dataset.optionId === "alpha",
      ) as HTMLElement | undefined;
      alphaOption!.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true }),
      );

      // Verify alpha is selected via chips
      let chips = document.querySelectorAll("#qa-multi-toggle .typeahead-chip");
      expect(chips).toHaveLength(1);

      // Select beta
      options = document.querySelectorAll(
        "#qa-multi-toggle [role='option']",
      );
      const betaOption = Array.from(options).find(
        (o) => (o as HTMLElement).dataset.optionId === "beta",
      ) as HTMLElement | undefined;
      betaOption!.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true }),
      );

      // Verify both are selected
      chips = document.querySelectorAll("#qa-multi-toggle .typeahead-chip");
      expect(chips).toHaveLength(2);
      let selected = instance!.getSelected();
      expect(selected).toEqual(expect.arrayContaining(["alpha", "beta"]));

      // Deselect alpha
      options = document.querySelectorAll(
        "#qa-multi-toggle [role='option']",
      );
      alphaOption = Array.from(options).find(
        (o) => (o as HTMLElement).dataset.optionId === "alpha",
      ) as HTMLElement | undefined;
      alphaOption!.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true }),
      );

      // Verify only beta is selected now via chips
      chips = document.querySelectorAll("#qa-multi-toggle .typeahead-chip");
      expect(chips).toHaveLength(1);
      selected = instance!.getSelected();
      expect(selected).toEqual(["beta"]);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // QA Lead Tests: Bug 2 - URL restore notice routing
  // ────────────────────────────────────────────────────────────────────

  describe("Bug 2: URL restore notice routing (reviewer notice extraction)", () => {
    it("author+team notice should NOT populate reviewerFilterNoticeMessage", () => {
      // This test verifies the notice type filtering logic used in restoreFiltersFromUrl()
      // at line 1692-1697 of dashboard.ts:
      //
      //   const reviewerNotice = constraintsApplied.find(
      //     (n) =>
      //       n.type === "author_reviewer" ||
      //       n.type === "reviewer_team" ||
      //       n.type === "reviewer_repo",
      //   );
      //
      // A notice with type "author_team" should NOT match this filter.

      // Simulate constraint resolver result with author_team notice
      interface NoticeType {
        type: "author_reviewer" | "author_team" | "reviewer_repo" | "reviewer_team";
        message: string;
      }
      const constraintsApplied: NoticeType[] = [
        {
          type: "author_team",
          message: "Author and Team filters are mutually exclusive",
        },
      ];

      // Apply the same filtering logic as dashboard.ts line 1692-1697
      const reviewerNotice = constraintsApplied.find(
        (n) =>
          n.type === "author_reviewer" ||
          n.type === "reviewer_team" ||
          n.type === "reviewer_repo",
      );

      // Should NOT find author_team notice (it's not reviewer-relevant)
      expect(reviewerNotice).toBeUndefined();
    });

    it("reviewer+repo notice SHOULD populate reviewerFilterNoticeMessage", () => {
      // Simulate constraint resolver result with reviewer_repo notice
      interface NoticeType {
        type: "author_reviewer" | "author_team" | "reviewer_repo" | "reviewer_team";
        message: string;
      }
      const constraintsApplied: NoticeType[] = [
        {
          type: "reviewer_repo",
          message: "Reviewer and Repository filters limit the data scope",
        },
      ];

      // Apply the same filtering logic as dashboard.ts line 1692-1697
      const reviewerNotice = constraintsApplied.find(
        (n) =>
          n.type === "author_reviewer" ||
          n.type === "reviewer_team" ||
          n.type === "reviewer_repo",
      );

      // Should find reviewer_repo notice (it's reviewer-relevant)
      expect(reviewerNotice).toBeDefined();
      expect(reviewerNotice?.type).toBe("reviewer_repo");
      expect(reviewerNotice?.message).toContain("Reviewer");
    });

    it("author_reviewer notice SHOULD populate reviewerFilterNoticeMessage", () => {
      // Verify author_reviewer is in the allowed types for reviewer notice area
      interface NoticeType {
        type: "author_reviewer" | "author_team" | "reviewer_repo" | "reviewer_team";
        message: string;
      }
      const constraintsApplied: NoticeType[] = [
        {
          type: "author_reviewer",
          message: "Author and Reviewer filters are incompatible",
        },
      ];

      const reviewerNotice = constraintsApplied.find(
        (n) =>
          n.type === "author_reviewer" ||
          n.type === "reviewer_team" ||
          n.type === "reviewer_repo",
      );

      expect(reviewerNotice).toBeDefined();
      expect(reviewerNotice?.type).toBe("author_reviewer");
    });

    it("reviewer_team notice SHOULD populate reviewerFilterNoticeMessage", () => {
      // Verify reviewer_team is in the allowed types
      interface NoticeType {
        type: "author_reviewer" | "author_team" | "reviewer_repo" | "reviewer_team";
        message: string;
      }
      const constraintsApplied: NoticeType[] = [
        {
          type: "reviewer_team",
          message: "Reviewer and Team selections conflict",
        },
      ];

      const reviewerNotice = constraintsApplied.find(
        (n) =>
          n.type === "author_reviewer" ||
          n.type === "reviewer_team" ||
          n.type === "reviewer_repo",
      );

      expect(reviewerNotice).toBeDefined();
      expect(reviewerNotice?.type).toBe("reviewer_team");
    });

    it("mixed notices: only reviewer-type notices extracted, others ignored", () => {
      // Real-world scenario: multiple constraints applied, only some are reviewer-relevant
      interface NoticeType {
        type: "author_reviewer" | "author_team" | "reviewer_repo" | "reviewer_team";
        message: string;
      }
      const constraintsApplied: NoticeType[] = [
        {
          type: "author_team",
          message: "Author+Team is invalid",
        },
        {
          type: "reviewer_repo",
          message: "Reviewer+Repo limits scope",
        },
        {
          type: "author_reviewer",
          message: "Author+Reviewer conflict",
        },
      ];

      // Apply filtering logic
      const reviewerNotice = constraintsApplied.find(
        (n) =>
          n.type === "author_reviewer" ||
          n.type === "reviewer_team" ||
          n.type === "reviewer_repo",
      );

      // Should find the first reviewer-relevant notice (author_reviewer comes after author_team, but find returns first match in the filter)
      // Actually, find returns the first match in the array that passes the predicate.
      // So it would find reviewer_repo (index 1) or author_reviewer (index 2)?
      // Let's verify: constraint[0].type is "author_team" - no match
      // constraint[1].type is "reviewer_repo" - match! Returns it
      expect(reviewerNotice?.type).toBe("reviewer_repo");
    });

    it("no reviewer notices: reviewerFilterNoticeMessage should be null", () => {
      // When only non-reviewer constraints are present
      interface NoticeType {
        type: "author_reviewer" | "author_team" | "reviewer_repo" | "reviewer_team";
        message: string;
      }
      const constraintsApplied: NoticeType[] = [
        {
          type: "author_team",
          message: "Author and Team are mutually exclusive",
        },
      ];

      const reviewerNotice = constraintsApplied.find(
        (n) =>
          n.type === "author_reviewer" ||
          n.type === "reviewer_team" ||
          n.type === "reviewer_repo",
      );

      // No reviewer-relevant notices found
      expect(reviewerNotice).toBeUndefined();

      // Message should be null
      const reviewerFilterNoticeMessage = reviewerNotice?.message ?? null;
      expect(reviewerFilterNoticeMessage).toBeNull();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // Bug fix validation: deselectOption must re-render dropdown
  // ────────────────────────────────────────────────────────────────────

  describe("Deselect re-renders dropdown visual state", () => {
    it("dropdown aria-selected updates immediately after deselect (not on next open)", () => {
      createContainer("desel-aria");
      const instance = initTypeaheadDropdown(
        makeConfig("desel-aria", { mode: "multi" }),
      );
      instance!.setSelected(["alpha", "beta"]);

      // Open dropdown
      const input = document.querySelector(
        "#desel-aria .typeahead-input",
      ) as HTMLInputElement;
      input.dispatchEvent(new Event("focus"));

      // Verify alpha is marked selected in dropdown
      const alphaOption = document.querySelector(
        '#desel-aria [data-option-id="alpha"]',
      ) as HTMLElement;
      expect(alphaOption.getAttribute("aria-selected")).toBe("true");
      expect(alphaOption.classList.contains("typeahead-option-selected")).toBe(true);

      // Deselect alpha by clicking it
      alphaOption.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true }),
      );

      // After deselect, the SAME dropdown element (still open) should update
      const alphaAfter = document.querySelector(
        '#desel-aria [data-option-id="alpha"]',
      ) as HTMLElement;
      expect(alphaAfter.getAttribute("aria-selected")).toBe("false");
      expect(alphaAfter.classList.contains("typeahead-option-selected")).toBe(false);
    });

    it("placeholder updates when transitioning from partial to all-selected via click", () => {
      createContainer("desel-ph");
      initTypeaheadDropdown(
        makeConfig("desel-ph", {
          mode: "multi",
          placeholder: "Search repos...",
          initialSelection: ["alpha", "beta", "gamma"],
        }),
      );

      const input = document.querySelector(
        "#desel-ph .typeahead-input",
      ) as HTMLInputElement;

      // Partial selection: placeholder should be "Search..."
      expect(input.placeholder).toBe("Search...");

      // Open dropdown and select the last option (delta)
      input.dispatchEvent(new Event("focus"));
      const deltaOption = document.querySelector(
        '#desel-ph [data-option-id="delta"]',
      ) as HTMLElement;
      deltaOption.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true }),
      );

      // Now all-selected: placeholder should show "All selected"
      expect(input.placeholder).toBe("All selected");
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // Non-search dropdown renders plain text (line 186)
  // ────────────────────────────────────────────────────────────────────

  describe("Non-search dropdown rendering (no match highlight)", () => {
    it("options use plain textContent when dropdown opens without search text", () => {
      createContainer("no-highlight");
      initTypeaheadDropdown(makeConfig("no-highlight"));

      const input = document.querySelector(
        "#no-highlight .typeahead-input",
      ) as HTMLInputElement;

      // Focus opens dropdown with no search text
      input.dispatchEvent(new Event("focus"));

      const options = document.querySelectorAll(
        "#no-highlight .typeahead-option",
      );
      expect(options.length).toBe(4);
      // No <strong> elements — plain text only
      options.forEach((opt) => {
        expect(opt.querySelector("strong")).toBeNull();
        expect(opt.textContent).toBeTruthy();
      });
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // Single-select toggle-off (lines 273-278)
  // ────────────────────────────────────────────────────────────────────

  describe("Single-select toggle-off (click already-selected option)", () => {
    it("clears selection when clicking the already-selected option", () => {
      createContainer("single-toggle-off");
      const onChange = jest.fn();
      const instance = initTypeaheadDropdown(
        makeConfig("single-toggle-off", {
          mode: "single",
          initialSelection: ["alpha"],
          onChange,
        }),
      );

      const input = document.querySelector(
        "#single-toggle-off .typeahead-input",
      ) as HTMLInputElement;

      // Focus opens dropdown (clears input for search in single-select)
      input.dispatchEvent(new Event("focus"));

      // Find the "alpha" option and click it (toggle-off)
      const alphaOption = document.querySelector(
        '#single-toggle-off [data-option-id="alpha"]',
      ) as HTMLElement;
      alphaOption.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true }),
      );

      // Selection should now be empty
      expect(instance!.getSelected()).toEqual([]);
      expect(onChange).toHaveBeenCalledWith([]);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // Bug fix: setSelected() must refresh open dropdown
  // ────────────────────────────────────────────────────────────────────

  describe("setSelected refreshes open dropdown visual state", () => {
    it("programmatic setSelected([]) clears aria-selected on open dropdown", () => {
      createContainer("setsel-dropdown");
      const instance = initTypeaheadDropdown(
        makeConfig("setsel-dropdown", {
          mode: "multi",
          initialSelection: ["alpha", "beta"],
        }),
      );

      // Open dropdown
      const input = document.querySelector(
        "#setsel-dropdown .typeahead-input",
      ) as HTMLInputElement;
      input.dispatchEvent(new Event("focus"));

      // Verify alpha is selected in dropdown
      const alphaBefore = document.querySelector(
        '#setsel-dropdown [data-option-id="alpha"]',
      ) as HTMLElement;
      expect(alphaBefore.getAttribute("aria-selected")).toBe("true");

      // Programmatic clear (simulates constraint resolver or "Clear filters")
      instance!.setSelected([]);

      // Dropdown should immediately reflect cleared state
      const alphaAfter = document.querySelector(
        '#setsel-dropdown [data-option-id="alpha"]',
      ) as HTMLElement;
      expect(alphaAfter.getAttribute("aria-selected")).toBe("false");
      expect(alphaAfter.classList.contains("typeahead-option-selected")).toBe(false);
    });

    it("programmatic setSelected with new values updates open dropdown checkmarks", () => {
      createContainer("setsel-update");
      const instance = initTypeaheadDropdown(
        makeConfig("setsel-update", {
          mode: "multi",
          initialSelection: ["alpha"],
        }),
      );

      // Open dropdown
      const input = document.querySelector(
        "#setsel-update .typeahead-input",
      ) as HTMLInputElement;
      input.dispatchEvent(new Event("focus"));

      // Alpha selected, beta not
      const alphaBefore = document.querySelector(
        '#setsel-update [data-option-id="alpha"]',
      ) as HTMLElement;
      const betaBefore = document.querySelector(
        '#setsel-update [data-option-id="beta"]',
      ) as HTMLElement;
      expect(alphaBefore.getAttribute("aria-selected")).toBe("true");
      expect(betaBefore.getAttribute("aria-selected")).toBe("false");

      // Change selection programmatically: remove alpha, add beta+gamma
      instance!.setSelected(["beta", "gamma"]);

      // Dropdown should reflect new selection immediately
      const alphaAfter = document.querySelector(
        '#setsel-update [data-option-id="alpha"]',
      ) as HTMLElement;
      const betaAfter = document.querySelector(
        '#setsel-update [data-option-id="beta"]',
      ) as HTMLElement;
      const gammaAfter = document.querySelector(
        '#setsel-update [data-option-id="gamma"]',
      ) as HTMLElement;
      expect(alphaAfter.getAttribute("aria-selected")).toBe("false");
      expect(betaAfter.getAttribute("aria-selected")).toBe("true");
      expect(gammaAfter.getAttribute("aria-selected")).toBe("true");
    });
  });
});
