/**
 * Validates that the TypeScript API resolves expected strict options
 * from both test configs.  If a TypeScript upgrade changes the API
 * shape or the resolution behavior, this test fails before the
 * parity checker silently misbehaves.
 *
 * This is a guardrail for check-test-config-parity.mjs, which uses
 * ts.readConfigFile + ts.parseJsonConfigFileContent in-process rather
 * than spawning tsc --showConfig.
 *
 * @module tests/meta/config-parity-resolution.test
 */

import * as path from "path";
import * as ts from "typescript";
import { describe, it, expect } from "@jest/globals";

const extensionRoot = path.resolve(__dirname, "..", "..");

function resolveConfig(configFile: string): Record<string, unknown> {
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
  return parsed.options as Record<string, unknown>;
}

describe("TypeScript config parity resolution", () => {
  const prodOpts = resolveConfig("tsconfig.json");
  const testOpts = resolveConfig("tsconfig.test.json");
  const typeTestOpts = resolveConfig("tsconfig.type-tests.json");

  describe("skipLibCheck must be disabled across all configs", () => {
    it("production config does not set skipLibCheck", () => {
      expect(prodOpts.skipLibCheck).toBeFalsy();
    });

    it("test config does not set skipLibCheck", () => {
      expect(testOpts.skipLibCheck).toBeFalsy();
    });

    it("type-test config does not set skipLibCheck", () => {
      expect(typeTestOpts.skipLibCheck).toBeFalsy();
    });
  });

  describe("production config baseline", () => {
    it("resolves strict as true", () => {
      expect(prodOpts.strict).toBe(true);
    });

    it("resolves noImplicitAny as true", () => {
      expect(prodOpts.noImplicitAny).toBe(true);
    });

    it("resolves strictNullChecks as true", () => {
      expect(prodOpts.strictNullChecks).toBe(true);
    });

    it("resolves noUncheckedIndexedAccess as true", () => {
      expect(prodOpts.noUncheckedIndexedAccess).toBe(true);
    });

    it("resolves noUnusedLocals as true", () => {
      expect(prodOpts.noUnusedLocals).toBe(true);
    });

    it("resolves noUnusedParameters as true", () => {
      expect(prodOpts.noUnusedParameters).toBe(true);
    });
  });

  describe("tsconfig.test.json inherits full production strictness", () => {
    it("strict matches production", () => {
      expect(testOpts.strict).toBe(prodOpts.strict);
    });

    it("noImplicitAny matches production", () => {
      expect(testOpts.noImplicitAny).toBe(prodOpts.noImplicitAny);
    });

    it("strictNullChecks matches production", () => {
      expect(testOpts.strictNullChecks).toBe(prodOpts.strictNullChecks);
    });

    it("noUncheckedIndexedAccess matches production", () => {
      expect(testOpts.noUncheckedIndexedAccess).toBe(
        prodOpts.noUncheckedIndexedAccess,
      );
    });

    it("noUnusedLocals matches production", () => {
      expect(testOpts.noUnusedLocals).toBe(prodOpts.noUnusedLocals);
    });

    it("noUnusedParameters matches production", () => {
      expect(testOpts.noUnusedParameters).toBe(prodOpts.noUnusedParameters);
    });
  });

  describe("tsconfig.type-tests.json strictness parity", () => {
    it("strict matches production", () => {
      expect(typeTestOpts.strict).toBe(prodOpts.strict);
    });

    it("noImplicitAny matches production", () => {
      expect(typeTestOpts.noImplicitAny).toBe(prodOpts.noImplicitAny);
    });

    it("strictNullChecks matches production", () => {
      expect(typeTestOpts.strictNullChecks).toBe(prodOpts.strictNullChecks);
    });

    it("noUncheckedIndexedAccess matches production", () => {
      expect(typeTestOpts.noUncheckedIndexedAccess).toBe(
        prodOpts.noUncheckedIndexedAccess,
      );
    });

    it("noUnusedLocals is allowed to differ (type-test ergonomics)", () => {
      expect(typeTestOpts.noUnusedLocals).toBe(false);
    });

    it("noUnusedParameters is allowed to differ (type-test ergonomics)", () => {
      expect(typeTestOpts.noUnusedParameters).toBe(false);
    });
  });
});
