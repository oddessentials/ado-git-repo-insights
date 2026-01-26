/**
 * Error handling and panel display module.
 *
 * INVARIANT: Element IDs, message text, and behavior must match exactly
 * to preserve user-facing diagnostics and existing test expectations.
 */

import {
  PrInsightsError,
  ErrorTypes,
  type SetupRequiredDetails,
  type MultiplePipelinesDetails,
  type ArtifactsMissingDetails,
  type PipelineMatch,
} from "../error-types";
import { getErrorMessage } from "../types";
import {
  escapeHtml,
  clearElement,
  createElement,
  renderTrustedHtml,
} from "./shared/render";

/**
 * Panel IDs for error and setup states.
 * INVARIANT: These must match index.html element IDs exactly.
 */
const PANEL_IDS = [
  "setup-required",
  "multiple-pipelines",
  "artifacts-missing",
  "permission-denied",
  "error-state",
  "loading-state",
  "main-content",
] as const;

/**
 * Handle errors with appropriate UI panels.
 */
export function handleError(error: unknown): void {
  hideAllPanels();

  if (error instanceof PrInsightsError) {
    switch (error.type) {
      case ErrorTypes.SETUP_REQUIRED:
        showSetupRequired(error);
        break;
      case ErrorTypes.MULTIPLE_PIPELINES:
        showMultiplePipelines(error);
        break;
      case ErrorTypes.ARTIFACTS_MISSING:
        showArtifactsMissing(error);
        break;
      case ErrorTypes.PERMISSION_DENIED:
        showPermissionDenied(error);
        break;
      default:
        showGenericError(error.title, error.message);
        break;
    }
  } else {
    showGenericError(
      "Error",
      getErrorMessage(error) || "An unexpected error occurred",
    );
  }
}

/**
 * Hide all error/setup panels.
 */
export function hideAllPanels(): void {
  PANEL_IDS.forEach((id) => {
    document.getElementById(id)?.classList.add("hidden");
  });
}

/**
 * Show setup required panel.
 * INVARIANT: Element IDs must match: setup-required, setup-message, setup-steps, docs-link
 */
export function showSetupRequired(error: PrInsightsError): void {
  const panel = document.getElementById("setup-required");
  if (!panel) return showGenericError(error.title, error.message);

  const messageEl = document.getElementById("setup-message");
  if (messageEl) messageEl.textContent = error.message;

  const details = error.details as SetupRequiredDetails;
  if (details?.instructions && Array.isArray(details.instructions)) {
    const stepsList = document.getElementById("setup-steps");
    if (stepsList) {
      // SECURITY: Use safe DOM construction for list items
      clearElement(stepsList);
      details.instructions.forEach((s: string) => {
        const li = createElement("li", {}, s);
        stepsList.appendChild(li);
      });
    }
  }

  if (details?.docsUrl) {
    const docsLink = document.getElementById(
      "docs-link",
    ) as HTMLAnchorElement | null;
    if (docsLink) docsLink.href = String(details.docsUrl);
  }

  panel.classList.remove("hidden");
}

/**
 * Show multiple pipelines panel.
 * INVARIANT: Element IDs must match: multiple-pipelines, multiple-message, pipeline-list
 */
export function showMultiplePipelines(error: PrInsightsError): void {
  const panel = document.getElementById("multiple-pipelines");
  if (!panel) return showGenericError(error.title, error.message);

  const messageEl = document.getElementById("multiple-message");
  if (messageEl) messageEl.textContent = error.message;

  const listEl = document.getElementById("pipeline-list");
  const details = error.details as MultiplePipelinesDetails;
  if (listEl && details?.matches && Array.isArray(details.matches)) {
    // SECURITY: Escape pipeline names to prevent XSS
    const html = details.matches
      .map(
        (m: PipelineMatch) => `
                <a href="?pipelineId=${escapeHtml(String(m.id))}" class="pipeline-option">
                    <strong>${escapeHtml(m.name)}</strong>
                    <span class="pipeline-id">ID: ${escapeHtml(String(m.id))}</span>
                </a>
            `,
      )
      .join("");
    renderTrustedHtml(listEl, html);
  }

  panel.classList.remove("hidden");
}

/**
 * Show permission denied panel.
 * INVARIANT: Element IDs must match: permission-denied, permission-message
 */
export function showPermissionDenied(error: PrInsightsError): void {
  const panel = document.getElementById("permission-denied");
  if (!panel) return showGenericError(error.title, error.message);

  const messageEl = document.getElementById("permission-message");
  if (messageEl) messageEl.textContent = error.message;

  panel.classList.remove("hidden");
}

/**
 * Show generic error state.
 * INVARIANT: Element IDs must match: error-state, error-title, error-message
 */
export function showGenericError(title: string, message: string): void {
  const panel = document.getElementById("error-state");
  if (!panel) return;

  const titleEl = document.getElementById("error-title");
  const messageEl = document.getElementById("error-message");

  if (titleEl) titleEl.textContent = title;
  if (messageEl) messageEl.textContent = message;

  panel.classList.remove("hidden");
}

/**
 * Show artifacts missing panel.
 * INVARIANT: Element IDs must match: artifacts-missing, missing-message, missing-steps
 */
export function showArtifactsMissing(error: PrInsightsError): void {
  const panel = document.getElementById("artifacts-missing");
  if (!panel) return showGenericError(error.title, error.message);

  const messageEl = document.getElementById("missing-message");
  if (messageEl) messageEl.textContent = error.message;

  const details = error.details as ArtifactsMissingDetails;
  if (details?.instructions && Array.isArray(details.instructions)) {
    const stepsList = document.getElementById("missing-steps");
    if (stepsList) {
      // SECURITY: Use safe DOM construction for list items
      clearElement(stepsList);
      details.instructions.forEach((s: string) => {
        const li = createElement("li", {}, s);
        stepsList.appendChild(li);
      });
    }
  }

  panel.classList.remove("hidden");
}

/**
 * Show loading state.
 */
export function showLoading(): void {
  document.getElementById("loading-state")?.classList.remove("hidden");
  document.getElementById("main-content")?.classList.add("hidden");
}

/**
 * Show main content.
 */
export function showContent(): void {
  document.getElementById("loading-state")?.classList.add("hidden");
  document.getElementById("main-content")?.classList.remove("hidden");
}
