/**
 * Dev manifest parity guard.
 *
 * Ensures vss-extension-dev.json stays structurally in sync with
 * vss-extension.json. The dev manifest is a standalone copy with a
 * different publisher, extension ID, name, and featureId — but
 * scopes, contributions, files, and targets must match production.
 *
 * If you add a contribution or change scopes in vss-extension.json,
 * this test will fail until vss-extension-dev.json is updated to match.
 */

import * as path from "path";
import * as _fsOriginal from "fs";
function _loadFs(): typeof _fsOriginal {
  return _fsOriginal;
}
const _fs = _loadFs();

interface Contribution {
  id: string;
  type: string;
  targets: string[];
  constraints?: Array<{
    name: string;
    properties?: Record<string, string>;
  }>;
  properties?: Record<string, unknown>;
}

interface Manifest {
  manifestVersion: number;
  id: string;
  name: string;
  version: string;
  publisher: string;
  targets: Array<{ id: string }>;
  scopes: string[];
  galleryFlags: string[];
  files: Array<{ path: string; addressable?: boolean }>;
  contributions: Contribution[];
}

const EXT_DIR = path.join(__dirname, "..");

function loadManifest(filename: string): Manifest {
  const raw = _fs.readFileSync(path.join(EXT_DIR, filename), "utf8");
  return JSON.parse(raw) as Manifest;
}

describe("Dev manifest parity", () => {
  let prod: Manifest;
  let dev: Manifest;

  beforeAll(() => {
    prod = loadManifest("vss-extension.json");
    dev = loadManifest("vss-extension-dev.json");
  });

  describe("fields that must differ", () => {
    it("publisher is OddEssentials-Dev (not production)", () => {
      expect(dev.publisher).toBe("OddEssentials-Dev");
      expect(dev.publisher).not.toBe(prod.publisher);
    });

    it("extension ID includes -dev suffix", () => {
      expect(dev.id).toBe("ado-git-repo-insights-staging");
      expect(dev.id).not.toBe(prod.id);
    });

    it("name includes (Dev) suffix", () => {
      expect(dev.name).toContain("(Dev)");
      expect(dev.name).not.toBe(prod.name);
    });

    it("galleryFlags does not include Public", () => {
      expect(dev.galleryFlags).not.toContain("Public");
    });
  });

  describe("fields that must match", () => {
    it("scopes are identical", () => {
      expect(dev.scopes).toEqual(prod.scopes);
    });

    it("targets are identical", () => {
      expect(dev.targets).toEqual(prod.targets);
    });

    it("files are identical", () => {
      expect(dev.files).toEqual(prod.files);
    });

    it("same number of contributions", () => {
      expect(dev.contributions).toHaveLength(prod.contributions.length);
    });

    it("contribution IDs match", () => {
      const prodIds = prod.contributions.map((c) => c.id);
      const devIds = dev.contributions.map((c) => c.id);
      expect(devIds).toEqual(prodIds);
    });

    it("contribution types match", () => {
      const prodTypes = prod.contributions.map((c) => c.type);
      const devTypes = dev.contributions.map((c) => c.type);
      expect(devTypes).toEqual(prodTypes);
    });

    it("contribution targets match", () => {
      const prodTargets = prod.contributions.map((c) => c.targets);
      const devTargets = dev.contributions.map((c) => c.targets);
      expect(devTargets).toEqual(prodTargets);
    });
  });

  describe("featureId consistency", () => {
    it("production featureId uses production publisher.id", () => {
      const hub = prod.contributions.find((c) => c.id === "pr-insights-hub");
      const featureId = hub?.constraints?.at(0)?.properties?.featureId;
      expect(featureId).toBe(`${prod.publisher}.${prod.id}.gri.dashboard-hub`);
    });

    it("dev featureId uses dev publisher.id", () => {
      const hub = dev.contributions.find((c) => c.id === "pr-insights-hub");
      const featureId = hub?.constraints?.at(0)?.properties?.featureId;
      expect(featureId).toBe(`${dev.publisher}.${dev.id}.gri.dashboard-hub`);
    });
  });
});
