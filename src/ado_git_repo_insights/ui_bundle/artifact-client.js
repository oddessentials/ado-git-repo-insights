"use strict";
/**
 * Artifact Client for PR Insights Hub
 *
 * Provides authenticated access to Azure DevOps pipeline artifacts.
 * Uses the ADO Extension SDK for proper authentication.
 *
 * IMPORTANT: In ADO extension context, plain fetch() will return 401.
 * We must use the SDK's auth token service.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MockArtifactClient =
  exports.AuthenticatedDatasetLoader =
  exports.ArtifactClient =
    void 0;
const error_types_1 = require("./error-types");
/**
 * Client for accessing pipeline artifacts with authentication.
 */
class ArtifactClient {
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
    // Get web context for collection URI
    const webContext = VSS.getWebContext();
    this.collectionUri = webContext.collection.uri;
    // Get auth token from SDK
    const tokenResult = await VSS.getAccessToken();
    this.authToken =
      typeof tokenResult === "string" ? tokenResult : tokenResult.token;
    this.initialized = true;
    return this;
  }
  /**
   * Ensure the client is initialized.
   */
  _ensureInitialized() {
    if (!this.initialized) {
      throw new Error(
        "ArtifactClient not initialized. Call initialize() first.",
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
      throw (0, error_types_1.createPermissionDeniedError)(
        "read artifact files",
      );
    }
    if (response.status === 404) {
      throw new Error(
        `File '${filePath}' not found in artifact '${artifactName}'`,
      );
    }
    if (!response.ok) {
      throw new Error(
        `Failed to fetch artifact file: ${response.status} ${response.statusText}`,
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
    const artifact = artifacts.find((a) => a.name === artifactName);
    if (!artifact) {
      console.log(
        `[getArtifactMetadata] Artifact '${artifactName}' not found in build ${buildId}`,
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
        `Artifact '${artifactName}' not found in build ${buildId}`,
      );
    }
    const downloadUrl = artifact.resource?.downloadUrl;
    if (!downloadUrl) {
      throw new Error(
        `No downloadUrl available for artifact '${artifactName}'`,
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
        `File '${filePath}' not found in artifact '${artifactName}'`,
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw (0, error_types_1.createPermissionDeniedError)(
        "read artifact file",
      );
    }
    if (!response.ok) {
      throw new Error(
        `Failed to fetch file: ${response.status} ${response.statusText}`,
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
      throw (0, error_types_1.createPermissionDeniedError)(
        "list build artifacts",
      );
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
    return (
      `${this.collectionUri}${this.projectId}/_apis/build/builds/${buildId}/artifacts` +
      `?artifactName=${encodeURIComponent(artifactName)}` +
      `&%24format=file` +
      `&subPath=${encodeURIComponent(normalizedPath)}` +
      `&api-version=7.1`
    );
  }
  /**
   * Perform an authenticated fetch using the ADO auth token.
   */
  async _authenticatedFetch(url, options = {}) {
    const headers = {
      Authorization: `Bearer ${this.authToken}`,
      Accept: "application/json",
      ...(options.headers || {}),
    };
    return fetch(url, { ...options, headers });
  }
}
exports.ArtifactClient = ArtifactClient;
/**
 * DatasetLoader that uses ArtifactClient for authenticated requests.
 */
class AuthenticatedDatasetLoader {
  constructor(artifactClient, buildId, artifactName) {
    this.manifest = null;
    this.dimensions = null;
    this.rollupCache = new Map();
    this.distributionCache = new Map();
    this.artifactClient = artifactClient;
    this.buildId = buildId;
    this.artifactName = artifactName;
  }
  async loadManifest() {
    try {
      this.manifest = await this.artifactClient.getArtifactFileViaSdk(
        this.buildId,
        this.artifactName,
        "dataset-manifest.json",
      );
      this.validateManifest(this.manifest);
      return this.manifest;
    } catch (error) {
      throw new Error(`Failed to load dataset manifest: ${error.message}`);
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
        `Manifest version ${manifest.manifest_schema_version} not supported.`,
      );
    }
    if (manifest.dataset_schema_version > SUPPORTED_DATASET_VERSION) {
      throw new Error(
        `Dataset version ${manifest.dataset_schema_version} not supported.`,
      );
    }
    if (manifest.aggregates_schema_version > SUPPORTED_AGGREGATES_VERSION) {
      throw new Error(
        `Aggregates version ${manifest.aggregates_schema_version} not supported.`,
      );
    }
  }
  async loadDimensions() {
    if (this.dimensions) return this.dimensions;
    this.dimensions = await this.artifactClient.getArtifactFileViaSdk(
      this.buildId,
      this.artifactName,
      "aggregates/dimensions.json",
    );
    return this.dimensions;
  }
  async getWeeklyRollups(startDate, endDate) {
    if (!this.manifest) throw new Error("Manifest not loaded.");
    const neededWeeks = this.getWeeksInRange(startDate, endDate);
    const results = [];
    for (const weekStr of neededWeeks) {
      if (this.rollupCache.has(weekStr)) {
        results.push(this.rollupCache.get(weekStr));
        continue;
      }
      const indexEntry = this.manifest.aggregate_index?.weekly_rollups?.find(
        (r) => r.week === weekStr,
      );
      if (!indexEntry) continue;
      try {
        const rollup = await this.artifactClient.getArtifactFileViaSdk(
          this.buildId,
          this.artifactName,
          indexEntry.path,
        );
        this.rollupCache.set(weekStr, rollup);
        results.push(rollup);
      } catch (e) {
        console.warn(`Failed to load rollup for ${weekStr}:`, e);
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
      if (this.distributionCache.has(yearStr)) {
        results.push(this.distributionCache.get(yearStr));
        continue;
      }
      const indexEntry = this.manifest.aggregate_index?.distributions?.find(
        (d) => d.year === yearStr,
      );
      if (!indexEntry) continue;
      try {
        const dist = await this.artifactClient.getArtifactFileViaSdk(
          this.buildId,
          this.artifactName,
          indexEntry.path,
        );
        this.distributionCache.set(yearStr, dist);
        results.push(dist);
      } catch (e) {
        console.warn(`Failed to load distribution for ${yearStr}:`, e);
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
      Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
    );
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil(
      ((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
    );
    return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
  }
  getCoverage() {
    return this.manifest?.coverage || null;
  }
  getDefaultRangeDays() {
    return this.manifest?.ui_defaults?.default_range_days || 90;
  }
  async loadPredictions() {
    try {
      const indexEntry = this.manifest?.aggregate_index?.predictions;
      if (!indexEntry) return { state: "unavailable" };
      const data = await this.artifactClient.getArtifactFileViaSdk(
        this.buildId,
        this.artifactName,
        indexEntry.path,
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
        indexEntry.path,
      );
      return { state: "ok", data };
    } catch (e) {
      console.warn("Failed to load AI insights:", e);
      return { state: "unavailable" };
    }
  }
}
exports.AuthenticatedDatasetLoader = AuthenticatedDatasetLoader;
/**
 * Mock implementation for testing.
 */
class MockArtifactClient {
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
    return this.mockData[`${buildId}/artifacts`] || [];
  }
  createDatasetLoader(buildId, artifactName) {
    return new AuthenticatedDatasetLoader(this, buildId, artifactName);
  }
}
exports.MockArtifactClient = MockArtifactClient;
// Browser global exports for runtime compatibility
if (typeof window !== "undefined") {
  window.ArtifactClient = ArtifactClient;
  window.AuthenticatedDatasetLoader = AuthenticatedDatasetLoader;
  window.MockArtifactClient = MockArtifactClient;
}
//# sourceMappingURL=artifact-client.js.map
