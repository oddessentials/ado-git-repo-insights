/**
 * Tests for isValidIsoDatetime string-parsing validation function.
 *
 * Covers fractional seconds, timezone suffixes, and invalid formats
 * to ensure full branch coverage of the replacement implementation
 * that eliminated the detect-unsafe-regex suppression.
 */

import { validateIsoDatetime } from "../../ui/schemas/utils";

describe("validateIsoDatetime edge cases", () => {
  // --- Valid formats that must pass ---

  it("accepts bare datetime without fractional or timezone", () => {
    expect(validateIsoDatetime("2024-01-15T10:30:00", "ts")).toBeNull();
  });

  it("accepts datetime with Z timezone", () => {
    expect(validateIsoDatetime("2024-01-15T10:30:00Z", "ts")).toBeNull();
  });

  it("accepts datetime with positive timezone offset", () => {
    expect(validateIsoDatetime("2024-01-15T10:30:00+05:30", "ts")).toBeNull();
  });

  it("accepts datetime with negative timezone offset", () => {
    expect(validateIsoDatetime("2024-01-15T10:30:00-08:00", "ts")).toBeNull();
  });

  it("accepts datetime with 1-digit fractional seconds", () => {
    expect(validateIsoDatetime("2024-01-15T10:30:00.1", "ts")).toBeNull();
  });

  it("accepts datetime with 6-digit fractional seconds", () => {
    expect(validateIsoDatetime("2024-01-15T10:30:00.123456", "ts")).toBeNull();
  });

  it("accepts datetime with fractional seconds and Z timezone", () => {
    expect(validateIsoDatetime("2024-01-15T10:30:00.123456Z", "ts")).toBeNull();
  });

  it("accepts datetime with fractional seconds and offset timezone", () => {
    expect(
      validateIsoDatetime("2024-01-15T10:30:00.123+05:30", "ts"),
    ).toBeNull();
  });

  // --- Invalid formats that must fail ---

  it("rejects too-short input", () => {
    expect(validateIsoDatetime("2024-01-15", "ts")).not.toBeNull();
  });

  it("rejects invalid date separator", () => {
    expect(validateIsoDatetime("2024/01/15T10:30:00", "ts")).not.toBeNull();
  });

  it("rejects missing T separator", () => {
    expect(validateIsoDatetime("2024-01-15 10:30:00", "ts")).not.toBeNull();
  });

  it("rejects 7-digit fractional seconds (exceeds 6-digit limit)", () => {
    expect(
      validateIsoDatetime("2024-01-15T10:30:00.1234567", "ts"),
    ).not.toBeNull();
  });

  it("rejects fractional dot with no digits", () => {
    expect(validateIsoDatetime("2024-01-15T10:30:00.", "ts")).not.toBeNull();
  });

  it("rejects malformed timezone offset (missing digit)", () => {
    expect(
      validateIsoDatetime("2024-01-15T10:30:00+5:30", "ts"),
    ).not.toBeNull();
  });

  it("rejects trailing garbage after valid datetime", () => {
    expect(
      validateIsoDatetime("2024-01-15T10:30:00Zextra", "ts"),
    ).not.toBeNull();
  });

  it("rejects non-string input", () => {
    expect(validateIsoDatetime(12345, "ts")).not.toBeNull();
  });
});
