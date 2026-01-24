"use strict";
/**
 * Dashboard Modules Barrel File
 *
 * Exports all extracted dashboard modules following the one-way dependency rule:
 * - dashboard.ts → modules/*
 * - modules/* → shared/* (only)
 *
 * Modules NEVER import dashboard.ts or each other (except via shared/).
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
// Shared utilities (DOM-free)
__exportStar(require("./shared"), exports);
// DOM access (single 'any' exception)
__exportStar(require("./dom"), exports);
// Metrics calculation (DOM-free)
__exportStar(require("./metrics"), exports);
// Error handling
__exportStar(require("./errors"), exports);
// ML types and interfaces
__exportStar(require("./ml/types"), exports);
// ML rendering (Phase 5 expansion point)
__exportStar(require("./ml"), exports);
// Chart rendering utilities (renderDelta, renderSparkline, addChartTooltips)
__exportStar(require("./charts"), exports);
// Chart renderers (DOM-injected modules)
__exportStar(require("./charts/index"), exports);
// Filter utilities
__exportStar(require("./filters"), exports);
// Comparison mode utilities
__exportStar(require("./comparison"), exports);
// Export utilities
__exportStar(require("./export"), exports);
//# sourceMappingURL=index.js.map