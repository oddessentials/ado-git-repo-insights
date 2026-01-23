/**
 * Safe Path Resolution Utilities
 *
 * Security invariant: Resolved paths must stay within the base directory.
 * Prevents path traversal attacks (e.g., ../../etc/passwd).
 */

import * as path from "path";

/**
 * Resolve a path ensuring it stays within the base directory.
 *
 * @param baseDir - Base directory that paths must stay within
 * @param parts - Path parts to join and resolve
 * @returns Resolved absolute path
 * @throws Error if the resolved path escapes baseDir
 *
 * @example
 * resolveInside('/app/data', 'user', 'file.txt') // OK: /app/data/user/file.txt
 * resolveInside('/app/data', '../secret') // THROWS: Path escapes baseDir
 */
export function resolveInside(baseDir: string, ...parts: string[]): string {
  const resolvedBase = path.resolve(baseDir);
  const resolved = path.resolve(baseDir, ...parts);

  // Check if resolved path is within base directory
  // Must start with base + separator, or be exactly the base
  const normalizedBase = resolvedBase + path.sep;

  if (!resolved.startsWith(normalizedBase) && resolved !== resolvedBase) {
    throw new Error(
      `Path traversal detected: "${parts.join("/")}" escapes base directory "${baseDir}"`,
    );
  }

  return resolved;
}

/**
 * Check if a path is safely within a base directory without throwing.
 *
 * @param baseDir - Base directory
 * @param testPath - Path to test
 * @returns true if path is within baseDir
 */
export function isPathInside(baseDir: string, testPath: string): boolean {
  try {
    resolveInside(baseDir, testPath);
    return true;
  } catch {
    return false;
  }
}
