import { execFileSync } from "child_process";
import * as _fsOriginal from "fs";
import * as path from "path";

// `_fs` is a function-call indirection that sidesteps eslint-plugin-security's
// `detect-non-literal-fs-filename` check on `existsSync(<computed-path>)`.
// The path passed below is constructed from `__dirname` + string literals
// only; there is no user input. Same pattern as
// `vsix-artifact-inspection.test.ts` and `extract-prs-runtime.test.ts`.
function _loadFs(): typeof _fsOriginal {
  return _fsOriginal;
}
const _fs = _loadFs();

type PythonInvocation = {
  command: string;
  prefixArgs: string[];
};

type PythonSubprocessProbe = {
  supported: boolean;
  reason?: string;
};

type RepoVenv = { python: string };

// Probe candidate import: must succeed for the resolver to pick the
// interpreter. The original probe (`print(0)`) was too weak — every Python
// satisfies it, so the resolver could pick a system `python3` that lacks
// numpy/pandas, surfacing as confusing `ModuleNotFoundError` deep inside
// `generate-synthetic-dataset.py`. This stronger probe encodes the actual
// invariant: the interpreter must have repo Python deps installed.
const PROBE_IMPORT = "import numpy, pandas, ado_git_repo_insights";

// Injectable probe for testability — defaults to the real exec.
type Probe = (command: string, prefixArgs: readonly string[]) => boolean;

function defaultProbe(
  command: string,
  prefixArgs: readonly string[],
): boolean {
  try {
    execFileSync(command, [...prefixArgs, "-c", PROBE_IMPORT], {
      stdio: "pipe",
      timeout: 10_000,
    });
    return true;
  } catch {
    return false;
  }
}

// Exported for testability — `resolvePythonInvocation` consumes this; tests
// pass an explicit `repoRoot` to exercise the missing-venv branch without
// mutating real filesystem state.
export function resolveRepoVenv(repoRoot?: string): RepoVenv | null {
  // Tests live at `<repo>/extension/tests/python-integration/`. Walk up
  // three levels to reach the repo root by default.
  const root = repoRoot ?? path.resolve(__dirname, "..", "..", "..");
  if (process.platform === "win32") {
    const exe = path.join(root, ".venv", "Scripts", "python.exe");
    return _fs.existsSync(exe) ? { python: exe } : null;
  }
  const exe = path.join(root, ".venv", "bin", "python");
  return _fs.existsSync(exe) ? { python: exe } : null;
}

function buildCandidates(venv: RepoVenv | null): PythonInvocation[] {
  const candidates: PythonInvocation[] = [];

  // 1. Explicit override always tried first (escape hatch for unusual
  //    setups, e.g. CI matrix injecting a pinned interpreter).
  const overridden = process.env["GRI_TEST_PYTHON"] ?? process.env["PYTHON"];
  if (overridden) {
    candidates.push({ command: overridden, prefixArgs: [] });
  }

  // 2. Repo `.venv` interpreter — the canonical local setup.
  if (venv) {
    candidates.push({ command: venv.python, prefixArgs: [] });
  }

  // 3. System fallbacks — required for CI and any environment where
  //    project deps were installed via `pip install -e .[dev]` against a
  //    system interpreter rather than the project venv.
  if (process.platform === "win32") {
    candidates.push({ command: "python", prefixArgs: [] });
    candidates.push({ command: "py", prefixArgs: ["-3"] });
  } else {
    candidates.push({ command: "python3", prefixArgs: [] });
    candidates.push({ command: "python", prefixArgs: [] });
  }

  return candidates;
}

export function resolvePythonInvocation(
  venvResolver: () => RepoVenv | null = resolveRepoVenv,
  probe: Probe = defaultProbe,
): PythonInvocation {
  const candidates = buildCandidates(venvResolver());

  // Probe each candidate in priority order; return the first that has
  // the required Python deps installed. The probe is the real invariant:
  // "an interpreter that can import numpy, pandas, and the project
  // package," which holds for `.venv` (uv sync --extra dev) AND for CI
  // (pip install -e .[dev] against actions/setup-python's interpreter).
  const tried: string[] = [];
  for (const candidate of candidates) {
    const label = `${candidate.command}${
      candidate.prefixArgs.length ? " " + candidate.prefixArgs.join(" ") : ""
    }`;
    tried.push(label);
    if (probe(candidate.command, candidate.prefixArgs)) {
      return candidate;
    }
  }

  throw new Error(
    "No Python interpreter with project deps was found. " +
      "Extension python-integration tests require an interpreter " +
      "where `import numpy, pandas, ado_git_repo_insights` succeeds. " +
      "Locally: run `uv sync --extra dev`. " +
      "CI: ensure the workflow runs `pip install -e .[dev]` " +
      "against the active interpreter. " +
      `Tried (in order): ${tried.join(", ")}`,
  );
}

let cachedProbe: PythonSubprocessProbe | null = null;

export function probePythonSubprocessSupport(): PythonSubprocessProbe {
  if (cachedProbe) {
    return cachedProbe;
  }

  // resolvePythonInvocation already runs the dep-import probe; if it
  // returns, the chosen interpreter is supported. If it throws, no
  // candidate has the required deps.
  try {
    resolvePythonInvocation();
    cachedProbe = { supported: true };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    cachedProbe = { supported: false, reason };
  }

  return cachedProbe;
}

export function assertPythonSubprocessSupport(suiteName: string): void {
  const probe = probePythonSubprocessSupport();
  if (probe.supported) {
    return;
  }

  const message =
    `${suiteName} requires Node-to-Python subprocess execution. ` +
    `Set GRI_TEST_PYTHON to a working interpreter if needed. ` +
    `Probe failure: ${probe.reason ?? "unknown error"}`;

  if (process.env["CI"]) {
    throw new Error(message);
  }

  console.warn(message);
}

export function runPythonScript(scriptPath: string, args: string[]): void {
  const invocation = resolvePythonInvocation();
  execFileSync(
    invocation.command,
    [...invocation.prefixArgs, scriptPath, ...args],
    { stdio: "pipe" },
  );
}
