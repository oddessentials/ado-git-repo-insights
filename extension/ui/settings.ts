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

import {
  getErrorMessage,
  type VSSProject,
  type VSSBuildArtifact,
  type BuildDefinitionReference,
} from "./types";

// Import SDK functions from shared module
import {
  initializeAdoSdk,
  getExtensionDataService,
  getWebContext,
  getCollectionUri,
  getAccessToken,
} from "./modules";
import { ADO_REST_API_VERSIONS } from "./modules/api-versions";

// Import safe DOM rendering utilities
import {
  escapeHtml,
  renderTrustedHtml,
  clearElement,
  createOption,
} from "./modules/shared/render";

// Import host iframe resize sync
import {
  initializeHostResizeSync,
  syncHostHeight,
} from "./modules/shared/host-resize";

// Import ArtifactClient for authenticated artifact download
import { ArtifactClient } from "./artifact-client";

// Import toast for user feedback
import { showToast } from "./modules/export";

/**
 * Structured result from pipeline discovery.
 * Supports partial-failure reporting (FR-007) and error/retry UI (FR-005).
 */
interface DiscoveryResult {
  pipelines: Array<{ id: number; name: string; buildId: number }>;
  skippedCount: number;
  error?: string;
}

// Settings keys (must match dashboard.js)
const SETTINGS_KEY_PROJECT = "pr-insights-source-project";
const SETTINGS_KEY_PIPELINE = "pr-insights-pipeline-id";

// Download constants
const ARTIFACT_NAME_CSV = "csv-output";
const BLOB_CLEANUP_TIMEOUT_MS = 10_000;

// State
let dataService: Awaited<ReturnType<typeof getExtensionDataService>> | null = null;
let projectDropdownAvailable = false;
let projectList: VSSProject[] = [];
let lastValidation: { valid: boolean; buildId?: number } | null = null;

let statusTimerId: ReturnType<typeof setTimeout> | null = null;

// initializeAdoSdk is now imported from "./modules/sdk"

/**
 * Initialize the settings page.
 */
async function init(): Promise<void> {
  // Start observing layout changes before any async work so startup DOM
  // mutations (project dropdown, settings load, status render) and error-
  // path content are all captured.  resizeHost() is a no-op until SDK
  // init completes, so this is safe to call early.
  // .settings-container is static HTML — always present.
  initializeHostResizeSync(".settings-container");

  try {
    await initializeAdoSdk();

    // The pre-init resize scheduled by initializeHostResizeSync no-ops
    // because resizeHost requires the SDK to be callable. Now that the
    // SDK is initialized, fire the initial resize so hosts without
    // ResizeObserver support still get the correct iframe height.
    syncHostHeight();

    // Get extension data manager
    dataService = await getExtensionDataService();

    // Set current project as placeholder
    const webCtx = getWebContext();
    const projectInput = document.getElementById(
      "project-id",
    ) as HTMLInputElement | null;
    if (projectInput && webCtx?.project?.name) {
      projectInput.placeholder = `Current: ${webCtx.project.name}`;
    }

    // Try to load project dropdown
    await tryLoadProjectDropdown();

    // Load saved settings
    await loadSettings();

    // Update status display
    await updateStatus();

    // Set up event listeners
    setupEventListeners();

    // Final resize after all async content has rendered. On hosts
    // without ResizeObserver, the resize at line 104 only captured
    // the static HTML height — this captures the full rendered page.
    syncHostHeight();
  } catch (error: unknown) {
    console.error("Settings initialization failed:", error);
    showStatus(
      "Failed to initialize settings: " + getErrorMessage(error),
      "error",
    );

    // Resize after error content is added so the error message
    // is visible without scrolling on non-ResizeObserver hosts.
    syncHostHeight();
  }
}

/**
 * Try to load project dropdown. Degrades gracefully to text input.
 */
async function tryLoadProjectDropdown(): Promise<void> {
  const dropdown = document.getElementById(
    "project-select",
  ) as HTMLSelectElement;
  const textInput = document.getElementById("project-id") as HTMLInputElement;

  try {
    // Get projects using Core REST client
    const projects = await getOrganizationProjects();

    if (projects && projects.length > 0) {
      projectList = projects;
      projectDropdownAvailable = true;

      // Populate dropdown - use safe DOM APIs
      clearElement(dropdown);
      dropdown.appendChild(createOption("", "Current project (auto)"));
      for (const project of projects.sort((a: VSSProject, b: VSSProject) =>
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
  } catch (error: unknown) {
    console.log(
      "Project dropdown unavailable, using text input:",
      getErrorMessage(error),
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
// Project listing uses the same REST API version fallback chain as the
// Build API — see api-versions.ts for the centralized constant.

async function getOrganizationProjects(): Promise<VSSProject[]> {
  const collectionUri = await getCollectionUri();
  const token = await getAccessToken();
  const headers: HeadersInit = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };

  // Discover a working API version using the first page request.
  let workingVersion: string | null = null;
  let firstResponse: Response | null = null;
  let lastError: Error | null = null;

  for (const version of ADO_REST_API_VERSIONS) {
    const url = `${collectionUri}_apis/projects?api-version=${version}&$top=500`;
    const response = await fetch(url, { headers });

    // Auth failures are not version-related — fail fast.
    if (response.status === 401 || response.status === 403) {
      throw new Error(`Failed to list projects: ${response.status}`);
    }

    if (response.ok) {
      workingVersion = version;
      firstResponse = response;
      break;
    }

    // 400/404 likely means version not supported — try next.
    lastError = new Error(
      `Failed to list projects with api-version=${version}: ${response.status}`,
    );
  }

  if (!workingVersion || !firstResponse) {
    throw lastError ?? new Error("No compatible API version for project listing");
  }

  // Process the first page (already fetched during version discovery).
  const allProjects: VSSProject[] = [];

  const processPage = async (response: Response): Promise<string | null> => {
    // Non-JSON or malformed response is terminal — do not keep paginating.
    let data: { value?: unknown };
    try {
      data = (await response.json()) as { value?: unknown };
    } catch {
      return null;
    }
    const raw: unknown[] = Array.isArray(data.value) ? data.value : [];
    const page = raw.filter(
      (p): p is VSSProject =>
        p !== null &&
        typeof p === "object" &&
        typeof (p as Record<string, unknown>).name === "string" &&
        typeof (p as Record<string, unknown>).id === "string",
    );
    allProjects.push(...page);
    return response.headers.get("x-ms-continuationtoken") ?? null;
  };

  let continuationToken = await processPage(firstResponse);

  // Paginate remaining pages with the discovered version.
  while (continuationToken) {
    const url =
      `${collectionUri}_apis/projects?api-version=${workingVersion}&$top=500` +
      `&continuationToken=${encodeURIComponent(continuationToken)}`;
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`Failed to list projects: ${response.status}`);
    }
    continuationToken = await processPage(response);
  }

  return allProjects;
}

/**
 * Load saved settings into form.
 */
async function loadSettings(): Promise<void> {
  if (!dataService) return;

  try {
    const savedProjectId = await dataService.getValue<string>(
      SETTINGS_KEY_PROJECT,
      { scopeType: "User", defaultValue: "" },
    );
    const savedPipelineId = await dataService.getValue<number>(
      SETTINGS_KEY_PIPELINE,
      { scopeType: "User", defaultValue: 0 },
    );

    // Set project
    if (savedProjectId) {
      if (projectDropdownAvailable) {
        const dropdown = document.getElementById(
          "project-select",
        ) as HTMLSelectElement;
        if (dropdown) dropdown.value = savedProjectId;
      } else {
        const textInput = document.getElementById(
          "project-id",
        ) as HTMLInputElement;
        if (textInput) textInput.value = savedProjectId;
      }
    }

    // Set pipeline ID
    const pipelineInput = document.getElementById(
      "pipeline-id",
    ) as HTMLInputElement;
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
function getSelectedProjectId(): string | null {
  if (projectDropdownAvailable) {
    const dropdown = document.getElementById(
      "project-select",
    ) as HTMLSelectElement;
    return dropdown.value || null;
  } else {
    const textInput = document.getElementById("project-id") as HTMLInputElement;
    const value = textInput.value.trim();
    return value || null;
  }
}

/**
 * Save settings from form.
 */
async function saveSettings(): Promise<void> {
  if (!dataService) return;

  const projectId = getSelectedProjectId();
  const pipelineInput = document.getElementById(
    "pipeline-id",
  ) as HTMLInputElement | null;
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
  } catch (error: unknown) {
    console.error("Failed to save settings:", error);
    showStatus("Failed to save settings: " + getErrorMessage(error), "error");
  }
}

/**
 * Clear settings.
 */
async function clearSettings(): Promise<void> {
  if (!dataService) return;

  // Clear form
  if (projectDropdownAvailable) {
    const dropdown = document.getElementById(
      "project-select",
    ) as HTMLSelectElement;
    if (dropdown) dropdown.value = "";
  } else {
    const textInput = document.getElementById("project-id") as HTMLInputElement;
    if (textInput) textInput.value = "";
  }
  const pipelineInput = document.getElementById(
    "pipeline-id",
  ) as HTMLInputElement;
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
  } catch (error: unknown) {
    console.error("Failed to clear settings:", error);
    showStatus("Failed to clear settings: " + getErrorMessage(error), "error");
  }
}

/**
 * Update the status display with current configuration.
 */
async function updateStatus(): Promise<void> {
  if (!dataService) return;

  const statusDisplay = document.getElementById("status-display");
  if (!statusDisplay) return;

  try {
    // Read saved settings — isolated try/catch because the host's XDM
    // proxy can fail independently (e.g. MeProxy CDN outage). A failed
    // read should not prevent the rest of the status UI from rendering.
    let savedProjectId = "";
    let savedPipelineId = 0;
    try {
      savedProjectId = await dataService.getValue<string>(
        SETTINGS_KEY_PROJECT,
        { scopeType: "User", defaultValue: "" },
      ) || "";
      savedPipelineId = await dataService.getValue<number>(
        SETTINGS_KEY_PIPELINE,
        { scopeType: "User", defaultValue: 0 },
      ) || 0;
    } catch (readError: unknown) {
      console.warn("Could not read saved settings:", readError);
    }
    const webContext = getWebContext();
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

      // Clear stale validation and disable button before async re-validate
      lastValidation = null;
      const downloadBtn = document.getElementById(
        "download-raw-btn",
      ) as HTMLButtonElement | null;
      if (downloadBtn) {
        downloadBtn.disabled = true;
      }

      // Validate the saved pipeline
      const targetProjectId = savedProjectId || currentProjectId;
      if (targetProjectId) {
        const validation = await validatePipeline(
          savedPipelineId,
          targetProjectId,
        );

        // Cache validation result for download function
        lastValidation = {
          valid: validation.valid,
          buildId: validation.buildId,
        };

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
        lastValidation = null;
        html += `</p><p class="status-warning">⚠️ No project ID available for validation</p>`;
      }
    } else {
      // Auto-discovery mode: find a valid pipeline for download (mirrors dashboard)
      // Discover against the effective project so the buildId matches downloadRawData() scope
      html += `<p><strong>Mode:</strong> Auto-discovery</p>`;
      const result = await discoverPipelines(
        savedProjectId || currentProjectId,
      );
      if (result.error) {
        lastValidation = null;
        html += `<p class="status-warning">⚠️ Discovery failed: ${escapeHtml(result.error)}</p>`;
        html += `<p class="status-hint"><a href="#" id="retry-discovery-link">Retry</a></p>`;
      } else {
        const match = result.pipelines[0];
        if (match) {
          lastValidation = { valid: true, buildId: match.buildId };
          html += `<p class="status-hint">Found pipeline "${escapeHtml(match.name)}" (Build #${match.buildId}). Download available.</p>`;
        } else {
          lastValidation = null;
          html += `<p class="status-hint">The dashboard will automatically find pipelines with an "aggregates" artifact.</p>`;
        }
        if (result.skippedCount > 0) {
          html += `<p class="status-warning">⚠️ Found ${result.pipelines.length} pipeline(s); ${result.skippedCount} could not be checked.</p>`;
        }
      }
    }

    // Enable/disable download button based on validation
    const downloadBtn = document.getElementById(
      "download-raw-btn",
    ) as HTMLButtonElement | null;
    if (downloadBtn) {
      downloadBtn.disabled = !lastValidation?.valid || !lastValidation?.buildId;
    }

    // Dropdown availability
    if (projectDropdownAvailable) {
      html += `<p class="status-hint">✓ Project dropdown available (${projectList.length} projects)</p>`;
    } else {
      html += `<p class="status-hint">Project dropdown not available - using text input</p>`;
    }

    // SECURITY: html uses escapeHtml for all dynamic values
    renderTrustedHtml(statusDisplay, html);

    // Bind retry handler if discovery failed (FR-006)
    const retryLink = document.getElementById("retry-discovery-link");
    if (retryLink) {
      retryLink.addEventListener("click", (e) => {
        e.preventDefault();
        void updateStatus();
      });
    }
  } catch (error: unknown) {
    renderTrustedHtml(
      statusDisplay,
      `<p class="status-error">Failed to load status: ${escapeHtml(getErrorMessage(error))}</p>`,
    );
  }
}

/**
 * Get project name by ID from the cached list.
 */
function getProjectNameById(projectId: string): string {
  const project = projectList.find((p) => p.id === projectId);
  return project?.name || projectId;
}

/**
 * Download raw CSV data as a ZIP file from the configured pipeline.
 * Mirrors the dashboard's downloadRawDataZip() flow.
 */
async function downloadRawData(): Promise<void> {
  if (!lastValidation?.valid || !lastValidation?.buildId) {
    showToast("No valid pipeline configured. Save settings first.", "error");
    return;
  }

  const downloadBtn = document.getElementById(
    "download-raw-btn",
  ) as HTMLButtonElement | null;
  const originalText = downloadBtn?.textContent || "";

  try {
    // Disable button and show progress
    if (downloadBtn) {
      downloadBtn.disabled = true;
      downloadBtn.textContent = "Downloading...";
    }
    showToast("Preparing download...", "success");

    // Read saved project ID
    if (!dataService) {
      showToast("Settings service not available", "error");
      return;
    }
    let savedProjectId = "";
    try {
      savedProjectId = await dataService.getValue<string>(
        SETTINGS_KEY_PROJECT,
        { scopeType: "User", defaultValue: "" },
      ) || "";
    } catch {
      console.warn("Could not read saved project setting for download");
    }
    const webContext = getWebContext();
    const projectId = savedProjectId || webContext?.project?.id;
    if (!projectId) {
      showToast("No project ID available", "error");
      return;
    }

    // Validate buildId is a positive integer (fail fast before network calls)
    if (
      !Number.isInteger(lastValidation.buildId) ||
      lastValidation.buildId <= 0
    ) {
      showToast("Invalid build ID", "error");
      return;
    }

    // Create and initialize ArtifactClient with SDK credentials
    const [collectionUri, authToken] = await Promise.all([
      getCollectionUri(),
      getAccessToken(),
    ]);
    const artifactClient = new ArtifactClient(projectId);
    await artifactClient.initialize(collectionUri, authToken);

    // Get artifact metadata
    const artifact = await artifactClient.getArtifactMetadata(
      lastValidation.buildId,
      ARTIFACT_NAME_CSV,
    );
    if (!artifact) {
      showToast("Raw CSV artifact not found in this pipeline run", "error");
      return;
    }

    const downloadUrl = artifact.resource?.downloadUrl;
    if (!downloadUrl) {
      showToast("Download URL not available", "error");
      return;
    }

    // Validate download URL: require HTTPS and restrict to trusted
    // origins. Azure DevOps Services uses *.artifacts.visualstudio.com
    // for artifact storage (different origin from the collection URI),
    // while Server/on-prem uses the collection host directly.
    try {
      const parsed = new URL(downloadUrl);
      if (parsed.protocol !== "https:") {
        showToast("Invalid download URL", "error");
        return;
      }
      const collectionOrigin = new URL(collectionUri).origin;
      const isCollectionHost = parsed.origin === collectionOrigin;
      const isAzureArtifactHost =
        parsed.hostname.endsWith(".artifacts.visualstudio.com");
      if (!isCollectionHost && !isAzureArtifactHost) {
        showToast("Invalid download URL", "error");
        return;
      }
    } catch {
      showToast("Invalid download URL", "error");
      return;
    }

    // Append format=zip using URL API for safe query parameter handling
    const zipUrlObj = new URL(downloadUrl);
    if (!zipUrlObj.searchParams.has("format")) {
      zipUrlObj.searchParams.set("format", "zip");
    }
    const zipUrl = zipUrlObj.toString();

    // Authenticated fetch
    const response = await artifactClient.authenticatedFetch(zipUrl);
    if (!response.ok) {
      if (response.status === 403 || response.status === 401) {
        showToast("Permission denied to download artifacts", "error");
      } else {
        showToast(`Download failed: ${response.statusText}`, "error");
      }
      return;
    }

    // Trigger browser download
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const dateStr = new Date().toISOString().split("T")[0];
    link.download = `pr-insights-raw-data-${dateStr}.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), BLOB_CLEANUP_TIMEOUT_MS);

    showToast("Download started", "success");
  } catch (err: unknown) {
    console.error("Failed to download raw data:", getErrorMessage(err));
    showToast("Failed to download raw data", "error");
  } finally {
    // Restore button state
    if (downloadBtn) {
      downloadBtn.textContent = originalText;
      downloadBtn.disabled = !lastValidation?.valid || !lastValidation?.buildId;
    }
  }
}

/**
 * Validate if a pipeline exists and has successful builds with aggregates artifact.
 * Uses ArtifactClient direct REST calls.
 * Returns validation result with details.
 */
async function validatePipeline(
  pipelineId: number,
  projectId: string,
): Promise<{
  valid: boolean;
  name?: string;
  buildId?: number;
  error?: string;
}> {
  const client = new ArtifactClient(projectId);
  try {
    const [collectionUri, authToken] = await Promise.all([
      getCollectionUri(),
      getAccessToken(),
    ]);
    await client.initialize(collectionUri, authToken);
  } catch (e: unknown) {
    return { valid: false, error: `Validation error: ${getErrorMessage(e)}` };
  }

  try {
    const builds = await client.getBuilds(pipelineId);
    if (!builds || builds.length === 0) {
      return {
        valid: false,
        error:
          "No successful builds found (pipeline may not exist or has no completed runs)",
      };
    }

    const firstBuild = builds[0];
    if (!firstBuild) {
      return { valid: false, error: "Build unexpectedly empty" };
    }

    const pipelineName = firstBuild.definition?.name || `ID ${pipelineId}`;
    return {
      valid: true,
      name: pipelineName,
      buildId: firstBuild.id,
    };
  } catch (e: unknown) {
    return { valid: false, error: `Build check failed: ${getErrorMessage(e)}` };
  }
}

/**
 * Discover pipelines with aggregates artifact in the target project.
 * Uses ArtifactClient direct REST calls (replaces legacy VSS.require SDK).
 *
 * Creates a separate ArtifactClient instance scoped to targetProjectId
 * to support cross-project discovery from the settings page.
 */
async function discoverPipelines(
  targetProjectId?: string,
): Promise<DiscoveryResult> {
  const webContext = getWebContext();
  const projectId = targetProjectId || webContext?.project?.id;
  if (!projectId) {
    return { pipelines: [], skippedCount: 0, error: "No project ID available" };
  }

  // Create a dedicated ArtifactClient for the target project
  const [collectionUri, authToken] = await Promise.all([
    getCollectionUri(),
    getAccessToken(),
  ]);
  const client = new ArtifactClient(projectId);
  try {
    await client.initialize(collectionUri, authToken);
  } catch (e: unknown) {
    return {
      pipelines: [],
      skippedCount: 0,
      error: `Failed to initialize: ${getErrorMessage(e)}`,
    };
  }

  let skippedCount = 0;
  const pipelines: Array<{ id: number; name: string; buildId: number }> = [];

  let definitions: BuildDefinitionReference[];
  try {
    definitions = await client.getDefinitions();
  } catch (e: unknown) {
    return {
      pipelines: [],
      skippedCount: 0,
      error: `Failed to list pipelines: ${getErrorMessage(e)}`,
    };
  }

  for (const def of definitions) {
    try {
      const builds = await client.getBuilds(def.id);
      if (!builds || builds.length === 0) continue;

      const latestBuild = builds[0];
      if (!latestBuild) continue;

      // Check for aggregates artifact
      const artifacts = await client.getArtifacts(latestBuild.id);
      if (!artifacts.some((a: VSSBuildArtifact) => a.name === "aggregates"))
        continue;

      pipelines.push({
        id: def.id,
        name: def.name,
        buildId: latestBuild.id,
      });
    } catch (e: unknown) {
      // Partial failure: skip this pipeline but count the failure (FR-007)
      skippedCount++;
      console.debug("Skipping pipeline %s:", def.name, e);
    }
  }

  return { pipelines, skippedCount };
}

/**
 * Run auto-discovery and show results to user.
 */
async function runDiscovery(): Promise<void> {
  const statusDisplay = document.getElementById("status-display");
  if (!statusDisplay) return;

  const originalContent = statusDisplay.innerHTML;
  // SECURITY: Static content only
  renderTrustedHtml(
    statusDisplay,
    "<p>🔍 Discovering pipelines with aggregates artifact...</p>",
  );

  try {
    const result = await discoverPipelines();

    if (result.error) {
      let errorHtml = `<p class="status-warning">⚠️ Discovery failed: ${escapeHtml(result.error)}</p>`;
      errorHtml += `<p class="status-hint"><a href="#" id="retry-run-discovery-link">Retry</a></p>`;
      renderTrustedHtml(statusDisplay, errorHtml);
      const retryLink = document.getElementById("retry-run-discovery-link");
      if (retryLink) {
        retryLink.addEventListener("click", (e) => {
          e.preventDefault();
          void runDiscovery();
        });
      }
      showStatus("Discovery failed: " + result.error, "error");
      return;
    }

    if (result.pipelines.length === 0) {
      renderTrustedHtml(
        statusDisplay,
        `
                <p class="status-warning">⚠️ No PR Insights pipelines found in the current project.</p>
                <p class="status-hint">Create a pipeline using pr-insights-pipeline.yml and run it at least once.</p>
            `,
      );
      showStatus("No pipelines found with aggregates artifact", "warning");
      return;
    }

    let html = `<p><strong>Found ${result.pipelines.length} pipeline(s):</strong></p>`;
    if (result.skippedCount > 0) {
      html += `<p class="status-warning">⚠️ ${result.skippedCount} pipeline(s) could not be checked.</p>`;
    }
    html += `<ul class="discovered-pipelines">`;
    for (const match of result.pipelines) {
      html += `<li>
                <strong>${escapeHtml(match.name)}</strong> (ID: ${match.id})
                <button class="btn btn-small" id="select-pipeline-${match.id}">Use This</button>
            </li>`;
    }
    html += "</ul>";
    html +=
      '<p class="status-hint">Click "Use This" to configure, or clear settings for auto-discovery.</p>';

    // SECURITY: html uses escapeHtml for match.name
    renderTrustedHtml(statusDisplay, html);

    // Add event listeners for discovered pipelines
    for (const match of result.pipelines) {
      document
        .getElementById(`select-pipeline-${match.id}`)
        ?.addEventListener("click", () => {
          const pipelineInput = document.getElementById(
            "pipeline-id",
          ) as HTMLInputElement;
          if (pipelineInput) pipelineInput.value = match.id.toString();
          showStatus(
            `Pipeline ${match.id} selected - click Save to confirm`,
            "info",
          );
        });
    }

    showStatus(`Found ${result.pipelines.length} pipeline(s)`, "success");
  } catch (error: unknown) {
    renderTrustedHtml(statusDisplay, originalContent);
    showStatus("Discovery failed: " + getErrorMessage(error), "error");
  }
}

/**
 * Show status message.
 */
function showStatus(message: string, type = "info"): void {
  const statusEl = document.getElementById("status-message");
  if (!statusEl) return;

  if (statusTimerId !== null) clearTimeout(statusTimerId);

  statusEl.textContent = message;
  statusEl.className = `status-message status-${type}`;

  // Clear after delay
  statusTimerId = setTimeout(() => {
    statusTimerId = null;
    statusEl.textContent = "";
    statusEl.className = "status-message";
  }, 5000);
}

// escapeHtml is now imported from ./modules/shared/render

/**
 * Set up event listeners.
 */
function setupEventListeners(): void {
  document
    .getElementById("save-btn")
    ?.addEventListener("click", () => void saveSettings());
  document
    .getElementById("clear-btn")
    ?.addEventListener("click", () => void clearSettings());
  document
    .getElementById("discover-btn")
    ?.addEventListener("click", () => void runDiscovery());
  document
    .getElementById("download-raw-btn")
    ?.addEventListener("click", () => void downloadRawData());

  // Enter key saves
  document
    .getElementById("pipeline-id")
    ?.addEventListener("keypress", (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        void saveSettings();
      }
    });
  document
    .getElementById("project-id")
    ?.addEventListener("keypress", (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        void saveSettings();
      }
    });
}

// Initialize on load
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => void init());
} else {
  void init();
}

// Global exposure for potential inline handlers (though we use addEventListener now)
window.selectDiscoveredPipeline = (pipelineId: number) => {
  const pipelineInput = document.getElementById(
    "pipeline-id",
  ) as HTMLInputElement;
  if (pipelineInput) pipelineInput.value = pipelineId.toString();
  showStatus(`Pipeline ${pipelineId} selected - click Save to confirm`, "info");
};
