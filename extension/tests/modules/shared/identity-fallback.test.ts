/**
 * Tests for `resolveDisplayName` — the identity resolver (#308 reshape).
 *
 * Contract: on miss, return the raw id (no masking). Callers that want
 * to hide unresolved GUIDs should ensure the dimension is populated
 * before rendering; the helper itself does not enforce the invariant.
 */

import { resolveDisplayName } from "../../../ui/modules/shared/identity-fallback";

const UUID = "f47ac10b-58cc-4372-a567-0e02b2c3d479";

describe("resolveDisplayName", () => {
  test("returns the mapped name when the id is present", () => {
    const map = new Map([
      ["id-1", "Alice"],
      ["id-2", "Bob"],
    ]);
    expect(resolveDisplayName("id-1", map)).toBe("Alice");
    expect(resolveDisplayName("id-2", map)).toBe("Bob");
  });

  test("returns the raw id when the id is absent from the map (non-UUID)", () => {
    const map = new Map([["id-1", "Alice"]]);
    expect(resolveDisplayName("alice@example.com", map)).toBe(
      "alice@example.com",
    );
    expect(resolveDisplayName("legacy-user-42", map)).toBe("legacy-user-42");
  });

  test("returns the raw id when the id is absent from the map (UUID — rare cosmetic leak)", () => {
    // Reshape: GUIDs are allowed to surface as a rare partial-
    // dimension case rather than crashing or masking every row.
    expect(resolveDisplayName(UUID, new Map())).toBe(UUID);
    const mapWithOthers = new Map([["some-other-id", "Bob"]]);
    expect(resolveDisplayName(UUID, mapWithOthers)).toBe(UUID);
  });

  test("returns the raw id when the id embeds a UUID substring", () => {
    // Also no masking for the embedded-UUID case.
    const prefixed = `user-${UUID}`;
    expect(resolveDisplayName(prefixed, new Map())).toBe(prefixed);
  });

  test("mapped name wins over raw id when both could apply", () => {
    const map = new Map([[UUID, "Alice Resolved"]]);
    expect(resolveDisplayName(UUID, map)).toBe("Alice Resolved");
  });

  test("returns the raw id when the map is empty", () => {
    expect(resolveDisplayName("any-id", new Map())).toBe("any-id");
    expect(resolveDisplayName(UUID, new Map())).toBe(UUID);
  });

  test("treats empty-string names as legitimate mapped values", () => {
    // Intentional: an empty display name is an upstream data-quality
    // signal, not a missing id. Callers get what the dimension gave.
    const map = new Map([["id-1", ""]]);
    expect(resolveDisplayName("id-1", map)).toBe("");
  });
});
