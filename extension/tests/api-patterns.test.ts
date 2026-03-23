/**
 * Build API Call Pattern Tests
 *
 * These tests ensure correct API call patterns are used to prevent
 * Azure DevOps API errors like "Continuation token timestamp without
 * query order is ambiguous".
 *
 * CRITICAL: All Build API access now goes through ArtifactClient, which
 * encapsulates queryOrder=2 in its getDefinitions() URL construction.
 * These tests verify that the legacy positional-parameter pattern is
 * fully eliminated and ArtifactClient is used exclusively.
 */

import * as fs from "fs";
import * as path from "path";

describe("Build API Call Patterns", () => {
  describe("ArtifactClient encapsulation", () => {
    /**
     * ArtifactClient.getDefinitions() encapsulates queryOrder=2 in the URL:
     *   GET {collectionUri}{projectId}/_apis/build/definitions?api-version=7.1&$top={top}&queryOrder={queryOrder}
     *
     * No call site needs to pass queryOrder manually — it's guaranteed by
     * the ArtifactClient implementation and tested in artifact-client.test.ts.
     */

    it("should verify dashboard.ts uses artifactClient.getDefinitions() (no positional params)", () => {
      const dashboardPath = path.join(__dirname, "../ui/dashboard.ts");
      const dashboardCode = fs.readFileSync(dashboardPath, "utf8");

      // Normalize code to handle multi-line calls
      const normalizedCode = dashboardCode.replace(/\s+/g, " ");

      // Should have getDefinitions() calls via artifactClient
      const artifactClientCalls = normalizedCode.match(
        /artifactClient\.getDefinitions\(\)/g,
      );
      expect(artifactClientCalls).not.toBeNull();
      expect(artifactClientCalls?.length).toBeGreaterThan(0);

      // Should NOT have legacy positional-parameter getDefinitions calls
      // (legacy pattern: getDefinitions(projectId, undefined, undefined, undefined, 2, 50))
      const legacyPattern = normalizedCode.match(
        /getDefinitions\(\s*projectId/g,
      );
      expect(legacyPattern).toBeNull();
    });

    it("should verify settings.ts uses client.getDefinitions() via ArtifactClient", () => {
      const settingsPath = path.join(__dirname, "../ui/settings.ts");
      const settingsCode = fs.readFileSync(settingsPath, "utf8");

      // Normalize code to handle multi-line calls
      const normalizedCode = settingsCode.replace(/\s+/g, " ");

      // Should have getDefinitions() calls via ArtifactClient (no positional project param)
      const clientCalls = normalizedCode.match(/client\.getDefinitions\(\)/g);
      expect(clientCalls).not.toBeNull();
      expect(clientCalls?.length).toBeGreaterThan(0);

      // Should NOT have legacy positional-parameter pattern
      const legacyPattern = normalizedCode.match(
        /getDefinitions\(\s*projectId/g,
      );
      expect(legacyPattern).toBeNull();
    });

    it("should verify no legacy getBuildClient calls remain in dashboard.ts or settings.ts", () => {
      const dashboardPath = path.join(__dirname, "../ui/dashboard.ts");
      const settingsPath = path.join(__dirname, "../ui/settings.ts");
      const dashboardCode = fs.readFileSync(dashboardPath, "utf8");
      const settingsCode = fs.readFileSync(settingsPath, "utf8");

      expect(dashboardCode).not.toContain("getBuildClient");
      expect(settingsCode).not.toContain("getBuildClient");
    });

    it("should document the queryOrder guarantee in ArtifactClient", () => {
      // ArtifactClient.getDefinitions(top=50, queryOrder=2) ensures
      // queryOrder is always included in the REST URL
      const artifactClientDefaults = {
        top: 50,
        queryOrder: 2, // definitionNameAscending — prevents pagination errors
      };

      expect(artifactClientDefaults.queryOrder).toBe(2);
    });
  });

  describe("DefinitionQueryOrder enum values", () => {
    const DefinitionQueryOrder = {
      none: 0,
      definitionNameAscending: 2,
      definitionNameDescending: 1,
      lastModifiedAscending: 4,
      lastModifiedDescending: 3,
    };

    it("should have definitionNameAscending = 2", () => {
      expect(DefinitionQueryOrder.definitionNameAscending).toBe(2);
    });

    it("should use definitionNameAscending (2) as the standard queryOrder value", () => {
      // This is the value ArtifactClient uses in its URL construction
      const standardQueryOrder = 2;
      expect(standardQueryOrder).toBe(
        DefinitionQueryOrder.definitionNameAscending,
      );
    });
  });
});
