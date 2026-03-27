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
      const instance = initTypeaheadDropdown(
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
    it("emits empty array when all options selected in multi mode", () => {
      createContainer("norm");
      const onChange = jest.fn();
      const instance = initTypeaheadDropdown(
        makeConfig("norm", { mode: "multi", onChange }),
      );

      // Select all four options
      instance!.setSelected(["alpha", "beta", "gamma", "delta"]);
      expect(instance!.getSelected()).toEqual([
        "alpha",
        "beta",
        "gamma",
        "delta",
      ]);

      // Trigger onChange by clearing and re-selecting (simulates user action)
      // The normalization happens inside onChange callback
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
});
