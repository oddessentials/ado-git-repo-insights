/**
 * Unit tests for comparison module.
 *
 * Pure function tests - no JSDOM required.
 */

import {
  formatComparisonDate,
  formatDateRangeDisplay,
  serializeComparisonToUrl,
  parseComparisonFromUrl,
  getComparisonBannerData,
} from "../../ui/modules/comparison";
import type { DateRange } from "../../ui/modules/metrics";

describe("comparison module", () => {
  describe("formatComparisonDate", () => {
    it("formats date with month, day, and year", () => {
      const date = new Date("2026-01-15T12:00:00Z");
      const result = formatComparisonDate(date);

      // Format should be like "Jan 15, 2026"
      expect(result).toMatch(/Jan\s+15,\s+2026/);
    });

    it("handles different months", () => {
      const date = new Date("2026-12-25T12:00:00Z");
      const result = formatComparisonDate(date);

      expect(result).toMatch(/Dec\s+25,\s+2026/);
    });

    it("handles single-digit days", () => {
      const date = new Date("2026-03-05T12:00:00Z");
      const result = formatComparisonDate(date);

      // Should contain "5" (not "05") based on typical en-US locale
      expect(result).toMatch(/Mar\s+5,\s+2026/);
    });
  });

  describe("formatDateRangeDisplay", () => {
    it("formats start and end dates with hyphen separator", () => {
      const start = new Date("2026-01-01T12:00:00Z");
      const end = new Date("2026-01-07T12:00:00Z");

      const result = formatDateRangeDisplay(start, end);

      expect(result).toContain(" - ");
      expect(result).toMatch(/Jan\s+1,\s+2026/);
      expect(result).toMatch(/Jan\s+7,\s+2026/);
    });

    it("handles dates spanning different months", () => {
      const start = new Date("2026-01-28T12:00:00Z");
      const end = new Date("2026-02-03T12:00:00Z");

      const result = formatDateRangeDisplay(start, end);

      expect(result).toMatch(/Jan\s+28,\s+2026/);
      expect(result).toMatch(/Feb\s+3,\s+2026/);
    });

    it("handles dates spanning different years", () => {
      const start = new Date("2025-12-25T12:00:00Z");
      const end = new Date("2026-01-01T12:00:00Z");

      const result = formatDateRangeDisplay(start, end);

      expect(result).toMatch(/Dec\s+25,\s+2025/);
      expect(result).toMatch(/Jan\s+1,\s+2026/);
    });
  });

  describe("serializeComparisonToUrl", () => {
    it("sets compare=1 when enabled", () => {
      const params = new URLSearchParams();

      serializeComparisonToUrl(true, params);

      expect(params.get("compare")).toBe("1");
    });

    it("removes compare param when disabled", () => {
      const params = new URLSearchParams("compare=1");

      serializeComparisonToUrl(false, params);

      expect(params.has("compare")).toBe(false);
    });

    it("overwrites existing compare param", () => {
      const params = new URLSearchParams("compare=0");

      serializeComparisonToUrl(true, params);

      expect(params.get("compare")).toBe("1");
    });

    it("preserves other params when setting compare", () => {
      const params = new URLSearchParams("repos=repo-a&teams=team-x");

      serializeComparisonToUrl(true, params);

      expect(params.get("compare")).toBe("1");
      expect(params.get("repos")).toBe("repo-a");
      expect(params.get("teams")).toBe("team-x");
    });
  });

  describe("parseComparisonFromUrl", () => {
    it("returns true when compare=1", () => {
      const params = new URLSearchParams("compare=1");

      expect(parseComparisonFromUrl(params)).toBe(true);
    });

    it("returns false when compare is not present", () => {
      const params = new URLSearchParams("");

      expect(parseComparisonFromUrl(params)).toBe(false);
    });

    it("returns false when compare has other value", () => {
      const params = new URLSearchParams("compare=0");

      expect(parseComparisonFromUrl(params)).toBe(false);
    });

    it("returns false when compare=true (not 1)", () => {
      const params = new URLSearchParams("compare=true");

      expect(parseComparisonFromUrl(params)).toBe(false);
    });
  });

  describe("getComparisonBannerData", () => {
    it("returns formatted date ranges when valid", () => {
      const currentRange: DateRange = {
        start: new Date("2026-01-08T12:00:00Z"),
        end: new Date("2026-01-14T12:00:00Z"),
      };
      const previousRange: DateRange = {
        start: new Date("2026-01-01T12:00:00Z"),
        end: new Date("2026-01-07T12:00:00Z"),
      };

      const result = getComparisonBannerData(currentRange, previousRange);

      expect(result).not.toBeNull();
      expect(result?.currentPeriod).toMatch(/Jan\s+8,\s+2026/);
      expect(result?.currentPeriod).toMatch(/Jan\s+14,\s+2026/);
      expect(result?.previousPeriod).toMatch(/Jan\s+1,\s+2026/);
      expect(result?.previousPeriod).toMatch(/Jan\s+7,\s+2026/);
    });

    it("returns null when currentRange.start is null", () => {
      const currentRange = {
        start: null as unknown as Date,
        end: new Date("2026-01-14T12:00:00Z"),
      };
      const previousRange: DateRange = {
        start: new Date("2026-01-01T12:00:00Z"),
        end: new Date("2026-01-07T12:00:00Z"),
      };

      const result = getComparisonBannerData(currentRange, previousRange);

      expect(result).toBeNull();
    });

    it("returns null when currentRange.end is null", () => {
      const currentRange = {
        start: new Date("2026-01-08T12:00:00Z"),
        end: null as unknown as Date,
      };
      const previousRange: DateRange = {
        start: new Date("2026-01-01T12:00:00Z"),
        end: new Date("2026-01-07T12:00:00Z"),
      };

      const result = getComparisonBannerData(currentRange, previousRange);

      expect(result).toBeNull();
    });

    it("returns correct structure with both periods formatted", () => {
      const currentRange: DateRange = {
        start: new Date("2026-02-01T12:00:00Z"),
        end: new Date("2026-02-28T12:00:00Z"),
      };
      const previousRange: DateRange = {
        start: new Date("2026-01-01T12:00:00Z"),
        end: new Date("2026-01-31T12:00:00Z"),
      };

      const result = getComparisonBannerData(currentRange, previousRange);

      expect(result).toEqual({
        currentPeriod: expect.stringMatching(/Feb.*2026.*-.*Feb.*2026/),
        previousPeriod: expect.stringMatching(/Jan.*2026.*-.*Jan.*2026/),
      });
    });
  });
});
