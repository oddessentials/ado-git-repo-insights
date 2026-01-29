/**
 * Setup Guides Module (T060-T067)
 *
 * Provides in-dashboard setup guidance for ML features when data is unavailable.
 * Shows YAML snippets with clipboard copy functionality.
 */

import { escapeHtml, appendTrustedHtml } from "../shared/render";

/**
 * YAML snippet for enabling predictions in ADO pipeline.
 */
const PREDICTIONS_YAML = `build-aggregates:
  run-predictions: true`;

/**
 * YAML snippet for enabling AI insights in ADO pipeline.
 */
const INSIGHTS_YAML = `build-aggregates:
  run-insights: true
  openai-api-key: $(OPENAI_API_KEY)`;

/**
 * Copy text to clipboard with fallback for older browsers.
 * @param text - Text to copy
 * @returns Promise that resolves when copy completes
 */
async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(text);
  } else {
    // Fallback for older browsers or non-HTTPS contexts
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  }
}

/**
 * Create a copy button with feedback animation.
 * Includes WCAG 2.1 AA accessibility attributes.
 * @param yaml - YAML content to copy
 * @param buttonId - Unique ID for the button
 * @returns HTML string for the copy button
 */
function createCopyButton(yaml: string, buttonId: string): string {
  return `
    <button class="copy-yaml-btn" id="${buttonId}" data-yaml="${escapeHtml(yaml)}"
            type="button" aria-label="Copy YAML snippet to clipboard">
      <span class="copy-icon" aria-hidden="true">📋</span>
      <span class="copy-text">Copy</span>
    </button>
  `;
}

/**
 * Attach click handlers to copy buttons.
 * Call this after rendering the guide HTML.
 * Includes WCAG 2.1 AA accessibility (ARIA live announcements).
 * @param container - Container element with copy buttons
 */
export function attachCopyHandlers(container: HTMLElement): void {
  const buttons =
    container.querySelectorAll<HTMLButtonElement>(".copy-yaml-btn");

  // Create or get ARIA live region for announcements
  let liveRegion = document.getElementById("copy-status-live");
  if (!liveRegion) {
    liveRegion = document.createElement("div");
    liveRegion.id = "copy-status-live";
    liveRegion.setAttribute("role", "status");
    liveRegion.setAttribute("aria-live", "polite");
    liveRegion.className = "visually-hidden";
    document.body.appendChild(liveRegion);
  }

  buttons.forEach((button) => {
    button.addEventListener("click", async () => {
      const yaml = button.dataset.yaml;
      if (!yaml) return;

      // Disable button during copy
      button.disabled = true;
      const copyText = button.querySelector(".copy-text");
      const originalText = copyText?.textContent || "Copy";

      try {
        await copyToClipboard(yaml);

        // Show success feedback
        if (copyText) copyText.textContent = "Copied!";
        button.classList.add("copied");
        button.setAttribute("aria-label", "YAML snippet copied to clipboard");

        // Announce to screen readers
        if (liveRegion)
          liveRegion.textContent = "YAML snippet copied to clipboard";

        // Reset after delay
        setTimeout(() => {
          if (copyText) copyText.textContent = originalText;
          button.classList.remove("copied");
          button.disabled = false;
          button.setAttribute("aria-label", "Copy YAML snippet to clipboard");
        }, 2000);
      } catch {
        // Show error feedback
        if (copyText) copyText.textContent = "Failed";
        button.setAttribute("aria-label", "Failed to copy YAML snippet");

        // Announce error to screen readers
        if (liveRegion) liveRegion.textContent = "Failed to copy YAML snippet";

        setTimeout(() => {
          if (copyText) copyText.textContent = originalText;
          button.disabled = false;
          button.setAttribute("aria-label", "Copy YAML snippet to clipboard");
        }, 2000);
      }
    });
  });
}

/**
 * Render predictions setup guide (T061).
 * Shows YAML snippet for enabling predictions with zero-config.
 * @returns HTML string for the predictions setup guide
 */
export function renderPredictionsSetupGuide(): string {
  return `
    <div class="setup-guide predictions-setup">
      <div class="setup-guide-header">
        <span class="setup-icon">📈</span>
        <h4>Enable Predictions</h4>
      </div>
      <p class="setup-description">
        Add time-series forecasting to your pipeline.
        <strong>Zero-config</strong> - no API key required.
      </p>
      <div class="setup-steps">
        <div class="setup-step">
          <span class="step-number">1</span>
          <span class="step-text">Add this to your pipeline YAML:</span>
        </div>
        <div class="yaml-snippet">
          <pre><code>${escapeHtml(PREDICTIONS_YAML)}</code></pre>
          ${createCopyButton(PREDICTIONS_YAML, "copy-predictions-yaml")}
        </div>
        <div class="setup-step">
          <span class="step-number">2</span>
          <span class="step-text">Run your pipeline to generate forecasts</span>
        </div>
      </div>
      <div class="setup-note">
        <span class="note-icon">💡</span>
        <span>Uses NumPy-based linear regression. For Prophet support, install the optional dependency.</span>
      </div>
    </div>
  `;
}

/**
 * Render insights setup guide (T062, T064).
 * Shows step-by-step instructions with cost estimate.
 * @returns HTML string for the insights setup guide
 */
export function renderInsightsSetupGuide(): string {
  return `
    <div class="setup-guide insights-setup">
      <div class="setup-guide-header">
        <span class="setup-icon">🤖</span>
        <h4>Enable AI Insights</h4>
      </div>
      <p class="setup-description">
        Get actionable insights powered by OpenAI.
      </p>
      <div class="cost-estimate">
        <span class="cost-icon">💰</span>
        <span class="cost-text">Estimated cost: <strong>~$0.001-0.01</strong> per pipeline run</span>
      </div>
      <div class="setup-steps">
        <div class="setup-step">
          <span class="step-number">1</span>
          <span class="step-text">Get an OpenAI API key from <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">platform.openai.com</a></span>
        </div>
        <div class="setup-step">
          <span class="step-number">2</span>
          <span class="step-text">Add <code>OPENAI_API_KEY</code> as a secret variable in your ADO pipeline or variable group</span>
        </div>
        <div class="setup-step">
          <span class="step-number">3</span>
          <span class="step-text">Add this to your pipeline YAML:</span>
        </div>
        <div class="yaml-snippet">
          <pre><code>${escapeHtml(INSIGHTS_YAML)}</code></pre>
          ${createCopyButton(INSIGHTS_YAML, "copy-insights-yaml")}
        </div>
        <div class="setup-step">
          <span class="step-number">4</span>
          <span class="step-text">Run your pipeline to generate insights</span>
        </div>
      </div>
      <div class="setup-note">
        <span class="note-icon">🔒</span>
        <span>Your API key is stored securely in ADO and never logged or exposed.</span>
      </div>
    </div>
  `;
}

/**
 * Render predictions empty state with setup guide (T065).
 * @param container - Container element to render into
 */
export function renderPredictionsEmptyWithGuide(container: HTMLElement): void {
  const content = document.createElement("div");
  content.className = "ml-empty-state with-guide";

  appendTrustedHtml(
    content,
    `
    <div class="empty-state-message">
      <h3>No Prediction Data Available</h3>
      <p>Enable predictions in your pipeline to see time-series forecasts.</p>
    </div>
    ${renderPredictionsSetupGuide()}
  `,
  );

  // Hide any existing unavailable message
  const unavailable = container.querySelector(".feature-unavailable");
  if (unavailable) unavailable.classList.add("hidden");

  container.appendChild(content);

  // Attach copy handlers after rendering
  attachCopyHandlers(content);
}

/**
 * Render insights empty state with setup guide (T066).
 * @param container - Container element to render into
 */
export function renderInsightsEmptyWithGuide(container: HTMLElement): void {
  const content = document.createElement("div");
  content.className = "ml-empty-state with-guide";

  appendTrustedHtml(
    content,
    `
    <div class="empty-state-message">
      <h3>No AI Insights Available</h3>
      <p>Enable AI insights in your pipeline to get actionable recommendations.</p>
    </div>
    ${renderInsightsSetupGuide()}
  `,
  );

  // Hide any existing unavailable message
  const unavailable = container.querySelector(".feature-unavailable");
  if (unavailable) unavailable.classList.add("hidden");

  container.appendChild(content);

  // Attach copy handlers after rendering
  attachCopyHandlers(content);
}

/**
 * Get the predictions YAML snippet.
 * @returns YAML snippet for predictions
 */
export function getPredictionsYaml(): string {
  return PREDICTIONS_YAML;
}

/**
 * Get the insights YAML snippet.
 * @returns YAML snippet for insights
 */
export function getInsightsYaml(): string {
  return INSIGHTS_YAML;
}
