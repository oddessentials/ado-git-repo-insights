/**
 * Tests for the identity display-name fallback helper — the single
 * source of truth for visible-text copy when a user/reviewer id cannot
 * be resolved against the dimensions dataset (#308).
 */

import {
  UNKNOWN_USER_LABEL,
  resolveDisplayName,
} from "../../../ui/modules/shared/identity-fallback";

describe("UNKNOWN_USER_LABEL", () => {
  test("is the literal string 'Unknown user' (copy is a locked invariant)", () => {
    expect(UNKNOWN_USER_LABEL).toBe("Unknown user");
  });
});

describe("resolveDisplayName", () => {
  test("returns the mapped name when the id is present", () => {
    const map = new Map([
      ["id-1", "Alice"],
      ["id-2", "Bob"],
    ]);
    expect(resolveDisplayName("id-1", map)).toBe("Alice");
    expect(resolveDisplayName("id-2", map)).toBe("Bob");
  });

  test("returns UNKNOWN_USER_LABEL when the id is absent from the map", () => {
    const map = new Map([["id-1", "Alice"]]);
    expect(resolveDisplayName("missing-id", map)).toBe(UNKNOWN_USER_LABEL);
  });

  test("returns UNKNOWN_USER_LABEL when the map is empty", () => {
    expect(resolveDisplayName("any-id", new Map())).toBe(UNKNOWN_USER_LABEL);
  });

  test("treats empty-string names as legitimate and returns them verbatim", () => {
    // Intentional: an empty display name is an upstream data-quality
    // signal, not a missing id. Fallback must only fire on cache miss.
    const map = new Map([["id-1", ""]]);
    expect(resolveDisplayName("id-1", map)).toBe("");
  });
});
