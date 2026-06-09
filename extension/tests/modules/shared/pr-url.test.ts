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

  describe("idempotent encoding — no double-encoding (feature 365)", () => {
    // Demo/sample data uses only hyphenated lowercase names, which encode to
    // themselves, so these cases (names with spaces, and names already
    // percent-encoded) are the only ones that can surface a double-encoding
    // regression. See specs/365-pr-url-double-encoding/spec.md.

    it("does not double-encode a project name that is already percent-encoded", () => {
      const repo: PrUrlRepositoryEntry = {
        repository_id: "repo-guid-enc",
        repository_name: "consumer-tech",
        project_name: "Consumer%20Technology",
        organization_name: "acme-org",
      };
      const pr: PrUrlPrRecord = { id: 77, repository_id: "repo-guid-enc" };
      expect(resolvePrUrl(pr, [repo], CTX)).toBe(
        "https://dev.azure.com/acme-org/Consumer%20Technology/_git/consumer-tech/pullrequest/77",
      );
    });

    it("does not double-encode a repository name that is already percent-encoded", () => {
      const repo: PrUrlRepositoryEntry = {
        repository_id: "repo-guid-enc2",
        repository_name: "iOS%20App",
        project_name: "Mobile Team",
        organization_name: "acme-org",
      };
      const pr: PrUrlPrRecord = { id: 78, repository_id: "repo-guid-enc2" };
      expect(resolvePrUrl(pr, [repo], CTX)).toBe(
        "https://dev.azure.com/acme-org/Mobile%20Team/_git/iOS%20App/pullrequest/78",
      );
    });

    it("produces an identical URL whether the name is raw or already percent-encoded", () => {
      const raw: PrUrlRepositoryEntry = {
        repository_id: "repo-guid-idem",
        repository_name: "Web App",
        project_name: "Consumer Technology",
        organization_name: "acme-org",
      };
      const encoded: PrUrlRepositoryEntry = {
        ...raw,
        repository_name: "Web%20App",
        project_name: "Consumer%20Technology",
      };
      const pr: PrUrlPrRecord = { id: 79, repository_id: "repo-guid-idem" };
      const fromRaw = resolvePrUrl(pr, [raw], CTX);
      const fromEncoded = resolvePrUrl(pr, [encoded], CTX);
      expect(fromRaw).toBe(fromEncoded);
      expect(fromRaw).toBe(
        "https://dev.azure.com/acme-org/Consumer%20Technology/_git/Web%20App/pullrequest/79",
      );
    });

    it("never emits a double-encoded space (%2520) for an already-encoded name", () => {
      const repo: PrUrlRepositoryEntry = {
        repository_id: "repo-guid-no2520",
        repository_name: "api%20server",
        project_name: "Back%20End",
        organization_name: "acme-org",
      };
      const pr: PrUrlPrRecord = { id: 80, repository_id: "repo-guid-no2520" };
      const url = resolvePrUrl(pr, [repo], CTX);
      expect(url).not.toContain("%2520");
      expect(url).toBe(
        "https://dev.azure.com/acme-org/Back%20End/_git/api%20server/pullrequest/80",
      );
    });

    it("single-encodes an already-encoded repository_id in the fallback form", () => {
      const pr: PrUrlPrRecord = { id: 81, repository_id: "weird%20id" };
      expect(resolvePrUrl(pr, [], CTX)).toBe(
        "https://dev.azure.com/acme-org/_git/weird%20id/pullrequest/81",
      );
    });

    it("never throws on a malformed percent-escape; encodes it as a literal", () => {
      // `bad%zz` is not valid percent-encoding, so decodeURIComponent throws.
      // The encoder must fall back to encoding the value as-is (the `%` becomes
      // `%25`) rather than propagating the error — honoring the documented
      // "never throws; always returns a string" contract. ADO names cannot
      // contain a literal `%`, so this input cannot occur in practice; the test
      // exists to lock the defensive branch.
      const pr: PrUrlPrRecord = { id: 82, repository_id: "bad%zz" };
      expect(resolvePrUrl(pr, [], CTX)).toBe(
        "https://dev.azure.com/acme-org/_git/bad%25zz/pullrequest/82",
      );
    });
  });
});
