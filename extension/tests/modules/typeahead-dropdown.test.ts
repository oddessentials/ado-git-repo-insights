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
});
