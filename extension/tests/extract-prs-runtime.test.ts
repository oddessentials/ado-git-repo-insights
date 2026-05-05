/**
 * @jest-environment node
 *
 * Packaged-runtime regression test for ExtractPullRequests@2.
 *
 * Loads the actual shipped extension/tasks/extract-prs/index.js with
 * azure-pipelines-task-lib and child_process mocked, then drives the
 * customer's exact YAML inputs through `run()` and asserts:
 *
 *   1. Step 1 (extract with `includeComments: true`) invokes the Python
 *      CLI with the `extract` subcommand AND the `--include-comments`
 *      flag, and the configuration banner prints `Extract Comments: true`.
 *   2. Step 2 (`mode: backfill-comments`) invokes the Python CLI with
 *      the `backfill-comments` subcommand (never routes to extract) and
 *      the configuration banner prints `Mode: backfill-comments`.
 *
 * Why this test exists: a customer artifact (samples/) showed
 * `pr_threads = 0` and `comments_extracted_at = 0/45,715` even though
 * their pipeline YAML enabled both code paths and ran successfully for
 * weeks. Either (a) the task wiring drops the inputs, or (b) the
 * customer's installed task version diverges from HEAD. This test
 * proves which by exercising HEAD's runtime end-to-end.
 *
 * Notes on packaged equivalence: stage:tasks (npm install for tfx-flat
 * node_modules) does NOT transform `index.js`, so testing source equals
 * testing the packaged runtime today. If `stage:tasks` ever bundles or
 * transpiles, this test must be updated to load the staged artifact.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { run } from "../tasks/extract-prs/index";

// Type-only imports so the jest.mock factories can reference module
// shapes via `typeof X` without triggering @typescript-eslint/consistent-
// type-imports on inline `import()` type annotations.
import type * as ChildProcessNS from "child_process";
import type * as EventsNS from "events";

// ---------------------------------------------------------------------------
// Shared mutable state placed on globalThis (under an inline literal key)
// so the hoisted jest.mock() factories can read it without referencing any
// closure-captured module-scope identifier (a reference jest's hoister would
// reject). Factories are passed by value at hoist time but only invoked when
// the mocked module is required, by which point this assignment has run.
//
// `inputs` and `boolInputs` use Map (not Record) so dynamic-key access in
// the factories doesn't trip security/detect-object-injection.
// ---------------------------------------------------------------------------

interface SpawnCall {
  cmd: string;
  args: readonly string[];
}

interface RuntimeState {
  inputs: Map<string, string>;
  boolInputs: Map<string, boolean>;
  lastResult: { result: number; message: string } | null;
  logLines: string[];
  spawnCalls: SpawnCall[];
}

const state: RuntimeState = {
  inputs: new Map(),
  boolInputs: new Map(),
  lastResult: null,
  logLines: [],
  spawnCalls: [],
};

(globalThis as Record<string, unknown>)["__extractPrsTaskMockState"] = state;

// ---------------------------------------------------------------------------
// Mock azure-pipelines-task-lib/task — every getInput / getBoolInput /
// setResult is routed through the shared state object.
//
// `virtual: true` because the package only exists in
// extension/tasks/extract-prs/node_modules (staged for VSIX), not on the
// test's resolution path under extension/tests/.
// ---------------------------------------------------------------------------

jest.mock(
  "azure-pipelines-task-lib/task",
  () => {
    const TaskResult = { Failed: 1, Succeeded: 0 };
    const getState = (): RuntimeState =>
      (globalThis as Record<string, unknown>)[
        "__extractPrsTaskMockState"
      ] as RuntimeState;
    return {
      TaskResult,
      getInput: (name: string): string | null => {
        const v = getState().inputs.get(name);
        return v == null ? null : v;
      },
      getBoolInput: (name: string): boolean =>
        getState().boolInputs.get(name) === true,
      setResult: (result: number, message: string): void => {
        const s = getState();
        s.lastResult = { result, message };
        const tag = result === TaskResult.Succeeded ? "Succeeded" : "Failed";
        s.logLines.push(`[setResult ${tag}] ${message}`);
      },
      debug: (): void => undefined,
    };
  },
  { virtual: true },
);

// ---------------------------------------------------------------------------
// Mock child_process — capture spawn args, no real process launches; stub
// execSync probes used by validatePythonEnvironment / installPackage.
// ---------------------------------------------------------------------------

jest.mock("child_process", () => {
  const real = jest.requireActual<typeof ChildProcessNS>("child_process");
  const { EventEmitter } = jest.requireActual<typeof EventsNS>("events");
  const getState = (): RuntimeState =>
    (globalThis as Record<string, unknown>)[
      "__extractPrsTaskMockState"
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
      // validatePythonEnvironment probes "<cmd> --version 2>&1"
      if (/--version/.test(s)) return "Python 3.12.0\n";
      // installPackage probes "<py> -c \"import ado_git_repo_insights\""
      if (/import ado_git_repo_insights/.test(s)) return "";
      // A real pip install must never run inside a unit test.
      if (/pip install/.test(s)) {
        throw new Error(`pip install must not run in test; cmd=${s}`);
      }
      return "";
    },
  };
});

// Capture console output during each test only. Module-scope override
// would conflict with the sibling real-task-lib test file under
// `pnpm test:coverage` (--runInBand): whichever file loaded second
// would win and intercept the other's banners. Per-test install/restore
// keeps each file's state.logLines isolated from sibling test files.
let realLog: typeof console.log | null = null;

// ---------------------------------------------------------------------------
// Per-test scaffolding
// ---------------------------------------------------------------------------

let workRoot: string;

beforeEach(() => {
  workRoot = fs.mkdtempSync(path.join(os.tmpdir(), "extract-prs-runtime-"));
  state.inputs.clear();
  state.boolInputs.clear();
  state.lastResult = null;
  state.logLines = [];
  state.spawnCalls = [];
  // Install console.log capture for THIS test only (sibling test file
  // also captures; module-scope override would race with whichever
  // file loaded last winning).
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
  // rmSync with force:true is a no-op on missing paths, so we don't need
  // a separate existsSync probe (which would also trip
  // security/detect-non-literal-fs-filename without value).
  if (workRoot) {
    fs.rmSync(workRoot, { recursive: true, force: true });
  }
});

// Customer-equivalent multi-line projects from samples/ pipeline YAML.
const CUSTOMER_PROJECTS_RAW = [
  "IT%20Payer%20Applications",
  "Apollo",
  "Consumer%20Technology",
  "Core%20Systems",
].join("\n");

function commonInputs(): Record<string, string> {
  return {
    organization: "ITPayerApplications",
    projects: CUSTOMER_PROJECTS_RAW,
    pat: "fake-pat",
    database: path.join(workRoot, "data", "ado-insights.sqlite"),
    outputDir: path.join(workRoot, "csv_output"),
    aggregatesDir: path.join(workRoot, "aggregates"),
    // task.json defaultValue "50" is passed through by real task-lib even
    // when YAML omits it; mirror that here for fidelity.
    commentsMaxThreadsPerPr: "50",
  };
}

function seedInputs(values: Record<string, string>): void {
  for (const [k, v] of Object.entries(values)) {
    state.inputs.set(k, v);
  }
}

function failureContext(): string {
  return (
    `lastResult=${JSON.stringify(state.lastResult)}; ` +
    `spawnCalls=${JSON.stringify(state.spawnCalls)}; ` +
    `logLines=${JSON.stringify(state.logLines)}`
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("packaged ExtractPullRequests@2 runtime — customer YAML contract", () => {
  it("Step 1 (extract with includeComments: true) invokes the CLI extract subcommand WITH --include-comments", async () => {
    seedInputs({
      ...commonInputs(),
      backfillDays: "15",
      // mode unset → task.json defaultValue "extract" applies; mirror that.
      mode: "extract",
    });
    state.boolInputs.set("includeComments", true);
    // task.json defaultValue "true" — Azure passes through to getBoolInput.
    state.boolInputs.set("generateAggregates", true);

    await run();

    if (state.lastResult === null || state.lastResult.result !== 0) {
      throw new Error(`expected Succeeded; ${failureContext()}`);
    }

    // First spawn must be the CLI extract subcommand.
    // buildExtractArgs places ['-m', CLI_MODULE, 'extract', ...] at the head.
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

    // Configuration banner proves boolean coercion of includeComments
    // worked (printed inside `if (includeComments) { ... }` in index.js).
    expect(
      state.logLines.some((line) => line.includes("Extract Comments: true")),
    ).toBe(true);
  });

  it("Step 2 (mode: backfill-comments) invokes the CLI backfill-comments subcommand and never routes to extract", async () => {
    seedInputs({
      ...commonInputs(),
      mode: "backfill-comments",
      backfillLimit: "2500",
    });
    // includeComments unset (task.json default "false") — real task-lib
    // returns false from getBoolInput; mock mirrors that by default.
    state.boolInputs.set("generateAggregates", true);

    await run();

    if (state.lastResult === null || state.lastResult.result !== 0) {
      throw new Error(`expected Succeeded; ${failureContext()}`);
    }

    const first = state.spawnCalls[0];
    if (first === undefined) {
      throw new Error(`no spawn calls captured; ${failureContext()}`);
    }
    expect(first.args.slice(0, 3)).toEqual([
      "-m",
      "ado_git_repo_insights.cli",
      "backfill-comments",
    ]);

    // Mode banner proves the mode getInput was wired and the
    // backfill-comments routing branch fired.
    expect(
      state.logLines.some((line) => line.includes("Mode: backfill-comments")),
    ).toBe(true);

    // Routing-correctness: no spawn should have invoked the `extract`
    // subcommand by accident. generate-csv / generate-aggregates have
    // distinct subcommand strings and won't false-positive here.
    const wronglyExtract = state.spawnCalls.find(
      (c) => c.args[2] === "extract",
    );
    expect(wronglyExtract).toBeUndefined();
  });
});
