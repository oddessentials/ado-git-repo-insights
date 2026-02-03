"use strict";
/**
 * Minimal dashboard stub for broken-docs fixture.
 * This triggers error state when manifest JSON is malformed.
 */
(async function () {
  const loadingState = document.getElementById("loading-state");
  const setupRequired = document.getElementById("setup-required");
  const errorState = document.getElementById("error-state");
  const errorMessage = document.getElementById("error-message");
  const errorTitle = document.getElementById("error-title");
  const mainContent = document.getElementById("main-content");

  function showError(title, message) {
    if (loadingState) loadingState.classList.add("hidden");
    if (mainContent) mainContent.classList.add("hidden");
    if (setupRequired) setupRequired.classList.add("hidden");

    if (errorState) {
      errorState.classList.remove("hidden");
      if (errorTitle) errorTitle.textContent = title;
      if (errorMessage) errorMessage.textContent = message;
    }
  }

  function showSetupRequired(message) {
    if (loadingState) loadingState.classList.add("hidden");
    if (mainContent) mainContent.classList.add("hidden");
    if (errorState) errorState.classList.add("hidden");

    if (setupRequired) {
      setupRequired.classList.remove("hidden");
      const setupMessage = document.getElementById("setup-message");
      if (setupMessage) setupMessage.textContent = message;
    }
  }

  try {
    const basePath = window.DATASET_PATH || "./data";
    const loader = new window.LocalDatasetLoader(basePath);

    // This will fail when JSON is malformed
    await loader.loadManifest();

    // If we get here, manifest loaded successfully (shouldn't happen in broken fixture)
    if (loadingState) loadingState.classList.add("hidden");
    if (mainContent) mainContent.classList.remove("hidden");
  } catch (error) {
    console.error("Dashboard initialization failed:", error);

    // Check if it's a JSON parse error (malformed manifest)
    if (error instanceof SyntaxError || error.message.includes("JSON")) {
      showError(
        "Invalid Dataset",
        "Failed to parse dataset manifest: Invalid JSON format.",
      );
    } else if (
      error.message.includes("404") ||
      error.message.includes("not found")
    ) {
      showSetupRequired(
        "Dataset manifest not found. Please check your data directory.",
      );
    } else {
      showError(
        "Error Loading Dashboard",
        error.message || "An unexpected error occurred.",
      );
    }
  }
})();
