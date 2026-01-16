/**
 * PR Insights Settings Page
 *
 * Allows users to configure:
 * - Source project (for cross-project access)
 * - Pipeline definition ID
 *
 * Settings are user-scoped (not project-scoped) for privacy.
 *
 * Project selection uses graceful degradation:
 * - Shows dropdown when vso.project scope allows listing projects
 * - Falls back to text input when listing isn't available
 */

// Settings keys (must match dashboard.js)
const SETTINGS_KEY_PROJECT = 'pr-insights-source-project';
const SETTINGS_KEY_PIPELINE = 'pr-insights-pipeline-id';

// State
let dataService = null;
let projectDropdownAvailable = false;
let projectList = [];

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

        // Set current project as placeholder
        const webContext = VSS.getWebContext();
        const projectInput = document.getElementById('project-id');
        if (projectInput && webContext?.project?.name) {
            projectInput.placeholder = `Current: ${webContext.project.name}`;
        }

        // Try to load project dropdown
        await tryLoadProjectDropdown();

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
 * Try to load project dropdown. Degrades gracefully to text input.
 */
async function tryLoadProjectDropdown() {
    const dropdown = document.getElementById('project-select');
    const textInput = document.getElementById('project-id');

    try {
        // Get projects using Core REST client
        const projects = await getOrganizationProjects();

        if (projects && projects.length > 0) {
            projectList = projects;
            projectDropdownAvailable = true;

            // Populate dropdown
            dropdown.innerHTML = '<option value="">Current project (auto)</option>';
            for (const project of projects.sort((a, b) => a.name.localeCompare(b.name))) {
                const option = document.createElement('option');
                option.value = project.id;
                option.textContent = `${project.name} (${project.id.substring(0, 8)}...)`;
                dropdown.appendChild(option);
            }

            // Show dropdown, hide text input
            dropdown.style.display = 'block';
            textInput.style.display = 'none';

            console.log(`Loaded ${projects.length} projects for dropdown`);
        } else {
            throw new Error('No projects returned');
        }
    } catch (error) {
        console.log('Project dropdown unavailable, using text input:', error.message);
        projectDropdownAvailable = false;

        // Show text input, hide dropdown
        dropdown.style.display = 'none';
        textInput.style.display = 'block';
    }
}

/**
 * Get list of projects in the organization.
 * Requires vso.project scope.
 */
async function getOrganizationProjects() {
    return new Promise((resolve, reject) => {
        VSS.require(['TFS/Core/RestClient'], async (CoreRestClient) => {
            try {
                const client = CoreRestClient.getClient();
                const projects = await client.getProjects();
                resolve(projects || []);
            } catch (error) {
                reject(error);
            }
        });
    });
}

/**
 * Load saved settings into form.
 */
async function loadSettings() {
    try {
        const savedProjectId = await dataService.getValue(SETTINGS_KEY_PROJECT, { scopeType: 'User' });
        const savedPipelineId = await dataService.getValue(SETTINGS_KEY_PIPELINE, { scopeType: 'User' });

        // Set project
        if (savedProjectId) {
            if (projectDropdownAvailable) {
                document.getElementById('project-select').value = savedProjectId;
            } else {
                document.getElementById('project-id').value = savedProjectId;
            }
        }

        // Set pipeline ID
        const pipelineInput = document.getElementById('pipeline-id');
        if (pipelineInput && savedPipelineId) {
            pipelineInput.value = savedPipelineId;
        }
    } catch (error) {
        console.log('No saved settings found:', error);
    }
}

/**
 * Get the selected project ID from either dropdown or text input.
 */
function getSelectedProjectId() {
    if (projectDropdownAvailable) {
        return document.getElementById('project-select').value || null;
    } else {
        const value = document.getElementById('project-id').value.trim();
        return value || null;
    }
}

/**
 * Save settings from form.
 */
async function saveSettings() {
    const projectId = getSelectedProjectId();
    const pipelineInput = document.getElementById('pipeline-id');
    const pipelineValue = pipelineInput?.value?.trim();

    try {
        // Save project ID
        await dataService.setValue(SETTINGS_KEY_PROJECT, projectId, { scopeType: 'User' });

        // Save pipeline ID
        if (pipelineValue) {
            const pipelineId = parseInt(pipelineValue, 10);
            if (isNaN(pipelineId) || pipelineId <= 0) {
                showStatus('Pipeline ID must be a positive integer', 'error');
                return;
            }
            await dataService.setValue(SETTINGS_KEY_PIPELINE, pipelineId, { scopeType: 'User' });
        } else {
            await dataService.setValue(SETTINGS_KEY_PIPELINE, null, { scopeType: 'User' });
        }

        showStatus('Settings saved successfully', 'success');

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
    // Clear form
    if (projectDropdownAvailable) {
        document.getElementById('project-select').value = '';
    } else {
        document.getElementById('project-id').value = '';
    }
    document.getElementById('pipeline-id').value = '';

    try {
        await dataService.setValue(SETTINGS_KEY_PROJECT, null, { scopeType: 'User' });
        await dataService.setValue(SETTINGS_KEY_PIPELINE, null, { scopeType: 'User' });
        showStatus('Settings cleared - using current project with auto-discovery', 'success');
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
        const savedProjectId = await dataService.getValue(SETTINGS_KEY_PROJECT, { scopeType: 'User' });
        const savedPipelineId = await dataService.getValue(SETTINGS_KEY_PIPELINE, { scopeType: 'User' });
        const webContext = VSS.getWebContext();
        const currentProjectName = webContext?.project?.name || 'Unknown';

        let html = '';

        // Current context
        html += `<p><strong>Current Project:</strong> ${escapeHtml(currentProjectName)}</p>`;

        // Source project configuration
        if (savedProjectId) {
            const projectName = getProjectNameById(savedProjectId);
            html += `<p><strong>Source Project:</strong> ${escapeHtml(projectName)} <code>${savedProjectId.substring(0, 8)}...</code></p>`;
        } else {
            html += `<p><strong>Source Project:</strong> <em>Same as current</em></p>`;
        }

        // Pipeline configuration
        if (savedPipelineId) {
            html += `<p><strong>Pipeline Definition ID:</strong> ${savedPipelineId}</p>`;
        } else {
            html += `<p><strong>Mode:</strong> Auto-discovery</p>`;
            html += `<p class="status-hint">The dashboard will automatically find pipelines with an "aggregates" artifact.</p>`;
        }

        // Dropdown availability
        if (projectDropdownAvailable) {
            html += `<p class="status-hint">✓ Project dropdown available (${projectList.length} projects)</p>`;
        } else {
            html += `<p class="status-hint">Project dropdown not available - using text input</p>`;
        }

        statusDisplay.innerHTML = html;

    } catch (error) {
        statusDisplay.innerHTML = `<p class="status-error">Failed to load status: ${escapeHtml(error.message)}</p>`;
    }
}

/**
 * Get project name by ID from the cached list.
 */
function getProjectNameById(projectId) {
    const project = projectList.find(p => p.id === projectId);
    return project?.name || projectId;
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
    document.getElementById('project-id')?.addEventListener('keypress', (e) => {
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
