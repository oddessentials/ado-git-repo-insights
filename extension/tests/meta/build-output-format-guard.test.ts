/**
 * Guards the tsconfig.build.json module setting.
 *
 * The extension uses split tsconfigs: tsconfig.json (typecheck, ES2022 +
 * bundler) and tsconfig.build.json (emit, CommonJS + bundler).  If the
 * CommonJS override is removed, build:tsc silently emits ESM to dist/,
 * breaking Node-executed scripts at runtime (__dirname undefined,
 * require() unavailable).
 *
 * @module tests/meta/build-output-format-guard.test
 */

import * as path from "path";
import * as ts from "typescript";
import { describe, it, expect } from "@jest/globals";

const extensionRoot = path.resolve(__dirname, "..", "..");

function resolveConfig(configFile: string): ts.CompilerOptions {
  const configPath = path.resolve(extensionRoot, configFile);
  const { config, error } = ts.readConfigFile(configPath, ts.sys.readFile);
  if (error) {
    const message = ts.flattenDiagnosticMessageText(error.messageText, "\n");
    throw new Error(`Failed to read ${configFile}: ${message}`);
  }
  const parsed = ts.parseJsonConfigFileContent(
    config,
    ts.sys,
    path.dirname(configPath),
  );
  return parsed.options;
}

describe("Build Output Format Guard", () => {
  const buildOpts = resolveConfig("tsconfig.build.json");
  const typecheckOpts = resolveConfig("tsconfig.json");

  it("tsconfig.build.json must resolve module to CommonJS", () => {
    expect(buildOpts.module).toBe(ts.ModuleKind.CommonJS);
  });

  it("tsconfig.json uses a different module (proves guard is meaningful)", () => {
    // The typecheck config uses ES2022 — NOT CommonJS.
    // This test proves the guard above isn't vacuously true.
    // If both configs resolved to CommonJS, the guard would never
    // catch a regression where someone removes the build override.
    expect(typecheckOpts.module).not.toBe(ts.ModuleKind.CommonJS);
  });
});
