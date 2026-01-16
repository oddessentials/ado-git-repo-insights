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
let sdkInitialized = false;

// Settings key for extension data storage
const SETTINGS_KEY = 'pr-insights-pipeline-id';

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
 * Get pipeline ID from extension settings.
 *
 * @returns {Promise<number|null>}
 */
async function getSettingsPipelineId() {
    try {
        const dataService = await VSS.getService(VSS.ServiceIds.ExtensionData);
        const savedPipelineId = await dataService.getValue(SETTINGS_KEY, { scopeType: 'User' });
        if (savedPipelineId && typeof savedPipelineId === 'number' && savedPipelineId > 0) {
            return savedPipelineId;
        }
    } catch (e) {
        console.log('Could not read extension settings:', e);
    }
    return null;
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

    // From here on, we need the SDK and Build API
    const webContext = VSS.getWebContext();
    const projectId = webContext.project.id;

    // Initialize artifact client
    artifactClient = new ArtifactClient(projectId);
    await artifactClient.initialize();

    // Mode: explicit pipelineId from query
    if (queryResult.mode === 'explicit') {
        return await resolveFromPipelineId(queryResult.value, projectId);
    }

    // Check settings
    const settingsPipelineId = await getSettingsPipelineId();
    if (settingsPipelineId) {
        console.log(`Using pipeline ID from settings: ${settingsPipelineId}`);
        return await resolveFromPipelineId(settingsPipelineId, projectId);
    }

    // Mode: discovery
    return await discoverAndResolve(projectId);
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
        const definitions = await buildClient.getDefinitions(projectId, null, null, null, null, null, [pipelineId]);
        const name = definitions?.[0]?.name || `ID ${pipelineId}`;
        throw createNoSuccessfulBuildsError(name);
    }

    const latestBuild = builds[0];

    // Check for aggregates artifact
    const artifacts = await artifactClient.getArtifacts(latestBuild.id);
    const hasAggregates = artifacts.some(a => a.name === 'aggregates');

    if (!hasAggregates) {
        const definitions = await buildClient.getDefinitions(projectId, null, null, null, null, null, [pipelineId]);
        const name = definitions?.[0]?.name || `ID ${pipelineId}`;
        throw createArtifactsMissingError(name, latestBuild.id);
    }

    // Verify manifest exists
    const hasManifest = await artifactClient.hasArtifactFile(
        latestBuild.id,
        'aggregates',
        'dataset-manifest.json'
    );

    if (!hasManifest) {
        throw createArtifactsMissingError(`Pipeline ${pipelineId}`, latestBuild.id);
    }

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
    const definitions = await buildClient.getDefinitions(projectId, null, null, null, null, 50);

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

            // Verify manifest exists
            const hasManifest = await artifactClient.hasArtifactFile(
                latestBuild.id,
                'aggregates',
                'dataset-manifest.json'
            );

            if (hasManifest) {
                matches.push({
                    id: def.id,
                    name: def.name,
                    buildId: latestBuild.id
                });
            }
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
    elements.throughputChart = document.getElementById('throughput-chart');
    elements.cycleDistribution = document.getElementById('cycle-distribution');
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
        await loader.loadDimensions();

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
 * Refresh metrics for current date range.
 */
async function refreshMetrics() {
    if (!currentDateRange.start || !currentDateRange.end) return;

    const rollups = await loader.getWeeklyRollups(
        currentDateRange.start,
        currentDateRange.end
    );

    const distributions = await loader.getDistributions(
        currentDateRange.start,
        currentDateRange.end
    );

    renderSummaryCards(rollups);
    renderThroughputChart(rollups);
    renderCycleDistribution(distributions);
}

/**
 * Render summary metric cards.
 */
function renderSummaryCards(rollups) {
    if (metricsCollector) metricsCollector.mark('render-summary-cards-start');

    if (!rollups || !rollups.length) {
        elements.totalPrs.textContent = '0';
        elements.cycleP50.textContent = '-';
        elements.cycleP90.textContent = '-';
        elements.authorsCount.textContent = '0';
        if (metricsCollector) metricsCollector.mark('render-summary-cards-end');
        return;
    }

    const totalPrs = rollups.reduce((sum, r) => sum + (r.pr_count || 0), 0);
    const p50Values = [];
    const p90Values = [];

    rollups.forEach(r => {
        if (r.cycle_time_p50 !== null) p50Values.push(r.cycle_time_p50);
        if (r.cycle_time_p90 !== null) p90Values.push(r.cycle_time_p90);
    });

    elements.totalPrs.textContent = totalPrs.toLocaleString();
    elements.cycleP50.textContent = p50Values.length ? formatDuration(median(p50Values)) : '-';
    elements.cycleP90.textContent = p90Values.length ? formatDuration(median(p90Values)) : '-';

    const authorsCount = rollups.reduce((sum, r) => sum + (r.authors_count || 0), 0);
    elements.authorsCount.textContent = rollups.length > 0
        ? Math.round(authorsCount / rollups.length).toLocaleString()
        : '0';

    if (metricsCollector) {
        metricsCollector.mark('render-summary-cards-end');
        metricsCollector.mark('first-meaningful-paint');
        metricsCollector.measure('init-to-fmp', 'dashboard-init', 'first-meaningful-paint');
    }
}

/**
 * Render throughput chart.
 */
function renderThroughputChart(rollups) {
    if (!rollups || !rollups.length) {
        elements.throughputChart.innerHTML = '<p class="no-data">No data for selected range</p>';
        return;
    }

    const maxCount = Math.max(...rollups.map(r => r.pr_count || 0));

    const html = rollups.map(r => {
        const height = maxCount > 0 ? ((r.pr_count || 0) / maxCount * 100) : 0;
        return `
            <div class="bar-container" title="${r.week}: ${r.pr_count || 0} PRs">
                <div class="bar" style="height: ${height}%"></div>
                <div class="bar-label">${r.week.split('-W')[1]}</div>
            </div>
        `;
    }).join('');

    elements.throughputChart.innerHTML = `<div class="bar-chart">${html}</div>`;
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
