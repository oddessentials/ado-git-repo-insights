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

// Re-export existing chart utilities from parent charts.ts
// These will be moved here in a future refactor
