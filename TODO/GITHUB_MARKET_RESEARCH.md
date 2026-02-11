Verification Report on GitHub Platform Support Findings
What this verification covered
This review validates claims in your document that can be checked against public, authoritative sources (primarily GitHub Docs and Microsoft Learn), and flags where a claim is either (a) incorrect, (b) overstated, or (c) not externally verifiable without access to your repository/codebase.

Several core engineering assertions in your write-up (for example “ADO coupling is isolated to exactly 4 files” and “Stages 2–4 require zero changes”) are codebase-specific and can’t be validated from public sources alone; those are treated as “requires internal audit” rather than “confirmed.” (No public source can confirm file counts or coupling boundaries in an unretrieved private repo.)

GitHub native analytics capabilities and realistic gaps
Your document repeatedly frames GitHub as having “zero native PR analytics” and implies PR throughput requires “manual counting.” That is too strong as written.

At the repository level, GitHub’s built-in Pulse view provides an overview of repository activity and explicitly includes a list of open and merged pull requests, with a selectable period (defaulting to the last 7 days). This contradicts a strict “none/manual counting” claim for basic PR activity and throughput-style counts at the repo level.

Your cited demand signal is real and still relevant: GitHub Community Discussion #13037 (“Pull Analytics: PR turnaround time, lead time for code review and changes”) was created March 18, 2022 and is still marked Unanswered in the GitHub Community UI snapshot retrieved here; it shows 48 votes (your doc said “28+ reactions,” which is outdated).

Separately, GitHub has also publicly positioned organization-level “Insights” for DORA-style metrics (“Deployment Frequency” and “Lead Time for Changes”) as shipped/GA per the official GitHub roadmap Issue #127 (closed; labeled generally available). That is not PR review analytics, but it does weaken the broad narrative that GitHub provides “zero” native engineering analytics.

Net correction: It’s more accurate to say something like:

“GitHub has some built-in repository insights (e.g., Pulse lists merged PRs and activity over time), and GitHub has shipped some org-level engineering insights (DORA-style).”
“GitHub still lacks a dedicated, built-in PR turnaround / PR cycle-time analytics product comparable to specialized developer analytics tools, and community requests for PR turnaround metrics remain open.”
Those are both consistent with the sources above.

API mapping, auth, pagination, and rate-limit claims
This section contains the largest number of objective technical discrepancies.

Authentication header and token types
Your doc says GitHub uses Bearer {token}. That’s consistent with GitHub Docs examples, which show sending the token in the Authorization header as Bearer YOUR-TOKEN.

Rate limiting
Your doc’s rate limit table says: “5,000 req/hour (REST), 30 pts/min (GraphQL).” The GraphQL figure is not correct as stated.

GitHub’s primary rate limits are documented as:

REST API: authenticated requests count toward 5,000 requests per hour (with higher limits for certain GitHub Enterprise Cloud app contexts).
GraphQL API: 5,000 points per hour per user (with higher limits for some GitHub Enterprise Cloud contexts).
The “30/min” figure does appear in GitHub’s ecosystem, but it applies to the REST Search API: GitHub’s REST search endpoints permit up to 30 requests per minute for authenticated requests (and code search is 10/min).

So the misconception is mainly mixing GraphQL primary limits with the Search API’s custom limits.

Pagination
Your doc says GitHub uses Link headers vs ADO continuation tokens. For REST pagination, GitHub explicitly documents use of the HTTP link header (with rel="next" etc.) to move between pages.

“REST has no native date filter; GraphQL search is the direct equivalent”
This is misleading/partial.

It is true that the basic “List pull requests” endpoint doesn’t provide a clean merged_at date-range filter in the way some other platforms do. However, GitHub’s REST Search issues and pull requests endpoint (GET /search/issues) supports the same search qualifiers as the web UI, and GitHub docs explicitly document searching PRs by merge date using the merged: qualifier and merged/unmerged state using is:merged/is:unmerged.

That means REST can do date-range PR retrieval via Search, not only GraphQL.

A critical hidden constraint: search result cap
Search-based extraction has an important operational limit that is not surfaced strongly enough in your plan: GitHub’s REST search API provides up to 1,000 results per search.

If you rely on search queries like is:pr is:merged merged:YYYY-MM-DD..YYYY-MM-DD across a large organization and wide window, you can hit the 1,000-result cap—forcing you to chunk by repo and/or time window. This directly impacts your “complete pagination” / “incremental + backfill” invariants risk assessment (you correctly flagged these invariants as needing care, but the 1,000-result cap is an additional concrete reason the risk may be higher than “Low”).

Endpoint equivalence details
Several of your endpoint equivalences are directionally right, but need wording precision:

PR reviews: GitHub documents listing reviews at GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews.
PR review comments vs issue comments: GitHub explicitly distinguishes “pull request review comments” from “issue comments” on a PR. Your doc’s “reviews + /comments” phrasing risks collapsing these categories; the API separation is real and matters for a comment-thread model.
“Every PR is an issue” nuance: GitHub’s REST docs note that “Issues” endpoints may return PRs, and that the id returned there is an issue id, not the pull request id; you have to treat identifiers carefully if you mix “issues-ish” endpoints into PR modeling.
Data model and normalization misconceptions that can affect invariants
Review “vote” normalization
Your plan maps GitHub review states to an ADO-like numeric vote scale (e.g., APPROVED=10, CHANGES_REQUESTED=-5, COMMENTED=0). Two verification points:

First, your stated ADO scale is correct: Microsoft documents PR reviewer votes as:

10 approved
5 approved with suggestions
0 no vote
-5 waiting for author
-10 rejected
Second, GitHub review states include values like APPROVED in review objects.

However, the specific mapping choice CHANGES_REQUESTED=-5 is a semantic decision, not an objective equivalence. In ADO terms, “waiting for author” (-5) is not the same as “rejected” (-10). If your analytics rely on the meaning of negative votes (for example, “blocked vs not blocked”), GitHub “changes requested” can function as a blocking state in many workflows, whereas “waiting for author” is a distinct ADO concept. This isn’t provably “wrong,” but it is a potential misconception if the goal is to preserve intent parity of ADO voting semantics.

Team and permission modeling in fine-grained tokens
Your fine-grained PAT scope examples in the document (“contents:read”, “pull_requests:read”) don’t match how GitHub documents fine-grained permissions today: GitHub expresses fine-grained access as permission sets, and endpoint docs list the permission set required.

Examples from official endpoint docs:

Listing org repos (GET /orgs/{org}/repos) requires “Metadata” repository permissions (read) for fine-grained tokens.
Listing PR reviews requires “Pull requests” repository permissions (read).
Listing org teams requires “Members” organization permissions (read) for fine-grained tokens, and read:org scope for OAuth/classic tokens.
GitHub also documents that fine-grained token requirements are surfaced via response headers like X-Accepted-GitHub-Permissions, reinforcing that permissions are endpoint-specific.
So the misconception is not “you need read access to contents/PRs”—you do—but rather that the document’s scope list should be updated to match GitHub’s current permission model and names.

Market and competitive landscape check
“No free/open-source competitor matches this tool’s depth”
This is not supportable as stated, because multiple open-source projects provide substantial PR analytics and dashboards (even if their UI/ML/export story differs from yours).

A strong counterexample is Apache DevLake (under the Apache Software Foundation umbrella): it is an open-source dev data platform and includes PR metrics such as “PR Cycle Time,” documented as the total time from first commit through merge/deploy stages.
DevLake also documents that its official dashboards ship as Grafana dashboards, and that users can swap to another BI tool if desired.

Other open-source ecosystems relevant to PR analytics include:

GrimoireLab (from the CHAOSS ecosystem), which provides GitHub pull request efficiency dashboards.
Augur, an open-source suite that collects and normalizes repository data and provides a variety of metrics.
Even within GitHub’s own ecosystem, there are Marketplace actions that compute PR-related metrics (e.g., a “pull request analytics” action that generates reports).
GitHub has also highlighted actions intended to track issue/PR counts (open/merged PRs, etc.) for maintainers.

This doesn’t mean your tool lacks differentiation. It does mean the document’s “no OSS competitor” claim should be revised into a narrower, defensible uniqueness statement (e.g., “unique combination of SQLite-local workflow + Power BI export contract + extension/dashboard parity + embedded ML/AI”), which is a different claim than “no OSS competitor matches feature depth.”

Commercial pricing tiers
Your doc assigns broad price bands (e.g., “$40–70/dev”). Pricing for engineering analytics vendors is often tiered, negotiated, or changes over time; without a stable official price schedule for each competitor, the specific ranges are hard to “verify” as facts. As a single spot-check, third-party directories list LinearB starting prices in the ~$39/user/month ballpark in late 2025, but that does not validate the entire $40–70 band nor higher enterprise tiers for all vendors.

Discrepancies and recommended edits to your document
Corrections that are clearly warranted
Your “Last reviewed: 2026-02-11” header suggests the document is meant to be current; these edits would align it with current official docs.

Update the “GitHub native capabilities” narrative

Replace “GitHub has zero native PR analytics” with something like: “GitHub provides basic repository-level PR activity summaries (Pulse) and has shipped some org-level Insights metrics (DORA-style), but lacks dedicated PR turnaround / review-cycle analytics comparable to specialized tools.”
Update the community-demand data point

Discussion #13037: change “28+ reactions” to 48 votes (and keep the “Unanswered” status, which remains accurate in this snapshot).
Fix rate limit misconceptions

Replace “GraphQL 30 pts/min” with: “GraphQL primary rate limit measured in points (5,000 points/hour per user), with secondary per-minute constraints; REST core is 5,000 requests/hour; REST Search is 30 requests/min (code search 10/min).”
Correct the REST-vs-GraphQL extraction equivalence framing

Clarify that REST Search issues and pull requests (GET /search/issues) supports merged: date filtering and is:merged, so date-range extraction is possible via REST Search too.
Add the concrete constraint: search returns up to 1,000 results per query, which can force window chunking in large orgs.
Update fine-grained PAT wording

Replace fine-grained “scopes” with the permission-set language GitHub uses, and cite examples such as “Metadata (read)” for listing org repos, “Pull requests (read)” for PR reviews, and “Members (read)” for org teams.
Tighten PR comment/thread equivalence claims

When mapping ADO “threads” to GitHub, explicitly call out that GitHub PR review comments differ from issue comments and may need separate collection/endpoints before normalization into a single internal thread model.
Claims that are plausible but not externally verifiable
These should be marked as “validated by internal code audit” rather than stated as fact unless you back them with repo evidence:

“ADO coupling is isolated to exactly 4 files.”
“Dashboard, CSV generator, aggregation engine, SQLite schema require zero changes.”
No public source can confirm those file-level statements; they depend on your codebase.

Market-claim narrowing needed
“No free/open-source competitor matches this tool’s feature depth” should be rewritten, because open-source tools like Apache DevLake (PR cycle-time metrics, dashboards) and GrimoireLab (PR efficiency dashboards) clearly exist. A more defensible statement is to enumerate the specific bundle this tool offers (e.g., local SQLite + Power BI export contract + integrated extension) rather than implying absence of OSS alternatives.
