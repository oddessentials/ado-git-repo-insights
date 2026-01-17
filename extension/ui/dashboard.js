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

// Dashboard state
let loader = null;
let artifactClient = null;
let currentDateRange = { start: null, end: null };
let currentFilters = { repos: [], teams: [] };
let sdkInitialized = false;

// Settings keys for extension data storage (must match settings.js)
const SETTINGS_KEY_PROJECT = 'pr-insights-source-project';
const SETTINGS_KEY_PIPELINE = 'pr-insights-pipeline-id';

// DOM element cache
const elements = {};

/**
 * Phase 4: Production-safe metrics collector
 */
const IS_PRODUCTION = typeof process !== 'undefined' && process.env.NODE_ENV === 'production';
const DEBUG_ENABLED = !IS_PRODUCTION && (
    (typeof window !== 'undefined' && window.__DASHBOARD_DEBUG__) ||
    (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug'))
);

const metricsCollector = DEBUG_ENABLED ? {
    marks: new Map(),
    measures: [],
    mark(name) {
        if (!performance || !performance.mark) return;
        try {
            performance.mark(name);
            this.marks.set(name, performance.now());
        } catch (e) { /* ignore */ }
    },
    measure(name, startMark, endMark) {
        if (!performance || !performance.measure) return;
        try {
            performance.measure(name, startMark, endMark);
            const entries = performance.getEntriesByName(name, 'measure');
            if (entries.length > 0) {
                this.measures.push({
                    name,
                    duration: entries[entries.length - 1].duration,
                    timestamp: Date.now()
                });
            }
        } catch (e) { /* ignore */ }
    },
    getMetrics() {
        return {
            marks: Array.from(this.marks.entries()).map(([name, time]) => ({ name, time })),
            measures: [...this.measures]
        };
    },
    reset() {
        this.marks.clear();
        this.measures = [];
        if (performance && performance.clearMarks) performance.clearMarks();
        if (performance && performance.clearMeasures) performance.clearMeasures();
    }
} : null;

if (DEBUG_ENABLED && typeof window !== 'undefined') {
    window.__dashboardMetrics = metricsCollector;
}

// ============================================================================
// SDK Initialization
// ============================================================================

/**
 * Initialize Azure DevOps Extension SDK.
 * @returns {Promise<void>}
 */
async function initializeAdoSdk() {
    if (sdkInitialized) return;

    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error('Azure DevOps SDK initialization timed out'));
        }, 10000);

        VSS.init({
            explicitNotifyLoaded: true,
            usePlatformScripts: true,
            usePlatformStyles: true
        });

        VSS.ready(() => {
            clearTimeout(timeout);
            sdkInitialized = true;

            // Update project name in UI
            const webContext = VSS.getWebContext();
            const projectNameEl = document.getElementById('current-project-name');
            if (projectNameEl && webContext?.project?.name) {
                projectNameEl.textContent = webContext.project.name;
            }

            VSS.notifyLoadSucceeded();
            resolve();
        });
    });
}

// ============================================================================
// Configuration Resolution
// ============================================================================

/**
 * Parse and validate query parameters.
 *
 * @returns {{ mode: string, value: any, warning?: string } | PrInsightsError}
 */
function parseQueryParams() {
    const params = new URLSearchParams(window.location.search);

    const datasetUrl = params.get('dataset');
    const pipelineIdStr = params.get('pipelineId');

    // Check for dataset URL (highest priority)
    if (datasetUrl) {
        // Validate URL
        if (!datasetUrl.startsWith('https://')) {
            return createInvalidConfigError('dataset', datasetUrl, 'Must be a valid HTTPS URL');
        }

        // Security warning for non-ADO domains
        const IS_DEV = window.location.hostname === 'localhost' ||
            params.has('devMode');

        if (!IS_DEV) {
            try {
                const urlHost = new URL(datasetUrl).hostname;
                const isAdoDomain = urlHost.endsWith('dev.azure.com') ||
                    urlHost.endsWith('.visualstudio.com') ||
                    urlHost.endsWith('.azure.com');
                if (!isAdoDomain) {
                    console.warn(
                        `SECURITY: ?dataset= URL "${urlHost}" is not an Azure DevOps domain. ` +
                        `This parameter is intended for development only.`
                    );
                }
            } catch (e) {
                return createInvalidConfigError('dataset', datasetUrl, 'Invalid URL format');
            }
        }

        let warning = null;
        if (pipelineIdStr) {
            warning = 'Both dataset and pipelineId specified; using dataset';
            console.warn(warning);
        }

        return { mode: 'direct', value: datasetUrl, warning };
    }

    // Check for pipelineId
    if (pipelineIdStr) {
        const pipelineId = parseInt(pipelineIdStr, 10);
        if (isNaN(pipelineId) || pipelineId <= 0) {
            return createInvalidConfigError('pipelineId', pipelineIdStr, 'Must be a positive integer');
        }
        return { mode: 'explicit', value: pipelineId };
    }

    return { mode: 'discover', value: null };
}

/**
 * Get source configuration from extension settings.
 *
 * @returns {Promise<{ projectId: string|null, pipelineId: number|null }>}
 */
async function getSourceConfig() {
    const result = { projectId: null, pipelineId: null };
    try {
        const dataService = await VSS.getService(VSS.ServiceIds.ExtensionData);

        // Get source project ID
        const savedProjectId = await dataService.getValue(SETTINGS_KEY_PROJECT, { scopeType: 'User' });
        if (savedProjectId && typeof savedProjectId === 'string' && savedProjectId.trim()) {
            result.projectId = savedProjectId.trim();
        }

        // Get pipeline definition ID
        const savedPipelineId = await dataService.getValue(SETTINGS_KEY_PIPELINE, { scopeType: 'User' });
        if (savedPipelineId && typeof savedPipelineId === 'number' && savedPipelineId > 0) {
            result.pipelineId = savedPipelineId;
        }
    } catch (e) {
        console.log('Could not read extension settings:', e);
    }
    return result;
}

/**
 * Resolve configuration using precedence rules.
 *
 * Order: dataset > pipelineId(query) > settings > discovery
 *
 * @returns {Promise<{ buildId: number, artifactName: string } | { directUrl: string }>}
 */
async function resolveConfiguration() {
    const queryResult = parseQueryParams();

    // Check for parsing error
    if (queryResult instanceof PrInsightsError) {
        throw queryResult;
    }

    // Mode: direct URL
    if (queryResult.mode === 'direct') {
        return { directUrl: queryResult.value };
    }

    // Get current project context
    const webContext = VSS.getWebContext();
    const currentProjectId = webContext.project.id;

    // Get configured source from settings
    const sourceConfig = await getSourceConfig();

    // Determine which project to use for artifact access
    // Priority: settings > current context
    const targetProjectId = sourceConfig.projectId || currentProjectId;

    console.log(`Source project: ${targetProjectId}${sourceConfig.projectId ? ' (from settings)' : ' (current context)'}`);

    // Initialize artifact client with target project
    artifactClient = new ArtifactClient(targetProjectId);
    await artifactClient.initialize();

    // Mode: explicit pipelineId from query
    if (queryResult.mode === 'explicit') {
        return await resolveFromPipelineId(queryResult.value, targetProjectId);
    }

    // Check settings for pipeline ID
    if (sourceConfig.pipelineId) {
        console.log(`Using pipeline definition ID from settings: ${sourceConfig.pipelineId}`);
        return await resolveFromPipelineId(sourceConfig.pipelineId, targetProjectId);
    }

    // Mode: discovery in target project
    return await discoverAndResolve(targetProjectId);
}

/**
 * Resolve artifact info from a specific pipeline ID.
 *
 * @param {number} pipelineId
 * @param {string} projectId
 * @returns {Promise<{ buildId: number, artifactName: string }>}
 */
async function resolveFromPipelineId(pipelineId, projectId) {
    // Get Build REST client
    const buildClient = await getBuildClient();

    // Get latest successful build
    const builds = await buildClient.getBuilds(
        projectId,
        [pipelineId],
        null, null, null, null, null,
        null,  // reasonFilter
        2,     // statusFilter: Completed
        2,     // resultFilter: Succeeded
        null, null,
        1      // top
    );

    if (!builds || builds.length === 0) {
        // Get pipeline name for better error message
        // queryOrder (5th param): 2 = definitionNameAscending (required by Azure DevOps API)
        const definitions = await buildClient.getDefinitions(projectId, null, null, null, 2, null, null, null, [pipelineId]);
        const name = definitions?.[0]?.name || `ID ${pipelineId}`;
        throw createNoSuccessfulBuildsError(name);
    }

    const latestBuild = builds[0];

    // Check for aggregates artifact
    const artifacts = await artifactClient.getArtifacts(latestBuild.id);
    const hasAggregates = artifacts.some(a => a.name === 'aggregates');

    if (!hasAggregates) {
        // queryOrder (5th param): 2 = definitionNameAscending (required by Azure DevOps API)
        const definitions = await buildClient.getDefinitions(projectId, null, null, null, 2, null, null, null, [pipelineId]);
        const name = definitions?.[0]?.name || `ID ${pipelineId}`;
        throw createArtifactsMissingError(name, latestBuild.id);
    }

    // Note: Manifest existence is verified at load time via SDK, not via preflight check
    // (preflight HEAD requests fail with 401 on direct file URLs)

    return { buildId: latestBuild.id, artifactName: 'aggregates' };
}

/**
 * Discover pipelines with aggregates and resolve.
 *
 * @param {string} projectId
 * @returns {Promise<{ buildId: number, artifactName: string }>}
 */
async function discoverAndResolve(projectId) {
    const matches = await discoverInsightsPipelines(projectId);

    if (matches.length === 0) {
        throw createSetupRequiredError();
    }

    if (matches.length > 1) {
        throw createMultiplePipelinesError(matches);
    }

    return { buildId: matches[0].buildId, artifactName: 'aggregates' };
}

/**
 * Discover pipelines with aggregates artifact containing dataset-manifest.json.
 *
 * @param {string} projectId
 * @returns {Promise<Array<{id: number, name: string, buildId: number}>>}
 */
async function discoverInsightsPipelines(projectId) {
    const buildClient = await getBuildClient();
    const matches = [];

    // Get pipeline definitions (limit for performance)
    // queryOrder (5th param): 2 = definitionNameAscending (required for pagination)
    // top (6th param): 50 = max definitions to fetch
    const definitions = await buildClient.getDefinitions(projectId, null, null, null, 2, 50);

    for (const def of definitions) {
        // Get latest successful build
        const builds = await buildClient.getBuilds(
            projectId,
            [def.id],
            null, null, null, null, null,
            null, 2, 2, null, null, 1
        );

        if (!builds || builds.length === 0) continue;

        const latestBuild = builds[0];

        // Check for aggregates artifact
        try {
            const artifacts = await artifactClient.getArtifacts(latestBuild.id);
            if (!artifacts.some(a => a.name === 'aggregates')) continue;

            // Aggregates artifact exists - add to matches
            // (manifest existence is verified at load time via SDK)
            matches.push({
                id: def.id,
                name: def.name,
                buildId: latestBuild.id
            });
        } catch (e) {
            // Skip pipelines we can't access
            console.debug(`Skipping pipeline ${def.name}:`, e);
        }
    }

    return matches;
}

/**
 * Get Build REST client from SDK.
 */
async function getBuildClient() {
    return new Promise((resolve) => {
        VSS.require(['TFS/Build/RestClient'], (BuildRestClient) => {
            resolve(BuildRestClient.getClient());
        });
    });
}

// ============================================================================
// Main Initialization
// ============================================================================

/**
 * Initialize the dashboard.
 */
async function init() {
    if (metricsCollector) metricsCollector.mark('dashboard-init');

    cacheElements();
    setupEventListeners();

    try {
        // Initialize ADO SDK
        await initializeAdoSdk();

        // Resolve configuration (may throw typed errors)
        const config = await resolveConfiguration();

        // Create loader based on config type
        if (config.directUrl) {
            // Direct URL mode (for testing)
            loader = new DatasetLoader(config.directUrl);
        } else {
            // Artifact mode
            loader = artifactClient.createDatasetLoader(config.buildId, config.artifactName);
        }

        // Load and display dataset
        await loadDataset();

    } catch (error) {
        console.error('Dashboard initialization failed:', error);
        handleError(error);
    }
}

/**
 * Handle errors with appropriate UI panels.
 */
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
            case ErrorTypes.PERMISSION_DENIED:
                showPermissionDenied(error);
                break;
            case ErrorTypes.NO_SUCCESSFUL_BUILDS:
            case ErrorTypes.ARTIFACTS_MISSING:
            case ErrorTypes.INVALID_CONFIG:
            default:
                showGenericError(error.title, error.message);
                break;
        }
    } else {
        showGenericError('Error', error.message || 'An unexpected error occurred');
    }
}

/**
 * Hide all error/setup panels.
 */
function hideAllPanels() {
    document.getElementById('setup-required')?.classList.add('hidden');
    document.getElementById('multiple-pipelines')?.classList.add('hidden');
    document.getElementById('permission-denied')?.classList.add('hidden');
    document.getElementById('error-state')?.classList.add('hidden');
    document.getElementById('loading-state')?.classList.add('hidden');
    document.getElementById('main-content')?.classList.add('hidden');
}

/**
 * Show setup required panel.
 */
function showSetupRequired(error) {
    const panel = document.getElementById('setup-required');
    if (!panel) return showGenericError(error.title, error.message);

    const messageEl = document.getElementById('setup-message');
    if (messageEl) messageEl.textContent = error.message;

    // Update instructions if provided
    if (error.details?.instructions) {
        const stepsList = document.getElementById('setup-steps');
        if (stepsList) {
            stepsList.innerHTML = error.details.instructions
                .map(s => `<li>${s}</li>`)
                .join('');
        }
    }

    // Update docs link if provided
    if (error.details?.docsUrl) {
        const docsLink = document.getElementById('docs-link');
        if (docsLink) docsLink.href = error.details.docsUrl;
    }

    panel.classList.remove('hidden');
}

/**
 * Show multiple pipelines panel.
 */
function showMultiplePipelines(error) {
    const panel = document.getElementById('multiple-pipelines');
    if (!panel) return showGenericError(error.title, error.message);

    const messageEl = document.getElementById('multiple-message');
    if (messageEl) messageEl.textContent = error.message;

    // Populate pipeline list
    const listEl = document.getElementById('pipeline-list');
    if (listEl && error.details?.matches) {
        listEl.innerHTML = error.details.matches
            .map(m => `
                <a href="?pipelineId=${m.id}" class="pipeline-option">
                    <strong>${m.name}</strong>
                    <span class="pipeline-id">ID: ${m.id}</span>
                </a>
            `)
            .join('');
    }

    panel.classList.remove('hidden');
}

/**
 * Show permission denied panel.
 */
function showPermissionDenied(error) {
    const panel = document.getElementById('permission-denied');
    if (!panel) return showGenericError(error.title, error.message);

    const messageEl = document.getElementById('permission-message');
    if (messageEl) messageEl.textContent = error.message;

    panel.classList.remove('hidden');
}

/**
 * Show generic error state.
 */
function showGenericError(title, message) {
    const panel = document.getElementById('error-state');
    if (!panel) return;

    const titleEl = document.getElementById('error-title');
    const messageEl = document.getElementById('error-message');

    if (titleEl) titleEl.textContent = title;
    if (messageEl) messageEl.textContent = message;

    panel.classList.remove('hidden');
}

// ============================================================================
// DOM and Event Handling
// ============================================================================

/**
 * Cache DOM elements for performance.
 */
function cacheElements() {
    elements.app = document.getElementById('app');
    elements.loadingState = document.getElementById('loading-state');
    elements.errorState = document.getElementById('error-state');
    elements.mainContent = document.getElementById('main-content');
    elements.errorTitle = document.getElementById('error-title');
    elements.errorMessage = document.getElementById('error-message');
    elements.runInfo = document.getElementById('run-info');
    elements.dateRange = document.getElementById('date-range');
    elements.customDates = document.getElementById('custom-dates');
    elements.startDate = document.getElementById('start-date');
    elements.endDate = document.getElementById('end-date');
    elements.tabs = document.querySelectorAll('.tab');
    elements.retryBtn = document.getElementById('retry-btn');

    // Metric elements
    elements.totalPrs = document.getElementById('total-prs');
    elements.cycleP50 = document.getElementById('cycle-p50');
    elements.cycleP90 = document.getElementById('cycle-p90');
    elements.authorsCount = document.getElementById('authors-count');
    elements.reviewersCount = document.getElementById('reviewers-count');
    elements.throughputChart = document.getElementById('throughput-chart');
    elements.cycleDistribution = document.getElementById('cycle-distribution');

    // Delta elements
    elements.totalPrsDelta = document.getElementById('total-prs-delta');
    elements.cycleP50Delta = document.getElementById('cycle-p50-delta');
    elements.cycleP90Delta = document.getElementById('cycle-p90-delta');
    elements.authorsDelta = document.getElementById('authors-delta');
    elements.reviewersDelta = document.getElementById('reviewers-delta');

    // Filter elements
    elements.repoFilter = document.getElementById('repo-filter');
    elements.teamFilter = document.getElementById('team-filter');
    elements.repoFilterGroup = document.getElementById('repo-filter-group');
    elements.teamFilterGroup = document.getElementById('team-filter-group');
    elements.clearFilters = document.getElementById('clear-filters');
    elements.activeFilters = document.getElementById('active-filters');
    elements.filterChips = document.getElementById('filter-chips');

    // Sparkline elements
    elements.totalPrsSparkline = document.getElementById('total-prs-sparkline');
    elements.cycleP50Sparkline = document.getElementById('cycle-p50-sparkline');
    elements.cycleP90Sparkline = document.getElementById('cycle-p90-sparkline');
    elements.authorsSparkline = document.getElementById('authors-sparkline');
    elements.reviewersSparkline = document.getElementById('reviewers-sparkline');
}

/**
 * Set up event listeners.
 */
function setupEventListeners() {
    // Date range selector
    elements.dateRange?.addEventListener('change', handleDateRangeChange);

    // Custom dates
    document.getElementById('apply-dates')?.addEventListener('click', applyCustomDates);

    // Tabs
    elements.tabs?.forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // Retry buttons
    elements.retryBtn?.addEventListener('click', () => init());
    document.getElementById('setup-retry-btn')?.addEventListener('click', () => init());
    document.getElementById('permission-retry-btn')?.addEventListener('click', () => init());

    // Dimension filters
    elements.repoFilter?.addEventListener('change', handleFilterChange);
    elements.teamFilter?.addEventListener('change', handleFilterChange);
    elements.clearFilters?.addEventListener('click', clearAllFilters);
}

// ============================================================================
// Data Loading and Rendering
// ============================================================================

/**
 * Load the dataset.
 */
async function loadDataset() {
    showLoading();

    try {
        // Load manifest first
        const manifest = await loader.loadManifest();

        // Load dimensions
        const dimensions = await loader.loadDimensions();

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
        console.error('Failed to load dataset:', error);
        handleError(error);
    }
}

/**
 * Set initial date range from manifest defaults.
 */
function setInitialDateRange() {
    // Skip if already restored from URL
    if (currentDateRange.start && currentDateRange.end) return;

    const coverage = loader.getCoverage?.() || null;
    const defaultDays = loader.getDefaultRangeDays?.() || 90;

    if (coverage?.date_range?.max) {
        const endDate = new Date(coverage.date_range.max);
        const startDate = new Date(endDate);
        startDate.setDate(startDate.getDate() - defaultDays);

        currentDateRange = { start: startDate, end: endDate };

        if (elements.startDate) {
            elements.startDate.value = startDate.toISOString().split('T')[0];
        }
        if (elements.endDate) {
            elements.endDate.value = endDate.toISOString().split('T')[0];
        }
    }
}

/**
 * Calculate the previous period date range for comparison.
 * @param {Date} start - Current period start
 * @param {Date} end - Current period end
 * @returns {{ start: Date, end: Date }} - Previous period range
 */
function getPreviousPeriod(start, end) {
    const durationMs = end.getTime() - start.getTime();
    const prevEnd = new Date(start.getTime() - 1); // Day before current start
    const prevStart = new Date(prevEnd.getTime() - durationMs);
    return { start: prevStart, end: prevEnd };
}

/**
 * Refresh metrics for current date range.
 */
async function refreshMetrics() {
    if (!currentDateRange.start || !currentDateRange.end) return;

    // Load current period data
    const rollups = await loader.getWeeklyRollups(
        currentDateRange.start,
        currentDateRange.end
    );

    const distributions = await loader.getDistributions(
        currentDateRange.start,
        currentDateRange.end
    );

    // Load previous period data for comparison
    const prevPeriod = getPreviousPeriod(currentDateRange.start, currentDateRange.end);
    let prevRollups = [];
    try {
        prevRollups = await loader.getWeeklyRollups(prevPeriod.start, prevPeriod.end);
    } catch (e) {
        // Previous period data may not exist, continue without it
        console.debug('Previous period data not available:', e);
    }

    renderSummaryCards(rollups, prevRollups);
    renderThroughputChart(rollups);
    renderCycleDistribution(distributions);
}

/**
 * Calculate metrics from rollups data.
 * @param {Array} rollups - Weekly rollup data
 * @returns {Object} - Calculated metrics
 */
function calculateMetrics(rollups) {
    if (!rollups || !rollups.length) {
        return { totalPrs: 0, cycleP50: null, cycleP90: null, avgAuthors: 0, avgReviewers: 0 };
    }

    const totalPrs = rollups.reduce((sum, r) => sum + (r.pr_count || 0), 0);

    const p50Values = rollups
        .map(r => r.cycle_time_p50)
        .filter(v => v !== null && v !== undefined);
    const p90Values = rollups
        .map(r => r.cycle_time_p90)
        .filter(v => v !== null && v !== undefined);

    const authorsSum = rollups.reduce((sum, r) => sum + (r.authors_count || 0), 0);
    const reviewersSum = rollups.reduce((sum, r) => sum + (r.reviewers_count || 0), 0);

    return {
        totalPrs,
        cycleP50: p50Values.length ? median(p50Values) : null,
        cycleP90: p90Values.length ? median(p90Values) : null,
        avgAuthors: rollups.length > 0 ? Math.round(authorsSum / rollups.length) : 0,
        avgReviewers: rollups.length > 0 ? Math.round(reviewersSum / rollups.length) : 0
    };
}

/**
 * Calculate percentage change between two values.
 * @param {number} current - Current value
 * @param {number} previous - Previous value
 * @returns {number|null} - Percentage change or null if not calculable
 */
function calculatePercentChange(current, previous) {
    if (previous === null || previous === undefined || previous === 0) {
        return null;
    }
    if (current === null || current === undefined) {
        return null;
    }
    return ((current - previous) / previous) * 100;
}

/**
 * Render a delta indicator element.
 * @param {HTMLElement} element - The delta element
 * @param {number|null} percentChange - Percentage change
 * @param {boolean} inverse - If true, positive is bad (e.g., cycle time)
 */
function renderDelta(element, percentChange, inverse = false) {
    if (!element) return;

    if (percentChange === null) {
        element.innerHTML = '';
        element.className = 'metric-delta';
        return;
    }

    const isNeutral = Math.abs(percentChange) < 2; // Within 2% is neutral
    const isPositive = percentChange > 0;
    const absChange = Math.abs(percentChange);

    let cssClass = 'metric-delta ';
    let arrow = '';

    if (isNeutral) {
        cssClass += 'delta-neutral';
        arrow = '~';
    } else if (isPositive) {
        cssClass += inverse ? 'delta-negative-inverse' : 'delta-positive';
        arrow = '&#9650;'; // Up arrow
    } else {
        cssClass += inverse ? 'delta-positive-inverse' : 'delta-negative';
        arrow = '&#9660;'; // Down arrow
    }

    const sign = isPositive ? '+' : '';
    element.className = cssClass;
    element.innerHTML = `<span class="delta-arrow">${arrow}</span> ${sign}${absChange.toFixed(0)}% <span class="delta-label">vs prev</span>`;
}

/**
 * Render a sparkline SVG from data points.
 * @param {HTMLElement} element - Container element
 * @param {Array<number>} values - Data values (last 8 points shown)
 */
function renderSparkline(element, values) {
    if (!element || !values || values.length < 2) {
        if (element) element.innerHTML = '';
        return;
    }

    // Take last 8 values for sparkline
    const data = values.slice(-8);
    const width = 60;
    const height = 24;
    const padding = 2;

    const minVal = Math.min(...data);
    const maxVal = Math.max(...data);
    const range = maxVal - minVal || 1;

    // Calculate points
    const points = data.map((val, i) => {
        const x = padding + (i / (data.length - 1)) * (width - padding * 2);
        const y = height - padding - ((val - minVal) / range) * (height - padding * 2);
        return { x, y };
    });

    // Create path
    const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');

    // Create area path (closed)
    const areaD = pathD + ` L ${points[points.length - 1].x.toFixed(1)} ${height - padding} L ${points[0].x.toFixed(1)} ${height - padding} Z`;

    // Last point for dot
    const lastPoint = points[points.length - 1];

    element.innerHTML = `
        <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
            <path class="sparkline-area" d="${areaD}"/>
            <path class="sparkline-line" d="${pathD}"/>
            <circle class="sparkline-dot" cx="${lastPoint.x.toFixed(1)}" cy="${lastPoint.y.toFixed(1)}" r="2"/>
        </svg>
    `;
}

/**
 * Extract sparkline data from rollups.
 * @param {Array} rollups - Weekly rollup data
 * @returns {Object} - Arrays of values for each metric
 */
function extractSparklineData(rollups) {
    if (!rollups || !rollups.length) {
        return { prCounts: [], p50s: [], p90s: [], authors: [], reviewers: [] };
    }

    return {
        prCounts: rollups.map(r => r.pr_count || 0),
        p50s: rollups.map(r => r.cycle_time_p50).filter(v => v !== null && v !== undefined),
        p90s: rollups.map(r => r.cycle_time_p90).filter(v => v !== null && v !== undefined),
        authors: rollups.map(r => r.authors_count || 0),
        reviewers: rollups.map(r => r.reviewers_count || 0)
    };
}

/**
 * Render summary metric cards.
 * @param {Array} rollups - Current period rollups
 * @param {Array} prevRollups - Previous period rollups for comparison
 */
function renderSummaryCards(rollups, prevRollups = []) {
    if (metricsCollector) metricsCollector.mark('render-summary-cards-start');

    const current = calculateMetrics(rollups);
    const previous = calculateMetrics(prevRollups);

    // Render metric values
    elements.totalPrs.textContent = current.totalPrs.toLocaleString();
    elements.cycleP50.textContent = current.cycleP50 !== null ? formatDuration(current.cycleP50) : '-';
    elements.cycleP90.textContent = current.cycleP90 !== null ? formatDuration(current.cycleP90) : '-';
    elements.authorsCount.textContent = current.avgAuthors.toLocaleString();
    if (elements.reviewersCount) {
        elements.reviewersCount.textContent = current.avgReviewers.toLocaleString();
    }

    // Render sparklines
    const sparklineData = extractSparklineData(rollups);
    renderSparkline(elements.totalPrsSparkline, sparklineData.prCounts);
    renderSparkline(elements.cycleP50Sparkline, sparklineData.p50s);
    renderSparkline(elements.cycleP90Sparkline, sparklineData.p90s);
    renderSparkline(elements.authorsSparkline, sparklineData.authors);
    renderSparkline(elements.reviewersSparkline, sparklineData.reviewers);

    // Render deltas (only if we have previous period data)
    if (prevRollups && prevRollups.length > 0) {
        renderDelta(elements.totalPrsDelta, calculatePercentChange(current.totalPrs, previous.totalPrs), false);
        renderDelta(elements.cycleP50Delta, calculatePercentChange(current.cycleP50, previous.cycleP50), true); // Inverse: lower is better
        renderDelta(elements.cycleP90Delta, calculatePercentChange(current.cycleP90, previous.cycleP90), true); // Inverse: lower is better
        renderDelta(elements.authorsDelta, calculatePercentChange(current.avgAuthors, previous.avgAuthors), false);
        renderDelta(elements.reviewersDelta, calculatePercentChange(current.avgReviewers, previous.avgReviewers), false);
    } else {
        // Clear deltas if no previous data
        [elements.totalPrsDelta, elements.cycleP50Delta, elements.cycleP90Delta, elements.authorsDelta, elements.reviewersDelta].forEach(el => {
            if (el) {
                el.innerHTML = '';
                el.className = 'metric-delta';
            }
        });
    }

    if (metricsCollector) {
        metricsCollector.mark('render-summary-cards-end');
        metricsCollector.mark('first-meaningful-paint');
        metricsCollector.measure('init-to-fmp', 'dashboard-init', 'first-meaningful-paint');
    }
}

/**
 * Calculate moving average for trend line.
 * @param {Array<number>} values - Data values
 * @param {number} window - Window size (default 4)
 * @returns {Array<number|null>} - Moving averages (null for first window-1 points)
 */
function calculateMovingAverage(values, window = 4) {
    const result = [];
    for (let i = 0; i < values.length; i++) {
        if (i < window - 1) {
            result.push(null);
        } else {
            const sum = values.slice(i - window + 1, i + 1).reduce((a, b) => a + b, 0);
            result.push(sum / window);
        }
    }
    return result;
}

/**
 * Render throughput chart with trend line overlay.
 */
function renderThroughputChart(rollups) {
    if (!rollups || !rollups.length) {
        elements.throughputChart.innerHTML = '<p class="no-data">No data for selected range</p>';
        return;
    }

    const prCounts = rollups.map(r => r.pr_count || 0);
    const maxCount = Math.max(...prCounts);
    const movingAvg = calculateMovingAverage(prCounts, 4);

    // Render bar chart
    const barsHtml = rollups.map(r => {
        const height = maxCount > 0 ? ((r.pr_count || 0) / maxCount * 100) : 0;
        return `
            <div class="bar-container" title="${r.week}: ${r.pr_count || 0} PRs">
                <div class="bar" style="height: ${height}%"></div>
                <div class="bar-label">${r.week.split('-W')[1]}</div>
            </div>
        `;
    }).join('');

    // Render trend line SVG overlay
    let trendLineHtml = '';
    if (rollups.length >= 4) {
        const validPoints = movingAvg
            .map((val, i) => ({ val, i }))
            .filter(p => p.val !== null);

        if (validPoints.length >= 2) {
            const chartHeight = 200;
            const chartPadding = 8;

            // Calculate SVG path points
            const points = validPoints.map(p => {
                const x = (p.i / (rollups.length - 1)) * 100;
                const y = maxCount > 0
                    ? chartHeight - chartPadding - ((p.val / maxCount) * (chartHeight - chartPadding * 2))
                    : chartHeight / 2;
                return { x, y };
            });

            const pathD = points.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)}% ${pt.y.toFixed(1)}`).join(' ');

            trendLineHtml = `
                <div class="trend-line-overlay">
                    <svg viewBox="0 0 100 ${chartHeight}" preserveAspectRatio="none">
                        <path class="trend-line" d="${pathD}" vector-effect="non-scaling-stroke"/>
                    </svg>
                </div>
            `;
        }
    }

    // Legend
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

    elements.throughputChart.innerHTML = `
        <div class="chart-with-trend">
            <div class="bar-chart">${barsHtml}</div>
            ${trendLineHtml}
        </div>
        ${legendHtml}
    `;
}

/**
 * Render cycle time distribution.
 */
function renderCycleDistribution(distributions) {
    if (!distributions || !distributions.length) {
        elements.cycleDistribution.innerHTML = '<p class="no-data">No data for selected range</p>';
        return;
    }

    const buckets = { '0-1h': 0, '1-4h': 0, '4-24h': 0, '1-3d': 0, '3-7d': 0, '7d+': 0 };
    distributions.forEach(d => {
        Object.entries(d.cycle_time_buckets || {}).forEach(([key, val]) => {
            buckets[key] = (buckets[key] || 0) + val;
        });
    });

    const total = Object.values(buckets).reduce((a, b) => a + b, 0);
    if (total === 0) {
        elements.cycleDistribution.innerHTML = '<p class="no-data">No cycle time data</p>';
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
    }).join('');

    elements.cycleDistribution.innerHTML = html;
}

/**
 * Update feature tabs based on manifest.
 */
async function updateFeatureTabs() {
    // Check if loader supports loadPredictions/loadInsights
    if (typeof loader.loadPredictions !== 'function') return;

    const predictionsContent = document.getElementById('tab-predictions');
    const predictionsUnavailable = document.getElementById('predictions-unavailable');
    const predictionsResult = await loader.loadPredictions();

    if (predictionsResult?.state === 'ok' && predictionsResult.data?.forecasts?.length > 0) {
        renderPredictions(predictionsContent, predictionsResult.data);
    } else if (predictionsUnavailable) {
        predictionsUnavailable.classList.remove('hidden');
    }

    const aiContent = document.getElementById('tab-ai-insights');
    const aiUnavailable = document.getElementById('ai-unavailable');
    const insightsResult = await loader.loadInsights();

    if (insightsResult?.state === 'ok' && insightsResult.data?.insights?.length > 0) {
        renderAIInsights(aiContent, insightsResult.data);
    } else if (aiUnavailable) {
        aiUnavailable.classList.remove('hidden');
    }
}

/**
 * Render predictions.
 */
function renderPredictions(container, predictions) {
    const content = document.createElement('div');
    content.className = 'predictions-content';

    if (predictions.is_stub) {
        content.innerHTML += `<div class="stub-warning">⚠️ Demo data</div>`;
    }

    predictions.forecasts.forEach(forecast => {
        const label = forecast.metric.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        content.innerHTML += `
            <div class="forecast-section">
                <h4>${label} (${forecast.unit})</h4>
                <table class="forecast-table">
                    <thead><tr><th>Week</th><th>Predicted</th><th>Range</th></tr></thead>
                    <tbody>
                        ${forecast.values.map(v => `
                            <tr>
                                <td>${v.period_start}</td>
                                <td>${v.predicted}</td>
                                <td>${v.lower_bound} - ${v.upper_bound}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    });

    const unavailable = container.querySelector('.feature-unavailable');
    if (unavailable) unavailable.classList.add('hidden');
    container.appendChild(content);
}

/**
 * Render AI insights.
 */
function renderAIInsights(container, insights) {
    const content = document.createElement('div');
    content.className = 'insights-content';

    if (insights.is_stub) {
        content.innerHTML += `<div class="stub-warning">⚠️ Demo data</div>`;
    }

    const icons = { critical: '🔴', warning: '🟡', info: '🔵' };
    ['critical', 'warning', 'info'].forEach(severity => {
        const items = insights.insights.filter(i => i.severity === severity);
        if (!items.length) return;

        content.innerHTML += `
            <div class="severity-section">
                <h4>${icons[severity]} ${severity.charAt(0).toUpperCase() + severity.slice(1)}</h4>
                <div class="insight-cards">
                    ${items.map(i => `
                        <div class="insight-card ${i.severity}">
                            <div class="insight-category">${i.category}</div>
                            <h5>${i.title}</h5>
                            <p>${i.description}</p>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    });

    const unavailable = container.querySelector('.feature-unavailable');
    if (unavailable) unavailable.classList.add('hidden');
    container.appendChild(content);
}

// ============================================================================
// Event Handlers
// ============================================================================

function handleDateRangeChange(e) {
    const value = e.target.value;

    if (value === 'custom') {
        elements.customDates?.classList.remove('hidden');
        return;
    }

    elements.customDates?.classList.add('hidden');

    const days = parseInt(value, 10);
    const coverage = loader.getCoverage?.() || null;
    const endDate = coverage?.date_range?.max ? new Date(coverage.date_range.max) : new Date();
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - days);

    currentDateRange = { start: startDate, end: endDate };
    updateUrlState();
    refreshMetrics();
}

function applyCustomDates() {
    const start = elements.startDate?.value;
    const end = elements.endDate?.value;

    if (!start || !end) return;

    currentDateRange = { start: new Date(start), end: new Date(end) };
    updateUrlState();
    refreshMetrics();
}

function switchTab(tabId) {
    elements.tabs?.forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === tabId);
    });

    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('active', content.id === `tab-${tabId}`);
        content.classList.toggle('hidden', content.id !== `tab-${tabId}`);
    });

    updateUrlState();
}

// ============================================================================
// Filter Management
// ============================================================================

/**
 * Populate filter dropdowns from loaded dimensions.
 * @param {Object} dimensions - Dimensions data from dimensions.json
 */
function populateFilterDropdowns(dimensions) {
    if (!dimensions) return;

    // Populate repository filter
    if (elements.repoFilter && dimensions.repositories?.length > 0) {
        elements.repoFilter.innerHTML = '<option value="">All</option>';
        dimensions.repositories.forEach(repo => {
            const option = document.createElement('option');
            option.value = repo.id || repo.name;
            option.textContent = repo.name;
            elements.repoFilter.appendChild(option);
        });
        elements.repoFilterGroup?.classList.remove('hidden');
    } else {
        elements.repoFilterGroup?.classList.add('hidden');
    }

    // Populate team filter
    if (elements.teamFilter && dimensions.teams?.length > 0) {
        elements.teamFilter.innerHTML = '<option value="">All</option>';
        dimensions.teams.forEach(team => {
            const option = document.createElement('option');
            option.value = team.id || team.name;
            option.textContent = team.name;
            elements.teamFilter.appendChild(option);
        });
        elements.teamFilterGroup?.classList.remove('hidden');
    } else {
        elements.teamFilterGroup?.classList.add('hidden');
    }

    // Restore filter state from URL
    restoreFiltersFromUrl();
}

/**
 * Handle filter dropdown change.
 */
function handleFilterChange() {
    // Get selected values from multi-select
    const repoValues = elements.repoFilter
        ? Array.from(elements.repoFilter.selectedOptions).map(o => o.value).filter(v => v)
        : [];
    const teamValues = elements.teamFilter
        ? Array.from(elements.teamFilter.selectedOptions).map(o => o.value).filter(v => v)
        : [];

    currentFilters = { repos: repoValues, teams: teamValues };

    updateFilterUI();
    updateUrlState();
    refreshMetrics();
}

/**
 * Clear all filters.
 */
function clearAllFilters() {
    currentFilters = { repos: [], teams: [] };

    // Reset dropdowns
    if (elements.repoFilter) {
        Array.from(elements.repoFilter.options).forEach(o => o.selected = o.value === '');
    }
    if (elements.teamFilter) {
        Array.from(elements.teamFilter.options).forEach(o => o.selected = o.value === '');
    }

    updateFilterUI();
    updateUrlState();
    refreshMetrics();
}

/**
 * Remove a specific filter.
 * @param {string} type - 'repo' or 'team'
 * @param {string} value - The value to remove
 */
function removeFilter(type, value) {
    if (type === 'repo') {
        currentFilters.repos = currentFilters.repos.filter(v => v !== value);
        if (elements.repoFilter) {
            const option = elements.repoFilter.querySelector(`option[value="${value}"]`);
            if (option) option.selected = false;
        }
    } else if (type === 'team') {
        currentFilters.teams = currentFilters.teams.filter(v => v !== value);
        if (elements.teamFilter) {
            const option = elements.teamFilter.querySelector(`option[value="${value}"]`);
            if (option) option.selected = false;
        }
    }

    updateFilterUI();
    updateUrlState();
    refreshMetrics();
}

/**
 * Update filter UI (chips and clear button visibility).
 */
function updateFilterUI() {
    const hasFilters = currentFilters.repos.length > 0 || currentFilters.teams.length > 0;

    // Show/hide clear button
    if (elements.clearFilters) {
        elements.clearFilters.classList.toggle('hidden', !hasFilters);
    }

    // Show/hide active filters container and render chips
    if (elements.activeFilters && elements.filterChips) {
        elements.activeFilters.classList.toggle('hidden', !hasFilters);

        if (hasFilters) {
            renderFilterChips();
        } else {
            elements.filterChips.innerHTML = '';
        }
    }
}

/**
 * Render filter chips for active filters.
 */
function renderFilterChips() {
    if (!elements.filterChips) return;

    const chips = [];

    // Repo chips
    currentFilters.repos.forEach(value => {
        const label = getFilterLabel('repo', value);
        chips.push(createFilterChip('repo', value, label));
    });

    // Team chips
    currentFilters.teams.forEach(value => {
        const label = getFilterLabel('team', value);
        chips.push(createFilterChip('team', value, label));
    });

    elements.filterChips.innerHTML = chips.join('');

    // Add click handlers for remove buttons
    elements.filterChips.querySelectorAll('.filter-chip-remove').forEach(btn => {
        btn.addEventListener('click', () => {
            removeFilter(btn.dataset.type, btn.dataset.value);
        });
    });
}

/**
 * Get display label for a filter value.
 * @param {string} type - 'repo' or 'team'
 * @param {string} value - The filter value
 * @returns {string} Display label
 */
function getFilterLabel(type, value) {
    if (type === 'repo' && elements.repoFilter) {
        const option = elements.repoFilter.querySelector(`option[value="${value}"]`);
        return option?.textContent || value;
    }
    if (type === 'team' && elements.teamFilter) {
        const option = elements.teamFilter.querySelector(`option[value="${value}"]`);
        return option?.textContent || value;
    }
    return value;
}

/**
 * Create HTML for a filter chip.
 * @param {string} type - 'repo' or 'team'
 * @param {string} value - The filter value
 * @param {string} label - Display label
 * @returns {string} HTML string
 */
function createFilterChip(type, value, label) {
    const prefix = type === 'repo' ? 'repo' : 'team';
    return `
        <span class="filter-chip">
            <span class="filter-chip-label">${prefix}: ${label}</span>
            <span class="filter-chip-remove" data-type="${type}" data-value="${value}">&times;</span>
        </span>
    `;
}

/**
 * Restore filters from URL parameters.
 */
function restoreFiltersFromUrl() {
    const params = new URLSearchParams(window.location.search);

    const reposParam = params.get('repos');
    const teamsParam = params.get('teams');

    if (reposParam) {
        currentFilters.repos = reposParam.split(',').filter(v => v);
        if (elements.repoFilter) {
            currentFilters.repos.forEach(value => {
                const option = elements.repoFilter.querySelector(`option[value="${value}"]`);
                if (option) option.selected = true;
            });
        }
    }

    if (teamsParam) {
        currentFilters.teams = teamsParam.split(',').filter(v => v);
        if (elements.teamFilter) {
            currentFilters.teams.forEach(value => {
                const option = elements.teamFilter.querySelector(`option[value="${value}"]`);
                if (option) option.selected = true;
            });
        }
    }

    updateFilterUI();
}

// ============================================================================
// Utility Functions
// ============================================================================

function showLoading() {
    hideAllPanels();
    elements.loadingState?.classList.remove('hidden');
}

function showContent() {
    hideAllPanels();
    elements.mainContent?.classList.remove('hidden');
}

function updateDatasetInfo(manifest) {
    const generatedAt = manifest?.generated_at
        ? new Date(manifest.generated_at).toLocaleString()
        : 'Unknown';
    const runId = manifest?.run_id || '';

    if (elements.runInfo) {
        elements.runInfo.textContent = `Generated: ${generatedAt}`;
        if (runId) elements.runInfo.textContent += ` | Run: ${runId.slice(0, 8)}`;
    }
}

function formatDuration(minutes) {
    if (minutes < 60) return `${Math.round(minutes)}m`;
    if (minutes < 1440) return `${(minutes / 60).toFixed(1)}h`;
    return `${(minutes / 1440).toFixed(1)}d`;
}

function median(arr) {
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function updateUrlState() {
    const params = new URLSearchParams(window.location.search);
    const newParams = new URLSearchParams();

    // Preserve config params
    if (params.get('dataset')) newParams.set('dataset', params.get('dataset'));
    if (params.get('pipelineId')) newParams.set('pipelineId', params.get('pipelineId'));

    // Add date range
    if (currentDateRange.start) {
        newParams.set('start', currentDateRange.start.toISOString().split('T')[0]);
    }
    if (currentDateRange.end) {
        newParams.set('end', currentDateRange.end.toISOString().split('T')[0]);
    }

    // Add active tab
    const activeTab = document.querySelector('.tab.active');
    if (activeTab && activeTab.dataset.tab !== 'metrics') {
        newParams.set('tab', activeTab.dataset.tab);
    }

    // Add filters
    if (currentFilters.repos.length > 0) {
        newParams.set('repos', currentFilters.repos.join(','));
    }
    if (currentFilters.teams.length > 0) {
        newParams.set('teams', currentFilters.teams.join(','));
    }

    window.history.replaceState({}, '', `${window.location.pathname}?${newParams.toString()}`);
}

function restoreStateFromUrl() {
    const params = new URLSearchParams(window.location.search);

    const startParam = params.get('start');
    const endParam = params.get('end');
    if (startParam && endParam) {
        currentDateRange = { start: new Date(startParam), end: new Date(endParam) };
        if (elements.dateRange) {
            elements.dateRange.value = 'custom';
            elements.customDates?.classList.remove('hidden');
        }
        if (elements.startDate) elements.startDate.value = startParam;
        if (elements.endDate) elements.endDate.value = endParam;
    }

    const tabParam = params.get('tab');
    if (tabParam) {
        setTimeout(() => switchTab(tabParam), 0);
    }
}

// ============================================================================
// Initialize
// ============================================================================

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
