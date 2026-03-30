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

/**
 * Committed success flag — set only after the ENTIRE init sequence
 * completes (ready + onReady + notifyLoadSucceeded) without timeout.
 */
let sdkInitialized = false;

/**
 * Temporary flag scoped to the onReady callback window. Allows
 * SDK wrapper functions (getWebContext, resizeHost) to work during
 * onReady without committing "fully initialized" state. Cleared
 * in a finally block after onReady returns.
 */
let sdkReadyForCalls = false;

/**
 * Monotonic counter — each call to initializeAdoSdk increments it.
 * A timeout or new call also increments it, invalidating the prior
 * attempt so its background continuation cannot commit state.
 */
let initAttemptId = 0;

const DEFAULT_TIMEOUT_MS = 10_000;

/* ── Internal helper ───────────────────────────────────────────── */

/** SDK wrappers are usable if fully initialized OR inside onReady. */
function isSdkCallable(): boolean {
  return sdkInitialized || sdkReadyForCalls;
}

/* ── Public functions ──────────────────────────────────────────── */

/** Whether the SDK has been successfully initialized. */
export function isSdkInitialized(): boolean {
  return sdkInitialized;
}

/** Reset SDK state. Test-only utility. */
export function resetSdkState(): void {
  sdkInitialized = false;
  sdkReadyForCalls = false;
  initAttemptId++;
}

/**
 * Initialize the Azure DevOps Extension SDK.
 *
 * Idempotent — calling multiple times is safe; only the first call
 * performs actual initialization. The sequence is:
 *   init() → ready() → onReady callback → notifyLoadSucceeded()
 *
 * SDK wrapper functions (getWebContext, resizeHost) are usable during
 * onReady via a temporary ready-for-calls window. The module-wide
 * "initialized" flag is committed only after the full sequence
 * succeeds and has not been abandoned by a timeout.
 *
 * Rejects with a timeout error if the host does not respond in time.
 */
export async function initializeAdoSdk(
  options?: SdkInitOptions,
): Promise<void> {
  if (sdkInitialized) return;

  const timeout = options?.timeout ?? DEFAULT_TIMEOUT_MS;
  const attemptId = ++initAttemptId;

  const initSequence = async (): Promise<void> => {
    await SDK.init({ loaded: false });
    await SDK.ready();

    // If this attempt was invalidated (timeout or new call), bail.
    if (attemptId !== initAttemptId) return;

    // Temporarily enable SDK wrappers for onReady callbacks.
    sdkReadyForCalls = true;
    try {
      if (options?.onReady) {
        options.onReady();
      }

      // Check again — onReady may have taken long enough for timeout.
      if (attemptId !== initAttemptId) return;

      await SDK.notifyLoadSucceeded();
    } finally {
      sdkReadyForCalls = false;
    }

    // Final gate: only commit if this attempt still owns the slot.
    if (attemptId !== initAttemptId) return;
    sdkInitialized = true;
  };

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      initAttemptId++; // Invalidate the current attempt
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
 * Returns undefined if the SDK is not callable (neither fully
 * initialized nor inside an onReady callback window).
 */
export function getWebContext(): WebContext | undefined {
  if (!isSdkCallable()) return undefined;

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
 * The returned URI is normalized to always end with a trailing slash
 * because downstream URL construction concatenates paths directly.
 */
export async function getCollectionUri(): Promise<string> {
  const locationService = await SDK.getService<ILocationService>(
    LocationServiceId,
  );
  const raw = await locationService.getServiceLocation();
  return raw.endsWith("/") ? raw : `${raw}/`;
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
 * No-op until the SDK is callable (fully initialized or inside
 * an onReady callback). Silently swallows host communication
 * failures to prevent rAF callback crashes.
 */
export function resizeHost(width?: number, height?: number): void {
  if (!isSdkCallable()) return;
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
