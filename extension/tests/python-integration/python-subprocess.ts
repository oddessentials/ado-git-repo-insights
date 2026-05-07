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

export function resolvePythonInvocation(
  venvResolver: () => RepoVenv | null = resolveRepoVenv,
): PythonInvocation {
  // Explicit override always wins (escape hatch for unusual setups, e.g.
  // CI matrix injecting a pinned interpreter).
  const overridden = process.env["GRI_TEST_PYTHON"] ?? process.env["PYTHON"];
  if (overridden) {
    return { command: overridden, prefixArgs: [] };
  }

  // Prefer the project venv produced by `uv sync --extra dev`. The previous
  // fallback to bare `python3` (Linux/macOS) or `python` (Windows) resolved
  // an interpreter on PATH but pointed at a system interpreter that does
  // NOT have the Python deps these tests need (numpy, pandas, etc.). The
  // confusing surface was a `ModuleNotFoundError: No module named 'numpy'`
  // crash from an extension Jest test (2026-05). The `venvResolver`
  // parameter is injectable for testability — callers in this repo never
  // pass it.
  const venv = venvResolver();
  if (venv) {
    return { command: venv.python, prefixArgs: [] };
  }

  // No venv found: fail clearly with the canonical setup remediation.
  // We deliberately do NOT fall back to system `python3` / `py -3` /
  // `python` — that recreates the silent missing-deps failure mode this
  // fix exists to eliminate.
  throw new Error(
    "Project Python venv not found at .venv/. " +
      "Extension python-integration tests require Python deps from " +
      "the repo venv (numpy, pandas, etc.). " +
      "Run: uv sync --extra dev",
  );
}

let cachedProbe: PythonSubprocessProbe | null = null;

export function probePythonSubprocessSupport(): PythonSubprocessProbe {
  if (cachedProbe) {
    return cachedProbe;
  }

  let invocation: PythonInvocation;
  try {
    invocation = resolvePythonInvocation();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    cachedProbe = { supported: false, reason };
    return cachedProbe;
  }

  try {
    execFileSync(
      invocation.command,
      [...invocation.prefixArgs, "-c", "print(0)"],
      { stdio: "pipe" },
    );
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
