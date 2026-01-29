/**
 * DOM Harness Tests
 *
 * Tests for the shared DOM test harness.
 * Verifies setupDomHarness creates expected elements and teardownDomHarness cleans up.
 *
 * @module tests/harness/dom-harness.test.ts
 */

import {
  setupDomHarness,
  teardownDomHarness,
  isHarnessSetup,
  getElement,
  queryElement,
  waitForDom,
  expectElementText,
  expectElementContainsText,
  expectElementClass,
  expectElementNotClass,
  expectElementVisible,
  expectElementHidden,
  clickElement,
  setInputValue,
  loadManifestFixture,
  loadDimensionsFixture,
  loadRollupFixture,
  loadPredictionsFixture,
  loadLegacyRollupFixture,
  loadAllFixtures,
  createMockResponse,
  createMockErrorResponse,
} from "./dom-harness";

describe("DOM Harness", () => {
  afterEach(() => {
    teardownDomHarness();
  });

  describe("setupDomHarness", () => {
    it("creates default DOM structure", () => {
      setupDomHarness();

      expect(document.getElementById("app")).not.toBeNull();
      expect(document.getElementById("loading-state")).not.toBeNull();
      expect(document.getElementById("main-content")).not.toBeNull();
      expect(document.getElementById("error-panel")).not.toBeNull();
      expect(document.getElementById("date-range")).not.toBeNull();
      expect(document.getElementById("charts-container")).not.toBeNull();
      expect(document.getElementById("filters-container")).not.toBeNull();
      expect(document.getElementById("comparison-banner")).not.toBeNull();
      expect(document.getElementById("export-menu")).not.toBeNull();
    });

    it("sets harnessSetup flag to true", () => {
      expect(isHarnessSetup()).toBe(false);

      setupDomHarness();

      expect(isHarnessSetup()).toBe(true);
    });

    it("applies correct default styles", () => {
      setupDomHarness();

      const mainContent = document.getElementById("main-content");
      const errorPanel = document.getElementById("error-panel");
      const comparisonBanner = document.getElementById("comparison-banner");
      const exportMenu = document.getElementById("export-menu");

      expect(mainContent?.style.display).toBe("none");
      expect(errorPanel?.style.display).toBe("none");
      expect(comparisonBanner?.style.display).toBe("none");
      expect(exportMenu?.style.display).toBe("none");
    });

    it("applies loading class to loading-state", () => {
      setupDomHarness();

      const loadingState = document.getElementById("loading-state");
      expect(loadingState?.classList.contains("loading")).toBe(true);
    });

    it("allows custom DOM structure", () => {
      const customDom = '<div id="custom-element">Custom Content</div>';

      setupDomHarness({ customDom });

      expect(document.getElementById("custom-element")).not.toBeNull();
      expect(document.getElementById("app")).toBeNull();
    });
  });

  describe("teardownDomHarness", () => {
    it("clears document body", () => {
      setupDomHarness();
      expect(document.body.innerHTML).not.toBe("");

      teardownDomHarness();

      expect(document.body.innerHTML).toBe("");
    });

    it("sets harnessSetup flag to false", () => {
      setupDomHarness();
      expect(isHarnessSetup()).toBe(true);

      teardownDomHarness();

      expect(isHarnessSetup()).toBe(false);
    });

    it("can be called multiple times safely", () => {
      setupDomHarness();

      teardownDomHarness();
      teardownDomHarness();
      teardownDomHarness();

      expect(isHarnessSetup()).toBe(false);
      expect(document.body.innerHTML).toBe("");
    });
  });

  describe("getElement", () => {
    beforeEach(() => {
      setupDomHarness();
    });

    it("returns element by ID", () => {
      const element = getElement("app");

      expect(element).not.toBeNull();
      expect(element.id).toBe("app");
    });

    it("throws when element not found", () => {
      expect(() => getElement("nonexistent")).toThrow(
        "Element with id 'nonexistent' not found",
      );
    });

    it("throws helpful message mentioning harness setup", () => {
      expect(() => getElement("missing")).toThrow("Is the DOM harness set up?");
    });

    it("returns element with correct type assertion", () => {
      document.body.innerHTML = '<input id="test-input" type="text" />';

      const input = getElement<HTMLInputElement>("test-input");

      expect(input.type).toBe("text");
    });
  });

  describe("queryElement", () => {
    beforeEach(() => {
      setupDomHarness();
    });

    it("returns element by ID when found", () => {
      const element = queryElement("app");

      expect(element).not.toBeNull();
      expect(element?.id).toBe("app");
    });

    it("returns null when element not found", () => {
      const element = queryElement("nonexistent");

      expect(element).toBeNull();
    });
  });

  describe("waitForDom", () => {
    it("resolves immediately with default delay", async () => {
      const start = Date.now();

      await waitForDom();

      const elapsed = Date.now() - start;
      // Allow generous margin for CI/system variability while still
      // validating "immediate" resolution (vs the 100ms delay test below)
      expect(elapsed).toBeLessThan(100);
    });

    it("resolves after specified delay", async () => {
      const start = Date.now();

      await waitForDom(100);

      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(90);
    });
  });

  describe("expectElementText", () => {
    beforeEach(() => {
      document.body.innerHTML = '<div id="test-element">Hello World</div>';
    });

    afterEach(() => {
      document.body.innerHTML = "";
    });

    it("passes when text matches exactly", () => {
      expect(() =>
        expectElementText("test-element", "Hello World"),
      ).not.toThrow();
    });

    it("fails when text does not match", () => {
      expect(() => expectElementText("test-element", "Different")).toThrow();
    });
  });

  describe("expectElementContainsText", () => {
    beforeEach(() => {
      document.body.innerHTML = '<div id="test-element">Hello World</div>';
    });

    afterEach(() => {
      document.body.innerHTML = "";
    });

    it("passes when element contains text", () => {
      expect(() =>
        expectElementContainsText("test-element", "World"),
      ).not.toThrow();
    });

    it("fails when element does not contain text", () => {
      expect(() =>
        expectElementContainsText("test-element", "Missing"),
      ).toThrow();
    });
  });

  describe("expectElementClass", () => {
    beforeEach(() => {
      document.body.innerHTML =
        '<div id="test-element" class="active visible"></div>';
    });

    afterEach(() => {
      document.body.innerHTML = "";
    });

    it("passes when element has class", () => {
      expect(() => expectElementClass("test-element", "active")).not.toThrow();
    });

    it("fails when element does not have class", () => {
      expect(() => expectElementClass("test-element", "hidden")).toThrow();
    });
  });

  describe("expectElementNotClass", () => {
    beforeEach(() => {
      document.body.innerHTML = '<div id="test-element" class="active"></div>';
    });

    afterEach(() => {
      document.body.innerHTML = "";
    });

    it("passes when element does not have class", () => {
      expect(() =>
        expectElementNotClass("test-element", "hidden"),
      ).not.toThrow();
    });

    it("fails when element has class", () => {
      expect(() => expectElementNotClass("test-element", "active")).toThrow();
    });
  });

  describe("expectElementVisible", () => {
    beforeEach(() => {
      document.body.innerHTML = `
        <div id="visible-element" style="display: block;"></div>
        <div id="hidden-element" style="display: none;"></div>
      `;
    });

    afterEach(() => {
      document.body.innerHTML = "";
    });

    it("passes when element is visible", () => {
      expect(() => expectElementVisible("visible-element")).not.toThrow();
    });

    it("fails when element is hidden", () => {
      expect(() => expectElementVisible("hidden-element")).toThrow();
    });
  });

  describe("expectElementHidden", () => {
    beforeEach(() => {
      document.body.innerHTML = `
        <div id="visible-element" style="display: block;"></div>
        <div id="hidden-element" style="display: none;"></div>
      `;
    });

    afterEach(() => {
      document.body.innerHTML = "";
    });

    it("passes when element is hidden", () => {
      expect(() => expectElementHidden("hidden-element")).not.toThrow();
    });

    it("fails when element is visible", () => {
      expect(() => expectElementHidden("visible-element")).toThrow();
    });
  });

  describe("clickElement", () => {
    it("triggers click event on element", () => {
      let clicked = false;
      document.body.innerHTML = '<button id="test-button">Click Me</button>';
      const button = document.getElementById("test-button");
      button?.addEventListener("click", () => {
        clicked = true;
      });

      clickElement("test-button");

      expect(clicked).toBe(true);
    });
  });

  describe("setInputValue", () => {
    it("sets input value and dispatches change event", () => {
      let changeValue = "";
      document.body.innerHTML = '<input id="test-input" type="text" />';
      const input = document.getElementById("test-input") as HTMLInputElement;
      input.addEventListener("change", () => {
        changeValue = input.value;
      });

      setInputValue("test-input", "test-value");

      expect(input.value).toBe("test-value");
      expect(changeValue).toBe("test-value");
    });
  });

  describe("loadManifestFixture", () => {
    it("loads default manifest fixture", () => {
      const manifest = loadManifestFixture();

      expect(manifest).not.toBeNull();
      expect(manifest).toHaveProperty("manifest_schema_version");
    });

    it("loads extension-artifacts manifest fixture", () => {
      const manifest = loadManifestFixture("extension-artifacts");

      expect(manifest).not.toBeNull();
      expect(manifest).toHaveProperty("manifest_schema_version");
      expect(manifest).toHaveProperty("aggregate_index");
    });
  });

  describe("loadDimensionsFixture", () => {
    it("loads default dimensions fixture", () => {
      const dimensions = loadDimensionsFixture();

      expect(dimensions).not.toBeNull();
      expect(dimensions).toHaveProperty("repositories");
      expect(dimensions).toHaveProperty("users");
    });
  });

  describe("loadRollupFixture", () => {
    it("loads default rollup fixture", () => {
      const rollup = loadRollupFixture();

      expect(rollup).not.toBeNull();
      expect(rollup).toHaveProperty("week");
      expect(rollup).toHaveProperty("pr_count");
    });

    it("loads specific week rollup fixture", () => {
      const rollup = loadRollupFixture("2026-W03");

      expect(rollup).not.toBeNull();
      expect(rollup).toHaveProperty("week");
    });
  });

  describe("loadPredictionsFixture", () => {
    it("loads default predictions fixture", () => {
      const predictions = loadPredictionsFixture();

      expect(predictions).not.toBeNull();
      expect(predictions).toHaveProperty("forecasts");
      expect(predictions).toHaveProperty("generated_at");
    });
  });

  describe("loadLegacyRollupFixture", () => {
    it("loads v1.0 legacy rollup", () => {
      const rollup = loadLegacyRollupFixture("v1.0");

      expect(rollup).not.toBeNull();
    });

    it("loads v1.1 legacy rollup", () => {
      const rollup = loadLegacyRollupFixture("v1.1");

      expect(rollup).not.toBeNull();
    });

    it("loads v1.2 legacy rollup", () => {
      const rollup = loadLegacyRollupFixture("v1.2");

      expect(rollup).not.toBeNull();
    });
  });

  describe("loadAllFixtures", () => {
    it("loads all fixtures as a bundle", () => {
      const fixtures = loadAllFixtures();

      expect(fixtures).toHaveProperty("manifest");
      expect(fixtures).toHaveProperty("dimensions");
      expect(fixtures).toHaveProperty("rollup");
      expect(fixtures).toHaveProperty("predictions");
      expect(fixtures).toHaveProperty("legacyRollups");

      // Check legacy rollups are loaded
      const legacyRollups = fixtures.legacyRollups;
      expect(legacyRollups).toBeDefined();
      expect(legacyRollups?.["v1.0"]).toBeDefined();
      expect(legacyRollups?.["v1.1"]).toBeDefined();
      expect(legacyRollups?.["v1.2"]).toBeDefined();
    });
  });

  describe("createMockResponse", () => {
    it("creates successful mock response", async () => {
      const data = { test: "value" };
      const response = createMockResponse(data);

      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(data);
    });

    it("creates mock response with custom status", async () => {
      const data = { test: "value" };
      const response = createMockResponse(data, {
        status: 201,
        statusText: "Created",
      });

      expect(response.ok).toBe(true);
      expect(response.status).toBe(201);
      expect(response.statusText).toBe("Created");
    });
  });

  describe("createMockErrorResponse", () => {
    it("creates error response", () => {
      const response = createMockErrorResponse(404, "Not Found");

      expect(response.ok).toBe(false);
      expect(response.status).toBe(404);
      expect(response.statusText).toBe("Not Found");
    });

    it("rejects json() call", async () => {
      const response = createMockErrorResponse(500, "Internal Server Error");

      await expect(response.json()).rejects.toThrow("HTTP 500");
    });
  });
});
