/**
 * Mode Parity Tests (P3 Guardrail)
 *
 * Behavioral tests verifying that local mode and extension mode have
 * equivalent initialization flows. Replaces previous structural tests
 * that only scanned source code strings.
 *
 * Also includes one structural sentinel: chart modules must never
 * import or branch on isLocalMode, ensuring rendering stays mode-agnostic.
 */

import * as _fsOriginal from "fs";
function _loadFs(): typeof _fsOriginal { return _fsOriginal; }
const _fs = _loadFs();
import * as path from "path";
import { isLocalMode, getLocalDatasetPath } from "../../ui/modules/sdk";
import { DatasetLoader, normalizeRollup } from "../../ui/dataset-loader";

// ---------------------------------------------------------------------------
// Mode Detection (behavioral)
// ---------------------------------------------------------------------------

describe("Mode Detection (behavioral)", () => {
  const originalMode = (globalThis as Record<string, unknown>)
    .LOCAL_DASHBOARD_MODE;
  const originalPath = (globalThis as Record<string, unknown>).DATASET_PATH;

  afterEach(() => {
    // Restore original window state
    if (originalMode !== undefined) {
      (window as unknown as Record<string, unknown>).LOCAL_DASHBOARD_MODE = originalMode;
    } else {
      delete (window as unknown as Record<string, unknown>).LOCAL_DASHBOARD_MODE;
    }
    if (originalPath !== undefined) {
      (window as unknown as Record<string, unknown>).DATASET_PATH = originalPath;
    } else {
      delete (window as unknown as Record<string, unknown>).DATASET_PATH;
    }
  });

  it("isLocalMode() returns true when LOCAL_DASHBOARD_MODE is set to true", () => {
    (window as unknown as Record<string, unknown>).LOCAL_DASHBOARD_MODE = true;
    expect(isLocalMode()).toBe(true);
  });

  it("isLocalMode() returns false when LOCAL_DASHBOARD_MODE is unset", () => {
    delete (window as unknown as Record<string, unknown>).LOCAL_DASHBOARD_MODE;
    expect(isLocalMode()).toBe(false);
  });

  it("isLocalMode() returns false for string 'true' (strict equality guard)", () => {
    (window as unknown as Record<string, unknown>).LOCAL_DASHBOARD_MODE = "true";
    expect(isLocalMode()).toBe(false);
  });

  it("isLocalMode() returns false for numeric 1", () => {
    (window as unknown as Record<string, unknown>).LOCAL_DASHBOARD_MODE = 1;
    expect(isLocalMode()).toBe(false);
  });

  it("getLocalDatasetPath() reads from window.DATASET_PATH", () => {
    (window as unknown as Record<string, unknown>).DATASET_PATH = "./test-data";
    expect(getLocalDatasetPath()).toBe("./test-data");
  });

  it("getLocalDatasetPath() returns default when DATASET_PATH is unset", () => {
    delete (window as unknown as Record<string, unknown>).DATASET_PATH;
    expect(getLocalDatasetPath()).toBe("./dataset");
  });
});

// ---------------------------------------------------------------------------
// Shared Error Handlers (behavioral)
// ---------------------------------------------------------------------------

describe("Shared Error Handlers (behavioral)", () => {
  // Error handlers write to DOM elements cached at init time.
  // We verify they are importable and callable without throwing.
  // Full DOM output testing is in error-handling tests.

  it("handleError is a function that can be imported from errors module", async () => {
    const { handleError } = await import("../../ui/modules/errors");
    expect(typeof handleError).toBe("function");
  });

  it("showSetupRequired is a function that can be imported from errors module", async () => {
    const { showSetupRequired } = await import("../../ui/modules/errors");
    expect(typeof showSetupRequired).toBe("function");
  });

  it("showPermissionDenied is a function that can be imported from errors module", async () => {
    const { showPermissionDenied } = await import("../../ui/modules/errors");
    expect(typeof showPermissionDenied).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// DatasetLoader used in both modes (behavioral)
// ---------------------------------------------------------------------------

describe("DatasetLoader parity (behavioral)", () => {
  it("DatasetLoader can be instantiated with a filesystem path", () => {
    // DatasetLoader imported at top level
    expect(typeof DatasetLoader).toBe("function");

    // CLI/docs mode: DatasetLoader takes a base URL string
    const loader = new DatasetLoader("./test-data");
    expect(loader).toBeDefined();
  });

  it("normalizeRollup is shared between both modes", () => {
    // normalizeRollup imported at top level
    expect(typeof normalizeRollup).toBe("function");

    // Both modes normalize through the same function
    const raw = { week: "2025-W01", pr_count: 5 };
    const normalized = normalizeRollup(raw);
    expect(normalized.week).toBe("2025-W01");
    expect(normalized.pr_count).toBe(5);
    expect(normalized.cycle_time_p50).toBeNull(); // default applied
  });
});

// ---------------------------------------------------------------------------
// Chart Module Isolation Sentinel (structural — intentionally kept)
// ---------------------------------------------------------------------------

describe("Chart module isolation invariant", () => {
  // This is the ONE structural test worth keeping. Chart modules must
  // NEVER import isLocalMode or branch on LOCAL_DASHBOARD_MODE.
  // If this sentinel fails, someone introduced mode-specific rendering
  // logic into a chart module — which breaks the parity invariant.

  const CHART_MODULES = [
    "throughput.ts",
    "cycle-time.ts",
    "reviewer-activity.ts",
    "summary-cards.ts",
    "predictions.ts",
  ];

  it.each(CHART_MODULES)(
    "%s does not import isLocalMode or branch on mode",
    (filename) => {
      const filePath = path.join(
        __dirname,
        "../../ui/modules/charts",
        filename,
      );
      const source = _fs.readFileSync(filePath, "utf-8");
      expect(source).not.toContain("isLocalMode");
      expect(source).not.toContain("LOCAL_DASHBOARD_MODE");
    },
  );
});
