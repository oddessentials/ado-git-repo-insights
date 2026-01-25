"use strict";
var PRInsightsDashboard = (() => {
  // ui/types.ts
  function isErrorWithMessage(error) {
    return typeof error === "object" && error !== null && "message" in error && typeof error.message === "string";
  }
  function getErrorMessage(error) {
    if (isErrorWithMessage(error)) return error.message;
    if (typeof error === "string") return error;
    return "Unknown error";
  }
  function hasMLMethods(loader2) {
    return typeof loader2 === "object" && loader2 !== null && typeof loader2.loadPredictions === "function" && typeof loader2.loadInsights === "function";
  }

  // ui/dataset-loader.ts
  var SUPPORTED_MANIFEST_VERSION = 1;
  var SUPPORTED_DATASET_VERSION = 1;
  var SUPPORTED_AGGREGATES_VERSION = 1;
  var DATASET_CANDIDATE_PATHS = [
    "",
    // Root of provided base URL (preferred)
    "aggregates"
    // Single nesting (legacy ADO artifact download)
  ];
  var ROLLUP_FIELD_DEFAULTS = {
    pr_count: 0,
    cycle_time_p50: null,
    cycle_time_p90: null,
    authors_count: 0,
    reviewers_count: 0,
    by_repository: null,
    // null indicates feature not available
    by_team: null
    // null indicates feature not available
  };
  function normalizeRollup(rollup) {
    if (!rollup || typeof rollup !== "object") {
      return { week: "unknown", ...ROLLUP_FIELD_DEFAULTS };
    }
    const r = rollup;
    return {
      // Preserve all existing fields
      ...r,
      // Ensure required fields have defaults (don't override if already set)
      pr_count: r.pr_count ?? ROLLUP_FIELD_DEFAULTS.pr_count,
      cycle_time_p50: r.cycle_time_p50 ?? ROLLUP_FIELD_DEFAULTS.cycle_time_p50,
      cycle_time_p90: r.cycle_time_p90 ?? ROLLUP_FIELD_DEFAULTS.cycle_time_p90,
      authors_count: r.authors_count ?? ROLLUP_FIELD_DEFAULTS.authors_count,
      reviewers_count: r.reviewers_count ?? ROLLUP_FIELD_DEFAULTS.reviewers_count,
      // by_repository and by_team are optional features - preserve null if missing
      by_repository: r.by_repository !== void 0 ? r.by_repository : null,
      by_team: r.by_team !== void 0 ? r.by_team : null
    };
  }
  function normalizeRollups(rollups) {
    if (!Array.isArray(rollups)) {
      return [];
    }
    return rollups.map(normalizeRollup);
  }
  var fetchSemaphore = {
    maxConcurrent: 4,
    maxRetries: 1,
    retryDelayMs: 200,
    active: 0,
    queue: [],
    /**
     * Acquire a semaphore slot. Blocks until slot available.
     * @returns {Promise<void>}
     */
    acquire() {
      return new Promise((resolve) => {
        if (this.active < this.maxConcurrent) {
          this.active++;
          resolve();
        } else {
          this.queue.push(resolve);
        }
      });
    },
    /**
     * Release a semaphore slot. Unblocks next waiter if any.
     */
    release() {
      const next = this.queue.shift();
      if (next) {
        next();
      } else {
        this.active--;
      }
    },
    /**
     * Get current state (for testing).
     * @returns {{ active: number, queued: number }}
     */
    getState() {
      return { active: this.active, queued: this.queue.length };
    },
    /**
     * Reset semaphore state (for testing).
     */
    reset() {
      this.active = 0;
      this.queue = [];
    }
  };
  function createRollupCache(clock = Date.now) {
    const maxSize = 52;
    const ttlMs = 5 * 60 * 1e3;
    const entries = /* @__PURE__ */ new Map();
    const requiredKeyFields = ["week", "org", "project", "repo"];
    return {
      maxSize,
      ttlMs,
      clock,
      /**
       * Build composite cache key. Throws if required params missing.
       */
      makeKey(params) {
        for (const field of requiredKeyFields) {
          if (!params[field]) {
            throw new Error(`Cache key missing required field: ${field}`);
          }
        }
        const {
          week,
          org,
          project,
          repo,
          branch = "",
          apiVersion = "1"
        } = params;
        return `${week}|${org}|${project}|${repo}|${branch}|${apiVersion}`;
      },
      /**
       * Get cached value if valid.
       */
      get(key) {
        const entry = entries.get(key);
        if (!entry) return void 0;
        const now = clock();
        if (now - entry.createdAt > ttlMs) {
          entries.delete(key);
          return void 0;
        }
        entry.touchedAt = now;
        return entry.value;
      },
      /**
       * Set cache value, evicting oldest if at capacity.
       */
      set(key, value) {
        const now = clock();
        if (entries.size >= maxSize && !entries.has(key)) {
          let oldestKey = null;
          let oldestTime = Infinity;
          for (const [k, v] of entries) {
            if (v.touchedAt < oldestTime) {
              oldestTime = v.touchedAt;
              oldestKey = k;
            }
          }
          if (oldestKey) entries.delete(oldestKey);
        }
        entries.set(key, {
          value,
          createdAt: now,
          touchedAt: now
        });
      },
      /**
       * Check if key exists and is not expired.
       */
      has(key) {
        return this.get(key) !== void 0;
      },
      /**
       * Clear all entries.
       */
      clear() {
        entries.clear();
      },
      /**
       * Get cache size.
       */
      size() {
        return entries.size;
      }
    };
  }
  var DatasetLoader = class {
    // year -> data
    constructor(baseUrl) {
      this.effectiveBaseUrl = null;
      // Resolved after probing
      this.manifest = null;
      this.dimensions = null;
      this.rollupCache = /* @__PURE__ */ new Map();
      // week -> data
      this.distributionCache = /* @__PURE__ */ new Map();
      this.baseUrl = baseUrl || "";
      this.effectiveBaseUrl = null;
    }
    /**
     * Resolve the dataset root by probing candidate paths for manifest.
     * Caches the result for subsequent path resolutions.
     * @returns The effective base URL or null if not found
     */
    async resolveDatasetRoot() {
      if (this.effectiveBaseUrl !== null) {
        return this.effectiveBaseUrl || null;
      }
      for (const candidate of DATASET_CANDIDATE_PATHS) {
        const candidateBase = candidate ? `${this.baseUrl}/${candidate}` : this.baseUrl;
        const manifestUrl = candidateBase ? `${candidateBase}/dataset-manifest.json` : "dataset-manifest.json";
        try {
          const response = await fetch(manifestUrl, { method: "HEAD" });
          if (response.ok) {
            console.log(`[DatasetLoader] Found manifest at: ${manifestUrl}`);
            this.effectiveBaseUrl = candidateBase;
            return candidateBase;
          }
        } catch {
        }
      }
      console.warn(
        "[DatasetLoader] No manifest found in candidate paths, using baseUrl as fallback"
      );
      this.effectiveBaseUrl = this.baseUrl;
      return null;
    }
    /**
     * Load and validate the dataset manifest.
     * Automatically resolves nested dataset root before loading.
     */
    async loadManifest() {
      if (this.effectiveBaseUrl === null) {
        await this.resolveDatasetRoot();
      }
      const url = this.resolvePath("dataset-manifest.json");
      const response = await fetch(url);
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(
            "Dataset not found. Ensure the analytics pipeline has run successfully."
          );
        }
        throw new Error(
          `Failed to load manifest: ${response.status} ${response.statusText}`
        );
      }
      const manifest = await response.json();
      this.validateManifest(manifest);
      this.manifest = manifest;
      return manifest;
    }
    /**
     * Validate manifest schema versions.
     */
    validateManifest(manifest) {
      if (!manifest.manifest_schema_version) {
        throw new Error("Invalid manifest: missing schema version");
      }
      if (manifest.manifest_schema_version > SUPPORTED_MANIFEST_VERSION) {
        throw new Error(
          `Manifest version ${manifest.manifest_schema_version} not supported. Maximum supported: ${SUPPORTED_MANIFEST_VERSION}. Please update the extension.`
        );
      }
      if (manifest.dataset_schema_version !== void 0 && manifest.dataset_schema_version > SUPPORTED_DATASET_VERSION) {
        throw new Error(
          `Dataset version ${manifest.dataset_schema_version} not supported. Please update the extension.`
        );
      }
      if (manifest.aggregates_schema_version !== void 0 && manifest.aggregates_schema_version > SUPPORTED_AGGREGATES_VERSION) {
        throw new Error(
          `Aggregates version ${manifest.aggregates_schema_version} not supported. Please update the extension.`
        );
      }
    }
    /**
     * Load dimensions (filter values).
     */
    async loadDimensions() {
      if (this.dimensions) return this.dimensions;
      const url = this.resolvePath("aggregates/dimensions.json");
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to load dimensions: ${response.status}`);
      }
      this.dimensions = await response.json();
      return this.dimensions;
    }
    /**
     * Get weekly rollups for a date range.
     * Implements lazy loading with caching.
     */
    async getWeeklyRollups(startDate, endDate) {
      if (!this.manifest) {
        throw new Error("Manifest not loaded. Call loadManifest() first.");
      }
      const neededWeeks = this.getWeeksInRange(startDate, endDate);
      const results = [];
      for (const weekStr of neededWeeks) {
        const cached = this.rollupCache.get(weekStr);
        if (cached) {
          results.push(cached);
          continue;
        }
        const indexEntry = this.manifest?.aggregate_index?.weekly_rollups?.find(
          (r) => r.week === weekStr
        );
        if (!indexEntry) {
          continue;
        }
        const url = this.resolvePath(indexEntry.path);
        const response = await fetch(url);
        if (response.ok) {
          const rawData = await response.json();
          const data = normalizeRollup(rawData);
          this.rollupCache.set(weekStr, data);
          results.push(data);
        }
      }
      return results.sort((a, b) => a.week.localeCompare(b.week));
    }
    /**
     * Get weekly rollups with concurrent fetching, progress reporting, and caching (Phase 4).
     */
    async getWeeklyRollupsWithProgress(startDate, endDate, context, onProgress = () => {
    }, cache = null) {
      if (!this.manifest) {
        throw new Error("Manifest not loaded. Call loadManifest() first.");
      }
      const allWeeks = this.getWeeksInRange(startDate, endDate);
      const data = [];
      const missingWeeks = [];
      const failedWeeks = [];
      let authError = false;
      const useCache = cache || {
        makeKey: (params) => params.week,
        get: (key) => this.rollupCache.get(key),
        set: (key, value) => this.rollupCache.set(key, value),
        has: (key) => this.rollupCache.has(key),
        maxSize: Infinity,
        ttlMs: Infinity,
        clock: Date.now,
        clear: () => this.rollupCache.clear(),
        size: () => this.rollupCache.size
      };
      const cachedResults = [];
      const weeksToFetch = [];
      for (const weekStr of allWeeks) {
        try {
          const cacheKey = useCache.makeKey({ week: weekStr, ...context });
          const cached = useCache.get(cacheKey);
          if (cached !== void 0) {
            cachedResults.push(cached);
          } else {
            weeksToFetch.push(weekStr);
          }
        } catch {
          weeksToFetch.push(weekStr);
        }
      }
      const batches = [];
      for (let i = 0; i < weeksToFetch.length; i += fetchSemaphore.maxConcurrent) {
        batches.push(weeksToFetch.slice(i, i + fetchSemaphore.maxConcurrent));
      }
      let loaded = 0;
      const total = weeksToFetch.length;
      for (const batch of batches) {
        const batchPromises = batch.map(async (weekStr) => {
          onProgress({ loaded, total, currentWeek: weekStr });
          const indexEntry = this.manifest?.aggregate_index?.weekly_rollups?.find(
            (r) => r.week === weekStr
          );
          if (!indexEntry) {
            return { week: weekStr, status: "missing" };
          }
          return await this._fetchWeekWithRetry(
            weekStr,
            indexEntry,
            context,
            useCache
          );
        });
        const results = await Promise.allSettled(batchPromises);
        for (const result of results) {
          loaded++;
          if (result.status === "fulfilled") {
            const outcome = result.value;
            if (outcome.status === "ok") {
              data.push(outcome.data);
            } else if (outcome.status === "missing") {
              missingWeeks.push(outcome.week);
            } else if (outcome.status === "auth") {
              authError = true;
            } else if (outcome.status === "failed") {
              failedWeeks.push(outcome.week);
            }
          } else {
            failedWeeks.push("unknown");
          }
        }
      }
      const allData = [...cachedResults, ...data];
      const partial = missingWeeks.length > 0 || failedWeeks.length > 0;
      const degraded = partial || authError;
      if (authError && allData.length === 0) {
        const error = new Error("Authentication required");
        error.code = "AUTH_REQUIRED";
        throw error;
      }
      onProgress({ loaded: total, total, currentWeek: null });
      return {
        data: allData.sort((a, b) => a.week.localeCompare(b.week)),
        missingWeeks,
        failedWeeks,
        partial,
        authError,
        degraded
      };
    }
    /**
     * Fetch a single week with semaphore control and bounded retry.
     */
    async _fetchWeekWithRetry(weekStr, indexEntry, context, cache) {
      let retries = 0;
      while (retries <= fetchSemaphore.maxRetries) {
        await fetchSemaphore.acquire();
        try {
          const url = this.resolvePath(indexEntry.path);
          const response = await fetch(url);
          if (response.ok) {
            const rawData = await response.json();
            const data = normalizeRollup(rawData);
            try {
              const cacheKey = cache.makeKey({ week: weekStr, ...context });
              cache.set(cacheKey, data);
            } catch {
            }
            return { week: weekStr, status: "ok", data };
          }
          if (response.status === 401 || response.status === 403) {
            return { week: weekStr, status: "auth" };
          }
          if (response.status === 404) {
            return { week: weekStr, status: "missing" };
          }
          if (response.status >= 500 && retries < fetchSemaphore.maxRetries) {
            retries++;
            await this._delay(fetchSemaphore.retryDelayMs);
            continue;
          }
          return { week: weekStr, status: "failed", error: `HTTP ${response.status}` };
        } catch (err) {
          if (retries < fetchSemaphore.maxRetries) {
            retries++;
            await this._delay(fetchSemaphore.retryDelayMs);
            continue;
          }
          return { week: weekStr, status: "failed", error: getErrorMessage(err) };
        } finally {
          fetchSemaphore.release();
        }
      }
      return { week: weekStr, status: "failed", error: "max retries exceeded" };
    }
    /**
     * Delay helper for retry backoff.
     */
    _delay(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }
    /**
     * Get yearly distributions for a date range.
     */
    async getDistributions(startDate, endDate) {
      if (!this.manifest) {
        throw new Error("Manifest not loaded. Call loadManifest() first.");
      }
      const startYear = startDate.getFullYear();
      const endYear = endDate.getFullYear();
      const results = [];
      for (let year = startYear; year <= endYear; year++) {
        const yearStr = year.toString();
        const cached = this.distributionCache.get(yearStr);
        if (cached) {
          results.push(cached);
          continue;
        }
        const indexEntry = this.manifest?.aggregate_index?.distributions?.find(
          (d) => d.year === yearStr
        );
        if (!indexEntry) continue;
        const url = this.resolvePath(indexEntry.path);
        const response = await fetch(url);
        if (response.ok) {
          const data = await response.json();
          this.distributionCache.set(yearStr, data);
          results.push(data);
        }
      }
      return results;
    }
    /**
     * Check if a feature is enabled in the dataset.
     */
    isFeatureEnabled(feature) {
      if (!this.manifest) return false;
      return this.manifest.features?.[feature] === true;
    }
    /**
     * Get dataset coverage info.
     */
    getCoverage() {
      if (!this.manifest) return null;
      return this.manifest.coverage ?? null;
    }
    /**
     * Get default date range days.
     */
    getDefaultRangeDays() {
      return this.manifest?.defaults?.default_date_range_days || 90;
    }
    /**
     * Load predictions data (Phase 3.5).
     */
    async loadPredictions() {
      if (!this.isFeatureEnabled("predictions")) {
        return { state: "disabled" };
      }
      try {
        const url = this.resolvePath("predictions/trends.json");
        const response = await fetch(url);
        if (!response.ok) {
          if (response.status === 404) {
            return { state: "missing" };
          }
          if (response.status === 401 || response.status === 403) {
            return { state: "auth" };
          }
          return {
            state: "error",
            error: "PRED_003",
            message: `HTTP ${response.status}`
          };
        }
        const predictions = await response.json();
        const validationResult = this.validatePredictionsSchema(predictions);
        if (!validationResult.valid) {
          console.error(
            "[DatasetLoader] Invalid predictions schema:",
            validationResult.error
          );
          return {
            state: "invalid",
            error: "PRED_001",
            message: validationResult.error
          };
        }
        return { state: "ok", data: predictions };
      } catch (err) {
        console.error("[DatasetLoader] Error loading predictions:", err);
        return { state: "error", error: "PRED_002", message: getErrorMessage(err) };
      }
    }
    /**
     * Load AI insights data (Phase 3.5).
     */
    async loadInsights() {
      if (!this.isFeatureEnabled("ai_insights")) {
        return { state: "disabled" };
      }
      try {
        const url = this.resolvePath("insights/summary.json");
        const response = await fetch(url);
        if (!response.ok) {
          if (response.status === 404) {
            return { state: "missing" };
          }
          if (response.status === 401 || response.status === 403) {
            return { state: "auth" };
          }
          return {
            state: "error",
            error: "AI_003",
            message: `HTTP ${response.status}`
          };
        }
        const insights = await response.json();
        const validationResult = this.validateInsightsSchema(insights);
        if (!validationResult.valid) {
          console.error(
            "[DatasetLoader] Invalid insights schema:",
            validationResult.error
          );
          return {
            state: "invalid",
            error: "AI_001",
            message: validationResult.error
          };
        }
        return { state: "ok", data: insights };
      } catch (err) {
        console.error("[DatasetLoader] Error loading insights:", err);
        return { state: "error", error: "AI_002", message: getErrorMessage(err) };
      }
    }
    /**
     * Validate predictions schema.
     */
    validatePredictionsSchema(predictions) {
      if (!predictions || typeof predictions !== "object")
        return { valid: false, error: "Missing predictions data" };
      const p = predictions;
      if (typeof p.schema_version !== "number") {
        return { valid: false, error: "Missing schema_version" };
      }
      if (p.schema_version > 1) {
        return {
          valid: false,
          error: `Unsupported schema version: ${p.schema_version}`
        };
      }
      if (!Array.isArray(p.forecasts)) {
        return { valid: false, error: "Missing forecasts array" };
      }
      for (const forecast of p.forecasts) {
        if (!forecast.metric || !forecast.unit || !Array.isArray(forecast.values)) {
          return { valid: false, error: "Invalid forecast structure" };
        }
      }
      return { valid: true };
    }
    /**
     * Validate insights schema.
     */
    validateInsightsSchema(insights) {
      if (!insights || typeof insights !== "object")
        return { valid: false, error: "Missing insights data" };
      const i = insights;
      if (typeof i.schema_version !== "number") {
        return { valid: false, error: "Missing schema_version" };
      }
      if (i.schema_version > 1) {
        return {
          valid: false,
          error: `Unsupported schema version: ${i.schema_version}`
        };
      }
      if (!Array.isArray(i.insights)) {
        return { valid: false, error: "Missing insights array" };
      }
      for (const insight of i.insights) {
        if (!insight.id || !insight.category || !insight.severity || !insight.title) {
          return { valid: false, error: "Invalid insight structure" };
        }
      }
      return { valid: true };
    }
    /**
     * Resolve a relative path to full URL.
     * Uses effectiveBaseUrl if resolved, otherwise falls back to baseUrl.
     */
    resolvePath(relativePath) {
      const base = this.effectiveBaseUrl !== null ? this.effectiveBaseUrl : this.baseUrl;
      if (base) {
        return `${base}/${relativePath}`;
      }
      return relativePath;
    }
    /**
     * Get ISO week strings for a date range.
     */
    getWeeksInRange(start, end) {
      const weeks = [];
      const current = new Date(start);
      while (current <= end) {
        const weekStr = this.getISOWeek(current);
        if (!weeks.includes(weekStr)) {
          weeks.push(weekStr);
        }
        current.setDate(current.getDate() + 7);
      }
      const endWeek = this.getISOWeek(end);
      if (!weeks.includes(endWeek)) {
        weeks.push(endWeek);
      }
      return weeks;
    }
    /**
     * Get ISO week string for a date.
     */
    getISOWeek(date) {
      const d = new Date(
        Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
      );
      const dayNum = d.getUTCDay() || 7;
      d.setUTCDate(d.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      const weekNo = Math.ceil(
        ((d.getTime() - yearStart.getTime()) / 864e5 + 1) / 7
      );
      return `${d.getUTCFullYear()}-W${weekNo.toString().padStart(2, "0")}`;
    }
  };
  if (typeof window !== "undefined") {
    window.DatasetLoader = DatasetLoader;
    window.fetchSemaphore = fetchSemaphore;
    window.createRollupCache = createRollupCache;
    window.normalizeRollup = normalizeRollup;
    window.normalizeRollups = normalizeRollups;
    window.ROLLUP_FIELD_DEFAULTS = ROLLUP_FIELD_DEFAULTS;
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
  function createSetupRequiredError() {
    return new PrInsightsError(
      ErrorTypes.SETUP_REQUIRED,
      "Setup Required",
      "No PR Insights pipeline found in this project.",
      {
        instructions: [
          "Create a pipeline from pr-insights-pipeline.yml",
          'Ensure it publishes an "aggregates" artifact',
          "Run it at least once successfully",
          "Return here to view your dashboard"
        ],
        docsUrl: "https://github.com/oddessentials/ado-git-repo-insights#setup"
      }
    );
  }
  function createNoSuccessfulBuildsError(pipelineName) {
    return new PrInsightsError(
      ErrorTypes.NO_SUCCESSFUL_BUILDS,
      "No Successful Runs",
      `Pipeline "${pipelineName}" has no successful builds.`,
      {
        instructions: [
          "Check the pipeline for errors",
          "Run it manually and ensure extraction completes",
          'Note: "Partially Succeeded" builds are acceptable - first runs may show this status because no prior database artifact exists yet, but extraction still works',
          "Return here after a successful or partially successful run"
        ]
      }
    );
  }
  function createArtifactsMissingError(pipelineName, buildId) {
    return new PrInsightsError(
      ErrorTypes.ARTIFACTS_MISSING,
      "Aggregates Not Found",
      `Build #${buildId} of "${pipelineName}" does not have an aggregates artifact.`,
      {
        instructions: [
          "Add generateAggregates: true to your ExtractPullRequests task",
          "Add a PublishPipelineArtifact step for the aggregates directory",
          "Re-run the pipeline"
        ]
      }
    );
  }
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
  function createInvalidConfigError(param, value, reason) {
    let hint;
    if (param === "pipelineId") {
      hint = "pipelineId must be a positive integer (e.g., ?pipelineId=123)";
    } else if (param === "dataset") {
      hint = "dataset must be a valid HTTPS URL";
    } else {
      hint = "Check the parameter value and try again";
    }
    return new PrInsightsError(
      ErrorTypes.INVALID_CONFIG,
      "Invalid Configuration",
      `Invalid value for ${param}: "${value}"`,
      {
        reason,
        hint
      }
    );
  }
  if (typeof window !== "undefined") {
    window.PrInsightsError = PrInsightsError;
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
      const artifact = artifacts.find((a) => a.name === artifactName);
      if (!artifact) {
        console.log(
          `[getArtifactMetadata] Artifact '${artifactName}' not found in build ${buildId}`
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
    constructor(artifactClient2, buildId, artifactName) {
      this.manifest = null;
      this.dimensions = null;
      this.rollupCache = /* @__PURE__ */ new Map();
      this.distributionCache = /* @__PURE__ */ new Map();
      this.artifactClient = artifactClient2;
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
        if (this.manifest) {
          this.validateManifest(this.manifest);
        }
        return this.manifest;
      } catch (error) {
        throw new Error(`Failed to load dataset manifest: ${getErrorMessage(error)}`);
      }
    }
    validateManifest(manifest) {
      const SUPPORTED_MANIFEST_VERSION2 = 1;
      const SUPPORTED_DATASET_VERSION2 = 1;
      const SUPPORTED_AGGREGATES_VERSION2 = 1;
      if (!manifest.manifest_schema_version) {
        throw new Error("Invalid manifest: missing schema version");
      }
      if (manifest.manifest_schema_version > SUPPORTED_MANIFEST_VERSION2) {
        throw new Error(
          `Manifest version ${manifest.manifest_schema_version} not supported.`
        );
      }
      if (manifest.dataset_schema_version !== void 0 && manifest.dataset_schema_version > SUPPORTED_DATASET_VERSION2) {
        throw new Error(
          `Dataset version ${manifest.dataset_schema_version} not supported.`
        );
      }
      if (manifest.aggregates_schema_version !== void 0 && manifest.aggregates_schema_version > SUPPORTED_AGGREGATES_VERSION2) {
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
      return new AuthenticatedDatasetLoader(this, buildId, artifactName);
    }
  };
  if (typeof window !== "undefined") {
    window.ArtifactClient = ArtifactClient;
    window.AuthenticatedDatasetLoader = AuthenticatedDatasetLoader;
    window.MockArtifactClient = MockArtifactClient;
  }

  // ui/modules/shared/format.ts
  function formatDuration(minutes) {
    if (minutes < 60) {
      return `${Math.round(minutes)}m`;
    }
    const hours = minutes / 60;
    if (hours < 24) {
      return `${hours.toFixed(1)}h`;
    }
    const days = hours / 24;
    return `${days.toFixed(1)}d`;
  }
  function median(arr) {
    if (!Array.isArray(arr) || arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] ?? 0 : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  }

  // ui/modules/shared/security.ts
  function escapeHtml(text) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  // ui/modules/metrics.ts
  function calculateMetrics(rollups) {
    if (!rollups || !rollups.length) {
      return {
        totalPrs: 0,
        cycleP50: null,
        cycleP90: null,
        avgAuthors: 0,
        avgReviewers: 0
      };
    }
    const totalPrs = rollups.reduce((sum, r) => sum + (r.pr_count || 0), 0);
    const p50Values = rollups.map((r) => r.cycle_time_p50).filter((v) => v !== null && v !== void 0);
    const p90Values = rollups.map((r) => r.cycle_time_p90).filter((v) => v !== null && v !== void 0);
    const authorsSum = rollups.reduce(
      (sum, r) => sum + (r.authors_count || 0),
      0
    );
    const reviewersSum = rollups.reduce(
      (sum, r) => sum + (r.reviewers_count || 0),
      0
    );
    return {
      totalPrs,
      cycleP50: p50Values.length ? median(p50Values) : null,
      cycleP90: p90Values.length ? median(p90Values) : null,
      avgAuthors: rollups.length > 0 ? Math.round(authorsSum / rollups.length) : 0,
      avgReviewers: rollups.length > 0 ? Math.round(reviewersSum / rollups.length) : 0
    };
  }
  function calculatePercentChange(current, previous) {
    if (previous === null || previous === void 0 || previous === 0) {
      return null;
    }
    if (current === null || current === void 0) {
      return null;
    }
    return (current - previous) / previous * 100;
  }
  function getPreviousPeriod(start, end) {
    const rangeDays = Math.ceil(
      (end.getTime() - start.getTime()) / (1e3 * 60 * 60 * 24)
    );
    const prevEnd = new Date(start.getTime() - 1);
    const prevStart = new Date(prevEnd.getTime() - rangeDays * 24 * 60 * 60 * 1e3);
    return { start: prevStart, end: prevEnd };
  }
  function applyFiltersToRollups(rollups, filters) {
    if (!filters.repos.length && !filters.teams.length) {
      return rollups;
    }
    return rollups.map((rollup) => {
      if (filters.repos.length && rollup.by_repository && typeof rollup.by_repository === "object") {
        const selectedRepos = filters.repos.map((repoId) => {
          const repoData = rollup.by_repository[repoId];
          if (repoData) return repoData;
          return Object.entries(rollup.by_repository).find(
            ([name]) => name === repoId
          )?.[1];
        }).filter((r) => r !== void 0);
        if (selectedRepos.length === 0) {
          return {
            ...rollup,
            pr_count: 0,
            cycle_time_p50: null,
            cycle_time_p90: null,
            authors_count: 0,
            reviewers_count: 0
          };
        }
        const totalPrCount = selectedRepos.reduce(
          (sum, count) => sum + count,
          0
        );
        return {
          ...rollup,
          pr_count: totalPrCount
          // NOTE: cycle_time/authors/reviewers preserved from unfiltered rollup
          // as we don't have per-repo breakdown for these metrics
        };
      }
      if (filters.teams.length && rollup.by_team && typeof rollup.by_team === "object") {
        const selectedTeams = filters.teams.map((teamId) => rollup.by_team[teamId]).filter((t) => t !== void 0);
        if (selectedTeams.length === 0) {
          return {
            ...rollup,
            pr_count: 0,
            cycle_time_p50: null,
            cycle_time_p90: null,
            authors_count: 0,
            reviewers_count: 0
          };
        }
        const totalPrCount = selectedTeams.reduce(
          (sum, count) => sum + count,
          0
        );
        return {
          ...rollup,
          pr_count: totalPrCount
          // NOTE: cycle_time/authors/reviewers preserved from unfiltered rollup
          // as we don't have per-team breakdown for these metrics
        };
      }
      return rollup;
    });
  }
  function extractSparklineData(rollups) {
    return {
      prCounts: rollups.map((r) => r.pr_count || 0),
      p50s: rollups.map((r) => r.cycle_time_p50 || 0),
      p90s: rollups.map((r) => r.cycle_time_p90 || 0),
      authors: rollups.map((r) => r.authors_count || 0),
      reviewers: rollups.map((r) => r.reviewers_count || 0)
    };
  }
  function calculateMovingAverage(values, window2 = 4) {
    return values.map((_, i) => {
      if (i < window2 - 1) return null;
      const slice = values.slice(i - window2 + 1, i + 1);
      const sum = slice.reduce((a, b) => a + b, 0);
      return sum / window2;
    });
  }

  // ui/modules/ml.ts
  var SEVERITY_ICONS = {
    critical: "\u{1F534}",
    warning: "\u{1F7E1}",
    info: "\u{1F535}"
  };
  function renderPredictions(container, predictions) {
    if (!container) return;
    if (!predictions) return;
    const content = document.createElement("div");
    content.className = "predictions-content";
    if (predictions.is_stub) {
      content.innerHTML += `<div class="stub-warning">\u26A0\uFE0F Demo data</div>`;
    }
    predictions.forecasts.forEach((forecast) => {
      const label = forecast.metric.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      content.innerHTML += `
            <div class="forecast-section">
                <h4>${escapeHtml(label)} (${escapeHtml(String(forecast.unit))})</h4>
                <table class="forecast-table">
                    <thead><tr><th>Week</th><th>Predicted</th><th>Range</th></tr></thead>
                    <tbody>
                        ${forecast.values.map(
        (v) => `
                            <tr>
                                <td>${escapeHtml(String(v.period_start))}</td>
                                <td>${escapeHtml(String(v.predicted))}</td>
                                <td>${escapeHtml(String(v.lower_bound))} - ${escapeHtml(String(v.upper_bound))}</td>
                            </tr>
                        `
      ).join("")}
                    </tbody>
                </table>
            </div>
        `;
    });
    const unavailable = container.querySelector(".feature-unavailable");
    if (unavailable) unavailable.classList.add("hidden");
    container.appendChild(content);
  }
  function renderAIInsights(container, insights) {
    if (!container) return;
    if (!insights) return;
    const content = document.createElement("div");
    content.className = "insights-content";
    if (insights.is_stub) {
      content.innerHTML += `<div class="stub-warning">\u26A0\uFE0F Demo data</div>`;
    }
    ["critical", "warning", "info"].forEach((severity) => {
      const items = insights.insights.filter(
        (i) => i.severity === severity
      );
      if (!items.length) return;
      content.innerHTML += `
            <div class="severity-section">
                <h4>${SEVERITY_ICONS[severity]} ${severity.charAt(0).toUpperCase() + severity.slice(1)}</h4>
                <div class="insight-cards">
                    ${items.map(
        (i) => `
                        <div class="insight-card ${escapeHtml(String(i.severity))}">
                            <div class="insight-category">${escapeHtml(String(i.category))}</div>
                            <h5>${escapeHtml(String(i.title))}</h5>
                            <p>${escapeHtml(String(i.description))}</p>
                        </div>
                    `
      ).join("")}
                </div>
            </div>
        `;
    });
    const unavailable = container.querySelector(".feature-unavailable");
    if (unavailable) unavailable.classList.add("hidden");
    container.appendChild(content);
  }

  // ui/modules/charts.ts
  function renderDelta(element, percentChange, inverse = false) {
    if (!element) return;
    if (percentChange === null) {
      element.innerHTML = "";
      element.className = "metric-delta";
      return;
    }
    const isNeutral = Math.abs(percentChange) < 2;
    const isPositive = percentChange > 0;
    const absChange = Math.abs(percentChange);
    let cssClass = "metric-delta ";
    let arrow = "";
    if (isNeutral) {
      cssClass += "delta-neutral";
      arrow = "~";
    } else if (isPositive) {
      cssClass += inverse ? "delta-negative-inverse" : "delta-positive";
      arrow = "&#9650;";
    } else {
      cssClass += inverse ? "delta-positive-inverse" : "delta-negative";
      arrow = "&#9660;";
    }
    const sign = isPositive ? "+" : "";
    element.className = cssClass;
    element.innerHTML = `<span class="delta-arrow">${arrow}</span> ${sign}${absChange.toFixed(0)}% <span class="delta-label">vs prev</span>`;
  }
  function renderSparkline(element, values) {
    if (!element || !values || values.length < 2) {
      if (element) element.innerHTML = "";
      return;
    }
    const data = values.slice(-8);
    const width = 60;
    const height = 24;
    const padding = 2;
    const minVal = Math.min(...data);
    const maxVal = Math.max(...data);
    const range = maxVal - minVal || 1;
    const points = data.map((val, i) => {
      const x = padding + i / (data.length - 1) * (width - padding * 2);
      const y = height - padding - (val - minVal) / range * (height - padding * 2);
      return { x, y };
    });
    const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
    const areaD = pathD + ` L ${points[points.length - 1].x.toFixed(1)} ${height - padding} L ${points[0].x.toFixed(1)} ${height - padding} Z`;
    const lastPoint = points[points.length - 1];
    element.innerHTML = `
        <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
            <path class="sparkline-area" d="${areaD}"/>
            <path class="sparkline-line" d="${pathD}"/>
            <circle class="sparkline-dot" cx="${lastPoint.x.toFixed(1)}" cy="${lastPoint.y.toFixed(1)}" r="2"/>
        </svg>
    `;
  }
  function addChartTooltips(container, contentFn) {
    const dots = container.querySelectorAll("[data-tooltip]");
    dots.forEach((dot) => {
      dot.addEventListener("mouseenter", () => {
        const content = contentFn(dot);
        const tooltip = document.createElement("div");
        tooltip.className = "chart-tooltip";
        tooltip.innerHTML = content;
        tooltip.style.position = "absolute";
        const rect = dot.getBoundingClientRect();
        tooltip.style.left = `${rect.left + rect.width / 2}px`;
        tooltip.style.top = `${rect.top - 8}px`;
        tooltip.style.transform = "translateX(-50%) translateY(-100%)";
        document.body.appendChild(tooltip);
        dot.dataset.tooltipId = tooltip.id = `tooltip-${Date.now()}`;
      });
      dot.addEventListener("mouseleave", () => {
        const tooltipId = dot.dataset.tooltipId;
        if (tooltipId) {
          document.getElementById(tooltipId)?.remove();
        }
      });
    });
  }

  // ui/modules/charts/summary-cards.ts
  function renderSummaryCards(options) {
    const { rollups, prevRollups = [], containers, metricsCollector: metricsCollector2 } = options;
    if (metricsCollector2) metricsCollector2.mark("render-summary-cards-start");
    const current = calculateMetrics(rollups);
    const previous = calculateMetrics(prevRollups);
    renderMetricValues(containers, current);
    const sparklineData = extractSparklineData(rollups);
    renderSparklines(containers, sparklineData);
    if (prevRollups && prevRollups.length > 0) {
      renderDeltas(containers, current, previous);
    } else {
      clearDeltas(containers);
    }
    if (metricsCollector2) {
      metricsCollector2.mark("render-summary-cards-end");
      metricsCollector2.mark("first-meaningful-paint");
      metricsCollector2.measure(
        "init-to-fmp",
        "dashboard-init",
        "first-meaningful-paint"
      );
    }
  }
  function renderMetricValues(containers, metrics) {
    if (containers.totalPrs) {
      containers.totalPrs.textContent = metrics.totalPrs.toLocaleString();
    }
    if (containers.cycleP50) {
      containers.cycleP50.textContent = metrics.cycleP50 !== null ? formatDuration(metrics.cycleP50) : "-";
    }
    if (containers.cycleP90) {
      containers.cycleP90.textContent = metrics.cycleP90 !== null ? formatDuration(metrics.cycleP90) : "-";
    }
    if (containers.authorsCount) {
      containers.authorsCount.textContent = metrics.avgAuthors.toLocaleString();
    }
    if (containers.reviewersCount) {
      containers.reviewersCount.textContent = metrics.avgReviewers.toLocaleString();
    }
  }
  function renderSparklines(containers, data) {
    renderSparkline(containers.totalPrsSparkline, data.prCounts);
    renderSparkline(containers.cycleP50Sparkline, data.p50s);
    renderSparkline(containers.cycleP90Sparkline, data.p90s);
    renderSparkline(containers.authorsSparkline, data.authors);
    renderSparkline(containers.reviewersSparkline, data.reviewers);
  }
  function renderDeltas(containers, current, previous) {
    renderDelta(
      containers.totalPrsDelta,
      calculatePercentChange(current.totalPrs, previous.totalPrs),
      false
    );
    renderDelta(
      containers.cycleP50Delta,
      calculatePercentChange(current.cycleP50, previous.cycleP50),
      true
      // Inverse: lower is better
    );
    renderDelta(
      containers.cycleP90Delta,
      calculatePercentChange(current.cycleP90, previous.cycleP90),
      true
      // Inverse: lower is better
    );
    renderDelta(
      containers.authorsDelta,
      calculatePercentChange(current.avgAuthors, previous.avgAuthors),
      false
    );
    renderDelta(
      containers.reviewersDelta,
      calculatePercentChange(current.avgReviewers, previous.avgReviewers),
      false
    );
  }
  function clearDeltas(containers) {
    const deltaElements = [
      containers.totalPrsDelta,
      containers.cycleP50Delta,
      containers.cycleP90Delta,
      containers.authorsDelta,
      containers.reviewersDelta
    ];
    deltaElements.forEach((el) => {
      if (el) {
        el.innerHTML = "";
        el.className = "metric-delta";
      }
    });
  }

  // ui/modules/charts/throughput.ts
  function renderThroughputChart(container, rollups) {
    if (!container) return;
    if (!rollups || !rollups.length) {
      container.innerHTML = '<p class="no-data">No data for selected range</p>';
      return;
    }
    const prCounts = rollups.map((r) => r.pr_count || 0);
    const maxCount = Math.max(...prCounts);
    const movingAvg = calculateMovingAverage(prCounts, 4);
    const barsHtml = rollups.map((r) => {
      const height = maxCount > 0 ? (r.pr_count || 0) / maxCount * 100 : 0;
      const weekLabel = r.week.split("-W")[1] || "";
      return `
            <div class="bar-container" title="${escapeHtml(r.week)}: ${r.pr_count || 0} PRs">
                <div class="bar" style="height: ${height}%"></div>
                <div class="bar-label">${escapeHtml(weekLabel)}</div>
            </div>
        `;
    }).join("");
    const trendLineHtml = renderTrendLine(rollups, movingAvg, maxCount);
    const legendHtml = `
        <div class="chart-legend">
            <div class="legend-item">
                <span class="legend-bar"></span>
                <span>Weekly PRs</span>
            </div>
            <div class="legend-item">
                <span class="legend-line"></span>
                <span>4-week avg</span>
            </div>
        </div>
    `;
    container.innerHTML = `
        <div class="chart-with-trend">
            <div class="bar-chart">${barsHtml}</div>
            ${trendLineHtml}
        </div>
        ${legendHtml}
    `;
  }
  function renderTrendLine(rollups, movingAvg, maxCount) {
    if (rollups.length < 4) return "";
    const validPoints = movingAvg.map((val, i) => ({ val, i })).filter((p) => p.val !== null);
    if (validPoints.length < 2) return "";
    const chartHeight = 200;
    const chartPadding = 8;
    const points = validPoints.map((p) => {
      const x = p.i / (rollups.length - 1) * 100;
      const y = maxCount > 0 ? chartHeight - chartPadding - p.val / maxCount * (chartHeight - chartPadding * 2) : chartHeight / 2;
      return { x, y };
    });
    const pathD = points.map(
      (pt, i) => `${i === 0 ? "M" : "L"} ${pt.x.toFixed(1)}% ${pt.y.toFixed(1)}`
    ).join(" ");
    return `
        <div class="trend-line-overlay">
            <svg viewBox="0 0 100 ${chartHeight}" preserveAspectRatio="none">
                <path class="trend-line" d="${pathD}" vector-effect="non-scaling-stroke"/>
            </svg>
        </div>
    `;
  }

  // ui/modules/charts/cycle-time.ts
  function renderCycleDistribution(container, distributions) {
    if (!container) return;
    if (!distributions || !distributions.length) {
      container.innerHTML = '<p class="no-data">No data for selected range</p>';
      return;
    }
    const buckets = {
      "0-1h": 0,
      "1-4h": 0,
      "4-24h": 0,
      "1-3d": 0,
      "3-7d": 0,
      "7d+": 0
    };
    distributions.forEach((d) => {
      Object.entries(d.cycle_time_buckets || {}).forEach(([key, val]) => {
        buckets[key] = (buckets[key] || 0) + val;
      });
    });
    const total = Object.values(buckets).reduce((a, b) => a + b, 0);
    if (total === 0) {
      container.innerHTML = '<p class="no-data">No cycle time data</p>';
      return;
    }
    const html = Object.entries(buckets).map(([label, count]) => {
      const pct = (count / total * 100).toFixed(1);
      return `
            <div class="dist-row">
                <span class="dist-label">${label}</span>
                <div class="dist-bar-bg">
                    <div class="dist-bar" style="width: ${pct}%"></div>
                </div>
                <span class="dist-value">${count} (${pct}%)</span>
            </div>
        `;
    }).join("");
    container.innerHTML = html;
  }
  function renderCycleTimeTrend(container, rollups) {
    if (!container) return;
    if (!rollups || rollups.length < 2) {
      container.innerHTML = '<p class="no-data">Not enough data for trend</p>';
      return;
    }
    const p50Data = rollups.map((r) => ({ week: r.week, value: r.cycle_time_p50 })).filter((d) => d.value !== null);
    const p90Data = rollups.map((r) => ({ week: r.week, value: r.cycle_time_p90 })).filter((d) => d.value !== null);
    if (p50Data.length < 2 && p90Data.length < 2) {
      container.innerHTML = '<p class="no-data">No cycle time data available</p>';
      return;
    }
    const allValues = [
      ...p50Data.map((d) => d.value),
      ...p90Data.map((d) => d.value)
    ];
    const maxVal = Math.max(...allValues);
    const minVal = Math.min(...allValues);
    const range = maxVal - minVal || 1;
    const width = 100;
    const height = 180;
    const padding = { top: 10, right: 10, bottom: 25, left: 40 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    const generatePath = (data) => {
      const points = data.map((d) => {
        const dataIndex = rollups.findIndex((r) => r.week === d.week);
        const x = padding.left + dataIndex / (rollups.length - 1) * chartWidth;
        const y = padding.top + chartHeight - (d.value - minVal) / range * chartHeight;
        return { x, y, week: d.week, value: d.value };
      });
      const pathD = points.map(
        (p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`
      ).join(" ");
      return { pathD, points };
    };
    const p50Path = p50Data.length >= 2 ? generatePath(p50Data) : null;
    const p90Path = p90Data.length >= 2 ? generatePath(p90Data) : null;
    const yLabels = [minVal, (minVal + maxVal) / 2, maxVal];
    const svgContent = `
        <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">
            <!-- Grid lines -->
            ${yLabels.map((_, i) => {
      const y = padding.top + chartHeight - i / (yLabels.length - 1) * chartHeight;
      return `<line class="line-chart-grid" x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}"/>`;
    }).join("")}

            <!-- Y-axis labels -->
            ${yLabels.map((val, i) => {
      const y = padding.top + chartHeight - i / (yLabels.length - 1) * chartHeight;
      return `<text class="line-chart-axis" x="${padding.left - 4}" y="${y + 3}" text-anchor="end">${formatDuration(val)}</text>`;
    }).join("")}

            <!-- Lines -->
            ${p90Path ? `<path class="line-chart-p90" d="${p90Path.pathD}" vector-effect="non-scaling-stroke"/>` : ""}
            ${p50Path ? `<path class="line-chart-p50" d="${p50Path.pathD}" vector-effect="non-scaling-stroke"/>` : ""}

            <!-- Dots -->
            ${p90Path ? p90Path.points.map((p) => `<circle class="line-chart-dot" cx="${p.x}" cy="${p.y}" r="3" fill="var(--warning)" data-week="${escapeHtml(p.week)}" data-value="${p.value}" data-metric="P90"/>`).join("") : ""}
            ${p50Path ? p50Path.points.map((p) => `<circle class="line-chart-dot" cx="${p.x}" cy="${p.y}" r="3" fill="var(--primary)" data-week="${escapeHtml(p.week)}" data-value="${p.value}" data-metric="P50"/>`).join("") : ""}
        </svg>
    `;
    const legendHtml = `
        <div class="chart-legend">
            <div class="legend-item">
                <span class="chart-tooltip-dot legend-p50"></span>
                <span>P50 (Median)</span>
            </div>
            <div class="legend-item">
                <span class="chart-tooltip-dot legend-p90"></span>
                <span>P90</span>
            </div>
        </div>
    `;
    container.innerHTML = `<div class="line-chart">${svgContent}</div>${legendHtml}`;
    addChartTooltips(container, (dot) => {
      const week = dot.dataset["week"] || "";
      const value = parseFloat(dot.dataset["value"] || "0");
      const metric = dot.dataset["metric"] || "";
      return `
            <div class="chart-tooltip-title">${escapeHtml(week)}</div>
            <div class="chart-tooltip-row">
                <span class="chart-tooltip-label">
                    <span class="chart-tooltip-dot ${metric === "P50" ? "legend-p50" : "legend-p90"}"></span>
                    ${escapeHtml(metric)}
                </span>
                <span>${formatDuration(value)}</span>
            </div>
        `;
    });
  }

  // ui/modules/charts/reviewer-activity.ts
  function renderReviewerActivity(container, rollups) {
    if (!container) return;
    if (!rollups || !rollups.length) {
      container.innerHTML = '<p class="no-data">No reviewer data available</p>';
      return;
    }
    const recentRollups = rollups.slice(-8);
    const maxReviewers = Math.max(
      ...recentRollups.map((r) => r.reviewers_count || 0)
    );
    if (maxReviewers === 0) {
      container.innerHTML = '<p class="no-data">No reviewer data available</p>';
      return;
    }
    const barsHtml = recentRollups.map((r) => {
      const count = r.reviewers_count || 0;
      const pct = count / maxReviewers * 100;
      const weekLabel = r.week.split("-W")[1] || "";
      return `
            <div class="h-bar-row" title="${escapeHtml(r.week)}: ${count} reviewers">
                <span class="h-bar-label">W${escapeHtml(weekLabel)}</span>
                <div class="h-bar-container">
                    <div class="h-bar" style="width: ${pct}%"></div>
                </div>
                <span class="h-bar-value">${count}</span>
            </div>
        `;
    }).join("");
    container.innerHTML = `<div class="horizontal-bar-chart">${barsHtml}</div>`;
  }

  // ui/modules/export.ts
  var CSV_HEADERS = [
    "Week",
    "Start Date",
    "End Date",
    "PR Count",
    "Cycle Time P50 (min)",
    "Cycle Time P90 (min)",
    "Authors",
    "Reviewers"
  ];
  function rollupsToCsv(rollups) {
    if (!rollups || rollups.length === 0) {
      return "";
    }
    const rows = rollups.map((r) => [
      r.week,
      r.start_date || "",
      r.end_date || "",
      r.pr_count || 0,
      r.cycle_time_p50 != null ? r.cycle_time_p50.toFixed(1) : "",
      r.cycle_time_p90 != null ? r.cycle_time_p90.toFixed(1) : "",
      r.authors_count || 0,
      r.reviewers_count || 0
    ]);
    const headerRow = CSV_HEADERS.map((h) => h);
    return [headerRow, ...rows].map((row) => row.map((cell) => `"${cell}"`).join(",")).join("\n");
  }
  function generateExportFilename(prefix, extension) {
    const dateStr = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
    return `${prefix}-${dateStr}.${extension}`;
  }
  function triggerDownload(content, filename, mimeType = "text/csv;charset=utf-8;") {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
  function showToast(message, type = "success", durationMs = 3e3) {
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.remove();
    }, durationMs);
  }

  // ui/dashboard.ts
  var loader = null;
  var artifactClient = null;
  var currentDateRange = {
    start: null,
    end: null
  };
  var currentFilters = {
    repos: [],
    teams: []
  };
  var comparisonMode = false;
  var cachedRollups = [];
  var currentBuildId = null;
  var sdkInitialized = false;
  var SETTINGS_KEY_PROJECT = "pr-insights-source-project";
  var SETTINGS_KEY_PIPELINE = "pr-insights-pipeline-id";
  var ENABLE_PHASE5_FEATURES = true;
  var elements = {};
  function getElement(id) {
    const el = elements[id];
    if (el instanceof HTMLElement) {
      return el;
    }
    return null;
  }
  var IS_PRODUCTION = typeof window !== "undefined" && window.process?.env?.NODE_ENV === "production";
  var DEBUG_ENABLED = !IS_PRODUCTION && (typeof window !== "undefined" && window.__DASHBOARD_DEBUG__ || typeof window !== "undefined" && new URLSearchParams(window.location.search).has("debug"));
  var metricsCollector = DEBUG_ENABLED ? {
    marks: /* @__PURE__ */ new Map(),
    measures: [],
    mark(name) {
      if (!performance || !performance.mark) return;
      try {
        performance.mark(name);
        this.marks.set(name, performance.now());
      } catch (_e) {
      }
    },
    measure(name, startMark, endMark) {
      if (!performance || !performance.measure) return;
      try {
        performance.measure(name, startMark, endMark);
        const entries = performance.getEntriesByName(name, "measure");
        if (entries.length > 0) {
          const lastEntry = entries[entries.length - 1];
          if (lastEntry) {
            this.measures.push({
              name,
              duration: lastEntry.duration,
              timestamp: Date.now()
            });
          }
        }
      } catch (_e) {
      }
    },
    getMetrics() {
      return {
        marks: Array.from(this.marks.entries()).map(([name, time]) => ({
          name,
          time
        })),
        measures: [...this.measures]
      };
    },
    reset() {
      this.marks.clear();
      this.measures = [];
      if (performance && performance.clearMarks) performance.clearMarks();
      if (performance && performance.clearMeasures)
        performance.clearMeasures();
    }
  } : null;
  if (DEBUG_ENABLED && typeof window !== "undefined") {
    window.__dashboardMetrics = metricsCollector;
  }
  async function initializeAdoSdk() {
    if (sdkInitialized) return;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Azure DevOps SDK initialization timed out"));
      }, 1e4);
      VSS.init({
        explicitNotifyLoaded: true,
        usePlatformScripts: true,
        usePlatformStyles: true
      });
      VSS.ready(() => {
        clearTimeout(timeout);
        sdkInitialized = true;
        const webContext = VSS.getWebContext();
        const projectNameEl = document.getElementById("current-project-name");
        if (projectNameEl && webContext?.project?.name) {
          projectNameEl.textContent = webContext.project.name;
        }
        VSS.notifyLoadSucceeded();
        resolve();
      });
    });
  }
  function parseQueryParams() {
    const params = new URLSearchParams(window.location.search);
    const datasetUrl = params.get("dataset");
    const pipelineIdStr = params.get("pipelineId");
    if (datasetUrl) {
      if (!datasetUrl.startsWith("https://")) {
        return createInvalidConfigError(
          "dataset",
          datasetUrl,
          "Must be a valid HTTPS URL"
        );
      }
      const IS_DEV = window.location.hostname === "localhost" || params.has("devMode");
      if (!IS_DEV) {
        try {
          const urlHost = new URL(datasetUrl).hostname;
          const isAdoDomain = urlHost.endsWith("dev.azure.com") || urlHost.endsWith(".visualstudio.com") || urlHost.endsWith(".azure.com");
          if (!isAdoDomain) {
            console.warn(
              `SECURITY: ?dataset= URL "${urlHost}" is not an Azure DevOps domain. This parameter is intended for development only.`
            );
          }
        } catch (_e) {
          return createInvalidConfigError(
            "dataset",
            datasetUrl,
            "Invalid URL format"
          );
        }
      }
      let warning = null;
      if (pipelineIdStr) {
        warning = "Both dataset and pipelineId specified; using dataset";
        console.warn(warning);
      }
      return { mode: "direct", value: datasetUrl, warning };
    }
    if (pipelineIdStr) {
      const pipelineId = parseInt(pipelineIdStr, 10);
      if (isNaN(pipelineId) || pipelineId <= 0) {
        return createInvalidConfigError(
          "pipelineId",
          pipelineIdStr,
          "Must be a positive integer"
        );
      }
      return { mode: "explicit", value: pipelineId };
    }
    return { mode: "discover", value: null };
  }
  async function getSourceConfig() {
    const result = {
      projectId: null,
      pipelineId: null
    };
    try {
      const dataService = await VSS.getService(
        VSS.ServiceIds.ExtensionData
      );
      const savedProjectId = await dataService.getValue(
        SETTINGS_KEY_PROJECT,
        { scopeType: "User" }
      );
      if (savedProjectId && typeof savedProjectId === "string" && savedProjectId.trim()) {
        result.projectId = savedProjectId.trim();
      }
      const savedPipelineId = await dataService.getValue(
        SETTINGS_KEY_PIPELINE,
        { scopeType: "User" }
      );
      if (savedPipelineId && typeof savedPipelineId === "number" && savedPipelineId > 0) {
        result.pipelineId = savedPipelineId;
      }
    } catch (e) {
      console.log("Could not read extension settings:", e);
    }
    return result;
  }
  async function clearStalePipelineSetting() {
    try {
      const dataService = await VSS.getService(
        VSS.ServiceIds.ExtensionData
      );
      await dataService.setValue(SETTINGS_KEY_PIPELINE, null, {
        scopeType: "User"
      });
      console.log("Cleared stale pipeline setting to re-enable auto-discovery");
    } catch (e) {
      console.warn("Could not clear stale pipeline setting:", e);
    }
  }
  async function resolveConfiguration() {
    const queryResult = parseQueryParams();
    if (queryResult instanceof PrInsightsError) {
      throw queryResult;
    }
    if (queryResult.mode === "direct") {
      return { directUrl: queryResult.value };
    }
    const webContext = VSS.getWebContext();
    const currentProjectId = webContext.project?.id;
    if (!currentProjectId) {
      throw new Error("No project context available");
    }
    const sourceConfig = await getSourceConfig();
    const targetProjectId = sourceConfig.projectId || currentProjectId;
    console.log(
      `Source project: ${targetProjectId}${sourceConfig.projectId ? " (from settings)" : " (current context)"}`
    );
    artifactClient = new ArtifactClient(targetProjectId);
    await artifactClient.initialize();
    if (queryResult.mode === "explicit") {
      return await resolveFromPipelineId(queryResult.value, targetProjectId);
    }
    if (sourceConfig.pipelineId) {
      console.log(
        `Using pipeline definition ID from settings: ${sourceConfig.pipelineId}`
      );
      try {
        return await resolveFromPipelineId(
          sourceConfig.pipelineId,
          targetProjectId
        );
      } catch (error) {
        console.warn(
          `Saved pipeline ${sourceConfig.pipelineId} is invalid, falling back to auto-discovery:`,
          getErrorMessage(error)
        );
        await clearStalePipelineSetting();
      }
    }
    return await discoverAndResolve(targetProjectId);
  }
  async function resolveFromPipelineId(pipelineId, projectId) {
    const buildClient = await getBuildClient();
    const builds = await buildClient.getBuilds(
      projectId,
      [pipelineId],
      void 0,
      void 0,
      void 0,
      void 0,
      void 0,
      void 0,
      // reasonFilter
      2,
      // statusFilter: Completed
      6,
      // resultFilter: Succeeded (2) | PartiallySucceeded (4)
      void 0,
      void 0,
      1
      // top
    );
    if (!builds || builds.length === 0) {
      const definitions = await buildClient.getDefinitions(
        projectId,
        void 0,
        void 0,
        void 0,
        2,
        void 0,
        void 0,
        void 0,
        [pipelineId]
      );
      const name = definitions?.[0]?.name || `ID ${pipelineId}`;
      throw createNoSuccessfulBuildsError(name);
    }
    const latestBuild = builds[0];
    if (!latestBuild) throw new Error("Failed to retrieve latest build");
    if (!artifactClient) throw new Error("ArtifactClient not initialized");
    const artifacts = await artifactClient.getArtifacts(latestBuild.id);
    const hasAggregates = artifacts.some((a) => a.name === "aggregates");
    if (!hasAggregates) {
      const definitions = await buildClient.getDefinitions(
        projectId,
        void 0,
        void 0,
        void 0,
        2,
        void 0,
        void 0,
        void 0,
        [pipelineId]
      );
      const name = definitions?.[0]?.name || `ID ${pipelineId}`;
      throw createArtifactsMissingError(name, latestBuild.id);
    }
    return { buildId: latestBuild.id, artifactName: "aggregates" };
  }
  async function discoverAndResolve(projectId) {
    const matches = await discoverInsightsPipelines(projectId);
    if (matches.length === 0) {
      throw createSetupRequiredError();
    }
    const firstMatch = matches[0];
    if (!firstMatch) throw createSetupRequiredError();
    return { buildId: firstMatch.buildId, artifactName: "aggregates" };
  }
  async function discoverInsightsPipelines(projectId) {
    const buildClient = await getBuildClient();
    const matches = [];
    const definitions = await buildClient.getDefinitions(
      projectId,
      void 0,
      void 0,
      void 0,
      2,
      50
    );
    for (const def of definitions) {
      const builds = await buildClient.getBuilds(
        projectId,
        [def.id],
        void 0,
        void 0,
        void 0,
        void 0,
        void 0,
        void 0,
        2,
        6,
        void 0,
        void 0,
        1
      );
      if (!builds || builds.length === 0) continue;
      const latestBuild = builds[0];
      if (!latestBuild) continue;
      try {
        if (!artifactClient) throw new Error("ArtifactClient not initialized");
        const artifacts = await artifactClient.getArtifacts(latestBuild.id);
        if (!artifacts.some((a) => a.name === "aggregates")) continue;
        matches.push({
          id: def.id,
          name: def.name,
          buildId: latestBuild.id
        });
      } catch (e) {
        console.debug(`Skipping pipeline ${def.name}:`, e);
      }
    }
    return matches;
  }
  async function getBuildClient() {
    return new Promise((resolve) => {
      VSS.require(["TFS/Build/RestClient"], (...args) => {
        const BuildRestClient = args[0];
        resolve(BuildRestClient.getClient());
      });
    });
  }
  function isLocalMode() {
    return typeof window !== "undefined" && window.LOCAL_DASHBOARD_MODE === true;
  }
  function getLocalDatasetPath() {
    return typeof window !== "undefined" && window.DATASET_PATH || "./dataset";
  }
  async function init() {
    if (metricsCollector) metricsCollector.mark("dashboard-init");
    cacheElements();
    setupEventListeners();
    initializePhase5Features();
    try {
      if (isLocalMode()) {
        console.log("[Dashboard] Running in local mode");
        const datasetPath = getLocalDatasetPath();
        loader = new DatasetLoader(datasetPath);
        currentBuildId = null;
        const projectNameEl = document.getElementById("current-project-name");
        if (projectNameEl) {
          projectNameEl.textContent = "Local Dashboard";
        }
        const exportRawZip = document.getElementById("export-raw-zip");
        if (exportRawZip) {
          exportRawZip.style.display = "none";
        }
        await loadDataset();
        return;
      }
      await initializeAdoSdk();
      const config = await resolveConfiguration();
      if (config.directUrl) {
        loader = new DatasetLoader(config.directUrl);
        currentBuildId = null;
      } else if (config.buildId && config.artifactName && artifactClient) {
        loader = artifactClient.createDatasetLoader(
          config.buildId,
          config.artifactName
        );
        currentBuildId = config.buildId;
      } else {
        throw new Error("Failed to resolve configuration");
      }
      await loadDataset();
    } catch (error) {
      console.error("Dashboard initialization failed:", error);
      handleError(error);
    }
  }
  function handleError(error) {
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
      showGenericError("Error", getErrorMessage(error) || "An unexpected error occurred");
    }
  }
  function hideAllPanels() {
    [
      "setup-required",
      "multiple-pipelines",
      "artifacts-missing",
      "permission-denied",
      "error-state",
      "loading-state",
      "main-content"
    ].forEach((id) => {
      document.getElementById(id)?.classList.add("hidden");
    });
  }
  function showSetupRequired(error) {
    const panel = document.getElementById("setup-required");
    if (!panel) return showGenericError(error.title, error.message);
    const messageEl = document.getElementById("setup-message");
    if (messageEl) messageEl.textContent = error.message;
    const details = error.details;
    if (details?.instructions && Array.isArray(details.instructions)) {
      const stepsList = document.getElementById("setup-steps");
      if (stepsList) {
        stepsList.innerHTML = details.instructions.map((s) => `<li>${escapeHtml(s)}</li>`).join("");
      }
    }
    if (details?.docsUrl) {
      const docsLink = document.getElementById(
        "docs-link"
      );
      if (docsLink) docsLink.href = String(details.docsUrl);
    }
    panel.classList.remove("hidden");
  }
  function showMultiplePipelines(error) {
    const panel = document.getElementById("multiple-pipelines");
    if (!panel) return showGenericError(error.title, error.message);
    const messageEl = document.getElementById("multiple-message");
    if (messageEl) messageEl.textContent = error.message;
    const listEl = document.getElementById("pipeline-list");
    const details = error.details;
    if (listEl && details?.matches && Array.isArray(details.matches)) {
      listEl.innerHTML = details.matches.map(
        (m) => `
                <a href="?pipelineId=${escapeHtml(String(m.id))}" class="pipeline-option">
                    <strong>${escapeHtml(m.name)}</strong>
                    <span class="pipeline-id">ID: ${escapeHtml(String(m.id))}</span>
                </a>
            `
      ).join("");
    }
    panel.classList.remove("hidden");
  }
  function showPermissionDenied(error) {
    const panel = document.getElementById("permission-denied");
    if (!panel) return showGenericError(error.title, error.message);
    const messageEl = document.getElementById("permission-message");
    if (messageEl) messageEl.textContent = error.message;
    panel.classList.remove("hidden");
  }
  function showGenericError(title, message) {
    const panel = document.getElementById("error-state");
    if (!panel) return;
    const titleEl = document.getElementById("error-title");
    const messageEl = document.getElementById("error-message");
    if (titleEl) titleEl.textContent = title;
    if (messageEl) messageEl.textContent = message;
    panel.classList.remove("hidden");
  }
  function showArtifactsMissing(error) {
    const panel = document.getElementById("artifacts-missing");
    if (!panel) return showGenericError(error.title, error.message);
    const messageEl = document.getElementById("missing-message");
    if (messageEl) messageEl.textContent = error.message;
    const details = error.details;
    if (details?.instructions && Array.isArray(details.instructions)) {
      const stepsList = document.getElementById("missing-steps");
      if (stepsList) {
        stepsList.innerHTML = details.instructions.map((s) => `<li>${escapeHtml(s)}</li>`).join("");
      }
    }
    panel.classList.remove("hidden");
  }
  function cacheElements() {
    const ids = [
      "app",
      "loading-state",
      "error-state",
      "main-content",
      "error-title",
      "error-message",
      "run-info",
      "date-range",
      "custom-dates",
      "start-date",
      "end-date",
      "retry-btn",
      "total-prs",
      "cycle-p50",
      "cycle-p90",
      "authors-count",
      "reviewers-count",
      "throughput-chart",
      "cycle-distribution",
      "total-prs-delta",
      "cycle-p50-delta",
      "cycle-p90-delta",
      "authors-delta",
      "reviewers-delta",
      "repo-filter",
      "team-filter",
      "repo-filter-group",
      "team-filter-group",
      "clear-filters",
      "active-filters",
      "filter-chips",
      "total-prs-sparkline",
      "cycle-p50-sparkline",
      "cycle-p90-sparkline",
      "authors-sparkline",
      "reviewers-sparkline",
      "cycle-time-trend",
      "reviewer-activity",
      "compare-toggle",
      "comparison-banner",
      "current-period-dates",
      "previous-period-dates",
      "exit-compare",
      "export-btn",
      "export-menu",
      "export-csv",
      "export-link",
      "export-raw-zip"
    ];
    ids.forEach((id) => {
      elements[id] = document.getElementById(id);
    });
    elements.tabs = document.querySelectorAll(".tab");
  }
  function initializePhase5Features() {
    const phase5Tabs = document.querySelectorAll(".phase5-tab");
    if (ENABLE_PHASE5_FEATURES) {
      phase5Tabs.forEach((tab) => tab.classList.remove("hidden"));
      console.log("Phase 5 features enabled");
    } else {
      console.log("Phase 5 features disabled");
    }
  }
  function setupEventListeners() {
    elements["date-range"]?.addEventListener("change", handleDateRangeChange);
    document.getElementById("apply-dates")?.addEventListener("click", applyCustomDates);
    elements.tabs?.forEach((tab) => {
      tab.addEventListener("click", () => {
        const tabId = tab.dataset["tab"];
        if (tabId) switchTab(tabId);
      });
    });
    elements["retry-btn"]?.addEventListener("click", () => init());
    document.getElementById("setup-retry-btn")?.addEventListener("click", () => init());
    document.getElementById("permission-retry-btn")?.addEventListener("click", () => init());
    elements["repo-filter"]?.addEventListener("change", handleFilterChange);
    elements["team-filter"]?.addEventListener("change", handleFilterChange);
    elements["clear-filters"]?.addEventListener("click", clearAllFilters);
    elements["compare-toggle"]?.addEventListener("click", toggleComparisonMode);
    elements["exit-compare"]?.addEventListener("click", exitComparisonMode);
    elements["export-btn"]?.addEventListener("click", toggleExportMenu);
    elements["export-csv"]?.addEventListener("click", exportToCsv);
    elements["export-link"]?.addEventListener("click", copyShareableLink);
    elements["export-raw-zip"]?.addEventListener("click", downloadRawDataZip);
    document.addEventListener("click", (e) => {
      const target = e.target;
      if (!target.closest(".export-dropdown")) {
        elements["export-menu"]?.classList.add("hidden");
      }
    });
  }
  async function loadDataset() {
    showLoading();
    try {
      if (!loader) throw new Error("Loader not initialized");
      const manifest = await loader.loadManifest();
      const dimensions = await loader.loadDimensions();
      populateFilterDropdowns(dimensions);
      updateDatasetInfo(manifest);
      restoreStateFromUrl();
      setInitialDateRange();
      await refreshMetrics();
      await updateFeatureTabs();
      showContent();
    } catch (error) {
      console.error("Failed to load dataset:", error);
      handleError(error);
    }
  }
  function setInitialDateRange() {
    if (currentDateRange.start && currentDateRange.end) return;
    if (!loader) return;
    const coverage = loader.getCoverage() || null;
    const defaultDays = loader.getDefaultRangeDays() || 90;
    if (coverage?.date_range?.max) {
      const endDate = new Date(coverage.date_range.max);
      const startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - defaultDays);
      currentDateRange = { start: startDate, end: endDate };
      if (elements["start-date"]) {
        elements["start-date"].value = startDate.toISOString().split("T")[0];
      }
      if (elements["end-date"]) {
        elements["end-date"].value = endDate.toISOString().split("T")[0];
      }
    }
  }
  async function refreshMetrics() {
    if (!currentDateRange.start || !currentDateRange.end || !loader) return;
    const rawRollups = await loader.getWeeklyRollups(
      currentDateRange.start,
      currentDateRange.end
    );
    const distributions = await loader.getDistributions(
      currentDateRange.start,
      currentDateRange.end
    );
    const rollups = applyFiltersToRollups(rawRollups, currentFilters);
    const prevPeriod = getPreviousPeriod(
      currentDateRange.start,
      currentDateRange.end
    );
    let prevRollups = [];
    try {
      const rawPrevRollups = await loader.getWeeklyRollups(
        prevPeriod.start,
        prevPeriod.end
      );
      prevRollups = applyFiltersToRollups(rawPrevRollups, currentFilters);
    } catch (e) {
      console.debug("Previous period data not available:", e);
    }
    cachedRollups = rollups;
    renderSummaryCards2(rollups, prevRollups);
    renderThroughputChart2(rollups);
    renderCycleTimeTrend2(rollups);
    renderReviewerActivity2(rollups);
    renderCycleDistribution2(distributions);
    if (comparisonMode) {
      updateComparisonBanner();
    }
  }
  function renderSummaryCards2(rollups, prevRollups = []) {
    const containers = {
      totalPrs: elements["total-prs"] ?? null,
      cycleP50: elements["cycle-p50"] ?? null,
      cycleP90: elements["cycle-p90"] ?? null,
      authorsCount: elements["authors-count"] ?? null,
      reviewersCount: elements["reviewers-count"] ?? null,
      totalPrsSparkline: elements["total-prs-sparkline"] ?? null,
      cycleP50Sparkline: elements["cycle-p50-sparkline"] ?? null,
      cycleP90Sparkline: elements["cycle-p90-sparkline"] ?? null,
      authorsSparkline: elements["authors-sparkline"] ?? null,
      reviewersSparkline: elements["reviewers-sparkline"] ?? null,
      totalPrsDelta: elements["total-prs-delta"] ?? null,
      cycleP50Delta: elements["cycle-p50-delta"] ?? null,
      cycleP90Delta: elements["cycle-p90-delta"] ?? null,
      authorsDelta: elements["authors-delta"] ?? null,
      reviewersDelta: elements["reviewers-delta"] ?? null
    };
    renderSummaryCards({
      rollups,
      prevRollups,
      containers,
      metricsCollector
    });
  }
  function renderThroughputChart2(rollups) {
    renderThroughputChart(elements["throughput-chart"] ?? null, rollups);
  }
  function renderCycleDistribution2(distributions) {
    renderCycleDistribution(
      elements["cycle-distribution"] ?? null,
      distributions
    );
  }
  function renderCycleTimeTrend2(rollups) {
    renderCycleTimeTrend(elements["cycle-time-trend"] ?? null, rollups);
  }
  function renderReviewerActivity2(rollups) {
    renderReviewerActivity(elements["reviewer-activity"] ?? null, rollups);
  }
  async function updateFeatureTabs() {
    if (!loader) return;
    if (!hasMLMethods(loader)) return;
    const predictionsContent = document.getElementById("tab-predictions");
    const predictionsUnavailable = document.getElementById(
      "predictions-unavailable"
    );
    if (predictionsContent) {
      const predictionsResult = await loader.loadPredictions();
      const predData = predictionsResult?.data;
      if (predictionsResult?.state === "ok" && predData?.forecasts?.length && predData.forecasts.length > 0) {
        renderPredictions2(predictionsContent, predData);
      } else if (predictionsUnavailable) {
        predictionsUnavailable.classList.remove("hidden");
      }
    }
    const aiContent = document.getElementById("tab-ai-insights");
    const aiUnavailable = document.getElementById("ai-unavailable");
    if (aiContent) {
      const insightsResult = await loader.loadInsights();
      const insData = insightsResult?.data;
      if (insightsResult?.state === "ok" && insData?.insights?.length && insData.insights.length > 0) {
        renderAIInsights2(aiContent, insData);
      } else if (aiUnavailable) {
        aiUnavailable.classList.remove("hidden");
      }
    }
  }
  function renderPredictions2(container, predictions) {
    renderPredictions(container, predictions);
  }
  function renderAIInsights2(container, insights) {
    renderAIInsights(container, insights);
  }
  function handleDateRangeChange(e) {
    const target = e.target;
    const value = target.value;
    if (value === "custom") {
      elements["custom-dates"]?.classList.remove("hidden");
      return;
    }
    elements["custom-dates"]?.classList.add("hidden");
    const days = parseInt(value, 10);
    const coverage = loader?.getCoverage() || null;
    const endDate = coverage?.date_range?.max ? new Date(coverage.date_range.max) : /* @__PURE__ */ new Date();
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - days);
    currentDateRange = { start: startDate, end: endDate };
    updateUrlState();
    void refreshMetrics();
  }
  function applyCustomDates() {
    const start = elements["start-date"]?.value;
    const end = elements["end-date"]?.value;
    if (!start || !end) return;
    currentDateRange = { start: new Date(start), end: new Date(end) };
    updateUrlState();
    void refreshMetrics();
  }
  function switchTab(tabId) {
    elements.tabs?.forEach((tab) => {
      tab.classList.toggle("active", tab.dataset["tab"] === tabId);
    });
    document.querySelectorAll(".tab-content").forEach((content) => {
      content.classList.toggle("active", content.id === `tab-${tabId}`);
      content.classList.toggle("hidden", content.id !== `tab-${tabId}`);
    });
    updateUrlState();
  }
  function populateFilterDropdowns(dimensions) {
    if (!dimensions) return;
    const repoFilter = getElement("repo-filter");
    if (repoFilter && dimensions.repositories && dimensions.repositories.length > 0) {
      repoFilter.innerHTML = '<option value="">All</option>';
      dimensions.repositories.forEach((repo) => {
        const option = document.createElement("option");
        option.value = repo.repository_name;
        option.textContent = repo.repository_name;
        repoFilter.appendChild(option);
      });
      elements["repo-filter-group"]?.classList.remove("hidden");
    } else {
      elements["repo-filter-group"]?.classList.add("hidden");
    }
    const teamFilter = getElement("team-filter");
    if (teamFilter && dimensions.teams && dimensions.teams.length > 0) {
      teamFilter.innerHTML = '<option value="">All</option>';
      dimensions.teams.forEach((team) => {
        const option = document.createElement("option");
        option.value = team.team_name;
        option.textContent = team.team_name;
        teamFilter.appendChild(option);
      });
      elements["team-filter-group"]?.classList.remove("hidden");
    } else {
      elements["team-filter-group"]?.classList.add("hidden");
    }
    restoreFiltersFromUrl();
  }
  function handleFilterChange() {
    const repoFilter = elements["repo-filter"];
    const teamFilter = elements["team-filter"];
    const repoValues = repoFilter ? Array.from(repoFilter.selectedOptions).map((o) => o.value).filter((v) => v) : [];
    const teamValues = teamFilter ? Array.from(teamFilter.selectedOptions).map((o) => o.value).filter((v) => v) : [];
    currentFilters = { repos: repoValues, teams: teamValues };
    updateFilterUI();
    updateUrlState();
    void refreshMetrics();
  }
  function clearAllFilters() {
    currentFilters = { repos: [], teams: [] };
    const repoFilter = elements["repo-filter"];
    const teamFilter = elements["team-filter"];
    if (repoFilter) {
      Array.from(repoFilter.options).forEach(
        (o) => o.selected = o.value === ""
      );
    }
    if (teamFilter) {
      Array.from(teamFilter.options).forEach(
        (o) => o.selected = o.value === ""
      );
    }
    updateFilterUI();
    updateUrlState();
    void refreshMetrics();
  }
  function removeFilter(type, value) {
    if (type === "repo") {
      currentFilters.repos = currentFilters.repos.filter((v) => v !== value);
      const repoFilter = elements["repo-filter"];
      if (repoFilter) {
        const option = repoFilter.querySelector(
          `option[value="${value}"]`
        );
        if (option) option.selected = false;
      }
    } else if (type === "team") {
      currentFilters.teams = currentFilters.teams.filter((v) => v !== value);
      const teamFilter = elements["team-filter"];
      if (teamFilter) {
        const option = teamFilter.querySelector(
          `option[value="${value}"]`
        );
        if (option) option.selected = false;
      }
    }
    updateFilterUI();
    updateUrlState();
    void refreshMetrics();
  }
  function updateFilterUI() {
    const hasFilters = currentFilters.repos.length > 0 || currentFilters.teams.length > 0;
    if (elements["clear-filters"]) {
      elements["clear-filters"].classList.toggle("hidden", !hasFilters);
    }
    if (elements["active-filters"] && elements["filter-chips"]) {
      elements["active-filters"].classList.toggle("hidden", !hasFilters);
      if (hasFilters) {
        renderFilterChips();
      } else {
        elements["filter-chips"].innerHTML = "";
      }
    }
  }
  function renderFilterChips() {
    const chipsEl = elements["filter-chips"];
    if (!chipsEl) return;
    const chips = [];
    currentFilters.repos.forEach((value) => {
      const label = getFilterLabel("repo", value);
      chips.push(createFilterChip("repo", value, label));
    });
    currentFilters.teams.forEach((value) => {
      const label = getFilterLabel("team", value);
      chips.push(createFilterChip("team", value, label));
    });
    chipsEl.innerHTML = chips.join("");
    chipsEl.querySelectorAll(".filter-chip-remove").forEach((btnNode) => {
      const btn = btnNode;
      btn.addEventListener("click", () => {
        const type = btn.dataset["type"];
        const val = btn.dataset["value"];
        if (type && val) removeFilter(type, val);
      });
    });
  }
  function getFilterLabel(type, value) {
    if (type === "repo") {
      const repoFilter = elements["repo-filter"];
      const option = repoFilter?.querySelector(`option[value="${value}"]`);
      return option?.textContent || value;
    }
    if (type === "team") {
      const teamFilter = elements["team-filter"];
      const option = teamFilter?.querySelector(`option[value="${value}"]`);
      return option?.textContent || value;
    }
    return value;
  }
  function createFilterChip(type, value, label) {
    const prefix = type === "repo" ? "repo" : "team";
    return `
        <span class="filter-chip">
            <span class="filter-chip-label">${prefix}: ${escapeHtml(label)}</span>
            <span class="filter-chip-remove" data-type="${escapeHtml(type)}" data-value="${escapeHtml(value)}">&times;</span>
        </span>
    `;
  }
  function restoreFiltersFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const reposParam = params.get("repos");
    const teamsParam = params.get("teams");
    if (reposParam) {
      currentFilters.repos = reposParam.split(",").filter((v) => v);
      const repoFilter = elements["repo-filter"];
      if (repoFilter) {
        currentFilters.repos.forEach((value) => {
          const option = repoFilter.querySelector(
            `option[value="${value}"]`
          );
          if (option) option.selected = true;
        });
      }
    }
    if (teamsParam) {
      currentFilters.teams = teamsParam.split(",").filter((v) => v);
      const teamFilter = elements["team-filter"];
      if (teamFilter) {
        currentFilters.teams.forEach((value) => {
          const option = teamFilter.querySelector(
            `option[value="${value}"]`
          );
          if (option) option.selected = true;
        });
      }
    }
    updateFilterUI();
  }
  function toggleComparisonMode() {
    comparisonMode = !comparisonMode;
    elements["compare-toggle"]?.classList.toggle("active", comparisonMode);
    elements["comparison-banner"]?.classList.toggle("hidden", !comparisonMode);
    if (comparisonMode) {
      updateComparisonBanner();
    }
    updateUrlState();
    void refreshMetrics();
  }
  function exitComparisonMode() {
    comparisonMode = false;
    elements["compare-toggle"]?.classList.remove("active");
    elements["comparison-banner"]?.classList.add("hidden");
    updateUrlState();
    void refreshMetrics();
  }
  function updateComparisonBanner() {
    if (!currentDateRange.start || !currentDateRange.end) return;
    const formatDate = (date) => date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric"
    });
    const currentStart = formatDate(currentDateRange.start);
    const currentEnd = formatDate(currentDateRange.end);
    if (elements["current-period-dates"]) {
      elements["current-period-dates"].textContent = `${currentStart} - ${currentEnd}`;
    }
    const prevPeriod = getPreviousPeriod(
      currentDateRange.start,
      currentDateRange.end
    );
    const prevStart = formatDate(prevPeriod.start);
    const prevEnd = formatDate(prevPeriod.end);
    if (elements["previous-period-dates"]) {
      elements["previous-period-dates"].textContent = `${prevStart} - ${prevEnd}`;
    }
  }
  function toggleExportMenu(e) {
    e.stopPropagation();
    elements["export-menu"]?.classList.toggle("hidden");
  }
  function exportToCsv() {
    elements["export-menu"]?.classList.add("hidden");
    if (!cachedRollups || cachedRollups.length === 0) {
      showToast("No data to export", "error");
      return;
    }
    const csvContent = rollupsToCsv(cachedRollups);
    const filename = generateExportFilename("pr-insights", "csv");
    triggerDownload(csvContent, filename);
    showToast("CSV exported successfully", "success");
  }
  async function copyShareableLink() {
    elements["export-menu"]?.classList.add("hidden");
    try {
      await navigator.clipboard.writeText(window.location.href);
      showToast("Link copied to clipboard", "success");
    } catch (_err) {
      const textArea = document.createElement("textarea");
      textArea.value = window.location.href;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
      showToast("Link copied to clipboard", "success");
    }
  }
  async function downloadRawDataZip() {
    elements["export-menu"]?.classList.add("hidden");
    if (!currentBuildId || !artifactClient) {
      showToast("Raw data not available in direct URL mode", "error");
      return;
    }
    try {
      showToast("Preparing download...", "success");
      const artifact = await artifactClient.getArtifactMetadata(
        currentBuildId,
        "csv-output"
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
      URL.revokeObjectURL(url);
      showToast("Download started", "success");
    } catch (err) {
      console.error("Failed to download raw data:", err);
      showToast("Failed to download raw data", "error");
    }
  }
  function showLoading() {
    hideAllPanels();
    elements["loading-state"]?.classList.remove("hidden");
  }
  function showContent() {
    hideAllPanels();
    elements["main-content"]?.classList.remove("hidden");
  }
  function updateDatasetInfo(manifest) {
    const generatedAt = manifest?.generated_at ? new Date(manifest.generated_at).toLocaleString() : "Unknown";
    const runId = manifest?.run_id || "";
    const runInfo = elements["run-info"];
    if (runInfo) {
      runInfo.textContent = `Generated: ${generatedAt}`;
      if (runId) runInfo.textContent += ` | Run: ${runId.slice(0, 8)}`;
    }
  }
  function updateUrlState() {
    const params = new URLSearchParams(window.location.search);
    const newParams = new URLSearchParams();
    if (params.get("dataset")) newParams.set("dataset", params.get("dataset"));
    if (params.get("pipelineId"))
      newParams.set("pipelineId", params.get("pipelineId"));
    if (currentDateRange.start) {
      newParams.set("start", currentDateRange.start.toISOString().split("T")[0]);
    }
    if (currentDateRange.end) {
      newParams.set("end", currentDateRange.end.toISOString().split("T")[0]);
    }
    const activeTab = document.querySelector(".tab.active");
    if (activeTab && activeTab.dataset["tab"] !== "metrics") {
      newParams.set("tab", activeTab.dataset["tab"]);
    }
    if (currentFilters.repos.length > 0) {
      newParams.set("repos", currentFilters.repos.join(","));
    }
    if (currentFilters.teams.length > 0) {
      newParams.set("teams", currentFilters.teams.join(","));
    }
    if (comparisonMode) {
      newParams.set("compare", "1");
    }
    window.history.replaceState(
      {},
      "",
      `${window.location.pathname}?${newParams.toString()}`
    );
  }
  function restoreStateFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const startParam = params.get("start");
    const endParam = params.get("end");
    if (startParam && endParam) {
      currentDateRange = { start: new Date(startParam), end: new Date(endParam) };
      const dateRangeEl = elements["date-range"];
      if (dateRangeEl) {
        dateRangeEl.value = "custom";
        elements["custom-dates"]?.classList.remove("hidden");
      }
      if (elements["start-date"]) elements["start-date"].value = startParam;
      if (elements["end-date"]) elements["end-date"].value = endParam;
    }
    const tabParam = params.get("tab");
    if (tabParam) {
      setTimeout(() => switchTab(tabParam), 0);
    }
    const compareParam = params.get("compare");
    if (compareParam === "1") {
      comparisonMode = true;
      elements["compare-toggle"]?.classList.add("active");
      elements["comparison-banner"]?.classList.remove("hidden");
    }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => void init());
  } else {
    void init();
  }
})();
// Global exports for browser runtime
if (typeof window !== 'undefined') { Object.assign(window, PRInsightsDashboard || {}); }
