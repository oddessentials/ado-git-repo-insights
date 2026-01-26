/**
 * Tests for getElement accessor function.
 *
 * Verifies typed DOM element access patterns
 * introduced during strict typing remediation.
 */

/**
 * @jest-environment jsdom
 */

// We can't directly test the private getElement function from dashboard.ts,
// but we can verify the pattern works correctly through integration.
// This file documents the expected behavior and validates type safety.

describe("getElement accessor pattern", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="test-div">Test Div</div>
      <input id="test-input" type="text" value="test" />
      <select id="test-select">
        <option value="a">A</option>
        <option value="b">B</option>
      </select>
      <button id="test-button">Click</button>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  // Typed accessor pattern implementation for testing
  function getElement<T extends HTMLElement = HTMLElement>(
    id: string,
  ): T | null {
    const el = document.getElementById(id);
    if (el instanceof HTMLElement) {
      return el as T;
    }
    return null;
  }

  it("returns null for non-existent element", () => {
    const el = getElement("non-existent");
    expect(el).toBeNull();
  });

  it("returns HTMLElement for basic div", () => {
    const el = getElement("test-div");
    expect(el).toBeInstanceOf(HTMLElement);
    expect(el?.textContent).toBe("Test Div");
  });

  it("type narrows to HTMLInputElement", () => {
    const el = getElement<HTMLInputElement>("test-input");
    expect(el).toBeInstanceOf(HTMLInputElement);
    // Type assertion allows accessing .value
    expect(el?.value).toBe("test");
    expect(el?.type).toBe("text");
  });

  it("type narrows to HTMLSelectElement", () => {
    const el = getElement<HTMLSelectElement>("test-select");
    expect(el).toBeInstanceOf(HTMLSelectElement);
    expect(el?.options.length).toBe(2);
  });

  it("type narrows to HTMLButtonElement", () => {
    const el = getElement<HTMLButtonElement>("test-button");
    expect(el).toBeInstanceOf(HTMLButtonElement);
    expect(el?.textContent).toBe("Click");
  });

  it("allows method chaining with optional access", () => {
    const el = getElement("test-button");
    // This should work without type errors
    el?.classList.add("active");
    expect(el?.classList.contains("active")).toBe(true);
  });

  it("handles classList operations safely", () => {
    const el = getElement("non-existent");
    // Optional chaining prevents errors on null
    el?.classList.add("test");
    // Should not throw
    expect(el).toBeNull();
  });
});

describe("DOM cache type safety patterns", () => {
  // Tests demonstrating the DOM cache pattern with optional chaining

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="loading-state" class="hidden"></div>
      <div id="main-content"></div>
      <span id="run-info"></span>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("supports classList toggle pattern", () => {
    const elements: Record<string, HTMLElement | null> = {
      "loading-state": document.getElementById("loading-state"),
      "main-content": document.getElementById("main-content"),
    };

    // Pattern used in dashboard.ts
    elements["loading-state"]?.classList.remove("hidden");
    expect(elements["loading-state"]?.classList.contains("hidden")).toBe(false);
  });

  it("supports textContent assignment pattern", () => {
    const elements: Record<string, HTMLElement | null> = {
      "run-info": document.getElementById("run-info"),
    };

    // Pattern used in updateDatasetInfo
    const runInfo = elements["run-info"];
    if (runInfo) {
      runInfo.textContent = "Generated: 2024-01-01";
    }

    expect(runInfo?.textContent).toBe("Generated: 2024-01-01");
  });

  it("handles missing elements gracefully", () => {
    const elements: Record<string, HTMLElement | null> = {
      "missing-el": null,
    };

    // Should not throw
    elements["missing-el"]?.classList.add("test");
    expect(elements["missing-el"]).toBeNull();
  });
});
