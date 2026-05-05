/**
 * @jest-environment node
 *
 * Real-task-lib reproducer test for ExtractPullRequests@3.
 *
 * The companion test (extract-prs-runtime.test.ts) jest.mocks
 * azure-pipelines-task-lib/task entirely with a stub. That bypasses the
 * real task-lib's env-var → vault → getInput plumbing — exactly the path
 * the customer's pipeline log shows is failing in production
 * (configuration banner missing `Extract Comments: true`, mode falling
 * back to `extract` despite YAML setting `mode: backfill-comments`).
 *
 * This test does NOT mock task-lib. It populates `process.env.INPUT_*`
 * with the values Azure would set when running the customer's two-step
 * YAML, lets real task-lib's _loadData() build its vault from those
 * env vars, then calls `run()` and asserts the actual spawn args.
 *
 * Failure of either case here = bug reproduced against HEAD with real
 * task-lib. Pass = bug is NOT in this combination, and investigation
 * needs to look at deeper differences between this harness and the
 * actual ADO agent runtime.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// Type-only imports for the jest.mock<typeof X> generic parameters,
// satisfying @typescript-eslint/consistent-type-imports.
import type * as ChildProcessNS from "child_process";
import type * as EventsNS from "events";

// ---------------------------------------------------------------------------
// Shared mutable state on globalThis under an inline literal key — the
// hoisted jest.mock factory below reads this without referencing any
// module-scope identifier (which jest's hoister would reject).
// ---------------------------------------------------------------------------

interface SpawnCall {
  cmd: string;
  args: readonly string[];
}

interface RuntimeState {
  spawnCalls: SpawnCall[];
  logLines: string[];
}

const state: RuntimeState = { spawnCalls: [], logLines: [] };
(globalThis as Record<string, unknown>)["__realTasklibTestState"] = state;

// ---------------------------------------------------------------------------
// Mock ONLY child_process — capture spawn args, no real Python. Real
// azure-pipelines-task-lib stays in place so we exercise the env→vault
// →getInput path that the customer's pipeline log proves is failing.
// ---------------------------------------------------------------------------

jest.mock("child_process", () => {
  const real = jest.requireActual<typeof ChildProcessNS>("child_process");
  const { EventEmitter } = jest.requireActual<typeof EventsNS>("events");
  const getState = (): RuntimeState =>
    (globalThis as Record<string, unknown>)[
      "__realTasklibTestState"
    ] as RuntimeState;
  return {
    ...real,
    spawn: (cmd: string, args: readonly string[]) => {
      getState().spawnCalls.push({ cmd, args: [...args] });
      const proc = new EventEmitter() as InstanceType<typeof EventEmitter> & {
        kill: () => void;
      };
      proc.kill = () => undefined;
      setImmediate(() => proc.emit("close", 0));
      return proc;
    },
    execSync: (cmd: string): string => {
      const s = String(cmd);
      if (/--version/.test(s)) return "Python 3.12.0\n";
      if (/import ado_git_repo_insights/.test(s)) return "";
      if (/pip install/.test(s)) {
        throw new Error(`pip install must not run in test; cmd=${s}`);
      }
      return "";
    },
  };
});

// Capture console output so we can assert on the configuration banner
// strings (Extract Comments: true, Mode: backfill-comments, etc.).
// Install per-test (NOT module-scope) so the sibling
// extract-prs-runtime.test.ts file's console.log capture isn't
// clobbered when both test files load in the same jest worker under
// `pnpm test:coverage` (--runInBand).
let realLog: typeof console.log | null = null;

// ---------------------------------------------------------------------------
// Env-var harness
// ---------------------------------------------------------------------------

/**
 * Capture every INPUT_*, AGENT_*, SYSTEM_* env var into a Map so we can
 * restore them after each test. Also clear them from process.env so a
 * stray host env doesn't leak into the task-lib vault.
 *
 * Reflect.* is used in place of bracket-notation get/set/delete on
 * process.env so the security/detect-object-injection rule is not
 * triggered by dynamic-key access patterns.
 */
function clearAdoEnv(): Map<string, string | undefined> {
  const backup = new Map<string, string | undefined>();
  for (const key of Object.keys(process.env)) {
    if (
      key.startsWith("INPUT_") ||
      key.startsWith("AGENT_") ||
      key.startsWith("SYSTEM_") ||
      key.startsWith("ENDPOINT_") ||
      key.startsWith("SECRET_") ||
      key.startsWith("VSTS_")
    ) {
      backup.set(key, Reflect.get(process.env, key) as string | undefined);
      Reflect.deleteProperty(process.env, key);
    }
  }
  return backup;
}

function restoreAdoEnv(backup: Map<string, string | undefined>): void {
  for (const [k, v] of backup) {
    if (v === undefined) Reflect.deleteProperty(process.env, k);
    else Reflect.set(process.env, k, v);
  }
}

interface TaskRuntime {
  run: () => Promise<void>;
}

/**
 * Load index.js with a fresh module registry so task-lib's
 * `_loadData()` re-runs against the env vars we just set. Uses
 * `jest.resetModules()` + dynamic `await import()` so we don't need a
 * `require()` call (no @typescript-eslint/no-require-imports
 * suppression needed). `jest.mock()` factories above are still honored
 * by the dynamic import — jest hooks both require and import.
 */
async function loadTaskWithFreshEnv(): Promise<TaskRuntime> {
  jest.resetModules();
  const mod = (await import("../tasks/extract-prs/index")) as unknown;
  return mod as TaskRuntime;
}

let workRoot: string;
let envBackup: Map<string, string | undefined> = new Map();

beforeEach(() => {
  workRoot = fs.mkdtempSync(path.join(os.tmpdir(), "extract-prs-real-tl-"));
  state.spawnCalls = [];
  state.logLines = [];
  envBackup = clearAdoEnv();
  // task-lib uses a global flag to skip _loadData on subsequent requires
  // (see node_modules/.../task.js:2427 `if (!global['_vsts_task_lib_loaded'])`).
  // Clear it so loadTaskWithFreshEnv below gets a freshly-initialized vault.
  Reflect.deleteProperty(globalThis, "_vsts_task_lib_loaded");
  // Install console.log capture for THIS test only.
  realLog = console.log;
  console.log = (...args: unknown[]): void => {
    state.logLines.push(args.map((a) => String(a)).join(" "));
  };
});

afterEach(() => {
  if (realLog !== null) {
    console.log = realLog;
    realLog = null;
  }
  restoreAdoEnv(envBackup);
  fs.rmSync(workRoot, { recursive: true, force: true });
});

// Customer-equivalent multi-line projects (real ADO agent passes the
// raw YAML block scalar with newlines preserved).
const CUSTOMER_PROJECTS_RAW = [
  "IT%20Payer%20Applications",
  "Apollo",
  "Consumer%20Technology",
  "Core%20Systems",
].join("\n");

/**
 * Set the env vars Azure would set when running the customer's YAML
 * step. Names follow `INPUT_<name>` with task-lib's `_getVariableKey`
 * transform applied (replace `.` and ` ` with `_`, then uppercase).
 */
function setStep1ExtractEnv(): void {
  process.env.INPUT_ORGANIZATION = "ITPayerApplications";
  process.env.INPUT_PROJECTS = CUSTOMER_PROJECTS_RAW;
  process.env.INPUT_PAT = "fake-pat";
  process.env.INPUT_DATABASE = path.join(
    workRoot,
    "data",
    "ado-insights.sqlite",
  );
  process.env.INPUT_OUTPUTDIR = path.join(workRoot, "csv_output");
  process.env.INPUT_AGGREGATESDIR = path.join(workRoot, "aggregates");
  process.env.INPUT_BACKFILLDAYS = "15";
  process.env.INPUT_INCLUDECOMMENTS = "true";
  process.env.INPUT_MODE = "extract"; // task.json defaultValue
  process.env.INPUT_GENERATEAGGREGATES = "true"; // task.json defaultValue
  process.env.INPUT_COMMENTSMAXTHREADSPERPR = "50"; // task.json defaultValue
  process.env.INPUT_ENABLEPREDICTIONS = "false";
  process.env.INPUT_ENABLEINSIGHTS = "false";
  // Real agent sets these so task-lib's vault path resolution works.
  process.env.AGENT_TEMPDIRECTORY = workRoot;
  process.env.AGENT_WORKFOLDER = workRoot;
}

function setStep2BackfillEnv(): void {
  process.env.INPUT_ORGANIZATION = "ITPayerApplications";
  process.env.INPUT_PROJECTS = CUSTOMER_PROJECTS_RAW;
  process.env.INPUT_PAT = "fake-pat";
  process.env.INPUT_DATABASE = path.join(
    workRoot,
    "data",
    "ado-insights.sqlite",
  );
  process.env.INPUT_OUTPUTDIR = path.join(workRoot, "csv_output");
  process.env.INPUT_AGGREGATESDIR = path.join(workRoot, "aggregates");
  process.env.INPUT_MODE = "backfill-comments";
  process.env.INPUT_BACKFILLLIMIT = "2500";
  process.env.INPUT_INCLUDECOMMENTS = "false"; // task.json defaultValue
  process.env.INPUT_GENERATEAGGREGATES = "true";
  process.env.INPUT_COMMENTSMAXTHREADSPERPR = "50";
  process.env.INPUT_ENABLEPREDICTIONS = "false";
  process.env.INPUT_ENABLEINSIGHTS = "false";
  process.env.AGENT_TEMPDIRECTORY = workRoot;
  process.env.AGENT_WORKFOLDER = workRoot;
}

function failureContext(): string {
  return (
    `spawnCalls=${JSON.stringify(state.spawnCalls)}; ` +
    `logLines=${JSON.stringify(state.logLines)}`
  );
}

// ---------------------------------------------------------------------------
// Tests — same two contracts as the mocked test, but exercising the real
// azure-pipelines-task-lib env→vault→getInput plumbing.
// ---------------------------------------------------------------------------

describe("ExtractPullRequests@3 with REAL azure-pipelines-task-lib", () => {
  it("Step 1 (INPUT_INCLUDECOMMENTS=true) must invoke CLI extract subcommand WITH --include-comments", async () => {
    setStep1ExtractEnv();
    const taskModule = await loadTaskWithFreshEnv();

    await taskModule.run();

    const first = state.spawnCalls[0];
    if (first === undefined) {
      throw new Error(`no spawn calls captured; ${failureContext()}`);
    }
    expect(first.args.slice(0, 3)).toEqual([
      "-m",
      "ado_git_repo_insights.cli",
      "extract",
    ]);
    expect(first.args).toContain("--include-comments");
    expect(
      state.logLines.some((line) => line.includes("Extract Comments: true")),
    ).toBe(true);
  });

  it("Step 2 (INPUT_MODE=backfill-comments) must invoke CLI backfill-comments subcommand and never route to extract", async () => {
    setStep2BackfillEnv();
    const taskModule = await loadTaskWithFreshEnv();

    await taskModule.run();

    const first = state.spawnCalls[0];
    if (first === undefined) {
      throw new Error(`no spawn calls captured; ${failureContext()}`);
    }
    expect(first.args.slice(0, 3)).toEqual([
      "-m",
      "ado_git_repo_insights.cli",
      "backfill-comments",
    ]);
    expect(
      state.logLines.some((line) => line.includes("Mode: backfill-comments")),
    ).toBe(true);
    expect(
      state.logLines.some((line) =>
        line.includes("Running backfill-comments..."),
      ),
    ).toBe(true);
    const wronglyExtract = state.spawnCalls.find(
      (c) => c.args[2] === "extract",
    );
    expect(wronglyExtract).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Negative controls — prove the customer's pipeline-log failure shape
  // appears IFF the agent never set INPUT_INCLUDECOMMENTS / INPUT_MODE.
  // If these tests pass, the production failure is mechanically equivalent
  // to "those env vars are not in process.env at task startup", which
  // narrows the next investigation step from runtime wiring (proven sound
  // above) to whatever step in the manifest / packaging / agent-side
  // declaration prevents Azure from setting them.
  // -------------------------------------------------------------------------

  it("Step 1 with INPUT_INCLUDECOMMENTS missing reproduces customer banner-missing shape (no `Extract Comments: true`, no `--include-comments`)", async () => {
    setStep1ExtractEnv();
    delete process.env.INPUT_INCLUDECOMMENTS;
    const taskModule = await loadTaskWithFreshEnv();

    await taskModule.run();

    // Banner line printed only inside `if (includeComments) { ... }`.
    expect(
      state.logLines.some((line) => line.includes("Extract Comments: true")),
    ).toBe(false);
    // Spawn args must NOT contain --include-comments.
    const first = state.spawnCalls[0];
    if (first === undefined) {
      throw new Error(`no spawn calls captured; ${failureContext()}`);
    }
    expect(first.args).not.toContain("--include-comments");
    // Subcommand still routes to `extract` and the step succeeds — exactly
    // what the customer's pipeline log shows for the first task.
    expect(first.args.slice(0, 3)).toEqual([
      "-m",
      "ado_git_repo_insights.cli",
      "extract",
    ]);
  });

  it("Step 2 with INPUT_MODE and INPUT_BACKFILLLIMIT both missing reproduces customer mode-fallback shape (`Running extraction...`, no `Mode: backfill-comments`)", async () => {
    setStep2BackfillEnv();
    // Drop both env vars together so the test only exercises the *if-then*
    // behavior: with neither input set, mode falls back to "extract" and
    // backfill-mode validation has nothing to reject. This matches the
    // customer's pipeline log shape. The reason Azure didn't set those env
    // vars in production is OUT OF SCOPE for this test — it's the open
    // investigation question, not an assumption this test is allowed to bake
    // in. (An earlier attempt to attribute it to a visibleRule-syntax
    // cascade was disproved by the existing repo invariant in
    // tests/unit/test_task_json_semantic_invariants.py:90-108.)
    delete process.env.INPUT_MODE;
    delete process.env.INPUT_BACKFILLLIMIT;
    const taskModule = await loadTaskWithFreshEnv();

    await taskModule.run();

    // No "Mode: backfill-comments" banner line.
    expect(
      state.logLines.some((line) => line.includes("Mode: backfill-comments")),
    ).toBe(false);
    // Step label falls back to "Running extraction..." (index.js:680-682).
    expect(
      state.logLines.some((line) => line.includes("Running extraction...")),
    ).toBe(true);
    // Subcommand falls back to `extract` — exactly what the customer's
    // pipeline log shows for the second task.
    const first = state.spawnCalls[0];
    if (first === undefined) {
      throw new Error(`no spawn calls captured; ${failureContext()}`);
    }
    expect(first.args[2]).toBe("extract");
  });
});
