/**
 * Artifact Client for PR Insights Hub
 *
 * Provides authenticated access to Azure DevOps pipeline artifacts.
 * Uses the ADO Extension SDK for proper authentication.
 *
 * IMPORTANT: In ADO extension context, plain fetch() will return 401.
 * We must use the SDK's auth token service.
 */

/**
 * Client for accessing pipeline artifacts with authentication.
 */
class ArtifactClient {
    /**
     * Create a new ArtifactClient.
     *
     * @param {string} projectId - Azure DevOps project ID
     */
    constructor(projectId) {
        this.projectId = projectId;
        this.collectionUri = null;
        this.authToken = null;
        this.initialized = false;
    }

    /**
     * Initialize the client with ADO SDK auth.
     * MUST be called after VSS.ready() and before any other methods.
     *
     * @returns {Promise<ArtifactClient>} This client instance
     */
    async initialize() {
        if (this.initialized) {
            return this;
        }

        // Get web context for collection URI
        const webContext = VSS.getWebContext();
        this.collectionUri = webContext.collection.uri;

        // Get auth token from SDK
        const authTokenService = await VSS.getService(VSS.ServiceIds.AuthTokenService);
        this.authToken = await authTokenService.getToken();

        this.initialized = true;
        return this;
    }

    /**
     * Ensure the client is initialized.
     * @private
     */
    _ensureInitialized() {
        if (!this.initialized) {
            throw new Error('ArtifactClient not initialized. Call initialize() first.');
        }
    }

    /**
     * Fetch a file from a build artifact.
     *
     * @param {number} buildId - Build ID
     * @param {string} artifactName - Artifact name (e.g., 'aggregates')
     * @param {string} filePath - Path within artifact (e.g., 'dataset-manifest.json')
     * @returns {Promise<object>} Parsed JSON content
     * @throws {PrInsightsError} On permission denied or not found
     */
    async getArtifactFile(buildId, artifactName, filePath) {
        this._ensureInitialized();

        const url = this._buildFileUrl(buildId, artifactName, filePath);

        const response = await this._authenticatedFetch(url);

        if (response.status === 401 || response.status === 403) {
            throw createPermissionDeniedError('read artifact files');
        }

        if (response.status === 404) {
            throw new Error(`File '${filePath}' not found in artifact '${artifactName}'`);
        }

        if (!response.ok) {
            throw new Error(`Failed to fetch artifact file: ${response.status} ${response.statusText}`);
        }

        return response.json();
    }

    /**
     * Check if a specific file exists in an artifact.
     *
     * @param {number} buildId - Build ID
     * @param {string} artifactName - Artifact name
     * @param {string} filePath - Path within artifact
     * @returns {Promise<boolean>} True if file exists
     */
    async hasArtifactFile(buildId, artifactName, filePath) {
        this._ensureInitialized();

        try {
            const url = this._buildFileUrl(buildId, artifactName, filePath);
            const response = await this._authenticatedFetch(url, { method: 'HEAD' });
            return response.ok;
        } catch {
            return false;
        }
    }

    /**
     * Get list of artifacts for a build.
     *
     * @param {number} buildId - Build ID
     * @returns {Promise<Array>} List of artifact objects
     */
    async getArtifacts(buildId) {
        this._ensureInitialized();

        const url = `${this.collectionUri}${this.projectId}/_apis/build/builds/${buildId}/artifacts?api-version=7.1`;

        const response = await this._authenticatedFetch(url);

        if (response.status === 401 || response.status === 403) {
            throw createPermissionDeniedError('list build artifacts');
        }

        if (!response.ok) {
            throw new Error(`Failed to list artifacts: ${response.status}`);
        }

        const data = await response.json();
        return data.value || [];
    }

    /**
     * Create a DatasetLoader that uses this client for authenticated requests.
     *
     * @param {number} buildId - Build ID to load from
     * @param {string} artifactName - Artifact name containing dataset
     * @returns {AuthenticatedDatasetLoader}
     */
    createDatasetLoader(buildId, artifactName) {
        return new AuthenticatedDatasetLoader(this, buildId, artifactName);
    }

    /**
     * Build the URL for accessing a file within an artifact.
     *
     * Uses the official ADO REST API endpoint:
     * GET {org}/{project}/_apis/build/builds/{buildId}/artifacts?artifactName={name}&$format=file&subPath=/{path}
     *
     * @private
     * @param {number} buildId
     * @param {string} artifactName
     * @param {string} filePath
     * @returns {string}
     */
    _buildFileUrl(buildId, artifactName, filePath) {
        // Ensure filePath starts with /
        const normalizedPath = filePath.startsWith('/') ? filePath : '/' + filePath;

        return `${this.collectionUri}${this.projectId}/_apis/build/builds/${buildId}/artifacts` +
            `?artifactName=${encodeURIComponent(artifactName)}` +
            `&%24format=file` +
            `&subPath=${encodeURIComponent(normalizedPath)}` +
            `&api-version=7.1`;
    }

    /**
     * Perform an authenticated fetch using the ADO auth token.
     *
     * @private
     * @param {string} url
     * @param {object} options - Fetch options
     * @returns {Promise<Response>}
     */
    async _authenticatedFetch(url, options = {}) {
        const headers = {
            'Authorization': `Bearer ${this.authToken}`,
            'Accept': 'application/json',
            ...options.headers
        };

        return fetch(url, { ...options, headers });
    }
}

/**
 * DatasetLoader that uses ArtifactClient for authenticated requests.
 *
 * Provides the same interface as the original DatasetLoader but fetches
 * files from ADO artifacts instead of direct URLs.
 */
class AuthenticatedDatasetLoader {
    /**
     * Create a new AuthenticatedDatasetLoader.
     *
     * @param {ArtifactClient} artifactClient - Initialized artifact client
     * @param {number} buildId - Build ID containing the dataset
     * @param {string} artifactName - Artifact name (typically 'aggregates')
     */
    constructor(artifactClient, buildId, artifactName) {
        this.artifactClient = artifactClient;
        this.buildId = buildId;
        this.artifactName = artifactName;
        this.manifest = null;
        this.dimensions = null;
        this.rollupCache = new Map();
        this.distributionCache = new Map();
    }

    /**
     * Load and validate the dataset manifest.
     *
     * @returns {Promise<object>} The manifest object
     */
    async loadManifest() {
        this.manifest = await this.artifactClient.getArtifactFile(
            this.buildId,
            this.artifactName,
            'dataset-manifest.json'
        );
        this.validateManifest(this.manifest);
        return this.manifest;
    }

    /**
     * Validate manifest schema versions.
     *
     * @param {object} manifest
     * @throws {Error} If versions are incompatible
     */
    validateManifest(manifest) {
        if (!manifest.manifest_schema_version) {
            throw new Error('Invalid manifest: missing schema version');
        }

        // Version compatibility check (from dataset-loader.js)
        const SUPPORTED_MANIFEST_VERSION = 1;
        const SUPPORTED_DATASET_VERSION = 1;
        const SUPPORTED_AGGREGATES_VERSION = 1;

        if (manifest.manifest_schema_version > SUPPORTED_MANIFEST_VERSION) {
            throw new Error(
                `Manifest version ${manifest.manifest_schema_version} not supported. ` +
                `Maximum supported: ${SUPPORTED_MANIFEST_VERSION}. ` +
                `Please update the extension.`
            );
        }

        if (manifest.dataset_schema_version > SUPPORTED_DATASET_VERSION) {
            throw new Error(
                `Dataset version ${manifest.dataset_schema_version} not supported. ` +
                `Please update the extension.`
            );
        }

        if (manifest.aggregates_schema_version > SUPPORTED_AGGREGATES_VERSION) {
            throw new Error(
                `Aggregates version ${manifest.aggregates_schema_version} not supported. ` +
                `Please update the extension.`
            );
        }
    }

    /**
     * Load dimensions (filter values).
     *
     * @returns {Promise<object>}
     */
    async loadDimensions() {
        if (this.dimensions) return this.dimensions;

        this.dimensions = await this.artifactClient.getArtifactFile(
            this.buildId,
            this.artifactName,
            'aggregates/dimensions.json'
        );
        return this.dimensions;
    }

    /**
     * Get weekly rollups for a date range.
     *
     * @param {Date} startDate
     * @param {Date} endDate
     * @returns {Promise<Array>}
     */
    async getWeeklyRollups(startDate, endDate) {
        if (!this.manifest) {
            throw new Error('Manifest not loaded. Call loadManifest() first.');
        }

        const neededWeeks = this.getWeeksInRange(startDate, endDate);
        const results = [];

        for (const weekStr of neededWeeks) {
            // Check cache first
            if (this.rollupCache.has(weekStr)) {
                results.push(this.rollupCache.get(weekStr));
                continue;
            }

            // Find in index
            const indexEntry = this.manifest.aggregate_index?.weekly_rollups?.find(
                r => r.week === weekStr
            );

            if (!indexEntry) {
                continue;
            }

            try {
                const rollup = await this.artifactClient.getArtifactFile(
                    this.buildId,
                    this.artifactName,
                    indexEntry.path
                );
                this.rollupCache.set(weekStr, rollup);
                results.push(rollup);
            } catch (e) {
                console.warn(`Failed to load rollup for ${weekStr}:`, e);
            }
        }

        return results;
    }

    /**
     * Get distributions for a date range.
     *
     * @param {Date} startDate
     * @param {Date} endDate
     * @returns {Promise<Array>}
     */
    async getDistributions(startDate, endDate) {
        if (!this.manifest) {
            throw new Error('Manifest not loaded. Call loadManifest() first.');
        }

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
                d => d.year === yearStr
            );

            if (!indexEntry) {
                continue;
            }

            try {
                const dist = await this.artifactClient.getArtifactFile(
                    this.buildId,
                    this.artifactName,
                    indexEntry.path
                );
                this.distributionCache.set(yearStr, dist);
                results.push(dist);
            } catch (e) {
                console.warn(`Failed to load distribution for ${yearStr}:`, e);
            }
        }

        return results;
    }

    /**
     * Get weeks in a date range as ISO week strings.
     *
     * @param {Date} startDate
     * @param {Date} endDate
     * @returns {Array<string>}
     */
    getWeeksInRange(startDate, endDate) {
        const weeks = [];
        const current = new Date(startDate);

        // Move to Monday of the week
        const day = current.getDay();
        const diff = current.getDate() - day + (day === 0 ? -6 : 1);
        current.setDate(diff);

        while (current <= endDate) {
            weeks.push(this.getISOWeek(current));
            current.setDate(current.getDate() + 7);
        }

        return weeks;
    }

    /**
     * Get ISO week string for a date.
     *
     * @param {Date} date
     * @returns {string} Format: "YYYY-WNN"
     */
    getISOWeek(date) {
        const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
        const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
        const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
        return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
    }

    /**
     * Get dataset coverage from manifest.
     *
     * @returns {object|null}
     */
    getCoverage() {
        return this.manifest?.coverage || null;
    }

    /**
     * Get default date range days from manifest.
     *
     * @returns {number}
     */
    getDefaultRangeDays() {
        return this.manifest?.ui_defaults?.default_range_days || 90;
    }
}

/**
 * Mock implementation for testing.
 */
class MockArtifactClient {
    constructor(mockData = {}) {
        this.mockData = mockData;
        this.projectId = 'mock-project';
        this.initialized = true;
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

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        ArtifactClient,
        AuthenticatedDatasetLoader,
        MockArtifactClient
    };
}
