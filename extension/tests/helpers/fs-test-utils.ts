import * as fs from "fs";

/**
 * Centralized test-only filesystem helpers.
 * These wrappers keep repo-local test file access explicit and reviewed.
 */
export function pathExists(filePath: string): boolean {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- SECURITY: test helper centralizes repo-local file existence checks
  return fs.existsSync(filePath);
}

export function ensureDir(filePath: string): void {
  if (!pathExists(filePath)) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- SECURITY: test helper centralizes repo-local directory creation
    fs.mkdirSync(filePath, { recursive: true });
  }
}

export function readTextFile(filePath: string): string {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- SECURITY: test helper centralizes repo-local file reads
  return fs.readFileSync(filePath, "utf-8");
}

export function readBufferFile(filePath: string): Buffer {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- SECURITY: test helper centralizes repo-local binary file reads
  return fs.readFileSync(filePath);
}

export function readDir(filePath: string): string[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- SECURITY: test helper centralizes repo-local directory listing
  return fs.readdirSync(filePath);
}

export function readDirEntries(filePath: string): fs.Dirent[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- SECURITY: test helper centralizes repo-local directory listing with metadata
  return fs.readdirSync(filePath, { withFileTypes: true });
}

export function removeDir(filePath: string): void {
  fs.rmSync(filePath, { recursive: true, force: true });
}

export function writeTextFile(filePath: string, content: string): void {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- SECURITY: test helper writes only test-managed files
  fs.writeFileSync(filePath, content);
}

export function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readTextFile(filePath)) as T;
}

export function makeTempDir(prefix: string): string {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- SECURITY: test helper creates temp dirs with OS-managed unique suffixes
  return fs.mkdtempSync(prefix);
}

export function removeDirSafe(filePath: string): void {
  // Best-effort cleanup: tolerant of partial existence, non-throwing on missing dir
  try {
    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath, { recursive: true, force: true });
    }
  } catch {
    // Swallow: cleanup is best-effort, not a test-failure source
  }
}
