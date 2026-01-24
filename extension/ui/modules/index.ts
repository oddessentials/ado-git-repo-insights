/**
 * Dashboard Modules Barrel File
 *
 * Exports all extracted dashboard modules following the one-way dependency rule:
 * - dashboard.ts → modules/*
 * - modules/* → shared/* (only)
 *
 * Modules NEVER import dashboard.ts or each other (except via shared/).
 */

// Shared utilities (DOM-free)
export * from "./shared";

// DOM access (single 'any' exception)
export * from "./dom";

// Metrics calculation (DOM-free)
export * from "./metrics";

// Error handling
export * from "./errors";

// ML types and interfaces
export * from "./ml/types";

// ML rendering (Phase 5 expansion point)
export * from "./ml";

// Chart rendering
export * from "./charts";

// Filter utilities
export * from "./filters";

// Comparison mode utilities
export * from "./comparison";

// Export utilities
export * from "./export";
