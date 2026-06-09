/**
 * Derive an Azure DevOps pull-request web URL at render time (feature 060).
 *
 * Per FR-005 / FR-005a:
 *   - URLs are NEVER persisted in rollup artifacts. This module composes
 *     every URL at render time from the PR id + the repositories dimension
 *     + the active web-context collection URI.
 *   - The happy path resolves the repository via the `repository_id` key
 *     in the dimension array and produces the named URL form:
 *       `{collectionUri}{project_name}/_git/{repository_name}/pullrequest/{pr.id}`.
 *   - The fallback form is used when the repository cannot be resolved
 *     (dimension missing, entry missing, or missing `repository_name`):
 *       `{collectionUri}_git/{repository_id}/pullrequest/{pr.id}`.
 *     Azure DevOps resolves this form without a project segment, so the
 *     row is still clickable — never blanked, never dropped.
 */

export interface PrUrlRepositoryEntry {
  readonly repository_id: string;
  readonly repository_name: string;
  readonly project_name: string;
  readonly organization_name?: string;
}

export interface PrUrlWebContext {
  readonly collectionUri: string;
}

export interface PrUrlPrRecord {
  readonly id: number;
  readonly repository_id: string;
}

function ensureTrailingSlash(uri: string): string {
  return uri.endsWith("/") ? uri : `${uri}/`;
}

/**
 * Percent-encode a single URL path segment exactly once, idempotently.
 *
 * A stored project/repository name may arrive in one of two forms:
 *   - raw, with literal spaces/special chars (e.g. `Consumer Technology`), or
 *   - already percent-encoded (e.g. `Consumer%20Technology`) — common when a
 *     name is copied verbatim from a browser URL during setup.
 *
 * Blindly calling `encodeURIComponent` on the second form double-encodes it
 * (`%20` -> `%2520`), producing a broken link. Azure DevOps project and
 * repository names cannot contain a literal `%`, so a valid `%NN` sequence in a
 * stored name can only be the result of prior encoding — we therefore decode
 * once before re-encoding, which normalizes BOTH forms to a single encoding
 * layer. Decoding is wrapped defensively: a malformed sequence (which a legal
 * ADO name cannot contain) falls back to encoding the value as-is rather than
 * throwing. Pure and deterministic — no I/O, no locale/environment dependence.
 */
function encodePathSegmentOnce(value: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    decoded = value;
  }
  return encodeURIComponent(decoded);
}

/**
 * Compose the ADO web URL for a PR. Pure function — no I/O, no DOM reads.
 *
 * @param pr The PR record to link to (`id` + `repository_id`).
 * @param repositories The repositories dimension (nullable: dimension may
 *   not have loaded yet or may be absent for an old dataset).
 * @param webContext Active web context (only `collectionUri` is required).
 * @returns Fully-qualified URL. Never throws; always returns a string.
 */
export function resolvePrUrl(
  pr: PrUrlPrRecord,
  repositories: readonly PrUrlRepositoryEntry[] | null | undefined,
  webContext: PrUrlWebContext,
): string {
  const base = ensureTrailingSlash(webContext.collectionUri);
  const repo = repositories?.find((r) => r.repository_id === pr.repository_id);
  if (repo && repo.repository_name.length > 0 && repo.project_name.length > 0) {
    return (
      `${base}${encodePathSegmentOnce(repo.project_name)}/_git/` +
      `${encodePathSegmentOnce(repo.repository_name)}/pullrequest/${pr.id}`
    );
  }
  return `${base}_git/${encodePathSegmentOnce(pr.repository_id)}/pullrequest/${pr.id}`;
}
