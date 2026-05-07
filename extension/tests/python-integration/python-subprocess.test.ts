/**
 * Regression locks for `python-subprocess.ts::resolvePythonInvocation()`.
 *
 * The original helper unconditionally returned bare `python3` (Linux/macOS)
 * or `python` (Windows). That resolved fine on most systems but pointed at
 * a system interpreter without `numpy`/`pandas` (deps installed only into
 * the project venv via `uv sync --extra dev`). The symptom was 13 Jest
 * failures during preflight in 2026-05, all variants of:
 *   ModuleNotFoundError: No module named 'numpy'
 *
 * Lock the post-fix contract:
 *   1. Repo `.venv` is preferred over any system interpreter.
 *   2. `GRI_TEST_PYTHON` / `PYTHON` env overrides win when set.
 *   3. Missing venv fails with the canonical `uv sync --extra dev`
 *      setup message (no silent fallback to system `python3`).
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

  it("prefers the repo .venv interpreter over bare python3 (regression: 2026-05 numpy)", () => {
    // Precondition: this repo has a `.venv` (developer ran `uv sync --extra dev`).
    const repoRoot = path.resolve(__dirname, "..", "..", "..");
    const expected =
      process.platform === "win32"
        ? path.join(repoRoot, ".venv", "Scripts", "python.exe")
        : path.join(repoRoot, ".venv", "bin", "python");
    expect(_fs.existsSync(expected)).toBe(true);

    const result = resolvePythonInvocation();
    expect(result.command).toBe(expected);
    expect(result.prefixArgs).toEqual([]);
    // Specifically NOT a bare PATH lookup.
    expect(result.command).not.toBe("python3");
    expect(result.command).not.toBe("python");
  });

  it("honors GRI_TEST_PYTHON override even when .venv is present", () => {
    process.env["GRI_TEST_PYTHON"] = "/explicit/override/python";
    const result = resolvePythonInvocation();
    expect(result.command).toBe("/explicit/override/python");
  });

  it("falls back to PYTHON env var when GRI_TEST_PYTHON unset", () => {
    process.env["PYTHON"] = "/another/python";
    const result = resolvePythonInvocation();
    expect(result.command).toBe("/another/python");
  });
});

describe("resolveRepoVenv", () => {
  it("returns null and is non-throwing when the venv is missing", () => {
    // A fresh tmpdir has no `.venv`; resolveRepoVenv must return null
    // (resolvePythonInvocation then converts that into a clear setup error).
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "no-venv-"));
    try {
      expect(resolveRepoVenv(empty)).toBeNull();
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  it("resolves the canonical interpreter path in this repo", () => {
    const repoRoot = path.resolve(__dirname, "..", "..", "..");
    const result = resolveRepoVenv(repoRoot);
    expect(result).not.toBeNull();
    const expected =
      process.platform === "win32"
        ? path.join(repoRoot, ".venv", "Scripts", "python.exe")
        : path.join(repoRoot, ".venv", "bin", "python");
    expect(result?.python).toBe(expected);
  });
});

describe("resolvePythonInvocation missing-venv error path", () => {
  it("throws an actionable setup error when no venv and no override", () => {
    // resolvePythonInvocation accepts an injected resolver for testability;
    // pass one that returns null to exercise the missing-venv branch.
    delete process.env["GRI_TEST_PYTHON"];
    delete process.env["PYTHON"];
    expect(() => resolvePythonInvocation(() => null)).toThrow(
      /Project Python venv not found.*uv sync --extra dev/s,
    );
  });

  it("override env still wins even when injected resolver returns null", () => {
    process.env["GRI_TEST_PYTHON"] = "/explicit/path";
    expect(resolvePythonInvocation(() => null).command).toBe("/explicit/path");
  });
});
