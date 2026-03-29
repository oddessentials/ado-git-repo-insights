#!/usr/bin/env node
/**
 * check-test-config-parity.mjs
 *
 * Compares resolved compilerOptions between tsconfig.json (production)
 * and each test tsconfig using the TypeScript compiler API in-process.
 *
 * No child processes are spawned — configs are loaded and resolved
 * entirely within this Node process using ts.readConfigFile and
 * ts.parseJsonConfigFileContent.
 *
 * Comparison is limited to an explicit set of parity-critical flags
 * (strictness + unused-variable checks).  This avoids noisy churn
 * from internal TypeScript API shape changes across upgrades while
 * still catching every strictness deviation.  When TypeScript adds
 * new strict-family flags, add them to PARITY_FLAGS and review
 * during the TypeScript upgrade.
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

// Parity-critical flags: the explicit set of compiler options that must
// match between production and test configs.  Only these flags are
// compared — all other resolved options are ignored.
//
// When TypeScript adds a new strict-family flag, add it here.
// Review this list during TypeScript version upgrades.
const PARITY_FLAGS = [
  "strict",
  "noImplicitAny",
  "strictNullChecks",
  "strictFunctionTypes",
  "strictBindCallApply",
  "strictPropertyInitialization",
  "noImplicitThis",
  "useUnknownInCatchVariables",
  "alwaysStrict",
  "strictBuiltinIteratorReturn",
  "noUncheckedIndexedAccess",
  "noUnusedLocals",
  "noUnusedParameters",
];

// Each entry is a REQUIRED config — missing files fail the check.
// allowedDeviations: flags from PARITY_FLAGS that may differ for this config.
const CONFIGS = [
  {
    file: "tsconfig.test.json",
    label: "test suite",
    allowedDeviations: [],
  },
  {
    file: "tsconfig.type-tests.json",
    label: "type-test suite",
    // Type-test files declare variables and parameters solely for compile-time
    // type assertions (e.g., `const _x: number = entry.field; void _x;`).
    // These are never executed at runtime. Relaxing unused-variable checks
    // is ergonomic, not a strictness deviation.
    allowedDeviations: ["noUnusedLocals", "noUnusedParameters"],
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

function validateRequiredFlags(opts, configLabel) {
  // strict must always be resolvable — it is the master switch.
  // If it cannot be read, the TypeScript API has changed shape.
  if (opts.strict === undefined) {
    throw new Error(
      `Cannot read 'strict' from resolved options of ${configLabel}. ` +
        `The TypeScript compiler API may have changed. ` +
        `Review the TypeScript upgrade and update this script.`,
    );
  }
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
  validateRequiredFlags(testOpts, configEntry.file);

  const allowed = new Set(configEntry.allowedDeviations);

  const violations = [];
  for (const flag of PARITY_FLAGS) {
    if (allowed.has(flag)) continue;

    const prodVal = prodOpts[flag];
    const testVal = testOpts[flag];

    if (prodVal !== testVal) {
      violations.push({ flag, prod: prodVal, test: testVal });
    }
  }

  return {
    missing: false,
    label: configEntry.label,
    file: configEntry.file,
    allowed: [...allowed],
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
  validateRequiredFlags(prodOpts, "tsconfig.json");

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
      continue;
    }

    if (result.violations.length === 0) {
      console.log(
        `✓ ${result.file} (${result.label}): all parity-critical flags match production.`,
      );
    } else {
      console.error(
        `\n✗ ${result.file} (${result.label}) FAILED: the following parity-critical flags differ from production:\n`,
      );
      for (const v of result.violations) {
        console.error(`  ${v.flag}:`);
        console.error(`    production: ${JSON.stringify(v.prod)}`);
        console.error(`    test:       ${JSON.stringify(v.test)}`);
      }
      if (result.allowed.length > 0) {
        console.error(
          `\n  Allowed deviations for this config: ${result.allowed.join(", ")}`,
        );
      }
      console.error(
        `  Fix: remove the override from ${result.file} or add the flag to allowedDeviations with justification.`,
      );
    }
  }

  process.exit(failures > 0 ? 1 : 0);
}

run();
