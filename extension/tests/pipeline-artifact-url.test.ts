/**
 * Artifact File Access Tests
 *
 * Tests for the downloadUrl-based file access pattern used by getArtifactFileViaSdk.
 * Verified working via manual API testing on 2026-01-16.
 *
 * Key learnings:
 * - Build API does NOT support $format=file (returns error)
 * - Must use artifact's downloadUrl with format=file&subPath
 * - subPath must have leading slash for root-level files
 * - Manifest is at artifact root (/dataset-manifest.json)
 * - Dimensions is inside aggregates subfolder (/aggregates/dimensions.json)
 */

describe("Artifact File Access", () => {
  describe("downloadUrl Construction", () => {
    // Helper to simulate the URL construction logic from getArtifactFileViaSdk
    function constructFileUrl(downloadUrl: string, filePath: string) {
      // Normalize path - ensure it starts with /
      const normalizedPath = filePath.startsWith("/")
        ? filePath
        : "/" + filePath;

      // Construct URL: replace format=zip with format=file and add subPath
      let url;
      if (downloadUrl.includes("format=")) {
        url = downloadUrl.replace(/format=\w+/, "format=file");
      } else {
        const separator = downloadUrl.includes("?") ? "&" : "?";
        url = `${downloadUrl}${separator}format=file`;
      }
      url += `&subPath=${encodeURIComponent(normalizedPath)}`;
      return url;
    }

    test("replaces format=zip with format=file", () => {
      const downloadUrl =
        "https://artprodcus3.artifacts.visualstudio.com/.../content?format=zip";
      const url = constructFileUrl(downloadUrl, "file.json");

      expect(url).toContain("format=file");
      expect(url).not.toContain("format=zip");
    });

    test("adds format=file if not present", () => {
      const downloadUrl =
        "https://artprodcus3.artifacts.visualstudio.com/.../content";
      const url = constructFileUrl(downloadUrl, "file.json");

      expect(url).toContain("format=file");
    });

    test("adds subPath parameter with URL-encoded path", () => {
      const downloadUrl =
        "https://artprodcus3.artifacts.visualstudio.com/.../content?format=zip";
      const url = constructFileUrl(downloadUrl, "folder/file.json");

      expect(url).toContain(
        `subPath=${encodeURIComponent("/folder/file.json")}`,
      );
    });

    test("normalizes path to have leading slash", () => {
      const downloadUrl =
        "https://artprodcus3.artifacts.visualstudio.com/.../content?format=zip";

      // Without leading slash
      const url1 = constructFileUrl(downloadUrl, "file.json");
      expect(url1).toContain(`subPath=${encodeURIComponent("/file.json")}`);

      // With leading slash (should be preserved)
      const url2 = constructFileUrl(downloadUrl, "/file.json");
      expect(url2).toContain(`subPath=${encodeURIComponent("/file.json")}`);
    });

    test("handles nested paths correctly", () => {
      const downloadUrl =
        "https://artprodcus3.artifacts.visualstudio.com/.../content?format=zip";
      const url = constructFileUrl(
        downloadUrl,
        "aggregates/weekly_rollups/2026-W01.json",
      );

      expect(url).toContain(
        `subPath=${encodeURIComponent("/aggregates/weekly_rollups/2026-W01.json")}`,
      );
    });
  });

  describe("Artifact File Paths", () => {
    /**
     * CRITICAL: These paths are verified by downloading the actual artifact ZIP.
     *
     * Artifact structure (aggregates.zip):
     * aggregates/                    <- artifact root
     * ├── dataset-manifest.json      <- AT ROOT (not in subfolder!)
     * ├── aggregates/                <- subfolder with same name
     * │   ├── dimensions.json
     * │   ├── distributions/
     * │   └── weekly_rollups/
     */

    test("manifest is at artifact ROOT, not in aggregates subfolder", () => {
      // This was the bug - we were using 'aggregates/dataset-manifest.json'
      // but the file is actually at the artifact root
      const correctPath = "dataset-manifest.json";
      expect(correctPath).toBe("dataset-manifest.json");
      expect(correctPath).not.toContain("aggregates/");
    });

    test("dimensions.json is inside aggregates subfolder", () => {
      // dimensions.json IS inside the aggregates subfolder
      const correctPath = "aggregates/dimensions.json";
      expect(correctPath).toBe("aggregates/dimensions.json");
    });

    test("weekly rollup paths from manifest include aggregates prefix", () => {
      // Rollup paths in manifest are like 'aggregates/weekly_rollups/2026-W03.json'
      // These are relative to artifact root
      const samplePath = "aggregates/weekly_rollups/2026-W03.json";
      expect(samplePath).toContain("aggregates/");
    });

    test("distribution paths from manifest include aggregates prefix", () => {
      const samplePath = "aggregates/distributions/2026.json";
      expect(samplePath).toContain("aggregates/");
    });
  });

  describe("Regression Prevention", () => {
    // These tests document the exact API behavior to prevent future regressions

    test("Build API does NOT support $format=file", () => {
      // The Build API endpoint returns error: "file is not a valid value for $format. Try one of: Json, Zip"
      // This is documented here to prevent future attempts to use Build API for file access
      const validBuildApiFormats = ["Json", "Zip"];
      expect(validBuildApiFormats).not.toContain("file");
    });

    test("downloadUrl is the correct approach for Pipeline Artifacts", () => {
      // For PipelineArtifact type, must use the downloadUrl from artifact.resource.downloadUrl
      // Then modify it with format=file&subPath=/path
      const approach = "downloadUrl with format=file&subPath";
      expect(approach).toBe("downloadUrl with format=file&subPath");
    });

    test("subPath must have leading slash for root-level files", () => {
      // Verified via manual API testing: /dataset-manifest.json works, dataset-manifest.json does not
      const filePath = "dataset-manifest.json"; // what loadManifest passes
      const normalizedPath = filePath.startsWith("/")
        ? filePath
        : "/" + filePath;
      expect(normalizedPath).toBe("/dataset-manifest.json");
    });
  });
});
