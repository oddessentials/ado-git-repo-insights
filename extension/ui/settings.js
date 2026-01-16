/**
 * PR Insights Settings Page
 *
 * Allows users to configure a preferred pipeline ID for the PR Insights dashboard.
 * Settings are user-scoped (not project-scoped) for privacy.
 */

// Settings key (must match dashboard.js)
const SETTINGS_KEY = 'pr-insights-pipeline-id';

// State
let dataService = null;
let artifactClient = null;

/**
 * Initialize Azure DevOps Extension SDK.
 */
async function initializeAdoSdk() {
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
            VSS.notifyLoadSucceeded();
            resolve();
        });
    });
}

/**
 * Initialize the settings page.
 */
async function init() {
    try {
        await initializeAdoSdk();

        // Get extension data service
        dataService = await VSS.getService(VSS.ServiceIds.ExtensionData);

        // Load saved settings
        await loadSettings();

        // Update status display
        await updateStatus();

        // Set up event listeners
        setupEventListeners();

    } catch (error) {
        console.error('Settings initialization failed:', error);
        showStatus('Failed to initialize settings: ' + error.message, 'error');
    }
}

/**
 * Load saved settings into form.
 */
async function loadSettings() {
    try {
        const savedPipelineId = await dataService.getValue(SETTINGS_KEY, { scopeType: 'User' });

        const input = document.getElementById('pipeline-id');
        if (input && savedPipelineId) {
            input.value = savedPipelineId;
        }
    } catch (error) {
        console.log('No saved settings found:', error);
    }
}

/**
 * Save settings from form.
 */
async function saveSettings() {
    const input = document.getElementById('pipeline-id');
    const value = input?.value?.trim();

    try {
        if (value) {
            const pipelineId = parseInt(value, 10);
            if (isNaN(pipelineId) || pipelineId <= 0) {
                showStatus('Pipeline ID must be a positive integer', 'error');
                return;
            }

            await dataService.setValue(SETTINGS_KEY, pipelineId, { scopeType: 'User' });
            showStatus('Settings saved successfully', 'success');
        } else {
            // Clear setting
            await dataService.setValue(SETTINGS_KEY, null, { scopeType: 'User' });
            showStatus('Settings cleared - auto-discovery enabled', 'success');
        }

        // Update status display
        await updateStatus();

    } catch (error) {
        console.error('Failed to save settings:', error);
        showStatus('Failed to save settings: ' + error.message, 'error');
    }
}

/**
 * Clear settings.
 */
async function clearSettings() {
    const input = document.getElementById('pipeline-id');
    if (input) input.value = '';

    try {
        await dataService.setValue(SETTINGS_KEY, null, { scopeType: 'User' });
        showStatus('Settings cleared', 'success');
        await updateStatus();
    } catch (error) {
        console.error('Failed to clear settings:', error);
        showStatus('Failed to clear settings: ' + error.message, 'error');
    }
}

/**
 * Update the status display with current configuration.
 */
async function updateStatus() {
    const statusDisplay = document.getElementById('status-display');
    if (!statusDisplay) return;

    try {
        const savedPipelineId = await dataService.getValue(SETTINGS_KEY, { scopeType: 'User' });
        const webContext = VSS.getWebContext();
        const projectName = webContext?.project?.name || 'Unknown';

        let html = `<p><strong>Project:</strong> ${escapeHtml(projectName)}</p>`;

        if (savedPipelineId) {
            html += `<p><strong>Configured Pipeline ID:</strong> ${savedPipelineId}</p>`;

            // Try to get pipeline name
            try {
                const pipelineName = await getPipelineName(savedPipelineId);
                if (pipelineName) {
                    html += `<p><strong>Pipeline Name:</strong> ${escapeHtml(pipelineName)}</p>`;
                }
            } catch (e) {
                html += `<p class="status-warning">Could not verify pipeline (ID: ${savedPipelineId})</p>`;
            }
        } else {
            html += `<p><strong>Mode:</strong> Auto-discovery</p>`;
            html += `<p class="status-hint">The dashboard will automatically find pipelines with an "aggregates" artifact.</p>`;
        }

        statusDisplay.innerHTML = html;

    } catch (error) {
        statusDisplay.innerHTML = `<p class="status-error">Failed to load status: ${escapeHtml(error.message)}</p>`;
    }
}

/**
 * Get pipeline name by ID.
 */
async function getPipelineName(pipelineId) {
    return new Promise((resolve, reject) => {
        VSS.require(['TFS/Build/RestClient'], async (BuildRestClient) => {
            try {
                const client = BuildRestClient.getClient();
                const webContext = VSS.getWebContext();
                // queryOrder (5th param): 2 = definitionNameAscending (required by Azure DevOps API)
                const definitions = await client.getDefinitions(
                    webContext.project.id,
                    null, null, null,
                    2,    // queryOrder: definitionNameAscending
                    null, null, null,
                    [pipelineId]
                );

                if (definitions && definitions.length > 0) {
                    resolve(definitions[0].name);
                } else {
                    resolve(null);
                }
            } catch (e) {
                reject(e);
            }
        });
    });
}

/**
 * Show status message.
 */
function showStatus(message, type = 'info') {
    const statusEl = document.getElementById('status-message');
    if (!statusEl) return;

    statusEl.textContent = message;
    statusEl.className = `status-message status-${type}`;

    // Clear after delay
    setTimeout(() => {
        statusEl.textContent = '';
        statusEl.className = 'status-message';
    }, 5000);
}

/**
 * Escape HTML to prevent XSS.
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Set up event listeners.
 */
function setupEventListeners() {
    document.getElementById('save-btn')?.addEventListener('click', saveSettings);
    document.getElementById('clear-btn')?.addEventListener('click', clearSettings);

    // Enter key saves
    document.getElementById('pipeline-id')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            saveSettings();
        }
    });
}

// Initialize on load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
