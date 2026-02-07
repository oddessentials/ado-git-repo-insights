/**
 * Manifest Contract Tests: Feature Flags
 *
 * Validates feature flag contributions in vss-extension.json against
 * the naming, scoping, and constraint rules defined in:
 * - specs/026-discovery-refactor-ff-prefix/spec.md (FR-008 through FR-014)
 * - specs/026-discovery-refactor-ff-prefix/contracts/vss-extension-feature-flags.json
 *
 * These tests read the manifest at build time to enforce structural invariants.
 */

import * as fs from "fs";
import * as path from "path";

interface Contribution {
  id: string;
  type: string;
  description?: string;
  targets?: string[];
  constraints?: Array<{
    name: string;
    properties: Record<string, unknown>;
  }>;
  properties: Record<string, unknown>;
}

interface Manifest {
  publisher: string;
  id: string;
  contributions: Contribution[];
}

const manifestPath = path.join(__dirname, "../../vss-extension.json");
const manifest: Manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const contributions = manifest.contributions;

// Extract feature flag contributions
const featureFlags = contributions.filter(
  (c) => c.type === "ms.vss-web.feature",
);

// Extract hub contributions
const hubs = contributions.filter((c) => c.type === "ms.vss-web.hub");

// Fully qualified feature ID prefix
const fqPrefix = `${manifest.publisher}.${manifest.id}.`;

describe("Manifest Contract: Feature Flags", () => {
  // ---------------------------------------------------------------------------
  // (1) FR-008, FR-009: All feature flags have [GRI] display name prefix
  // ---------------------------------------------------------------------------
  it("all feature flag display names start with [GRI] prefix", () => {
    expect(featureFlags.length).toBeGreaterThan(0);

    for (const flag of featureFlags) {
      const displayName = flag.properties.name as string;
      expect(displayName).toBeDefined();
      expect(displayName.startsWith("[GRI] ")).toBe(true);
    }
  });

  // ---------------------------------------------------------------------------
  // (1b) All feature flags target ms.vss-web.managed-features
  // ---------------------------------------------------------------------------
  it("all feature flags target ms.vss-web.managed-features", () => {
    for (const flag of featureFlags) {
      expect(flag.targets).toBeDefined();
      expect(flag.targets).toContain("ms.vss-web.managed-features");
    }
  });

  // ---------------------------------------------------------------------------
  // (2) FR-010: All feature flag IDs start with gri.
  // ---------------------------------------------------------------------------
  it("all feature flag IDs start with gri. prefix", () => {
    for (const flag of featureFlags) {
      expect(flag.id.startsWith("gri.")).toBe(true);
    }
  });

  // ---------------------------------------------------------------------------
  // (3) pr-insights-hub has a constraint referencing the feature flag
  //     with correct fully-qualified featureId
  // ---------------------------------------------------------------------------
  it("pr-insights-hub has Feature constraint with correct featureId", () => {
    const hub = contributions.find((c) => c.id === "pr-insights-hub");
    expect(hub).toBeDefined();
    expect(hub!.constraints).toBeDefined();
    expect(hub!.constraints!.length).toBeGreaterThan(0);

    const featureConstraint = hub!.constraints!.find(
      (c) => c.name === "Feature",
    );
    expect(featureConstraint).toBeDefined();

    const featureId = featureConstraint!.properties.featureId as string;
    expect(featureId).toBe(
      "OddEssentials.ado-git-repo-insights.gri.dashboard-hub",
    );

    // Verify the featureId starts with the expected publisher.extension prefix
    expect(featureId.startsWith(fqPrefix)).toBe(true);

    // Verify the referenced feature flag actually exists in the manifest
    const referencedFlagId = featureId.replace(fqPrefix, "");
    const flagExists = featureFlags.some((f) => f.id === referencedFlagId);
    expect(flagExists).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // (4) FR-013: pr-insights-settings has NO feature flag constraint
  // ---------------------------------------------------------------------------
  it("pr-insights-settings has no feature flag constraint", () => {
    const settings = contributions.find(
      (c) => c.id === "pr-insights-settings",
    );
    expect(settings).toBeDefined();
    expect(settings!.constraints).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // (5) FR-013: Pipeline task contribution has NO feature flag constraint
  // ---------------------------------------------------------------------------
  it("extract-prs-task has no feature flag constraint", () => {
    const task = contributions.find((c) => c.id === "extract-prs-task");
    expect(task).toBeDefined();
    expect(task!.constraints).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // (6) FR-012: gri.dashboard-hub has defaultState false
  // ---------------------------------------------------------------------------
  it("gri.dashboard-hub defaults to disabled (opt-in)", () => {
    const flag = featureFlags.find((f) => f.id === "gri.dashboard-hub");
    expect(flag).toBeDefined();
    expect(flag!.properties.defaultState).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // (7) FR-014: hostScopes includes both "project" and null (org + project)
  // ---------------------------------------------------------------------------
  it("gri.dashboard-hub hostScopes includes project and null", () => {
    const flag = featureFlags.find((f) => f.id === "gri.dashboard-hub");
    expect(flag).toBeDefined();

    const hostScopes = flag!.properties.hostScopes as Array<string | null>;
    expect(hostScopes).toBeDefined();
    expect(hostScopes).toContain("project");
    expect(hostScopes).toContain(null);
  });
});

describe("Manifest Contract: Naming Rule Validation", () => {
  // ---------------------------------------------------------------------------
  // FR-009: Prohibited prefix check
  // ---------------------------------------------------------------------------
  const prohibitedPrefixes = [
    "PR Insights:",
    "GRI:",
    "GRI -",
    "Git Repo Insights:",
  ];

  it("no feature flag display name uses prohibited prefixes", () => {
    for (const flag of featureFlags) {
      const displayName = flag.properties.name as string;
      for (const prefix of prohibitedPrefixes) {
        expect(displayName.startsWith(prefix)).toBe(false);
      }
    }
  });

  // ---------------------------------------------------------------------------
  // Structural: feature flag has required properties
  // ---------------------------------------------------------------------------
  it("all feature flags have hostConfigurable and userConfigurable set", () => {
    for (const flag of featureFlags) {
      expect(typeof flag.properties.hostConfigurable).toBe("boolean");
      expect(typeof flag.properties.userConfigurable).toBe("boolean");
    }
  });

  // ---------------------------------------------------------------------------
  // Structural: no hub other than pr-insights-hub has feature flag constraints
  // (Ensures future hubs added without constraints don't accidentally get gated)
  // ---------------------------------------------------------------------------
  it("only pr-insights-hub has feature flag constraints among hubs", () => {
    for (const hub of hubs) {
      if (hub.id === "pr-insights-hub") {
        expect(hub.constraints).toBeDefined();
      } else {
        const hasFeatureConstraint = hub.constraints?.some(
          (c) => c.name === "Feature",
        );
        expect(hasFeatureConstraint ?? false).toBe(false);
      }
    }
  });
});
