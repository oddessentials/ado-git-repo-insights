/**
 * Tests for the canonical UUID helper — the single source of truth for
 * detecting GUID-shaped strings in the UI-invariant gates (#308).
 */

import {
  UUID_REGEX,
  isUuid,
  findFirstUuid,
} from "../../../ui/modules/shared/uuid-pattern";

const CANONICAL_LOWER = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
const CANONICAL_UPPER = "F47AC10B-58CC-4372-A567-0E02B2C3D479";
const CANONICAL_MIXED = "F47ac10B-58CC-4372-a567-0E02B2C3D479";
const SECOND_UUID = "12345678-1234-1234-1234-123456789abc";

describe("UUID_REGEX (unanchored)", () => {
  test("matches a bare canonical UUID", () => {
    expect(UUID_REGEX.test(CANONICAL_LOWER)).toBe(true);
  });

  test("matches a UUID embedded in a sentence", () => {
    expect(
      UUID_REGEX.test(`Drill into ${CANONICAL_LOWER} for week of 2025-W17`),
    ).toBe(true);
  });

  test("is case-insensitive", () => {
    expect(UUID_REGEX.test(CANONICAL_UPPER)).toBe(true);
    expect(UUID_REGEX.test(CANONICAL_MIXED)).toBe(true);
  });

  test("is stateless across calls (no global flag)", () => {
    const input = CANONICAL_LOWER;
    expect(UUID_REGEX.test(input)).toBe(true);
    expect(UUID_REGEX.test(input)).toBe(true);
    expect(UUID_REGEX.test(input)).toBe(true);
  });

  test("does not match a non-UUID string", () => {
    expect(UUID_REGEX.test("alice@example.com")).toBe(false);
    expect(UUID_REGEX.test("Week of Mar 18 – 24, 2025")).toBe(false);
    expect(UUID_REGEX.test("")).toBe(false);
  });

  test("does not match a near-UUID with wrong group lengths", () => {
    expect(UUID_REGEX.test("f47ac10b-58cc-4372-a567-0e02b2c3d47")).toBe(false);
    expect(UUID_REGEX.test("f47ac10-58cc-4372-a567-0e02b2c3d479")).toBe(false);
  });
});

describe("isUuid (whole-string)", () => {
  test("returns true for a bare UUID", () => {
    expect(isUuid(CANONICAL_LOWER)).toBe(true);
    expect(isUuid(CANONICAL_UPPER)).toBe(true);
  });

  test("returns false when the UUID is embedded in a longer string", () => {
    expect(isUuid(` ${CANONICAL_LOWER}`)).toBe(false);
    expect(isUuid(`${CANONICAL_LOWER} `)).toBe(false);
    expect(isUuid(`id=${CANONICAL_LOWER}`)).toBe(false);
  });

  test("returns false for non-UUID strings", () => {
    expect(isUuid("Unknown user")).toBe(false);
    expect(isUuid("alice@example.com")).toBe(false);
    expect(isUuid("")).toBe(false);
  });
});

describe("findFirstUuid", () => {
  test("returns the UUID when present", () => {
    expect(findFirstUuid(CANONICAL_LOWER)).toBe(CANONICAL_LOWER);
  });

  test("returns the first UUID when multiple are present", () => {
    expect(findFirstUuid(`${CANONICAL_LOWER} vs ${SECOND_UUID}`)).toBe(
      CANONICAL_LOWER,
    );
  });

  test("returns null when no UUID is present", () => {
    expect(findFirstUuid("Unknown user")).toBeNull();
    expect(findFirstUuid("")).toBeNull();
  });
});
