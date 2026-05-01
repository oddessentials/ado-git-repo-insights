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
  type DataAvailabilitySignal,
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
  renderCommentsTrendChart as renderCommentsTrendChartModule,
  attachCommentsTrendInfoIcon,
  detachCommentsTrendInfoIcon,
  attachChartInfoIcon,
  detachChartInfoIcon,
  renderCommentsAuthorDensityChart as renderCommentsAuthorDensityChartModule,
  renderCommentsRepositoryDensityChart as renderCommentsRepositoryDensityChartModule,
  renderCommentsReviewerDensityChart as renderCommentsReviewerDensityChartModule,
  // Data availability signal derivation
  deriveAvailabilitySignal,
  // Filter constraint resolver
  resolveFilterConstraints,
  type FilterDimension,
  // Typeahead dropdown component
  initTypeaheadDropdown,
  type TypeaheadInstance,
  // Filter URL serialization
  parseFiltersFromUrl,
  serializeFiltersToUrl,
  type FilterState,
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
  getLocalCollectionUri,
  getExtensionDataService,
  getWebContext,
  getCollectionUri,
  getAccessToken,
  // Error handling functions (dispatch handled internally)
  handleError,
  hideAllPanels,
  // Safe DOM rendering utilities
  clearElement,
  renderTrustedHtml,
  // Loading state (refresh-cycle state machine)
  startRefresh,
  endRefresh,
  failRefresh,
  isStale,
  isActive,
  getInFlightState,
  hasStateChanged,
  type EffectiveState,
  // Drill-down lifecycle signals (publishers only — dashboard is the sole emitter)
  publishFiltersChanged,
  publishTabChanged,
  publishComparisonToggled,
  // Drill-down consumers (US1 throughput, US2 cycle-time, US3 reviewer, US4 sparkline)
  installThroughputDrilldown,
  installCycleTimeDrilldown,
  installReviewerDrilldown,
  installSparklineNavigator,
} from "./modules";
import { resolveDisplayName } from "./modules/shared/identity-fallback";

// Dashboard state
let loader: IDatasetLoader | null = null;
let artifactClient: ArtifactClient | null = null;
let currentDateRange: { start: Date | null; end: Date | null } = {
  start: null,
  end: null,
};
let currentDimensions: DimensionsData | null = null;
// Feature 060: cache the collection URI at dashboard init so per-refresh
// drilldown installs (which are synchronous) can pass a PrUrlWebContext
// to throughput drill-down without re-awaiting the SDK each cycle. The
// underlying `getCollectionUri()` is already memoized inside the SDK
// wrapper — this mirror exists only because install is sync.
let currentCollectionUri: string | null = null;
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
// Tracks the previously-active tab so switchTab() can emit a TabChangedEvent
// with both the new and previous ids (per lifecycle-signals contract) and
// suppress the emit when a user clicks the already-active tab.
let previousActiveTabId: string = "metrics";
let cachedRollups: Rollup[] = []; // Cache for export
// Active per-chart drill-down handles; disposed at the start of every
// refreshMetrics cycle (immediately after publishFiltersChanged) and
// re-installed after the render block. Module-level so later user-story
// consumers (US2–US4) can push peer handles without racing US1.
let activeDrilldownHandles: Array<{ dispose(): void }> = [];
let currentBuildId: number | null = null; // Store build ID for raw data download
let chipsDelegatedElement: HTMLElement | null = null; // Track delegated element

// Loading state — cached region elements and last effective state for no-op guard
let metricsSection: HTMLElement | null = null;
let metricsStatusEl: HTMLElement | null = null;
let loadingRegions: HTMLElement[] = [];
let lastEffectiveState: EffectiveState | null = null;

// Settings keys for extension data storage (must match settings.js)
const SETTINGS_KEY_PROJECT = "pr-insights-source-project";
const SETTINGS_KEY_PIPELINE = "pr-insights-pipeline-id";

// Plain-language explanatory copy surfaced by the chart-level info-icon on
// the three comments-density panels. Defines Threads / Comments / Unresolved
// in user-facing terms; the per-reviewer copy additionally clarifies that
// reviewer thread counts can sum higher than the trend chart's thread total
// because a thread with multiple commenters contributes one to each reviewer.
// Each tooltip also discloses (#356) that comment totals include vote events
// (Approve / Reject / Reset) emitted by Azure DevOps as system messages —
// the rollup-level vote_event_count field carries the additive subset.
const COMMENTS_AUTHOR_DENSITY_TOOLTIP =
  "Each row shows one author's review-conversation totals across the selected range. " +
  "Threads = review threads on PRs the author opened; Unresolved threads = the subset still in the Active state. " +
  "Comments = every comment posted on those threads, including vote events (Approve / Reject / Reset) that Azure DevOps emits as system messages. " +
  "Hatched rows mean some weeks in this author's range are partially extracted.";

const COMMENTS_REPOSITORY_DENSITY_TOOLTIP =
  "Each row shows one repository's review-conversation totals across the selected range. " +
  "Threads = review threads on PRs in this repository; Unresolved threads = the subset still in the Active state. " +
  "Comments = every comment posted on those threads, including vote events (Approve / Reject / Reset) that Azure DevOps emits as system messages. " +
  "Hatched rows mean some weeks in this repository's range are partially extracted.";

const COMMENTS_REVIEWER_DENSITY_TOOLTIP =
  "Each row shows one reviewer's commenting activity across the selected range. " +
  "Threads = review threads this reviewer commented in. " +
  "A thread with multiple commenters contributes one to each, so the total of this column may exceed total threads on the trend chart above. " +
  "Unresolved threads = the subset still in the Active state. " +
  "Comments = every comment posted by this reviewer on those threads, including vote events (Approve / Reject / Reset) that Azure DevOps emits as system messages.";

// Cached data service — resolved once per session (matches settings.ts pattern)
let cachedDataService: Awaited<
  ReturnType<typeof getExtensionDataService>
> | null = null;

async function getDataService(): Promise<
  Awaited<ReturnType<typeof getExtensionDataService>>
> {
  if (!cachedDataService) {
    cachedDataService = await getExtensionDataService();
  }
  return cachedDataService;
}

// DOM element cache - stores single HTMLElements only
const elements = new Map<string, HTMLElement | null>();

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
    const dataService = await getDataService();

    // Get source project ID
    const savedProjectId = await dataService.getValue<string>(
      SETTINGS_KEY_PROJECT,
      { scopeType: "User", defaultValue: "" },
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
      { scopeType: "User", defaultValue: 0 },
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
    const dataService = await getDataService();
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
  const webCtx = getWebContext();
  const currentProjectId = webCtx?.project?.id;
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

  // Initialize artifact client with target project and SDK credentials.
  // Pass getAccessToken as a provider — resolved per-request for token refresh.
  const collectionUri = await getCollectionUri();
  currentCollectionUri = collectionUri;
  artifactClient = new ArtifactClient(targetProjectId);
  await artifactClient.initialize(collectionUri, getAccessToken);

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
      // Feature 309 (#315): the demo shell runs without the ADO SDK, so
      // `getCollectionUri()` is unreachable. Populate a deterministic stub
      // so the feature-060 throughput drill-down receives a defined
      // `webContext` and renders the PR list against synthetic `prs` data.
      currentCollectionUri = getLocalCollectionUri();

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
        const webCtx = getWebContext();
        const projectNameEl = document.getElementById("current-project-name");
        if (projectNameEl && webCtx?.project?.name) {
          projectNameEl.textContent = webCtx.project.name;
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
    "review-time-p50",
    "review-time-p90",
    "authors-count",
    "reviewers-count",
    "throughput-chart",
    "cycle-distribution",
    "total-prs-delta",
    "cycle-p50-delta",
    "cycle-p90-delta",
    "review-time-p50-delta",
    "review-time-p90-delta",
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
    "review-time-p50-sparkline",
    "review-time-p90-sparkline",
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
    elements.set(id, document.getElementById(id));
  });

  elementLists.tabs = document.querySelectorAll(".tab");

  // Cache loading-state region elements (queried once, reused on every refresh)
  metricsSection = document.getElementById("tab-metrics");
  metricsStatusEl = document.getElementById("metrics-status");

  const summaryCards = document.querySelector(
    ".summary-cards",
  ) as HTMLElement | null;
  const chartContainers = Array.from(
    document.querySelectorAll(".chart-container"),
  ) as HTMLElement[];
  loadingRegions = summaryCards
    ? [summaryCards, ...chartContainers]
    : chartContainers;
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
  elements.get("date-range")?.addEventListener("change", handleDateRangeChange);
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

  elements.get("retry-btn")?.addEventListener("click", () => init());
  document
    .getElementById("setup-retry-btn")
    ?.addEventListener("click", () => init());
  document
    .getElementById("permission-retry-btn")
    ?.addEventListener("click", () => init());

  // Filter event listeners now managed by typeahead component onChange callbacks
  // (wired in populateFilterDropdowns → initTypeaheadDropdown)
  elements.get("clear-filters")?.addEventListener("click", clearAllFilters);

  elements
    .get("compare-toggle")
    ?.addEventListener("click", toggleComparisonMode);
  elements.get("exit-compare")?.addEventListener("click", exitComparisonMode);

  elements.get("export-btn")?.addEventListener("click", toggleExportMenu);
  elements.get("export-csv")?.addEventListener("click", exportToCsv);
  elements.get("export-link")?.addEventListener("click", copyShareableLink);
  elements.get("export-raw-zip")?.addEventListener("click", downloadRawDataZip);

  document.addEventListener("click", (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (!target.closest(".export-dropdown")) {
      elements.get("export-menu")?.classList.add("hidden");
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

    const startDateEl = elements.get("start-date") as HTMLInputElement | null;
    const endDateEl = elements.get("end-date") as HTMLInputElement | null;
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
 * Safely serialize a Date to ISO string, returning "" for null or Invalid Date.
 * Prevents RangeError from toISOString() on dates created from invalid URL params.
 */
function safeDateString(date: Date | null): string {
  if (!date || isNaN(date.getTime())) return "";
  return date.toISOString();
}

/**
 * Build an EffectiveState snapshot for the no-op guard.
 */
function buildEffectiveState(): EffectiveState {
  return {
    filters: { ...currentFilters },
    startDate: safeDateString(currentDateRange.start),
    endDate: safeDateString(currentDateRange.end),
    comparisonMode,
  };
}

/**
 * Toggle the `inert` attribute on the four drill-down host containers so
 * stale triggers cannot be activated by click or keyboard during the
 * refresh load window. The dispose-deferred-to-render layout in
 * `refreshMetrics` (P1.A from PR #302 review) leaves listeners attached
 * to the previous cycle's chart DOM during the await chain; without
 * inert, a click or keyboard activation in that window would open a
 * panel against pre-change data. `inert` blocks both modalities and
 * removes the subtree from the accessibility tree for the load window.
 *
 * Set via `setAttribute`/`removeAttribute` rather than the
 * `HTMLElement.inert` IDL property so the call works regardless of the
 * lib.dom.d.ts version the project compiles against.
 */
function setChartContainersInert(value: boolean): void {
  const containerIds = [
    "throughput-chart",
    "cycle-time-trend",
    "reviewer-activity",
  ] as const;
  for (const id of containerIds) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (value) {
      el.setAttribute("inert", "");
    } else {
      el.removeAttribute("inert");
    }
  }
  const summaryCards = document.querySelector<HTMLElement>(".summary-cards");
  if (summaryCards) {
    if (value) {
      summaryCards.setAttribute("inert", "");
    } else {
      summaryCards.removeAttribute("inert");
    }
  }
}

/**
 * Refresh metrics for current date range.
 *
 * Loading state lifecycle:
 * 1. No-op guard — skip if effective state unchanged.
 * 2. startRefresh() — dims all chart regions, sets aria-busy.
 * 3. Async data fetch (stale check after).
 * 4. Stale check before render — older requests never paint.
 * 5. Render charts.
 * 6. endRefresh(cycleId) — clears loading, announces success.
 * 7. Commit lastEffectiveState — only on successful render.
 *
 * Invariants:
 * - No state is considered refreshed until the winning request has successfully rendered.
 * - No request may render once it loses ownership.
 * - No failed refresh may emit a success signal.
 */
async function refreshMetrics(): Promise<void> {
  if (!currentDateRange.start || !currentDateRange.end || !loader) return;

  // No-op guard: skip refresh if effective state hasn't changed (FR-002).
  // When a refresh is in-flight, compare against the in-flight target instead
  // of the last committed state. This handles A→B→A correctly (supersedes B)
  // while avoiding redundant B→B reloads.
  const candidateState = buildEffectiveState();
  if (isActive()) {
    if (!hasStateChanged(getInFlightState(), candidateState)) return;
  } else {
    if (!hasStateChanged(lastEffectiveState, candidateState)) return;
  }

  // Drill-down: announce filter-change now that we've committed to an actual
  // refresh (post no-op-guard). Subscribers that hard-dismiss on this event
  // must not do DOM work against the about-to-change state — see
  // specs/059-chart-drill-down/contracts/lifecycle-signals.md. DetailPanel's
  // own filters-changed subscriber hard-dismisses any open panel in the same
  // synchronous tick, so the panel is closed before any subsequent click can
  // re-open it against pre-change data.
  publishFiltersChanged({ reason: "user-change" });

  // NOTE: drill-down handle dispose+reset is deferred to immediately before
  // the render block (after the final stale guard) so that a stale-cycle bail
  // at lines guarded by isStale below cannot leave charts visually interactive
  // but listener-dead. See PR #302 review finding P1.A.
  //
  // Mark chart containers inert for the refresh window so the still-attached
  // listeners cannot be activated by click or keyboard against stale DOM. The
  // finally below clears inert on every exit path (success / failure /
  // stale-bail / error). See PR #302 P1.A follow-up (Codex catch).
  setChartContainersInert(true);

  // Start loading state (FR-001, FR-003).
  let cycleId = 0;
  if (metricsSection && loadingRegions.length > 0) {
    cycleId = startRefresh(metricsSection, loadingRegions, candidateState);
  }

  try {
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

    // Stale-result discard after data load: if a newer refresh superseded
    // this one, bail before any DOM writes (FR-006).
    if (cycleId > 0 && isStale(cycleId)) {
      return;
    }

    // --- Render phase: guarded by ownership check ---
    // Once we begin rendering, this request must still be the current cycle.
    // No endRefresh yet — loading stays visible until render completes.

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

    // Final ownership check before committing to DOM renders.
    // If a newer refresh started during the sync processing above, abort.
    if (cycleId > 0 && isStale(cycleId)) {
      return;
    }

    // Dispose the previous cycle's drill-down handles atomically with the
    // upcoming render: both happen, or neither does (the stale guard above
    // returned before reaching this line). This is the P1.A fix from PR #302
    // review — disposing earlier risked leaving charts visually intact but
    // listener-dead when a stale or failing cycle bailed before re-install.
    for (const handle of activeDrilldownHandles) handle.dispose();
    activeDrilldownHandles = [];

    renderSummaryCards(rollups, prevRollups, rawRollups);
    renderThroughputChart(rollups, rawRollups, availability);
    renderCycleTimeTrend(rollups, rawRollups, availability);
    renderReviewerActivity(rollups, rawRollups, availability);
    renderCycleDistribution(distributions, rawRollups, availability);

    // Feature 333: comments-trend chart (full-width row below the 2x2 grid).
    // Capability-gated on the SAME ``commentsMetricsAvailable`` field used by
    // the throughput drill-down (line 1109) and the comments-coverage banner
    // (line 2343), so on/off transitions are coherent across the surfaces.
    // ``ensureCommentsTrendContainer`` is idempotent (check-first); the
    // chart module re-renders content via the throughput-style
    // ``renderTrustedHtml`` pattern. Capability-off path calls
    // ``removeCommentsTrendContainer`` so on→off mid-session flips clean up
    // (FR-3-02); initial capability-off is a no-op (FR-3-01 + SC-1-04).
    if (loader?.getCapabilityState?.()?.commentsMetricsAvailable === true) {
      const ctsContainer = ensureCommentsTrendContainer();
      if (ctsContainer) {
        renderCommentsTrendChartModule(ctsContainer, rollups, {
          filters: currentFilters,
        });
      }
    } else {
      removeCommentsTrendContainer();
    }

    // Feature 334 (US1): per-author comments-density breakdown row, mounted
    // BELOW the 333 comments-trend chart per FR-4-01.  Same capability gate
    // as 333, same lifecycle pattern (idempotent ensure / no-op remove).
    // Anchors on the 333 row when present; falls back to cycle-distribution
    // for atypical orderings.  Per FR-4-09 the chart is informational —
    // no drill-down handle is installed below.
    if (loader?.getCapabilityState?.()?.commentsMetricsAvailable === true) {
      const cadContainer = ensureCommentsAuthorDensityContainer();
      if (cadContainer) {
        renderCommentsAuthorDensityChartModule(cadContainer, rollups, {
          filters: currentFilters,
          authorsDimension: currentDimensions?.authors,
        });
      }
    } else {
      removeCommentsAuthorDensityContainer();
    }

    // Feature 335 US1: per-repo comments-density chart row.  Same
    // capability gate as 333 / 334 (commentsMetricsAvailable from the
    // loader's getCapabilityState() chain — F3 live-loader regression
    // already guarded by extension/tests/artifact-client.test.ts T010).
    // Anchored BELOW the 334 per-author row per CL-10.  Per FR-4-09
    // the chart is informational — no drill-down handle is installed
    // below.
    if (loader?.getCapabilityState?.()?.commentsMetricsAvailable === true) {
      const crdContainer = ensureCommentsRepositoryDensityContainer();
      if (crdContainer) {
        renderCommentsRepositoryDensityChartModule(crdContainer, rollups, {
          filters: currentFilters,
          repositoriesDimension: currentDimensions?.repositories,
        });
      }
    } else {
      removeCommentsRepositoryDensityContainer();
    }

    // Feature 336 US1: per-reviewer comments-density chart row.  Same
    // capability gate as 333 / 334 / 335.  Anchored BELOW the 335
    // per-repo row per CL-11 (with author / trend / cycle-distribution
    // fallbacks inside the helper).  Per FR-4-09 the chart is
    // informational — no drill-down handle is installed below.
    // Sort-toggle activation (FR-4-05 click/Enter/Space reordering) and
    // filter-not-supported short-circuit (FR-4-07) are deferred to
    // dedicated follow-up slices; this slice ships only the static
    // chart + lifecycle-mounted row.
    if (loader?.getCapabilityState?.()?.commentsMetricsAvailable === true) {
      const crvContainer = ensureCommentsReviewerDensityContainer();
      if (crvContainer) {
        // ``currentDimensions.users`` is typed in ``types.ts`` with only
        // ``id?`` / ``name?`` fields explicitly modelled; the production
        // ``user_id`` / ``display_name`` keys are accessible through the
        // ``[key: string]: unknown`` index signature but require an
        // explicit cast to fit the chart module's
        // ``UserDirectoryEntry`` shape.  The chart module's typeof guard
        // in ``buildUsersDirectory`` filters non-string values at
        // runtime, so the cast is safe — entries lacking the production
        // fields drop out of the directory and render via the
        // raw-``user_id`` fallback per FR-4-11.
        renderCommentsReviewerDensityChartModule(crvContainer, rollups, {
          filters: currentFilters,
          usersDimension: currentDimensions?.users?.map((u) => ({
            user_id: u.user_id as string | undefined,
            display_name: u.display_name as string | undefined,
          })),
        });
      }
    } else {
      removeCommentsReviewerDensityContainer();
    }

    // Install per-chart drill-down handles AFTER the render block so the
    // container elements exist. US2–US4 push peers onto the same array.
    const throughputContainer = document.getElementById("throughput-chart");
    if (throughputContainer) {
      // Feature 060: pass a snapshot of filter state, repositories
      // dimension, and the cached collectionUri so the PR-detail section
      // can classify the filter, derive PR URLs, and render the correct
      // content state. The install is re-run on every refresh cycle, so
      // this snapshot always matches the currently rendered rollups.
      activeDrilldownHandles.push(
        installThroughputDrilldown(throughputContainer, rollups, {
          filters: {
            repos: [...currentFilters.repos],
            teams: [...currentFilters.teams],
            reviewers: [...currentFilters.reviewers],
            authors: [...currentFilters.authors],
          },
          repositoriesDimension: currentDimensions?.repositories?.map((r) => ({
            repository_id: r.repository_id,
            repository_name: r.repository_name,
            project_name: r.project_name ?? "",
            organization_name: r.organization_name,
          })),
          webContext: currentCollectionUri
            ? { collectionUri: currentCollectionUri }
            : undefined,
          authorsDimension: currentDimensions?.authors,
          // Feature 310: gate the three comments-metrics columns on the
          // single-source-of-truth ``DatasetCapabilityState``
          // (``commentsMetricsAvailable`` is normalized at
          // ``dataset-loader.ts::getCapabilityState`` — same value the
          // dashboard's comments-coverage banner reads at line 2334).
          // Default ``false`` when the loader has not produced a state
          // yet (first render / dataset-less bootstrap).
          commentsMetricsAvailable:
            loader?.getCapabilityState?.()?.commentsMetricsAvailable ?? false,
        }),
      );
    }
    // Feature 333 (T022): comments-trend chart shares the throughput drill-
    // down semantics — clicking a bar opens the existing 060/310 panel for
    // that week. Bars carry `data-drilldown-week` in the same convention
    // throughput uses, so reusing `installThroughputDrilldown` (delegated
    // listener that resolves `[data-drilldown-week]` via `target.closest`)
    // wires up click + keyboard activation without any new drill-down code.
    // The container is provisioned by `ensureCommentsTrendContainer` above;
    // when capability is off the container is absent and `getElementById`
    // returns null — defensive against the lifecycle path where the chart
    // render block ran (capability-on) but the install runs after a
    // capability flip. Options match the throughput install verbatim so
    // both surfaces feed the same panel content with identical filters /
    // dimensions / capability state.
    const commentsTrendDrillContainer =
      document.getElementById("comments-trend");
    if (commentsTrendDrillContainer) {
      activeDrilldownHandles.push(
        installThroughputDrilldown(commentsTrendDrillContainer, rollups, {
          filters: {
            repos: [...currentFilters.repos],
            teams: [...currentFilters.teams],
            reviewers: [...currentFilters.reviewers],
            authors: [...currentFilters.authors],
          },
          repositoriesDimension: currentDimensions?.repositories?.map((r) => ({
            repository_id: r.repository_id,
            repository_name: r.repository_name,
            project_name: r.project_name ?? "",
            organization_name: r.organization_name,
          })),
          webContext: currentCollectionUri
            ? { collectionUri: currentCollectionUri }
            : undefined,
          authorsDimension: currentDimensions?.authors,
          commentsMetricsAvailable:
            loader?.getCapabilityState?.()?.commentsMetricsAvailable ?? false,
        }),
      );
    }
    const cycleTimeContainer = document.getElementById("cycle-time-trend");
    if (cycleTimeContainer) {
      activeDrilldownHandles.push(
        installCycleTimeDrilldown(cycleTimeContainer, rollups),
      );
    }
    const reviewerContainer = document.getElementById("reviewer-activity");
    if (reviewerContainer) {
      activeDrilldownHandles.push(
        installReviewerDrilldown(reviewerContainer, rollups, {
          reviewersDimension: currentDimensions?.reviewers,
        }),
      );
    }
    const summaryCardsContainer =
      document.querySelector<HTMLElement>(".summary-cards");
    if (summaryCardsContainer) {
      activeDrilldownHandles.push(
        installSparklineNavigator(summaryCardsContainer),
      );
    }

    // Update comparison banner if in comparison mode
    if (comparisonMode) {
      updateComparisonBanner();
    }

    // --- Success: clear loading, announce, commit state ---
    if (cycleId > 0 && metricsSection) {
      endRefresh(cycleId, metricsSection, loadingRegions, metricsStatusEl);
    }

    // Commit effective state only after successful render.
    // Failed or superseded refreshes leave lastEffectiveState unchanged
    // so the same state remains retryable.
    lastEffectiveState = candidateState;
  } catch (err) {
    // Clear loading without success announcement (FR-012).
    // Clears any stale success text from the live region.
    // Do NOT commit lastEffectiveState — failed state must remain retryable.
    if (cycleId > 0 && metricsSection) {
      failRefresh(cycleId, metricsSection, loadingRegions, metricsStatusEl);
    }
    throw err;
  } finally {
    // Clear inert only when THIS cycle is the winning one (or no cycle
    // tracking is active). A stale-bail return must NOT clear inert: a
    // newer cycle is still mid-load with inert=true, and clearing here
    // would re-enable chart interactions on stale DOM until the winning
    // cycle finishes. The winning cycle's own success / failure path
    // (catch) clears inert on its exit. See PR #302 P1.A second
    // follow-up (Codex catch).
    if (cycleId === 0 || !isStale(cycleId)) {
      setChartContainersInert(false);
    }
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
  unfilteredRollups?: Rollup[],
): void {
  // Build container references from cached elements
  const containers: SummaryCardsContainers = {
    totalPrs: elements.get("total-prs") ?? null,
    cycleP50: elements.get("cycle-p50") ?? null,
    cycleP90: elements.get("cycle-p90") ?? null,
    reviewTimeP50: elements.get("review-time-p50") ?? null,
    reviewTimeP90: elements.get("review-time-p90") ?? null,
    authorsCount: elements.get("authors-count") ?? null,
    reviewersCount: elements.get("reviewers-count") ?? null,
    totalPrsSparkline: elements.get("total-prs-sparkline") ?? null,
    cycleP50Sparkline: elements.get("cycle-p50-sparkline") ?? null,
    cycleP90Sparkline: elements.get("cycle-p90-sparkline") ?? null,
    reviewTimeP50Sparkline: elements.get("review-time-p50-sparkline") ?? null,
    reviewTimeP90Sparkline: elements.get("review-time-p90-sparkline") ?? null,
    authorsSparkline: elements.get("authors-sparkline") ?? null,
    reviewersSparkline: elements.get("reviewers-sparkline") ?? null,
    totalPrsDelta: elements.get("total-prs-delta") ?? null,
    cycleP50Delta: elements.get("cycle-p50-delta") ?? null,
    cycleP90Delta: elements.get("cycle-p90-delta") ?? null,
    reviewTimeP50Delta: elements.get("review-time-p50-delta") ?? null,
    reviewTimeP90Delta: elements.get("review-time-p90-delta") ?? null,
    authorsDelta: elements.get("authors-delta") ?? null,
    reviewersDelta: elements.get("reviewers-delta") ?? null,
  };

  renderSummaryCardsModule({
    rollups,
    prevRollups,
    containers,
    metricsCollector,
    unfilteredRollups,
    reviewerFilterActive: currentFilters.reviewers.length > 0,
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
  availability?: DataAvailabilitySignal,
): void {
  renderThroughputChartModule(
    elements.get("throughput-chart") ?? null,
    rollups,
    {
      filters: currentFilters,
      unfilteredRollups,
      availability,
    },
  );
}

/**
 * Render cycle time distribution.
 * Thin wrapper that delegates to extracted module.
 */
function renderCycleDistribution(
  distributions: DistributionData[],
  unfilteredRollups?: Rollup[],
  availability?: DataAvailabilitySignal,
): void {
  renderCycleDistributionModule(
    elements.get("cycle-distribution") ?? null,
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
  availability?: DataAvailabilitySignal,
): void {
  renderCycleTimeTrendModule(
    elements.get("cycle-time-trend") ?? null,
    rollups,
    {
      filters: currentFilters,
      unfilteredRollups,
      availability,
    },
  );
}

/**
 * Render reviewer activity chart (horizontal bar chart).
 * Thin wrapper that delegates to extracted module.
 */
function renderReviewerActivity(
  rollups: Rollup[],
  unfilteredRollups?: Rollup[],
  availability?: DataAvailabilitySignal,
): void {
  // #308: resolve the filtered reviewer's display name upstream so the
  // chart module stays dumb. `filters.reviewers` is effectively
  // single-select end-to-end (see reviewer-activity.ts filter-semantics
  // comment); we scope to [0] to match that. Uses the shared
  // `resolveDisplayName` so fallback behavior (mapped name → raw id)
  // stays consistent with the drill-down panel surfaces.
  const filterReviewerId = currentFilters.reviewers[0];
  const reviewerNameByKey = new Map(
    (currentDimensions?.reviewers ?? []).map((r) => [
      r.reviewer_id,
      r.reviewer_name,
    ]),
  );
  const filterReviewerName =
    filterReviewerId !== undefined
      ? resolveDisplayName(filterReviewerId, reviewerNameByKey)
      : undefined;
  renderReviewerActivityModule(
    elements.get("reviewer-activity") ?? null,
    rollups,
    {
      reviewerFilterActive: currentFilters.reviewers.length > 0,
      filters: currentFilters,
      unfilteredRollups,
      availability,
      filterReviewerName,
    },
  );
}

// ============================================================================
// Feature 333 — Comments-trend chart container insertion (T020 + T021)
// ============================================================================
//
// The comments-trend chart container DOM (the `.charts-row` wrapper, its
// `.chart-container`, and the `<div id="comments-trend" class="chart">` leaf)
// is built on demand from JS via `document.createElement`. Specifically,
// `extension/ui/index.html` is NOT modified by this feature — there is no
// pre-rendered `<div id="comments-trend">`, no `<template>` element, no
// hidden CSS-gated container, and no comment-anchor marker in the static
// markup.
//
// Why pure dynamic insertion (per spec FR-3-01 + SC-1-04 + FR-3-02 and
// research.md Decision 10):
//
// - **FR-3-01** mandates that with `capabilities.comments_metrics` disabled,
//   the Metrics tab's DOM occupies the same layout positions and sizes as
//   the pre-feature baseline — i.e., the four pre-existing charts in the
//   2x2 grid and nothing else.
// - **SC-1-04** is the strict-reading verification of FR-3-01: capability-off
//   renders byte-identical to the pre-feature baseline, verified by a
//   baseline-comparison check at any moment in time (round-12 reading: not
//   just at initial mount, but also after on→off cleanup mid-session).
// - **FR-3-02** requires clean off→on / on→off transitions on dataset
//   reload — the row appears or disappears with no stale geometry.
//
// Rejected alternatives (research.md Decision 10):
//
// - *Static `<div id="comments-trend">` in `index.html`* — REJECTED: empty
//   container is in the DOM under capability-off; round-10 finding.
// - *`<template id="comments-trend-template">` in `index.html` cloned on
//   demand* — REJECTED: the `<template>` element itself sits in the DOM
//   tree (its content is a parked DocumentFragment, but the element node
//   is still present); a baseline DOM-tree diff would catch it; round-11
//   finding.
// - *Static container with CSS `hidden` class under capability-off* —
//   REJECTED: nodes still in DOM, just visually hidden; baseline DOM diff
//   still fails.
// - *Comment-anchor marker (`<!-- comments-trend-anchor -->`)* — REJECTED:
//   comment nodes are still nodes (`Node.COMMENT_NODE`); strict baseline
//   would catch the addition.
// - *Replacing one of the existing 2x2 charts* — REJECTED: violates
//   capability-off byte-identity (different layout when capability-off).
// - *New "Comments" tab* — REJECTED: loses visual proximity to throughput;
//   adds tab-navigation cost.
//
// The load-bearing verification for this design is the dashboard-lifecycle
// test introduced by T025, which asserts (a) initial capability-off
// byte-identity, (b) on→off cleanup, (c) off→on insertion, and (d) on→on
// re-render idempotency (round-13 addition — the dashboard-layer
// idempotency that round-12's `ensureCommentsTrendContainer` check-first
// design exists to provide).
//
// See `specs/333-comments-trend-chart/research.md` Decision 10 for the
// full rationale and the round-by-round resolution history.

/**
 * Idempotently ensure the comments-trend chart row exists in the DOM.
 *
 * If the `<div id="comments-trend">` leaf is already mounted (from a prior
 * render in the same session — re-render fires on dataset reload, filter
 * change, or tab switch back), returns it directly. No duplicate row is
 * inserted (round-12 dashboard-layer idempotency contract; the chart
 * module's own `renderTrustedHtml` pattern then refreshes the bars/legend
 * inside the existing container without stacking duplicate content).
 *
 * If the leaf is absent, builds the full container chain via
 * `document.createElement` (`.charts-row[data-comments-trend-row="true"]`
 * → `.chart-container` → `<div id="comments-trend" class="chart">`) and
 * appends the new row immediately after the static second `.charts-row`
 * that hosts `cycle-distribution`. The anchoring uses
 * `document.getElementById('cycle-distribution')` plus a `closest()` walk
 * to the parent `.charts-row` — `cycle-distribution` is in static markup
 * (`index.html` line 256) and is therefore present whenever the metrics
 * tab DOM has been parsed, so the anchor is reliable across capability
 * states.
 *
 * Returns `null` (caller defers) if the anchor row cannot be located —
 * defensive for any future refactor that moves cycle-distribution out of
 * the static template.
 */
function ensureCommentsTrendContainer(): HTMLElement | null {
  // Check-first: round-12 idempotency. If a prior render already mounted
  // the chart leaf, reuse it. The chart module replaces innerHTML on each
  // call, so re-rendering into the same container does not stack content.
  const existing = document.getElementById("comments-trend");
  if (existing) return existing;

  // Anchor on the static `cycle-distribution` chart's parent `.charts-row`.
  const cycleDist = document.getElementById("cycle-distribution");
  const anchorRow = cycleDist?.closest(".charts-row") ?? null;
  if (!anchorRow || !anchorRow.parentElement) return null;

  const row = document.createElement("div");
  row.className = "charts-row";
  row.setAttribute("data-comments-trend-row", "true");

  const containerCell = document.createElement("div");
  containerCell.className = "chart-container";

  const heading = document.createElement("h3");
  heading.textContent = "Comments Trend";
  attachCommentsTrendInfoIcon(heading);
  containerCell.appendChild(heading);

  const chart = document.createElement("div");
  chart.id = "comments-trend";
  chart.className = "chart";

  containerCell.appendChild(chart);
  row.appendChild(containerCell);

  // Insert immediately after the cycle-distribution row so the new
  // full-width chart sits below the existing 2x2 grid (research.md
  // Decision 10 — top-to-bottom story is throughput → cycle → comments).
  anchorRow.parentElement.insertBefore(row, anchorRow.nextSibling);

  return chart;
}

/**
 * Remove the comments-trend chart row from the DOM if present.
 *
 * No-op when the row is absent — covers (a) initial capability-off (the
 * row was never inserted; preserves FR-3-01 + SC-1-04 byte-identity) and
 * (b) repeated capability-off renders. Active cleanup happens on the
 * on→off mid-session transition (FR-3-02) when a prior capability-on
 * render had inserted the row.
 */
function removeCommentsTrendContainer(): void {
  const row = document.querySelector('[data-comments-trend-row="true"]');
  if (!row) return;
  const heading = row.querySelector("h3");
  if (heading instanceof HTMLElement) {
    detachCommentsTrendInfoIcon(heading);
  }
  row.parentElement?.removeChild(row);
}

/**
 * Idempotently ensure the comments-density sub-grid wrapper exists
 * (Issue #357).  All three density panels (per-author 334, per-repo
 * 335, per-reviewer 336) mount as ``.chart-container`` children of
 * this single wrapper instead of as four sequential ``.charts-row``
 * siblings — recovering vertical scan-density without removing any
 * panel, capability gate, or data-attribute selector that downstream
 * tests + parity gates depend on.
 *
 * Anchor preference: the comments-trend row (333) when mounted, falling
 * back to the static ``cycle-distribution`` chart row.  The wrapper
 * sits IMMEDIATELY AFTER the chosen anchor so the trend chart stays
 * full-width above the density grid (issue #357 acceptance: "trend
 * full-width on its own row, density panels in a 2-up sub-grid below").
 *
 * Returns ``null`` when no anchor is locatable (defensive — same
 * fallback semantics as the prior per-helper anchor chains).
 */
function ensureCommentsDensityGrid(): HTMLElement | null {
  const existing = document.querySelector<HTMLElement>(
    '[data-comments-density-grid="true"]',
  );
  if (existing) return existing;

  const trendRow = document.querySelector('[data-comments-trend-row="true"]');
  let anchorRow: Element | null = trendRow;
  if (!anchorRow) {
    const cycleDist = document.getElementById("cycle-distribution");
    anchorRow = cycleDist?.closest(".charts-row") ?? null;
  }
  if (!anchorRow || !anchorRow.parentElement) return null;

  const grid = document.createElement("div");
  // Carries ``charts-row`` so it inherits the existing gap + grid
  // baseline from styles.css; ``comments-density-grid`` overrides
  // ``grid-template-columns`` to a fixed 2-up (with single-column
  // fallback at narrow viewports).
  grid.className = "charts-row comments-density-grid";
  grid.setAttribute("data-comments-density-grid", "true");

  anchorRow.parentElement.insertBefore(grid, anchorRow.nextSibling);

  return grid;
}

/**
 * Remove the comments-density sub-grid wrapper if it has no remaining
 * density-panel children.  Called by each density panel's remove
 * helper after the panel itself is detached so the wrapper does not
 * linger as an empty ``.charts-row`` (which would inflate row counts
 * and leave a visible gap above subsequent sections).  No-op when the
 * wrapper is absent or still hosts at least one child.
 */
function removeCommentsDensityGridIfEmpty(): void {
  const grid = document.querySelector('[data-comments-density-grid="true"]');
  if (!grid) return;
  if (grid.children.length === 0) {
    grid.parentElement?.removeChild(grid);
  }
}

/**
 * Idempotently ensure the per-author comments-density chart container
 * exists (Feature 334 US1; reshaped for issue #357).  The container
 * is appended as a ``.chart-container`` child of the shared
 * ``[data-comments-density-grid="true"]`` wrapper rather than as a
 * standalone ``.charts-row`` sibling.  The
 * ``data-comments-author-density-row="true"`` selector still
 * resolves to the same logical element (now a ``.chart-container``)
 * so downstream lifecycle tests and dashboard parity gates continue
 * to find the panel by attribute.  Returns ``null`` when the wrapper
 * cannot be created (no anchor locatable).
 */
function ensureCommentsAuthorDensityContainer(): HTMLElement | null {
  const existing = document.getElementById("comments-author-density");
  if (existing) return existing;

  const grid = ensureCommentsDensityGrid();
  if (!grid) return null;

  const containerCell = document.createElement("div");
  containerCell.className = "chart-container";
  containerCell.setAttribute("data-comments-author-density-row", "true");

  const heading = document.createElement("h3");
  heading.textContent = "Comments by Author";
  attachChartInfoIcon(
    heading,
    COMMENTS_AUTHOR_DENSITY_TOOLTIP,
    "comments-author-density",
  );
  containerCell.appendChild(heading);

  const chart = document.createElement("div");
  chart.id = "comments-author-density";
  chart.className = "chart";

  containerCell.appendChild(chart);
  grid.appendChild(containerCell);

  return chart;
}

/**
 * Remove the per-author comments-density chart container from the DOM
 * if present.  No-op when absent (initial capability-off; repeated
 * capability-off renders).  Active cleanup happens on the on→off
 * mid-session transition (FR-3-02).  When the removal leaves the
 * shared density-grid wrapper empty, the wrapper is also removed
 * (issue #357: keeps capability-off byte-identity at the wrapper
 * scope).
 */
function removeCommentsAuthorDensityContainer(): void {
  const row = document.querySelector(
    '[data-comments-author-density-row="true"]',
  );
  if (!row) return;
  const heading = row.querySelector("h3");
  if (heading instanceof HTMLElement) {
    detachChartInfoIcon(heading);
  }
  row.parentElement?.removeChild(row);
  removeCommentsDensityGridIfEmpty();
}

/**
 * Idempotently ensure the per-repo comments-density chart container
 * exists (Feature 335 US1; reshaped for issue #357).  Like the
 * per-author helper, this is now a ``.chart-container`` child of the
 * shared ``[data-comments-density-grid="true"]`` wrapper.  The
 * ``data-comments-repository-density-row="true"`` selector still
 * resolves to the same logical element so lifecycle tests and parity
 * gates continue to find the panel by attribute.  Returns ``null``
 * when the wrapper cannot be created.
 */
function ensureCommentsRepositoryDensityContainer(): HTMLElement | null {
  const existing = document.getElementById("comments-repository-density");
  if (existing) return existing;

  const grid = ensureCommentsDensityGrid();
  if (!grid) return null;

  const containerCell = document.createElement("div");
  containerCell.className = "chart-container";
  containerCell.setAttribute("data-comments-repository-density-row", "true");

  const heading = document.createElement("h3");
  heading.textContent = "Comments by Repository";
  attachChartInfoIcon(
    heading,
    COMMENTS_REPOSITORY_DENSITY_TOOLTIP,
    "comments-repository-density",
  );
  containerCell.appendChild(heading);

  const chart = document.createElement("div");
  chart.id = "comments-repository-density";
  chart.className = "chart";

  containerCell.appendChild(chart);
  grid.appendChild(containerCell);

  return chart;
}

/**
 * Remove the per-repo comments-density chart container from the DOM
 * if present.  No-op when absent.  When the removal leaves the shared
 * density-grid wrapper empty, the wrapper is also removed (issue
 * #357).
 */
function removeCommentsRepositoryDensityContainer(): void {
  const row = document.querySelector(
    '[data-comments-repository-density-row="true"]',
  );
  if (!row) return;
  const heading = row.querySelector("h3");
  if (heading instanceof HTMLElement) {
    detachChartInfoIcon(heading);
  }
  row.parentElement?.removeChild(row);
  removeCommentsDensityGridIfEmpty();
}

/**
 * Idempotently ensure the per-reviewer comments-density chart
 * container exists (Feature 336 US1; reshaped for issue #357).  Like
 * the per-author and per-repo helpers, this is now a
 * ``.chart-container`` child of the shared
 * ``[data-comments-density-grid="true"]`` wrapper.  The
 * ``data-comments-reviewer-density-row="true"`` selector still
 * resolves to the same logical element.  Returns ``null`` when the
 * wrapper cannot be created.
 */
function ensureCommentsReviewerDensityContainer(): HTMLElement | null {
  const existing = document.getElementById("comments-reviewer-density");
  if (existing) return existing;

  const grid = ensureCommentsDensityGrid();
  if (!grid) return null;

  const containerCell = document.createElement("div");
  containerCell.className = "chart-container";
  containerCell.setAttribute("data-comments-reviewer-density-row", "true");

  const heading = document.createElement("h3");
  heading.textContent = "Comments by Reviewer";
  attachChartInfoIcon(
    heading,
    COMMENTS_REVIEWER_DENSITY_TOOLTIP,
    "comments-reviewer-density",
  );
  containerCell.appendChild(heading);

  const chart = document.createElement("div");
  chart.id = "comments-reviewer-density";
  chart.className = "chart";

  containerCell.appendChild(chart);
  grid.appendChild(containerCell);

  return chart;
}

/**
 * Remove the per-reviewer comments-density chart container from the
 * DOM if present.  No-op when absent.  When the removal leaves the
 * shared density-grid wrapper empty, the wrapper is also removed
 * (issue #357).
 */
function removeCommentsReviewerDensityContainer(): void {
  const row = document.querySelector(
    '[data-comments-reviewer-density-row="true"]',
  );
  if (!row) return;
  const heading = row.querySelector("h3");
  if (heading instanceof HTMLElement) {
    detachChartInfoIcon(heading);
  }
  row.parentElement?.removeChild(row);
  removeCommentsDensityGridIfEmpty();
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
    elements.get("custom-dates")?.classList.remove("hidden");
    return;
  }

  elements.get("custom-dates")?.classList.add("hidden");

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
  const start = (elements.get("start-date") as HTMLInputElement)?.value;
  const end = (elements.get("end-date") as HTMLInputElement)?.value;

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

  // Drill-down: emit TabChangedEvent only when the active tab actually
  // changed. Clicking the already-active tab is a no-op for subscribers.
  if (tabId !== previousActiveTabId) {
    publishTabChanged({
      activeTabId: tabId,
      previousTabId: previousActiveTabId,
    });
    previousActiveTabId = tabId;
  }

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
      onChange: () => handleTypeaheadFilterChange("repos"),
    });
    elements.get("repo-filter-group")?.classList.remove("hidden");
  } else {
    typeaheadRepo = null;
    elements.get("repo-filter-group")?.classList.add("hidden");
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
      onChange: () => handleTypeaheadFilterChange("teams"),
    });
    elements.get("team-filter-group")?.classList.remove("hidden");
  } else {
    typeaheadTeam = null;
    elements.get("team-filter-group")?.classList.add("hidden");
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
      onChange: () => handleTypeaheadFilterChange("reviewers"),
    });
    elements.get("reviewer-filter-group")?.classList.remove("hidden");
  } else {
    typeaheadReviewer = null;
    elements.get("reviewer-filter-group")?.classList.add("hidden");
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
      onChange: () => handleTypeaheadFilterChange("authors"),
    });
    elements.get("author-filter-group")?.classList.remove("hidden");
  } else {
    typeaheadAuthor = null;
    elements.get("author-filter-group")?.classList.add("hidden");
  }

  // Restore filter state from URL
  restoreFiltersFromUrl();
}

// Legacy constraint and normalization functions removed.
// All constraint logic is now in filter-constraint-resolver.ts (FR-010).
// Single-select enforcement handled by the resolver.
// Author name→ID normalization handled in restoreFiltersFromUrl().

/**
 * Single authority for filter state updates. ALL filter mutations
 * route through this function. No caller may modify currentFilters
 * directly.
 *
 * Sequence: resolve constraints → derive notices → update state →
 * sync typeahead UI → update filter UI → serialize URL → refresh metrics.
 *
 * @param raw - Raw filter state (pre-constraint-resolution)
 * @param lastChanged - Which dimension the user last interacted with.
 *   Passed to the resolver for Author ↔ Reviewer "last interaction wins."
 */
function applyFilterState(
  raw: FilterState,
  lastChanged?: FilterDimension,
): void {
  // 1. Resolve constraints (single authority, FR-010)
  const { effectiveState, constraintsApplied } = resolveFilterConstraints(
    raw,
    lastChanged,
  );

  // 2. Derive notice state (always derived from resolver output, never stored)
  const reviewerNotice = constraintsApplied.find(
    (n) =>
      n.type === "author_reviewer" ||
      n.type === "reviewer_team" ||
      n.type === "reviewer_repo",
  );
  reviewerFilterNoticeMessage = reviewerNotice?.message ?? null;

  // 3. Update canonical state
  currentFilters = effectiveState;

  // 4. Sync all typeahead UIs with resolved state
  typeaheadRepo?.setSelected(effectiveState.repos);
  typeaheadTeam?.setSelected(effectiveState.teams);
  typeaheadReviewer?.setSelected(effectiveState.reviewers);
  typeaheadAuthor?.setSelected(effectiveState.authors);

  // 5. Update filter UI (chips, labels, notices)
  updateFilterUI();

  // 6. Serialize canonical URL
  updateUrlState();

  // 7. Refresh metrics
  void refreshMetrics();
}

/**
 * Handle filter change from typeahead components.
 * Reads raw state from typeaheads and delegates to applyFilterState.
 */
function handleTypeaheadFilterChange(lastChanged?: FilterDimension): void {
  applyFilterState(
    {
      repos: typeaheadRepo?.getSelected() ?? [],
      teams: typeaheadTeam?.getSelected() ?? [],
      reviewers: typeaheadReviewer?.getSelected() ?? [],
      authors: typeaheadAuthor?.getSelected() ?? [],
    },
    lastChanged,
  );
}

/**
 * Clear all filters. Delegates to applyFilterState with empty state.
 */
function clearAllFilters(): void {
  applyFilterState({ repos: [], teams: [], reviewers: [], authors: [] });
}

/**
 * Remove a specific filter. Computes next state and delegates to applyFilterState.
 */
function removeFilter(type: string, value: string): void {
  const next: FilterState = {
    repos: [...currentFilters.repos],
    teams: [...currentFilters.teams],
    reviewers: [...currentFilters.reviewers],
    authors: [...currentFilters.authors],
  };
  if (type === "repo") {
    next.repos = next.repos.filter((v) => v !== value);
  } else if (type === "team") {
    next.teams = next.teams.filter((v) => v !== value);
  } else if (type === "reviewer") {
    next.reviewers = next.reviewers.filter((v) => v !== value);
  } else if (type === "author") {
    next.authors = next.authors.filter((v) => v !== value);
  }
  applyFilterState(next);
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

  const clearFiltersEl = elements.get("clear-filters");
  if (clearFiltersEl) {
    clearFiltersEl.classList.toggle("hidden", !hasFilters);
  }

  const activeFiltersEl = elements.get("active-filters");
  const filterChipsEl = elements.get("filter-chips");
  if (activeFiltersEl && filterChipsEl) {
    activeFiltersEl.classList.toggle("hidden", !hasFilters);

    if (hasFilters) {
      renderFilterChips();
    } else {
      clearElement(filterChipsEl as HTMLElement | null);
    }
  }

  updateMetricLabels();
}

/**
 * Render filter chips for active filters.
 */
function renderFilterChips(): void {
  const chipsEl = elements.get("filter-chips") as HTMLElement | null;
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
      currentDimensions?.repositories?.find((r) => r.repository_name === value)
        ?.repository_name ?? value
    );
  }
  if (type === "team") {
    return (
      currentDimensions?.teams?.find((t) => t.team_name === value)?.team_name ??
      value
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
  elements
    .get("author-filter-notice")
    ?.classList.toggle("hidden", !authorTeamConstrained);
  const reviewerNotice = elements.get("reviewer-filter-notice");
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

  const totalPrsLabel = elements.get("total-prs-label");
  if (totalPrsLabel) {
    totalPrsLabel.textContent = reviewerMode ? "Reviewed PRs" : "Total PRs";
  }
  const authorsLabel = elements.get("authors-count-label");
  if (authorsLabel) {
    authorsLabel.textContent = reviewerMode
      ? "Reviewed Authors"
      : "Contributors";
  }
  const reviewersLabel = elements.get("reviewers-count-label");
  if (reviewersLabel) {
    reviewersLabel.textContent = reviewerMode ? "Reviews" : "Reviewers";
  }
  const activityLabel = elements.get("reviewer-activity-label");
  if (activityLabel) {
    activityLabel.textContent = reviewerMode
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

  // Delegate to centralized applyFilterState (no lastChanged for URL restore).
  // applyFilterState handles: resolve → derive notices → update state →
  // sync typeaheads → update UI → serialize URL → refresh metrics.
  // Note: refreshMetrics() will be called by applyFilterState, but for URL
  // restore this is correct — the initial load triggers a full refresh anyway.
  applyFilterState({
    repos: validRepos,
    teams: validTeams,
    reviewers: validReviewers,
    authors: normalizedAuthors,
  });
}

function restoreStateFromUrl(): void {
  const params = new URLSearchParams(window.location.search);

  const startParam = params.get("start");
  const endParam = params.get("end");
  if (startParam && endParam) {
    const parsedStart = new Date(startParam);
    const parsedEnd = new Date(endParam);
    // Reject invalid dates — fall through to default date range from manifest.
    if (isNaN(parsedStart.getTime()) || isNaN(parsedEnd.getTime())) {
      console.debug(
        "Invalid date params in URL, ignoring:",
        startParam,
        endParam,
      );
    } else {
      currentDateRange = { start: parsedStart, end: parsedEnd };
      const dateRangeEl = elements.get(
        "date-range",
      ) as HTMLSelectElement | null;
      if (dateRangeEl) {
        dateRangeEl.value = "custom";
        elements.get("custom-dates")?.classList.remove("hidden");
      }
      const startEl = elements.get("start-date") as HTMLInputElement | null;
      const endEl = elements.get("end-date") as HTMLInputElement | null;
      if (startEl) startEl.value = startParam;
      if (endEl) endEl.value = endParam;
    }
  }

  const tabParam = params.get("tab");
  if (tabParam) {
    setTimeout(() => switchTab(tabParam), 0);
  }

  // Restore comparison mode
  const compareParam = params.get("compare");
  if (compareParam === "1") {
    comparisonMode = true;
    elements.get("compare-toggle")?.classList.add("active");
    elements.get("comparison-banner")?.classList.remove("hidden");
    // Drill-down guard sync (spec 059 / FR-060): toggleComparisonMode and
    // exitComparisonMode emit this event, but the deep-link restore path
    // bypasses them. Without this emit the comparison-advisory banner
    // never mounts, chart containers never gain the disabled attribute,
    // and both detail-panel's internal `comparisonActive` tracker AND
    // isDrilldownDisabledByComparison() stay `false` — so a user who
    // loads the dashboard via ?compare=1 could still open a drill-down
    // panel. Emit here to keep the guard synchronized on init.
    publishComparisonToggled({ enabled: true });
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

  elements.get("compare-toggle")?.classList.toggle("active", comparisonMode);
  elements
    .get("comparison-banner")
    ?.classList.toggle("hidden", !comparisonMode);

  if (comparisonMode) {
    updateComparisonBanner();
  }

  // Drill-down: emit comparison-toggled BEFORE refreshMetrics so subscribers
  // (DetailPanel, comparison-advisory) see the more-specific event first;
  // refreshMetrics' own publishFiltersChanged fires a moment later but is a
  // no-op for already-closed panels.
  publishComparisonToggled({ enabled: comparisonMode });

  updateUrlState();
  void refreshMetrics();
}

/**
 * Exit comparison mode.
 */
function exitComparisonMode(): void {
  comparisonMode = false;
  elements.get("compare-toggle")?.classList.remove("active");
  elements.get("comparison-banner")?.classList.add("hidden");
  publishComparisonToggled({ enabled: false });
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
  const currentDatesEl = elements.get("current-period-dates");
  if (currentDatesEl) {
    currentDatesEl.textContent = `${currentStart} - ${currentEnd}`;
  }

  // Previous period
  const prevPeriod = getPreviousPeriod(
    currentDateRange.start,
    currentDateRange.end,
  );
  const prevStart = formatDate(prevPeriod.start);
  const prevEnd = formatDate(prevPeriod.end);
  const prevDatesEl = elements.get("previous-period-dates");
  if (prevDatesEl) {
    prevDatesEl.textContent = `${prevStart} - ${prevEnd}`;
  }

  const banner = elements.get("comparison-banner");
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
  elements.get("export-menu")?.classList.toggle("hidden");
}

/**
 * Export current data to CSV.
 */
function exportToCsv(): void {
  elements.get("export-menu")?.classList.add("hidden");

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
  elements.get("export-menu")?.classList.add("hidden");

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
  elements.get("export-menu")?.classList.add("hidden");

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
  elements.get("loading-state")?.classList.remove("hidden");
}

function showContent(): void {
  hideAllPanels();
  elements.get("main-content")?.classList.remove("hidden");
}

function updateDatasetInfo(manifest: ManifestSchema | null): void {
  const generatedAt = manifest?.generated_at
    ? new Date(manifest.generated_at).toLocaleString()
    : "Unknown";
  const runId = (manifest as { run_id?: string })?.run_id || "";
  const capabilityState = loader?.getCapabilityState?.() ?? null;
  const commentsCoverage = manifest?.coverage?.comments;
  const commentsBanner = elements.get("comments-coverage-banner");
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

  const runInfo = elements.get("run-info");
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

  // FR-009: All filter URL writes go through the canonical serializer.
  // No inline .set("repos")/.set("teams") allowed outside this call.
  // The serializer sorts multi-select values lexicographically and
  // deletes params when empty, ensuring stable canonical URLs.
  serializeFiltersToUrl(currentFilters, newParams);

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
