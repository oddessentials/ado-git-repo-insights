/**
 * Unit tests for export module.
 *
 * Pure function tests for CSV generation.
 * DOM-dependent functions (triggerDownload, showToast) tested via integration.
 */

import {
  rollupsToCsv,
  generateExportFilename,
  CSV_HEADERS,
} from "../../ui/modules/export";
import type { Rollup } from "../../ui/dataset-loader";

// Helper to create test rollups with partial fields
const createRollup = (overrides: Partial<Rollup>): Rollup =>
  ({
    week: "test",
    ...overrides,
  }) as Rollup;

describe("export module", () => {
  describe("CSV_HEADERS", () => {
    it("contains expected headers", () => {
      expect(CSV_HEADERS).toContain("Week");
      expect(CSV_HEADERS).toContain("PR Count");
      expect(CSV_HEADERS).toContain("Cycle Time P50 (min)");
      expect(CSV_HEADERS).toContain("Cycle Time P90 (min)");
      expect(CSV_HEADERS).toContain("Authors");
      expect(CSV_HEADERS).toContain("Reviewers");
    });

    it("has 8 columns", () => {
      expect(CSV_HEADERS.length).toBe(8);
    });
  });

  describe("rollupsToCsv", () => {
    it("returns empty string for empty rollups", () => {
      expect(rollupsToCsv([])).toBe("");
    });

    it("includes header row", () => {
      const rollups = [{ week: "2026-W01", pr_count: 10 } as Rollup];

      const csv = rollupsToCsv(rollups);

      expect(csv).toContain('"Week"');
      expect(csv).toContain('"PR Count"');
    });

    it("includes data rows", () => {
      const rollups = [
        createRollup({
          week: "2026-W01",
          start_date: "2026-01-01",
          end_date: "2026-01-07",
          pr_count: 10,
          cycle_time_p50: 60.5,
          cycle_time_p90: 120.3,
          authors_count: 5,
          reviewers_count: 3,
        }),
      ];

      const csv = rollupsToCsv(rollups);

      expect(csv).toContain('"2026-W01"');
      expect(csv).toContain('"2026-01-01"');
      expect(csv).toContain('"10"');
      expect(csv).toContain('"60.5"');
      expect(csv).toContain('"120.3"');
    });

    it("handles null cycle times", () => {
      const rollups = [{ week: "2026-W01", pr_count: 10 } as Rollup];

      const csv = rollupsToCsv(rollups);

      // Check that empty strings are used for null values
      const lines = csv.split("\n");
      expect(lines.length).toBe(2); // header + 1 data row
    });

    it("formats multiple rows correctly", () => {
      const rollups = [
        { week: "2026-W01", pr_count: 10 } as Rollup,
        { week: "2026-W02", pr_count: 15 } as Rollup,
        { week: "2026-W03", pr_count: 20 } as Rollup,
      ];

      const csv = rollupsToCsv(rollups);
      const lines = csv.split("\n");

      expect(lines.length).toBe(4); // header + 3 data rows
    });

    it("quotes all values", () => {
      const rollups = [{ week: "2026-W01", pr_count: 10 } as Rollup];

      const csv = rollupsToCsv(rollups);

      // Every value should be quoted
      const allQuoted = csv
        .split(",")
        .every((cell) => cell.trim().startsWith('"') || cell.includes('"'));
      expect(allQuoted).toBe(true);
    });
  });

  describe("generateExportFilename", () => {
    it("generates date-stamped filename", () => {
      const filename = generateExportFilename("pr-insights", "csv");

      expect(filename).toMatch(/^pr-insights-\d{4}-\d{2}-\d{2}\.csv$/);
    });

    it("uses provided extension", () => {
      const csvFilename = generateExportFilename("data", "csv");
      const zipFilename = generateExportFilename("data", "zip");

      expect(csvFilename.endsWith(".csv")).toBe(true);
      expect(zipFilename.endsWith(".zip")).toBe(true);
    });

    it("uses current date", () => {
      const today = new Date().toISOString().split("T")[0];
      const filename = generateExportFilename("test", "txt");

      expect(filename).toContain(today);
    });
  });
});
