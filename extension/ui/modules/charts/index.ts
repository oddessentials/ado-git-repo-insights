/**
 * Charts Module Barrel File
 *
 * Re-exports all chart rendering modules.
 * Maintains the one-way dependency rule: dashboard.ts → charts/*
 */

// Summary cards (PR count, cycle times, authors, reviewers)
export * from "./summary-cards";

// Throughput chart (bar chart with trend line)
export * from "./throughput";

// Cycle time charts (distribution and P50/P90 trend)
export * from "./cycle-time";

// Reviewer activity chart (horizontal bar chart)
export * from "./reviewer-activity";

// Predictions charts (forecast with confidence bands)
export * from "./predictions";

// Re-export existing chart utilities from parent charts.ts
// These will be moved here in a future refactor
