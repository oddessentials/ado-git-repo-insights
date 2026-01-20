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

import { DatasetLoader, IDatasetLoader, Rollup } from './dataset-loader';
import { ArtifactClient } from './artifact-client';
import { PrInsightsError, ErrorTypes, createSetupRequiredError, createNoSuccessfulBuildsError, createArtifactsMissingError, createInvalidConfigError, SetupRequiredDetails, MultiplePipelinesDetails, ArtifactsMissingDetails } from './error-types';

// Dashboard state
let loader: IDatasetLoader | null = null;
let artifactClient: ArtifactClient | null = null;
let currentDateRange: { start: Date | null; end: Date | null } = { start: null, end: null };
let currentFilters: { repos: string[]; teams: string[] } = { repos: [], teams: [] };
let comparisonMode = false;
let cachedRollups: Rollup[] = []; // Cache for export
let currentBuildId: number | null = null; // Store build ID for raw data download
let sdkInitialized = false;

// Settings keys for extension data storage (must match settings.js)
const SETTINGS_KEY_PROJECT = 'pr-insights-source-project';
const SETTINGS_KEY_PIPELINE = 'pr-insights-pipeline-id';

// Feature flags
const ENABLE_PHASE5_FEATURES = true;

// DOM element cache
const elements: Record<string, any> = {};

/**
 * Phase 4: Production-safe metrics collector
 */
const IS_PRODUCTION = typeof window !== 'undefined' && (window as any).process?.env?.NODE_ENV === 'production';
const DEBUG_ENABLED = !IS_PRODUCTION && (
    (typeof window !== 'undefined' && (window as any).__DASHBOARD_DEBUG__) ||
    (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug'))
);

interface PerformanceMetric {
    name: string;
    duration: number;
    timestamp: number;
}

const metricsCollector = DEBUG_ENABLED ? {
    marks: new Map<string, number>(),
    measures: [] as PerformanceMetric[],
    mark(name: string) {
        if (!performance || !performance.mark) return;
        try {
            performance.mark(name);
            this.marks.set(name, performance.now());
        } catch (_e) { /* ignore */ }
    },
    measure(name: string, startMark: string, endMark: string) {
        if (!performance || !performance.measure) return;
        try {
            performance.measure(name, startMark, endMark);
            const entries = performance.getEntriesByName(name, 'measure');
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
        } catch (_e) { /* ignore */ }
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
    (window as any).__dashboardMetrics = metricsCollector;
}

// ============================================================================
// SDK Initialization
// ============================================================================

/**
 * Initialize Azure DevOps Extension SDK.
 */
async function initializeAdoSdk(): Promise<void> {
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
 */
function parseQueryParams(): { mode: string; value: any; warning?: string | null } | PrInsightsError {
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
            } catch (_e) {
                return createInvalidConfigError('dataset', datasetUrl, 'Invalid URL format');
            }
        }

        let warning: string | null = null;
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
 */
async function getSourceConfig(): Promise<{ projectId: string | null; pipelineId: number | null }> {
    const result: { projectId: string | null; pipelineId: number | null } = { projectId: null, pipelineId: null };
    try {
        const dataService = await VSS.getService<IExtensionDataService>(VSS.ServiceIds.ExtensionData);

        // Get source project ID
        const savedProjectId = await dataService.getValue<string>(SETTINGS_KEY_PROJECT, { scopeType: 'User' });
        if (savedProjectId && typeof savedProjectId === 'string' && savedProjectId.trim()) {
            result.projectId = savedProjectId.trim();
        }

        // Get pipeline definition ID
        const savedPipelineId = await dataService.getValue<number>(SETTINGS_KEY_PIPELINE, { scopeType: 'User' });
        if (savedPipelineId && typeof savedPipelineId === 'number' && savedPipelineId > 0) {
            result.pipelineId = savedPipelineId;
        }
    } catch (e) {
        console.log('Could not read extension settings:', e);
    }
    return result;
}

/**
 * Clear stale pipeline ID setting.
 */
async function clearStalePipelineSetting(): Promise<void> {
    try {
        const dataService = await VSS.getService<IExtensionDataService>(VSS.ServiceIds.ExtensionData);
        await dataService.setValue(SETTINGS_KEY_PIPELINE, null, { scopeType: 'User' });
        console.log('Cleared stale pipeline setting to re-enable auto-discovery');
    } catch (e) {
        console.warn('Could not clear stale pipeline setting:', e);
    }
}

/**
 * Resolve configuration using precedence rules.
 */
async function resolveConfiguration(): Promise<{ buildId?: number; artifactName?: string; directUrl?: string }> {
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
    const currentProjectId = webContext.project?.id;
    if (!currentProjectId) {
        throw new Error('No project context available');
    }

    // Get configured source from settings
    const sourceConfig = await getSourceConfig();

    // Determine which project to use for artifact access
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
        try {
            return await resolveFromPipelineId(sourceConfig.pipelineId, targetProjectId);
        } catch (error: any) {
            console.warn(`Saved pipeline ${sourceConfig.pipelineId} is invalid, falling back to auto-discovery:`, error.message);
            await clearStalePipelineSetting();
        }
    }

    // Mode: discovery in target project
    return await discoverAndResolve(targetProjectId);
}

/**
 * Resolve artifact info from a specific pipeline ID.
 */
async function resolveFromPipelineId(pipelineId: number, projectId: string): Promise<{ buildId: number; artifactName: string }> {
    // Get Build REST client
    const buildClient = await getBuildClient();

    // Get latest successful build
    const builds = await buildClient.getBuilds(
        projectId,
        [pipelineId],
        undefined, undefined, undefined, undefined, undefined,
        undefined, // reasonFilter
        2,         // statusFilter: Completed
        6,         // resultFilter: Succeeded (2) | PartiallySucceeded (4)
        undefined, undefined,
        1          // top
    );

    if (!builds || builds.length === 0) {
        const definitions = await buildClient.getDefinitions(projectId, undefined, undefined, undefined, 2, undefined, undefined, undefined, [pipelineId]);
        const name = definitions?.[0]?.name || `ID ${pipelineId}`;
        throw createNoSuccessfulBuildsError(name);
    }

    const latestBuild = builds[0];
    if (!latestBuild) throw new Error('Failed to retrieve latest build');

    // Check for aggregates artifact
    if (!artifactClient) throw new Error('ArtifactClient not initialized');
    const artifacts = await artifactClient.getArtifacts(latestBuild.id);
    const hasAggregates = artifacts.some(a => a.name === 'aggregates');

    if (!hasAggregates) {
        const definitions = await buildClient.getDefinitions(projectId, undefined, undefined, undefined, 2, undefined, undefined, undefined, [pipelineId]);
        const name = definitions?.[0]?.name || `ID ${pipelineId}`;
        throw createArtifactsMissingError(name, latestBuild.id);
    }

    return { buildId: latestBuild.id, artifactName: 'aggregates' };
}

/**
 * Discover pipelines with aggregates and resolve.
 */
async function discoverAndResolve(projectId: string): Promise<{ buildId: number; artifactName: string }> {
    const matches = await discoverInsightsPipelines(projectId);

    if (matches.length === 0) {
        throw createSetupRequiredError();
    }

    const firstMatch = matches[0];
    if (!firstMatch) throw createSetupRequiredError();

    return { buildId: firstMatch.buildId, artifactName: 'aggregates' };
}

/**
 * Discover pipelines with aggregates artifact.
 */
async function discoverInsightsPipelines(projectId: string): Promise<Array<{ id: number; name: string; buildId: number }>> {
    const buildClient = await getBuildClient();
    const matches: Array<{ id: number; name: string; buildId: number }> = [];

    const definitions = await buildClient.getDefinitions(projectId, undefined, undefined, undefined, 2, 50);

    for (const def of definitions) {
        const builds = await buildClient.getBuilds(
            projectId,
            [def.id],
            undefined, undefined, undefined, undefined, undefined,
            undefined, 2, 6, undefined, undefined, 1
        );

        if (!builds || builds.length === 0) continue;

        const latestBuild = builds[0];
        if (!latestBuild) continue;

        try {
            if (!artifactClient) throw new Error('ArtifactClient not initialized');
            const artifacts = await artifactClient.getArtifacts(latestBuild.id);
            if (!artifacts.some(a => a.name === 'aggregates')) continue;

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

/**
 * Get Build REST client from SDK.
 */
async function getBuildClient(): Promise<IBuildRestClient> {
    return new Promise((resolve) => {
        VSS.require(['TFS/Build/RestClient'], (BuildRestClient: any) => {
            resolve(BuildRestClient.getClient());
        });
    });
}

// ============================================================================
// Main Initialization
// ============================================================================

/**
 * Check if running in local dashboard mode.
 */
function isLocalMode(): boolean {
    return typeof window !== 'undefined' && (window as any).LOCAL_DASHBOARD_MODE === true;
}

/**
 * Get local dataset path from window config.
 */
function getLocalDatasetPath(): string {
    return (typeof window !== 'undefined' && (window as any).DATASET_PATH) || './dataset';
}

/**
 * Initialize the dashboard.
 */
async function init(): Promise<void> {
    if (metricsCollector) metricsCollector.mark('dashboard-init');

    cacheElements();
    setupEventListeners();
    initializePhase5Features();

    try {
        if (isLocalMode()) {
            console.log('[Dashboard] Running in local mode');
            const datasetPath = getLocalDatasetPath();
            loader = new DatasetLoader(datasetPath);
            currentBuildId = null;

            const projectNameEl = document.getElementById('current-project-name');
            if (projectNameEl) {
                projectNameEl.textContent = 'Local Dashboard';
            }

            const exportRawZip = document.getElementById('export-raw-zip');
            if (exportRawZip) {
                exportRawZip.style.display = 'none';
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
            loader = artifactClient.createDatasetLoader(config.buildId, config.artifactName);
            currentBuildId = config.buildId;
        } else {
            throw new Error('Failed to resolve configuration');
        }

        await loadDataset();

    } catch (error: any) {
        console.error('Dashboard initialization failed:', error);
        handleError(error);
    }
}

/**
 * Handle errors with appropriate UI panels.
 */
function handleError(error: any): void {
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
        showGenericError('Error', error.message || 'An unexpected error occurred');
    }
}

/**
 * Hide all error/setup panels.
 */
function hideAllPanels(): void {
    ['setup-required', 'multiple-pipelines', 'artifacts-missing', 'permission-denied', 'error-state', 'loading-state', 'main-content'].forEach(id => {
        document.getElementById(id)?.classList.add('hidden');
    });
}

/**
 * Show setup required panel.
 */
function showSetupRequired(error: PrInsightsError): void {
    const panel = document.getElementById('setup-required');
    if (!panel) return showGenericError(error.title, error.message);

    const messageEl = document.getElementById('setup-message');
    if (messageEl) messageEl.textContent = error.message;

    const details = error.details as SetupRequiredDetails;
    if (details?.instructions && Array.isArray(details.instructions)) {
        const stepsList = document.getElementById('setup-steps');
        if (stepsList) {
            stepsList.innerHTML = details.instructions
                .map((s: string) => `<li>${s}</li>`)
                .join('');
        }
    }

    if (details?.docsUrl) {
        const docsLink = document.getElementById('docs-link') as HTMLAnchorElement | null;
        if (docsLink) docsLink.href = String(details.docsUrl);
    }

    panel.classList.remove('hidden');
}

/**
 * Show multiple pipelines panel.
 */
function showMultiplePipelines(error: PrInsightsError): void {
    const panel = document.getElementById('multiple-pipelines');
    if (!panel) return showGenericError(error.title, error.message);

    const messageEl = document.getElementById('multiple-message');
    if (messageEl) messageEl.textContent = error.message;

    const listEl = document.getElementById('pipeline-list');
    const details = error.details as MultiplePipelinesDetails;
    if (listEl && details?.matches && Array.isArray(details.matches)) {
        listEl.innerHTML = details.matches
            .map((m: any) => `
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
function showPermissionDenied(error: PrInsightsError): void {
    const panel = document.getElementById('permission-denied');
    if (!panel) return showGenericError(error.title, error.message);

    const messageEl = document.getElementById('permission-message');
    if (messageEl) messageEl.textContent = error.message;

    panel.classList.remove('hidden');
}

/**
 * Show generic error state.
 */
function showGenericError(title: string, message: string): void {
    const panel = document.getElementById('error-state');
    if (!panel) return;

    const titleEl = document.getElementById('error-title');
    const messageEl = document.getElementById('error-message');

    if (titleEl) titleEl.textContent = title;
    if (messageEl) messageEl.textContent = message;

    panel.classList.remove('hidden');
}

/**
 * Show artifacts missing panel.
 */
function showArtifactsMissing(error: PrInsightsError): void {
    const panel = document.getElementById('artifacts-missing');
    if (!panel) return showGenericError(error.title, error.message);

    const messageEl = document.getElementById('missing-message');
    if (messageEl) messageEl.textContent = error.message;

    const details = error.details as ArtifactsMissingDetails;
    if (details?.instructions && Array.isArray(details.instructions)) {
        const stepsList = document.getElementById('missing-steps');
        if (stepsList) {
            stepsList.innerHTML = details.instructions
                .map((s: string) => `<li>${s}</li>`)
                .join('');
        }
    }

    panel.classList.remove('hidden');
}

// ============================================================================
// DOM and Event Handling
// ============================================================================

/**
 * Cache DOM elements for performance.
 */
function cacheElements(): void {
    const ids = [
        'app', 'loading-state', 'error-state', 'main-content', 'error-title', 'error-message',
        'run-info', 'date-range', 'custom-dates', 'start-date', 'end-date', 'retry-btn',
        'total-prs', 'cycle-p50', 'cycle-p90', 'authors-count', 'reviewers-count',
        'throughput-chart', 'cycle-distribution', 'total-prs-delta', 'cycle-p50-delta',
        'cycle-p90-delta', 'authors-delta', 'reviewers-delta', 'repo-filter', 'team-filter',
        'repo-filter-group', 'team-filter-group', 'clear-filters', 'active-filters', 'filter-chips',
        'total-prs-sparkline', 'cycle-p50-sparkline', 'cycle-p90-sparkline', 'authors-sparkline',
        'reviewers-sparkline', 'cycle-time-trend', 'reviewer-activity', 'compare-toggle',
        'comparison-banner', 'current-period-dates', 'previous-period-dates', 'exit-compare',
        'export-btn', 'export-menu', 'export-csv', 'export-link', 'export-raw-zip'
    ];

    ids.forEach(id => {
        elements[id] = document.getElementById(id);
    });

    elements.tabs = document.querySelectorAll('.tab');
}

/**
 * Initialize Phase 5 features.
 */
function initializePhase5Features(): void {
    const phase5Tabs = document.querySelectorAll('.phase5-tab');

    if (ENABLE_PHASE5_FEATURES) {
        phase5Tabs.forEach(tab => tab.classList.remove('hidden'));
        console.log('Phase 5 features enabled');
    } else {
        console.log('Phase 5 features disabled');
    }
}

/**
 * Set up event listeners.
 */
function setupEventListeners(): void {
    elements['date-range']?.addEventListener('change', handleDateRangeChange);
    document.getElementById('apply-dates')?.addEventListener('click', applyCustomDates);

    elements.tabs?.forEach((tab: HTMLElement) => {
        tab.addEventListener('click', () => {
            const tabId = tab.dataset['tab'];
            if (tabId) switchTab(tabId);
        });
    });

    elements['retry-btn']?.addEventListener('click', () => init());
    document.getElementById('setup-retry-btn')?.addEventListener('click', () => init());
    document.getElementById('permission-retry-btn')?.addEventListener('click', () => init());

    elements['repo-filter']?.addEventListener('change', handleFilterChange);
    elements['team-filter']?.addEventListener('change', handleFilterChange);
    elements['clear-filters']?.addEventListener('click', clearAllFilters);

    elements['compare-toggle']?.addEventListener('click', toggleComparisonMode);
    elements['exit-compare']?.addEventListener('click', exitComparisonMode);

    elements['export-btn']?.addEventListener('click', toggleExportMenu);
    elements['export-csv']?.addEventListener('click', exportToCsv);
    elements['export-link']?.addEventListener('click', copyShareableLink);
    elements['export-raw-zip']?.addEventListener('click', downloadRawDataZip);

    document.addEventListener('click', (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        if (!target.closest('.export-dropdown')) {
            elements['export-menu']?.classList.add('hidden');
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
        if (!loader) throw new Error('Loader not initialized');

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

        if (elements['start-date']) {
            elements['start-date'].value = startDate.toISOString().split('T')[0];
        }
        if (elements['end-date']) {
            elements['end-date'].value = endDate.toISOString().split('T')[0];
        }
    }
}

/**
 * Calculate the previous period date range for comparison.
 */
function getPreviousPeriod(start: Date, end: Date): { start: Date; end: Date } {
    const durationMs = end.getTime() - start.getTime();
    const prevEnd = new Date(start.getTime() - 1); // Day before current start
    const prevStart = new Date(prevEnd.getTime() - durationMs);
    return { start: prevStart, end: prevEnd };
}

/**
 * Apply dimension filters to rollups data.
 * Uses by_repository slices when available for accurate filtering.
 */
function applyFiltersToRollups(rollups: Rollup[], filters: { repos: string[]; teams: string[] }): Rollup[] {
    // No filters active - return original data
    if (!filters.repos.length && !filters.teams.length) {
        return rollups;
    }

    return rollups.map(rollup => {
        // If we have by_repository slices and repo filter is active, use them
        if (filters.repos.length && rollup.by_repository) {
            const selectedRepos = filters.repos
                .map(repoId => {
                    const repoData = rollup.by_repository![repoId];
                    if (repoData) return repoData;

                    return Object.entries(rollup.by_repository!)
                        .find(([name]) => name === repoId)?.[1];
                })
                .filter(Boolean) as any[];

            if (selectedRepos.length === 0) {
                return {
                    ...rollup,
                    pr_count: 0,
                    cycle_time_p50: null,
                    cycle_time_p90: null,
                    authors_count: 0,
                    reviewers_count: 0,
                };
            }

            // Aggregate metrics
            const totalPrCount = selectedRepos.reduce((sum, r) => sum + (r.pr_count || 0), 0);
            const p50Values = selectedRepos.map(r => r.cycle_time_p50).filter(v => v != null);
            const p90Values = selectedRepos.map(r => r.cycle_time_p90).filter(v => v != null);

            const avgP50 = p50Values.length > 0
                ? p50Values.reduce((a, b) => a + b, 0) / p50Values.length
                : null;
            const avgP90 = p90Values.length > 0
                ? p90Values.reduce((a, b) => a + b, 0) / p90Values.length
                : null;

            const totalAuthors = selectedRepos.reduce((sum, r) => sum + (r.authors_count || 0), 0);
            const totalReviewers = selectedRepos.reduce((sum, r) => sum + (r.reviewers_count || 0), 0);

            return {
                ...rollup,
                pr_count: totalPrCount,
                cycle_time_p50: avgP50,
                cycle_time_p90: avgP90,
                authors_count: totalAuthors,
                reviewers_count: totalReviewers,
            } as Rollup;
        }

        // If we have by_team slices and team filter is active, use them
        if (filters.teams.length && rollup.by_team) {
            const selectedTeams = filters.teams
                .map(teamId => rollup.by_team![teamId])
                .filter(Boolean) as any[];

            if (selectedTeams.length === 0) {
                return {
                    ...rollup,
                    pr_count: 0,
                    cycle_time_p50: null,
                    cycle_time_p90: null,
                    authors_count: 0,
                    reviewers_count: 0,
                };
            }

            const totalPrCount = selectedTeams.reduce((sum, t) => sum + (t.pr_count || 0), 0);
            const p50Values = selectedTeams.map(t => t.cycle_time_p50).filter(v => v != null);
            const avgP50 = p50Values.length > 0
                ? p50Values.reduce((a, b) => a + b, 0) / p50Values.length
                : null;

            return {
                ...rollup,
                pr_count: totalPrCount,
                cycle_time_p50: avgP50,
            } as Rollup;
        }

        return rollup;
    });
}

/**
 * Refresh metrics for current date range.
 */
async function refreshMetrics(): Promise<void> {
    if (!currentDateRange.start || !currentDateRange.end || !loader) return;

    // Load current period data
    const rawRollups = await loader.getWeeklyRollups(
        currentDateRange.start,
        currentDateRange.end
    );

    const distributions = await loader.getDistributions(
        currentDateRange.start,
        currentDateRange.end
    );

    // Apply dimension filters to rollups
    const rollups = applyFiltersToRollups(rawRollups, currentFilters);

    // Load previous period data for comparison
    const prevPeriod = getPreviousPeriod(currentDateRange.start, currentDateRange.end);
    let prevRollups: Rollup[] = [];
    try {
        const rawPrevRollups = await loader.getWeeklyRollups(prevPeriod.start, prevPeriod.end);
        prevRollups = applyFiltersToRollups(rawPrevRollups, currentFilters);
    } catch (e) {
        console.debug('Previous period data not available:', e);
    }

    // Cache filtered rollups for export
    cachedRollups = rollups;

    renderSummaryCards(rollups, prevRollups);
    renderThroughputChart(rollups);
    renderCycleTimeTrend(rollups);
    renderReviewerActivity(rollups);
    renderCycleDistribution(distributions);

    // Update comparison banner if in comparison mode
    if (comparisonMode) {
        updateComparisonBanner();
    }
}

interface CalculatedMetrics {
    totalPrs: number;
    cycleP50: number | null;
    cycleP90: number | null;
    avgAuthors: number;
    avgReviewers: number;
}

/**
 * Calculate metrics from rollups data.
 */
function calculateMetrics(rollups: Rollup[]): CalculatedMetrics {
    if (!rollups || !rollups.length) {
        return { totalPrs: 0, cycleP50: null, cycleP90: null, avgAuthors: 0, avgReviewers: 0 };
    }

    const totalPrs = rollups.reduce((sum, r) => sum + (r.pr_count || 0), 0);

    const p50Values = rollups
        .map(r => r.cycle_time_p50)
        .filter((v): v is number => v !== null && v !== undefined);
    const p90Values = rollups
        .map(r => r.cycle_time_p90)
        .filter((v): v is number => v !== null && v !== undefined);

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
 */
function calculatePercentChange(current: number | null | undefined, previous: number | null | undefined): number | null {
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
 */
function renderDelta(element: HTMLElement | null, percentChange: number | null, inverse = false): void {
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
 */
function renderSparkline(element: HTMLElement | null, values: number[]): void {
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
    const areaD = pathD + ` L ${points[points.length - 1]!.x.toFixed(1)} ${height - padding} L ${points[0]!.x.toFixed(1)} ${height - padding} Z`;

    // Last point for dot
    const lastPoint = points[points.length - 1]!;

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
 */
function extractSparklineData(rollups: Rollup[]): { prCounts: number[]; p50s: number[]; p90s: number[]; authors: number[]; reviewers: number[] } {
    if (!rollups || !rollups.length) {
        return { prCounts: [], p50s: [], p90s: [], authors: [], reviewers: [] };
    }

    return {
        prCounts: rollups.map(r => r.pr_count || 0),
        p50s: rollups.map(r => r.cycle_time_p50).filter((v): v is number => v !== null && v !== undefined),
        p90s: rollups.map(r => r.cycle_time_p90).filter((v): v is number => v !== null && v !== undefined),
        authors: rollups.map(r => r.authors_count || 0),
        reviewers: rollups.map(r => r.reviewers_count || 0)
    };
}

/**
 * Render summary metric cards.
 */
function renderSummaryCards(rollups: Rollup[], prevRollups: Rollup[] = []): void {
    if (metricsCollector) metricsCollector.mark('render-summary-cards-start');

    const current = calculateMetrics(rollups);
    const previous = calculateMetrics(prevRollups);

    // Render metric values
    if (elements['total-prs']) elements['total-prs'].textContent = current.totalPrs.toLocaleString();
    if (elements['cycle-p50']) elements['cycle-p50'].textContent = current.cycleP50 !== null ? formatDuration(current.cycleP50) : '-';
    if (elements['cycle-p90']) elements['cycle-p90'].textContent = current.cycleP90 !== null ? formatDuration(current.cycleP90) : '-';
    if (elements['authors-count']) elements['authors-count'].textContent = current.avgAuthors.toLocaleString();
    if (elements['reviewers-count']) {
        elements['reviewers-count'].textContent = current.avgReviewers.toLocaleString();
    }

    // Render sparklines
    const sparklineData = extractSparklineData(rollups);
    renderSparkline(elements['total-prs-sparkline'], sparklineData.prCounts);
    renderSparkline(elements['cycle-p50-sparkline'], sparklineData.p50s);
    renderSparkline(elements['cycle-p90-sparkline'], sparklineData.p90s);
    renderSparkline(elements['authors-sparkline'], sparklineData.authors);
    renderSparkline(elements['reviewers-sparkline'], sparklineData.reviewers);

    // Render deltas (only if we have previous period data)
    if (prevRollups && prevRollups.length > 0) {
        renderDelta(elements['total-prs-delta'], calculatePercentChange(current.totalPrs, previous.totalPrs), false);
        renderDelta(elements['cycle-p50-delta'], calculatePercentChange(current.cycleP50, previous.cycleP50), true); // Inverse: lower is better
        renderDelta(elements['cycle-p90-delta'], calculatePercentChange(current.cycleP90, previous.cycleP90), true); // Inverse: lower is better
        renderDelta(elements['authors-delta'], calculatePercentChange(current.avgAuthors, previous.avgAuthors), false);
        renderDelta(elements['reviewers-delta'], calculatePercentChange(current.avgReviewers, previous.avgReviewers), false);
    } else {
        // Clear deltas if no previous data
        ['total-prs-delta', 'cycle-p50-delta', 'cycle-p90-delta', 'authors-delta', 'reviewers-delta'].forEach(id => {
            const el = elements[id];
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
 */
function calculateMovingAverage(values: number[], window = 4): (number | null)[] {
    const result: (number | null)[] = [];
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
function renderThroughputChart(rollups: Rollup[]): void {
    const chartEl = elements['throughput-chart'];
    if (!chartEl) return;

    if (!rollups || !rollups.length) {
        chartEl.innerHTML = '<p class="no-data">No data for selected range</p>';
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
            .filter((p): p is { val: number; i: number } => p.val !== null);

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

    chartEl.innerHTML = `
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
function renderCycleDistribution(distributions: any[]): void {
    const distEl = elements['cycle-distribution'];
    if (!distEl) return;

    if (!distributions || !distributions.length) {
        distEl.innerHTML = '<p class="no-data">No data for selected range</p>';
        return;
    }

    const buckets: Record<string, number> = { '0-1h': 0, '1-4h': 0, '4-24h': 0, '1-3d': 0, '3-7d': 0, '7d+': 0 };
    distributions.forEach(d => {
        Object.entries(d.cycle_time_buckets || {}).forEach(([key, val]) => {
            buckets[key] = (buckets[key] || 0) + (val as number);
        });
    });

    const total = Object.values(buckets).reduce((a, b) => a + b, 0);
    if (total === 0) {
        distEl.innerHTML = '<p class="no-data">No cycle time data</p>';
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

    distEl.innerHTML = html;
}

/**
 * Render cycle time trend chart (line chart with P50 and P90).
 */
function renderCycleTimeTrend(rollups: Rollup[]): void {
    const trendEl = elements['cycle-time-trend'];
    if (!trendEl) return;

    if (!rollups || rollups.length < 2) {
        trendEl.innerHTML = '<p class="no-data">Not enough data for trend</p>';
        return;
    }

    const p50Data = rollups.map(r => ({ week: r.week, value: r.cycle_time_p50 })).filter((d): d is { week: string; value: number } => d.value !== null);
    const p90Data = rollups.map(r => ({ week: r.week, value: r.cycle_time_p90 })).filter((d): d is { week: string; value: number } => d.value !== null);

    if (p50Data.length < 2 && p90Data.length < 2) {
        trendEl.innerHTML = '<p class="no-data">No cycle time data available</p>';
        return;
    }

    const allValues = [...p50Data.map(d => d.value), ...p90Data.map(d => d.value)];
    const maxVal = Math.max(...allValues);
    const minVal = Math.min(...allValues);
    const range = maxVal - minVal || 1;

    const width = 100;
    const height = 180;
    const padding = { top: 10, right: 10, bottom: 25, left: 40 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    // Generate paths
    const generatePath = (data: { week: string; value: number }[]) => {
        const points = data.map((d) => {
            const dataIndex = rollups.findIndex(r => r.week === d.week);
            const x = padding.left + (dataIndex / (rollups.length - 1)) * chartWidth;
            const y = padding.top + chartHeight - ((d.value - minVal) / range) * chartHeight;
            return { x, y, week: d.week, value: d.value };
        });
        const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
        return { pathD, points };
    };

    const p50Path = p50Data.length >= 2 ? generatePath(p50Data) : null;
    const p90Path = p90Data.length >= 2 ? generatePath(p90Data) : null;

    // Y-axis labels
    const yLabels = [minVal, (minVal + maxVal) / 2, maxVal];

    const svgContent = `
        <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">
            <!-- Grid lines -->
            ${yLabels.map((val, i) => {
        const y = padding.top + chartHeight - (i / (yLabels.length - 1)) * chartHeight;
        return `<line class="line-chart-grid" x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}"/>`;
    }).join('')}

            <!-- Y-axis labels -->
            ${yLabels.map((val, i) => {
        const y = padding.top + chartHeight - (i / (yLabels.length - 1)) * chartHeight;
        return `<text class="line-chart-axis" x="${padding.left - 4}" y="${y + 3}" text-anchor="end">${formatDuration(val)}</text>`;
    }).join('')}

            <!-- Lines -->
            ${p90Path ? `<path class="line-chart-p90" d="${p90Path.pathD}" vector-effect="non-scaling-stroke"/>` : ''}
            ${p50Path ? `<path class="line-chart-p50" d="${p50Path.pathD}" vector-effect="non-scaling-stroke"/>` : ''}

            <!-- Dots -->
            ${p90Path ? p90Path.points.map(p => `<circle class="line-chart-dot" cx="${p.x}" cy="${p.y}" r="3" fill="var(--warning)" data-week="${p.week}" data-value="${p.value}" data-metric="P90"/>`).join('') : ''}
            ${p50Path ? p50Path.points.map(p => `<circle class="line-chart-dot" cx="${p.x}" cy="${p.y}" r="3" fill="var(--primary)" data-week="${p.week}" data-value="${p.value}" data-metric="P50"/>`).join('') : ''}
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

    trendEl.innerHTML = `<div class="line-chart">${svgContent}</div>${legendHtml}`;

    // Add tooltip interactions
    addChartTooltips(trendEl, (dot: HTMLElement) => {
        const week = dot.dataset['week'];
        const value = parseFloat(dot.dataset['value'] || '0');
        const metric = dot.dataset['metric'];
        return `
            <div class="chart-tooltip-title">${week}</div>
            <div class="chart-tooltip-row">
                <span class="chart-tooltip-label">
                    <span class="chart-tooltip-dot ${metric === 'P50' ? 'legend-p50' : 'legend-p90'}"></span>
                    ${metric}
                </span>
                <span>${formatDuration(value)}</span>
            </div>
        `;
    });
}

/**
 * Render reviewer activity chart (horizontal bar chart).
 */
function renderReviewerActivity(rollups: Rollup[]): void {
    const revEl = elements['reviewer-activity'];
    if (!revEl) return;

    if (!rollups || !rollups.length) {
        revEl.innerHTML = '<p class="no-data">No reviewer data available</p>';
        return;
    }

    // Take last 8 weeks for display
    const recentRollups = rollups.slice(-8);
    const maxReviewers = Math.max(...recentRollups.map(r => r.reviewers_count || 0));

    if (maxReviewers === 0) {
        revEl.innerHTML = '<p class="no-data">No reviewer data available</p>';
        return;
    }

    const barsHtml = recentRollups.map(r => {
        const count = r.reviewers_count || 0;
        const pct = (count / maxReviewers) * 100;
        const weekLabel = r.week.split('-W')[1];
        return `
            <div class="h-bar-row" title="${r.week}: ${count} reviewers">
                <span class="h-bar-label">W${weekLabel}</span>
                <div class="h-bar-container">
                    <div class="h-bar" style="width: ${pct}%"></div>
                </div>
                <span class="h-bar-value">${count}</span>
            </div>
        `;
    }).join('');

    revEl.innerHTML = `<div class="horizontal-bar-chart">${barsHtml}</div>`;
}

/**
 * Add tooltip interactions to a chart.
 */
function addChartTooltips(container: HTMLElement, contentFn: (dot: HTMLElement) => string): void {
    const dots = container.querySelectorAll('.line-chart-dot');
    let tooltip: HTMLElement | null = null;

    dots.forEach(dotNode => {
        const dot = dotNode as HTMLElement;
        dot.addEventListener('mouseenter', () => {
            if (!tooltip) {
                tooltip = document.createElement('div');
                tooltip.className = 'chart-tooltip';
                container.appendChild(tooltip);
            }
            tooltip.innerHTML = contentFn(dot);
            tooltip.style.display = 'block';

            // Position tooltip
            const rect = container.getBoundingClientRect();
            const dotRect = dot.getBoundingClientRect();
            tooltip.style.left = `${dotRect.left - rect.left + 10}px`;
            tooltip.style.top = `${dotRect.top - rect.top - 40}px`;
        });

        dot.addEventListener('mouseleave', () => {
            if (tooltip) {
                tooltip.style.display = 'none';
            }
        });
    });
}

/**
 * Update feature tabs based on manifest.
 */
async function updateFeatureTabs(): Promise<void> {
    if (!loader) return;

    // Check if loader supports loadPredictions/loadInsights
    if (typeof (loader as any).loadPredictions !== 'function') return;

    const predictionsContent = document.getElementById('tab-predictions');
    const predictionsUnavailable = document.getElementById('predictions-unavailable');
    if (predictionsContent) {
        const predictionsResult = await (loader as any).loadPredictions();

        if (predictionsResult?.state === 'ok' && predictionsResult.data?.forecasts?.length > 0) {
            renderPredictions(predictionsContent, predictionsResult.data);
        } else if (predictionsUnavailable) {
            predictionsUnavailable.classList.remove('hidden');
        }
    }

    const aiContent = document.getElementById('tab-ai-insights');
    const aiUnavailable = document.getElementById('ai-unavailable');
    if (aiContent) {
        const insightsResult = await (loader as any).loadInsights();

        if (insightsResult?.state === 'ok' && insightsResult.data?.insights?.length > 0) {
            renderAIInsights(aiContent, insightsResult.data);
        } else if (aiUnavailable) {
            aiUnavailable.classList.remove('hidden');
        }
    }
}

/**
 * Render predictions.
 */
function renderPredictions(container: HTMLElement, predictions: any): void {
    const content = document.createElement('div');
    content.className = 'predictions-content';

    if (predictions.is_stub) {
        content.innerHTML += `<div class="stub-warning">⚠️ Demo data</div>`;
    }

    predictions.forecasts.forEach((forecast: any) => {
        const label = forecast.metric.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
        content.innerHTML += `
            <div class="forecast-section">
                <h4>${label} (${forecast.unit})</h4>
                <table class="forecast-table">
                    <thead><tr><th>Week</th><th>Predicted</th><th>Range</th></tr></thead>
                    <tbody>
                        ${forecast.values.map((v: any) => `
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
function renderAIInsights(container: HTMLElement, insights: any): void {
    const content = document.createElement('div');
    content.className = 'insights-content';

    if (insights.is_stub) {
        content.innerHTML += `<div class="stub-warning">⚠️ Demo data</div>`;
    }

    const icons: Record<string, string> = { critical: '🔴', warning: '🟡', info: '🔵' };
    ['critical', 'warning', 'info'].forEach(severity => {
        const items = insights.insights.filter((i: any) => i.severity === severity);
        if (!items.length) return;

        content.innerHTML += `
            <div class="severity-section">
                <h4>${icons[severity]} ${severity.charAt(0).toUpperCase() + severity.slice(1)}</h4>
                <div class="insight-cards">
                    ${items.map((i: any) => `
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

function handleDateRangeChange(e: Event): void {
    const target = e.target as HTMLSelectElement;
    const value = target.value;

    if (value === 'custom') {
        elements['custom-dates']?.classList.remove('hidden');
        return;
    }

    elements['custom-dates']?.classList.add('hidden');

    const days = parseInt(value, 10);
    const coverage = loader?.getCoverage() || null;
    const endDate = coverage?.date_range?.max ? new Date(coverage.date_range.max) : new Date();
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - days);

    currentDateRange = { start: startDate, end: endDate };
    updateUrlState();
    refreshMetrics();
}

function applyCustomDates(): void {
    const start = (elements['start-date'] as HTMLInputElement)?.value;
    const end = (elements['end-date'] as HTMLInputElement)?.value;

    if (!start || !end) return;

    currentDateRange = { start: new Date(start), end: new Date(end) };
    updateUrlState();
    refreshMetrics();
}

function switchTab(tabId: string): void {
    elements.tabs?.forEach((tab: HTMLElement) => {
        tab.classList.toggle('active', tab.dataset['tab'] === tabId);
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
 */
function populateFilterDropdowns(dimensions: any): void {
    if (!dimensions) return;

    // Populate repository filter
    const repoFilter = elements['repo-filter'] as HTMLSelectElement | null;
    if (repoFilter && dimensions.repositories?.length > 0) {
        repoFilter.innerHTML = '<option value="">All</option>';
        dimensions.repositories.forEach((repo: any) => {
            const option = document.createElement('option');
            option.value = repo.id || repo.name;
            option.textContent = repo.name;
            repoFilter.appendChild(option);
        });
        elements['repo-filter-group']?.classList.remove('hidden');
    } else {
        elements['repo-filter-group']?.classList.add('hidden');
    }

    // Populate team filter
    const teamFilter = elements['team-filter'] as HTMLSelectElement | null;
    if (teamFilter && dimensions.teams?.length > 0) {
        teamFilter.innerHTML = '<option value="">All</option>';
        dimensions.teams.forEach((team: any) => {
            const option = document.createElement('option');
            option.value = team.id || team.name;
            option.textContent = team.name;
            teamFilter.appendChild(option);
        });
        elements['team-filter-group']?.classList.remove('hidden');
    } else {
        elements['team-filter-group']?.classList.add('hidden');
    }

    // Restore filter state from URL
    restoreFiltersFromUrl();
}

/**
 * Handle filter dropdown change.
 */
function handleFilterChange(): void {
    const repoFilter = elements['repo-filter'] as HTMLSelectElement | null;
    const teamFilter = elements['team-filter'] as HTMLSelectElement | null;

    const repoValues = repoFilter
        ? Array.from(repoFilter.selectedOptions).map(o => o.value).filter(v => v)
        : [];
    const teamValues = teamFilter
        ? Array.from(teamFilter.selectedOptions).map(o => o.value).filter(v => v)
        : [];

    currentFilters = { repos: repoValues, teams: teamValues };

    updateFilterUI();
    updateUrlState();
    refreshMetrics();
}

/**
 * Clear all filters.
 */
function clearAllFilters(): void {
    currentFilters = { repos: [], teams: [] };

    const repoFilter = elements['repo-filter'] as HTMLSelectElement | null;
    const teamFilter = elements['team-filter'] as HTMLSelectElement | null;

    if (repoFilter) {
        Array.from(repoFilter.options).forEach(o => o.selected = o.value === '');
    }
    if (teamFilter) {
        Array.from(teamFilter.options).forEach(o => o.selected = o.value === '');
    }

    updateFilterUI();
    updateUrlState();
    refreshMetrics();
}

/**
 * Remove a specific filter.
 */
function removeFilter(type: string, value: string): void {
    if (type === 'repo') {
        currentFilters.repos = currentFilters.repos.filter(v => v !== value);
        const repoFilter = elements['repo-filter'] as HTMLSelectElement | null;
        if (repoFilter) {
            const option = repoFilter.querySelector(`option[value="${value}"]`) as HTMLOptionElement | null;
            if (option) option.selected = false;
        }
    } else if (type === 'team') {
        currentFilters.teams = currentFilters.teams.filter(v => v !== value);
        const teamFilter = elements['team-filter'] as HTMLSelectElement | null;
        if (teamFilter) {
            const option = teamFilter.querySelector(`option[value="${value}"]`) as HTMLOptionElement | null;
            if (option) option.selected = false;
        }
    }

    updateFilterUI();
    updateUrlState();
    refreshMetrics();
}

/**
 * Update filter UI.
 */
function updateFilterUI(): void {
    const hasFilters = currentFilters.repos.length > 0 || currentFilters.teams.length > 0;

    if (elements['clear-filters']) {
        elements['clear-filters'].classList.toggle('hidden', !hasFilters);
    }

    if (elements['active-filters'] && elements['filter-chips']) {
        elements['active-filters'].classList.toggle('hidden', !hasFilters);

        if (hasFilters) {
            renderFilterChips();
        } else {
            elements['filter-chips'].innerHTML = '';
        }
    }
}

/**
 * Render filter chips for active filters.
 */
function renderFilterChips(): void {
    const chipsEl = elements['filter-chips'] as HTMLElement | null;
    if (!chipsEl) return;

    const chips: string[] = [];

    currentFilters.repos.forEach(value => {
        const label = getFilterLabel('repo', value);
        chips.push(createFilterChip('repo', value, label));
    });

    currentFilters.teams.forEach(value => {
        const label = getFilterLabel('team', value);
        chips.push(createFilterChip('team', value, label));
    });

    chipsEl.innerHTML = chips.join('');

    chipsEl.querySelectorAll('.filter-chip-remove').forEach(btnNode => {
        const btn = btnNode as HTMLElement;
        btn.addEventListener('click', () => {
            const type = btn.dataset['type'];
            const val = btn.dataset['value'];
            if (type && val) removeFilter(type, val);
        });
    });
}

/**
 * Get display label for a filter value.
 */
function getFilterLabel(type: string, value: string): string {
    if (type === 'repo') {
        const repoFilter = elements['repo-filter'] as HTMLSelectElement | null;
        const option = repoFilter?.querySelector(`option[value="${value}"]`);
        return option?.textContent || value;
    }
    if (type === 'team') {
        const teamFilter = elements['team-filter'] as HTMLSelectElement | null;
        const option = teamFilter?.querySelector(`option[value="${value}"]`);
        return option?.textContent || value;
    }
    return value;
}

/**
 * Create HTML for a filter chip.
 */
function createFilterChip(type: string, value: string, label: string): string {
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
function restoreFiltersFromUrl(): void {
    const params = new URLSearchParams(window.location.search);

    const reposParam = params.get('repos');
    const teamsParam = params.get('teams');

    if (reposParam) {
        currentFilters.repos = reposParam.split(',').filter(v => v);
        const repoFilter = elements['repo-filter'] as HTMLSelectElement | null;
        if (repoFilter) {
            currentFilters.repos.forEach(value => {
                const option = repoFilter.querySelector(`option[value="${value}"]`) as HTMLOptionElement | null;
                if (option) option.selected = true;
            });
        }
    }

    if (teamsParam) {
        currentFilters.teams = teamsParam.split(',').filter(v => v);
        const teamFilter = elements['team-filter'] as HTMLSelectElement | null;
        if (teamFilter) {
            currentFilters.teams.forEach(value => {
                const option = teamFilter.querySelector(`option[value="${value}"]`) as HTMLOptionElement | null;
                if (option) option.selected = true;
            });
        }
    }

    updateFilterUI();
}

// ============================================================================
// Comparison Mode
// ============================================================================

/**
 * Toggle comparison mode on/off.
 */
function toggleComparisonMode(): void {
    comparisonMode = !comparisonMode;

    elements['compare-toggle']?.classList.toggle('active', comparisonMode);
    elements['comparison-banner']?.classList.toggle('hidden', !comparisonMode);

    if (comparisonMode) {
        updateComparisonBanner();
    }

    updateUrlState();
    refreshMetrics();
}

/**
 * Exit comparison mode.
 */
function exitComparisonMode(): void {
    comparisonMode = false;
    elements['compare-toggle']?.classList.remove('active');
    elements['comparison-banner']?.classList.add('hidden');
    updateUrlState();
    refreshMetrics();
}

/**
 * Update the comparison banner with date ranges.
 */
function updateComparisonBanner(): void {
    if (!currentDateRange.start || !currentDateRange.end) return;

    const formatDate = (date: Date) => date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    // Current period
    const currentStart = formatDate(currentDateRange.start);
    const currentEnd = formatDate(currentDateRange.end);
    if (elements['current-period-dates']) {
        elements['current-period-dates'].textContent = `${currentStart} - ${currentEnd}`;
    }

    // Previous period
    const prevPeriod = getPreviousPeriod(currentDateRange.start, currentDateRange.end);
    const prevStart = formatDate(prevPeriod.start);
    const prevEnd = formatDate(prevPeriod.end);
    if (elements['previous-period-dates']) {
        elements['previous-period-dates'].textContent = `${prevStart} - ${prevEnd}`;
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
    elements['export-menu']?.classList.toggle('hidden');
}

/**
 * Export current data to CSV.
 */
function exportToCsv(): void {
    elements['export-menu']?.classList.add('hidden');

    if (!cachedRollups || cachedRollups.length === 0) {
        showToast('No data to export', 'error');
        return;
    }

    // Build CSV content
    const headers = ['Week', 'Start Date', 'End Date', 'PR Count', 'Cycle Time P50 (min)', 'Cycle Time P90 (min)', 'Authors', 'Reviewers'];
    const rows = cachedRollups.map(r => [
        r.week,
        r.start_date || '',
        r.end_date || '',
        r.pr_count || 0,
        r.cycle_time_p50 != null ? r.cycle_time_p50.toFixed(1) : '',
        r.cycle_time_p90 != null ? r.cycle_time_p90.toFixed(1) : '',
        r.authors_count || 0,
        r.reviewers_count || 0
    ]);

    const csvContent = [headers, ...rows]
        .map(row => row.map(cell => `"${cell}"`).join(','))
        .join('\n');

    // Download file
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;

    const dateStr = new Date().toISOString().split('T')[0];
    link.download = `pr-insights-${dateStr}.csv`;

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showToast('CSV exported successfully', 'success');
}

/**
 * Copy shareable link to clipboard.
 */
async function copyShareableLink(): Promise<void> {
    elements['export-menu']?.classList.add('hidden');

    try {
        await navigator.clipboard.writeText(window.location.href);
        showToast('Link copied to clipboard', 'success');
    } catch (_err) {
        // Fallback
        const textArea = document.createElement('textarea');
        textArea.value = window.location.href;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        showToast('Link copied to clipboard', 'success');
    }
}

/**
 * Download raw CSV data as a ZIP file.
 */
async function downloadRawDataZip(): Promise<void> {
    elements['export-menu']?.classList.add('hidden');

    if (!currentBuildId || !artifactClient) {
        showToast('Raw data not available in direct URL mode', 'error');
        return;
    }

    try {
        showToast('Preparing download...', 'success');

        const artifact = await artifactClient.getArtifactMetadata(currentBuildId, 'csv-output');

        if (!artifact) {
            showToast('Raw CSV artifact not found in this pipeline run', 'error');
            return;
        }

        const downloadUrl = artifact.resource?.downloadUrl;
        if (!downloadUrl) {
            showToast('Download URL not available', 'error');
            return;
        }

        let zipUrl = downloadUrl;
        if (!zipUrl.includes('format=zip')) {
            const separator = zipUrl.includes('?') ? '&' : '?';
            zipUrl = `${zipUrl}${separator}format=zip`;
        }

        // Use the protected method from ArtifactClient
        const response = await (artifactClient as any)._authenticatedFetch(zipUrl);

        if (!response.ok) {
            if (response.status === 403 || response.status === 401) {
                showToast('Permission denied to download artifacts', 'error');
            } else {
                showToast(`Download failed: ${response.statusText}`, 'error');
            }
            return;
        }

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;

        const dateStr = new Date().toISOString().split('T')[0];
        link.download = `pr-insights-raw-data-${dateStr}.zip`;

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        showToast('Download started', 'success');
    } catch (err) {
        console.error('Failed to download raw data:', err);
        showToast('Failed to download raw data', 'error');
    }
}

/**
 * Show a toast notification.
 */
function showToast(message: string, type: 'success' | 'error' = 'success'): void {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 3000);
}

// ============================================================================
// Utility Functions
// ============================================================================

function showLoading(): void {
    hideAllPanels();
    elements['loading-state']?.classList.remove('hidden');
}

function showContent(): void {
    hideAllPanels();
    elements['main-content']?.classList.remove('hidden');
}

function updateDatasetInfo(manifest: any): void {
    const generatedAt = manifest?.generated_at
        ? new Date(manifest.generated_at).toLocaleString()
        : 'Unknown';
    const runId = manifest?.run_id || '';

    const runInfo = elements['run-info'];
    if (runInfo) {
        runInfo.textContent = `Generated: ${generatedAt}`;
        if (runId) runInfo.textContent += ` | Run: ${runId.slice(0, 8)}`;
    }
}

function formatDuration(minutes: number): string {
    if (minutes < 60) return `${Math.round(minutes)}m`;
    if (minutes < 1440) return `${(minutes / 60).toFixed(1)}h`;
    return `${(minutes / 1440).toFixed(1)}d`;
}

function median(arr: number[]): number {
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function updateUrlState(): void {
    const params = new URLSearchParams(window.location.search);
    const newParams = new URLSearchParams();

    // Preserve config params
    if (params.get('dataset')) newParams.set('dataset', params.get('dataset')!);
    if (params.get('pipelineId')) newParams.set('pipelineId', params.get('pipelineId')!);

    // Add date range
    if (currentDateRange.start) {
        newParams.set('start', currentDateRange.start.toISOString().split('T')[0]!);
    }
    if (currentDateRange.end) {
        newParams.set('end', currentDateRange.end.toISOString().split('T')[0]!);
    }

    // Add active tab
    const activeTab = document.querySelector('.tab.active') as HTMLElement | null;
    if (activeTab && activeTab.dataset['tab'] !== 'metrics') {
        newParams.set('tab', activeTab.dataset['tab']!);
    }

    // Add filters
    if (currentFilters.repos.length > 0) {
        newParams.set('repos', currentFilters.repos.join(','));
    }
    if (currentFilters.teams.length > 0) {
        newParams.set('teams', currentFilters.teams.join(','));
    }

    // Add comparison mode
    if (comparisonMode) {
        newParams.set('compare', '1');
    }

    window.history.replaceState({}, '', `${window.location.pathname}?${newParams.toString()}`);
}

function restoreStateFromUrl(): void {
    const params = new URLSearchParams(window.location.search);

    const startParam = params.get('start');
    const endParam = params.get('end');
    if (startParam && endParam) {
        currentDateRange = { start: new Date(startParam), end: new Date(endParam) };
        const dateRangeEl = elements['date-range'] as HTMLSelectElement | null;
        if (dateRangeEl) {
            dateRangeEl.value = 'custom';
            elements['custom-dates']?.classList.remove('hidden');
        }
        if (elements['start-date']) elements['start-date'].value = startParam;
        if (elements['end-date']) elements['end-date'].value = endParam;
    }

    const tabParam = params.get('tab');
    if (tabParam) {
        setTimeout(() => switchTab(tabParam), 0);
    }

    // Restore comparison mode
    const compareParam = params.get('compare');
    if (compareParam === '1') {
        comparisonMode = true;
        elements['compare-toggle']?.classList.add('active');
        elements['comparison-banner']?.classList.remove('hidden');
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
