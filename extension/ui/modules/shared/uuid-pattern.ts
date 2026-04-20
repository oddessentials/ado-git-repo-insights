/**
 * Canonical UUID pattern — single source of truth for the
 * "no GUID in visible text" UI invariant (#308).
 *
 * Every production site and every invariant gate that needs to detect a
 * UUID-shaped string MUST import from this module. The
 * `uuid-regex-uniqueness.test.ts` gate grep-checks the repo for the
 * literal `[0-9a-f]{8}-[0-9a-f]{4}` fragment and fails if any `.ts`
 * source other than this file defines its own copy.
 */

const UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** Unanchored, case-insensitive. Use for substring detection (e.g. an
 *  aria-label that embeds a UUID inside a sentence). No `g` flag, so
 *  `.test` / `.exec` are stateless across calls. */
export const UUID_REGEX: RegExp = new RegExp(UUID_PATTERN, "i");

const UUID_WHOLE_STRING_REGEX = new RegExp(`^${UUID_PATTERN}$`, "i");

/** Whole-string match. Use when checking whether a field value IS a UUID
 *  (e.g. rejecting `PanelRow.label` that is itself a bare GUID). */
export function isUuid(value: string): boolean {
  return UUID_WHOLE_STRING_REGEX.test(value);
}

/** Returns the first UUID substring (lowercased by the match) for
 *  diagnostic reporting in invariant-gate failures; returns `null` when
 *  no UUID is present. */
export function findFirstUuid(value: string): string | null {
  const match = UUID_REGEX.exec(value);
  return match === null ? null : match[0];
}
