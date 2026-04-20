/**
 * Identity display-name fallback — single source of truth for the
 * visible-text fallback used when a user/reviewer id cannot be resolved
 * to a friendly name (#308 invariant: no GUID in visible text).
 *
 * Consumers: throughput drill-down (By-author rows), reviewer drill-down
 * (panel title), reviewer-activity chart (aria-label). The
 * fallback-consistency invariant gate imports `UNKNOWN_USER_LABEL` here
 * so future drift (e.g. a caller hard-coding "Unknown" or "—") is
 * caught at test time.
 */

export const UNKNOWN_USER_LABEL = "Unknown user";

/** Resolve `id` against `map` (built once per render from a dimension
 *  array); fall back to `UNKNOWN_USER_LABEL` when the id is absent. Never
 *  throws — callers that receive undefined/null dimensions build an
 *  empty map so every id falls through to the label. */
export function resolveDisplayName(
  id: string,
  map: ReadonlyMap<string, string>,
): string {
  return map.get(id) ?? UNKNOWN_USER_LABEL;
}
