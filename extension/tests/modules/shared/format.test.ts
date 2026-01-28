/**
 * Tests for modules/shared/format.ts
 *
 * Verifies formatting utilities for dashboard modules:
 * - formatDuration
 * - formatPercentChange
 * - formatDate
 * - formatDateRange
 * - formatWeekLabel
 * - median
 */

import {
  formatDuration,
  formatPercentChange,
  formatDate,
  formatDateRange,
  formatWeekLabel,
  median,
} from "../../../ui/modules/shared/format";

describe("format utilities", () => {
  describe("formatDuration", () => {
    it("formats minutes less than 60 as minutes", () => {
      expect(formatDuration(30)).toBe("30m");
      expect(formatDuration(1)).toBe("1m");
      expect(formatDuration(59)).toBe("59m");
    });

    it("rounds minutes to nearest integer", () => {
      expect(formatDuration(30.4)).toBe("30m");
      expect(formatDuration(30.6)).toBe("31m");
    });

    it("formats 60-1440 minutes as hours", () => {
      expect(formatDuration(60)).toBe("1.0h");
      expect(formatDuration(90)).toBe("1.5h");
      expect(formatDuration(120)).toBe("2.0h");
      expect(formatDuration(23 * 60)).toBe("23.0h");
    });

    it("formats hours with one decimal place", () => {
      expect(formatDuration(75)).toBe("1.3h"); // 1.25 rounds to 1.3 or 1.2
      expect(formatDuration(66)).toBe("1.1h"); // 1.1
    });

    it("formats durations >= 24 hours as days", () => {
      expect(formatDuration(24 * 60)).toBe("1.0d");
      expect(formatDuration(48 * 60)).toBe("2.0d");
      expect(formatDuration(36 * 60)).toBe("1.5d");
    });

    it("handles zero", () => {
      expect(formatDuration(0)).toBe("0m");
    });

    it("handles large values", () => {
      expect(formatDuration(7 * 24 * 60)).toBe("7.0d"); // 1 week
    });
  });

  describe("formatPercentChange", () => {
    it("formats positive changes with plus sign", () => {
      expect(formatPercentChange(25)).toBe("+25%");
      expect(formatPercentChange(100)).toBe("+100%");
    });

    it("formats negative changes without explicit sign", () => {
      expect(formatPercentChange(-25)).toBe("-25%");
      expect(formatPercentChange(-100)).toBe("-100%");
    });

    it("formats zero with plus sign", () => {
      expect(formatPercentChange(0)).toBe("+0%");
    });

    it("rounds to nearest integer", () => {
      expect(formatPercentChange(25.4)).toBe("+25%");
      expect(formatPercentChange(25.6)).toBe("+26%");
      expect(formatPercentChange(-25.6)).toBe("-26%");
    });

    it("returns em-dash for null", () => {
      expect(formatPercentChange(null)).toBe("—");
    });

    it("returns em-dash for Infinity", () => {
      expect(formatPercentChange(Infinity)).toBe("—");
      expect(formatPercentChange(-Infinity)).toBe("—");
    });

    it("returns em-dash for NaN", () => {
      expect(formatPercentChange(NaN)).toBe("—");
    });
  });

  describe("formatDate", () => {
    it("formats date as short month and day", () => {
      // Use explicit local date to avoid timezone issues
      const date = new Date(2024, 0, 15); // Jan 15, 2024
      const result = formatDate(date);
      expect(result).toBe("Jan 15");
    });

    it("handles December dates", () => {
      const date = new Date(2024, 11, 25); // Dec 25, 2024
      const result = formatDate(date);
      expect(result).toBe("Dec 25");
    });

    it("handles single-digit days", () => {
      const date = new Date(2024, 2, 5); // Mar 5, 2024
      const result = formatDate(date);
      expect(result).toBe("Mar 5");
    });
  });

  describe("formatDateRange", () => {
    it("formats a date range with en-dash separator", () => {
      const start = new Date(2024, 0, 1); // Jan 1, 2024
      const end = new Date(2024, 0, 31); // Jan 31, 2024
      const result = formatDateRange(start, end);
      expect(result).toBe("Jan 1 – Jan 31");
    });
  });

  describe("formatWeekLabel", () => {
    it("extracts week number from ISO week format", () => {
      expect(formatWeekLabel("2024-W01")).toBe("W01");
      expect(formatWeekLabel("2024-W23")).toBe("W23");
      expect(formatWeekLabel("2024-W52")).toBe("W52");
    });

    it("returns original string for non-matching format", () => {
      expect(formatWeekLabel("2024-01-15")).toBe("2024-01-15");
      expect(formatWeekLabel("invalid")).toBe("invalid");
    });

    it("handles lowercase w", () => {
      // The regex expects capital W, so lowercase won't match
      expect(formatWeekLabel("2024-w01")).toBe("2024-w01");
    });
  });

  describe("median", () => {
    it("calculates median for odd-length array", () => {
      expect(median([1, 2, 3])).toBe(2);
      expect(median([1, 2, 3, 4, 5])).toBe(3);
      expect(median([5, 1, 3])).toBe(3); // sorts first
    });

    it("calculates median for even-length array", () => {
      expect(median([1, 2, 3, 4])).toBe(2.5);
      expect(median([1, 2])).toBe(1.5);
      expect(median([4, 1, 3, 2])).toBe(2.5); // sorts first
    });

    it("returns 0 for empty array", () => {
      expect(median([])).toBe(0);
    });

    it("returns 0 for non-array input", () => {
      // Type assertion to test runtime behavior
      expect(median(null as unknown as number[])).toBe(0);
      expect(median(undefined as unknown as number[])).toBe(0);
    });

    it("handles single element array", () => {
      expect(median([42])).toBe(42);
    });

    it("does not mutate original array", () => {
      const arr = [3, 1, 2];
      median(arr);
      expect(arr).toEqual([3, 1, 2]);
    });

    it("handles negative numbers", () => {
      expect(median([-5, -1, -3])).toBe(-3);
      expect(median([-2, 2])).toBe(0);
    });

    it("handles decimal numbers", () => {
      expect(median([1.5, 2.5, 3.5])).toBe(2.5);
    });
  });
});
