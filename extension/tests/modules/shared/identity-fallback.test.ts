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
  const UUID = "f47ac10b-58cc-4372-a567-0e02b2c3d479";

  test("returns the mapped name when the id is present", () => {
    const map = new Map([
      ["id-1", "Alice"],
      ["id-2", "Bob"],
    ]);
    expect(resolveDisplayName("id-1", map)).toBe("Alice");
    expect(resolveDisplayName("id-2", map)).toBe("Bob");
  });

  test("returns the raw id when it is NOT UUID-shaped and missing from the map", () => {
    // Codex stop-hook catch: non-UUID ids (emails, usernames, short
    // codes) are already human-readable; masking them as "Unknown
    // user" hides useful information. Only UUID-shaped ids fall back.
    const map = new Map([["id-1", "Alice"]]);
    expect(resolveDisplayName("alice@example.com", map)).toBe(
      "alice@example.com",
    );
    expect(resolveDisplayName("legacy-user-42", map)).toBe("legacy-user-42");
  });

  test("returns UNKNOWN_USER_LABEL when the id IS UUID-shaped and missing from the map", () => {
    expect(resolveDisplayName(UUID, new Map())).toBe(UNKNOWN_USER_LABEL);
    const mapWithOthers = new Map([["some-other-id", "Bob"]]);
    expect(resolveDisplayName(UUID, mapWithOthers)).toBe(UNKNOWN_USER_LABEL);
  });

  test("mapped name wins over the UUID-shape check (resolution beats masking)", () => {
    // If the dimension is authoritative and the id happens to be a
    // UUID, the mapped friendly name is still what surfaces.
    const map = new Map([[UUID, "Alice Resolved"]]);
    expect(resolveDisplayName(UUID, map)).toBe("Alice Resolved");
  });

  test("returns UNKNOWN_USER_LABEL when the id CONTAINS a UUID substring (second Codex catch)", () => {
    // Fallback uses containsUuid (substring) rather than isUuid
    // (whole-string) so an id like "user-<uuid>" cannot slip past.
    // Otherwise the rendered raw id would trip the visible-text
    // invariant gate or the C4 builder UUID guard.
    expect(resolveDisplayName(`user-${UUID}`, new Map())).toBe(
      UNKNOWN_USER_LABEL,
    );
    expect(resolveDisplayName(`${UUID}-suffix`, new Map())).toBe(
      UNKNOWN_USER_LABEL,
    );
    expect(resolveDisplayName(`prefix ${UUID} suffix`, new Map())).toBe(
      UNKNOWN_USER_LABEL,
    );
  });

  test("returns UNKNOWN_USER_LABEL when the map is empty AND id is UUID-shaped", () => {
    expect(resolveDisplayName(UUID, new Map())).toBe(UNKNOWN_USER_LABEL);
  });

  test("returns the raw id when the map is empty AND id is NOT UUID-shaped", () => {
    expect(resolveDisplayName("any-id", new Map())).toBe("any-id");
  });

  test("treats empty-string names as legitimate and returns them verbatim", () => {
    // Intentional: an empty display name is an upstream data-quality
    // signal, not a missing id. Fallback must only fire on cache miss.
    const map = new Map([["id-1", ""]]);
    expect(resolveDisplayName("id-1", map)).toBe("");
  });
});
