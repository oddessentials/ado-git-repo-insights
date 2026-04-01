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
