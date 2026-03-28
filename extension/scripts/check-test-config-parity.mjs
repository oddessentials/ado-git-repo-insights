#!/usr/bin/env node
/**
 * check-test-config-parity.mjs
 *
 * Compares resolved compilerOptions between tsconfig.json (production)
 * and tsconfig.test.json (tests) using `tsc --showConfig`.
 *
 * Fails if any non-allowlisted key differs, ensuring test strictness
 * stays in parity with production. Forward-looking: new TypeScript
 * flags added in future versions are automatically covered because
 * only allowlisted deviations are permitted.
 *
 * Satisfies: FR-001, FR-002, SC-004 (spec 042-test-strict-alignment)
 */

import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(__dirname, "..");

// Keys that may legitimately differ between production and test configs
const ALLOWLIST = new Set([
  "noEmit",
  "declaration",
  "sourceMap",
  "outDir",
  "rootDir",
]);

function getResolvedConfig(tsconfigPath) {
  const result = execSync(`npx tsc --showConfig -p "${tsconfigPath}"`, {
    cwd: extensionRoot,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  return JSON.parse(result);
}

function run() {
  const prodConfig = getResolvedConfig(
    resolve(extensionRoot, "tsconfig.json"),
  );
  const testConfig = getResolvedConfig(
    resolve(extensionRoot, "tsconfig.test.json"),
  );

  const prodOpts = prodConfig.compilerOptions || {};
  const testOpts = testConfig.compilerOptions || {};

  // Collect all keys from both configs
  const allKeys = new Set([...Object.keys(prodOpts), ...Object.keys(testOpts)]);

  const violations = [];

  for (const key of allKeys) {
    if (ALLOWLIST.has(key)) continue;

    const prodVal = JSON.stringify(prodOpts[key]);
    const testVal = JSON.stringify(testOpts[key]);

    if (prodVal !== testVal) {
      violations.push({ key, prod: prodOpts[key], test: testOpts[key] });
    }
  }

  if (violations.length === 0) {
    console.log(
      "✓ Test config parity: all non-allowlisted compilerOptions match production.",
    );
    process.exit(0);
  }

  console.error(
    "✗ Test config parity FAILED: the following compilerOptions differ from production:\n",
  );
  for (const v of violations) {
    console.error(`  ${v.key}:`);
    console.error(`    production: ${JSON.stringify(v.prod)}`);
    console.error(`    test:       ${JSON.stringify(v.test)}`);
  }
  console.error(
    `\nAllowlisted keys (permitted to differ): ${[...ALLOWLIST].join(", ")}`,
  );
  console.error(
    "Fix: remove the override from tsconfig.test.json or add the key to the allowlist with justification.",
  );
  process.exit(1);
}

run();
