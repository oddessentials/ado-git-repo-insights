/**
 * Centralized API version constants for Azure DevOps REST calls.
 *
 * All version references across the extension import from here.
 * Versions are ordered newest → oldest; fallback logic depends on this.
 */

/** Build + Core REST API versions, newest → oldest.
 *  Used by artifact-client.ts (Build API) and settings.ts (Projects API). */
export const ADO_REST_API_VERSIONS = ["7.1", "6.0", "5.1"] as const;

/** Extension Management Data Service API version (stable since v3.x). */
export const EXTENSION_DATA_API_VERSION = "7.1-preview.1";

/** Result of a version-fallback probe. */
export interface VersionFallbackResult {
  response: Response;
  version: string;
}

/**
 * Probe ADO REST API versions newest → oldest until one responds
 * with a non-version-related status, or all versions are exhausted.
 *
 * Status classification:
 * - 401/403 → return immediately (auth failure, not version-related)
 * - 400 → version not supported, try next
 * - 404 + isListEndpoint → version not supported, try next
 *   (true list endpoints return { value: [] } for empty results, never 404)
 * - Any other status (2xx, 404 on resource, 5xx) → return to caller
 *
 * This function is pure: no caching, no auth throwing, no family maps.
 * Callers own caching and error-handling behaviors.
 *
 * @param buildUrl Builds the full URL for a given api-version string
 * @param fetchFn Performs the authenticated fetch (caller provides headers)
 * @param options.isListEndpoint Whether 404 should be treated as version mismatch
 * @throws When all versions are exhausted (400/404 on every attempt)
 */
export async function fetchWithVersionFallback(
  buildUrl: (version: string) => string,
  fetchFn: (url: string) => Promise<Response>,
  options: { isListEndpoint: boolean },
): Promise<VersionFallbackResult> {
  let lastError: Error | null = null;

  for (const version of ADO_REST_API_VERSIONS) {
    const response = await fetchFn(buildUrl(version));

    // Auth failures are not version-related — return immediately
    if (response.status === 401 || response.status === 403) {
      return { response, version };
    }

    // Version probing: 400 always retries; 404 retries only for list endpoints
    if (response.status === 400 || (options.isListEndpoint && response.status === 404)) {
      lastError = new Error(
        `API api-version=${version}: ${response.status}`,
      );
      continue;
    }

    // Any other status — return to caller for business-level handling
    return { response, version };
  }

  throw lastError ?? new Error("No compatible API version found");
}
