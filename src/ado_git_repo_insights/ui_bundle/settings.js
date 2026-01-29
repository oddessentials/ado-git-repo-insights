"use strict";
var PRInsightsSettings = (() => {
  // ui/types.ts
  function isErrorWithMessage(error) {
    return typeof error === "object" && error !== null && "message" in error && typeof error.message === "string";
  }
  function getErrorMessage(error) {
    if (isErrorWithMessage(error)) return error.message;
    if (typeof error === "string") return error;
    return "Unknown error";
  }

  // ui/modules/shared/security.ts
  function escapeHtml(text) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  // ui/modules/shared/render.ts
  function clearElement(el) {
    if (!el) return;
    while (el.firstChild) {
      el.removeChild(el.firstChild);
    }
  }
  function createElement(tag, attributes, textContent) {
    const el = document.createElement(tag);
    if (attributes) {
      for (const [key, value] of Object.entries(attributes)) {
        el.setAttribute(key, value);
      }
    }
    if (textContent !== void 0) {
      el.textContent = textContent;
    }
    return el;
  }
  function renderTrustedHtml(container, trustedHtml) {
    if (!container) return;
    container.innerHTML = trustedHtml;
  }
  function createOption(value, text, selected = false) {
    const option = createElement("option", { value }, text);
    if (selected) {
      option.selected = true;
    }
    return option;
  }

  // ui/error-types.ts
  var PrInsightsError = class extends Error {
    constructor(type, title, message, details = null) {
      super(message);
      this.name = "PrInsightsError";
      this.type = type;
      this.title = title;
      this.details = details;
    }
  };
  if (typeof window !== "undefined") {
    window.PrInsightsError = PrInsightsError;
  }

  // ui/modules/sdk.ts
  var sdkInitialized = false;
  async function initializeAdoSdk(options = {}) {
    if (sdkInitialized) {
      return;
    }
    const { timeout = 1e4, onReady } = options;
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error("Azure DevOps SDK initialization timed out"));
      }, timeout);
      VSS.init({
        explicitNotifyLoaded: true,
        usePlatformScripts: true,
        usePlatformStyles: true
      });
      VSS.ready(() => {
        clearTimeout(timeoutId);
        sdkInitialized = true;
        if (onReady) {
          onReady();
        }
        VSS.notifyLoadSucceeded();
        resolve();
      });
    });
  }

  // ui/settings.ts
  var SETTINGS_KEY_PROJECT = "pr-insights-source-project";
  var SETTINGS_KEY_PIPELINE = "pr-insights-pipeline-id";
  var dataService = null;
  var projectDropdownAvailable = false;
  var projectList = [];
  async function init() {
    try {
      await initializeAdoSdk();
      dataService = await VSS.getService(VSS.ServiceIds.ExtensionData);
      const webContext = VSS.getWebContext();
      const projectInput = document.getElementById(
        "project-id"
      );
      if (projectInput && webContext?.project?.name) {
        projectInput.placeholder = `Current: ${webContext.project.name}`;
      }
      await tryLoadProjectDropdown();
      await loadSettings();
      await updateStatus();
      setupEventListeners();
    } catch (error) {
      console.error("Settings initialization failed:", error);
      showStatus(
        "Failed to initialize settings: " + getErrorMessage(error),
        "error"
      );
    }
  }
  async function tryLoadProjectDropdown() {
    const dropdown = document.getElementById(
      "project-select"
    );
    const textInput = document.getElementById("project-id");
    try {
      const projects = await getOrganizationProjects();
      if (projects && projects.length > 0) {
        projectList = projects;
        projectDropdownAvailable = true;
        clearElement(dropdown);
        dropdown.appendChild(createOption("", "Current project (auto)"));
        for (const project of projects.sort(
          (a, b) => a.name.localeCompare(b.name)
        )) {
          const option = document.createElement("option");
          option.value = project.id;
          option.textContent = `${project.name} (${project.id.substring(0, 8)}...)`;
          dropdown.appendChild(option);
        }
        dropdown.style.display = "block";
        textInput.style.display = "none";
        console.log(`Loaded ${projects.length} projects for dropdown`);
      } else {
        throw new Error("No projects returned");
      }
    } catch (error) {
      console.log(
        "Project dropdown unavailable, using text input:",
        getErrorMessage(error)
      );
      projectDropdownAvailable = false;
      dropdown.style.display = "none";
      textInput.style.display = "block";
    }
  }
  async function getOrganizationProjects() {
    return new Promise((resolve, reject) => {
      VSS.require(["TFS/Core/RestClient"], (...modules) => {
        const CoreRestClient = modules[0];
        try {
          const client = CoreRestClient.getClient();
          client.getProjects().then((projects) => {
            resolve(projects || []);
          }).catch((error) => {
            reject(error);
          });
        } catch (error) {
          reject(error);
        }
      });
    });
  }
  async function loadSettings() {
    if (!dataService) return;
    try {
      const savedProjectId = await dataService.getValue(
        SETTINGS_KEY_PROJECT,
        { scopeType: "User" }
      );
      const savedPipelineId = await dataService.getValue(
        SETTINGS_KEY_PIPELINE,
        { scopeType: "User" }
      );
      if (savedProjectId) {
        if (projectDropdownAvailable) {
          const dropdown = document.getElementById(
            "project-select"
          );
          if (dropdown) dropdown.value = savedProjectId;
        } else {
          const textInput = document.getElementById(
            "project-id"
          );
          if (textInput) textInput.value = savedProjectId;
        }
      }
      const pipelineInput = document.getElementById(
        "pipeline-id"
      );
      if (pipelineInput && savedPipelineId) {
        pipelineInput.value = savedPipelineId.toString();
      }
    } catch (error) {
      console.log("No saved settings found:", error);
    }
  }
  function getSelectedProjectId() {
    if (projectDropdownAvailable) {
      const dropdown = document.getElementById(
        "project-select"
      );
      return dropdown.value || null;
    } else {
      const textInput = document.getElementById("project-id");
      const value = textInput.value.trim();
      return value || null;
    }
  }
  async function saveSettings() {
    if (!dataService) return;
    const projectId = getSelectedProjectId();
    const pipelineInput = document.getElementById(
      "pipeline-id"
    );
    const pipelineValue = pipelineInput?.value?.trim();
    try {
      await dataService.setValue(SETTINGS_KEY_PROJECT, projectId, {
        scopeType: "User"
      });
      if (pipelineValue) {
        const pipelineId = parseInt(pipelineValue, 10);
        if (isNaN(pipelineId) || pipelineId <= 0) {
          showStatus("Pipeline ID must be a positive integer", "error");
          return;
        }
        await dataService.setValue(SETTINGS_KEY_PIPELINE, pipelineId, {
          scopeType: "User"
        });
      } else {
        await dataService.setValue(SETTINGS_KEY_PIPELINE, null, {
          scopeType: "User"
        });
      }
      showStatus("Settings saved successfully", "success");
      await updateStatus();
    } catch (error) {
      console.error("Failed to save settings:", error);
      showStatus("Failed to save settings: " + getErrorMessage(error), "error");
    }
  }
  async function clearSettings() {
    if (!dataService) return;
    if (projectDropdownAvailable) {
      const dropdown = document.getElementById(
        "project-select"
      );
      if (dropdown) dropdown.value = "";
    } else {
      const textInput = document.getElementById("project-id");
      if (textInput) textInput.value = "";
    }
    const pipelineInput = document.getElementById(
      "pipeline-id"
    );
    if (pipelineInput) pipelineInput.value = "";
    try {
      await dataService.setValue(SETTINGS_KEY_PROJECT, null, {
        scopeType: "User"
      });
      await dataService.setValue(SETTINGS_KEY_PIPELINE, null, {
        scopeType: "User"
      });
      showStatus(
        "Settings cleared - using current project with auto-discovery",
        "success"
      );
      await updateStatus();
    } catch (error) {
      console.error("Failed to clear settings:", error);
      showStatus("Failed to clear settings: " + getErrorMessage(error), "error");
    }
  }
  async function updateStatus() {
    if (!dataService) return;
    const statusDisplay = document.getElementById("status-display");
    if (!statusDisplay) return;
    try {
      const savedProjectId = await dataService.getValue(
        SETTINGS_KEY_PROJECT,
        { scopeType: "User" }
      );
      const savedPipelineId = await dataService.getValue(
        SETTINGS_KEY_PIPELINE,
        { scopeType: "User" }
      );
      const webContext = VSS.getWebContext();
      const currentProjectName = webContext?.project?.name || "Unknown";
      const currentProjectId = webContext?.project?.id;
      let html = "";
      html += `<p><strong>Current Project:</strong> ${escapeHtml(currentProjectName)}</p>`;
      if (savedProjectId) {
        const projectName = getProjectNameById(savedProjectId);
        html += `<p><strong>Source Project:</strong> ${escapeHtml(projectName)} <code>${savedProjectId.substring(0, 8)}...</code></p>`;
      } else {
        html += `<p><strong>Source Project:</strong> <em>Same as current</em></p>`;
      }
      if (savedPipelineId) {
        html += `<p><strong>Pipeline Definition ID:</strong> ${savedPipelineId}`;
        const targetProjectId = savedProjectId || currentProjectId;
        if (targetProjectId) {
          const validation = await validatePipeline(
            savedPipelineId,
            targetProjectId
          );
          if (validation.valid) {
            html += ` <span class="status-valid">\u2713 Valid</span>`;
            html += `</p>`;
            html += `<p class="status-hint">Pipeline: "${escapeHtml(validation.name || "")}" (Build #${validation.buildId})</p>`;
          } else {
            html += ` <span class="status-invalid">\u26A0\uFE0F Invalid</span>`;
            html += `</p>`;
            html += `<p class="status-warning">\u26A0\uFE0F ${escapeHtml(validation.error || "")}</p>`;
            html += `<p class="status-hint">The dashboard will automatically clear this setting and re-discover pipelines. Consider clearing manually to configure a different pipeline.</p>`;
          }
        } else {
          html += `</p><p class="status-warning">\u26A0\uFE0F No project ID available for validation</p>`;
        }
      } else {
        html += `<p><strong>Mode:</strong> Auto-discovery</p>`;
        html += `<p class="status-hint">The dashboard will automatically find pipelines with an "aggregates" artifact.</p>`;
      }
      if (projectDropdownAvailable) {
        html += `<p class="status-hint">\u2713 Project dropdown available (${projectList.length} projects)</p>`;
      } else {
        html += `<p class="status-hint">Project dropdown not available - using text input</p>`;
      }
      renderTrustedHtml(statusDisplay, html);
    } catch (error) {
      renderTrustedHtml(
        statusDisplay,
        `<p class="status-error">Failed to load status: ${escapeHtml(getErrorMessage(error))}</p>`
      );
    }
  }
  function getProjectNameById(projectId) {
    const project = projectList.find((p) => p.id === projectId);
    return project?.name || projectId;
  }
  async function validatePipeline(pipelineId, projectId) {
    return new Promise((resolve) => {
      VSS.require(["TFS/Build/RestClient"], (...modules) => {
        const BuildRestClient = modules[0];
        try {
          const client = BuildRestClient.getClient();
          client.getDefinitions(
            projectId,
            null,
            null,
            null,
            2,
            // queryOrder: definitionNameAscending
            null,
            null,
            null,
            [pipelineId]
          ).then((definitions) => {
            if (!definitions || definitions.length === 0) {
              resolve({
                valid: false,
                error: "Pipeline definition not found (may have been deleted)"
              });
              return;
            }
            const firstDef = definitions[0];
            if (!firstDef) {
              resolve({ valid: false, error: "Definition unexpectedly empty" });
              return;
            }
            const pipelineName = firstDef.name;
            client.getBuilds(
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
              1
            ).then((builds) => {
              if (!builds || builds.length === 0) {
                resolve({
                  valid: false,
                  name: pipelineName,
                  error: "No successful builds found"
                });
                return;
              }
              const firstBuild = builds[0];
              if (!firstBuild) {
                resolve({
                  valid: false,
                  name: pipelineName,
                  error: "Build unexpectedly empty"
                });
                return;
              }
              resolve({
                valid: true,
                name: pipelineName,
                buildId: firstBuild.id
              });
            }).catch((e) => {
              resolve({
                valid: false,
                error: `Build check failed: ${getErrorMessage(e)}`
              });
            });
          }).catch((e) => {
            resolve({
              valid: false,
              error: `Definition fetch failed: ${getErrorMessage(e)}`
            });
          });
        } catch (e) {
          resolve({
            valid: false,
            error: `Validation error: ${getErrorMessage(e)}`
          });
        }
      });
    });
  }
  async function discoverPipelines() {
    return new Promise((resolve) => {
      VSS.require(["TFS/Build/RestClient"], (...modules) => {
        const BuildRestClient = modules[0];
        try {
          const client = BuildRestClient.getClient();
          const webContext = VSS.getWebContext();
          const projectId = webContext.project?.id;
          if (!projectId) {
            resolve([]);
            return;
          }
          const matches = [];
          client.getDefinitions(projectId, null, null, null, 2, 50).then(async (definitions) => {
            for (const def of definitions) {
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
                  1
                );
                if (!builds || builds.length === 0) continue;
                const latestBuild = builds[0];
                if (!latestBuild) continue;
                const artifacts = await client.getArtifacts(
                  projectId,
                  latestBuild.id
                );
                if (!artifacts.some(
                  (a) => a.name === "aggregates"
                ))
                  continue;
                matches.push({
                  id: def.id,
                  name: def.name,
                  buildId: latestBuild.id
                });
              } catch (e) {
                console.debug("Skipping pipeline %s:", def.name, e);
              }
            }
            resolve(matches);
          }).catch((e) => {
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
  async function runDiscovery() {
    const statusDisplay = document.getElementById("status-display");
    if (!statusDisplay) return;
    const originalContent = statusDisplay.innerHTML;
    renderTrustedHtml(
      statusDisplay,
      "<p>\u{1F50D} Discovering pipelines with aggregates artifact...</p>"
    );
    try {
      const matches = await discoverPipelines();
      if (matches.length === 0) {
        renderTrustedHtml(
          statusDisplay,
          `
                <p class="status-warning">\u26A0\uFE0F No PR Insights pipelines found in the current project.</p>
                <p class="status-hint">Create a pipeline using pr-insights-pipeline.yml and run it at least once.</p>
            `
        );
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
      html += '<p class="status-hint">Click "Use This" to configure, or clear settings for auto-discovery.</p>';
      renderTrustedHtml(statusDisplay, html);
      for (const match of matches) {
        document.getElementById(`select-pipeline-${match.id}`)?.addEventListener("click", () => {
          const pipelineInput = document.getElementById(
            "pipeline-id"
          );
          if (pipelineInput) pipelineInput.value = match.id.toString();
          showStatus(
            `Pipeline ${match.id} selected - click Save to confirm`,
            "info"
          );
        });
      }
      showStatus(`Found ${matches.length} pipeline(s)`, "success");
    } catch (error) {
      renderTrustedHtml(statusDisplay, originalContent);
      showStatus("Discovery failed: " + getErrorMessage(error), "error");
    }
  }
  function showStatus(message, type = "info") {
    const statusEl = document.getElementById("status-message");
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.className = `status-message status-${type}`;
    setTimeout(() => {
      statusEl.textContent = "";
      statusEl.className = "status-message";
    }, 5e3);
  }
  function setupEventListeners() {
    document.getElementById("save-btn")?.addEventListener("click", () => void saveSettings());
    document.getElementById("clear-btn")?.addEventListener("click", () => void clearSettings());
    document.getElementById("discover-btn")?.addEventListener("click", () => void runDiscovery());
    document.getElementById("pipeline-id")?.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        void saveSettings();
      }
    });
    document.getElementById("project-id")?.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        void saveSettings();
      }
    });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => void init());
  } else {
    void init();
  }
  window.selectDiscoveredPipeline = (pipelineId) => {
    const pipelineInput = document.getElementById(
      "pipeline-id"
    );
    if (pipelineInput) pipelineInput.value = pipelineId.toString();
    showStatus(`Pipeline ${pipelineId} selected - click Save to confirm`, "info");
  };
})();
// Global exports for browser runtime
if (typeof window !== 'undefined') { Object.assign(window, PRInsightsSettings || {}); }
