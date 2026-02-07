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
  var ErrorTypes = {
    SETUP_REQUIRED: "setup_required",
    MULTIPLE_PIPELINES: "multiple_pipelines",
    NO_SUCCESSFUL_BUILDS: "no_successful_builds",
    ARTIFACTS_MISSING: "artifacts_missing",
    PERMISSION_DENIED: "permission_denied",
    INVALID_CONFIG: "invalid_config"
  };
  var PrInsightsError = class extends Error {
    constructor(type, title, message, details = null) {
      super(message);
      this.name = "PrInsightsError";
      this.type = type;
      this.title = title;
      this.details = details;
    }
  };
  function createPermissionDeniedError(operation) {
    return new PrInsightsError(
      ErrorTypes.PERMISSION_DENIED,
      "Permission Denied",
      `You don't have permission to ${operation}.`,
      {
        instructions: [
          'Request "Build (Read)" permission from your project administrator',
          "Ensure you have access to view pipeline artifacts",
          "If using a service account, verify its permissions"
        ],
        permissionNeeded: "Build (Read)"
      }
    );
  }
  if (typeof window !== "undefined") {
    window.PrInsightsError = PrInsightsError;
  }

  // ui/modules/export.ts
  function showToast(message, type = "success", durationMs = 3e3) {
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.remove();
    }, durationMs);
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

  // ui/artifact-client.ts
  var ArtifactClient = class {
    /**
     * Create a new ArtifactClient.
     *
     * @param projectId - Azure DevOps project ID
     */
    constructor(projectId) {
      this.collectionUri = null;
      this.authToken = null;
      this.initialized = false;
      this.projectId = projectId;
    }
    /**
     * Initialize the client with ADO SDK auth.
     * MUST be called after VSS.ready() and before any other methods.
     *
     * @returns This client instance
     */
    async initialize() {
      if (this.initialized) {
        return this;
      }
      const webContext = VSS.getWebContext();
      this.collectionUri = webContext.collection.uri;
      const tokenResult = await VSS.getAccessToken();
      this.authToken = typeof tokenResult === "string" ? tokenResult : tokenResult.token;
      this.initialized = true;
      return this;
    }
    /**
     * Ensure the client is initialized.
     */
    _ensureInitialized() {
      if (!this.initialized) {
        throw new Error(
          "ArtifactClient not initialized. Call initialize() first."
        );
      }
    }
    /**
     * Fetch a file from a build artifact.
     *
     * @param buildId - Build ID
     * @param artifactName - Artifact name (e.g., 'aggregates')
     * @param filePath - Path within artifact (e.g., 'dataset-manifest.json')
     * @returns Parsed JSON content
     * @throws {PrInsightsError} On permission denied or not found
     */
    async getArtifactFile(buildId, artifactName, filePath) {
      this._ensureInitialized();
      const url = this._buildFileUrl(buildId, artifactName, filePath);
      const response = await this._authenticatedFetch(url);
      if (response.status === 401 || response.status === 403) {
        throw createPermissionDeniedError("read artifact files");
      }
      if (response.status === 404) {
        throw new Error(
          `File '${filePath}' not found in artifact '${artifactName}'`
        );
      }
      if (!response.ok) {
        throw new Error(
          `Failed to fetch artifact file: ${response.status} ${response.statusText}`
        );
      }
      return response.json();
    }
    /**
     * Check if a specific file exists in an artifact.
     */
    async hasArtifactFile(buildId, artifactName, filePath) {
      this._ensureInitialized();
      try {
        const url = this._buildFileUrl(buildId, artifactName, filePath);
        const response = await this._authenticatedFetch(url, { method: "HEAD" });
        return response.ok;
      } catch {
        return false;
      }
    }
    /**
     * Get artifact metadata by looking it up from the artifacts list.
     */
    async getArtifactMetadata(buildId, artifactName) {
      this._ensureInitialized();
      const artifacts = await this.getArtifacts(buildId);
      const artifact = artifacts.find(
        (a) => a.name === artifactName
      );
      if (!artifact) {
        console.log(
          "[getArtifactMetadata] Artifact '%s' not found in build %d",
          artifactName,
          buildId
        );
        return null;
      }
      return artifact;
    }
    /**
     * Get artifact content via SDK approach.
     */
    async getArtifactFileViaSdk(buildId, artifactName, filePath) {
      this._ensureInitialized();
      const artifact = await this.getArtifactMetadata(buildId, artifactName);
      if (!artifact) {
        throw new Error(
          `Artifact '${artifactName}' not found in build ${buildId}`
        );
      }
      const downloadUrl = artifact.resource?.downloadUrl;
      if (!downloadUrl) {
        throw new Error(
          `No downloadUrl available for artifact '${artifactName}'`
        );
      }
      const normalizedPath = filePath.startsWith("/") ? filePath : "/" + filePath;
      let url;
      if (downloadUrl.includes("format=")) {
        url = downloadUrl.replace(/format=\w+/, "format=file");
      } else {
        const separator = downloadUrl.includes("?") ? "&" : "?";
        url = `${downloadUrl}${separator}format=file`;
      }
      url += `&subPath=${encodeURIComponent(normalizedPath)}`;
      const response = await this._authenticatedFetch(url);
      if (response.status === 404) {
        throw new Error(
          `File '${filePath}' not found in artifact '${artifactName}'`
        );
      }
      if (response.status === 401 || response.status === 403) {
        throw createPermissionDeniedError("read artifact file");
      }
      if (!response.ok) {
        throw new Error(
          `Failed to fetch file: ${response.status} ${response.statusText}`
        );
      }
      return response.json();
    }
    /**
     * Get list of artifacts for a build.
     */
    async getArtifacts(buildId) {
      this._ensureInitialized();
      const url = `${this.collectionUri}${this.projectId}/_apis/build/builds/${buildId}/artifacts?api-version=7.1`;
      const response = await this._authenticatedFetch(url);
      if (response.status === 401 || response.status === 403) {
        throw createPermissionDeniedError("list build artifacts");
      }
      if (!response.ok) {
        throw new Error(`Failed to list artifacts: ${response.status}`);
      }
      const data = await response.json();
      return data.value || [];
    }
    /**
     * Create a DatasetLoader that uses this client for authenticated requests.
     */
    createDatasetLoader(buildId, artifactName) {
      return new AuthenticatedDatasetLoader(this, buildId, artifactName);
    }
    /**
     * Build the URL for accessing a file within an artifact.
     */
    _buildFileUrl(buildId, artifactName, filePath) {
      const normalizedPath = filePath.startsWith("/") ? filePath : "/" + filePath;
      return `${this.collectionUri}${this.projectId}/_apis/build/builds/${buildId}/artifacts?artifactName=${encodeURIComponent(artifactName)}&%24format=file&subPath=${encodeURIComponent(normalizedPath)}&api-version=7.1`;
    }
    /**
     * Perform an authenticated fetch using the ADO auth token.
     */
    async _authenticatedFetch(url, options = {}) {
      const headers = {
        Authorization: `Bearer ${this.authToken}`,
        Accept: "application/json",
        ...options.headers || {}
      };
      return fetch(url, { ...options, headers });
    }
    /**
     * Public wrapper for authenticated fetch.
     * Use this for external callers (e.g., dashboard raw data download).
     *
     * @param url - URL to fetch
     * @param options - Fetch options
     * @returns Response
     */
    async authenticatedFetch(url, options = {}) {
      this._ensureInitialized();
      return this._authenticatedFetch(url, options);
    }
  };
  var AuthenticatedDatasetLoader = class {
    constructor(artifactClient, buildId, artifactName) {
      this.manifest = null;
      this.dimensions = null;
      this.rollupCache = /* @__PURE__ */ new Map();
      this.distributionCache = /* @__PURE__ */ new Map();
      this.artifactClient = artifactClient;
      this.buildId = buildId;
      this.artifactName = artifactName;
    }
    async loadManifest() {
      try {
        this.manifest = await this.artifactClient.getArtifactFileViaSdk(
          this.buildId,
          this.artifactName,
          "dataset-manifest.json"
        );
        if (!this.manifest) {
          throw new Error("Manifest file is empty or invalid");
        }
        this.validateManifest(this.manifest);
        return this.manifest;
      } catch (error) {
        throw new Error(
          `Failed to load dataset manifest: ${getErrorMessage(error)}`
        );
      }
    }
    validateManifest(manifest) {
      const SUPPORTED_MANIFEST_VERSION = 1;
      const SUPPORTED_DATASET_VERSION = 1;
      const SUPPORTED_AGGREGATES_VERSION = 1;
      if (!manifest.manifest_schema_version) {
        throw new Error("Invalid manifest: missing schema version");
      }
      if (manifest.manifest_schema_version > SUPPORTED_MANIFEST_VERSION) {
        throw new Error(
          `Manifest version ${manifest.manifest_schema_version} not supported.`
        );
      }
      if (manifest.dataset_schema_version !== void 0 && manifest.dataset_schema_version > SUPPORTED_DATASET_VERSION) {
        throw new Error(
          `Dataset version ${manifest.dataset_schema_version} not supported.`
        );
      }
      if (manifest.aggregates_schema_version !== void 0 && manifest.aggregates_schema_version > SUPPORTED_AGGREGATES_VERSION) {
        throw new Error(
          `Aggregates version ${manifest.aggregates_schema_version} not supported.`
        );
      }
    }
    async loadDimensions() {
      if (this.dimensions) return this.dimensions;
      this.dimensions = await this.artifactClient.getArtifactFileViaSdk(
        this.buildId,
        this.artifactName,
        "aggregates/dimensions.json"
      );
      if (!this.dimensions) {
        throw new Error("Dimensions file is empty or invalid");
      }
      return this.dimensions;
    }
    async getWeeklyRollups(startDate, endDate) {
      if (!this.manifest) throw new Error("Manifest not loaded.");
      const neededWeeks = this.getWeeksInRange(startDate, endDate);
      const results = [];
      for (const weekStr of neededWeeks) {
        const cachedRollup = this.rollupCache.get(weekStr);
        if (cachedRollup) {
          results.push(cachedRollup);
          continue;
        }
        const indexEntry = this.manifest?.aggregate_index?.weekly_rollups?.find(
          (r) => r.week === weekStr
        );
        if (!indexEntry) continue;
        try {
          const rollup = await this.artifactClient.getArtifactFileViaSdk(
            this.buildId,
            this.artifactName,
            indexEntry.path
          );
          this.rollupCache.set(weekStr, rollup);
          results.push(rollup);
        } catch (e) {
          console.warn("Failed to load rollup for %s:", weekStr, e);
        }
      }
      return results;
    }
    async getDistributions(startDate, endDate) {
      if (!this.manifest) throw new Error("Manifest not loaded.");
      const startYear = startDate.getFullYear();
      const endYear = endDate.getFullYear();
      const results = [];
      for (let year = startYear; year <= endYear; year++) {
        const yearStr = String(year);
        const cachedDistribution = this.distributionCache.get(yearStr);
        if (cachedDistribution) {
          results.push(cachedDistribution);
          continue;
        }
        const indexEntry = this.manifest?.aggregate_index?.distributions?.find(
          (d) => d.year === yearStr
        );
        if (!indexEntry) continue;
        try {
          const dist = await this.artifactClient.getArtifactFileViaSdk(
            this.buildId,
            this.artifactName,
            indexEntry.path
          );
          this.distributionCache.set(yearStr, dist);
          results.push(dist);
        } catch (e) {
          console.warn("Failed to load distribution for %s:", yearStr, e);
        }
      }
      return results;
    }
    getWeeksInRange(startDate, endDate) {
      const weeks = [];
      const current = new Date(startDate);
      const day = current.getDay();
      const diff = current.getDate() - day + (day === 0 ? -6 : 1);
      current.setDate(diff);
      while (current <= endDate) {
        weeks.push(this.getISOWeek(current));
        current.setDate(current.getDate() + 7);
      }
      return weeks;
    }
    getISOWeek(date) {
      const d = new Date(
        Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
      );
      d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      const weekNo = Math.ceil(
        ((d.getTime() - yearStart.getTime()) / 864e5 + 1) / 7
      );
      return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
    }
    getCoverage() {
      return this.manifest?.coverage || null;
    }
    getDefaultRangeDays() {
      return this.manifest?.defaults?.default_date_range_days || 90;
    }
    async loadPredictions() {
      try {
        const indexEntry = this.manifest?.aggregate_index?.predictions;
        if (!indexEntry) return { state: "unavailable" };
        const data = await this.artifactClient.getArtifactFileViaSdk(
          this.buildId,
          this.artifactName,
          indexEntry.path
        );
        return { state: "ok", data };
      } catch (e) {
        console.warn("Failed to load predictions:", e);
        return { state: "unavailable" };
      }
    }
    async loadInsights() {
      try {
        const indexEntry = this.manifest?.aggregate_index?.ai_insights;
        if (!indexEntry) return { state: "unavailable" };
        const data = await this.artifactClient.getArtifactFileViaSdk(
          this.buildId,
          this.artifactName,
          indexEntry.path
        );
        return { state: "ok", data };
      } catch (e) {
        console.warn("Failed to load AI insights:", e);
        return { state: "unavailable" };
      }
    }
  };
  var MockArtifactClient = class {
    constructor(mockData = {}) {
      this.projectId = "mock-project";
      this.initialized = true;
      this.mockData = mockData;
    }
    async initialize() {
      return this;
    }
    async getArtifactFile(buildId, artifactName, filePath) {
      const key = `${buildId}/${artifactName}/${filePath}`;
      if (this.mockData[key]) {
        return JSON.parse(JSON.stringify(this.mockData[key]));
      }
      throw new Error(`Mock: File not found: ${key}`);
    }
    async hasArtifactFile(buildId, artifactName, filePath) {
      const key = `${buildId}/${artifactName}/${filePath}`;
      return !!this.mockData[key];
    }
    async getArtifacts(buildId) {
      return this.mockData[`${buildId}/artifacts`] ?? [];
    }
    createDatasetLoader(buildId, artifactName) {
      return new AuthenticatedDatasetLoader(
        this,
        buildId,
        artifactName
      );
    }
  };
  if (typeof window !== "undefined") {
    window.ArtifactClient = ArtifactClient;
    window.AuthenticatedDatasetLoader = AuthenticatedDatasetLoader;
    window.MockArtifactClient = MockArtifactClient;
  }

  // ui/settings.ts
  var SETTINGS_KEY_PROJECT = "pr-insights-source-project";
  var SETTINGS_KEY_PIPELINE = "pr-insights-pipeline-id";
  var dataService = null;
  var projectDropdownAvailable = false;
  var projectList = [];
  var lastValidation = null;
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
          lastValidation = {
            valid: validation.valid,
            buildId: validation.buildId
          };
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
          lastValidation = null;
          html += `</p><p class="status-warning">\u26A0\uFE0F No project ID available for validation</p>`;
        }
      } else {
        lastValidation = null;
        html += `<p><strong>Mode:</strong> Auto-discovery</p>`;
        html += `<p class="status-hint">The dashboard will automatically find pipelines with an "aggregates" artifact.</p>`;
      }
      const downloadBtn = document.getElementById(
        "download-raw-btn"
      );
      if (downloadBtn) {
        downloadBtn.disabled = !lastValidation?.valid || !lastValidation?.buildId;
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
  async function downloadRawData() {
    if (!lastValidation?.valid || !lastValidation?.buildId) {
      showToast("No valid pipeline configured. Save settings first.", "error");
      return;
    }
    const downloadBtn = document.getElementById(
      "download-raw-btn"
    );
    const originalText = downloadBtn?.textContent || "";
    try {
      if (downloadBtn) {
        downloadBtn.disabled = true;
        downloadBtn.textContent = "Downloading...";
      }
      showToast("Preparing download...", "success");
      if (!dataService) {
        showToast("Settings service not available", "error");
        return;
      }
      const savedProjectId = await dataService.getValue(
        SETTINGS_KEY_PROJECT,
        { scopeType: "User" }
      );
      const webContext = VSS.getWebContext();
      const projectId = savedProjectId || webContext?.project?.id;
      if (!projectId) {
        showToast("No project ID available", "error");
        return;
      }
      const artifactClient = new ArtifactClient(projectId);
      await artifactClient.initialize();
      if (!Number.isInteger(lastValidation.buildId) || lastValidation.buildId <= 0) {
        showToast("Invalid build ID", "error");
        return;
      }
      const artifact = await artifactClient.getArtifactMetadata(
        lastValidation.buildId,
        "csv-output"
      );
      if (!artifact) {
        showToast(
          "Raw CSV artifact not found in this pipeline run",
          "error"
        );
        return;
      }
      const downloadUrl = artifact.resource?.downloadUrl;
      if (!downloadUrl) {
        showToast("Download URL not available", "error");
        return;
      }
      if (!downloadUrl.startsWith("https://")) {
        showToast("Invalid download URL", "error");
        return;
      }
      let zipUrl = downloadUrl;
      if (!zipUrl.includes("format=zip")) {
        const separator = zipUrl.includes("?") ? "&" : "?";
        zipUrl = `${zipUrl}${separator}format=zip`;
      }
      const response = await artifactClient.authenticatedFetch(zipUrl);
      if (!response.ok) {
        if (response.status === 403 || response.status === 401) {
          showToast("Permission denied to download artifacts", "error");
        } else {
          showToast(`Download failed: ${response.statusText}`, "error");
        }
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const dateStr = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
      link.download = `pr-insights-raw-data-${dateStr}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 1e4);
      showToast("Download started", "success");
    } catch (err) {
      console.error("Failed to download raw data:", err);
      showToast("Failed to download raw data", "error");
    } finally {
      if (downloadBtn) {
        downloadBtn.textContent = originalText;
        downloadBtn.disabled = !lastValidation?.valid || !lastValidation?.buildId;
      }
    }
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
    document.getElementById("download-raw-btn")?.addEventListener("click", () => void downloadRawData());
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
