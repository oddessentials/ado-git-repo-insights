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
import type { ILocationService } from "azure-devops-extension-api";
import { EXTENSION_DATA_API_VERSION } from "./api-versions";

// CommonServiceIds is a const enum (inlined by tsc, invisible to esbuild).
// Use string literals directly to avoid esbuild "import is undefined" warning.
const LocationServiceId = "ms.vss-features.location-service";

/**
 * Core REST API resource area GUID (stable, documented by Microsoft).
 * Used with ILocationService.getResourceAreaLocation() to recover a
 * collection-scoped REST base URL that includes the collection segment
 * on Azure DevOps Server / on-prem installs (e.g. /DefaultCollection/).
 * getServiceLocation() omits this segment, breaking REST URL construction
 * in Server environments.
 */
const CORE_RESOURCE_AREA_ID = "79134c72-4a58-4b42-976c-04e7115f32bf";

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
 * Monotonic counter — incremented by timeout to invalidate the
 * current attempt so its background continuation cannot commit state.
 */
let initAttemptId = 0;

/**
 * In-flight initialization promise. Concurrent callers share this
 * so they all await the same result instead of racing each other.
 */
let initPromise: Promise<void> | null = null;

/** Cached collection URI — resolved once per session via ILocationService. */
let cachedCollectionUri: string | null = null;

/**
 * In-flight token promise — deduplicates concurrent getAccessToken() calls
 * within the same microtask. Cleared after resolution so the next call
 * gets a fresh token from the host (which manages token lifecycle/refresh).
 */
let tokenInflight: Promise<string> | null = null;

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
  initPromise = null;
  cachedCollectionUri = null;
  tokenInflight = null;
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

  // Share the in-flight promise so concurrent callers await the same
  // result instead of invalidating each other's attempt.
  if (initPromise) return initPromise;

  const timeout = options?.timeout ?? DEFAULT_TIMEOUT_MS;
  const attemptId = ++initAttemptId;

  const initSequence = async (): Promise<void> => {
    await SDK.init({ loaded: false });
    await SDK.ready();

    // If this attempt was invalidated by a timeout, bail.
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

  initPromise = Promise.race([initSequence(), timeoutPromise]).finally(() => {
    clearTimeout(timeoutId);
    initPromise = null;
  });

  return initPromise;
}

/**
 * Options for getValue/setValue — matches the subset of
 * IDocumentOptions that callers actually use.
 */
export interface ExtensionDataOptions {
  scopeType?: string;
  scopeValue?: string;
  defaultValue?: unknown;
}

/**
 * Minimal data manager interface exposed to callers.
 * Drop-in replacement for IExtensionDataManager's getValue/setValue.
 */
export interface ExtensionDataClient {
  getValue<T>(key: string, documentOptions?: ExtensionDataOptions): Promise<T>;
  setValue<T>(
    key: string,
    value: T,
    documentOptions?: ExtensionDataOptions,
  ): Promise<T>;
}

/**
 * Get an Extension Data Client for reading/writing settings.
 *
 * Uses direct REST calls to the Extension Management API instead of
 * the SDK's XDM-proxied IExtensionDataManager. The XDM proxy chain
 * (getService → getExtensionDataManager → proxy.getValue) triggers
 * host-side serialization errors (__remoteSerializationSettings) in
 * some Azure DevOps environments. Direct REST bypasses XDM entirely.
 *
 * REST endpoint pattern:
 *   {collectionUri}_apis/ExtensionManagement/InstalledExtensions/
 *   {publisher}/{extension}/Data/Scopes/{scope}/{scopeValue}/
 *   Collections/$settings/Documents/{key}
 */
export async function getExtensionDataService(): Promise<ExtensionDataClient> {
  const collectionUri = await getCollectionUri();
  const ctx = SDK.getExtensionContext();
  // Token is NOT captured here — resolved per-request in getValue/setValue
  // to ensure fresh tokens after host-side refresh.

  function buildUrl(key: string, scopeType?: string): string {
    const scope = scopeType === "User" ? "User" : "Default";
    const scopeValue = scopeType === "User" ? "Me" : "Current";
    return (
      `${collectionUri}_apis/ExtensionManagement/InstalledExtensions/` +
      `${encodeURIComponent(ctx.publisherId)}/${encodeURIComponent(ctx.extensionId)}/` +
      `Data/Scopes/${scope}/${scopeValue}/Collections/%24settings/Documents/${encodeURIComponent(key)}` +
      `?api-version=${EXTENSION_DATA_API_VERSION}`
    );
  }

  return {
    async getValue<T>(key: string, options?: ExtensionDataOptions): Promise<T> {
      const accessToken = await getAccessToken();
      const headers: HeadersInit = {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      };
      const url = buildUrl(key, options?.scopeType);
      const response = await fetch(url, { headers });

      if (response.status === 404) {
        // Key does not exist — return defaultValue or undefined
        return (options?.defaultValue ?? undefined) as T;
      }

      if (!response.ok) {
        throw new Error(
          `Extension data GET failed: ${response.status} ${response.statusText}`,
        );
      }

      const doc: unknown = await response.json();
      // The REST API wraps the value in a document envelope: { id, __etag, value }
      // getValue should return the raw value, matching the SDK behavior.
      if (doc !== null && typeof doc === "object" && "value" in doc) {
        return (doc as Record<string, unknown>).value as T;
      }
      return doc as T;
    },

    async setValue<T>(
      key: string,
      value: T,
      options?: ExtensionDataOptions,
    ): Promise<T> {
      const accessToken = await getAccessToken();
      const headers: HeadersInit = {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      };
      const url = buildUrl(key, options?.scopeType);
      const body = JSON.stringify({ id: key, value });
      const response = await fetch(url, { method: "PUT", headers, body });

      if (!response.ok) {
        throw new Error(
          `Extension data PUT failed: ${response.status} ${response.statusText}`,
        );
      }

      const doc: unknown = await response.json();
      if (doc !== null && typeof doc === "object" && "value" in doc) {
        return (doc as Record<string, unknown>).value as T;
      }
      return doc as T;
    },
  };
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
 * Uses ILocationService.getResourceAreaLocation() with the Core
 * resource area to resolve a collection-scoped URL. This preserves
 * the collection path segment on Azure DevOps Server (e.g.
 * /DefaultCollection/), matching the old webContext.collection.uri.
 *
 * The returned URI is normalized to always end with a trailing slash
 * because downstream URL construction concatenates paths directly.
 */
export async function getCollectionUri(): Promise<string> {
  if (cachedCollectionUri) return cachedCollectionUri;
  const locationService =
    await SDK.getService<ILocationService>(LocationServiceId);
  const raw = await locationService.getResourceAreaLocation(
    CORE_RESOURCE_AREA_ID,
  );
  cachedCollectionUri = raw.endsWith("/") ? raw : `${raw}/`;
  return cachedCollectionUri;
}

/**
 * Get a user-delegated access token for Bearer authentication.
 *
 * Uses in-flight promise deduplication: concurrent calls within the
 * same microtask share one SDK.getAccessToken() call (consistent
 * tokens within a request batch). After resolution the promise is
 * cleared, so the next call gets a fresh token from the host — which
 * manages token lifecycle and refresh. This prevents the session-long
 * token pinning that caused 401s after token expiry.
 */
export async function getAccessToken(): Promise<string> {
  if (tokenInflight) return tokenInflight;
  tokenInflight = SDK.getAccessToken();
  try {
    return await tokenInflight;
  } finally {
    tokenInflight = null;
  }
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
    typeof LOCAL_DASHBOARD_MODE !== "undefined" && LOCAL_DASHBOARD_MODE === true
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
