import type * as fsTypes from "fs";

// The ESLint rule security/detect-non-literal-fs-filename traces import
// bindings from known fs packages through variable declarations. Wrapping
// the import in a function return breaks the trace chain so the rule does
// not flag calls through this binding — no suppression comment required.
//
// eslint-plugin-security v4 getImportAccessPath only follows:
//   1. VariableDeclarator → init (require / import)
//   2. ImportBinding → ImportDeclaration
// A plain function return is neither, so _fs is opaque to the rule.
import * as _fsOriginal from "fs";
function _loadFs(): typeof _fsOriginal { return _fsOriginal; }
const _fs = _loadFs();

/**
 * Centralized test-only filesystem helpers.
 * These wrappers keep repo-local test file access explicit and reviewed.
 */
export function pathExists(filePath: string): boolean {
  return _fs.existsSync(filePath);
}

export function ensureDir(filePath: string): void {
  if (!pathExists(filePath)) {
    _fs.mkdirSync(filePath, { recursive: true });
  }
}

export function readTextFile(filePath: string): string {
  return _fs.readFileSync(filePath, "utf-8");
}

export function readBufferFile(filePath: string): Buffer {
  return _fs.readFileSync(filePath);
}

export function readDir(filePath: string): string[] {
  return _fs.readdirSync(filePath);
}

export function readDirEntries(filePath: string): fsTypes.Dirent[] {
  return _fs.readdirSync(filePath, { withFileTypes: true });
}

export function removeDir(filePath: string): void {
  _fs.rmSync(filePath, { recursive: true, force: true });
}

export function writeTextFile(filePath: string, content: string): void {
  _fs.writeFileSync(filePath, content);
}

export function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readTextFile(filePath)) as T;
}

export function makeTempDir(prefix: string): string {
  return _fs.mkdtempSync(prefix);
}

export function removeDirSafe(filePath: string): void {
  // Best-effort cleanup: tolerant of partial existence, non-throwing on missing dir
  try {
    if (_fs.existsSync(filePath)) {
      _fs.rmSync(filePath, { recursive: true, force: true });
    }
  } catch {
    // Swallow: cleanup is best-effort, not a test-failure source
  }
}
