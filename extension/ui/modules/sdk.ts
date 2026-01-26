/**
 * SDK Initialization Module
 *
 * Shared Azure DevOps Extension SDK initialization logic.
 * Used by both dashboard.ts and settings.ts to ensure consistent SDK handling.
 *
 * DOM-INJECTED: Callbacks handle page-specific post-init actions.
 */

/**
 * SDK initialization options.
 */
export interface SdkInitOptions {
  /** Timeout in milliseconds for SDK initialization (default: 10000) */
  timeout?: number;
  /** Callback executed after VSS.ready() completes */
  onReady?: () => void;
}

/**
 * SDK state tracking.
 * Internal state - use isSdkInitialized() to check.
 */
let sdkInitialized = false;

/**
 * Check if the SDK has been initialized.
 */
export function isSdkInitialized(): boolean {
  return sdkInitialized;
}

/**
 * Reset SDK initialized state.
 * Primarily for testing purposes.
 */
export function resetSdkState(): void {
  sdkInitialized = false;
}

/**
 * Initialize Azure DevOps Extension SDK.
 *
 * Safe to call multiple times - returns immediately if already initialized.
 * Calls VSS.init() and VSS.ready() with timeout protection.
 *
 * @param options - Optional configuration for initialization
 * @returns Promise that resolves when SDK is ready
 * @throws Error if initialization times out
 *
 * @example
 * // Basic initialization
 * await initializeAdoSdk();
 *
 * @example
 * // With post-init callback (dashboard pattern)
 * await initializeAdoSdk({
 *   onReady: () => {
 *     const webContext = VSS.getWebContext();
 *     document.getElementById("project-name").textContent = webContext.project?.name;
 *   }
 * });
 */
export async function initializeAdoSdk(
  options: SdkInitOptions = {},
): Promise<void> {
  // Skip if already initialized
  if (sdkInitialized) {
    return;
  }

  const { timeout = 10000, onReady } = options;

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error("Azure DevOps SDK initialization timed out"));
    }, timeout);

    VSS.init({
      explicitNotifyLoaded: true,
      usePlatformScripts: true,
      usePlatformStyles: true,
    });

    VSS.ready(() => {
      clearTimeout(timeoutId);
      sdkInitialized = true;

      // Execute optional onReady callback
      if (onReady) {
        onReady();
      }

      VSS.notifyLoadSucceeded();
      resolve();
    });
  });
}

/**
 * Get Build REST client from SDK.
 * Wraps VSS.require for typed access to the Build API.
 *
 * @returns Promise resolving to Build REST client
 */
export async function getBuildClient(): Promise<IBuildRestClient> {
  return new Promise((resolve) => {
    VSS.require(["TFS/Build/RestClient"], (...args: unknown[]) => {
      const BuildRestClient = args[0] as { getClient(): IBuildRestClient };
      resolve(BuildRestClient.getClient());
    });
  });
}

/**
 * Get Extension Data Service from SDK.
 * Provides typed access to extension settings storage.
 *
 * @returns Promise resolving to Extension Data Service
 */
export async function getExtensionDataService(): Promise<IExtensionDataService> {
  return VSS.getService<IExtensionDataService>(VSS.ServiceIds.ExtensionData);
}

/**
 * Get current web context from SDK.
 * Provides access to organization, project, and user information.
 *
 * @returns Web context object or undefined if SDK not initialized
 */
export function getWebContext(): VSS.WebContext | undefined {
  if (!sdkInitialized) {
    return undefined;
  }
  return VSS.getWebContext();
}

/**
 * Check if running in local dashboard mode.
 * Local mode bypasses SDK initialization and uses file-based data.
 */
export function isLocalMode(): boolean {
  return typeof window !== "undefined" && window.LOCAL_DASHBOARD_MODE === true;
}

/**
 * Get local dataset path from window config.
 * Used when running in local development mode.
 */
export function getLocalDatasetPath(): string {
  return (typeof window !== "undefined" && window.DATASET_PATH) || "./dataset";
}
