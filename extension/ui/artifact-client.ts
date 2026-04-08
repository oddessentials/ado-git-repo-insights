/**
 * Artifact Client for PR Insights Hub
 *
 * Provides authenticated access to Azure DevOps pipeline artifacts.
 * This module is SDK-free: callers supply collectionUri and authToken
 * at initialization. This prevents duplicate SDK instances when
 * multiple IIFE bundles load on the same page.
 *
 * IMPORTANT: In ADO extension context, plain fetch() will return 401.
 * Callers must obtain a Bearer token from the SDK before initializing.
 */

import { type IDatasetLoader, type Rollup } from "./dataset-loader";
import { createPermissionDeniedError } from "./error-types";
import {
  getErrorMessage,
  type ManifestSchema,
  type DimensionsData,
  type DistributionData,
  type CoverageInfo,
  type PredictionsData,
  type InsightsData,
  type VSSBuildArtifact,
  type BuildDefinitionReference,
  type Build,
} from "./types";

import { fetchWithVersionFallback } from "./modules/api-versions";

/**
 * Endpoint families for per-route API version caching.
 * Azure DevOps Server deployments may support different API versions
 * on different Build REST routes, so each family resolves independently.
 */
export type EndpointFamily = "definitions" | "builds" | "artifacts" | "artifact-file";

/** List endpoints return { value: [] } for empty results, so 404
 *  genuinely signals "version not supported." Resource endpoints use
 *  404 for "not found" — only 400 triggers version fallback for those. */
const LIST_ENDPOINT_FAMILIES: ReadonlySet<EndpointFamily> = new Set([
  "definitions", "builds", "artifacts",
]);

export class ArtifactClient {
  public readonly projectId: string;
  private collectionUri: string | null = null;
  private tokenProvider: (() => Promise<string>) | null = null;
  private initialized: boolean = false;
  /** Per-family API version cache. Scoped to this client instance,
   *  which is bound to a single collectionUri + projectId by
   *  initialize(). A new context requires a new client instance. */
  private resolvedApiVersions = new Map<EndpointFamily, string>();

  /**
   * Create a new ArtifactClient.
   *
   * @param projectId - Azure DevOps project ID
   */
  constructor(projectId: string) {
    this.projectId = projectId;
  }

  /**
   * Initialize the client with authentication credentials.
   * MUST be called after SDK initialization and before any other methods.
   *
   * @param collectionUri - Azure DevOps collection/organization base URI
   * @param tokenProvider - Async function that returns a fresh Bearer token
   *   per request. The host manages token lifecycle; callers should pass
   *   the SDK's getAccessToken function directly.
   * @returns This client instance
   */
  async initialize(
    collectionUri: string,
    tokenProvider: () => Promise<string>,
  ): Promise<ArtifactClient> {
    if (this.initialized) {
      return this;
    }

    this.collectionUri = collectionUri;
    this.tokenProvider = tokenProvider;
    this.initialized = true;
    return this;
  }

  /**
   * Ensure the client is initialized.
   */
  private _ensureInitialized(): void {
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
  async getArtifactFile(
    buildId: number,
    artifactName: string,
    filePath: string,
  ): Promise<unknown> {
    this._ensureInitialized();

    const response = await this._fetchWithVersionFallback(
      "artifact-file",
      (v) => this._buildFileUrl(buildId, artifactName, filePath, v),
    );

    if (response.status === 401 || response.status === 403) {
      throw createPermissionDeniedError("read artifact files");
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
  async hasArtifactFile(
    buildId: number,
    artifactName: string,
    filePath: string,
  ): Promise<boolean> {
    this._ensureInitialized();

    try {
      const response = await this._fetchWithVersionFallback(
        "artifact-file",
        (v) => this._buildFileUrl(buildId, artifactName, filePath, v),
        { method: "HEAD" },
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Get artifact metadata by looking it up from the artifacts list.
   */
  async getArtifactMetadata(
    buildId: number,
    artifactName: string,
  ): Promise<VSSBuildArtifact | null> {
    this._ensureInitialized();

    const artifacts = await this.getArtifacts(buildId);
    const artifact = artifacts.find(
      (a: VSSBuildArtifact) => a.name === artifactName,
    );

    if (!artifact) {
      console.log(
        "[getArtifactMetadata] Artifact '%s' not found in build %d",
        artifactName,
        buildId,
      );
      return null;
    }

    return artifact;
  }

  /**
   * Get artifact content via SDK approach.
   */
  async getArtifactFileViaSdk(
    buildId: number,
    artifactName: string,
    filePath: string,
  ): Promise<unknown> {
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

    let url: string;
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
      throw createPermissionDeniedError("read artifact file");
    }

    if (!response.ok) {
      throw new Error(
        `Failed to fetch file: ${response.status} ${response.statusText}`,
      );
    }

    return response.json();
  }

  /**
   * Fetch a URL with API version fallback. If the version is already
   * cached, uses it directly. Otherwise delegates to the shared
   * fetchWithVersionFallback probe and caches on success.
   *
   * @param family Endpoint family for per-route version caching
   * @param buildUrl Function that builds the URL for a given api-version
   * @param options Optional fetch options (e.g., { method: "HEAD" })
   */
  private async _fetchWithVersionFallback(
    family: EndpointFamily,
    buildUrl: (version: string) => string,
    options?: RequestInit,
  ): Promise<Response> {
    this._ensureInitialized();

    // Fast path: version already resolved — bypass fallback entirely.
    // Once cached, 404s on this family go straight to the caller.
    const cachedVersion = this.resolvedApiVersions.get(family);
    if (cachedVersion) {
      return this._authenticatedFetch(buildUrl(cachedVersion), options);
    }

    // Slow path: delegate to shared version probe
    const isListEndpoint = LIST_ENDPOINT_FAMILIES.has(family);
    const { response, version } = await fetchWithVersionFallback(
      buildUrl,
      (url) => this._authenticatedFetch(url, options),
      { isListEndpoint },
    );

    // Cache version ONLY on 2xx success. A non-success response
    // (404 file-not-found, 500 server error) does not prove the
    // version works — next call will re-probe.
    if (response.ok) {
      this.resolvedApiVersions.set(family, version);
    }

    return response;
  }

  /**
   * Get list of artifacts for a build.
   */
  async getArtifacts(buildId: number): Promise<VSSBuildArtifact[]> {
    this._ensureInitialized();

    const response = await this._fetchWithVersionFallback(
      "artifacts",
      (v) => `${this.collectionUri}${this.projectId}/_apis/build/builds/${buildId}/artifacts?api-version=${v}`,
    );

    if (response.status === 401 || response.status === 403) {
      throw createPermissionDeniedError("list build artifacts");
    }

    if (response.status === 404) {
      throw new Error(
        `Build ${buildId} not found or has been deleted`,
      );
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
  async getDefinitions(
    top: number = 50,
    queryOrder: number = 2,
  ): Promise<BuildDefinitionReference[]> {
    this._ensureInitialized();

    const response = await this._fetchWithVersionFallback(
      "definitions",
      (v) =>
        `${this.collectionUri}${this.projectId}/_apis/build/definitions` +
        `?api-version=${v}&$top=${top}&queryOrder=${queryOrder}`,
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
  async getBuilds(definitionId: number, top: number = 1): Promise<Build[]> {
    this._ensureInitialized();

    const response = await this._fetchWithVersionFallback(
      "builds",
      (v) =>
        `${this.collectionUri}${this.projectId}/_apis/build/builds` +
        `?api-version=${v}&definitions=${definitionId}` +
        `&statusFilter=2&resultFilter=6&$top=${top}`,
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
  createDatasetLoader(
    buildId: number,
    artifactName: string,
  ): AuthenticatedDatasetLoader {
    return new AuthenticatedDatasetLoader(this, buildId, artifactName);
  }

  /**
   * Build the URL for accessing a file within an artifact.
   * Takes an explicit API version — callers route through
   * _fetchWithVersionFallback which provides the version.
   */
  private _buildFileUrl(
    buildId: number,
    artifactName: string,
    filePath: string,
    apiVersion: string,
  ): string {
    const normalizedPath = filePath.startsWith("/") ? filePath : "/" + filePath;

    return (
      `${this.collectionUri}${this.projectId}/_apis/build/builds/${buildId}/artifacts` +
      `?artifactName=${encodeURIComponent(artifactName)}` +
      `&%24format=file` +
      `&subPath=${encodeURIComponent(normalizedPath)}` +
      `&api-version=${apiVersion}`
    );
  }

  /**
   * Perform an authenticated fetch using the ADO auth token.
   */
  protected async _authenticatedFetch(
    url: string,
    options: RequestInit = {},
  ): Promise<Response> {
    if (!this.tokenProvider) {
      throw new Error("ArtifactClient not initialized. Call initialize() first.");
    }
    const token = await this.tokenProvider();
    const headers: HeadersInit = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(options.headers || {}),
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
  public async authenticatedFetch(
    url: string,
    options: RequestInit = {},
  ): Promise<Response> {
    this._ensureInitialized();
    return this._authenticatedFetch(url, options);
  }
}

/**
 * DatasetLoader that uses ArtifactClient for authenticated requests.
 */
export class AuthenticatedDatasetLoader implements IDatasetLoader {
  private readonly artifactClient: ArtifactClient;
  private readonly buildId: number;
  private readonly artifactName: string;
  private manifest: ManifestSchema | null = null;
  private dimensions: DimensionsData | null = null;
  private rollupCache = new Map<string, Rollup>();
  private distributionCache = new Map<string, DistributionData>();

  constructor(
    artifactClient: ArtifactClient,
    buildId: number,
    artifactName: string,
  ) {
    this.artifactClient = artifactClient;
    this.buildId = buildId;
    this.artifactName = artifactName;
  }

  async loadManifest(): Promise<ManifestSchema> {
    try {
      this.manifest = (await this.artifactClient.getArtifactFileViaSdk(
        this.buildId,
        this.artifactName,
        "dataset-manifest.json",
      )) as ManifestSchema;
      if (!this.manifest) {
        throw new Error("Manifest file is empty or invalid");
      }
      this.validateManifest(this.manifest);
      return this.manifest;
    } catch (error: unknown) {
      const wrappedError = new Error(
        `Failed to load dataset manifest: ${getErrorMessage(error)}`,
      );
      (wrappedError as Error & { cause?: unknown }).cause = error;
      throw wrappedError;
    }
  }

  validateManifest(manifest: ManifestSchema): void {
    const SUPPORTED_MANIFEST_VERSION = 1;
    const SUPPORTED_DATASET_VERSION = 1;
    const SUPPORTED_AGGREGATES_VERSION = 3;

    if (!manifest.manifest_schema_version) {
      throw new Error("Invalid manifest: missing schema version");
    }

    if (manifest.manifest_schema_version > SUPPORTED_MANIFEST_VERSION) {
      throw new Error(
        `Manifest version ${manifest.manifest_schema_version} not supported.`,
      );
    }

    if (
      manifest.dataset_schema_version !== undefined &&
      manifest.dataset_schema_version > SUPPORTED_DATASET_VERSION
    ) {
      throw new Error(
        `Dataset version ${manifest.dataset_schema_version} not supported.`,
      );
    }

    if (
      manifest.aggregates_schema_version !== undefined &&
      manifest.aggregates_schema_version > SUPPORTED_AGGREGATES_VERSION
    ) {
      throw new Error(
        `Aggregates version ${manifest.aggregates_schema_version} not supported.`,
      );
    }
  }

  async loadDimensions(): Promise<DimensionsData> {
    if (this.dimensions) return this.dimensions;
    this.dimensions = (await this.artifactClient.getArtifactFileViaSdk(
      this.buildId,
      this.artifactName,
      "aggregates/dimensions.json",
    )) as DimensionsData;
    if (!this.dimensions) {
      throw new Error("Dimensions file is empty or invalid");
    }
    return this.dimensions;
  }

  async getWeeklyRollups(startDate: Date, endDate: Date): Promise<Rollup[]> {
    if (!this.manifest) throw new Error("Manifest not loaded.");

    const neededWeeks = this.getWeeksInRange(startDate, endDate);
    const results: Rollup[] = [];

    for (const weekStr of neededWeeks) {
      const cachedRollup = this.rollupCache.get(weekStr);
      if (cachedRollup) {
        results.push(cachedRollup);
        continue;
      }

      const indexEntry = this.manifest?.aggregate_index?.weekly_rollups?.find(
        (r) => r.week === weekStr,
      );

      if (!indexEntry) continue;

      try {
        const rollup = (await this.artifactClient.getArtifactFileViaSdk(
          this.buildId,
          this.artifactName,
          indexEntry.path,
        )) as Rollup;
        this.rollupCache.set(weekStr, rollup);
        results.push(rollup);
      } catch (e) {
        console.warn("Failed to load rollup for %s:", weekStr, e);
      }
    }

    return results;
  }

  async getDistributions(
    startDate: Date,
    endDate: Date,
  ): Promise<DistributionData[]> {
    if (!this.manifest) throw new Error("Manifest not loaded.");

    const startYear = startDate.getFullYear();
    const endYear = endDate.getFullYear();
    const results: DistributionData[] = [];

    for (let year = startYear; year <= endYear; year++) {
      const yearStr = String(year);
      const cachedDistribution = this.distributionCache.get(yearStr);
      if (cachedDistribution) {
        results.push(cachedDistribution);
        continue;
      }

      const indexEntry = this.manifest?.aggregate_index?.distributions?.find(
        (d) => d.year === yearStr,
      );

      if (!indexEntry) continue;

      try {
        const dist = (await this.artifactClient.getArtifactFileViaSdk(
          this.buildId,
          this.artifactName,
          indexEntry.path,
        )) as DistributionData;
        this.distributionCache.set(yearStr, dist);
        results.push(dist);
      } catch (e) {
        console.warn("Failed to load distribution for %s:", yearStr, e);
      }
    }

    return results;
  }

  getWeeksInRange(startDate: Date, endDate: Date): string[] {
    const weeks: string[] = [];
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

  getISOWeek(date: Date): string {
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

  getCoverage(): CoverageInfo | null {
    return this.manifest?.coverage || null;
  }

  getDefaultRangeDays(): number {
    return this.manifest?.defaults?.default_date_range_days || 90;
  }

  async loadPredictions(): Promise<PredictionsData> {
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

  async loadInsights(): Promise<InsightsData> {
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

/**
 * Mock implementation for testing.
 */
export class MockArtifactClient {
  public readonly projectId: string = "mock-project";
  public initialized: boolean = true;
  private mockData: Map<string, unknown>;

  constructor(mockData: Record<string, unknown> = {}) {
    this.mockData = new Map(Object.entries(mockData));
  }

  async initialize(): Promise<MockArtifactClient> {
    return this;
  }

  async getArtifactFile(
    buildId: number,
    artifactName: string,
    filePath: string,
  ): Promise<unknown> {
    const key = `${buildId}/${artifactName}/${filePath}`;
    if (this.mockData.has(key)) {
      return JSON.parse(JSON.stringify(this.mockData.get(key)));
    }
    throw new Error(`Mock: File not found: ${key}`);
  }

  async hasArtifactFile(
    buildId: number,
    artifactName: string,
    filePath: string,
  ): Promise<boolean> {
    const key = `${buildId}/${artifactName}/${filePath}`;
    return this.mockData.has(key);
  }

  async getArtifacts(buildId: number): Promise<VSSBuildArtifact[]> {
    return (this.mockData.get(`${buildId}/artifacts`) ?? []) as VSSBuildArtifact[];
  }

  async getDefinitions(): Promise<BuildDefinitionReference[]> {
    return (this.mockData.get("definitions") ?? []) as BuildDefinitionReference[];
  }

  async getBuilds(definitionId: number): Promise<Build[]> {
    return (this.mockData.get(`builds/${definitionId}`) ?? []) as Build[];
  }

  createDatasetLoader(
    buildId: number,
    artifactName: string,
  ): AuthenticatedDatasetLoader {
    return new AuthenticatedDatasetLoader(
      this as unknown as ArtifactClient,
      buildId,
      artifactName,
    );
  }
}

// Browser global exports for runtime compatibility
if (typeof window !== "undefined") {
  window.ArtifactClient = ArtifactClient;
  window.AuthenticatedDatasetLoader = AuthenticatedDatasetLoader;
  window.MockArtifactClient = MockArtifactClient;
}
