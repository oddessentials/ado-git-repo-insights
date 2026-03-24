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
// ML Artifact State Machine Types
// Discriminated union for strict 5-state gating per FR-001 through FR-004
// =============================================================================

/**
 * Artifact state discriminated union.
 * Each ML tab renders exactly one of these 5 states - no mixed UI, no fallthrough.
 * State resolution is absolute: once resolved, no further checks run.
 */
export type ArtifactState =
  | { type: "setup-required" }
  | { type: "no-data"; quality?: "insufficient" }
  | { type: "invalid-artifact"; error: string; path?: string }
  | {
      type: "unsupported-schema";
      version: number;
      supported: [number, number];
    }
  | { type: "ready"; data: PredictionsRenderData | InsightsRenderData };

/**
 * Supported schema version range for ML artifacts.
 * Used by state machine to determine unsupported-schema state.
 */
export const ML_SCHEMA_VERSION_RANGE: [number, number] = [1, 1];

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
// Build REST API Response Types (direct REST via ArtifactClient)
// These are the typed shapes for fields consumed from the ADO Build REST API.
// =============================================================================

/**
 * Pipeline definition reference from GET _apis/build/definitions.
 * Minimal shape — only the fields consumed by discovery.
 */
export interface BuildDefinitionReference {
  id: number;
  name: string;
}

/**
 * Build reference from GET _apis/build/builds.
 * Minimal shape — only the fields consumed by discovery.
 */
export interface Build {
  id: number;
  definition: { id: number; name: string };
  status: number;
  result: number;
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
  manifest_schema_version?: number;
  dataset_schema_version?: number;
  aggregates_schema_version?: number;
  version?: string | number;
  generated_at?: string;
  run_id?: string;
  coverage?: {
    first_week?: string;
    last_week?: string;
    total_weeks?: number;
    total_prs?: number;
    date_range?: {
      start?: string;
      end?: string;
      min?: string;
      max?: string;
    };
    comments?:
      | string
      | {
          status?: "disabled" | "full" | "partial";
          threads_fetched?: number;
          comments_fetched?: number;
          prs_with_threads?: number;
          capped?: boolean;
        };
  };
  aggregate_index?: {
    weekly_rollups?: Array<{ week: string; path: string }>;
    distributions?: Array<{ year: string; path: string }>;
    predictions?: { path: string };
    ai_insights?: { path: string };
  };
  demo_profile?: {
    name?: string;
    version?: string;
    seed?: number;
    canonical_output_root?: string;
  };
  generation_provenance?: {
    python_version?: string;
    python_major_minor?: string;
    generator_script?: string;
    generation_mode?: string;
  };
  published_files?: {
    direct?: string[];
    globs?: string[];
  };
  features?: Record<string, boolean>;
  capabilities?: {
    author_filters?: boolean;
    author_repo_exact?: boolean;
    comments_metrics?: boolean;
    reviewer_repository_mode?: "exact" | "constrained" | "disallowed";
    reviewer_team_mode?: "exact" | "constrained" | "disallowed";
    cross_dimensional_available?: boolean;
  };
  reviewer_fixtures?: {
    minimum_active_reviewers?: number;
    minimum_reviewed_prs_per_reviewer?: number;
    minimum_review_actions_per_reviewer?: number;
    minimum_multi_repo_reviewers?: number;
    reviewer_filter_examples?: Array<{
      reviewer_id?: string;
      reviewer_name?: string;
      week?: string;
      reviewed_prs?: number;
      reviews_count?: number;
      repositories_count?: number;
    }>;
    reviewer_constrained_example?: {
      reviewer_id?: string;
      reviewer_name?: string;
      week?: string;
      mode?: "constrained" | "disallowed";
      reason?: string;
      repository_name?: string;
    };
    reviewer_team_disallowed_example?: {
      reviewer_id?: string;
      reviewer_name?: string;
      week?: string;
      mode?: "constrained" | "disallowed";
      reason?: string;
      team_name?: string;
    };
  };
  defaults?: {
    default_date_range_days?: number;
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
// Dataset Data Types
// =============================================================================

/**
 * Aggregate index entry (weekly rollups or distributions).
 */
export interface AggregateIndexEntry {
  week?: string;
  year?: string;
  path: string;
}

/**
 * Manifest aggregate index structure.
 */
export interface ManifestAggregateIndex {
  weekly_rollups?: AggregateIndexEntry[];
  distributions?: AggregateIndexEntry[];
  predictions?: { path: string };
  ai_insights?: { path: string };
}

/**
 * Dimensions data structure (filter values).
 */
export interface DimensionsData {
  repositories?: Array<{
    repository_id: string;
    repository_name: string;
    project_name?: string;
    organization_name?: string;
  }>;
  teams?: Array<{
    team_id: string;
    team_name: string;
    project_name?: string;
    member_count?: number;
  }>;
  reviewers?: Array<{
    reviewer_id: string;
    reviewer_name: string;
  }>;
  authors?: Array<{
    author_id: string;
    author_name: string;
  }>;
  users?: Array<{
    id?: string;
    name?: string;
    [key: string]: unknown;
  }>;
  projects?: Array<{
    id?: string;
    name?: string;
    [key: string]: unknown;
  }>;
  date_range?: {
    start?: string;
    end?: string;
    min?: string;
    max?: string;
  };
  [key: string]: unknown; // Allow for additional fields from fixtures
}

/**
 * Distribution data structure.
 */
export interface DistributionData {
  year: string;
  cycle_time_buckets?: Record<string, number>;
  [key: string]: unknown;
}

/**
 * Coverage info from manifest.
 */
export interface CoverageInfo {
  start_date?: string;
  end_date?: string;
  first_week?: string;
  last_week?: string;
  weeks?: number;
  total_weeks?: number;
  total_prs?: number;
  date_range?: {
    start?: string;
    end?: string;
    min?: string;
    max?: string;
  };
  comments?:
    | string
    | {
        status?: "disabled" | "full" | "partial";
        threads_fetched?: number;
        comments_fetched?: number;
        prs_with_threads?: number;
        capped?: boolean;
      };
}

export interface DatasetCapabilityState {
  authorFiltersAvailable: boolean;
  authorRepoExactAvailable: boolean;
  commentsMetricsAvailable: boolean;
  commentsCoverageStatus: "disabled" | "full" | "partial";
  reviewerRepositoryMode: "exact" | "constrained" | "disallowed";
  reviewerTeamMode: "exact" | "constrained" | "disallowed";
  crossDimensionalAvailable: boolean;
}

/**
 * Predictions data structure.
 */
export interface PredictionsData {
  state?:
    | "disabled"
    | "missing"
    | "auth"
    | "auth_required"
    | "ok"
    | "error"
    | "invalid"
    | "unavailable";
  error?: string;
  message?: string;
  data?: unknown;
  predictions?: Array<{
    week: string;
    pr_count_predicted?: number;
    cycle_time_p50_predicted?: number;
  }>;
  [key: string]: unknown;
}

/**
 * AI Insights data structure.
 */
export interface InsightsData {
  state?:
    | "disabled"
    | "missing"
    | "auth"
    | "auth_required"
    | "ok"
    | "error"
    | "invalid"
    | "unavailable";
  error?: string;
  message?: string;
  data?: unknown;
  insights?: Array<{
    type: string;
    severity: string;
    message: string;
  }>;
  [key: string]: unknown;
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
// Dashboard Typing Interfaces
// =============================================================================

/**
 * Query parameter parsing result (union discriminant).
 */
export interface QueryParamResult {
  mode: "direct" | "explicit" | "discover";
  value: string | number | null;
  warning?: string | null;
}

/**
 * Single forecast value point.
 */
export interface ForecastValue {
  period_start: string;
  predicted: number;
  lower_bound: number;
  upper_bound: number;
}

/**
 * Forecast for a single metric.
 */
export interface Forecast {
  metric: string;
  unit: string;
  values: ForecastValue[];
}

/**
 * Predictions data for rendering (subset of PredictionsData).
 */
export interface PredictionsRenderData {
  is_stub?: boolean;
  generated_by?: string;
  generated_at?: string;
  forecaster?: "linear" | "prophet";
  data_quality?: "normal" | "low_confidence" | "insufficient";
  forecasts: Forecast[];
}

/**
 * Insight data with metrics for inline visualization (v2 schema).
 */
export interface InsightData {
  metric: string;
  current_value: number;
  previous_value?: number;
  change_percent?: number;
  trend_direction: "up" | "down" | "stable";
  sparkline?: number[];
}

/**
 * Actionable recommendation with effort estimate (v2 schema).
 */
export interface Recommendation {
  action: string;
  priority: "high" | "medium" | "low";
  effort: "high" | "medium" | "low";
}

/**
 * Affected entity (team, repository, or author).
 */
export interface AffectedEntity {
  type: "team" | "repository" | "author";
  name: string;
  member_count?: number;
}

/**
 * Single AI insight item (v2 schema with enhanced fields).
 */
export interface InsightItem {
  id?: string;
  severity: "critical" | "warning" | "info";
  category: string;
  title: string;
  description: string;
  affected_entities?: AffectedEntity[];
  data?: InsightData;
  recommendation?: Recommendation;
}

/**
 * AI Insights data for rendering (subset of InsightsData).
 */
export interface InsightsRenderData {
  is_stub?: boolean;
  generated_by?: string;
  generated_at?: string;
  schema_version?: number;
  insights: InsightItem[];
}

/**
 * Extended IDatasetLoader with optional ML methods.
 * Used for type-safe feature detection.
 */
export interface IDatasetLoaderWithML {
  loadManifest(): Promise<ManifestSchema>;
  loadDimensions(): Promise<DimensionsData | null>;
  getWeeklyRollups(startDate: Date, endDate: Date): Promise<unknown[]>;
  getDistributions(startDate: Date, endDate: Date): Promise<DistributionData[]>;
  getCoverage(): CoverageInfo | null;
  getDefaultRangeDays(): number;
  loadPredictions(): Promise<PredictionsData>;
  loadInsights(): Promise<InsightsData>;
}

/**
 * Type guard for ML-enabled dataset loaders.
 */
export function hasMLMethods(loader: unknown): loader is IDatasetLoaderWithML {
  return (
    typeof loader === "object" &&
    loader !== null &&
    typeof (loader as IDatasetLoaderWithML).loadPredictions === "function" &&
    typeof (loader as IDatasetLoaderWithML).loadInsights === "function"
  );
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- REASON: Window globals typed as any to avoid circular imports between IIFE bundles
    DatasetLoader?: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- REASON: Window globals typed as any to avoid circular imports between IIFE bundles
    fetchSemaphore?: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- REASON: Window globals typed as any to avoid circular imports between IIFE bundles
    createRollupCache?: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- REASON: Window globals typed as any to avoid circular imports between IIFE bundles
    normalizeRollup?: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- REASON: Window globals typed as any to avoid circular imports between IIFE bundles
    normalizeRollups?: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- REASON: Window globals typed as any to avoid circular imports between IIFE bundles
    ROLLUP_FIELD_DEFAULTS?: any;

    // Artifact Client exports (typed as unknown to avoid circular imports)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- REASON: Window globals typed as any to avoid circular imports between IIFE bundles
    ArtifactClient?: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- REASON: Window globals typed as any to avoid circular imports between IIFE bundles
    AuthenticatedDatasetLoader?: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- REASON: Window globals typed as any to avoid circular imports between IIFE bundles
    MockArtifactClient?: any;

    // Settings page exports
    selectDiscoveredPipeline?: (pipelineId: number) => void;

    // Dashboard debug/config (optional runtime values)
    __DASHBOARD_DEBUG__?: boolean;
    __dashboardMetrics?: unknown;
    LOCAL_DASHBOARD_MODE?: boolean | string | number; // Wide type to allow testing edge cases
    DATASET_PATH?: string;
    process?: { env?: { NODE_ENV?: string } };
  }
}

// Required for module augmentation to work
export {};
