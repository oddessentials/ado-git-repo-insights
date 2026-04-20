/**
 * Repository-mapping parity tests (feature 060, FR-005a / SC-009).
 *
 * The PR URL composition (`resolvePrUrl`) depends on the dimensions artifact
 * carrying `{repository_id -> repository_name, project_name}` for every
 * `repository_id` referenced by any rollup `prs` row. If a mapping is
 * missing, the URL falls back to the repo_id form (safe but degrades the
 * user-visible URL). These tests lock:
 *
 *   (i) A fixture rollup whose `prs` references a set of `repository_id`
 *       values: the dimensions artifact MUST include every referenced id,
 *       and each entry MUST carry a non-empty `repository_name` and
 *       `project_name`.
 *  (ii) The dimension entry shape used by `resolvePrUrl` is compatible
 *       with the authoritative `DimensionsData` type from `./types` as
 *       consumed by `dataset-loader.ts`. Ensures the shape the pr-url
 *       module documents matches the shape the loader hands the dashboard.
 */

import { resolvePrUrl } from "../../ui/modules/shared/pr-url";
import type { PrUrlRepositoryEntry } from "../../ui/modules/shared/pr-url";
import type { DimensionsData } from "../../ui/types";
import type { PrRecord } from "../../ui/schemas/rollup.schema";

// Fixture mirrors what the pipeline emits for a small tenant: three repos,
// rollup prs referencing all three.
const FIXTURE_DIMENSIONS: DimensionsData = {
  repositories: [
    {
      repository_id: "r-001",
      repository_name: "web-app",
      project_name: "Frontend",
      organization_name: "acme",
    },
    {
      repository_id: "r-002",
      repository_name: "api-server",
      project_name: "Backend",
      organization_name: "acme",
    },
    {
      repository_id: "r-003",
      repository_name: "docs",
      project_name: "Platform",
      organization_name: "acme",
    },
  ],
};

const FIXTURE_PRS: readonly PrRecord[] = [
  {
    id: 1,
    title: "a",
    author_id: "u1",
    repository_id: "r-001",
    cycle_time: 10,
  },
  {
    id: 2,
    title: "b",
    author_id: "u2",
    repository_id: "r-002",
    cycle_time: 20,
  },
  {
    id: 3,
    title: "c",
    author_id: "u1",
    repository_id: "r-003",
    cycle_time: 30,
  },
];

describe("repo-mapping parity (FR-005a / SC-009)", () => {
  it("every rollup.prs[*].repository_id is present in dimensions.repositories with a non-empty name + project", () => {
    const repos = FIXTURE_DIMENSIONS.repositories ?? [];
    const byId = new Map<string, (typeof repos)[number]>(
      repos.map((r) => [r.repository_id, r]),
    );
    const unmapped: Array<{ repoId: string }> = [];
    const incomplete: Array<{ repoId: string; field: string }> = [];
    for (const pr of FIXTURE_PRS) {
      const entry = byId.get(pr.repository_id);
      if (!entry) {
        unmapped.push({ repoId: pr.repository_id });
        continue;
      }
      if (!entry.repository_name) {
        incomplete.push({
          repoId: pr.repository_id,
          field: "repository_name",
        });
      }
      if (!entry.project_name) {
        incomplete.push({
          repoId: pr.repository_id,
          field: "project_name",
        });
      }
    }
    expect(unmapped).toEqual([]);
    expect(incomplete).toEqual([]);
  });

  it("dimensions entry shape used by resolvePrUrl is assignable from the authoritative DimensionsData repositories element", () => {
    // Structural-typing check: every field the pr-url module relies on
    // (`PrUrlRepositoryEntry`) MUST be available on the DimensionsData
    // repositories element. This prevents drift where the loader renames
    // / removes a field that the pr-url composer still references.
    const loaderEntries = FIXTURE_DIMENSIONS.repositories ?? [];
    for (const raw of loaderEntries) {
      // Explicit assignment to force the type system to reject if any
      // required PrUrlRepositoryEntry field is absent from the loader shape.
      const prUrlEntry: PrUrlRepositoryEntry = {
        repository_id: raw.repository_id,
        repository_name: raw.repository_name,
        project_name: raw.project_name ?? "",
        organization_name: raw.organization_name,
      };
      expect(prUrlEntry.repository_id).toBe(raw.repository_id);
      expect(prUrlEntry.repository_name).toBe(raw.repository_name);
    }
    // Round-trip proof: resolvePrUrl with the loader-shaped entries
    // produces a named URL (not the fallback), confirming the contract
    // the MVP wiring relies on (dashboard.ts build site).
    const pr = FIXTURE_PRS[0]!;
    const url = resolvePrUrl(
      pr,
      (FIXTURE_DIMENSIONS.repositories ?? []).map((r) => ({
        repository_id: r.repository_id,
        repository_name: r.repository_name,
        project_name: r.project_name ?? "",
        organization_name: r.organization_name,
      })),
      { collectionUri: "https://dev.azure.com/acme/" },
    );
    expect(url).toBe(
      "https://dev.azure.com/acme/Frontend/_git/web-app/pullrequest/1",
    );
  });
});
