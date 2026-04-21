/**
 * Tests for `resolvePrUrl` — PR-level detail URL composition (feature 060,
 * FR-005, FR-005a, SC-009). Pure function tests; no DOM, no fixtures.
 */

import {
  resolvePrUrl,
  type PrUrlPrRecord,
  type PrUrlRepositoryEntry,
  type PrUrlWebContext,
} from "../../../ui/modules/shared/pr-url";
import { LOCAL_DASHBOARD_COLLECTION_URI } from "../../../ui/modules/sdk";

const CTX: PrUrlWebContext = {
  collectionUri: "https://dev.azure.com/acme-org/",
};

const KNOWN_REPO: PrUrlRepositoryEntry = {
  repository_id: "repo-guid-001",
  repository_name: "web-app",
  project_name: "Frontend",
  organization_name: "acme-org",
};

const OTHER_REPO: PrUrlRepositoryEntry = {
  repository_id: "repo-guid-002",
  repository_name: "api-server",
  project_name: "Backend",
  organization_name: "acme-org",
};

describe("resolvePrUrl (FR-005 / FR-005a)", () => {
  describe("named URL form (happy path)", () => {
    it("composes the project/_git/repo-name/pullrequest/id form", () => {
      const pr: PrUrlPrRecord = { id: 42, repository_id: "repo-guid-001" };
      expect(resolvePrUrl(pr, [KNOWN_REPO, OTHER_REPO], CTX)).toBe(
        "https://dev.azure.com/acme-org/Frontend/_git/web-app/pullrequest/42",
      );
    });

    it("percent-encodes repository and project names with special chars", () => {
      const repo: PrUrlRepositoryEntry = {
        repository_id: "repo-guid-003",
        repository_name: "iOS App",
        project_name: "Mobile Team",
        organization_name: "acme-org",
      };
      const pr: PrUrlPrRecord = { id: 9, repository_id: "repo-guid-003" };
      expect(resolvePrUrl(pr, [repo], CTX)).toBe(
        "https://dev.azure.com/acme-org/Mobile%20Team/_git/iOS%20App/pullrequest/9",
      );
    });

    it("appends a trailing slash to collectionUri when missing", () => {
      const ctxNoSlash: PrUrlWebContext = {
        collectionUri: "https://dev.azure.com/acme-org",
      };
      const pr: PrUrlPrRecord = { id: 1, repository_id: "repo-guid-001" };
      expect(resolvePrUrl(pr, [KNOWN_REPO], ctxNoSlash)).toBe(
        "https://dev.azure.com/acme-org/Frontend/_git/web-app/pullrequest/1",
      );
    });
  });

  describe("numeric-id fallback form (unresolvable repo)", () => {
    it("uses the repository_id as the _git segment when repositories is null", () => {
      const pr: PrUrlPrRecord = { id: 7, repository_id: "repo-guid-999" };
      expect(resolvePrUrl(pr, null, CTX)).toBe(
        "https://dev.azure.com/acme-org/_git/repo-guid-999/pullrequest/7",
      );
    });

    it("uses the repository_id as the _git segment when dimension lookup misses", () => {
      const pr: PrUrlPrRecord = { id: 7, repository_id: "repo-guid-999" };
      expect(resolvePrUrl(pr, [KNOWN_REPO, OTHER_REPO], CTX)).toBe(
        "https://dev.azure.com/acme-org/_git/repo-guid-999/pullrequest/7",
      );
    });

    it("falls back when the dimension entry has an empty repository_name", () => {
      const blankRepo: PrUrlRepositoryEntry = {
        repository_id: "repo-guid-blank",
        repository_name: "",
        project_name: "Frontend",
        organization_name: "acme-org",
      };
      const pr: PrUrlPrRecord = { id: 15, repository_id: "repo-guid-blank" };
      expect(resolvePrUrl(pr, [blankRepo], CTX)).toBe(
        "https://dev.azure.com/acme-org/_git/repo-guid-blank/pullrequest/15",
      );
    });

    it("falls back when the dimension entry has an empty project_name", () => {
      const blankProjectRepo: PrUrlRepositoryEntry = {
        repository_id: "repo-guid-blankproj",
        repository_name: "web-app",
        project_name: "",
        organization_name: "acme-org",
      };
      const pr: PrUrlPrRecord = {
        id: 16,
        repository_id: "repo-guid-blankproj",
      };
      expect(resolvePrUrl(pr, [blankProjectRepo], CTX)).toBe(
        "https://dev.azure.com/acme-org/_git/repo-guid-blankproj/pullrequest/16",
      );
    });

    it("percent-encodes the repository_id when used in fallback", () => {
      const pr: PrUrlPrRecord = {
        id: 33,
        repository_id: "repo id with spaces",
      };
      expect(resolvePrUrl(pr, [], CTX)).toBe(
        "https://dev.azure.com/acme-org/_git/repo%20id%20with%20spaces/pullrequest/33",
      );
    });
  });

  describe("demo-mode collection URI (feature 309 #315)", () => {
    it("composes a deterministic URL rooted at LOCAL_DASHBOARD_COLLECTION_URI", () => {
      // Pure composition: no DOM, no bootstrap. Locks the URL shape the
      // local-mode dashboard will produce for synthetic PR rows on the
      // published demo surface.
      const ctx: PrUrlWebContext = {
        collectionUri: LOCAL_DASHBOARD_COLLECTION_URI,
      };
      const repo: PrUrlRepositoryEntry = {
        repository_id: "repo-guid-alpha",
        repository_name: "feature-store",
        project_name: "Data",
        organization_name: "oddessentials",
      };
      const pr: PrUrlPrRecord = {
        id: 202510042,
        repository_id: "repo-guid-alpha",
      };
      expect(resolvePrUrl(pr, [repo], ctx)).toBe(
        "https://dev.azure.com/oddessentials/Data/_git/feature-store/pullrequest/202510042",
      );
    });
  });
});
