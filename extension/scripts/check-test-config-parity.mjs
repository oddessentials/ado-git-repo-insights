#!/usr/bin/env node
/**
 * check-test-config-parity.mjs
 *
 * Compares resolved compilerOptions between tsconfig.json (production)
 * and each test tsconfig using `tsc --showConfig`.
 *
 * Fails if any non-allowlisted key differs, ensuring test strictness
 * stays in parity with production. Forward-looking: new TypeScript
 * flags added in future versions are automatically covered because
 * only allowlisted deviations are permitted.
 *
 * Configs checked:
 *   tsconfig.test.json       — main test suite (Jest / ts-jest)
 *   tsconfig.type-tests.json — compile-time type-assertion tests
 *
 * Satisfies: FR-001, FR-002, SC-004 (spec 042-test-strict-alignment)
 *            Issue #210 (tsconfig.type-tests.json parity)
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(__dirname, "..");

// Keys that may legitimately differ in ANY test config (output-related)
const BASE_ALLOWLIST = [
  "noEmit",
  "declaration",
  "sourceMap",
  "outDir",
  "rootDir",
];

// Each entry: [configFile, extraAllowedKeys[], reason]
const CONFIGS = [
  {
    file: "tsconfig.test.json",
    label: "test suite",
    extraAllowlist: [],
  },
  {
    file: "tsconfig.type-tests.json",
    label: "type-test suite",
    // Type-test files declare variables and parameters solely for compile-time
    // type assertions (e.g., `const _x: number = entry.field; void _x;`).
    // These are never executed at runtime. Relaxing unused-variable checks
    // is ergonomic, not a strictness deviation.
    extraAllowlist: ["noUnusedLocals", "noUnusedParameters"],
  },
];

function getResolvedConfig(tsconfigPath) {
  const result = execSync(`npx tsc --showConfig -p "${tsconfigPath}"`, {
    cwd: extensionRoot,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  return JSON.parse(result);
}

function compareConfig(prodOpts, configEntry) {
  const configPath = resolve(extensionRoot, configEntry.file);

  if (!existsSync(configPath)) {
    return { skipped: true, label: configEntry.label, file: configEntry.file };
  }

  const testConfig = getResolvedConfig(configPath);
  const testOpts = testConfig.compilerOptions || {};

  const allowlist = new Set([...BASE_ALLOWLIST, ...configEntry.extraAllowlist]);
  const allKeys = new Set([
    ...Object.keys(prodOpts),
    ...Object.keys(testOpts),
  ]);

  const violations = [];
  for (const key of allKeys) {
    if (allowlist.has(key)) continue;

    const prodVal = JSON.stringify(prodOpts[key]);
    const testVal = JSON.stringify(testOpts[key]);

    if (prodVal !== testVal) {
      violations.push({ key, prod: prodOpts[key], test: testOpts[key] });
    }
  }

  return {
    skipped: false,
    label: configEntry.label,
    file: configEntry.file,
    allowlist: [...allowlist],
    violations,
  };
}

function run() {
  const prodConfig = getResolvedConfig(
    resolve(extensionRoot, "tsconfig.json"),
  );
  const prodOpts = prodConfig.compilerOptions || {};

  let totalViolations = 0;
  const results = [];

  for (const entry of CONFIGS) {
    const result = compareConfig(prodOpts, entry);
    results.push(result);
    if (!result.skipped) {
      totalViolations += result.violations.length;
    }
  }

  // Report results
  for (const result of results) {
    if (result.skipped) {
      console.log(`⊘ ${result.file} (${result.label}): not found, skipped.`);
      continue;
    }

    if (result.violations.length === 0) {
      console.log(
        `✓ ${result.file} (${result.label}): all non-allowlisted compilerOptions match production.`,
      );
    } else {
      console.error(
        `\n✗ ${result.file} (${result.label}) FAILED: the following compilerOptions differ from production:\n`,
      );
      for (const v of result.violations) {
        console.error(`  ${v.key}:`);
        console.error(`    production: ${JSON.stringify(v.prod)}`);
        console.error(`    test:       ${JSON.stringify(v.test)}`);
      }
      console.error(
        `\n  Allowlisted keys: ${result.allowlist.join(", ")}`,
      );
      console.error(
        `  Fix: remove the override from ${result.file} or add the key to the allowlist with justification.`,
      );
    }
  }

  if (totalViolations > 0) {
    process.exit(1);
  }

  process.exit(0);
}

run();
