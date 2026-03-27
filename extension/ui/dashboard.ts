/**
 * PR Insights Dashboard
 *
 * Project-level hub that loads data from pipeline artifacts.
 * Uses Azure DevOps Extension SDK for authentication.
 *
 * Configuration precedence:
 * 1. ?dataset=<url> - Direct URL (DEV ONLY)
 * 2. ?pipelineId=<id> - Query parameter override
 * 3. Extension settings - User-scoped saved preference
 * 4. Auto-discovery - Find pipelines with 'aggregates' artifact
 */

import {
  DatasetLoader,
  type IDatasetLoader,
  type Rollup,
} from "./dataset-loader";
import { ArtifactClient } from "./artifact-client";
import {
  PrInsightsError,
  createSetupRequiredError,
  createNoSuccessfulBuildsError,
  createArtifactsMissingError,
  createInvalidConfigError,
} from "./error-types";
import {
  getErrorMessage,
  hasMLMethods,
  type QueryParamResult,
  type DimensionsData,
  type DistributionData,
  type ManifestSchema,
} from "./types";

// Import from extracted modules
import {
  escapeHtml,
  showToast,
  rollupsToCsv,
  triggerDownload,
  generateExportFilename,
  getPreviousPeriod,
  applyFiltersToRollups,
  // Chart renderer modules with DOM injection
  renderSummaryCards as renderSummaryCardsModule,
  type SummaryCardsContainers,
  renderThroughputChart as renderThroughputChartModule,
  renderCycleDistribution as renderCycleDistributionModule,
  renderCycleTimeTrend as renderCycleTimeTrendModule,
  renderReviewerActivity as renderReviewerActivityModule,
  // Data availability signal derivation
  deriveAvailabilitySignal,
  // Filter constraint resolver
  resolveFilterConstraints,
  // Typeahead dropdown component
  initTypeaheadDropdown,
  type TypeaheadInstance,
  // Filter URL serialization
  parseFiltersFromUrl,
  // State machine and state-specific rendering (FR-001 through FR-004)
  resolvePredictionsState,
  resolveInsightsState,
  renderPredictionsForState,
  renderInsightsForState,
  type ArtifactLoadResult,
  // SDK module functions
  initializeAdoSdk,
  isLocalMode,
  getLocalDatasetPath,
  // Error handling functions (dispatch handled internally)
  handleError,
  hideAllPanels,
  // Safe DOM rendering utilities
  clearElement,
  createOption,
  renderTrustedHtml,
} from "./modules";

// Dashboard state
let loader: IDatasetLoader | null = null;
let artifactClient: ArtifactClient | null = null;
let currentDateRange: { start: Date | null; end: Date | null } = {
  start: null,
  end: null,
};
let currentDimensions: DimensionsData | null = null;
let currentFilters: {
  repos: string[];
  teams: string[];
  reviewers: string[];
  authors: string[];
} = {
  repos: [],
  teams: [],
  reviewers: [],
  authors: [],
};
let reviewerFilterNoticeMessage: string | null = null;

// Typeahead dropdown instances for the four filter dimensions
let typeaheadRepo: TypeaheadInstance | null = null;
let typeaheadTeam: TypeaheadInstance | null = null;
let typeaheadReviewer: TypeaheadInstance | null = null;
let typeaheadAuthor: TypeaheadInstance | null = null;
let comparisonMode = false;
let cachedRollups: Rollup[] = []; // Cache for export
let currentBuildId: number | null = null; // Store build ID for raw data download
let chipsDelegatedElement: HTMLElement | null = null; // Track delegated element

// Settings keys for extension data storage (must match settings.js)
const SETTINGS_KEY_PROJECT = "pr-insights-source-project";
const SETTINGS_KEY_PIPELINE = "pr-insights-pipeline-id";

// DOM element cache - stores single HTMLElements only
const elements: Record<string, HTMLElement | null> = {};

// DOM element list cache - stores NodeLists for multi-element queries
const elementLists: Record<string, NodeListOf<Element>> = {};

function getOwnRecordValue<T>(
  record: Record<string, T>,
  key: string,
): T | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor?.value as T | undefined;
}

/**
 * Typed DOM element accessor.
 * Provides type-safe access to cached DOM elements.
 * @param id - Element ID from cache
 * @returns Typed element or null
 */
function getElement<T extends HTMLElement = HTMLElement>(id: string): T | null {
  // eslint-disable-next-line security/detect-object-injection -- SECURITY: id is string parameter for DOM element lookup, not user input
  const el = elements[id];
  if (el instanceof HTMLElement) {
    return el as T;
  }
  return null;
}

/**
 * Phase 4: Production-safe metrics collector
 */
const IS_PRODUCTION =
  typeof window !== "undefined" &&
  window.process?.env?.NODE_ENV === "production";
const DEBUG_ENABLED =
  !IS_PRODUCTION &&
  ((typeof window !== "undefined" && window.__DASHBOARD_DEBUG__) ||
    (typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).has("debug")));

interface PerformanceMetric {
  name: string;
  duration: number;
  timestamp: number;
}

const metricsCollector = DEBUG_ENABLED
  ? {
      marks: new Map<string, number>(),
      measures: [] as PerformanceMetric[],
      mark(name: string) {
        if (!performance || !performance.mark) return;
        try {
          performance.mark(name);
          this.marks.set(name, performance.now());
        } catch (_e) {
          /* ignore */
        }
      },
      measure(name: string, startMark: string, endMark: string) {
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
                timestamp: Date.now(),
              });
            }
          }
        } catch (_e) {
          /* ignore */
        }
      },
      getMetrics() {
        return {
          marks: Array.from(this.marks.entries()).map(([name, time]) => ({
            name,
            time,
          })),
          measures: [...this.measures],
        };
      },
      reset() {
        this.marks.clear();
        this.measures = [];
        if (performance && performance.clearMarks) performance.clearMarks();
        if (performance && performance.clearMeasures)
          performance.clearMeasures();
      },
    }
  : null;

if (DEBUG_ENABLED && typeof window !== "undefined") {
  window.__dashboardMetrics = metricsCollector;
}

// ============================================================================
// SDK Initialization - IMPORTED FROM ./modules/sdk
// initializeAdoSdk, isLocalMode, getLocalDatasetPath
// are now imported from "./modules"
// ============================================================================

// ============================================================================
// Configuration Resolution
// ============================================================================

/**
 * Parse and validate query parameters.
 */
function parseQueryParams(): QueryParamResult | PrInsightsError {
  const params = new URLSearchParams(window.location.search);

  const datasetUrl = params.get("dataset");
  const pipelineIdStr = params.get("pipelineId");

  // Check for dataset URL (highest priority)
  if (datasetUrl) {
    // Validate URL
    if (!datasetUrl.startsWith("https://")) {
      return createInvalidConfigError(
        "dataset",
        datasetUrl,
        "Must be a valid HTTPS URL",
      );
    }

    // Security warning for non-ADO domains
    const IS_DEV =
      window.location.hostname === "localhost" || params.has("devMode");

    if (!IS_DEV) {
      try {
        const urlHost = new URL(datasetUrl).hostname;
        const isAdoDomain =
          urlHost.endsWith("dev.azure.com") ||
          urlHost.endsWith(".visualstudio.com") ||
          urlHost.endsWith(".azure.com");
        if (!isAdoDomain) {
          console.warn(
            "SECURITY: ?dataset= URL %s is not an Azure DevOps domain. This parameter is intended for development only.",
            urlHost,
          );
        }
      } catch (_e) {
        return createInvalidConfigError(
          "dataset",
          datasetUrl,
          "Invalid URL format",
        );
      }
    }

    let warning: string | null = null;
    if (pipelineIdStr) {
      warning = "Both dataset and pipelineId specified; using dataset";
      console.warn(warning);
    }

    return { mode: "direct", value: datasetUrl, warning };
  }

  // Check for pipelineId
  if (pipelineIdStr) {
    const pipelineId = parseInt(pipelineIdStr, 10);
    if (isNaN(pipelineId) || pipelineId <= 0) {
      return createInvalidConfigError(
        "pipelineId",
        pipelineIdStr,
        "Must be a positive integer",
      );
    }
    return { mode: "explicit", value: pipelineId };
  }

  return { mode: "discover", value: null };
}

/**
 * Get source configuration from extension settings.
 */
async function getSourceConfig(): Promise<{
  projectId: string | null;
  pipelineId: number | null;
}> {
  const result: { projectId: string | null; pipelineId: number | null } = {
    projectId: null,
    pipelineId: null,
  };
  try {
    const dataService = await VSS.getService<IExtensionDataService>(
      VSS.ServiceIds.ExtensionData,
    );

    // Get source project ID
    const savedProjectId = await dataService.getValue<string>(
      SETTINGS_KEY_PROJECT,
      { scopeType: "User" },
    );
    if (
      savedProjectId &&
      typeof savedProjectId === "string" &&
      savedProjectId.trim()
    ) {
      result.projectId = savedProjectId.trim();
    }

    // Get pipeline definition ID
    const savedPipelineId = await dataService.getValue<number>(
      SETTINGS_KEY_PIPELINE,
      { scopeType: "User" },
    );
    if (
      savedPipelineId &&
      typeof savedPipelineId === "number" &&
      savedPipelineId > 0
    ) {
      result.pipelineId = savedPipelineId;
    }
  } catch (e) {
    console.log("Could not read extension settings:", e);
  }
  return result;
}

/**
 * Clear stale pipeline ID setting.
 */
async function clearStalePipelineSetting(): Promise<void> {
  try {
    const dataService = await VSS.getService<IExtensionDataService>(
      VSS.ServiceIds.ExtensionData,
    );
    await dataService.setValue(SETTINGS_KEY_PIPELINE, null, {
      scopeType: "User",
    });
    console.log("Cleared stale pipeline setting to re-enable auto-discovery");
  } catch (e) {
    console.warn("Could not clear stale pipeline setting:", e);
  }
}

/**
 * Resolve configuration using precedence rules.
 */
async function resolveConfiguration(): Promise<{
  buildId?: number;
  artifactName?: string;
  directUrl?: string;
}> {
  const queryResult = parseQueryParams();

  // Check for parsing error
  if (queryResult instanceof PrInsightsError) {
    throw queryResult;
  }

  // Mode: direct URL
  if (queryResult.mode === "direct") {
    // When mode is 'direct', value is always a string (URL)
    return { directUrl: queryResult.value as string };
  }

  // Get current project context
  const webContext = VSS.getWebContext();
  const currentProjectId = webContext.project?.id;
  if (!currentProjectId) {
    throw new Error("No project context available");
  }

  // Get configured source from settings
  const sourceConfig = await getSourceConfig();

  // Determine which project to use for artifact access
  const targetProjectId = sourceConfig.projectId || currentProjectId;

  console.log(
    "Source project: %s%s",
    targetProjectId,
    sourceConfig.projectId ? " (from settings)" : " (current context)",
  );

  // Initialize artifact client with target project
  artifactClient = new ArtifactClient(targetProjectId);
  await artifactClient.initialize();

  // Mode: explicit pipelineId from query
  if (queryResult.mode === "explicit") {
    // When mode is 'explicit', value is always a number (pipeline ID)
    return await resolveFromPipelineId(
      queryResult.value as number,
      targetProjectId,
    );
  }

  // Check settings for pipeline ID
  if (sourceConfig.pipelineId) {
    console.log(
      "Using pipeline definition ID from settings: %d",
      sourceConfig.pipelineId,
    );
    try {
      return await resolveFromPipelineId(
        sourceConfig.pipelineId,
        targetProjectId,
      );
    } catch (error: unknown) {
      console.warn(
        `Saved pipeline ${sourceConfig.pipelineId} is invalid, falling back to auto-discovery:`,
        getErrorMessage(error),
      );
      await clearStalePipelineSetting();
    }
  }

  // Mode: discovery in target project
  return await discoverAndResolve(targetProjectId);
}

/**
 * Resolve artifact info from a specific pipeline ID.
 * Uses ArtifactClient direct REST calls.
 */
async function resolveFromPipelineId(
  pipelineId: number,
  _projectId: string,
): Promise<{ buildId: number; artifactName: string }> {
  if (!artifactClient) throw new Error("ArtifactClient not initialized");

  // Get latest successful build for this pipeline
  const builds = await artifactClient.getBuilds(pipelineId);

  if (!builds || builds.length === 0) {
    throw createNoSuccessfulBuildsError(`ID ${pipelineId}`);
  }

  const latestBuild = builds[0];
  if (!latestBuild) throw new Error("Failed to retrieve latest build");

  // Check for aggregates artifact
  const artifacts = await artifactClient.getArtifacts(latestBuild.id);
  const hasAggregates = artifacts.some((a) => a.name === "aggregates");

  if (!hasAggregates) {
    const name = latestBuild.definition?.name || `ID ${pipelineId}`;
    throw createArtifactsMissingError(name, latestBuild.id);
  }

  return { buildId: latestBuild.id, artifactName: "aggregates" };
}

/**
 * Discover pipelines with aggregates and resolve.
 */
async function discoverAndResolve(
  projectId: string,
): Promise<{ buildId: number; artifactName: string }> {
  const matches = await discoverInsightsPipelines(projectId);

  if (matches.length === 0) {
    throw createSetupRequiredError();
  }

  const firstMatch = matches[0];
  if (!firstMatch) throw createSetupRequiredError();

  return { buildId: firstMatch.buildId, artifactName: "aggregates" };
}

/**
 * Discover pipelines with aggregates artifact.
 * Uses ArtifactClient direct REST calls.
 */
async function discoverInsightsPipelines(
  _projectId: string,
): Promise<Array<{ id: number; name: string; buildId: number }>> {
  if (!artifactClient) throw new Error("ArtifactClient not initialized");
  const matches: Array<{ id: number; name: string; buildId: number }> = [];

  const definitions = await artifactClient.getDefinitions();

  for (const def of definitions) {
    try {
      const builds = await artifactClient.getBuilds(def.id);
      if (!builds || builds.length === 0) continue;

      const latestBuild = builds[0];
      if (!latestBuild) continue;

      const artifacts = await artifactClient.getArtifacts(latestBuild.id);
      if (!artifacts.some((a) => a.name === "aggregates")) continue;

      matches.push({
        id: def.id,
        name: def.name,
        buildId: latestBuild.id,
      });
    } catch (e) {
      console.debug(`Skipping pipeline ${def.name}:`, e);
    }
  }

  return matches;
}

// All Build API access now goes through ArtifactClient direct REST

/**
 * Initialize the dashboard.
 */
async function init(): Promise<void> {
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

    await initializeAdoSdk({
      onReady: () => {
        // Update project name in UI after SDK initialization
        const webContext = VSS.getWebContext();
        const projectNameEl = document.getElementById("current-project-name");
        if (projectNameEl && webContext?.project?.name) {
          projectNameEl.textContent = webContext.project.name;
        }
      },
    });
    const config = await resolveConfiguration();

    if (config.directUrl) {
      loader = new DatasetLoader(config.directUrl);
      currentBuildId = null;
    } else if (config.buildId && config.artifactName && artifactClient) {
      loader = artifactClient.createDatasetLoader(
        config.buildId,
        config.artifactName,
      );
      currentBuildId = config.buildId;
    } else {
      throw new Error("Failed to resolve configuration");
    }

    await loadDataset();
  } catch (error: unknown) {
    console.error("Dashboard initialization failed:", error);
    handleError(error);
  }
}

// ============================================================================
// Error Handling - IMPORTED FROM ./modules/errors
// handleError, hideAllPanels, showSetupRequired, showMultiplePipelines,
// showPermissionDenied, showGenericError, showArtifactsMissing
// are now imported from "./modules"
// ============================================================================

// ============================================================================
// DOM and Event Handling
// ============================================================================

/**
 * Cache DOM elements for performance.
 */
function cacheElements(): void {
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
    "comments-coverage-banner",
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
    "reviewer-filter",
    "reviewer-filter-notice",
    "author-filter",
    "author-filter-options",
    "repo-filter-group",
    "team-filter-group",
    "reviewer-filter-group",
    "author-filter-group",
    "author-filter-notice",
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
    "export-raw-zip",
    "total-prs-label",
    "authors-count-label",
    "reviewers-count-label",
    "reviewer-activity-label",
  ];

  ids.forEach((id) => {
    // eslint-disable-next-line security/detect-object-injection -- SECURITY: id is from hardcoded array of DOM element IDs
    elements[id] = document.getElementById(id);
  });

  elementLists.tabs = document.querySelectorAll(".tab");
}

/**
 * Initialize Phase 5 features (ML tabs).
 * Tabs are always visible - state machine handles rendering appropriate UI.
 */
function initializePhase5Features(): void {
  // Phase 5 tabs (Predictions, AI Insights) are now always visible
  // The state machine handles rendering the appropriate state UI
  // (setup-required, no-data, invalid-artifact, unsupported-schema, ready)
  console.log("Phase 5 ML features initialized - tabs visible by default");
}

/**
 * Set up event listeners.
 */
function setupEventListeners(): void {
  elements["date-range"]?.addEventListener("change", handleDateRangeChange);
  document
    .getElementById("apply-dates")
    ?.addEventListener("click", applyCustomDates);

  elementLists.tabs?.forEach((tab) => {
    const htmlTab = tab as HTMLElement;
    htmlTab.addEventListener("click", () => {
      const tabId = htmlTab.dataset["tab"];
      if (tabId) switchTab(tabId);
    });
  });

  elements["retry-btn"]?.addEventListener("click", () => init());
  document
    .getElementById("setup-retry-btn")
    ?.addEventListener("click", () => init());
  document
    .getElementById("permission-retry-btn")
    ?.addEventListener("click", () => init());

  // Filter event listeners now managed by typeahead component onChange callbacks
  // (wired in populateFilterDropdowns → initTypeaheadDropdown)
  elements["clear-filters"]?.addEventListener("click", clearAllFilters);

  elements["compare-toggle"]?.addEventListener("click", toggleComparisonMode);
  elements["exit-compare"]?.addEventListener("click", exitComparisonMode);

  elements["export-btn"]?.addEventListener("click", toggleExportMenu);
  elements["export-csv"]?.addEventListener("click", exportToCsv);
  elements["export-link"]?.addEventListener("click", copyShareableLink);
  elements["export-raw-zip"]?.addEventListener("click", downloadRawDataZip);

  document.addEventListener("click", (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (!target.closest(".export-dropdown")) {
      elements["export-menu"]?.classList.add("hidden");
    }
  });
}

// ============================================================================
// Data Loading and Rendering
// ============================================================================

/**
 * Load the dataset.
 */
async function loadDataset(): Promise<void> {
  showLoading();

  try {
    if (!loader) throw new Error("Loader not initialized");

    // Load manifest first
    const manifest = await loader.loadManifest();

    // Load dimensions
    const dimensions = await loader.loadDimensions();
    currentDimensions = dimensions;

    // Populate filter dropdowns from dimensions
    populateFilterDropdowns(dimensions);

    // Show dataset info
    updateDatasetInfo(manifest);

    // Restore state from URL if present
    restoreStateFromUrl();

    // Set initial date range from manifest defaults
    setInitialDateRange();

    // Load and render metrics
    await refreshMetrics();

    // Update feature tabs based on manifest
    await updateFeatureTabs();

    showContent();
  } catch (error) {
    console.error("Failed to load dataset:", error);
    handleError(error);
  }
}

/**
 * Set initial date range from manifest defaults.
 */
function setInitialDateRange(): void {
  // Skip if already restored from URL
  if (currentDateRange.start && currentDateRange.end) return;
  if (!loader) return;

  const coverage = loader.getCoverage() || null;
  const defaultDays = loader.getDefaultRangeDays() || 90;

  if (coverage?.date_range?.max) {
    const endDate = new Date(coverage.date_range.max);
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - defaultDays);

    currentDateRange = { start: startDate, end: endDate };

    const startDateEl = elements["start-date"] as HTMLInputElement | null;
    const endDateEl = elements["end-date"] as HTMLInputElement | null;
    if (startDateEl) {
      startDateEl.value = startDate.toISOString().split("T")[0] ?? "";
    }
    if (endDateEl) {
      endDateEl.value = endDate.toISOString().split("T")[0] ?? "";
    }
  }
}

// getPreviousPeriod and applyFiltersToRollups are now imported from "./modules/metrics"

/**
 * Refresh metrics for current date range.
 */
async function refreshMetrics(): Promise<void> {
  if (!currentDateRange.start || !currentDateRange.end || !loader) return;

  // Load current period data
  const rawRollups = await loader.getWeeklyRollups(
    currentDateRange.start,
    currentDateRange.end,
  );

  const distributions = await loader.getDistributions(
    currentDateRange.start,
    currentDateRange.end,
  );

  // Apply dimension filters to rollups
  const rollups = applyFiltersToRollups(rawRollups, currentFilters);

  // Load previous period data for comparison
  const prevPeriod = getPreviousPeriod(
    currentDateRange.start,
    currentDateRange.end,
  );
  let prevRollups: Rollup[] = [];
  try {
    const rawPrevRollups = await loader.getWeeklyRollups(
      prevPeriod.start,
      prevPeriod.end,
    );
    prevRollups = applyFiltersToRollups(rawPrevRollups, currentFilters);
  } catch (e) {
    console.debug("Previous period data not available:", e);
  }

  // Cache filtered rollups for export
  cachedRollups = rollups;

  // T012: Accuracy indicator — when both team and repo filters active,
  // check if any visible rollup lacks by_team_and_repo (pre-migration data).
  updateAccuracyIndicator(rawRollups, currentFilters);

  // T012a: Multi-team overlap indicator — when multiple teams selected
  // and cross-dim PR sum exceeds repository total.
  updateOverlapIndicator(rawRollups, currentFilters);

  // Derive data availability signal for empty-state classification
  const availability = deriveAvailabilitySignal(
    rawRollups,
    loader?.getCapabilityState?.() ?? null,
  );

  renderSummaryCards(rollups, prevRollups);
  renderThroughputChart(rollups, rawRollups, availability);
  renderCycleTimeTrend(rollups, rawRollups, availability);
  renderReviewerActivity(rollups, rawRollups, availability);
  renderCycleDistribution(distributions, rawRollups, availability);

  // Update comparison banner if in comparison mode
  if (comparisonMode) {
    updateComparisonBanner();
  }
}

/**
 * Update accuracy indicator for mixed exact/estimated data.
 * Sets a data-accuracy attribute on .summary-cards when both team and repo
 * filters are active and some rollups lack by_team_and_repo data or have
 * truncated cross-dim maps (_truncated flag from hard-cap enforcement).
 * CSS ::after rules render the appropriate footnote.
 *
 * @param rawRollups - Unfiltered rollups for the current date range
 * @param filters - Current dimension filter state
 */
function updateAccuracyIndicator(
  rawRollups: Rollup[],
  filters: { repos: string[]; teams: string[]; authors: string[] },
): void {
  const summarySection = document.querySelector(".summary-cards");
  if (!summarySection) return;

  const isTeamRepoFilter = filters.repos.length > 0 && filters.teams.length > 0;
  const isAuthorRepoFilter =
    filters.repos.length > 0 && filters.authors.length > 0;

  if (!isTeamRepoFilter && !isAuthorRepoFilter) {
    summarySection.removeAttribute("data-accuracy");
    return;
  }

  const isEstimated = (r: Rollup): boolean => {
    if (isTeamRepoFilter) {
      return (
        r.by_team_and_repo == null ||
        (r.by_team_and_repo as Record<string, unknown>)["_truncated"] === true
      );
    }

    return (
      r.by_author_and_repo == null ||
      (r.by_author_and_repo as Record<string, unknown>)["_truncated"] === true
    );
  };

  const hasEstimatedWeeks = rawRollups.some(isEstimated);

  if (hasEstimatedWeeks) {
    // Some weeks use proportional estimation — flag for the user.
    const allEstimated = rawRollups.every(isEstimated);
    summarySection.setAttribute(
      "data-accuracy",
      allEstimated ? "approximate" : "mixed",
    );
  } else {
    // All weeks have exact cross-dim data — no indicator needed.
    summarySection.removeAttribute("data-accuracy");
  }
}

/**
 * Update multi-team overlap indicator (FR-016).
 * Sets data-overlap="true" on .summary-cards when multiple teams are selected
 * and cross-dim PR count sum exceeds the repository total (multi-team membership).
 * CSS ::after rules render the footnote.
 *
 * @param rawRollups - Unfiltered rollups for the current date range
 * @param filters - Current dimension filter state
 */
function updateOverlapIndicator(
  rawRollups: Rollup[],
  filters: { repos: string[]; teams: string[] },
): void {
  const summarySection = document.querySelector(".summary-cards");
  if (!summarySection) return;

  const hasMultipleTeams = filters.teams.length > 1;
  const hasRepoFilter = filters.repos.length > 0;

  if (!hasMultipleTeams || !hasRepoFilter) {
    summarySection.removeAttribute("data-overlap");
    return;
  }

  // Check if any rollup has cross-dim data where the team sum exceeds repo total.
  // Skip truncated maps — incomplete entries could give false results.
  let hasOverlap = false;
  for (const rollup of rawRollups) {
    if (!rollup.by_team_and_repo || !rollup.by_repository) continue;
    if (
      (rollup.by_team_and_repo as Record<string, unknown>)["_truncated"] ===
      true
    )
      continue;

    for (const repo of filters.repos) {
      const repoEntry = getOwnRecordValue(rollup.by_repository, repo);
      if (!repoEntry) continue;

      let crossDimSum = 0;
      for (const team of filters.teams) {
        const teamRepos = getOwnRecordValue(rollup.by_team_and_repo, team);
        if (!teamRepos) continue;
        const entry = getOwnRecordValue(teamRepos, repo);
        if (entry) crossDimSum += entry.pr_count;
      }

      if (crossDimSum > repoEntry.pr_count) {
        hasOverlap = true;
        break;
      }
    }
    if (hasOverlap) break;
  }

  if (hasOverlap) {
    summarySection.setAttribute("data-overlap", "true");
  } else {
    summarySection.removeAttribute("data-overlap");
  }
}

// CalculatedMetrics, calculateMetrics, calculatePercentChange, extractSparklineData
// are now imported from "./modules/metrics"

// renderDelta and renderSparkline are now imported from "./modules/charts"

/**
 * Render summary metric cards.
 * Thin wrapper that builds container references and delegates to extracted module.
 */
function renderSummaryCards(
  rollups: Rollup[],
  prevRollups: Rollup[] = [],
): void {
  // Build container references from cached elements
  const containers: SummaryCardsContainers = {
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
    reviewersDelta: elements["reviewers-delta"] ?? null,
  };

  renderSummaryCardsModule({
    rollups,
    prevRollups,
    containers,
    metricsCollector,
  });
}

// calculateMovingAverage is now imported by ./modules/charts/throughput

/**
 * Render throughput chart with trend line overlay.
 * Thin wrapper that delegates to extracted module.
 */
function renderThroughputChart(
  rollups: Rollup[],
  unfilteredRollups?: Rollup[],
  availability?: import("./types").DataAvailabilitySignal,
): void {
  renderThroughputChartModule(elements["throughput-chart"] ?? null, rollups, {
    filters: currentFilters,
    unfilteredRollups,
    availability,
  });
}

/**
 * Render cycle time distribution.
 * Thin wrapper that delegates to extracted module.
 */
function renderCycleDistribution(
  distributions: DistributionData[],
  unfilteredRollups?: Rollup[],
  availability?: import("./types").DataAvailabilitySignal,
): void {
  renderCycleDistributionModule(
    elements["cycle-distribution"] ?? null,
    distributions,
    {
      filters: currentFilters,
      unfilteredRollups,
      availability,
    },
  );
}

/**
 * Render cycle time trend chart (line chart with P50 and P90).
 * Thin wrapper that delegates to extracted module.
 */
function renderCycleTimeTrend(
  rollups: Rollup[],
  unfilteredRollups?: Rollup[],
  availability?: import("./types").DataAvailabilitySignal,
): void {
  renderCycleTimeTrendModule(elements["cycle-time-trend"] ?? null, rollups, {
    filters: currentFilters,
    unfilteredRollups,
    availability,
  });
}

/**
 * Render reviewer activity chart (horizontal bar chart).
 * Thin wrapper that delegates to extracted module.
 */
function renderReviewerActivity(
  rollups: Rollup[],
  unfilteredRollups?: Rollup[],
  availability?: import("./types").DataAvailabilitySignal,
): void {
  renderReviewerActivityModule(elements["reviewer-activity"] ?? null, rollups, {
    reviewerFilterActive: currentFilters.reviewers.length > 0,
    filters: currentFilters,
    unfilteredRollups,
    availability,
  });
}

// addChartTooltips is now imported from "./modules/charts"

/**
 * Convert loader result to ArtifactLoadResult for state machine.
 * Maps loader states to the state machine's expected format.
 *
 * @param loaderResult - Result from loader.loadPredictions() or loader.loadInsights()
 * @param artifactPath - Path for error messages
 * @returns ArtifactLoadResult for state machine
 */
function toArtifactLoadResult(
  loaderResult:
    | { state?: string; data?: unknown; error?: string; message?: string }
    | null
    | undefined,
  artifactPath: string,
): ArtifactLoadResult {
  if (!loaderResult) {
    return { exists: false, data: null, path: artifactPath };
  }

  switch (loaderResult.state) {
    case "missing":
    case "disabled":
    case "unavailable":
      // File doesn't exist or feature is disabled -> setup-required
      return { exists: false, data: null, path: artifactPath };

    case "invalid":
      // File exists but failed validation -> invalid-artifact
      return {
        exists: true,
        data: loaderResult.data,
        parseError:
          loaderResult.message ||
          loaderResult.error ||
          "Schema validation failed",
        path: artifactPath,
      };

    case "error":
    case "auth":
    case "auth_required":
      // Error fetching file - treat as parse error for state machine
      return {
        exists: true,
        data: null,
        parseError:
          loaderResult.message ||
          loaderResult.error ||
          "Failed to load artifact",
        path: artifactPath,
      };

    case "ok":
      // File exists and is valid
      return {
        exists: true,
        data: loaderResult.data,
        path: artifactPath,
      };

    default:
      // Unknown state - treat as missing
      return { exists: false, data: null, path: artifactPath };
  }
}

/**
 * Update feature tabs based on manifest.
 * Uses state machine to determine correct UI state for each ML tab.
 * Follows FR-001 through FR-004: 5-state gating with first-match-wins semantics.
 */
async function updateFeatureTabs(): Promise<void> {
  if (!loader) return;

  // Check if loader supports loadPredictions/loadInsights using type guard
  if (!hasMLMethods(loader)) return;

  // Update Predictions tab using state machine
  const predictionsContent = document.getElementById("tab-predictions");
  if (predictionsContent) {
    const predictionsResult = await loader.loadPredictions();
    const loadResult = toArtifactLoadResult(
      predictionsResult,
      "predictions/trends.json",
    );
    const state = resolvePredictionsState(loadResult);
    renderPredictionsForState(predictionsContent, state, cachedRollups);
  }

  // Update AI Insights tab using state machine
  const aiContent = document.getElementById("tab-ai-insights");
  if (aiContent) {
    const insightsResult = await loader.loadInsights();
    const loadResult = toArtifactLoadResult(
      insightsResult,
      "insights/summary.json",
    );
    const state = resolveInsightsState(loadResult);
    renderInsightsForState(aiContent, state);
  }
}

// ============================================================================
// Event Handlers
// ============================================================================

function handleDateRangeChange(e: Event): void {
  const target = e.target as HTMLSelectElement;
  const value = target.value;

  if (value === "custom") {
    elements["custom-dates"]?.classList.remove("hidden");
    return;
  }

  elements["custom-dates"]?.classList.add("hidden");

  const days = parseInt(value, 10);
  const coverage = loader?.getCoverage() || null;
  const endDate = coverage?.date_range?.max
    ? new Date(coverage.date_range.max)
    : new Date();
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - days);

  currentDateRange = { start: startDate, end: endDate };
  updateUrlState();
  void refreshMetrics();
}

function applyCustomDates(): void {
  const start = (elements["start-date"] as HTMLInputElement)?.value;
  const end = (elements["end-date"] as HTMLInputElement)?.value;

  if (!start || !end) return;

  currentDateRange = { start: new Date(start), end: new Date(end) };
  updateUrlState();
  void refreshMetrics();
}

function switchTab(tabId: string): void {
  elementLists.tabs?.forEach((tab) => {
    const htmlTab = tab as HTMLElement;
    const isActive = htmlTab.dataset["tab"] === tabId;
    htmlTab.classList.toggle("active", isActive);
    htmlTab.setAttribute("aria-selected", isActive ? "true" : "false");
  });

  document.querySelectorAll(".tab-content").forEach((content) => {
    content.classList.toggle("active", content.id === `tab-${tabId}`);
    content.classList.toggle("hidden", content.id !== `tab-${tabId}`);
  });

  updateUrlState();
}

// ============================================================================
// Filter Management
// ============================================================================

/**
 * Populate filter dropdowns from loaded dimensions.
 *
 * IMPORTANT: The dimensions from aggregators.py use these property names:
 * - Repositories: repository_id, repository_name, project_name, organization_name
 * - Teams: team_id, team_name, project_name, organization_name, member_count
 *
 * The filter values MUST use repository_name/team_name because that's how
 * the by_repository and by_team slices in weekly rollups are keyed.
 *
 * Uses unified typeahead dropdown components (FR-005) with single/multi modes.
 */
function populateFilterDropdowns(dimensions: DimensionsData | null): void {
  if (!dimensions) return;

  // Destroy previous instances to prevent listener leaks on re-initialization
  typeaheadRepo?.destroy();
  typeaheadTeam?.destroy();
  typeaheadReviewer?.destroy();
  typeaheadAuthor?.destroy();

  // Populate repository filter (multi-select)
  if (dimensions.repositories && dimensions.repositories.length > 0) {
    typeaheadRepo = initTypeaheadDropdown({
      containerId: "repo-filter",
      options: dimensions.repositories.map((r) => ({
        id: r.repository_name,
        displayName: r.repository_name,
      })),
      mode: "multi",
      placeholder: "Search repositories...",
      initialSelection: [],
      onChange: () => handleTypeaheadFilterChange(),
    });
    elements["repo-filter-group"]?.classList.remove("hidden");
  } else {
    typeaheadRepo = null;
    elements["repo-filter-group"]?.classList.add("hidden");
  }

  // Populate team filter (multi-select)
  if (dimensions.teams && dimensions.teams.length > 0) {
    typeaheadTeam = initTypeaheadDropdown({
      containerId: "team-filter",
      options: dimensions.teams.map((t) => ({
        id: t.team_name,
        displayName: t.team_name,
      })),
      mode: "multi",
      placeholder: "Search teams...",
      initialSelection: [],
      onChange: () => handleTypeaheadFilterChange(),
    });
    elements["team-filter-group"]?.classList.remove("hidden");
  } else {
    typeaheadTeam = null;
    elements["team-filter-group"]?.classList.add("hidden");
  }

  // Populate reviewer filter (single-select)
  if (dimensions.reviewers && dimensions.reviewers.length > 0) {
    typeaheadReviewer = initTypeaheadDropdown({
      containerId: "reviewer-filter",
      options: dimensions.reviewers.map((r) => ({
        id: r.reviewer_id,
        displayName: r.reviewer_name,
      })),
      mode: "single",
      placeholder: "Search reviewers...",
      initialSelection: [],
      onChange: () => handleTypeaheadFilterChange(),
    });
    elements["reviewer-filter-group"]?.classList.remove("hidden");
  } else {
    typeaheadReviewer = null;
    elements["reviewer-filter-group"]?.classList.add("hidden");
  }

  // Populate author filter (single-select)
  if (dimensions.authors && dimensions.authors.length > 0) {
    typeaheadAuthor = initTypeaheadDropdown({
      containerId: "author-filter",
      options: dimensions.authors.map((a) => ({
        id: a.author_id,
        displayName: a.author_name,
      })),
      mode: "single",
      placeholder: "Search authors...",
      initialSelection: [],
      onChange: () => handleTypeaheadFilterChange(),
    });
    elements["author-filter-group"]?.classList.remove("hidden");
  } else {
    typeaheadAuthor = null;
    elements["author-filter-group"]?.classList.add("hidden");
  }

  // Restore filter state from URL
  restoreFiltersFromUrl();
}

function clearSelectToAll(select: HTMLSelectElement | null): void {
  if (!select) return;
  Array.from(select.options).forEach((o) => {
    o.selected = o.value === "";
  });
}

function normalizeReviewerSelection(
  reviewerValues: string[],
  source: "ui" | "url",
): string[] {
  if (reviewerValues.length <= 1) {
    return reviewerValues;
  }

  const ignored = reviewerValues.slice(1);
  console.warn(
    `Reviewer Phase 1 supports a single exact reviewer filter; ignoring additional ${source} values:`,
    ignored,
  );
  return reviewerValues[0] ? [reviewerValues[0]] : [];
}

function normalizeAuthorSelection(
  authorValues: string[],
  dimensions: DimensionsData | null,
): string[] {
  const firstValue = authorValues[0];
  if (!firstValue) {
    return [];
  }

  const matchedAuthor = dimensions?.authors?.find(
    (author) =>
      author.author_id === firstValue || author.author_name === firstValue,
  );

  if (!matchedAuthor) {
    console.warn("Ignoring invalid author filter value:", firstValue);
    return [];
  }

  return [matchedAuthor.author_id];
}

function clearAuthorInput(): void {
  const authorFilter = elements["author-filter"] as HTMLInputElement | null;
  if (authorFilter) {
    authorFilter.value = "";
  }
}

function applyAuthorFilterCompatibility(
  sourceId: string | null,
  filters: {
    repos: string[];
    teams: string[];
    reviewers: string[];
    authors: string[];
  },
): {
  repos: string[];
  teams: string[];
  reviewers: string[];
  authors: string[];
} {
  if (filters.authors.length === 0) {
    return filters;
  }

  const reviewerFilter = elements[
    "reviewer-filter"
  ] as HTMLSelectElement | null;

  if (filters.reviewers.length > 0) {
    if (sourceId === "author-filter") {
      clearSelectToAll(reviewerFilter);
      return { ...filters, reviewers: [] };
    }

    if (sourceId === "reviewer-filter") {
      clearAuthorInput();
      return { ...filters, authors: [] };
    }

    console.warn(
      "Author filters cannot be combined with reviewer filters in the current schema; keeping reviewer filters only",
    );
    clearAuthorInput();
    return { ...filters, authors: [] };
  }

  return filters;
}

function applyReviewerFilterCompatibility(
  sourceId: string | null,
  repoValues: string[],
  teamValues: string[],
  reviewerValues: string[],
): { repos: string[]; teams: string[]; reviewers: string[] } {
  const normalizedReviewers = normalizeReviewerSelection(reviewerValues, "ui");
  const reviewerRepoNotice =
    "Reviewer + repository uses reviewer-only metrics while retaining repository state.";
  const reviewerTeamNotice =
    "Reviewer + team is not supported in the current schema. Team selection was cleared.";

  reviewerFilterNoticeMessage = null;

  if (
    normalizedReviewers.length === 0 ||
    (repoValues.length === 0 && teamValues.length === 0)
  ) {
    return {
      repos: repoValues,
      teams: teamValues,
      reviewers: normalizedReviewers,
    };
  }

  const teamFilter = elements["team-filter"] as HTMLSelectElement | null;

  if (teamValues.length > 0) {
    reviewerFilterNoticeMessage = reviewerTeamNotice;
    clearSelectToAll(teamFilter);
    return { repos: repoValues, teams: [], reviewers: normalizedReviewers };
  }

  if (repoValues.length > 0) {
    reviewerFilterNoticeMessage = reviewerRepoNotice;
    if (sourceId !== "reviewer-filter") {
      console.warn(reviewerRepoNotice);
    }
  }

  return { repos: repoValues, teams: [], reviewers: normalizedReviewers };
}

/**
 * Handle filter change from typeahead components.
 *
 * Reads selections from all typeahead instances, resolves constraints
 * via the single-authority resolver (FR-010), and updates state.
 */
function handleTypeaheadFilterChange(): void {
  const rawState = {
    repos: typeaheadRepo?.getSelected() ?? [],
    teams: typeaheadTeam?.getSelected() ?? [],
    reviewers: typeaheadReviewer?.getSelected() ?? [],
    authors: typeaheadAuthor?.getSelected() ?? [],
  };

  // FR-010: Single-authority constraint resolution
  const { effectiveState, constraintsApplied } =
    resolveFilterConstraints(rawState);

  // Update notice message from constraint resolver
  const notice = constraintsApplied[0];
  reviewerFilterNoticeMessage = notice?.message ?? null;

  // Sync typeahead UI with resolved state (constraints may have cleared selections)
  if (
    constraintsApplied.some(
      (n) => n.type === "author_team" || n.type === "reviewer_team",
    )
  ) {
    typeaheadTeam?.setSelected(effectiveState.teams);
  }

  currentFilters = effectiveState;
  updateFilterUI();
  updateUrlState();
  void refreshMetrics();
}

/**
 * Legacy handleFilterChange kept for backward compatibility with any
 * remaining event listeners. Delegates to typeahead handler.
 */
function handleFilterChange(_event: Event): void {
  handleTypeaheadFilterChange();
}

/**
 * Clear all filters.
 */
function clearAllFilters(): void {
  currentFilters = { repos: [], teams: [], reviewers: [], authors: [] };
  reviewerFilterNoticeMessage = null;

  typeaheadRepo?.clear();
  typeaheadTeam?.clear();
  typeaheadReviewer?.clear();
  typeaheadAuthor?.clear();

  updateFilterUI();
  updateUrlState();
  void refreshMetrics();
}

/**
 * Find an <option> element by value inside a <select>, using CSS.escape
 * to safely handle special characters in the value attribute.
 */
function findOptionByValue(
  select: HTMLSelectElement | null,
  value: string,
): HTMLOptionElement | null {
  return select?.querySelector(
    `option[value="${CSS.escape(value)}"]`,
  ) as HTMLOptionElement | null;
}

/**
 * Remove a specific filter.
 */
function removeFilter(type: string, value: string): void {
  if (type === "repo") {
    currentFilters.repos = currentFilters.repos.filter((v) => v !== value);
    typeaheadRepo?.setSelected(currentFilters.repos);
  } else if (type === "team") {
    currentFilters.teams = currentFilters.teams.filter((v) => v !== value);
    typeaheadTeam?.setSelected(currentFilters.teams);
  } else if (type === "reviewer") {
    currentFilters.reviewers = currentFilters.reviewers.filter(
      (v) => v !== value,
    );
    typeaheadReviewer?.setSelected(currentFilters.reviewers);
  } else if (type === "author") {
    currentFilters.authors = currentFilters.authors.filter((v) => v !== value);
    typeaheadAuthor?.setSelected(currentFilters.authors);
  }

  updateFilterUI();
  updateUrlState();
  void refreshMetrics();
}

/**
 * Update filter UI.
 */
function updateFilterUI(): void {
  const hasFilters =
    currentFilters.repos.length > 0 ||
    currentFilters.teams.length > 0 ||
    currentFilters.reviewers.length > 0 ||
    currentFilters.authors.length > 0;

  if (elements["clear-filters"]) {
    elements["clear-filters"].classList.toggle("hidden", !hasFilters);
  }

  if (elements["active-filters"] && elements["filter-chips"]) {
    elements["active-filters"].classList.toggle("hidden", !hasFilters);

    if (hasFilters) {
      renderFilterChips();
    } else {
      clearElement(elements["filter-chips"]);
    }
  }

  updateMetricLabels();
}

/**
 * Render filter chips for active filters.
 */
function renderFilterChips(): void {
  const chipsEl = elements["filter-chips"] as HTMLElement | null;
  if (!chipsEl) return;

  const chips: string[] = [];

  currentFilters.repos.forEach((value) => {
    const label = getFilterLabel("repo", value);
    chips.push(createFilterChip("repo", value, label));
  });

  currentFilters.teams.forEach((value) => {
    const label = getFilterLabel("team", value);
    chips.push(createFilterChip("team", value, label));
  });

  currentFilters.reviewers.forEach((value) => {
    const label = getFilterLabel("reviewer", value);
    chips.push(createFilterChip("reviewer", value, label));
  });

  currentFilters.authors.forEach((value) => {
    const label = getFilterLabel("author", value);
    chips.push(createFilterChip("author", value, label));
  });

  // SECURITY: Filter chips use escapeHtml for all values
  renderTrustedHtml(chipsEl, chips.join(""));

  // C1 fix: event delegation — re-attach if container element changes
  if (chipsDelegatedElement !== chipsEl) {
    chipsDelegatedElement = chipsEl;
    chipsEl.addEventListener("click", (e: Event) => {
      const btn = (e.target as HTMLElement).closest(
        ".filter-chip-remove",
      ) as HTMLElement | null;
      if (!btn) return;
      const type = btn.dataset["type"];
      const val = btn.dataset["value"];
      if (type && val) removeFilter(type, val);
    });
  }
}

/**
 * Get display label for a filter value.
 * Looks up display name from dimension data rather than DOM elements.
 */
function getFilterLabel(type: string, value: string): string {
  if (type === "repo") {
    return (
      currentDimensions?.repositories?.find(
        (r) => r.repository_name === value,
      )?.repository_name ?? value
    );
  }
  if (type === "team") {
    return (
      currentDimensions?.teams?.find((t) => t.team_name === value)
        ?.team_name ?? value
    );
  }
  if (type === "reviewer") {
    return (
      currentDimensions?.reviewers?.find((r) => r.reviewer_id === value)
        ?.reviewer_name ?? value
    );
  }
  if (type === "author") {
    return (
      currentDimensions?.authors?.find((a) => a.author_id === value)
        ?.author_name ?? value
    );
  }
  return value;
}

/**
 * Create HTML for a filter chip.
 */
function createFilterChip(type: string, value: string, label: string): string {
  const prefix =
    type === "repo"
      ? "repo"
      : type === "team"
        ? "team"
        : type === "reviewer"
          ? "reviewer"
          : "author";
  // SECURITY: Escape user-controlled values to prevent XSS
  return `
        <span class="filter-chip">
            <span class="filter-chip-label">${prefix}: ${escapeHtml(label)}</span>
            <span class="filter-chip-remove" data-type="${escapeHtml(type)}" data-value="${escapeHtml(value)}">&times;</span>
        </span>
    `;
}

function updateMetricLabels(): void {
  const reviewerMode = currentFilters.reviewers.length > 0;
  const authorTeamConstrained =
    currentFilters.authors.length > 0 && currentFilters.teams.length > 0;
  elements["author-filter-notice"]?.classList.toggle(
    "hidden",
    !authorTeamConstrained,
  );
  const reviewerNotice = elements["reviewer-filter-notice"];
  if (reviewerNotice) {
    if (reviewerFilterNoticeMessage) {
      reviewerNotice.textContent = reviewerFilterNoticeMessage;
      reviewerNotice.classList.remove("hidden");
      reviewerNotice.classList.add("filter-hint-warning");
    } else {
      reviewerNotice.textContent = "";
      reviewerNotice.classList.add("hidden");
      reviewerNotice.classList.remove("filter-hint-warning");
    }
  }

  if (elements["total-prs-label"]) {
    elements["total-prs-label"].textContent = reviewerMode
      ? "Reviewed PRs"
      : "Total PRs";
  }
  if (elements["authors-count-label"]) {
    elements["authors-count-label"].textContent = reviewerMode
      ? "Reviewed Authors"
      : "Contributors";
  }
  if (elements["reviewers-count-label"]) {
    elements["reviewers-count-label"].textContent = reviewerMode
      ? "Reviews"
      : "Reviewers";
  }
  if (elements["reviewer-activity-label"]) {
    elements["reviewer-activity-label"].textContent = reviewerMode
      ? "Review Activity"
      : "Reviewer Activity";
  }
}

/**
 * Restore filters from URL parameters.
 *
 * Uses parseFiltersFromUrl for canonical deserialization (FR-009),
 * then validates against available dimensions, resolves constraints
 * via the single-authority resolver (FR-010), and syncs typeahead UI.
 */
function restoreFiltersFromUrl(): void {
  const params = new URLSearchParams(window.location.search);
  const parsed = parseFiltersFromUrl(params);

  // Validate against available dimension options
  const validRepos = parsed.repos.filter((v) =>
    currentDimensions?.repositories?.some((r) => r.repository_name === v),
  );
  if (validRepos.length < parsed.repos.length) {
    console.warn(
      "Ignoring invalid repo filters from URL:",
      parsed.repos.filter((v) => !validRepos.includes(v)),
    );
  }

  const validTeams = parsed.teams.filter((v) =>
    currentDimensions?.teams?.some((t) => t.team_name === v),
  );
  if (validTeams.length < parsed.teams.length) {
    console.warn(
      "Ignoring invalid team filters from URL:",
      parsed.teams.filter((v) => !validTeams.includes(v)),
    );
  }

  const validReviewers = parsed.reviewers.filter((v) =>
    currentDimensions?.reviewers?.some((r) => r.reviewer_id === v),
  );
  if (validReviewers.length < parsed.reviewers.length) {
    console.warn(
      "Ignoring invalid reviewer filters from URL:",
      parsed.reviewers.filter((v) => !validReviewers.includes(v)),
    );
  }

  const validAuthors = parsed.authors.filter((v) =>
    currentDimensions?.authors?.some(
      (a) => a.author_id === v || a.author_name === v,
    ),
  );
  // Normalize author names to IDs
  const normalizedAuthors = validAuthors.map((v) => {
    const match = currentDimensions?.authors?.find(
      (a) => a.author_id === v || a.author_name === v,
    );
    return match?.author_id ?? v;
  });
  if (normalizedAuthors.length < parsed.authors.length) {
    console.warn(
      "Ignoring invalid author filters from URL:",
      parsed.authors.filter((v) => !validAuthors.includes(v)),
    );
  }

  // Resolve constraints via single-authority resolver (FR-010)
  const { effectiveState, constraintsApplied } = resolveFilterConstraints({
    repos: validRepos,
    teams: validTeams,
    reviewers: validReviewers,
    authors: normalizedAuthors,
  });

  reviewerFilterNoticeMessage = constraintsApplied[0]?.message ?? null;
  currentFilters = effectiveState;

  // Sync typeahead UI with restored state
  typeaheadRepo?.setSelected(currentFilters.repos);
  typeaheadTeam?.setSelected(currentFilters.teams);
  typeaheadReviewer?.setSelected(currentFilters.reviewers);
  typeaheadAuthor?.setSelected(currentFilters.authors);

  updateFilterUI();
}

function restoreStateFromUrl(): void {
  const params = new URLSearchParams(window.location.search);

  const startParam = params.get("start");
  const endParam = params.get("end");
  if (startParam && endParam) {
    currentDateRange = { start: new Date(startParam), end: new Date(endParam) };
    const dateRangeEl = elements["date-range"] as HTMLSelectElement | null;
    if (dateRangeEl) {
      dateRangeEl.value = "custom";
      elements["custom-dates"]?.classList.remove("hidden");
    }
    const startEl = elements["start-date"] as HTMLInputElement | null;
    const endEl = elements["end-date"] as HTMLInputElement | null;
    if (startEl) startEl.value = startParam;
    if (endEl) endEl.value = endParam;
  }

  const tabParam = params.get("tab");
  if (tabParam) {
    setTimeout(() => switchTab(tabParam), 0);
  }

  // Restore comparison mode
  const compareParam = params.get("compare");
  if (compareParam === "1") {
    comparisonMode = true;
    elements["compare-toggle"]?.classList.add("active");
    elements["comparison-banner"]?.classList.remove("hidden");
  }
}
// ============================================================================
// Comparison Mode
// ============================================================================

/**
 * Toggle comparison mode on/off.
 */
function toggleComparisonMode(): void {
  comparisonMode = !comparisonMode;

  elements["compare-toggle"]?.classList.toggle("active", comparisonMode);
  elements["comparison-banner"]?.classList.toggle("hidden", !comparisonMode);

  if (comparisonMode) {
    updateComparisonBanner();
  }

  updateUrlState();
  void refreshMetrics();
}

/**
 * Exit comparison mode.
 */
function exitComparisonMode(): void {
  comparisonMode = false;
  elements["compare-toggle"]?.classList.remove("active");
  elements["comparison-banner"]?.classList.add("hidden");
  updateUrlState();
  void refreshMetrics();
}

/**
 * Update the comparison banner with date ranges.
 */
function updateComparisonBanner(): void {
  if (!currentDateRange.start || !currentDateRange.end) return;

  const formatDate = (date: Date) =>
    date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

  // Current period
  const currentStart = formatDate(currentDateRange.start);
  const currentEnd = formatDate(currentDateRange.end);
  if (elements["current-period-dates"]) {
    elements["current-period-dates"].textContent =
      `${currentStart} - ${currentEnd}`;
  }

  // Previous period
  const prevPeriod = getPreviousPeriod(
    currentDateRange.start,
    currentDateRange.end,
  );
  const prevStart = formatDate(prevPeriod.start);
  const prevEnd = formatDate(prevPeriod.end);
  if (elements["previous-period-dates"]) {
    elements["previous-period-dates"].textContent = `${prevStart} - ${prevEnd}`;
  }

  const banner = elements["comparison-banner"];
  if (banner) {
    const hasFilters =
      currentFilters.repos.length > 0 ||
      currentFilters.teams.length > 0 ||
      currentFilters.reviewers.length > 0 ||
      currentFilters.authors.length > 0;
    banner.setAttribute("data-filtered", hasFilters ? "true" : "false");
  }
}

// ============================================================================
// Export Functions
// ============================================================================

/**
 * Toggle export menu visibility.
 */
function toggleExportMenu(e: Event): void {
  e.stopPropagation();
  elements["export-menu"]?.classList.toggle("hidden");
}

/**
 * Export current data to CSV.
 */
function exportToCsv(): void {
  elements["export-menu"]?.classList.add("hidden");

  if (!cachedRollups || cachedRollups.length === 0) {
    showToast("No data to export", "error");
    return;
  }

  // Use module utilities for CSV generation and download
  const csvContent = rollupsToCsv(cachedRollups);
  const filename = generateExportFilename("pr-insights", "csv");
  triggerDownload(csvContent, filename);

  showToast("CSV exported successfully", "success");
}

/**
 * Copy shareable link to clipboard.
 */
async function copyShareableLink(): Promise<void> {
  elements["export-menu"]?.classList.add("hidden");

  try {
    await navigator.clipboard.writeText(window.location.href);
    showToast("Link copied to clipboard", "success");
  } catch (_err) {
    // Fallback
    const textArea = document.createElement("textarea");
    textArea.value = window.location.href;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand("copy");
    document.body.removeChild(textArea);
    showToast("Link copied to clipboard", "success");
  }
}

/**
 * Download raw CSV data as a ZIP file.
 */
async function downloadRawDataZip(): Promise<void> {
  elements["export-menu"]?.classList.add("hidden");

  if (!currentBuildId || !artifactClient) {
    showToast("Raw data not available in direct URL mode", "error");
    return;
  }

  try {
    showToast("Preparing download...", "success");

    const artifact = await artifactClient.getArtifactMetadata(
      currentBuildId,
      "csv-output",
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

    // Use the public authenticated fetch method from ArtifactClient
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

    const dateStr = new Date().toISOString().split("T")[0];
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

// showToast is now imported from "./modules"

// ============================================================================
// Utility Functions
// ============================================================================

function showLoading(): void {
  hideAllPanels();
  elements["loading-state"]?.classList.remove("hidden");
}

function showContent(): void {
  hideAllPanels();
  elements["main-content"]?.classList.remove("hidden");
}

function updateDatasetInfo(manifest: ManifestSchema | null): void {
  const generatedAt = manifest?.generated_at
    ? new Date(manifest.generated_at).toLocaleString()
    : "Unknown";
  const runId = (manifest as { run_id?: string })?.run_id || "";
  const capabilityState = loader?.getCapabilityState?.() ?? null;
  const commentsCoverage = manifest?.coverage?.comments;
  const commentsBanner = elements["comments-coverage-banner"];
  let commentsSummary: string | null = null;

  if (capabilityState?.commentsMetricsAvailable) {
    if (capabilityState.commentsCoverageStatus === "partial") {
      commentsSummary = "Comments coverage: partial";
      if (
        typeof commentsCoverage === "object" &&
        commentsCoverage !== null &&
        commentsCoverage.capped === true
      ) {
        commentsSummary += " (capped during extraction)";
      }
    } else if (capabilityState.commentsCoverageStatus === "full") {
      commentsSummary = "Comments coverage: full";
    }
  }

  const runInfo = elements["run-info"];
  if (runInfo) {
    runInfo.textContent = `Generated: ${generatedAt}`;
    if (runId) runInfo.textContent += ` | Run: ${runId.slice(0, 8)}`;
    if (commentsSummary) runInfo.textContent += ` | ${commentsSummary}`;
  }

  if (commentsBanner) {
    if (commentsSummary) {
      commentsBanner.textContent = commentsSummary;
      commentsBanner.classList.remove("hidden");
    } else {
      commentsBanner.textContent = "";
      commentsBanner.classList.add("hidden");
    }
  }
}

// formatDuration and median are now imported from \"./modules\"
function updateUrlState(): void {
  const params = new URLSearchParams(window.location.search);
  const newParams = new URLSearchParams();

  // Preserve config params
  const datasetParam = params.get("dataset");
  if (datasetParam) newParams.set("dataset", datasetParam);
  const pipelineIdParam = params.get("pipelineId");
  if (pipelineIdParam) newParams.set("pipelineId", pipelineIdParam);

  // Add date range (toISOString format: YYYY-MM-DDTHH:mm:ss.sssZ)
  if (currentDateRange.start) {
    newParams.set(
      "start",
      currentDateRange.start.toISOString().substring(0, 10),
    );
  }
  if (currentDateRange.end) {
    newParams.set("end", currentDateRange.end.toISOString().substring(0, 10));
  }

  // Add active tab
  const activeTab = document.querySelector(".tab.active") as HTMLElement | null;
  const tabValue = activeTab?.dataset["tab"];
  if (tabValue && tabValue !== "metrics") {
    newParams.set("tab", tabValue);
  }

  // Add filters
  if (currentFilters.repos.length > 0) {
    newParams.set("repos", currentFilters.repos.join(","));
  }
  if (currentFilters.teams.length > 0) {
    newParams.set("teams", currentFilters.teams.join(","));
  }
  if (currentFilters.reviewers.length > 0) {
    newParams.set("reviewers", currentFilters.reviewers.join(","));
  }
  if (currentFilters.authors.length > 0) {
    newParams.set("author", currentFilters.authors[0] ?? "");
  }

  // Add comparison mode
  if (comparisonMode) {
    newParams.set("compare", "1");
  }

  window.history.replaceState(
    {},
    "",
    `${window.location.pathname}?${newParams.toString()}`,
  );
}

// ============================================================================
// Initialize
// ============================================================================

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => void init());
} else {
  void init();
}
