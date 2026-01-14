/**
 * ADO Extension SDK Mock (Phase 4)
 *
 * Provides deterministic mocks for Azure DevOps Extension SDK
 * authentication flow and Build Artifacts API responses.
 */

/**
 * Create a mock VSS SDK context.
 * @param {Object} options
 * @param {string} options.accessToken - Mock access token
 * @param {Object} options.webContext - Mock web context
 * @returns {Object} Mock VSS SDK
 */
function createSdkMock(options = {}) {
    const {
        accessToken = 'mock-access-token-12345',
        webContext = {
            account: { name: 'test-org' },
            project: { name: 'test-project', id: 'proj-123' },
            user: { name: 'Test User', id: 'user-123' },
        },
    } = options;

    return {
        getWebContext: () => webContext,
        getAccessToken: () => Promise.resolve({ token: accessToken }),
        getConfiguration: () => ({
            witInputs: {},
        }),
        notifyLoadSucceeded: () => { },
        notifyLoadFailed: (error) => console.error('SDK Load Failed:', error),
        resize: () => { },
    };
}

/**
 * Mock responses for Build Artifacts API scenarios.
 */
const BuildApiScenarios = {
    // No pipeline runs exist
    NO_RUNS: {
        runs: [],
        error: null,
    },

    // Successful runs but no artifacts published
    NO_ARTIFACTS: {
        runs: [
            {
                id: 1001,
                buildNumber: '20260114.1',
                result: 'succeeded',
                finishTime: '2026-01-14T12:00:00Z',
            },
        ],
        artifacts: [],
        error: null,
    },

    // Permission denied (401/403)
    PERMISSION_DENIED: {
        runs: null,
        error: { status: 403, message: 'Access denied' },
    },

    // Not found (404)
    NOT_FOUND: {
        runs: null,
        error: { status: 404, message: 'Pipeline not found' },
    },

    // Transient server error (5xx)
    TRANSIENT_ERROR: {
        runs: null,
        error: { status: 503, message: 'Service temporarily unavailable' },
    },

    // Successful with artifacts
    SUCCESS: {
        runs: [
            {
                id: 1001,
                buildNumber: '20260114.1',
                result: 'succeeded',
                finishTime: '2026-01-14T12:00:00Z',
            },
        ],
        artifacts: [
            {
                id: 1,
                name: 'insights-output',
                resource: {
                    type: 'container',
                    data: '#/1/insights-output',
                    downloadUrl: 'https://dev.azure.com/_apis/build/artifacts/1',
                },
            },
        ],
        error: null,
    },
};

/**
 * Create a mock Build Artifacts API client.
 * @param {string} scenario - One of BuildApiScenarios keys
 * @returns {Object} Mock API client
 */
function createBuildApiMock(scenario = 'SUCCESS') {
    const scenarioData = BuildApiScenarios[scenario] || BuildApiScenarios.SUCCESS;

    return {
        getBuilds: async () => {
            if (scenarioData.error) {
                const err = new Error(scenarioData.error.message);
                err.status = scenarioData.error.status;
                throw err;
            }
            return scenarioData.runs;
        },

        getArtifacts: async () => {
            if (scenarioData.error) {
                const err = new Error(scenarioData.error.message);
                err.status = scenarioData.error.status;
                throw err;
            }
            return scenarioData.artifacts || [];
        },

        getArtifactContentUrl: (artifactName, relativePath) => {
            return `https://mock.dev.azure.com/_apis/build/artifacts/${artifactName}/${relativePath}`;
        },
    };
}

/**
 * Install SDK mocks on global/window object.
 * Call in test setup to enable SDK mocking.
 */
function installSdkMocks(options = {}) {
    const sdk = createSdkMock(options);

    if (typeof window !== 'undefined') {
        window.VSS = sdk;
    }
    if (typeof global !== 'undefined') {
        global.VSS = sdk;
    }

    return sdk;
}

module.exports = {
    createSdkMock,
    createBuildApiMock,
    installSdkMocks,
    BuildApiScenarios,
};
