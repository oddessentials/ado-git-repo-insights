## Implementation Plan — ado-pull-request-metrics to ado-git-repo-insights Refactor

You are an autonomous software engineering team responsible for producing a **detailed, execution-ready implementation plan** for refactoring the system described in `/blueprint.md`.

`/blueprint.md` is **authoritative** and must be treated as ground truth.

---

## 1. Context (Authoritative)

The existing repository:

- Extracts Azure DevOps Pull Request data
- Stores it in MongoDB
- Produces CSV outputs under `csv_output/` consumed by PowerBI

Key facts from `/blueprint.md`:

- Entry points:

  - `extractors/ado_pr_extractor.py`
  - `generate_raw_data.py`

- MongoDB must be **fully removed**
- The **PowerBI CSV contract is non-negotiable**:

  - Same filenames
  - Same columns
  - Same column ordering

- The future system must:

  - Run **daily**
  - Operate at the **org level**
  - Target **multiple projects via configuration**
  - Require **near-zero infrastructure cost**
  - Be suitable for an **Azure DevOps extension**

---

## 2. Primary Goals (In Priority Order)

1. Replace MongoDB with an embedded persistence layer

   - **SQLite is the default choice**
   - Alternatives must be justified

2. Enable **daily incremental extraction**
3. Convert the system into an **Azure DevOps extension–friendly architecture**
4. Preserve **100% CSV output compatibility**
5. Minimize operational cost and friction

---

## 3. Non-Negotiable Constraints

- ❌ Do not modify the PowerBI CSV schema or ordering
- ❌ Do not require always-on servers
- ❌ Do not introduce paid infra unless explicitly enabled
- ❌ Do not assume manual execution
- ✅ Favor determinism, idempotency, and auditability

---

## 4. What You Must Produce

Create a **step-by-step implementation plan** covering the sections below.

Use **Markdown**, with clear headers, bullet points, and tables where helpful.

---

## 5. Target Architecture

Describe the **final target architecture**, including:

- Logical components:

  - Extraction
  - Persistence
  - Transformation
  - CSV export

- Data flow:

  - Azure DevOps API → SQLite → CSV (`csv_output/`)

- Clear separation of concerns
- How org-level config drives project selection

(Architecture diagram may be described in text.)

---

## 6. Persistence & Data Model

### A) SQLite as Primary Store

- Define the proposed SQLite schema:

  - Tables
  - Primary keys
  - Indexes

- Show how PRs, users, reviewers, repos, projects, and orgs are stored
- Explain how this schema maps **exactly** to the existing CSV outputs

### B) Incremental State

- How the system tracks:

  - Last successful extraction date
  - Previously seen PRs

- How UPSERT/idempotent behavior is guaranteed

---

## 7. Extraction Strategy

Explain how the extractor will:

- Run **daily**
- Target **multiple projects in one execution**
- Fetch only new or updated PRs
- Respect ADO API rate limits
- Retry safely on transient failures

Explicitly remove the current hardcoded date logic.

---

## 8. Transformation & CSV Generation

Describe:

- How existing logic from `generate_raw_data.py` will be:

  - Reused, or
  - Reimplemented against SQL

- How the CSV files are generated:

  - Same filenames
  - Same columns
  - Same ordering

- How deterministic ordering is ensured

---

## 9. Azure DevOps Extension & Runtime Model

### A) Extension Type

- Define what is being shipped:

  - Azure DevOps **Pipeline Task extension** (preferred)

- High-level extension structure:

  - `vss-extension.json`
  - task definition (`task.json`)
  - runtime wrapper (Node → Python invocation if needed)

### B) Configuration

- How users configure:

  - Organization
  - Project list
  - Optional date overrides

- How secrets (ADO PAT) are provided securely

---

## 10. Deployment & Persistence Strategy (Locked In)

### **Primary Strategy — Option 1 (Locked)**

**SQLite persisted via Azure DevOps Pipeline Artifacts**

Your plan must assume:

- Each daily run:

  1. Downloads the prior SQLite DB artifact
  2. Performs incremental extraction
  3. Writes updated SQLite DB
  4. Publishes it back as a pipeline artifact

- CSV outputs are published as pipeline artifacts or written to a known path

Explain:

- Artifact naming strategy
- Retention considerations
- Size growth expectations
- Failure recovery behavior

---

### **Fallback Strategy — Option 3 (Feature-Flagged)**

**Azure Storage–backed persistence**

If SQLite grows beyond artifact limits:

- A **feature flag** in the extension enables Azure Storage
- Storage type (Blob/Table) must be specified
- Authentication strategy must be described
- Migration from artifact → Azure Storage must be safe and explicit

This fallback:

- Is **disabled by default**
- Must not affect users unless explicitly enabled

---

## 11. CI/CD & Release

Describe:

- GitHub Actions workflow:

  - Build
  - Tests
  - Package `.vsix`
  - Publish to Azure DevOps Marketplace

- Versioning strategy
- Private vs public marketplace choice
- Secrets handling

---

## 12. Scheduling Model

Explain:

- How users set up **daily execution**:

  - Scheduled Azure DevOps pipelines (cron)

- Where logs, outputs, and artifacts are accessible
- How failures are surfaced

---

## 13. Migration Strategy

Explain:

- Whether historical MongoDB data is migrated
- If yes:

  - One-time migration approach
  - Validation via CSV parity checks

- If no:

  - Clear rationale

---

## 14. Testing & Validation

Define:

- CSV diff validation (old vs new)
- Schema/order validation
- Sample PowerBI verification
- Automated test additions

---

## 15. Rollout & Risk Management

Provide:

- Phased rollout plan
- Rollback strategy
- Key risks and mitigations

---

## 16. Effort & Phasing

Provide:

- Estimated effort per phase
- Critical path items
- Dependencies and sequencing

---

## 17. Tone & Expectations

- Be concrete and decisive
- Prefer explicit trade-offs over vague options
- Assume review by senior engineers
- Avoid aspirational language
