/**
 * Dev Mode Detection Module (T047-T049)
 *
 * Provides environment detection to control synthetic data display:
 * - Production environments (Azure DevOps) block synthetic data
 * - Local/dev environments allow synthetic with explicit devMode flag
 *
 * Security: Synthetic data must NEVER appear in production to avoid confusion
 * with real metrics.
 */

/**
 * Hostname patterns that indicate production Azure DevOps environments.
 */
const PRODUCTION_PATTERNS: string[] = ["dev.azure.com", "visualstudio.com"];

/**
 * Check if the current environment is a production Azure DevOps environment.
 *
 * Production environments include:
 * - dev.azure.com (Azure DevOps Services)
 * - *.visualstudio.com (legacy Azure DevOps URLs)
 *
 * Non-production environments:
 * - localhost
 * - 127.0.0.1
 * - file:// protocol (local dashboard)
 * - Any other hostname
 *
 * @returns true if running in production Azure DevOps environment
 */
export function isProductionEnvironment(): boolean {
  // Safe access to window.location for SSR/test compatibility
  if (typeof window === "undefined" || !window.location) {
    return false;
  }

  const hostname = window.location.hostname.toLowerCase();

  // Empty hostname typically means file:// protocol (local dashboard)
  if (!hostname) {
    return false;
  }

  // Check against production patterns (case-insensitive)
  return PRODUCTION_PATTERNS.some((pattern) => hostname.includes(pattern));
}

/**
 * Check if synthetic data can be displayed.
 *
 * Synthetic data is only allowed when:
 * 1. NOT in a production environment
 * 2. AND devMode parameter is explicitly true
 *
 * This double-check ensures synthetic data never appears in production,
 * even if a user manually sets devMode.
 *
 * @param devMode - Explicit dev mode flag from configuration/URL
 * @returns true if synthetic data can be shown
 */
export function canShowSyntheticData(devMode: boolean): boolean {
  // Production lock: synthetic data NEVER allowed in production
  if (isProductionEnvironment()) {
    return false;
  }

  // Requires explicit devMode flag
  return devMode;
}

/**
 * Get the current hostname (for logging/debugging).
 * @returns Current hostname or empty string
 */
export function getCurrentHostname(): string {
  if (typeof window === "undefined" || !window.location) {
    return "";
  }
  return window.location.hostname;
}

/**
 * Check if running in local development environment.
 * @returns true if localhost or file:// protocol
 */
export function isLocalDevelopment(): boolean {
  if (typeof window === "undefined" || !window.location) {
    return false;
  }

  const hostname = window.location.hostname.toLowerCase();
  const protocol = window.location.protocol;

  // file:// protocol (local dashboard)
  if (protocol === "file:") {
    return true;
  }

  // localhost or 127.0.0.1
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return true;
  }

  return false;
}
