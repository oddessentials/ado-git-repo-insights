#!/usr/bin/env node
/**
 * check-test-config-parity.mjs
 *
 * Compares resolved compilerOptions between tsconfig.json (production)
 * and each test tsconfig using the TypeScript compiler API in-process.
 *
 * No child processes are spawned — configs are loaded and resolved
 * entirely within this Node process using ts.readConfigFile and
 * ts.parseJsonConfigFileContent.  This avoids execSync/execFileSync
 * and the shell/EPERM failures they cause on restricted Windows
 * environments.
 *
 * Fails if any non-allowlisted key differs, ensuring test strictness
 * stays in parity with production. Forward-looking: new TypeScript
 * flags added in future versions are automatically covered because
 * only allowlisted deviations are permitted.
 *
 * Configs checked (all required — missing configs fail the check):
 *   tsconfig.test.json       — main test suite (Jest / ts-jest)
 *   tsconfig.type-tests.json — compile-time type-assertion tests
 *
 * Satisfies: FR-001, FR-002, SC-004 (spec 042-test-strict-alignment)
 *            Issue #210 (tsconfig.type-tests.json parity)
 */

import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");

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

// Each entry is a REQUIRED config — missing files fail the check.
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

function getResolvedOptions(tsconfigPath) {
  const { config, error } = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (error) {
    const message = ts.flattenDiagnosticMessageText(error.messageText, "\n");
    throw new Error(`Failed to read ${tsconfigPath}: ${message}`);
  }
  const parsed = ts.parseJsonConfigFileContent(
    config,
    ts.sys,
    dirname(tsconfigPath),
  );
  if (parsed.errors.length > 0) {
    const messages = parsed.errors
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"))
      .join("\n  ");
    throw new Error(`Failed to parse ${tsconfigPath}:\n  ${messages}`);
  }
  return parsed.options;
}

function compareConfig(prodOpts, configEntry) {
  const configPath = resolve(extensionRoot, configEntry.file);

  if (!existsSync(configPath)) {
    console.error(
      `✗ ${configEntry.file} (${configEntry.label}) MISSING: expected at ${configPath}`,
    );
    console.error(
      `  Every file in CONFIGS is required. A missing test tsconfig is a repo misconfiguration.`,
    );
    return { missing: true, label: configEntry.label, file: configEntry.file };
  }

  const testOpts = getResolvedOptions(configPath);

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
    missing: false,
    label: configEntry.label,
    file: configEntry.file,
    allowlist: [...allowlist],
    violations,
  };
}

function run() {
  const prodConfigPath = resolve(extensionRoot, "tsconfig.json");
  if (!existsSync(prodConfigPath)) {
    console.error(`✗ Production tsconfig not found at ${prodConfigPath}`);
    process.exit(1);
  }

  const prodOpts = getResolvedOptions(prodConfigPath);

  let failures = 0;
  const results = [];

  for (const entry of CONFIGS) {
    const result = compareConfig(prodOpts, entry);
    results.push(result);
    if (result.missing) {
      failures++;
    } else {
      failures += result.violations.length;
    }
  }

  // Report results
  for (const result of results) {
    if (result.missing) {
      // Error already printed in compareConfig
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

  process.exit(failures > 0 ? 1 : 0);
}

run();
