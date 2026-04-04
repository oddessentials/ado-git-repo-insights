/**
 * Guards the split tsconfig architecture introduced in the TS 6.0 upgrade.
 *
 * The extension uses two configs with distinct purposes:
 *   - tsconfig.json        (typecheck): module ES2022 + bundler resolution
 *   - tsconfig.build.json  (emit):      module CommonJS + bundler resolution
 *
 * The build config MUST emit CommonJS — Node-executed scripts in dist/
 * require CJS runtime semantics (__dirname, require()).  The typecheck
 * config uses ES2022 for modern bundler-style resolution during tsc
 * --noEmit checks.  Both share moduleResolution: "bundler".
 *
 * Five assertions prevent silent drift:
 *   1-2. Typecheck config pins module + moduleResolution
 *   3-4. Build config pins module + moduleResolution
 *   5.   package.json build:tsc script references tsconfig.build.json
 *
 * If any assertion fails, the build output format contract is broken.
 *
 * @module tests/meta/build-output-format-guard.test
 */

import * as path from "path";
import * as ts from "typescript";
import { describe, it, expect } from "@jest/globals";
import { readJsonFile } from "../helpers/fs-test-utils";

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
  const typecheckOpts = resolveConfig("tsconfig.json");
  const buildOpts = resolveConfig("tsconfig.build.json");

  describe("typecheck config (tsconfig.json)", () => {
    it("module must be ES2022", () => {
      expect(typecheckOpts.module).toBe(ts.ModuleKind.ES2022);
    });

    it("moduleResolution must be Bundler", () => {
      expect(typecheckOpts.moduleResolution).toBe(
        ts.ModuleResolutionKind.Bundler,
      );
    });
  });

  describe("build config (tsconfig.build.json)", () => {
    it("module must be CommonJS", () => {
      expect(buildOpts.module).toBe(ts.ModuleKind.CommonJS);
    });

    it("moduleResolution must be Bundler", () => {
      expect(buildOpts.moduleResolution).toBe(
        ts.ModuleResolutionKind.Bundler,
      );
    });
  });

  describe("build script entry point", () => {
    it("build:tsc must reference tsconfig.build.json", () => {
      const pkgPath = path.resolve(extensionRoot, "package.json");
      const pkg = readJsonFile<{ scripts: Record<string, string> }>(pkgPath);
      expect(pkg.scripts["build:tsc"]).toContain("tsconfig.build.json");
    });
  });
});
