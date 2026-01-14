/**
 * PR Insights Dashboard
 *
 * Dataset-driven UI - all data comes from dataset-manifest.json + aggregates.
 * No extension-only logic in the data layer.
 */

// Dashboard state
let loader = null;
let currentDateRange = { start: null, end: null };

// DOM element cache
const elements = {};

/**
 * Initialize the dashboard.
 */
async function init() {
    cacheElements();
    setupEventListeners();

    // Determine dataset base URL
    // In ADO extension context, this comes from build artifacts
    const baseUrl = getDatasetBaseUrl();
    loader = new DatasetLoader(baseUrl);

    await loadDataset();
}

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
    elements.dateRange.addEventListener('change', handleDateRangeChange);

    // Custom dates
    document.getElementById('apply-dates')?.addEventListener('click', applyCustomDates);

    // Tabs
    elements.tabs.forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // Retry button
    elements.retryBtn?.addEventListener('click', loadDataset);
}

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

        // Set initial date range from manifest defaults
        setInitialDateRange();

        // Load and render metrics
        await refreshMetrics();

        // Update feature tabs based on manifest
        updateFeatureTabs();

        showContent();

    } catch (error) {
        console.error('Failed to load dataset:', error);
        showError(error.message);
    }
}

/**
 * Set initial date range from manifest defaults.
 */
function setInitialDateRange() {
    const coverage = loader.getCoverage();
    const defaultDays = loader.getDefaultRangeDays();

    if (coverage?.date_range?.max) {
        const endDate = new Date(coverage.date_range.max);
        const startDate = new Date(endDate);
        startDate.setDate(startDate.getDate() - defaultDays);

        currentDateRange = { start: startDate, end: endDate };

        // Set date inputs
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
    if (!rollups.length) {
        elements.totalPrs.textContent = '0';
        elements.cycleP50.textContent = '-';
        elements.cycleP90.textContent = '-';
        elements.authorsCount.textContent = '0';
        return;
    }

    // Aggregate metrics
    const totalPrs = rollups.reduce((sum, r) => sum + r.pr_count, 0);
    const authorsSet = new Set();
    const p50Values = [];
    const p90Values = [];

    rollups.forEach(r => {
        if (r.cycle_time_p50 !== null) p50Values.push(r.cycle_time_p50);
        if (r.cycle_time_p90 !== null) p90Values.push(r.cycle_time_p90);
        // Note: We'd need per-author tracking for accurate unique count
    });

    elements.totalPrs.textContent = totalPrs.toLocaleString();
    elements.cycleP50.textContent = p50Values.length
        ? formatDuration(median(p50Values))
        : '-';
    elements.cycleP90.textContent = p90Values.length
        ? formatDuration(median(p90Values))
        : '-';

    // Sum unique authors (approximate from weekly counts)
    const authorsCount = rollups.reduce((sum, r) => sum + r.authors_count, 0);
    elements.authorsCount.textContent = Math.round(authorsCount / rollups.length).toLocaleString();
}

/**
 * Render throughput chart using simple bars.
 */
function renderThroughputChart(rollups) {
    if (!rollups.length) {
        elements.throughputChart.innerHTML = '<p class="no-data">No data for selected range</p>';
        return;
    }

    const maxCount = Math.max(...rollups.map(r => r.pr_count));

    const html = rollups.map(r => {
        const height = maxCount > 0 ? (r.pr_count / maxCount * 100) : 0;
        return `
            <div class="bar-container" title="${r.week}: ${r.pr_count} PRs">
                <div class="bar" style="height: ${height}%"></div>
                <div class="bar-label">${r.week.split('-W')[1]}</div>
            </div>
        `;
    }).join('');

    elements.throughputChart.innerHTML = `<div class="bar-chart">${html}</div>`;
}

/**
 * Render cycle time distribution chart.
 */
function renderCycleDistribution(distributions) {
    if (!distributions.length) {
        elements.cycleDistribution.innerHTML = '<p class="no-data">No data for selected range</p>';
        return;
    }

    // Merge buckets across years
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
 * Update feature tabs based on manifest flags.
 */
function updateFeatureTabs() {
    // Predictions tab
    const predictionsContent = document.getElementById('tab-predictions');
    if (!loader.isFeatureEnabled('ml')) {
        predictionsContent.querySelector('.feature-unavailable')?.classList.remove('hidden');
    }

    // AI Insights tab
    const aiContent = document.getElementById('tab-ai-insights');
    if (!loader.isFeatureEnabled('ai_insights')) {
        aiContent.querySelector('.feature-unavailable')?.classList.remove('hidden');
    }
}

/**
 * Handle date range dropdown change.
 */
function handleDateRangeChange(e) {
    const value = e.target.value;

    if (value === 'custom') {
        elements.customDates.classList.remove('hidden');
        return;
    }

    elements.customDates.classList.add('hidden');

    const days = parseInt(value, 10);
    const coverage = loader.getCoverage();
    const endDate = coverage?.date_range?.max
        ? new Date(coverage.date_range.max)
        : new Date();

    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - days);

    currentDateRange = { start: startDate, end: endDate };
    refreshMetrics();
}

/**
 * Apply custom date range.
 */
function applyCustomDates() {
    const start = elements.startDate.value;
    const end = elements.endDate.value;

    if (!start || !end) return;

    currentDateRange = {
        start: new Date(start),
        end: new Date(end)
    };

    refreshMetrics();
}

/**
 * Switch active tab.
 */
function switchTab(tabId) {
    // Update tab buttons
    elements.tabs.forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === tabId);
    });

    // Update content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('active', content.id === `tab-${tabId}`);
        content.classList.toggle('hidden', content.id !== `tab-${tabId}`);
    });
}

/**
 * Update dataset info display.
 */
function updateDatasetInfo(manifest) {
    const generatedAt = manifest.generated_at
        ? new Date(manifest.generated_at).toLocaleString()
        : 'Unknown';
    const runId = manifest.run_id || '';

    elements.runInfo.textContent = `Generated: ${generatedAt}`;
    if (runId) {
        elements.runInfo.textContent += ` | Run: ${runId.slice(0, 8)}`;
    }
}

/**
 * Get dataset base URL.
 * In extension context: from build artifacts.
 * For testing: use relative path or query param.
 */
function getDatasetBaseUrl() {
    // Check for URL parameter (for testing)
    const params = new URLSearchParams(window.location.search);
    if (params.has('dataset')) {
        return params.get('dataset');
    }

    // In ADO extension, this would come from the SDK
    // For now, return empty for same-directory loading
    return '';
}

// Utility functions

function showLoading() {
    elements.loadingState.classList.remove('hidden');
    elements.errorState.classList.add('hidden');
    elements.mainContent.classList.add('hidden');
}

function showContent() {
    elements.loadingState.classList.add('hidden');
    elements.errorState.classList.add('hidden');
    elements.mainContent.classList.remove('hidden');
}

function showError(message) {
    elements.loadingState.classList.add('hidden');
    elements.mainContent.classList.add('hidden');
    elements.errorState.classList.remove('hidden');
    elements.errorMessage.textContent = message;
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

// Initialize on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
