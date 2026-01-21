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
declare const SETTINGS_KEY_PROJECT = "pr-insights-source-project";
declare const SETTINGS_KEY_PIPELINE = "pr-insights-pipeline-id";
declare let dataService: IExtensionDataService | null;
declare let projectDropdownAvailable: boolean;
declare let projectList: any[];
/**
 * Initialize Azure DevOps Extension SDK.
 */
declare function initializeAdoSdk(): Promise<void>;
/**
 * Initialize the settings page.
 */
declare function init(): Promise<void>;
/**
 * Try to load project dropdown. Degrades gracefully to text input.
 */
declare function tryLoadProjectDropdown(): Promise<void>;
/**
 * Get list of projects in the organization.
 * Requires vso.project scope.
 */
declare function getOrganizationProjects(): Promise<any[]>;
/**
 * Load saved settings into form.
 */
declare function loadSettings(): Promise<void>;
/**
 * Get the selected project ID from either dropdown or text input.
 */
declare function getSelectedProjectId(): string | null;
/**
 * Save settings from form.
 */
declare function saveSettings(): Promise<void>;
/**
 * Clear settings.
 */
declare function clearSettings(): Promise<void>;
/**
 * Update the status display with current configuration.
 */
declare function updateStatus(): Promise<void>;
/**
 * Get project name by ID from the cached list.
 */
declare function getProjectNameById(projectId: string): string;
/**
 * Validate if a pipeline exists and has successful builds with aggregates artifact.
 * Returns validation result with details.
 */
declare function validatePipeline(pipelineId: number, projectId: string): Promise<{
    valid: boolean;
    name?: string;
    buildId?: number;
    error?: string;
}>;
/**
 * Discover pipelines with aggregates artifact in the current project.
 */
declare function discoverPipelines(): Promise<Array<{
    id: number;
    name: string;
    buildId: number;
}>>;
/**
 * Run auto-discovery and show results to user.
 */
declare function runDiscovery(): Promise<void>;
/**
 * Show status message.
 */
declare function showStatus(message: string, type?: string): void;
/**
 * Escape HTML to prevent XSS.
 */
declare function escapeHtml(text: string): string;
/**
 * Set up event listeners.
 */
declare function setupEventListeners(): void;
