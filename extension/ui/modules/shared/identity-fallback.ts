/**
 * Identity display-name fallback — single source of truth for the
 * visible-text fallback used when a user/reviewer id cannot be resolved
 * to a friendly name (#308 invariant: no GUID in visible text).
 *
 * Fallback semantics:
 *   - When the id is present in the dimension map → mapped name.
 *   - When the id is absent AND contains any UUID substring →
 *     `UNKNOWN_USER_LABEL`. The check uses the SUBSTRING form
 *     (`containsUuid`) rather than a whole-string match so it aligns
 *     with the visible-text invariant gate and the construction-time
 *     builder guard — otherwise an id like `"user-<uuid>"` would slip
 *     past here but fail at the invariant assertion or throw inside
 *     `makeBreakdownTable` (second Codex stop-hook catch).
 *   - When the id is absent AND contains NO UUID substring → raw id
 *     (emails, usernames, short codes etc. are already human-readable;
 *     masking them as "Unknown user" hides useful information — first
 *     Codex catch).
 *
 * Consumers: throughput drill-down (By-author rows), reviewer drill-down
 * (panel title), reviewer-activity chart (aria-label) via the
 * dashboard wrapper. The fallback-consistency invariant gate imports
 * `UNKNOWN_USER_LABEL` here so future drift (e.g. a caller hard-coding
 * "Unknown" or "—") is caught at test time.
 */

import { containsUuid } from "./uuid-pattern";

export const UNKNOWN_USER_LABEL = "Unknown user";

/** Resolve `id` against `map` (built once per render from a dimension
 *  array). Returns the mapped name when present; otherwise returns the
 *  raw id when it contains no UUID substring, or `UNKNOWN_USER_LABEL`
 *  when it does. Never throws — callers that receive undefined/null
 *  dimensions build an empty map so every id is re-evaluated against
 *  the visible-text invariant. */
export function resolveDisplayName(
  id: string,
  map: ReadonlyMap<string, string>,
): string {
  const mapped = map.get(id);
  if (mapped !== undefined) return mapped;
  return containsUuid(id) ? UNKNOWN_USER_LABEL : id;
}
