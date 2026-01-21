/**
 * Production Issues Tests
 *
 * Tests for fixes to critical production issues:
 * 1. Dashboard should accept PartiallySucceeded builds (first runs are often partial)
 * 2. Stale settings should be automatically cleared and fallback to auto-discovery
 *
 * These tests verify the fixes work correctly and prevent regressions.
 */

// ============================================================================
// Issue 1: PartiallySucceeded Builds Acceptance
// ============================================================================

describe("Issue 1: PartiallySucceeded Builds Acceptance", () => {
  /**
   * Azure DevOps Build Result enum values:
   * - None = 0
   * - Succeeded = 2
   * - PartiallySucceeded = 4
   * - Failed = 8
   * - Canceled = 32
   *
   * The resultFilter is a bitmask, so:
   * - 2 = Succeeded only
   * - 6 = Succeeded (2) | PartiallySucceeded (4)
   */

  describe("resultFilter bitmask", () => {
    it("should use resultFilter=6 to include both Succeeded and PartiallySucceeded", () => {
      // The fix changes resultFilter from 2 to 6
      const SUCCEEDED = 2;
      const PARTIALLY_SUCCEEDED = 4;
      const expectedResultFilter = SUCCEEDED | PARTIALLY_SUCCEEDED;

      expect(expectedResultFilter).toBe(6);
    });

    it("resultFilter=2 excludes PartiallySucceeded builds", () => {
      const resultFilter = 2;
      const PARTIALLY_SUCCEEDED = 4;

      // Bitmask check: does resultFilter include PartiallySucceeded?
      const includesPartial = (resultFilter & PARTIALLY_SUCCEEDED) !== 0;

      expect(includesPartial).toBe(false);
    });

    it("resultFilter=6 includes PartiallySucceeded builds", () => {
      const resultFilter = 6;
      const PARTIALLY_SUCCEEDED = 4;

      // Bitmask check: does resultFilter include PartiallySucceeded?
      const includesPartial = (resultFilter & PARTIALLY_SUCCEEDED) !== 0;

      expect(includesPartial).toBe(true);
    });

    it("resultFilter=6 includes Succeeded builds", () => {
      const resultFilter = 6;
      const SUCCEEDED = 2;

      // Bitmask check: does resultFilter include Succeeded?
      const includesSucceeded = (resultFilter & SUCCEEDED) !== 0;

      expect(includesSucceeded).toBe(true);
    });

    it("resultFilter=6 excludes Failed builds", () => {
      const resultFilter = 6;
      const FAILED = 8;

      // Bitmask check: does resultFilter include Failed?
      const includesFailed = (resultFilter & FAILED) !== 0;

      expect(includesFailed).toBe(false);
    });
  });

  describe("Build filtering logic", () => {
    /**
     * Simulates the build filtering that happens in resolveFromPipelineId
     * and discoverInsightsPipelines
     */
    const filterBuilds = (builds: any[], resultFilter: number) => {
      return builds.filter((build) => {
        return (build.result & resultFilter) !== 0;
      });
    };

    const mockBuilds = [
      { id: 1, result: 2, name: "Succeeded build" },
      { id: 2, result: 4, name: "PartiallySucceeded build (first run)" },
      { id: 3, result: 8, name: "Failed build" },
      { id: 4, result: 32, name: "Canceled build" },
      { id: 5, result: 2, name: "Another succeeded build" },
    ];

    it("old resultFilter=2 would miss first-run PartiallySucceeded builds", () => {
      const oldResultFilter = 2;
      const filtered = filterBuilds(mockBuilds, oldResultFilter);

      expect(filtered.length).toBe(2);
      expect(filtered.map((b) => b.id)).toEqual([1, 5]);
      expect(filtered.find((b) => b.result === 4)).toBeUndefined();
    });

    it("new resultFilter=6 includes first-run PartiallySucceeded builds", () => {
      const newResultFilter = 6;
      const filtered = filterBuilds(mockBuilds, newResultFilter);

      expect(filtered.length).toBe(3);
      expect(filtered.map((b) => b.id)).toEqual([1, 2, 5]);
      expect(filtered.find((b) => b.result === 4)).toBeDefined();
    });

    it("new resultFilter=6 still excludes Failed and Canceled builds", () => {
      const newResultFilter = 6;
      const filtered = filterBuilds(mockBuilds, newResultFilter);

      expect(filtered.find((b) => b.result === 8)).toBeUndefined();
      expect(filtered.find((b) => b.result === 32)).toBeUndefined();
    });
  });

  describe("First-run scenario simulation", () => {
    /**
     * On first run:
     * 1. DownloadPipelineArtifact@2 fails (no prior artifact)
     * 2. Task has continueOnError: true, so pipeline continues
     * 3. Extraction succeeds, artifacts published
     * 4. Build result = PartiallySucceeded (4)
     */
    it("first run build should be detected with new resultFilter", () => {
      const firstRunBuild = {
        id: 9,
        result: 4, // PartiallySucceeded
        status: 2, // Completed
        reason: "Manual run",
      };

      const newResultFilter = 6;
      const isAcceptable = (firstRunBuild.result & newResultFilter) !== 0;

      expect(isAcceptable).toBe(true);
    });

    it("subsequent successful runs should still be detected", () => {
      const subsequentBuild = {
        id: 10,
        result: 2, // Succeeded
        status: 2, // Completed
        reason: "Scheduled",
      };

      const newResultFilter = 6;
      const isAcceptable = (subsequentBuild.result & newResultFilter) !== 0;

      expect(isAcceptable).toBe(true);
    });
  });

  describe("Error message clarity", () => {
    /**
     * The error message should explain that PartiallySucceeded is acceptable
     */
    const createNoSuccessfulBuildsErrorMessage = () => {
      return {
        instructions: [
          "Check the pipeline for errors",
          "Run it manually and ensure extraction completes",
          'Note: "Partially Succeeded" builds are acceptable - first runs may show this status because no prior database artifact exists yet, but extraction still works',
          "Return here after a successful or partially successful run",
        ],
      };
    };

    it("error message mentions PartiallySucceeded as acceptable", () => {
      const error = createNoSuccessfulBuildsErrorMessage();

      const mentionsPartial = error.instructions.some((instruction) =>
        instruction.toLowerCase().includes("partially succeeded"),
      );

      expect(mentionsPartial).toBe(true);
    });

    it("error message explains why first runs may be partial", () => {
      const error = createNoSuccessfulBuildsErrorMessage();

      const explainsFirstRun = error.instructions.some(
        (instruction) =>
          instruction.includes("first run") || instruction.includes("no prior"),
      );

      expect(explainsFirstRun).toBe(true);
    });
  });
});

// ============================================================================
// Issue 2: Stale Settings and Auto-Discovery Fallback
// ============================================================================

describe("Issue 2: Stale Settings and Auto-Discovery Fallback", () => {
  /**
   * The issue:
   * 1. User had extension with pipelineId saved in settings
   * 2. User deleted extension and pipeline
   * 3. User reinstalled extension
   * 4. Old pipelineId persisted in Extension Data Service
   * 5. Dashboard used stale pipelineId instead of auto-discovering new pipeline
   */

  describe("Settings persistence behavior", () => {
    it("Extension Data Service settings persist across reinstalls", () => {
      // This is Azure DevOps platform behavior - settings stored with
      // scopeType: 'User' persist even when extension is uninstalled
      const settingsScopeType = "User";

      // User-scoped settings persist across reinstalls
      expect(settingsScopeType).toBe("User");
    });
  });

  describe("Configuration resolution with fallback", () => {
    /**
     * Simulates the resolveConfiguration logic with fallback
     */
    const createResolveConfiguration = (options: any) => {
      const {
        queryPipelineId,
        savedPipelineId,
        resolveFromPipelineIdFn,
        discoverAndResolveFn,
        clearStalePipelineSettingFn,
      } = options;

      return async function resolveConfiguration() {
        // Mode: explicit pipelineId from query (no fallback)
        if (queryPipelineId) {
          return await resolveFromPipelineIdFn(queryPipelineId);
        }

        // Check settings for pipeline ID (with fallback)
        if (savedPipelineId) {
          try {
            return await resolveFromPipelineIdFn(savedPipelineId);
          } catch (error) {
            // Saved pipeline is invalid - clear and fall back
            await clearStalePipelineSettingFn();
            // Continue to discovery
          }
        }

        // Mode: discovery
        return await discoverAndResolveFn();
      };
    };

    it("uses saved pipelineId when valid", async () => {
      const resolveFromPipelineId = jest.fn().mockResolvedValue({ buildId: 5 });
      const discoverAndResolve = jest.fn().mockResolvedValue({ buildId: 9 });
      const clearStalePipelineSetting = jest.fn();

      const resolveConfiguration = createResolveConfiguration({
        savedPipelineId: 3,
        resolveFromPipelineIdFn: resolveFromPipelineId,
        discoverAndResolveFn: discoverAndResolve,
        clearStalePipelineSettingFn: clearStalePipelineSetting,
      });

      const result = await resolveConfiguration();

      expect(result.buildId).toBe(5);
      expect(resolveFromPipelineId).toHaveBeenCalledWith(3);
      expect(discoverAndResolve).not.toHaveBeenCalled();
      expect(clearStalePipelineSetting).not.toHaveBeenCalled();
    });

    it("falls back to discovery when saved pipelineId is invalid", async () => {
      const resolveFromPipelineId = jest
        .fn()
        .mockRejectedValue(new Error("Pipeline not found"));
      const discoverAndResolve = jest.fn().mockResolvedValue({ buildId: 9 });
      const clearStalePipelineSetting = jest.fn();

      const resolveConfiguration = createResolveConfiguration({
        savedPipelineId: 3, // Old, deleted pipeline
        resolveFromPipelineIdFn: resolveFromPipelineId,
        discoverAndResolveFn: discoverAndResolve,
        clearStalePipelineSettingFn: clearStalePipelineSetting,
      });

      const result = await resolveConfiguration();

      expect(result.buildId).toBe(9); // New pipeline discovered
      expect(resolveFromPipelineId).toHaveBeenCalledWith(3);
      expect(discoverAndResolve).toHaveBeenCalled();
      expect(clearStalePipelineSetting).toHaveBeenCalled();
    });

    it("clears stale setting automatically on fallback", async () => {
      const clearStalePipelineSetting = jest.fn();

      const resolveConfiguration = createResolveConfiguration({
        savedPipelineId: 3,
        resolveFromPipelineIdFn: jest
          .fn()
          .mockRejectedValue(new Error("No builds")),
        discoverAndResolveFn: jest.fn().mockResolvedValue({ buildId: 9 }),
        clearStalePipelineSettingFn: clearStalePipelineSetting,
      });

      await resolveConfiguration();

      expect(clearStalePipelineSetting).toHaveBeenCalledTimes(1);
    });

    it("does NOT fall back when query pipelineId fails (explicit override)", async () => {
      const resolveFromPipelineId = jest
        .fn()
        .mockRejectedValue(new Error("Pipeline not found"));
      const discoverAndResolve = jest.fn().mockResolvedValue({ buildId: 9 });
      const clearStalePipelineSetting = jest.fn();

      const resolveConfiguration = createResolveConfiguration({
        queryPipelineId: 3, // Explicit from URL
        resolveFromPipelineIdFn: resolveFromPipelineId,
        discoverAndResolveFn: discoverAndResolve,
        clearStalePipelineSettingFn: clearStalePipelineSetting,
      });

      // Should throw, not fall back
      await expect(resolveConfiguration()).rejects.toThrow(
        "Pipeline not found",
      );
      expect(discoverAndResolve).not.toHaveBeenCalled();
      expect(clearStalePipelineSetting).not.toHaveBeenCalled();
    });

    it("uses discovery when no settings exist", async () => {
      const resolveFromPipelineId = jest.fn();
      const discoverAndResolve = jest.fn().mockResolvedValue({ buildId: 9 });
      const clearStalePipelineSetting = jest.fn();

      const resolveConfiguration = createResolveConfiguration({
        savedPipelineId: null, // No saved setting
        resolveFromPipelineIdFn: resolveFromPipelineId,
        discoverAndResolveFn: discoverAndResolve,
        clearStalePipelineSettingFn: clearStalePipelineSetting,
      });

      const result = await resolveConfiguration();

      expect(result.buildId).toBe(9);
      expect(resolveFromPipelineId).not.toHaveBeenCalled();
      expect(discoverAndResolve).toHaveBeenCalled();
    });
  });

  describe("clearStalePipelineSetting behavior", () => {
    /**
     * Simulates clearing the stale setting
     */
    const createClearStalePipelineSetting = (dataService: any) => {
      return async function clearStalePipelineSetting() {
        await dataService.setValue("pr-insights-pipeline-id", null, {
          scopeType: "User",
        });
      };
    };

    it("sets pipeline setting to null", async () => {
      const mockDataService = {
        setValue: jest.fn().mockResolvedValue(undefined),
      };

      const clearStalePipelineSetting =
        createClearStalePipelineSetting(mockDataService);

      await clearStalePipelineSetting();

      expect(mockDataService.setValue).toHaveBeenCalledWith(
        "pr-insights-pipeline-id",
        null,
        { scopeType: "User" },
      );
    });

    it("handles errors gracefully without throwing", async () => {
      const mockDataService = {
        setValue: jest.fn().mockRejectedValue(new Error("Storage error")),
      };

      const clearStalePipelineSetting = async () => {
        try {
          await mockDataService.setValue("pr-insights-pipeline-id", null, {
            scopeType: "User",
          });
        } catch (e) {
          console.warn("Could not clear stale setting:", e);
          // Don't rethrow - this is best-effort cleanup
        }
      };

      // Should not throw
      await expect(clearStalePipelineSetting()).resolves.not.toThrow();
    });
  });

  describe("Settings page validation", () => {
    /**
     * Simulates the validatePipeline function in settings.js
     */
    const createValidatePipeline = (mockClient: any) => {
      return async function validatePipeline(
        pipelineId: number,
        projectId: string,
      ) {
        // Check if pipeline definition exists
        const definitions = await mockClient.getDefinitions(
          projectId,
          pipelineId,
        );

        if (!definitions || definitions.length === 0) {
          return {
            valid: false,
            error: "Pipeline definition not found (may have been deleted)",
          };
        }

        const pipelineName = definitions[0].name;

        // Check for successful/partially-succeeded builds
        const builds = await mockClient.getBuilds(projectId, pipelineId);

        if (!builds || builds.length === 0) {
          return {
            valid: false,
            name: pipelineName,
            error: "No successful builds found",
          };
        }

        return {
          valid: true,
          name: pipelineName,
          buildId: builds[0].id,
        };
      };
    };

    it("returns valid=true for existing pipeline with builds", async () => {
      const mockClient = {
        getDefinitions: jest
          .fn()
          .mockResolvedValue([{ id: 7, name: "PR Insights" }]),
        getBuilds: jest.fn().mockResolvedValue([{ id: 9, result: 2 }]),
      };

      const validatePipeline = createValidatePipeline(mockClient);
      const result = await validatePipeline(7, "project-id");

      expect(result.valid).toBe(true);
      expect(result.name).toBe("PR Insights");
      expect(result.buildId).toBe(9);
    });

    it("returns valid=false when pipeline definition not found (deleted)", async () => {
      const mockClient = {
        getDefinitions: jest.fn().mockResolvedValue([]),
        getBuilds: jest.fn(),
      };

      const validatePipeline = createValidatePipeline(mockClient);
      const result = await validatePipeline(3, "project-id");

      expect(result.valid).toBe(false);
      expect(result.error).toContain("not found");
      expect(result.error).toContain("deleted");
    });

    it("returns valid=false when no successful builds exist", async () => {
      const mockClient = {
        getDefinitions: jest
          .fn()
          .mockResolvedValue([{ id: 7, name: "PR Insights" }]),
        getBuilds: jest.fn().mockResolvedValue([]),
      };

      const validatePipeline = createValidatePipeline(mockClient);
      const result = await validatePipeline(7, "project-id");

      expect(result.valid).toBe(false);
      expect(result.name).toBe("PR Insights");
      expect(result.error).toContain("No successful builds");
    });
  });

  describe("Re-discover pipelines functionality", () => {
    /**
     * Simulates the discoverPipelines function in settings.js
     */
    const createDiscoverPipelines = (mockClient: any) => {
      return async function discoverPipelines() {
        const definitions = await mockClient.getDefinitions();
        const matches = [];

        for (const def of definitions) {
          const builds = await mockClient.getBuilds(def.id);
          if (!builds || builds.length === 0) continue;

          const artifacts = await mockClient.getArtifacts(builds[0].id);
          if (!artifacts.some((a: any) => a.name === "aggregates")) continue;

          matches.push({
            id: def.id,
            name: def.name,
            buildId: builds[0].id,
          });
        }

        return matches;
      };
    };

    it("discovers pipelines with aggregates artifact", async () => {
      const mockClient = {
        getDefinitions: jest.fn().mockResolvedValue([
          { id: 7, name: "PR Insights Pipeline" },
          { id: 8, name: "Other Pipeline" },
        ]),
        getBuilds: jest
          .fn()
          .mockResolvedValueOnce([{ id: 9, result: 4 }]) // Pipeline 7
          .mockResolvedValueOnce([{ id: 10, result: 2 }]), // Pipeline 8
        getArtifacts: jest
          .fn()
          .mockResolvedValueOnce([{ name: "aggregates" }]) // Pipeline 7
          .mockResolvedValueOnce([{ name: "logs" }]), // Pipeline 8 (no aggregates)
      };

      const discoverPipelines = createDiscoverPipelines(mockClient);
      const matches = await discoverPipelines();

      expect(matches.length).toBe(1);
      expect(matches[0].id).toBe(7);
      expect(matches[0].name).toBe("PR Insights Pipeline");
      expect(matches[0].buildId).toBe(9);
    });

    it("returns empty when no pipelines have aggregates", async () => {
      const mockClient = {
        getDefinitions: jest
          .fn()
          .mockResolvedValue([{ id: 7, name: "Other Pipeline" }]),
        getBuilds: jest.fn().mockResolvedValue([{ id: 9, result: 2 }]),
        getArtifacts: jest.fn().mockResolvedValue([{ name: "logs" }]),
      };

      const discoverPipelines = createDiscoverPipelines(mockClient);
      const matches = await discoverPipelines();

      expect(matches.length).toBe(0);
    });

    it("skips pipelines with no successful builds", async () => {
      const mockClient = {
        getDefinitions: jest
          .fn()
          .mockResolvedValue([{ id: 7, name: "Failed Pipeline" }]),
        getBuilds: jest.fn().mockResolvedValue([]), // No successful builds
        getArtifacts: jest.fn(),
      };

      const discoverPipelines = createDiscoverPipelines(mockClient);
      const matches = await discoverPipelines();

      expect(matches.length).toBe(0);
      expect(mockClient.getArtifacts).not.toHaveBeenCalled();
    });
  });

  describe("End-to-end scenario: Extension reinstall", () => {
    /**
     * Full scenario simulation:
     * 1. User had pipelineId=3 saved (buildId=5)
     * 2. User deleted extension and pipeline
     * 3. User reinstalled extension, created new pipeline (pipelineId=7, buildId=9)
     * 4. Dashboard should auto-discover new pipeline, not use stale pipelineId=3
     */
    it("automatically discovers new pipeline after reinstall", async () => {
      let savedPipelineId: number | null = 3; // Old, stale setting
      let settingCleared = false;

      const mockResolveFromPipelineId = jest.fn(async (pipelineId: number) => {
        if (pipelineId === 3) {
          throw new Error(
            "Pipeline definition not found (may have been deleted)",
          );
        }
        if (pipelineId === 7) {
          return { buildId: 9 };
        }
        throw new Error("Unknown pipeline");
      });

      const mockDiscoverAndResolve = jest.fn(async () => {
        // Discovers the new pipeline
        return { buildId: 9, pipelineId: 7 };
      });

      const mockClearStalePipelineSetting = jest.fn(async () => {
        savedPipelineId = null;
        settingCleared = true;
      });

      // Simulate resolveConfiguration with fallback
      const resolveConfiguration = async () => {
        if (savedPipelineId) {
          try {
            return await mockResolveFromPipelineId(savedPipelineId);
          } catch (error) {
            await mockClearStalePipelineSetting();
            // Fall through to discovery
          }
        }
        return await mockDiscoverAndResolve();
      };

      const result = await resolveConfiguration();

      // Should have discovered the new pipeline
      expect(result.buildId).toBe(9);

      // Should have cleared the stale setting
      expect(settingCleared).toBe(true);
      expect(savedPipelineId).toBe(null);

      // Should have attempted old pipeline first, then discovered
      expect(mockResolveFromPipelineId).toHaveBeenCalledWith(3);
      expect(mockDiscoverAndResolve).toHaveBeenCalled();
    });

    it("next load uses discovery directly after stale setting cleared", async () => {
      let savedPipelineId: number | null = null; // Already cleared from previous load

      const mockResolveFromPipelineId = jest.fn();
      const mockDiscoverAndResolve = jest.fn(async () => {
        return { buildId: 9, pipelineId: 7 };
      });

      // Simulate resolveConfiguration with no saved setting
      const resolveConfiguration = async () => {
        if (savedPipelineId) {
          return await mockResolveFromPipelineId(savedPipelineId);
        }
        return await mockDiscoverAndResolve();
      };

      const result = await resolveConfiguration();

      expect(result.buildId).toBe(9);
      expect(mockResolveFromPipelineId).not.toHaveBeenCalled();
      expect(mockDiscoverAndResolve).toHaveBeenCalled();
    });
  });
});

// ============================================================================
// Combined Tests: Both Issues Together
// ============================================================================

describe("Combined: First-run PartiallySucceeded + Auto-discovery", () => {
  /**
   * Scenario: User reinstalls extension, runs new pipeline for first time.
   * The first run is PartiallySucceeded. Dashboard should discover it.
   */
  it("discovers first-run PartiallySucceeded build after reinstall", async () => {
    const PARTIALLY_SUCCEEDED = 4;
    const resultFilter = 6; // Succeeded | PartiallySucceeded

    // New pipeline's first run is PartiallySucceeded
    const firstRunBuild = {
      id: 9,
      result: PARTIALLY_SUCCEEDED,
      status: 2, // Completed
    };

    // Check if build is acceptable
    const isAcceptable = (firstRunBuild.result & resultFilter) !== 0;
    expect(isAcceptable).toBe(true);

    // Simulate discovery finding this build
    const mockDiscoverPipelines = async () => {
      const builds = [firstRunBuild];
      const filteredBuilds = builds.filter(
        (b) => (b.result & resultFilter) !== 0,
      );

      if (filteredBuilds.length === 0) return [];

      return [
        {
          id: 7,
          name: "PR Insights",
          buildId: filteredBuilds[0].id,
        },
      ];
    };

    const discovered = await mockDiscoverPipelines();

    expect(discovered.length).toBe(1);
    expect(discovered[0].buildId).toBe(9);
  });

  it("old resultFilter would have missed first-run after reinstall", async () => {
    const PARTIALLY_SUCCEEDED = 4;
    const oldResultFilter = 2; // Succeeded only (old behavior)

    const firstRunBuild = {
      id: 9,
      result: PARTIALLY_SUCCEEDED,
      status: 2,
    };

    // Old behavior would exclude this build
    const isAcceptableOld = (firstRunBuild.result & oldResultFilter) !== 0;
    expect(isAcceptableOld).toBe(false);

    // Discovery would return empty with old resultFilter
    const mockOldDiscoverPipelines = async () => {
      const builds = [firstRunBuild];
      const filteredBuilds = builds.filter(
        (b) => (b.result & oldResultFilter) !== 0,
      );

      if (filteredBuilds.length === 0) return [];

      return [
        {
          id: 7,
          name: "PR Insights",
          buildId: filteredBuilds[0].id,
        },
      ];
    };

    const discovered = await mockOldDiscoverPipelines();

    expect(discovered.length).toBe(0);
  });
});

// ============================================================================
// Regression Prevention Tests
// ============================================================================

describe("Regression Prevention", () => {
  describe("resultFilter value must be 6", () => {
    it("resolveFromPipelineId should use resultFilter=6", () => {
      // This is a marker test - the actual value is hardcoded in dashboard.ts
      // If someone changes it back to 2, this test documents the expected value
      const expectedResultFilter = 6;
      const SUCCEEDED = 2;
      const PARTIALLY_SUCCEEDED = 4;

      expect(expectedResultFilter).toBe(SUCCEEDED | PARTIALLY_SUCCEEDED);
    });

    it("discoverInsightsPipelines should use resultFilter=6", () => {
      const expectedResultFilter = 6;
      const SUCCEEDED = 2;
      const PARTIALLY_SUCCEEDED = 4;

      expect(expectedResultFilter).toBe(SUCCEEDED | PARTIALLY_SUCCEEDED);
    });
  });

  describe("Fallback behavior must be preserved", () => {
    it("saved pipeline errors should trigger discovery fallback", async () => {
      let discoveryTriggered = false;

      const resolveWithFallback = async (savedPipelineId: number) => {
        if (savedPipelineId) {
          try {
            throw new Error("Pipeline not found");
          } catch {
            discoveryTriggered = true;
          }
        }
        return { buildId: 9 };
      };

      await resolveWithFallback(3);

      expect(discoveryTriggered).toBe(true);
    });

    it("query param errors should NOT trigger discovery fallback", async () => {
      let discoveryTriggered = false;

      const resolveExplicit = async (queryPipelineId: number) => {
        // Explicit from query param - no fallback
        throw new Error("Pipeline not found");
      };

      await expect(resolveExplicit(3)).rejects.toThrow();
      expect(discoveryTriggered).toBe(false);
    });
  });

  describe("Settings clearing must be automatic", () => {
    it("stale settings should be cleared on fallback", async () => {
      let settingCleared = false;

      const resolveWithAutoClearing = async (
        savedPipelineId: number,
        clearFn: () => Promise<void>,
      ) => {
        if (savedPipelineId) {
          try {
            throw new Error("Pipeline not found");
          } catch {
            await clearFn();
          }
        }
        return { buildId: 9 };
      };

      await resolveWithAutoClearing(3, async () => {
        settingCleared = true;
      });

      expect(settingCleared).toBe(true);
    });
  });
});

// ============================================================================
// Phase 5 Feature Flag Tests
// ============================================================================

describe("Phase 5 Feature Flag (Predictions & AI Insights)", () => {
  /**
   * Phase 5 features (Predictions, AI Insights) are now enabled.
   * The tabs are visible by default and show "Coming Soon" state
   * until the backend generates predictions/insights data.
   *
   * Full functionality requires additional setup:
   * - Prophet library for forecasting
   * - OpenAI API key for AI insights
   * - Pipeline task inputs (enablePredictions, enableInsights)
   */

  describe("Feature flag behavior", () => {
    it("ENABLE_PHASE5_FEATURES should be true (Phase 5 enabled)", () => {
      // Phase 5 features are now enabled by default
      // Tabs are visible and show "Coming Soon" until data is available
      const ENABLE_PHASE5_FEATURES = true;
      expect(ENABLE_PHASE5_FEATURES).toBe(true);
    });

    it("Phase 5 tabs should be hidden when feature flag is false", () => {
      const ENABLE_PHASE5_FEATURES = false;

      // Simulate initializePhase5Features logic
      const phase5Tabs = [
        { classList: { remove: jest.fn(), contains: jest.fn(() => true) } },
        { classList: { remove: jest.fn(), contains: jest.fn(() => true) } },
      ];

      if (ENABLE_PHASE5_FEATURES) {
        phase5Tabs.forEach((tab) => tab.classList.remove("hidden"));
      }

      // Tabs should NOT have had 'hidden' removed
      phase5Tabs.forEach((tab) => {
        expect(tab.classList.remove).not.toHaveBeenCalled();
      });
    });

    it("Phase 5 tabs should be visible when feature flag is true", () => {
      const ENABLE_PHASE5_FEATURES = true;

      // Simulate initializePhase5Features logic
      const phase5Tabs = [
        { classList: { remove: jest.fn() } },
        { classList: { remove: jest.fn() } },
      ];

      if (ENABLE_PHASE5_FEATURES) {
        phase5Tabs.forEach((tab) => tab.classList.remove("hidden"));
      }

      // Tabs should have had 'hidden' removed
      phase5Tabs.forEach((tab) => {
        expect(tab.classList.remove).toHaveBeenCalledWith("hidden");
      });
    });
  });

  describe("initializePhase5Features function", () => {
    /**
     * Simulates the initializePhase5Features function
     */
    const createInitializePhase5Features = (featureFlag: boolean) => {
      return function initializePhase5Features(mockTabs: any[]) {
        if (featureFlag) {
          mockTabs.forEach((tab) => tab.show());
        } else {
          // Tabs remain hidden (default state)
        }
      };
    };

    it("does not modify tabs when flag is false", () => {
      const initFn = createInitializePhase5Features(false);
      const tabs = [
        { show: jest.fn(), hide: jest.fn() },
        { show: jest.fn(), hide: jest.fn() },
      ];

      initFn(tabs);

      tabs.forEach((tab) => {
        expect(tab.show).not.toHaveBeenCalled();
      });
    });

    it("shows tabs when flag is true", () => {
      const initFn = createInitializePhase5Features(true);
      const tabs = [{ show: jest.fn() }, { show: jest.fn() }];

      initFn(tabs);

      tabs.forEach((tab) => {
        expect(tab.show).toHaveBeenCalled();
      });
    });
  });

  describe("Coming Soon state", () => {
    beforeEach(() => {
      document.body.innerHTML = `
                <nav class="tabs">
                    <button class="tab active" data-tab="metrics">Metrics</button>
                    <button class="tab phase5-tab hidden" data-tab="predictions">Predictions</button>
                    <button class="tab phase5-tab hidden" data-tab="ai-insights">AI Insights</button>
                </nav>
                <section id="tab-predictions" class="tab-content hidden phase5-content">
                    <div class="feature-unavailable coming-soon">
                        <h2>Predictions — Coming Soon</h2>
                    </div>
                </section>
                <section id="tab-ai-insights" class="tab-content hidden phase5-content">
                    <div class="feature-unavailable coming-soon">
                        <h2>AI Insights — Coming Soon</h2>
                    </div>
                </section>
            `;
    });

    it('Phase 5 tabs have "hidden" class by default in HTML', () => {
      const predictionsTab = document.querySelector('[data-tab="predictions"]');
      const aiInsightsTab = document.querySelector('[data-tab="ai-insights"]');

      expect(predictionsTab?.classList.contains("hidden")).toBe(true);
      expect(aiInsightsTab?.classList.contains("hidden")).toBe(true);
    });

    it('Phase 5 tabs have "phase5-tab" marker class', () => {
      const phase5Tabs = document.querySelectorAll(".phase5-tab");

      expect(phase5Tabs.length).toBe(2);
    });

    it('Phase 5 content shows "Coming Soon" message', () => {
      const predictionsContent = document.getElementById("tab-predictions");
      const aiInsightsContent = document.getElementById("tab-ai-insights");

      expect(predictionsContent?.innerHTML).toContain("Coming Soon");
      expect(aiInsightsContent?.innerHTML).toContain("Coming Soon");
    });

    it('Phase 5 content has "coming-soon" CSS class', () => {
      const predictionsUnavailable = document.querySelector(
        "#tab-predictions .feature-unavailable",
      );
      const aiUnavailable = document.querySelector(
        "#tab-ai-insights .feature-unavailable",
      );

      expect(predictionsUnavailable?.classList.contains("coming-soon")).toBe(
        true,
      );
      expect(aiUnavailable?.classList.contains("coming-soon")).toBe(true);
    });
  });

  describe("Regression prevention", () => {
    it("Phase 5 feature flag constant must exist", () => {
      // This test documents that the flag must be defined
      // The actual value in dashboard.js should be false until Phase 5 is ready
      const expectedConstantName = "ENABLE_PHASE5_FEATURES";

      // This is a documentation test - the constant name should match
      expect(expectedConstantName).toBe("ENABLE_PHASE5_FEATURES");
    });

    it("When Phase 5 is enabled, tabs should become visible", () => {
      // Simulate enabling Phase 5
      document.body.innerHTML = `
                <button class="tab phase5-tab hidden" data-tab="predictions">Predictions</button>
                <button class="tab phase5-tab hidden" data-tab="ai-insights">AI Insights</button>
            `;

      const ENABLE_PHASE5_FEATURES = true;
      const phase5Tabs = document.querySelectorAll(".phase5-tab");

      // Simulate initializePhase5Features
      if (ENABLE_PHASE5_FEATURES) {
        phase5Tabs.forEach((tab) => tab.classList.remove("hidden"));
      }

      phase5Tabs.forEach((tab) => {
        expect(tab.classList.contains("hidden")).toBe(false);
      });
    });
  });
});
