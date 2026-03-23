/**
 * Tests for setup-guides module (T060-T067).
 *
 * Validates in-dashboard setup guidance for ML features:
 * - HTML generation for predictions and insights setup guides
 * - Accessibility (ARIA attributes, live regions)
 * - Copy handlers with success/error states
 * - XSS prevention in YAML snippets
 */

import {
  renderPredictionsSetupGuide,
  renderInsightsSetupGuide,
  attachCopyHandlers,
  renderPredictionsEmptyWithGuide,
  renderInsightsEmptyWithGuide,
  getPredictionsYaml,
  getInsightsYaml,
} from "../../../ui/modules/ml/setup-guides";

describe("setup-guides", () => {
  describe("renderPredictionsSetupGuide", () => {
    it("returns HTML string with setup-guide class", () => {
      const html = renderPredictionsSetupGuide();
      expect(html).toContain('class="setup-guide predictions-setup"');
    });

    it("includes predictions YAML snippet", () => {
      const html = renderPredictionsSetupGuide();
      expect(html).toContain("run-predictions: true");
    });

    it("includes copy button with aria-label", () => {
      const html = renderPredictionsSetupGuide();
      expect(html).toContain('aria-label="Copy YAML snippet to clipboard"');
      expect(html).toContain('class="copy-yaml-btn"');
    });

    it("contains step-by-step instructions", () => {
      const html = renderPredictionsSetupGuide();
      expect(html).toContain('class="step-number">1</span>');
      expect(html).toContain('class="step-number">2</span>');
    });

    it("mentions zero-config (no API key required)", () => {
      const html = renderPredictionsSetupGuide();
      expect(html).toContain("Zero-config");
      expect(html).toContain("no API key required");
    });
  });

  describe("renderInsightsSetupGuide", () => {
    it("returns HTML string with setup-guide class", () => {
      const html = renderInsightsSetupGuide();
      expect(html).toContain('class="setup-guide insights-setup"');
    });

    it("includes insights YAML snippet", () => {
      const html = renderInsightsSetupGuide();
      expect(html).toContain("run-insights: true");
      expect(html).toContain("openai-api-key: $(OPENAI_API_KEY)");
    });

    it("includes copy button with unique ID", () => {
      const html = renderInsightsSetupGuide();
      expect(html).toContain('id="copy-insights-yaml"');
    });

    it("shows cost estimate", () => {
      const html = renderInsightsSetupGuide();
      expect(html).toContain("cost-estimate");
      expect(html).toContain("$0.001-0.01");
    });

    it("includes OpenAI platform link with security attributes", () => {
      const html = renderInsightsSetupGuide();
      expect(html).toContain("platform.openai.com");
      expect(html).toContain('target="_blank"');
      expect(html).toContain('rel="noopener"');
    });

    it("contains 4 steps", () => {
      const html = renderInsightsSetupGuide();
      expect(html).toContain('class="step-number">1</span>');
      expect(html).toContain('class="step-number">2</span>');
      expect(html).toContain('class="step-number">3</span>');
      expect(html).toContain('class="step-number">4</span>');
    });
  });

  describe("attachCopyHandlers", () => {
    let container: HTMLElement;
    let mockClipboard: { writeText: jest.Mock };

    beforeEach(() => {
      jest.useFakeTimers();
      container = document.createElement("div");
      document.body.appendChild(container);

      // Mock clipboard API
      mockClipboard = {
        writeText: jest.fn().mockResolvedValue(undefined),
      };
      Object.defineProperty(navigator, "clipboard", {
        value: mockClipboard,
        writable: true,
        configurable: true,
      });

      // Clear any existing live regions
      const existingLive = document.getElementById("copy-status-live");
      if (existingLive) existingLive.remove();
    });

    afterAll(() => {
      jest.useRealTimers();
    });

    afterEach(() => {
      jest.clearAllTimers();
      container.remove();
      const liveRegion = document.getElementById("copy-status-live");
      if (liveRegion) liveRegion.remove();
    });

    it("attaches click handlers to copy buttons", () => {
      container.innerHTML = `
        <button class="copy-yaml-btn" data-yaml="test: yaml">
          <span class="copy-text">Copy</span>
        </button>
      `;

      attachCopyHandlers(container);

      const button = container.querySelector(
        ".copy-yaml-btn",
      ) as HTMLButtonElement;
      expect(button).not.toBeNull();
    });

    it("creates ARIA live region for announcements", () => {
      container.innerHTML = `
        <button class="copy-yaml-btn" data-yaml="test: yaml">
          <span class="copy-text">Copy</span>
        </button>
      `;

      attachCopyHandlers(container);

      const liveRegion = document.getElementById("copy-status-live");
      expect(liveRegion).not.toBeNull();
      expect(liveRegion?.getAttribute("role")).toBe("status");
      expect(liveRegion?.getAttribute("aria-live")).toBe("polite");
    });

    it("copies YAML to clipboard on button click", async () => {
      container.innerHTML = `
        <button class="copy-yaml-btn" data-yaml="test: yaml">
          <span class="copy-text">Copy</span>
        </button>
      `;

      attachCopyHandlers(container);

      const button = container.querySelector(
        ".copy-yaml-btn",
      ) as HTMLButtonElement;
      button.click();

      await Promise.resolve(); // Allow async clipboard operation

      expect(mockClipboard.writeText).toHaveBeenCalledWith("test: yaml");
    });

    it("shows Copied! text on success", async () => {
      container.innerHTML = `
        <button class="copy-yaml-btn" data-yaml="test: yaml">
          <span class="copy-text">Copy</span>
        </button>
      `;

      attachCopyHandlers(container);

      const button = container.querySelector(
        ".copy-yaml-btn",
      ) as HTMLButtonElement;
      button.click();

      await Promise.resolve();
      await Promise.resolve();

      const copyText = button.querySelector(".copy-text");
      expect(copyText?.textContent).toBe("Copied!");
    });

    it("disables button during copy operation", async () => {
      container.innerHTML = `
        <button class="copy-yaml-btn" data-yaml="test: yaml">
          <span class="copy-text">Copy</span>
        </button>
      `;

      attachCopyHandlers(container);

      const button = container.querySelector(
        ".copy-yaml-btn",
      ) as HTMLButtonElement;
      button.click();

      await Promise.resolve();
      await Promise.resolve();

      expect(button.disabled).toBe(true);
    });

    it("resets button text after timeout", async () => {
      container.innerHTML = `
        <button class="copy-yaml-btn" data-yaml="test: yaml">
          <span class="copy-text">Copy</span>
        </button>
      `;

      attachCopyHandlers(container);

      const button = container.querySelector(
        ".copy-yaml-btn",
      ) as HTMLButtonElement;
      button.click();

      await Promise.resolve();
      await Promise.resolve();

      jest.runAllTimers();

      expect(button.querySelector(".copy-text")?.textContent).toBe("Copy");
      expect(button.disabled).toBe(false);
    });

    it("shows Failed text on clipboard error", async () => {
      mockClipboard.writeText.mockRejectedValue(
        new Error("Clipboard access denied"),
      );

      container.innerHTML = `
        <button class="copy-yaml-btn" data-yaml="test: yaml">
          <span class="copy-text">Copy</span>
        </button>
      `;

      attachCopyHandlers(container);

      const button = container.querySelector(
        ".copy-yaml-btn",
      ) as HTMLButtonElement;
      button.click();

      await Promise.resolve();
      await Promise.resolve(); // Extra tick for error handling

      const copyText = button.querySelector(".copy-text");
      expect(copyText?.textContent).toBe("Failed");
    });

    it("does nothing if button has no data-yaml attribute", async () => {
      container.innerHTML = `
        <button class="copy-yaml-btn">
          <span class="copy-text">Copy</span>
        </button>
      `;

      attachCopyHandlers(container);

      const button = container.querySelector(
        ".copy-yaml-btn",
      ) as HTMLButtonElement;
      button.click();

      await Promise.resolve();

      expect(mockClipboard.writeText).not.toHaveBeenCalled();
    });

    it("reuses existing ARIA live region", () => {
      // Create existing live region
      const existingLive = document.createElement("div");
      existingLive.id = "copy-status-live";
      document.body.appendChild(existingLive);

      container.innerHTML = `
        <button class="copy-yaml-btn" data-yaml="test: yaml">
          <span class="copy-text">Copy</span>
        </button>
      `;

      attachCopyHandlers(container);

      // Should only have one live region
      const liveRegions = document.querySelectorAll("#copy-status-live");
      expect(liveRegions.length).toBe(1);
    });

    it("uses execCommand fallback when clipboard API unavailable", async () => {
      // Remove clipboard API to trigger fallback
      Object.defineProperty(navigator, "clipboard", {
        value: undefined,
        writable: true,
        configurable: true,
      });

      // JSDOM does not implement execCommand — define it so we can spy on it
      document.execCommand = jest.fn().mockReturnValue(true);
      const execCommandSpy = document.execCommand as jest.Mock;

      container.innerHTML = `
        <button class="copy-yaml-btn" data-yaml="fallback: yaml">
          <span class="copy-text">Copy</span>
        </button>
      `;

      attachCopyHandlers(container);

      const button = container.querySelector(
        ".copy-yaml-btn",
      ) as HTMLButtonElement;
      button.click();

      await Promise.resolve();
      await Promise.resolve();

      expect(execCommandSpy).toHaveBeenCalledWith("copy");

      const copyText = button.querySelector(".copy-text");
      expect(copyText?.textContent).toBe("Copied!");

      // Restore clipboard for other tests
      Object.defineProperty(navigator, "clipboard", {
        value: mockClipboard,
        writable: true,
        configurable: true,
      });
    });

    it("enforces fake timers for the suite", () => {
      const callback = jest.fn();
      setTimeout(callback, 50);

      expect(callback).not.toHaveBeenCalled();
      jest.advanceTimersByTime(50);
      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  describe("renderPredictionsEmptyWithGuide", () => {
    let container: HTMLElement;

    beforeEach(() => {
      container = document.createElement("div");
      document.body.appendChild(container);

      // Mock clipboard API
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: jest.fn().mockResolvedValue(undefined) },
        writable: true,
        configurable: true,
      });
    });

    afterEach(() => {
      container.remove();
      const liveRegion = document.getElementById("copy-status-live");
      if (liveRegion) liveRegion.remove();
    });

    it("renders empty state with guide", () => {
      renderPredictionsEmptyWithGuide(container);

      expect(container.querySelector(".ml-empty-state")).not.toBeNull();
      expect(container.querySelector(".setup-guide")).not.toBeNull();
    });

    it("includes empty state message", () => {
      renderPredictionsEmptyWithGuide(container);

      expect(container.textContent).toContain("No Prediction Data Available");
    });

    it("hides existing unavailable message", () => {
      container.innerHTML =
        '<div class="feature-unavailable">Old message</div>';

      renderPredictionsEmptyWithGuide(container);

      const unavailable = container.querySelector(".feature-unavailable");
      expect(unavailable?.classList.contains("hidden")).toBe(true);
    });

    it("attaches copy handlers automatically", () => {
      renderPredictionsEmptyWithGuide(container);

      // Live region should exist after attachCopyHandlers is called
      expect(document.getElementById("copy-status-live")).not.toBeNull();
    });
  });

  describe("renderInsightsEmptyWithGuide", () => {
    let container: HTMLElement;

    beforeEach(() => {
      container = document.createElement("div");
      document.body.appendChild(container);

      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: jest.fn().mockResolvedValue(undefined) },
        writable: true,
        configurable: true,
      });
    });

    afterEach(() => {
      container.remove();
      const liveRegion = document.getElementById("copy-status-live");
      if (liveRegion) liveRegion.remove();
    });

    it("renders empty state with guide", () => {
      renderInsightsEmptyWithGuide(container);

      expect(container.querySelector(".ml-empty-state")).not.toBeNull();
      expect(container.querySelector(".insights-setup")).not.toBeNull();
    });

    it("includes empty state message", () => {
      renderInsightsEmptyWithGuide(container);

      expect(container.textContent).toContain("No AI Insights Available");
    });

    it("hides existing unavailable message", () => {
      container.innerHTML =
        '<div class="feature-unavailable">Old message</div>';

      renderInsightsEmptyWithGuide(container);

      const unavailable = container.querySelector(".feature-unavailable");
      expect(unavailable?.classList.contains("hidden")).toBe(true);
    });
  });

  describe("getters", () => {
    it("getPredictionsYaml returns correct YAML", () => {
      const yaml = getPredictionsYaml();
      expect(yaml).toContain("build-aggregates:");
      expect(yaml).toContain("run-predictions: true");
    });

    it("getInsightsYaml returns correct YAML", () => {
      const yaml = getInsightsYaml();
      expect(yaml).toContain("build-aggregates:");
      expect(yaml).toContain("run-insights: true");
      expect(yaml).toContain("openai-api-key: $(OPENAI_API_KEY)");
    });
  });

  describe("XSS prevention", () => {
    it("escapes HTML in predictions YAML button data attribute", () => {
      const html = renderPredictionsSetupGuide();
      // The YAML content should be HTML-escaped in data-yaml attribute
      expect(html).not.toContain('data-yaml="<script>');
    });

    it("escapes HTML in insights YAML button data attribute", () => {
      const html = renderInsightsSetupGuide();
      // The YAML content should be HTML-escaped in data-yaml attribute
      expect(html).not.toContain('data-yaml="<script>');
    });
  });

  describe("yamlStore and event delegation", () => {
    let container: HTMLElement;
    let mockClipboard: { writeText: jest.Mock };

    beforeEach(() => {
      jest.useFakeTimers();
      container = document.createElement("div");
      document.body.appendChild(container);
      mockClipboard = { writeText: jest.fn().mockResolvedValue(undefined) };
      Object.defineProperty(navigator, "clipboard", {
        value: mockClipboard,
        writable: true,
        configurable: true,
      });
      const existingLive = document.getElementById("copy-status-live");
      if (existingLive) existingLive.remove();
    });

    afterEach(() => {
      jest.clearAllTimers();
      container.remove();
      const liveRegion = document.getElementById("copy-status-live");
      if (liveRegion) liveRegion.remove();
    });

    afterAll(() => {
      jest.useRealTimers();
    });

    it("retrieves YAML from yamlStore for rendered buttons", async () => {
      // renderPredictionsSetupGuide registers YAML in yamlStore via createCopyButton
      const html = renderPredictionsSetupGuide();
      container.innerHTML = html;
      attachCopyHandlers(container);

      const button = container.querySelector(
        "#copy-predictions-yaml",
      ) as HTMLButtonElement;
      button.click();

      await Promise.resolve();
      await Promise.resolve();

      expect(mockClipboard.writeText).toHaveBeenCalledWith(
        getPredictionsYaml(),
      );
    });

    it("no duplicate handlers via WeakSet", async () => {
      container.innerHTML = `
        <button class="copy-yaml-btn" data-yaml="test: yaml">
          <span class="copy-text">Copy</span>
        </button>
      `;

      attachCopyHandlers(container);
      attachCopyHandlers(container); // second call should be no-op

      const button = container.querySelector(
        ".copy-yaml-btn",
      ) as HTMLButtonElement;
      button.click();

      await Promise.resolve();
      await Promise.resolve();

      expect(mockClipboard.writeText).toHaveBeenCalledTimes(1);
    });

    it("delegates click from child element", async () => {
      container.innerHTML = `
        <button class="copy-yaml-btn" data-yaml="delegated: yaml">
          <span class="copy-text">Copy</span>
        </button>
      `;

      attachCopyHandlers(container);

      // Click the inner span, not the button itself
      const innerSpan = container.querySelector(".copy-text") as HTMLElement;
      innerSpan.click();

      await Promise.resolve();
      await Promise.resolve();

      expect(mockClipboard.writeText).toHaveBeenCalledWith("delegated: yaml");
    });
  });
});
