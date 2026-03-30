/**
 * ADO Extension SDK Abstraction Layer
 *
 * This module is the SOLE point of contact between the extension code
 * and the Azure DevOps host SDK. All production modules (dashboard.ts,
 * settings.ts, artifact-client.ts) must call this module — never the
 * SDK directly.
 *
 * Migrated from vss-web-extension-sdk to azure-devops-extension-sdk (v4.x).
 */

import * as SDK from "azure-devops-extension-sdk";
import type {
  IExtensionDataManager,
  IExtensionDataService,
  ILocationService,
} from "azure-devops-extension-api";

// CommonServiceIds is a const enum (inlined by tsc, invisible to esbuild).
// Use string literals directly to avoid esbuild "import is undefined" warning.
const ExtensionDataServiceId = "ms.vss-features.extension-data-service";
const LocationServiceId = "ms.vss-features.location-service";

/* ── Types ─────────────────────────────────────────────────────── */

/** Options for SDK initialization. */
export interface SdkInitOptions {
  /** Initialization timeout in milliseconds. Default: 10000 */
  timeout?: number;
  /** Called after SDK reports ready, before notifyLoadSucceeded */
  onReady?: () => void;
}

/**
 * Web context shape exposed to consumers.
 * Maintained for backward-compatibility with code that accessed
 * the old VSS.WebContext properties.
 */
export interface WebContext {
  project?: { id: string; name: string };
  team?: { id: string; name: string };
  user: { id: string; name: string; displayName: string };
  host: { id: string; name: string };
}

/* ── Module-level state (singleton) ────────────────────────────── */

let sdkInitialized = false;
const DEFAULT_TIMEOUT_MS = 10_000;

/* ── Public functions ──────────────────────────────────────────── */

/** Whether the SDK has been successfully initialized. */
export function isSdkInitialized(): boolean {
  return sdkInitialized;
}

/** Reset SDK state. Test-only utility. */
export function resetSdkState(): void {
  sdkInitialized = false;
}

/**
 * Initialize the Azure DevOps Extension SDK.
 *
 * Idempotent — calling multiple times is safe; only the first call
 * performs actual initialization. The sequence is:
 *   init() → ready() → onReady callback → notifyLoadSucceeded()
 *
 * Rejects with a timeout error if the host does not respond in time.
 */
export async function initializeAdoSdk(
  options?: SdkInitOptions,
): Promise<void> {
  if (sdkInitialized) return;

  const timeout = options?.timeout ?? DEFAULT_TIMEOUT_MS;

  // Tracks whether the timeout fired before init completed.
  // If true, the init sequence must not commit sdkInitialized
  // because the caller already received a timeout rejection.
  let abandoned = false;

  const initSequence = async (): Promise<void> => {
    await SDK.init({ loaded: false });
    await SDK.ready();

    // If the timeout fired while we were waiting, bail out.
    if (abandoned) return;

    // SDK APIs are now usable. Set the flag before onReady so
    // callbacks can call getWebContext(), resizeHost(), etc.
    // If onReady or notifyLoadSucceeded fails, roll back.
    sdkInitialized = true;
    try {
      if (options?.onReady) {
        options.onReady();
      }
      await SDK.notifyLoadSucceeded();
    } catch (e) {
      sdkInitialized = false;
      throw e;
    }
  };

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      abandoned = true;
      reject(new Error("Azure DevOps SDK initialization timed out"));
    }, timeout);
  });

  try {
    await Promise.race([initSequence(), timeoutPromise]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Get the Extension Data Manager for reading/writing settings.
 *
 * Returns an IExtensionDataManager that exposes getValue<T>() and
 * setValue<T>() — the same consumer-facing API as the old SDK's
 * IExtensionDataService. The two-step indirection (getService →
 * getExtensionDataManager) is absorbed here.
 */
export async function getExtensionDataService(): Promise<IExtensionDataManager> {
  const dataService = await SDK.getService<IExtensionDataService>(
    ExtensionDataServiceId,
  );
  const extensionContext = SDK.getExtensionContext();
  const accessToken = await SDK.getAccessToken();
  return dataService.getExtensionDataManager(extensionContext.id, accessToken);
}

/**
 * Get the current web context (project, team, user, host).
 *
 * Returns undefined if the SDK has not been initialized.
 * Composes from SDK accessors to provide a shape compatible
 * with the old VSS.WebContext layout.
 */
export function getWebContext(): WebContext | undefined {
  if (!sdkInitialized) return undefined;

  const webCtx = SDK.getWebContext();
  const user = SDK.getUser();
  const host = SDK.getHost();

  return {
    project: webCtx.project
      ? { id: webCtx.project.id, name: webCtx.project.name }
      : undefined,
    team: webCtx.team
      ? { id: webCtx.team.id, name: webCtx.team.name }
      : undefined,
    user: { id: user.id, name: user.name, displayName: user.displayName },
    host: { id: host.id, name: host.name },
  };
}

/**
 * Get the collection/organization base URI for REST API calls.
 *
 * Uses the ILocationService to resolve the host service URL.
 * This replaces the old VSS.getWebContext().collection.uri pattern.
 */
export async function getCollectionUri(): Promise<string> {
  const locationService = await SDK.getService<ILocationService>(
    LocationServiceId,
  );
  return locationService.getServiceLocation();
}

/**
 * Get a user-delegated access token for Bearer authentication.
 *
 * Returns a plain string (the new SDK returns string directly,
 * unlike the old SDK which returned { token: string }).
 */
export async function getAccessToken(): Promise<string> {
  return SDK.getAccessToken();
}

/* ── Host resize ───────────────────────────────────────────────── */

/**
 * Notify the Azure DevOps host to resize the extension iframe.
 *
 * No-op until the SDK has been initialized. This is intentional:
 * resize calls before init cannot reach the host anyway, and
 * silently dropping them avoids errors during early DOM mutations.
 */
export function resizeHost(width?: number, height?: number): void {
  if (!sdkInitialized) return;
  try {
    SDK.resize(width, height);
  } catch {
    // Host communication failure — swallow to prevent rAF crash.
    // Resize is best-effort; a missed resize self-corrects on the
    // next observer or window resize event.
  }
}

/* ── Local development mode ────────────────────────────────────── */

declare const LOCAL_DASHBOARD_MODE: boolean | undefined;
declare const DATASET_PATH: string | undefined;

/**
 * Whether the extension is running in local development mode
 * (outside of Azure DevOps).
 */
export function isLocalMode(): boolean {
  return (
    typeof LOCAL_DASHBOARD_MODE !== "undefined" &&
    LOCAL_DASHBOARD_MODE === true
  );
}

/**
 * Get the local dataset path for development mode.
 * Defaults to './dataset' if not specified.
 */
export function getLocalDatasetPath(): string {
  if (typeof DATASET_PATH !== "undefined" && DATASET_PATH !== "") {
    return DATASET_PATH;
  }
  return "./dataset";
}
