/**
 * Identity display-name resolver (#308).
 *
 * Contract (revised after stop-hook + reviewer feedback that runtime
 * masking was harming users):
 *
 *   - When `id` is present in the dimension map → mapped friendly name
 *     (this is the primary fix for #308 — happy-path resolution).
 *   - When `id` is absent from the map → raw `id` (including the case
 *     where the id is a UUID). Masking every miss as "Unknown user"
 *     collapsed partial-dimension panels into an indistinguishable
 *     list of identical rows, and construction-time UUID rejection
 *     turned a cosmetic leak into a hard panel crash.
 *
 * #308 is satisfied by resolving under the happy path, not by
 * refusing to render when the resolver misses. The `ui-invariants`
 * gates assert no GUID leak on happy-path fixtures; partial-dimension
 * fixtures assert graceful rendering without throw.
 */

export function resolveDisplayName(
  id: string,
  map: ReadonlyMap<string, string>,
): string {
  const mapped = map.get(id);
  return mapped !== undefined ? mapped : id;
}
