## CI Fix Plan — Windows Unicode Encoding Failure (Correct + Minimal)

### Problem

Windows runners fail all matrix jobs because CI prints a **✓** character that cannot be encoded under the Windows default console code page (cp1252), causing `UnicodeEncodeError`.

### Invariants (Hard Requirements)

- CI must not emit non-ASCII characters in any step output that runs on Windows.
- CI must remain OS-agnostic: no Windows-only branches in logic unless unavoidable.
- Local verification must validate the same thing CI validates, using the same install flow.

---

## Phase 1 — Fix the CI Output (Single Change)

### Change

**[MODIFY] `.github/workflows/ci.yml`**

- Replace the checkmark **✓** with ASCII-only output everywhere CI prints status.
- Use a stable prefix like `[OK]` and keep error lines using `::error::`.

**Example requirement:**

- Every print/log line in the pandas verification step must contain only ASCII characters.

### Exit Criteria

- Windows jobs no longer fail with `UnicodeEncodeError`.
- CI output still clearly communicates pass/fail.

---

## Phase 2 — Make the Pandas Verification Step Windows-Safe by Construction

### Change

**[MODIFY] `.github/workflows/ci.yml`**

- Keep the step purely Python-based for parsing/version checks.
- Do **not** rely on bash utilities (`cut`) anywhere in the matrix.
- Ensure the step runs in the shell that matches the runner defaults; avoid `shell: bash` unless you have a hard reason.

**Required verification behavior:**

- Python 3.10 must have pandas major `2`
- Python 3.11+ must have pandas major `3`
- If mismatch: print `::error::...` and exit non-zero
- If match: print `[OK] ...`

### Exit Criteria

- The pandas verification step succeeds on ubuntu/macos/windows for all Python versions in the matrix.
- The pandas verification step fails reliably when forced into the wrong pandas major (this is already implied by CI, but the logic must be deterministic).

---

## Phase 3 — Local Verification (Stop Overengineering It)

### Local verification must be two commands, not a mini-CI system.

#### Required local checks

1. **Run the same pandas verification snippet locally on Windows**

- Use the exact Python snippet that CI uses (copy/paste identical).
- This validates the Windows encoding issue is gone and the logic works.

2. **Run the normal test commands you already trust**

- `python -m pytest …`
- `cd extension && npm run test:ci`

That’s it.

### Explicitly NOT required

- Docker-based “Linux matrix simulation”
- Any local macOS simulation claims
- Any multi-tier local gating table

### Exit Criteria

- Local Windows run prints only ASCII and exits 0.
- Local tests pass.
- Commit and push; CI matrix is the authority for macOS.

---

## Execution Order (Fastest Safe Path)

1. Replace ✓ with `[OK]` in CI step output.
2. Ensure the verification step is Python-only (no `cut`, no bash parsing).
3. Run the CI Python snippet locally once on Windows.
4. Run the standard local test suites.
5. Push and verify CI matrix is green.

---

## Why this is better than the proposed plan

- Fixes the root cause directly with one change.
- Avoids fragile Docker invocations and quoting nightmares.
- Avoids platform drift: CI remains the single source of truth for macOS.
- Keeps local validation aligned with CI logic, not a bespoke substitute.

---

## Victory Gate (Only One That Matters)

- **All CI matrix jobs green** after the ASCII output change:
    - ubuntu/macos/windows × py3.10/3.11/3.12

If you want to go one notch more “enterprise” without bloat: add a short repo invariant doc line: **“CI output must be ASCII-safe on Windows; do not print Unicode symbols.”**
