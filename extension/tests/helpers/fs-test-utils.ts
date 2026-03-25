/* eslint-disable security/detect-non-literal-fs-filename -- SECURITY: test-only fs helpers centralizing all repo-local file access */
import * as fs from "fs";

/**
 * Centralized test-only filesystem helpers.
 * These wrappers keep repo-local test file access explicit and reviewed.
 */
export function pathExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

export function ensureDir(filePath: string): void {
  if (!pathExists(filePath)) {
    fs.mkdirSync(filePath, { recursive: true });
  }
}

export function readTextFile(filePath: string): string {
  return fs.readFileSync(filePath, "utf-8");
}

export function readBufferFile(filePath: string): Buffer {
  return fs.readFileSync(filePath);
}

export function readDir(filePath: string): string[] {
  return fs.readdirSync(filePath);
}

export function readDirEntries(filePath: string): fs.Dirent[] {
  return fs.readdirSync(filePath, { withFileTypes: true });
}

export function removeDir(filePath: string): void {
  fs.rmSync(filePath, { recursive: true, force: true });
}

export function writeTextFile(filePath: string, content: string): void {
  fs.writeFileSync(filePath, content);
}

export function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readTextFile(filePath)) as T;
}

export function makeTempDir(prefix: string): string {
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
