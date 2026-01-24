"use strict";
/**
 * ML Data Provider interface (async seam for future service integration).
 *
 * This allows swapping between:
 * - Local JSON files (current)
 * - Pipeline artifact-loaded JSON
 * - Remote service calls (future Prophet/OpenAI)
 *
 * Caching and error handling can be centralized via provider implementations.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createInitialMlState = createInitialMlState;
/**
 * Create initial ML feature state.
 */
function createInitialMlState() {
    return {
        predictionsState: "idle",
        insightsState: "idle",
        predictionsData: null,
        insightsData: null,
        predictionsError: null,
        insightsError: null,
    };
}
//# sourceMappingURL=types.js.map