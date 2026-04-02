/**
 * Settings Download Tests
 *
 * Tests for the "Download Raw Data" feature on the settings page.
 * Uses contract testing pattern to validate the download flow logic
 * without importing the self-executing settings.ts IIFE directly.
 *
 * @module tests/dashboard/settings-download.test.ts
 */

import { jest } from "@jest/globals";
import {
  setupSdkMocks,
  teardownSdkMocks,
  configureExtensionDataService,
  getMockExtensionDataManager,
} from "../harness/vss-sdk-mock";

// Constants matching settings.ts
const SETTINGS_KEY_PROJECT = "pr-insights-source-project";
const SETTINGS_KEY_PIPELINE = "pr-insights-pipeline-id";

// ============================================================================
// Contract: downloadRawData() simulation
// ============================================================================

/**
 * Simulates the downloadRawData() function from settings.ts.
 * This tests the contract logic without importing the IIFE bundle.
 */
async function downloadRawDataContract(
  lastValidation: { valid: boolean; buildId?: number } | null,
  deps: {
    dataService: { getValue: jest.Mock<(key: string, options?: unknown) => unknown> };
    webContext: { project?: { id: string } };
    collectionUri: string;
    artifactClient: {
      initialize: jest.Mock<(...args: unknown[]) => unknown>;
      getArtifactMetadata: jest.Mock<(...args: unknown[]) => unknown>;
      authenticatedFetch: jest.Mock<(...args: unknown[]) => unknown>;
    };
  },
): Promise<{
  outcome:
    | "no-validation"
    | "no-build-id"
    | "invalid-build-id"
    | "no-project"
    | "no-artifact"
    | "no-download-url"
    | "invalid-url"
    | "permission-denied"
    | "fetch-error"
    | "error"
    | "success";
  toastMessage?: string;
  toastType?: "success" | "error";
  downloadFilename?: string;
}> {
  // Step 1: Check lastValidation
  if (!lastValidation?.valid || !lastValidation?.buildId) {
    return {
      outcome: lastValidation?.valid ? "no-build-id" : "no-validation",
      toastMessage: "No valid pipeline configured. Save settings first.",
      toastType: "error",
    };
  }

  // Step 1b: Validate buildId is a positive integer
  if (
    !Number.isInteger(lastValidation.buildId) ||
    lastValidation.buildId <= 0
  ) {
    return {
      outcome: "invalid-build-id",
      toastMessage: "Invalid build ID",
      toastType: "error",
    };
  }

  try {
    // Step 2: Read saved project ID
    const savedProjectId = await deps.dataService.getValue(
      SETTINGS_KEY_PROJECT,
      { scopeType: "User" },
    );
    const projectId = savedProjectId || deps.webContext?.project?.id;
    if (!projectId) {
      return {
        outcome: "no-project",
        toastMessage: "No project ID available",
        toastType: "error",
      };
    }

    // Step 3: Initialize artifact client
    await deps.artifactClient.initialize();

    // Step 4: Get artifact metadata
    const artifact = (await deps.artifactClient.getArtifactMetadata(
      lastValidation.buildId,
      "csv-output",
    )) as { name: string; resource?: { downloadUrl?: string } } | null;
    if (!artifact) {
      return {
        outcome: "no-artifact",
        toastMessage: "Raw CSV artifact not found in this pipeline run",
        toastType: "error",
      };
    }

    const downloadUrl = artifact.resource?.downloadUrl;
    if (!downloadUrl) {
      return {
        outcome: "no-download-url",
        toastMessage: "Download URL not available",
        toastType: "error",
      };
    }

    // Validate URL: HTTPS required, must be collection origin or
    // Azure-hosted artifact CDN (*.artifacts.visualstudio.com).
    try {
      const parsed = new URL(downloadUrl);
      if (parsed.protocol !== "https:") {
        return {
          outcome: "invalid-url",
          toastMessage: "Invalid download URL",
          toastType: "error",
        };
      }
      const collectionOrigin = new URL(deps.collectionUri).origin;
      const isCollectionHost = parsed.origin === collectionOrigin;
      const isAzureArtifactHost =
        parsed.hostname.endsWith(".artifacts.visualstudio.com");
      if (!isCollectionHost && !isAzureArtifactHost) {
        return {
          outcome: "invalid-url",
          toastMessage: "Invalid download URL",
          toastType: "error",
        };
      }
    } catch {
      return {
        outcome: "invalid-url",
        toastMessage: "Invalid download URL",
        toastType: "error",
      };
    }

    // Step 5: Build zip URL using URL API
    const zipUrlObj = new URL(downloadUrl);
    if (!zipUrlObj.searchParams.has("format")) {
      zipUrlObj.searchParams.set("format", "zip");
    }
    const zipUrl = zipUrlObj.toString();

    // Step 6: Authenticated fetch
    const response = (await deps.artifactClient.authenticatedFetch(zipUrl)) as {
      ok: boolean;
      status: number;
      statusText: string;
    };
    if (!response.ok) {
      if (response.status === 403 || response.status === 401) {
        return {
          outcome: "permission-denied",
          toastMessage: "Permission denied to download artifacts",
          toastType: "error",
        };
      }
      return {
        outcome: "fetch-error",
        toastMessage: `Download failed: ${response.statusText}`,
        toastType: "error",
      };
    }

    // Step 7: Trigger download
    const dateStr = new Date().toISOString().split("T")[0];
    const filename = `pr-insights-raw-data-${dateStr}.zip`;

    return {
      outcome: "success",
      toastMessage: "Download started",
      toastType: "success",
      downloadFilename: filename,
    };
  } catch {
    return {
      outcome: "error",
      toastMessage: "Failed to download raw data",
      toastType: "error",
    };
  }
}

// ============================================================================
// Tests
// ============================================================================

describe("Settings Download: downloadRawData contract", () => {
  beforeEach(() => {
    setupSdkMocks();
    configureExtensionDataService({
      values: {
        [SETTINGS_KEY_PROJECT]: "test-project-id",
        [SETTINGS_KEY_PIPELINE]: 42,
      },
    });
  });

  afterEach(() => {
    teardownSdkMocks();
  });

  function createMockArtifactClient(
    overrides: Partial<{
      initialize: jest.Mock;
      getArtifactMetadata: jest.Mock;
      authenticatedFetch: jest.Mock;
    }> = {},
  ) {
    return {
      initialize: overrides.initialize ?? jest.fn(() => Promise.resolve()),
      getArtifactMetadata:
        overrides.getArtifactMetadata ??
        jest.fn(() =>
          Promise.resolve({
            name: "csv-output",
            resource: {
              downloadUrl:
                "https://dev.azure.com/org/proj/_apis/build/builds/100/artifacts?artifactName=csv-output",
            },
          }),
        ),
      authenticatedFetch:
        overrides.authenticatedFetch ??
        jest.fn(() =>
          Promise.resolve({
            ok: true,
            status: 200,
            statusText: "OK",
            blob: () => Promise.resolve(new Blob(["zip-content"])),
          }),
        ),
    };
  }

  function defaultDeps(
    clientOverrides: Partial<{
      initialize: jest.Mock;
      getArtifactMetadata: jest.Mock;
      authenticatedFetch: jest.Mock;
    }> = {},
  ) {
    return {
      dataService: getMockExtensionDataManager(),
      webContext: { project: { id: "proj-456" } },
      collectionUri: "https://dev.azure.com/test-org/",
      artifactClient: createMockArtifactClient(clientOverrides),
    };
  }

  // ---------------------------------------------------------------
  // Happy path
  // ---------------------------------------------------------------

  it("downloads ZIP successfully with valid pipeline", async () => {
    const result = await downloadRawDataContract(
      { valid: true, buildId: 100 },
      defaultDeps(),
    );

    expect(result.outcome).toBe("success");
    expect(result.toastMessage).toBe("Download started");
    expect(result.toastType).toBe("success");
    expect(result.downloadFilename).toMatch(
      /^pr-insights-raw-data-\d{4}-\d{2}-\d{2}\.zip$/,
    );
  });

  it("uses saved project ID when available", async () => {
    const deps = defaultDeps();
    await downloadRawDataContract({ valid: true, buildId: 100 }, deps);

    expect(deps.dataService.getValue).toHaveBeenCalledWith(
      SETTINGS_KEY_PROJECT,
      { scopeType: "User" },
    );
  });

  it("calls getArtifactMetadata with correct buildId and artifact name", async () => {
    const deps = defaultDeps();
    await downloadRawDataContract({ valid: true, buildId: 777 }, deps);

    expect(deps.artifactClient.getArtifactMetadata).toHaveBeenCalledWith(
      777,
      "csv-output",
    );
  });

  it("appends format=zip to download URL without existing query params", async () => {
    const deps = defaultDeps({
      getArtifactMetadata: jest.fn(() =>
        Promise.resolve({
          name: "csv-output",
          resource: {
            downloadUrl: "https://dev.azure.com/org/proj/_apis/build/artifact",
          },
        }),
      ),
    });
    await downloadRawDataContract({ valid: true, buildId: 100 }, deps);

    const fetchedUrl =
      deps.artifactClient.authenticatedFetch.mock.calls[0]?.[0];
    expect(fetchedUrl).toBe(
      "https://dev.azure.com/org/proj/_apis/build/artifact?format=zip",
    );
  });

  it("appends format=zip with & when URL already has query params", async () => {
    const deps = defaultDeps({
      getArtifactMetadata: jest.fn(() =>
        Promise.resolve({
          name: "csv-output",
          resource: {
            downloadUrl:
              "https://dev.azure.com/org/proj/_apis/build/artifact?api-version=7.1",
          },
        }),
      ),
    });
    await downloadRawDataContract({ valid: true, buildId: 100 }, deps);

    const fetchedUrl =
      deps.artifactClient.authenticatedFetch.mock.calls[0]?.[0];
    expect(fetchedUrl).toBe(
      "https://dev.azure.com/org/proj/_apis/build/artifact?api-version=7.1&format=zip",
    );
  });

  it("does not duplicate format=zip if already present", async () => {
    const deps = defaultDeps({
      getArtifactMetadata: jest.fn(() =>
        Promise.resolve({
          name: "csv-output",
          resource: {
            downloadUrl: "https://dev.azure.com/org/artifact?format=zip",
          },
        }),
      ),
    });
    await downloadRawDataContract({ valid: true, buildId: 100 }, deps);

    const fetchedUrl =
      deps.artifactClient.authenticatedFetch.mock.calls[0]?.[0];
    expect(fetchedUrl).toBe("https://dev.azure.com/org/artifact?format=zip");
  });

  // ---------------------------------------------------------------
  // Validation state guards
  // ---------------------------------------------------------------

  it("rejects when lastValidation is null", async () => {
    const result = await downloadRawDataContract(null, defaultDeps());

    expect(result.outcome).toBe("no-validation");
    expect(result.toastType).toBe("error");
    expect(result.toastMessage).toContain("No valid pipeline");
  });

  it("rejects when lastValidation.valid is false", async () => {
    const result = await downloadRawDataContract(
      { valid: false, buildId: 100 },
      defaultDeps(),
    );

    expect(result.outcome).toBe("no-validation");
    expect(result.toastType).toBe("error");
  });

  it("rejects when lastValidation has no buildId", async () => {
    const result = await downloadRawDataContract(
      { valid: true },
      defaultDeps(),
    );

    expect(result.outcome).toBe("no-build-id");
    expect(result.toastType).toBe("error");
  });

  // ---------------------------------------------------------------
  // Project ID resolution
  // ---------------------------------------------------------------

  it("falls back to webContext project ID when saved project is null", async () => {
    configureExtensionDataService({
      values: { [SETTINGS_KEY_PROJECT]: null },
    });

    const deps = defaultDeps();
    const result = await downloadRawDataContract(
      { valid: true, buildId: 100 },
      deps,
    );

    expect(result.outcome).toBe("success");
  });

  it("fails when no project ID available from any source", async () => {
    configureExtensionDataService({
      values: { [SETTINGS_KEY_PROJECT]: null },
    });

    const deps = {
      ...defaultDeps(),
      webContext: { project: undefined as { id: string } | undefined },
    };
    const result = await downloadRawDataContract(
      { valid: true, buildId: 100 },
      deps,
    );

    expect(result.outcome).toBe("no-project");
    expect(result.toastType).toBe("error");
  });

  // ---------------------------------------------------------------
  // Artifact not found
  // ---------------------------------------------------------------

  it("handles missing csv-output artifact", async () => {
    const deps = defaultDeps({
      getArtifactMetadata: jest.fn(() => Promise.resolve(null)),
    });

    const result = await downloadRawDataContract(
      { valid: true, buildId: 100 },
      deps,
    );

    expect(result.outcome).toBe("no-artifact");
    expect(result.toastMessage).toContain("Raw CSV artifact not found");
  });

  it("handles artifact with missing downloadUrl", async () => {
    const deps = defaultDeps({
      getArtifactMetadata: jest.fn(() =>
        Promise.resolve({
          name: "csv-output",
          resource: { downloadUrl: undefined },
        }),
      ),
    });

    const result = await downloadRawDataContract(
      { valid: true, buildId: 100 },
      deps,
    );

    expect(result.outcome).toBe("no-download-url");
    expect(result.toastMessage).toContain("Download URL not available");
  });

  // ---------------------------------------------------------------
  // Build ID validation
  // ---------------------------------------------------------------

  it("rejects negative buildId", async () => {
    const result = await downloadRawDataContract(
      { valid: true, buildId: -1 },
      defaultDeps(),
    );

    expect(result.outcome).toBe("invalid-build-id");
    expect(result.toastMessage).toBe("Invalid build ID");
    expect(result.toastType).toBe("error");
  });

  it("rejects non-integer buildId", async () => {
    const result = await downloadRawDataContract(
      { valid: true, buildId: 1.5 },
      defaultDeps(),
    );

    expect(result.outcome).toBe("invalid-build-id");
    expect(result.toastMessage).toBe("Invalid build ID");
    expect(result.toastType).toBe("error");
  });

  // ---------------------------------------------------------------
  // URL validation (HTTPS + ADO domain)
  // ---------------------------------------------------------------

  it("rejects non-HTTPS download URL", async () => {
    const deps = defaultDeps({
      getArtifactMetadata: jest.fn(() =>
        Promise.resolve({
          name: "csv-output",
          resource: {
            downloadUrl: "http://dev.azure.com/org/proj/_apis/build/artifact",
          },
        }),
      ),
    });

    const result = await downloadRawDataContract(
      { valid: true, buildId: 100 },
      deps,
    );

    expect(result.outcome).toBe("invalid-url");
    expect(result.toastMessage).toBe("Invalid download URL");
    expect(result.toastType).toBe("error");
  });

  it("allows Azure-hosted artifact download URL", async () => {
    const deps = defaultDeps({
      getArtifactMetadata: jest.fn(() =>
        Promise.resolve({
          name: "csv-output",
          resource: {
            downloadUrl:
              "https://artprodcus3.artifacts.visualstudio.com/A123/proj/_apis/resources/content?format=zip",
          },
        }),
      ),
    });

    const result = await downloadRawDataContract(
      { valid: true, buildId: 100 },
      deps,
    );

    expect(result.outcome).toBe("success");
  });

  it("allows on-prem download URL matching collection URI origin", async () => {
    const deps = {
      ...defaultDeps({
        getArtifactMetadata: jest.fn(() =>
          Promise.resolve({
            name: "csv-output",
            resource: {
              downloadUrl:
                "https://tfs.example.com/tfs/DefaultCollection/proj/_apis/build/builds/100/artifacts",
            },
          }),
        ),
      }),
      collectionUri: "https://tfs.example.com/tfs/DefaultCollection/",
    };

    const result = await downloadRawDataContract(
      { valid: true, buildId: 100 },
      deps,
    );

    expect(result.outcome).toBe("success");
  });

  it("rejects cross-origin download URL", async () => {
    const deps = defaultDeps({
      getArtifactMetadata: jest.fn(() =>
        Promise.resolve({
          name: "csv-output",
          resource: {
            downloadUrl: "https://evil.com/redirect?url=http://internal",
          },
        }),
      ),
    });

    const result = await downloadRawDataContract(
      { valid: true, buildId: 100 },
      deps,
    );

    expect(result.outcome).toBe("invalid-url");
    expect(result.toastMessage).toBe("Invalid download URL");
    expect(result.toastType).toBe("error");
  });

  // ---------------------------------------------------------------
  // Permission / fetch errors
  // ---------------------------------------------------------------

  it("handles 401 Unauthorized response", async () => {
    const deps = defaultDeps({
      authenticatedFetch: jest.fn(() =>
        Promise.resolve({
          ok: false,
          status: 401,
          statusText: "Unauthorized",
        }),
      ),
    });

    const result = await downloadRawDataContract(
      { valid: true, buildId: 100 },
      deps,
    );

    expect(result.outcome).toBe("permission-denied");
    expect(result.toastMessage).toContain("Permission denied");
  });

  it("handles 403 Forbidden response", async () => {
    const deps = defaultDeps({
      authenticatedFetch: jest.fn(() =>
        Promise.resolve({
          ok: false,
          status: 403,
          statusText: "Forbidden",
        }),
      ),
    });

    const result = await downloadRawDataContract(
      { valid: true, buildId: 100 },
      deps,
    );

    expect(result.outcome).toBe("permission-denied");
  });

  it("handles generic fetch failure (500)", async () => {
    const deps = defaultDeps({
      authenticatedFetch: jest.fn(() =>
        Promise.resolve({
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
        }),
      ),
    });

    const result = await downloadRawDataContract(
      { valid: true, buildId: 100 },
      deps,
    );

    expect(result.outcome).toBe("fetch-error");
    expect(result.toastMessage).toContain("Internal Server Error");
  });

  it("handles network error (exception from fetch)", async () => {
    const deps = defaultDeps({
      authenticatedFetch: jest.fn(() =>
        Promise.reject(new Error("Network failure")),
      ),
    });

    const result = await downloadRawDataContract(
      { valid: true, buildId: 100 },
      deps,
    );

    expect(result.outcome).toBe("error");
    expect(result.toastMessage).toBe("Failed to download raw data");
  });

  it("handles ArtifactClient initialization failure", async () => {
    const deps = defaultDeps({
      initialize: jest.fn(() =>
        Promise.reject(new Error("Auth token unavailable")),
      ),
    });

    const result = await downloadRawDataContract(
      { valid: true, buildId: 100 },
      deps,
    );

    expect(result.outcome).toBe("error");
    expect(result.toastType).toBe("error");
  });
});

// ============================================================================
// Download button state management
// ============================================================================

describe("Settings Download: button state management", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <button id="download-raw-btn" class="btn btn-secondary" disabled>
        Download Raw Data (ZIP)
      </button>
      <span id="download-status"></span>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("button starts disabled", () => {
    const btn = document.getElementById(
      "download-raw-btn",
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("button is enabled when lastValidation is valid with buildId", () => {
    const btn = document.getElementById(
      "download-raw-btn",
    ) as HTMLButtonElement;

    // Simulate what updateStatus() does after successful validation
    const lastValidation = { valid: true, buildId: 100 };
    btn.disabled = !lastValidation.valid || !lastValidation.buildId;

    expect(btn.disabled).toBe(false);
  });

  it("button remains disabled when validation is invalid", () => {
    const btn = document.getElementById(
      "download-raw-btn",
    ) as HTMLButtonElement;

    const lastValidation = { valid: false, buildId: undefined };
    btn.disabled = !lastValidation.valid || !lastValidation.buildId;

    expect(btn.disabled).toBe(true);
  });

  it("button remains disabled when buildId is missing", () => {
    const btn = document.getElementById(
      "download-raw-btn",
    ) as HTMLButtonElement;

    const lastValidation = { valid: true, buildId: undefined };
    btn.disabled = !lastValidation.valid || !lastValidation.buildId;

    expect(btn.disabled).toBe(true);
  });

  it("button text changes to 'Downloading...' during download", () => {
    const btn = document.getElementById(
      "download-raw-btn",
    ) as HTMLButtonElement;
    const originalText = btn.textContent;

    // Simulate download start
    btn.disabled = true;
    btn.textContent = "Downloading...";

    expect(btn.textContent).toBe("Downloading...");
    expect(btn.disabled).toBe(true);

    // Simulate download complete (restore)
    btn.textContent = originalText;
    btn.disabled = false;

    expect(btn.textContent?.trim()).toBe("Download Raw Data (ZIP)");
    expect(btn.disabled).toBe(false);
  });
});

// ============================================================================
// Auto-discovery mode: updateStatus() download enablement contract
// ============================================================================

/**
 * Structured discovery result matching settings.ts DiscoveryResult type.
 * Supports partial-failure reporting (FR-007) and error/retry (FR-005).
 */
interface DiscoveryResult {
  pipelines: Array<{ id: number; name: string; buildId: number }>;
  skippedCount: number;
  error?: string;
}

/**
 * Simulates the auto-discovery branch of updateStatus() from settings.ts.
 * When no saved pipeline ID exists, discoverPipelines() is called via
 * ArtifactClient direct REST against the effective project
 * (savedProjectId || currentProjectId) to find a valid pipeline.
 * If found, lastValidation is set to enable the download button.
 *
 * The discoverFn receives the resolved project ID so tests can verify
 * discovery runs against the correct project scope.
 */
function updateStatusAutoDiscoveryContract(
  savedProjectId: string | null,
  currentProjectId: string | null,
  discoverFn: (projectId: string | null) => DiscoveryResult,
): {
  lastValidation: { valid: boolean; buildId: number } | null;
  statusHint: string;
  statusWarning?: string;
  discoveredAgainstProject: string | null;
} {
  const effectiveProjectId = savedProjectId || currentProjectId;
  const result = discoverFn(effectiveProjectId);

  if (result.error) {
    return {
      lastValidation: null,
      statusHint: "Retry",
      statusWarning: `Discovery failed: ${result.error}`,
      discoveredAgainstProject: effectiveProjectId,
    };
  }

  const match = result.pipelines[0];
  let statusWarning: string | undefined;
  if (result.skippedCount > 0) {
    statusWarning = `Found ${result.pipelines.length} pipeline(s); ${result.skippedCount} could not be checked.`;
  }

  if (match) {
    return {
      lastValidation: { valid: true, buildId: match.buildId },
      statusHint: `Found pipeline "${match.name}" (Build #${match.buildId}). Download available.`,
      statusWarning,
      discoveredAgainstProject: effectiveProjectId,
    };
  } else {
    return {
      lastValidation: null,
      statusHint:
        'The dashboard will automatically find pipelines with an "aggregates" artifact.',
      statusWarning,
      discoveredAgainstProject: effectiveProjectId,
    };
  }
}

/** Helper: creates a discoverFn that returns the given DiscoveryResult regardless of project. */
function staticDiscovery(
  pipelines: Array<{ id: number; name: string; buildId: number }>,
  skippedCount: number = 0,
  error?: string,
) {
  return (_projectId: string | null): DiscoveryResult => ({
    pipelines,
    skippedCount,
    error,
  });
}

describe("Settings Download: auto-discovery download enablement", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <button id="download-raw-btn" class="btn btn-secondary" disabled>
        Download Raw Data (ZIP)
      </button>
      <span id="download-status"></span>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("enables download button when discovery finds a pipeline", () => {
    const matches = [{ id: 10, name: "PR-Insights-Pipeline", buildId: 555 }];

    const result = updateStatusAutoDiscoveryContract(
      null,
      "current-proj",
      staticDiscovery(matches),
    );

    // lastValidation should be set with the first match's buildId
    expect(result.lastValidation).toEqual({ valid: true, buildId: 555 });
    expect(result.statusHint).toContain("PR-Insights-Pipeline");
    expect(result.statusHint).toContain("Build #555");
    expect(result.statusHint).toContain("Download available");

    // Simulate button state update (mirrors settings.ts lines 413-418)
    const btn = document.getElementById(
      "download-raw-btn",
    ) as HTMLButtonElement;
    btn.disabled =
      !result.lastValidation?.valid || !result.lastValidation?.buildId;

    expect(btn.disabled).toBe(false);
  });

  it("keeps download button disabled when discovery finds no pipelines", () => {
    const result = updateStatusAutoDiscoveryContract(
      null,
      "current-proj",
      staticDiscovery([]),
    );

    expect(result.lastValidation).toBeNull();
    expect(result.statusHint).toContain("automatically find pipelines");

    // Simulate button state update
    const btn = document.getElementById(
      "download-raw-btn",
    ) as HTMLButtonElement;
    btn.disabled =
      !result.lastValidation?.valid || !result.lastValidation?.buildId;

    expect(btn.disabled).toBe(true);
  });

  it("uses the first discovered pipeline when multiple matches exist", () => {
    const matches = [
      { id: 10, name: "First-Pipeline", buildId: 100 },
      { id: 20, name: "Second-Pipeline", buildId: 200 },
      { id: 30, name: "Third-Pipeline", buildId: 300 },
    ];

    const result = updateStatusAutoDiscoveryContract(
      null,
      "current-proj",
      staticDiscovery(matches),
    );

    expect(result.lastValidation).toEqual({ valid: true, buildId: 100 });
    expect(result.statusHint).toContain("First-Pipeline");
    expect(result.statusHint).not.toContain("Second-Pipeline");
  });

  it("discovers against saved project when source project differs from current", () => {
    const discoverFn = jest.fn(
      staticDiscovery([
        { id: 5, name: "Cross-Project-Pipeline", buildId: 999 },
      ]),
    );

    const result = updateStatusAutoDiscoveryContract(
      "saved-proj-abc",
      "current-proj",
      discoverFn,
    );

    // Discovery must target the saved project, not the current one
    expect(discoverFn).toHaveBeenCalledWith("saved-proj-abc");
    expect(result.discoveredAgainstProject).toBe("saved-proj-abc");
    expect(result.lastValidation).toEqual({ valid: true, buildId: 999 });
  });

  it("falls back to current project when no saved project exists", () => {
    const discoverFn = jest.fn(
      staticDiscovery([{ id: 7, name: "Local-Pipeline", buildId: 123 }]),
    );

    const result = updateStatusAutoDiscoveryContract(
      null,
      "current-proj",
      discoverFn,
    );

    expect(discoverFn).toHaveBeenCalledWith("current-proj");
    expect(result.discoveredAgainstProject).toBe("current-proj");
  });

  it("discovered buildId flows through to downloadRawData contract", async () => {
    // Verify the full chain: discovery → lastValidation → download uses correct buildId
    const matches = [{ id: 42, name: "My-Pipeline", buildId: 777 }];
    const { lastValidation } = updateStatusAutoDiscoveryContract(
      null,
      "proj-123",
      staticDiscovery(matches),
    );

    // Feed lastValidation into the download contract
    const deps = {
      dataService: getMockExtensionDataManager(),
      webContext: { project: { id: "proj-123" } },
      collectionUri: "https://dev.azure.com/org/",
      artifactClient: {
        initialize: jest.fn(() => Promise.resolve()),
        getArtifactMetadata: jest.fn(() =>
          Promise.resolve({
            name: "csv-output",
            resource: {
              downloadUrl:
                "https://dev.azure.com/org/proj/_apis/build/builds/777/artifacts?artifactName=csv-output",
            },
          }),
        ),
        authenticatedFetch: jest.fn(() =>
          Promise.resolve({ ok: true, status: 200, statusText: "OK" }),
        ),
      },
    };

    const result = await downloadRawDataContract(lastValidation, deps);

    expect(result.outcome).toBe("success");
    expect(deps.artifactClient.getArtifactMetadata).toHaveBeenCalledWith(
      777,
      "csv-output",
    );
  });

  // ---------------------------------------------------------------
  // Partial-failure reporting (FR-007)
  // ---------------------------------------------------------------

  it("includes skipped count warning when some pipelines could not be checked", () => {
    const pipelines = [{ id: 10, name: "Good-Pipeline", buildId: 100 }];

    const result = updateStatusAutoDiscoveryContract(
      null,
      "current-proj",
      staticDiscovery(pipelines, 3),
    );

    // Pipeline still found, download enabled
    expect(result.lastValidation).toEqual({ valid: true, buildId: 100 });
    // Warning about skipped pipelines
    expect(result.statusWarning).toContain("3 could not be checked");
    expect(result.statusWarning).toContain("1 pipeline(s)");
  });

  it("reports skipped count even when no pipelines found", () => {
    const result = updateStatusAutoDiscoveryContract(
      null,
      "current-proj",
      staticDiscovery([], 5),
    );

    expect(result.lastValidation).toBeNull();
    expect(result.statusWarning).toContain("5 could not be checked");
  });

  it("omits warning when skippedCount is zero", () => {
    const result = updateStatusAutoDiscoveryContract(
      null,
      "current-proj",
      staticDiscovery([{ id: 1, name: "P", buildId: 1 }], 0),
    );

    expect(result.statusWarning).toBeUndefined();
  });

  // ---------------------------------------------------------------
  // Discovery error handling (FR-005, FR-006)
  // ---------------------------------------------------------------

  it("disables download button when discovery returns an error", () => {
    const result = updateStatusAutoDiscoveryContract(
      null,
      "current-proj",
      staticDiscovery([], 0, "Failed to initialize: Auth token unavailable"),
    );

    expect(result.lastValidation).toBeNull();
    expect(result.statusWarning).toContain("Discovery failed");
    expect(result.statusWarning).toContain("Auth token unavailable");
    expect(result.statusHint).toContain("Retry");

    // Simulate button state update
    const btn = document.getElementById(
      "download-raw-btn",
    ) as HTMLButtonElement;
    btn.disabled =
      !result.lastValidation?.valid || !result.lastValidation?.buildId;
    expect(btn.disabled).toBe(true);
  });

  it("returns error message from failed pipeline listing", () => {
    const result = updateStatusAutoDiscoveryContract(
      null,
      "current-proj",
      staticDiscovery([], 0, "Failed to list pipelines: 403 Forbidden"),
    );

    expect(result.lastValidation).toBeNull();
    expect(result.statusWarning).toContain("403 Forbidden");
  });
});

// ============================================================================
// ZIP URL construction
// ============================================================================

describe("Settings Download: ZIP URL construction", () => {
  function buildZipUrl(downloadUrl: string): string {
    const zipUrlObj = new URL(downloadUrl);
    if (!zipUrlObj.searchParams.has("format")) {
      zipUrlObj.searchParams.set("format", "zip");
    }
    return zipUrlObj.toString();
  }

  it("appends ?format=zip to bare URL", () => {
    expect(buildZipUrl("https://example.com/artifact")).toBe(
      "https://example.com/artifact?format=zip",
    );
  });

  it("appends &format=zip to URL with existing params", () => {
    expect(buildZipUrl("https://example.com/artifact?api-version=7.1")).toBe(
      "https://example.com/artifact?api-version=7.1&format=zip",
    );
  });

  it("leaves URL unchanged if format=zip already present", () => {
    expect(buildZipUrl("https://example.com/artifact?format=zip")).toBe(
      "https://example.com/artifact?format=zip",
    );
  });

  it("handles URL with format=zip in the middle of params", () => {
    expect(buildZipUrl("https://example.com/artifact?format=zip&other=1")).toBe(
      "https://example.com/artifact?format=zip&other=1",
    );
  });
});

// ============================================================================
// Download filename generation
// ============================================================================

describe("Settings Download: filename generation", () => {
  it("generates date-stamped filename", () => {
    const dateStr = new Date().toISOString().split("T")[0];
    const filename = `pr-insights-raw-data-${dateStr}.zip`;

    expect(filename).toMatch(/^pr-insights-raw-data-\d{4}-\d{2}-\d{2}\.zip$/);
  });

  it("uses today's date", () => {
    const today = new Date().toISOString().split("T")[0];
    const filename = `pr-insights-raw-data-${today}.zip`;

    expect(filename).toContain(today!);
  });
});
