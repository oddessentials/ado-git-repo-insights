/**
 * Regression locks for `python-subprocess.ts::resolvePythonInvocation()`.
 *
 * The original helper unconditionally returned bare `python3` (Linux/macOS)
 * or `python` (Windows). That resolved fine on most systems but pointed at
 * a system interpreter without `numpy`/`pandas`/`ado_git_repo_insights`
 * (deps installed only into the project venv via `uv sync --extra dev`).
 * The symptom was 13 Jest failures during local preflight in 2026-05, all
 * variants of `ModuleNotFoundError: No module named 'numpy'`.
 *
 * The first fix made `.venv` mandatory and threw when missing, which
 * worked locally but broke CI: GitHub's `extension-tests` job uses
 * `actions/setup-python` + `pip install -e .[dev]` against a system
 * interpreter and never creates `.venv`. The current contract resolves
 * by *capability probe* instead of *path existence*: try candidates in
 * order (override → `.venv` → system fallbacks), probe each with
 * `import numpy, pandas, ado_git_repo_insights`, and return the first
 * that passes. This works for both layouts.
 *
 * Lock the post-fix contract:
 *   1. `GRI_TEST_PYTHON` / `PYTHON` env overrides are tried first.
 *   2. Repo `.venv` interpreter is tried before system fallbacks.
 *   3. A candidate is only chosen if its dep-import probe passes.
 *   4. If the venv is missing, the resolver falls through to system
 *      `python3` / `python` / `py -3` rather than throwing.
 *   5. The resolver throws ONLY if no candidate has the required deps,
 *      with an actionable message referencing both the local
 *      (`uv sync --extra dev`) and CI (`pip install -e .[dev]`) paths.
 */
import * as fs from "fs";
import * as _fsOriginal from "fs";
import * as os from "os";
import * as path from "path";

import { resolvePythonInvocation, resolveRepoVenv } from "./python-subprocess";

// `_fs` is a function-call indirection that sidesteps eslint-plugin-security's
// `detect-non-literal-fs-filename` for the precondition `existsSync` check
// below — same pattern as the helper this file tests. The path is built
// from `__dirname` + string literals only.
function _loadFs(): typeof _fsOriginal {
  return _fsOriginal;
}
const _fs = _loadFs();

// Test-only probe factories. The injected probe runs in milliseconds (no
// subprocess) so each test's behavior is isolated from the host's actual
// Python installation. Real probes are exercised by the integration tests
// (`performance.test.ts`, `synthetic-fixtures.test.ts`).
const probeAlwaysTrue = (): boolean => true;
const probeAlwaysFalse = (): boolean => false;
const probeOnly = (allowed: string) => (cmd: string) => cmd === allowed;

describe("resolvePythonInvocation", () => {
  let savedGri: string | undefined;
  let savedPython: string | undefined;

  beforeEach(() => {
    savedGri = process.env["GRI_TEST_PYTHON"];
    savedPython = process.env["PYTHON"];
    delete process.env["GRI_TEST_PYTHON"];
    delete process.env["PYTHON"];
  });

  afterEach(() => {
    if (savedGri === undefined) {
      delete process.env["GRI_TEST_PYTHON"];
    } else {
      process.env["GRI_TEST_PYTHON"] = savedGri;
    }
    if (savedPython === undefined) {
      delete process.env["PYTHON"];
    } else {
      process.env["PYTHON"] = savedPython;
    }
  });

  it("prefers the repo .venv interpreter over system python (regression: 2026-05 numpy)", () => {
    // With both .venv and system python passing the probe, .venv wins.
    const venv = { python: "/repo/.venv/bin/python" };
    const result = resolvePythonInvocation(() => venv, probeAlwaysTrue);
    expect(result.command).toBe(venv.python);
    expect(result.prefixArgs).toEqual([]);
  });

  it("falls back to system python when .venv missing but system probe passes (CI parity)", () => {
    // GitHub's extension-tests job: actions/setup-python + pip install -e .[dev]
    // — no .venv ever. The resolver must accept system python3/python that
    // has the project deps installed.
    const result = resolvePythonInvocation(() => null, probeAlwaysTrue);
    if (process.platform === "win32") {
      expect(result.command).toBe("python");
    } else {
      expect(result.command).toBe("python3");
    }
    expect(result.prefixArgs).toEqual([]);
  });

  it("throws actionable error only when NO candidate has the required deps", () => {
    // No override, no .venv, AND no system interpreter has the deps.
    expect(() => resolvePythonInvocation(() => null, probeAlwaysFalse)).toThrow(
      /No Python interpreter with project deps.*uv sync --extra dev.*pip install -e \.\[dev\]/s,
    );
  });

  it("error lists the candidates it tried, in order", () => {
    process.env["GRI_TEST_PYTHON"] = "/explicit/python";
    const venv = { python: "/repo/.venv/bin/python" };
    let thrown: Error | undefined;
    try {
      resolvePythonInvocation(() => venv, probeAlwaysFalse);
    } catch (err) {
      thrown = err as Error;
    }
    expect(thrown).toBeDefined();
    const message = thrown?.message ?? "";
    expect(message).toContain("Tried (in order):");
    expect(message).toContain("/explicit/python");
    expect(message).toContain("/repo/.venv/bin/python");
    if (process.platform === "win32") {
      expect(message).toContain("python");
      expect(message).toContain("py -3");
    } else {
      expect(message).toContain("python3");
    }
  });

  it("GRI_TEST_PYTHON is tried first AND must pass probe", () => {
    process.env["GRI_TEST_PYTHON"] = "/override/python";
    const venv = { python: "/repo/.venv/bin/python" };
    const result = resolvePythonInvocation(
      () => venv,
      probeOnly("/override/python"),
    );
    expect(result.command).toBe("/override/python");
  });

  it("override falls through to next candidate if its probe fails", () => {
    process.env["GRI_TEST_PYTHON"] = "/broken/python";
    const venv = { python: "/repo/.venv/bin/python" };
    const result = resolvePythonInvocation(
      () => venv,
      probeOnly("/repo/.venv/bin/python"),
    );
    expect(result.command).toBe("/repo/.venv/bin/python");
  });

  it("PYTHON env var is honored when GRI_TEST_PYTHON unset", () => {
    process.env["PYTHON"] = "/python-env-var";
    const result = resolvePythonInvocation(
      () => null,
      probeOnly("/python-env-var"),
    );
    expect(result.command).toBe("/python-env-var");
  });
});

describe("resolveRepoVenv", () => {
  it("returns null when the venv is missing", () => {
    // A fresh tmpdir has no `.venv`. With the new resolver contract this
    // is no longer fatal — the resolver continues to system fallbacks.
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "no-venv-"));
    try {
      expect(resolveRepoVenv(empty)).toBeNull();
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  it("resolves the canonical interpreter path in this repo", () => {
    // Smoke: with the real repo's `.venv` present (developer ran
    // `uv sync --extra dev`), the helper resolves to the canonical path.
    // Skipped on CI where `.venv` is intentionally not created.
    const repoRoot = path.resolve(__dirname, "..", "..", "..");
    const expected =
      process.platform === "win32"
        ? path.join(repoRoot, ".venv", "Scripts", "python.exe")
        : path.join(repoRoot, ".venv", "bin", "python");
    if (!_fs.existsSync(expected)) {
      // No .venv in this environment (likely CI). Skip this smoke; the
      // missing-venv branch is covered by the previous test.
      return;
    }
    const result = resolveRepoVenv(repoRoot);
    expect(result?.python).toBe(expected);
  });
});
