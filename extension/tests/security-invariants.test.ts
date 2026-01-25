/**
 * Security Invariants Tests
 *
 * These tests enforce security invariants by scanning code for anti-patterns.
 * If any of these tests fail, it indicates a potential security regression.
 *
 * SECURITY: These tests should NEVER be disabled or bypassed.
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

describe("Security Invariants", () => {
  const extensionRoot = path.join(__dirname, "..", "..");

  /**
   * Recursively find files matching a pattern.
   */
  function findFiles(dir: string, pattern: RegExp): string[] {
    const results: string[] = [];

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        // Skip node_modules and build directories
        if (
          entry.name === "node_modules" ||
          entry.name === "dist" ||
          entry.name === "tmp"
        ) {
          continue;
        }

        if (entry.isDirectory()) {
          results.push(...findFiles(fullPath, pattern));
        } else if (pattern.test(entry.name)) {
          results.push(fullPath);
        }
      }
    } catch {
      // Ignore permission errors
    }

    return results;
  }

  /**
   * Check if a file contains a pattern.
   */
  function fileContainsPattern(filePath: string, pattern: RegExp): boolean {
    const content = fs.readFileSync(filePath, "utf-8");
    return pattern.test(content);
  }

  test("No shell: true in extension source code", () => {
    // SECURITY: shell: true enables command injection attacks
    const files = findFiles(
      path.join(extensionRoot, "extension"),
      /\.(ts|js)$/,
    );

    const violations: string[] = [];

    for (const file of files) {
      // Skip test files for this check (tests may document the anti-pattern)
      if (file.includes(".test.")) continue;

      const content = fs.readFileSync(file, "utf-8");

      // Check for explicit shell: true
      if (/shell:\s*true/.test(content)) {
        violations.push(`${file}: contains shell: true`);
      }

      // Check for process.platform shell pattern (the old vulnerable pattern)
      if (/shell:\s*process\.platform/.test(content)) {
        violations.push(`${file}: contains shell: process.platform pattern`);
      }
    }

    expect(violations).toEqual([]);
  });

  test("No innerHTML with template literals containing variables in UI source", () => {
    // SECURITY: innerHTML with untrusted data enables XSS attacks
    // This test enforces that all innerHTML with template literals either:
    // 1. Use escapeHtml() or safeHtml() for interpolated values
    // 2. Only interpolate known-safe values (numeric, constants)

    const uiFiles = findFiles(
      path.join(extensionRoot, "extension", "ui"),
      /\.ts$/,
    );

    const violations: string[] = [];

    // Known-safe variable patterns that don't need escaping
    const safePatterns = [
      /^(count|pct|duration|width|height|\d+)$/, // Numeric values
      /^Math\./, // Math expressions
      /^icons\[/, // Icon lookups
      /^(arrow|sign|prefix|cssClass)$/, // UI constants
      /^(chartWidth|chartHeight|padding)/, // Layout values
      /\.toFixed\(/, // Number formatting (any var.toFixed())
      /^p\.(x|y)/, // Coordinate values
      /^barsHtml$/, // Already-rendered HTML from escapeHtml
      /^html$/, // Already-assembled HTML
      /^legendHtml$/, // Already-rendered legend
      /^svgContent$/, // Already-rendered SVG
      /^chips\.join/, // Array join of safe chips
      /^SEVERITY_ICONS\[/, // Static icon map
      /^formatDuration\(/, // Duration formatting helper
    ];

    for (const file of uiFiles) {
      // Skip test files
      if (file.includes(".test.")) continue;

      const content = fs.readFileSync(file, "utf-8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Check for innerHTML with template literals
        if (/\.innerHTML\s*\+?=\s*`/.test(line) && /\$\{[^}]+\}/.test(line)) {
          // Extract all interpolations
          const templateMatch = line.match(/\$\{([^}]+)\}/g);
          if (templateMatch) {
            for (const match of templateMatch) {
              const varName = match.slice(2, -1).trim();

              // Skip if using escapeHtml or safeHtml
              if (
                varName.includes("escapeHtml") ||
                varName.includes("safeHtml")
              ) {
                continue;
              }

              // Skip string literals
              if (/^["']/.test(varName)) continue;

              // Check against safe patterns
              const isSafe = safePatterns.some((pattern) =>
                pattern.test(varName),
              );
              if (isSafe) continue;

              // This is a potential violation
              violations.push(
                `${file}:${i + 1}: innerHTML with ${varName} - must use escapeHtml() or safeHtml()`,
              );
            }
          }
        }
      }
    }

    // ENFORCEMENT: Test must fail if violations found
    if (violations.length > 0) {
      console.error("SECURITY VIOLATIONS - innerHTML without escaping:");
      violations.forEach((v) => console.error(`  ${v}`));
    }
    expect(violations).toEqual([]);
  });

  test("Python executable allowlist is enforced", () => {
    // SECURITY: Only allowed python executables should be used
    const safeProcessPath = path.join(
      extensionRoot,
      "extension",
      "tasks",
      "_shared",
      "safe-process.ts",
    );

    expect(fs.existsSync(safeProcessPath)).toBe(true);

    const content = fs.readFileSync(safeProcessPath, "utf-8");
    expect(content).toContain("PYTHON_ALLOWLIST");
    expect(content).toContain("shell: false");
  });

  test("Path traversal protection utility exists", () => {
    // SECURITY: Path traversal protection must be available
    const safePathPath = path.join(
      extensionRoot,
      "extension",
      "tasks",
      "_shared",
      "safe-path.ts",
    );

    expect(fs.existsSync(safePathPath)).toBe(true);

    const content = fs.readFileSync(safePathPath, "utf-8");
    expect(content).toContain("resolveInside");
    expect(content).toContain("Path traversal");
  });

  test("Safe rendering utilities exist", () => {
    // SECURITY: Safe DOM rendering utilities must exist
    const renderPath = path.join(
      extensionRoot,
      "extension",
      "ui",
      "modules",
      "shared",
      "render.ts",
    );

    expect(fs.existsSync(renderPath)).toBe(true);

    const content = fs.readFileSync(renderPath, "utf-8");
    expect(content).toContain("clearElement");
    expect(content).toContain("renderTrustedHtml");
    expect(content).toContain("renderNoData");
    expect(content).toContain("createElement");
    // Verify security documentation
    expect(content).toContain("SECURITY");
  });

  test("No outerHTML usage in UI source", () => {
    // SECURITY: outerHTML can also enable XSS attacks
    const uiFiles = findFiles(
      path.join(extensionRoot, "extension", "ui"),
      /\.ts$/,
    );

    const violations: string[] = [];

    for (const file of uiFiles) {
      if (file.includes(".test.")) continue;

      const content = fs.readFileSync(file, "utf-8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/\.outerHTML\s*=/.test(line)) {
          violations.push(
            `${file}:${i + 1}: outerHTML assignment is forbidden`,
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });

  test("No document.write usage in UI source", () => {
    // SECURITY: document.write enables XSS and is deprecated
    const uiFiles = findFiles(
      path.join(extensionRoot, "extension", "ui"),
      /\.ts$/,
    );

    const violations: string[] = [];

    for (const file of uiFiles) {
      if (file.includes(".test.")) continue;

      const content = fs.readFileSync(file, "utf-8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/document\.write(ln)?\s*\(/.test(line)) {
          violations.push(`${file}:${i + 1}: document.write is forbidden`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
