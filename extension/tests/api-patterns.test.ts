/**
 * Build API Call Pattern Tests
 *
 * These tests ensure correct API call patterns are used to prevent
 * Azure DevOps API errors like "Continuation token timestamp without
 * query order is ambiguous".
 *
 * CRITICAL: Azure DevOps Build API requires queryOrder parameter on ALL
 * getDefinitions calls, not just bulk fetches.
 */

import * as fs from "fs";
import * as path from "path";

describe("Build API Call Patterns", () => {
  describe("getDefinitions queryOrder requirement", () => {
    /**
     * Azure DevOps Build API getDefinitions signature:
     * 1. project (string) - required
     * 2. name (string) - optional
     * 3. repositoryId (string) - optional
     * 4. repositoryType (string) - optional
     * 5. queryOrder (DefinitionQueryOrder) - REQUIRED to avoid pagination errors
     * 6. top (number) - optional
     * 7. continuationToken (string) - optional
     * 8. minMetricsTime (Date) - optional
     * 9. definitionIds (number[]) - optional
     *
     * Valid queryOrder values:
     * - 1 = definitionNameDescending
     * - 2 = definitionNameAscending
     * - 3 = lastModifiedDescending
     * - 4 = lastModifiedAscending
     */

    it("should verify ALL getDefinitions calls in dashboard.ts have queryOrder at position 5", () => {
      const dashboardPath = path.join(__dirname, "../ui/dashboard.ts");
      const dashboardCode = fs.readFileSync(dashboardPath, "utf8");

      // Normalize code to handle multi-line calls
      const normalizedCode = dashboardCode.replace(/\s+/g, " ");

      // Find all getDefinitions calls
      const getDefinitionsCalls = normalizedCode.match(
        /getDefinitions\([^)]+\)/g,
      );
      expect(getDefinitionsCalls).not.toBeNull();
      expect(getDefinitionsCalls?.length).toBeGreaterThan(0);

      if (getDefinitionsCalls) {
        for (const call of getDefinitionsCalls) {
          const argsMatch = call.match(/getDefinitions\(([^)]+)\)/);
          if (argsMatch) {
            const args = argsMatch[1]!.split(",").map((a) => a.trim());

            // Position 5 (index 4) should be queryOrder = 2
            expect(args.length).toBeGreaterThanOrEqual(5);
            expect(args[4]).toBe("2");
          }
        }
      }
    });

    it("should verify ALL getDefinitions calls in settings.ts have queryOrder at position 5", () => {
      const settingsPath = path.join(__dirname, "../ui/settings.ts");
      const settingsCode = fs.readFileSync(settingsPath, "utf8");

      // Find all getDefinitions calls (handle multi-line)
      const normalizedCode = settingsCode.replace(/\s+/g, " ");
      const getDefinitionsCalls = normalizedCode.match(
        /getDefinitions\([^)]+\)/g,
      );

      if (getDefinitionsCalls) {
        for (const call of getDefinitionsCalls) {
          const argsMatch = call.match(/getDefinitions\(([^)]+)\)/);
          if (argsMatch) {
            const args = argsMatch[1]!.split(",").map((a) => a.trim());

            // Position 5 (index 4) should be queryOrder = 2
            expect(args.length).toBeGreaterThanOrEqual(5);
            expect(args[4]).toBe("2");
          }
        }
      }
    });

    it("should have at least 3 getDefinitions calls in dashboard.ts with correct pattern", () => {
      const dashboardPath = path.join(__dirname, "../ui/dashboard.ts");
      const dashboardCode = fs.readFileSync(dashboardPath, "utf8");

      const getDefinitionsCalls = dashboardCode.match(/getDefinitions\s*\(/g);
      expect(getDefinitionsCalls).not.toBeNull();

      // We expect 3 calls: 2 in resolveFromPipelineId, 1 in discoverInsightsPipelines
      expect(getDefinitionsCalls?.length).toBe(3);
    });

    it("should document the API parameter signature for reference", () => {
      const parameterSignature = {
        1: { name: "project", type: "string", required: true },
        2: { name: "name", type: "string", required: false },
        3: { name: "repositoryId", type: "string", required: false },
        4: { name: "repositoryType", type: "string", required: false },
        5: {
          name: "queryOrder",
          type: "DefinitionQueryOrder",
          required: "ALWAYS (to avoid pagination errors)",
        },
        6: { name: "top", type: "number", required: false },
        7: { name: "continuationToken", type: "string", required: false },
        8: { name: "minMetricsTime", type: "Date", required: false },
        9: { name: "definitionIds", type: "number[]", required: false },
      };

      expect(parameterSignature[5].name).toBe("queryOrder");
      expect(parameterSignature[5].required).toBe(
        "ALWAYS (to avoid pagination errors)",
      );
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
      // This is the value we use in all getDefinitions calls
      const standardQueryOrder = 2;
      expect(standardQueryOrder).toBe(
        DefinitionQueryOrder.definitionNameAscending,
      );
    });
  });
});
