"use strict";
/**
 * PR Insights Settings Page
 *
 * Allows users to configure:
 * - Source project (for cross-project access)
 * - Pipeline definition ID
 *
 * Settings are user-scoped (not project-scoped) for privacy.
 *
 * Project selection uses graceful degradation:
 * - Shows dropdown when vso.project scope allows listing projects
 * - Falls back to text input when listing isn't available
 */
// Settings keys (must match dashboard.js)
const SETTINGS_KEY_PROJECT = "pr-insights-source-project";
const SETTINGS_KEY_PIPELINE = "pr-insights-pipeline-id";
// State
let dataService = null;
let projectDropdownAvailable = false;
let projectList = [];
/**
 * Initialize Azure DevOps Extension SDK.
 */
async function initializeAdoSdk() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Azure DevOps SDK initialization timed out"));
    }, 10000);
    VSS.init({
      explicitNotifyLoaded: true,
      usePlatformScripts: true,
      usePlatformStyles: true,
    });
    VSS.ready(() => {
      clearTimeout(timeout);
      VSS.notifyLoadSucceeded();
      resolve();
    });
  });
}
/**
 * Initialize the settings page.
 */
async function init() {
  try {
    await initializeAdoSdk();
    // Get extension data service
    dataService = await VSS.getService(VSS.ServiceIds.ExtensionData);
    // Set current project as placeholder
    const webContext = VSS.getWebContext();
    const projectInput = document.getElementById("project-id");
    if (projectInput && webContext?.project?.name) {
      projectInput.placeholder = `Current: ${webContext.project.name}`;
    }
    // Try to load project dropdown
    await tryLoadProjectDropdown();
    // Load saved settings
    await loadSettings();
    // Update status display
    await updateStatus();
    // Set up event listeners
    setupEventListeners();
  } catch (error) {
    console.error("Settings initialization failed:", error);
    showStatus("Failed to initialize settings: " + error.message, "error");
  }
}
/**
 * Try to load project dropdown. Degrades gracefully to text input.
 */
async function tryLoadProjectDropdown() {
  const dropdown = document.getElementById("project-select");
  const textInput = document.getElementById("project-id");
  try {
    // Get projects using Core REST client
    const projects = await getOrganizationProjects();
    if (projects && projects.length > 0) {
      projectList = projects;
      projectDropdownAvailable = true;
      // Populate dropdown
      dropdown.innerHTML = '<option value="">Current project (auto)</option>';
      for (const project of projects.sort((a, b) =>
        a.name.localeCompare(b.name),
      )) {
        const option = document.createElement("option");
        option.value = project.id;
        option.textContent = `${project.name} (${project.id.substring(0, 8)}...)`;
        dropdown.appendChild(option);
      }
      // Show dropdown, hide text input
      dropdown.style.display = "block";
      textInput.style.display = "none";
      console.log(`Loaded ${projects.length} projects for dropdown`);
    } else {
      throw new Error("No projects returned");
    }
  } catch (error) {
    console.log(
      "Project dropdown unavailable, using text input:",
      error.message,
    );
    projectDropdownAvailable = false;
    // Show text input, hide dropdown
    dropdown.style.display = "none";
    textInput.style.display = "block";
  }
}
/**
 * Get list of projects in the organization.
 * Requires vso.project scope.
 */
async function getOrganizationProjects() {
  return new Promise((resolve, reject) => {
    VSS.require(["TFS/Core/RestClient"], (CoreRestClient) => {
      try {
        const client = CoreRestClient.getClient();
        client
          .getProjects()
          .then((projects) => {
            resolve(projects || []);
          })
          .catch((error) => {
            reject(error);
          });
      } catch (error) {
        reject(error);
      }
    });
  });
}
/**
 * Load saved settings into form.
 */
async function loadSettings() {
  if (!dataService) return;
  try {
    const savedProjectId = await dataService.getValue(SETTINGS_KEY_PROJECT, {
      scopeType: "User",
    });
    const savedPipelineId = await dataService.getValue(SETTINGS_KEY_PIPELINE, {
      scopeType: "User",
    });
    // Set project
    if (savedProjectId) {
      if (projectDropdownAvailable) {
        const dropdown = document.getElementById("project-select");
        if (dropdown) dropdown.value = savedProjectId;
      } else {
        const textInput = document.getElementById("project-id");
        if (textInput) textInput.value = savedProjectId;
      }
    }
    // Set pipeline ID
    const pipelineInput = document.getElementById("pipeline-id");
    if (pipelineInput && savedPipelineId) {
      pipelineInput.value = savedPipelineId.toString();
    }
  } catch (error) {
    console.log("No saved settings found:", error);
  }
}
/**
 * Get the selected project ID from either dropdown or text input.
 */
function getSelectedProjectId() {
  if (projectDropdownAvailable) {
    const dropdown = document.getElementById("project-select");
    return dropdown.value || null;
  } else {
    const textInput = document.getElementById("project-id");
    const value = textInput.value.trim();
    return value || null;
  }
}
/**
 * Save settings from form.
 */
async function saveSettings() {
  if (!dataService) return;
  const projectId = getSelectedProjectId();
  const pipelineInput = document.getElementById("pipeline-id");
  const pipelineValue = pipelineInput?.value?.trim();
  try {
    // Save project ID
    await dataService.setValue(SETTINGS_KEY_PROJECT, projectId, {
      scopeType: "User",
    });
    // Save pipeline ID
    if (pipelineValue) {
      const pipelineId = parseInt(pipelineValue, 10);
      if (isNaN(pipelineId) || pipelineId <= 0) {
        showStatus("Pipeline ID must be a positive integer", "error");
        return;
      }
      await dataService.setValue(SETTINGS_KEY_PIPELINE, pipelineId, {
        scopeType: "User",
      });
    } else {
      await dataService.setValue(SETTINGS_KEY_PIPELINE, null, {
        scopeType: "User",
      });
    }
    showStatus("Settings saved successfully", "success");
    // Update status display
    await updateStatus();
  } catch (error) {
    console.error("Failed to save settings:", error);
    showStatus("Failed to save settings: " + error.message, "error");
  }
}
/**
 * Clear settings.
 */
async function clearSettings() {
  if (!dataService) return;
  // Clear form
  if (projectDropdownAvailable) {
    const dropdown = document.getElementById("project-select");
    if (dropdown) dropdown.value = "";
  } else {
    const textInput = document.getElementById("project-id");
    if (textInput) textInput.value = "";
  }
  const pipelineInput = document.getElementById("pipeline-id");
  if (pipelineInput) pipelineInput.value = "";
  try {
    await dataService.setValue(SETTINGS_KEY_PROJECT, null, {
      scopeType: "User",
    });
    await dataService.setValue(SETTINGS_KEY_PIPELINE, null, {
      scopeType: "User",
    });
    showStatus(
      "Settings cleared - using current project with auto-discovery",
      "success",
    );
    await updateStatus();
  } catch (error) {
    console.error("Failed to clear settings:", error);
    showStatus("Failed to clear settings: " + error.message, "error");
  }
}
/**
 * Update the status display with current configuration.
 */
async function updateStatus() {
  if (!dataService) return;
  const statusDisplay = document.getElementById("status-display");
  if (!statusDisplay) return;
  try {
    const savedProjectId = await dataService.getValue(SETTINGS_KEY_PROJECT, {
      scopeType: "User",
    });
    const savedPipelineId = await dataService.getValue(SETTINGS_KEY_PIPELINE, {
      scopeType: "User",
    });
    const webContext = VSS.getWebContext();
    const currentProjectName = webContext?.project?.name || "Unknown";
    const currentProjectId = webContext?.project?.id;
    let html = "";
    // Current context
    html += `<p><strong>Current Project:</strong> ${escapeHtml(currentProjectName)}</p>`;
    // Source project configuration
    if (savedProjectId) {
      const projectName = getProjectNameById(savedProjectId);
      html += `<p><strong>Source Project:</strong> ${escapeHtml(projectName)} <code>${savedProjectId.substring(0, 8)}...</code></p>`;
    } else {
      html += `<p><strong>Source Project:</strong> <em>Same as current</em></p>`;
    }
    // Pipeline configuration with validation
    if (savedPipelineId) {
      html += `<p><strong>Pipeline Definition ID:</strong> ${savedPipelineId}`;
      // Validate the saved pipeline
      const targetProjectId = savedProjectId || currentProjectId;
      if (targetProjectId) {
        const validation = await validatePipeline(
          savedPipelineId,
          targetProjectId,
        );
        if (validation.valid) {
          html += ` <span class="status-valid">✓ Valid</span>`;
          html += `</p>`;
          html += `<p class="status-hint">Pipeline: "${escapeHtml(validation.name || "")}" (Build #${validation.buildId})</p>`;
        } else {
          html += ` <span class="status-invalid">⚠️ Invalid</span>`;
          html += `</p>`;
          html += `<p class="status-warning">⚠️ ${escapeHtml(validation.error || "")}</p>`;
          html += `<p class="status-hint">The dashboard will automatically clear this setting and re-discover pipelines. Consider clearing manually to configure a different pipeline.</p>`;
        }
      } else {
        html += `</p><p class="status-warning">⚠️ No project ID available for validation</p>`;
      }
    } else {
      html += `<p><strong>Mode:</strong> Auto-discovery</p>`;
      html += `<p class="status-hint">The dashboard will automatically find pipelines with an "aggregates" artifact.</p>`;
    }
    // Dropdown availability
    if (projectDropdownAvailable) {
      html += `<p class="status-hint">✓ Project dropdown available (${projectList.length} projects)</p>`;
    } else {
      html += `<p class="status-hint">Project dropdown not available - using text input</p>`;
    }
    statusDisplay.innerHTML = html;
  } catch (error) {
    statusDisplay.innerHTML = `<p class="status-error">Failed to load status: ${escapeHtml(error.message)}</p>`;
  }
}
/**
 * Get project name by ID from the cached list.
 */
function getProjectNameById(projectId) {
  const project = projectList.find((p) => p.id === projectId);
  return project?.name || projectId;
}
/**
 * Validate if a pipeline exists and has successful builds with aggregates artifact.
 * Returns validation result with details.
 */
async function validatePipeline(pipelineId, projectId) {
  return new Promise((resolve) => {
    VSS.require(["TFS/Build/RestClient"], (BuildRestClient) => {
      try {
        const client = BuildRestClient.getClient();
        // Check if pipeline definition exists
        client
          .getDefinitions(
            projectId,
            null,
            null,
            null,
            2, // queryOrder: definitionNameAscending
            null,
            null,
            null,
            [pipelineId],
          )
          .then((definitions) => {
            if (!definitions || definitions.length === 0) {
              resolve({
                valid: false,
                error: "Pipeline definition not found (may have been deleted)",
              });
              return;
            }
            const pipelineName = definitions[0].name;
            // Check for successful/partially-succeeded builds
            // resultFilter: 6 = Succeeded(2) | PartiallySucceeded(4)
            client
              .getBuilds(
                projectId,
                [pipelineId],
                null,
                null,
                null,
                null,
                null,
                null,
                2,
                6,
                null,
                null,
                1,
              )
              .then((builds) => {
                if (!builds || builds.length === 0) {
                  resolve({
                    valid: false,
                    name: pipelineName,
                    error: "No successful builds found",
                  });
                  return;
                }
                resolve({
                  valid: true,
                  name: pipelineName,
                  buildId: builds[0].id,
                });
              })
              .catch((e) => {
                resolve({
                  valid: false,
                  error: `Build check failed: ${e.message}`,
                });
              });
          })
          .catch((e) => {
            resolve({
              valid: false,
              error: `Definition fetch failed: ${e.message}`,
            });
          });
      } catch (e) {
        resolve({ valid: false, error: `Validation error: ${e.message}` });
      }
    });
  });
}
/**
 * Discover pipelines with aggregates artifact in the current project.
 */
async function discoverPipelines() {
  return new Promise((resolve) => {
    VSS.require(["TFS/Build/RestClient"], (BuildRestClient) => {
      try {
        const client = BuildRestClient.getClient();
        const webContext = VSS.getWebContext();
        const projectId = webContext.project?.id;
        if (!projectId) {
          resolve([]);
          return;
        }
        const matches = [];
        // Get pipeline definitions (limit for performance)
        client
          .getDefinitions(projectId, null, null, null, 2, 50)
          .then(async (definitions) => {
            for (const def of definitions) {
              // Get latest successful/partially-succeeded build
              try {
                const builds = await client.getBuilds(
                  projectId,
                  [def.id],
                  null,
                  null,
                  null,
                  null,
                  null,
                  null,
                  2,
                  6,
                  null,
                  null,
                  1,
                );
                if (!builds || builds.length === 0) continue;
                const latestBuild = builds[0];
                // Check for aggregates artifact
                const artifacts = await client.getArtifacts(
                  projectId,
                  latestBuild.id,
                );
                if (!artifacts.some((a) => a.name === "aggregates")) continue;
                matches.push({
                  id: def.id,
                  name: def.name,
                  buildId: latestBuild.id,
                });
              } catch (e) {
                // Skip pipelines we can't access
                console.debug(`Skipping pipeline ${def.name}:`, e);
              }
            }
            resolve(matches);
          })
          .catch((e) => {
            console.error("Discovery: definitions fetch failed:", e);
            resolve([]);
          });
      } catch (e) {
        console.error("Discovery error:", e);
        resolve([]);
      }
    });
  });
}
/**
 * Run auto-discovery and show results to user.
 */
async function runDiscovery() {
  const statusDisplay = document.getElementById("status-display");
  if (!statusDisplay) return;
  const originalContent = statusDisplay.innerHTML;
  statusDisplay.innerHTML =
    "<p>🔍 Discovering pipelines with aggregates artifact...</p>";
  try {
    const matches = await discoverPipelines();
    if (matches.length === 0) {
      statusDisplay.innerHTML = `
                <p class="status-warning">⚠️ No PR Insights pipelines found in the current project.</p>
                <p class="status-hint">Create a pipeline using pr-insights-pipeline.yml and run it at least once.</p>
            `;
      showStatus("No pipelines found with aggregates artifact", "warning");
      return;
    }
    let html = `<p><strong>Found ${matches.length} pipeline(s):</strong></p><ul class="discovered-pipelines">`;
    for (const match of matches) {
      html += `<li>
                <strong>${escapeHtml(match.name)}</strong> (ID: ${match.id})
                <button class="btn btn-small" id="select-pipeline-${match.id}">Use This</button>
            </li>`;
    }
    html += "</ul>";
    html +=
      '<p class="status-hint">Click "Use This" to configure, or clear settings for auto-discovery.</p>';
    statusDisplay.innerHTML = html;
    // Add event listeners for discovered pipelines
    for (const match of matches) {
      document
        .getElementById(`select-pipeline-${match.id}`)
        ?.addEventListener("click", () => {
          const pipelineInput = document.getElementById("pipeline-id");
          if (pipelineInput) pipelineInput.value = match.id.toString();
          showStatus(
            `Pipeline ${match.id} selected - click Save to confirm`,
            "info",
          );
        });
    }
    showStatus(`Found ${matches.length} pipeline(s)`, "success");
  } catch (error) {
    statusDisplay.innerHTML = originalContent;
    showStatus("Discovery failed: " + error.message, "error");
  }
}
/**
 * Show status message.
 */
function showStatus(message, type = "info") {
  const statusEl = document.getElementById("status-message");
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.className = `status-message status-${type}`;
  // Clear after delay
  setTimeout(() => {
    statusEl.textContent = "";
    statusEl.className = "status-message";
  }, 5000);
}
/**
 * Escape HTML to prevent XSS.
 */
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
/**
 * Set up event listeners.
 */
function setupEventListeners() {
  document.getElementById("save-btn")?.addEventListener("click", saveSettings);
  document
    .getElementById("clear-btn")
    ?.addEventListener("click", clearSettings);
  document
    .getElementById("discover-btn")
    ?.addEventListener("click", runDiscovery);
  // Enter key saves
  document.getElementById("pipeline-id")?.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      saveSettings();
    }
  });
  document.getElementById("project-id")?.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      saveSettings();
    }
  });
}
// Initialize on load
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
// Global exposure for potential inline handlers (though we use addEventListener now)
window.selectDiscoveredPipeline = (pipelineId) => {
  const pipelineInput = document.getElementById("pipeline-id");
  if (pipelineInput) pipelineInput.value = pipelineId.toString();
  showStatus(`Pipeline ${pipelineId} selected - click Save to confirm`, "info");
};
//# sourceMappingURL=settings.js.map
