"use strict";
var PRInsightsArtifactClient = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // ../ui/artifact-client.ts
  var artifact_client_exports = {};
  __export(artifact_client_exports, {
    ArtifactClient: () => ArtifactClient,
    AuthenticatedDatasetLoader: () => AuthenticatedDatasetLoader,
    MockArtifactClient: () => MockArtifactClient
  });

  // ../ui/error-types.ts
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

  // ../ui/types.ts
  function isErrorWithMessage(error) {
    return typeof error === "object" && error !== null && "message" in error && typeof error.message === "string";
  }
  function getErrorMessage(error) {
    if (isErrorWithMessage(error)) return error.message;
    if (typeof error === "string") return error;
    return "Unknown error";
  }

  // ../ui/artifact-client.ts
  var BUILD_API_VERSIONS = ["7.1", "6.0", "5.1"];
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
      this.resolvedApiVersion = null;
      this.projectId = projectId;
    }
    /**
     * Initialize the client with authentication credentials.
     * MUST be called after SDK initialization and before any other methods.
     *
     * @param collectionUri - Azure DevOps collection/organization base URI
     * @param authToken - Bearer token for authenticated REST calls
     * @returns This client instance
     */
    async initialize(collectionUri, authToken) {
      if (this.initialized) {
        return this;
      }
      this.collectionUri = collectionUri;
      this.authToken = authToken;
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
      const response = await this._fetchWithVersionFallback(
        (v) => this._buildFileUrl(buildId, artifactName, filePath, v)
      );
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
        const response = await this._fetchWithVersionFallback(
          (v) => this._buildFileUrl(buildId, artifactName, filePath, v),
          { method: "HEAD" }
        );
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
     * Fetch a URL with API version fallback. If the version is already
     * cached, uses it directly. Otherwise tries each version in
     * BUILD_API_VERSIONS order against the actual requested URL.
     *
     * - 401/403 → fail immediately (auth, not version)
     * - 400/404 with no cached version → try next version
     * - Success → cache the version, return the response
     *
     * @param buildUrl URL template with {VERSION} placeholder for api-version
     * @param options Optional fetch options (e.g., { method: "HEAD" })
     */
    async _fetchWithVersionFallback(buildUrl, options) {
      this._ensureInitialized();
      if (this.resolvedApiVersion) {
        return this._authenticatedFetch(
          buildUrl(this.resolvedApiVersion),
          options
        );
      }
      let lastError = null;
      for (const version of BUILD_API_VERSIONS) {
        const response = await this._authenticatedFetch(
          buildUrl(version),
          options
        );
        if (response.status === 401 || response.status === 403) {
          return response;
        }
        if (response.ok || response.status !== 400 && response.status !== 404) {
          this.resolvedApiVersion = version;
          return response;
        }
        lastError = new Error(
          `Build API api-version=${version}: ${response.status}`
        );
      }
      throw lastError ?? new Error("No compatible Build API version found");
    }
    /**
     * Get list of artifacts for a build.
     */
    async getArtifacts(buildId) {
      this._ensureInitialized();
      const response = await this._fetchWithVersionFallback(
        (v) => `${this.collectionUri}${this.projectId}/_apis/build/builds/${buildId}/artifacts?api-version=${v}`
      );
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
     * Get pipeline definitions for the project.
     *
     * @param top - Maximum number of definitions to return (default: 50)
     * @param queryOrder - Sort order (2 = lastModifiedDescending)
     * @returns Array of pipeline definition references
     */
    async getDefinitions(top = 50, queryOrder = 2) {
      this._ensureInitialized();
      const response = await this._fetchWithVersionFallback(
        (v) => `${this.collectionUri}${this.projectId}/_apis/build/definitions?api-version=${v}&$top=${top}&queryOrder=${queryOrder}`
      );
      if (response.status === 401 || response.status === 403) {
        throw createPermissionDeniedError("list build definitions");
      }
      if (!response.ok) {
        throw new Error(`Failed to list definitions: ${response.status}`);
      }
      const data = await response.json();
      return data.value || [];
    }
    /**
     * Get builds for a specific pipeline definition.
     *
     * @param definitionId - Pipeline definition ID to filter by
     * @param top - Maximum number of builds to return (default: 1)
     * @returns Array of builds (filtered to completed + succeeded)
     */
    async getBuilds(definitionId, top = 1) {
      this._ensureInitialized();
      const response = await this._fetchWithVersionFallback(
        (v) => `${this.collectionUri}${this.projectId}/_apis/build/builds?api-version=${v}&definitions=${definitionId}&statusFilter=2&resultFilter=6&$top=${top}`
      );
      if (response.status === 401 || response.status === 403) {
        throw createPermissionDeniedError("list builds");
      }
      if (!response.ok) {
        throw new Error(`Failed to list builds: ${response.status}`);
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
     * Takes an explicit API version — callers route through
     * _fetchWithVersionFallback which provides the version.
     */
    _buildFileUrl(buildId, artifactName, filePath, apiVersion) {
      const normalizedPath = filePath.startsWith("/") ? filePath : "/" + filePath;
      return `${this.collectionUri}${this.projectId}/_apis/build/builds/${buildId}/artifacts?artifactName=${encodeURIComponent(artifactName)}&%24format=file&subPath=${encodeURIComponent(normalizedPath)}&api-version=${apiVersion}`;
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
        const wrappedError = new Error(
          `Failed to load dataset manifest: ${getErrorMessage(error)}`
        );
        wrappedError.cause = error;
        throw wrappedError;
      }
    }
    validateManifest(manifest) {
      const SUPPORTED_MANIFEST_VERSION = 1;
      const SUPPORTED_DATASET_VERSION = 1;
      const SUPPORTED_AGGREGATES_VERSION = 2;
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
      this.mockData = new Map(Object.entries(mockData));
    }
    async initialize() {
      return this;
    }
    async getArtifactFile(buildId, artifactName, filePath) {
      const key = `${buildId}/${artifactName}/${filePath}`;
      if (this.mockData.has(key)) {
        return JSON.parse(JSON.stringify(this.mockData.get(key)));
      }
      throw new Error(`Mock: File not found: ${key}`);
    }
    async hasArtifactFile(buildId, artifactName, filePath) {
      const key = `${buildId}/${artifactName}/${filePath}`;
      return this.mockData.has(key);
    }
    async getArtifacts(buildId) {
      return this.mockData.get(`${buildId}/artifacts`) ?? [];
    }
    async getDefinitions() {
      return this.mockData.get("definitions") ?? [];
    }
    async getBuilds(definitionId) {
      return this.mockData.get(`builds/${definitionId}`) ?? [];
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
  return __toCommonJS(artifact_client_exports);
})();
// Global exports for browser runtime\nif (typeof window !== 'undefined') { Object.assign(window, PRInsightsArtifactClient || {}); }
