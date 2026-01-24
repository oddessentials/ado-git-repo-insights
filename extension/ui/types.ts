/**
 * Shared Type Definitions for PR Insights Hub
 *
 * This module provides TypeScript type definitions for:
 * - VSS SDK types (Azure DevOps SDK lacks full TS definitions)
 * - Dataset and rollup types
 * - Cache system types
 * - Error handling utilities
 */

// =============================================================================
// VSS SDK Type Stubs
// Azure DevOps VSS SDK lacks complete TypeScript definitions.
// These provide type safety for known API shapes.
// =============================================================================

export interface VSSProject {
    id: string;
    name: string;
    description?: string;
    state?: string;
    visibility?: number;
}

export interface VSSBuildDefinition {
    id: number;
    name: string;
    path?: string;
    revision?: number;
    type?: number;
}

export interface VSSBuild {
    id: number;
    buildNumber: string;
    result: number;
    status: number;
    startTime?: string;
    finishTime?: string;
    definition?: VSSBuildDefinition;
}

export interface VSSBuildArtifact {
    id?: number;
    name: string;
    resource?: {
        downloadUrl?: string;
        type?: string;
        data?: string;
    };
}

// =============================================================================
// Dataset Types
// =============================================================================

export interface RollupRecord {
    week: string;
    org?: string;
    project?: string;
    repo?: string;
    [key: string]: unknown;
}

export interface DimensionRecord {
    year: string;
    [key: string]: unknown;
}

export interface ManifestSchema {
    version?: string | number;
    generated_at?: string;
    coverage?: {
        first_week?: string;
        last_week?: string;
        total_weeks?: number;
    };
    aggregate_index?: {
        rollups_by_week?: Record<string, { path: string }>;
        dimensions_by_year?: Record<string, { path: string }>;
        predictions?: { path: string };
        ai_insights?: { path: string };
    };
    ui_defaults?: {
        default_range_days?: number;
    };
}

// =============================================================================
// Cache Types
// =============================================================================

export interface CacheEntry<T = unknown> {
    value: T;
    createdAt: number;
    touchedAt: number;
}

export interface RollupCache<T = unknown> {
    get(key: string): T | undefined;
    set(key: string, value: T): void;
    has(key: string): boolean;
    clear(): void;
}

// =============================================================================
// Error Handling Utilities
// =============================================================================

/**
 * Type guard to check if a value is an object with a message property.
 */
export function isErrorWithMessage(
    error: unknown,
): error is { message: string } {
    return (
        typeof error === "object" &&
        error !== null &&
        "message" in error &&
        typeof (error as { message: unknown }).message === "string"
    );
}

/**
 * Type guard to check if a value is an object with a code property.
 */
export function isErrorWithCode(error: unknown): error is { code: string } {
    return (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        typeof (error as { code: unknown }).code === "string"
    );
}

/**
 * Safely extract an error message from an unknown caught value.
 */
export function getErrorMessage(error: unknown): string {
    if (isErrorWithMessage(error)) return error.message;
    if (typeof error === "string") return error;
    return "Unknown error";
}

/**
 * Safely extract an error code from an unknown caught value.
 */
export function getErrorCode(error: unknown): string | undefined {
    if (isErrorWithCode(error)) return error.code;
    return undefined;
}

// =============================================================================
// Response Status Types
// =============================================================================

export type LoadStatus = "ok" | "auth" | "missing" | "failed";

export interface LoadResult<T> {
    status: LoadStatus;
    data?: T;
    error?: unknown;
}

export interface WeekLoadResult<T> {
    week: string;
    status: LoadStatus;
    data?: T;
    error?: unknown;
}

// =============================================================================
// Window Interface Augmentation
// Typed global exports for browser compatibility
// =============================================================================

/**
 * Extended Window interface for PR Insights globals.
 * This allows typed assignments like `window.DatasetLoader = DatasetLoader`
 * instead of `(window as any).DatasetLoader = DatasetLoader`.
 *
 * ⚠️ WARNING: Do NOT use `typeof import("./module").Export` syntax here!
 * That creates circular type dependencies (types.ts ↔ dataset-loader.ts)
 * which causes Jest to silently fail test collection in CI (Linux/Ubuntu).
 * See: https://github.com/oddessentials/ado-git-repo-insights/pull/78
 * The `any` types here are intentional - these are runtime globals where
 * full type safety isn't possible anyway.
 */
declare global {
    interface Window {
        // Dataset Loader exports (typed as unknown to avoid circular imports)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        DatasetLoader?: any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        fetchSemaphore?: any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        createRollupCache?: any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        normalizeRollup?: any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        normalizeRollups?: any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ROLLUP_FIELD_DEFAULTS?: any;

        // Artifact Client exports (typed as unknown to avoid circular imports)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ArtifactClient?: any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        AuthenticatedDatasetLoader?: any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        MockArtifactClient?: any;

        // Settings page exports
        selectDiscoveredPipeline?: (pipelineId: number) => void;

        // Dashboard debug/config (optional runtime values)
        __DASHBOARD_DEBUG__?: boolean;
        __dashboardMetrics?: unknown;
        LOCAL_DASHBOARD_MODE?: boolean;
        DATASET_PATH?: string;
        process?: { env?: { NODE_ENV?: string } };
    }
}

// Required for module augmentation to work
export { };
