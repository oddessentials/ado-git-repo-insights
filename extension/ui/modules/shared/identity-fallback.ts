/**
 * Identity display-name fallback — single source of truth for the
 * visible-text fallback used when a user/reviewer id cannot be resolved
 * to a friendly name (#308 invariant: no GUID in visible text).
 *
 * Fallback semantics (Codex stop-hook catch):
 *   - When the id is present in the dimension map → mapped name.
 *   - When the id is absent AND UUID-shaped → `UNKNOWN_USER_LABEL`
 *     (showing it verbatim would leak a GUID, which is exactly what
 *     #308 prohibits).
 *   - When the id is absent AND NOT UUID-shaped → raw id (emails,
 *     usernames, short codes etc. are already human-readable; masking
 *     them as "Unknown user" hides legitimately useful information).
 *
 * Consumers: throughput drill-down (By-author rows), reviewer drill-down
 * (panel title), reviewer-activity chart (aria-label) via the
 * dashboard wrapper. The fallback-consistency invariant gate imports
 * `UNKNOWN_USER_LABEL` here so future drift (e.g. a caller hard-coding
 * "Unknown" or "—") is caught at test time.
 */

import { isUuid } from "./uuid-pattern";

export const UNKNOWN_USER_LABEL = "Unknown user";

/** Resolve `id` against `map` (built once per render from a dimension
 *  array). Returns the mapped name when present; otherwise returns the
 *  raw id when it is not UUID-shaped, or `UNKNOWN_USER_LABEL` when it
 *  is. Never throws — callers that receive undefined/null dimensions
 *  build an empty map so every id is re-evaluated against its own
 *  shape. */
export function resolveDisplayName(
  id: string,
  map: ReadonlyMap<string, string>,
): string {
  const mapped = map.get(id);
  if (mapped !== undefined) return mapped;
  return isUuid(id) ? UNKNOWN_USER_LABEL : id;
}
