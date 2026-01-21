## Implementation Plan: Close Semgrep Findings Safely (ADO Extension)

### Guiding rules (non-negotiable)

1. **No shell execution** for anything that touches untrusted or user-configurable inputs. (`shell: false` always)
2. **No stringly-typed commands**. Use `execFile` / `spawn` with an **args array**.
3. **All UI data is untrusted** (PR titles/descriptions, repo names, author names, artifact metadata). Never feed that into `innerHTML`.
4. **All filesystem paths are untrusted** if influenced by task inputs / env / artifact names. Enforce “stay inside base dir”.
5. **Generated bundles** should not be hand-edited; fix sources and regenerate, then optionally ignore bundle folders in Semgrep.

---

## Phase 0 — Triage & Ownership Boundaries (PR #1)

**Goal:** Make the work safe to parallelize and prevent regressions.

**Actions**

* Add a short `SECURITY.md` section (or `docs/security.md`) with:

  * “No shell, no string command” policy
  * “No innerHTML with untrusted data” policy
  * “Safe path join” policy
* Add/confirm Semgrep runs in CI for:

  * `extension/**`, `src/**`
  * Excluding build outputs (only after Phase 5)
* Add **unit tests** for new helpers you’ll introduce (safe spawn, safe path, escape/sanitize).

**Definition of done**

* Docs added.
* CI still green (or only the known Semgrep findings remain, not new ones).

---

## Phase 1 — Command Injection Hardening (extract-prs task) (PR #2)

**Findings:** `extension/tasks/extract-prs/index.js` multiple “pythonCmd → child_process” and “shell: win32” flags.

### 1.1 Replace command construction with safe runner

**Actions**

* Introduce a small utility (e.g. `extension/tasks/_shared/safe-process.ts` or `.js`) providing:

  * `runProcess(exe: string, args: string[], opts)` implemented with **`spawn` or `execFile`** and `shell: false`.
  * Strict timeouts, maxBuffer (if `execFile`), and predictable error surfaces.
* Replace any `$SPAWN` wrapper usage that sets `shell: process.platform === "win32"` with `shell: false` always.

### 1.2 Lock down `pythonCmd`

**Preferred approach (most secure)**

* **Remove `pythonCmd` as a free-form argument.**
* Resolve python as:

  * `process.env.PYTHON` (optional) OR task input like `pythonPath`
  * but validated as **absolute path** (recommended) or allowlist of `{python, python3, py}` only.
* If you must keep user-configurable python:

  * Validate:

    * no spaces that imply “inline args” (disallow `python -u`)
    * no path traversal segments
    * on Windows: must end in `python.exe` or `py.exe` if absolute path
  * Reject otherwise with a clear error.

### 1.3 Fix test-related command execution flags (prCount/seed)

**Findings:** `extension/tests/performance.test.ts` and `extension/tests/synthetic-fixtures.test.ts` pass `prCount`, `seed` into child_process.

**Actions**

* Ensure numeric inputs are parsed as numbers and re-serialized as args:

  * `const prCount = Number.parseInt(x, 10); if (!Number.isSafeInteger(prCount) || prCount < 0 || prCount > MAX) throw`
  * then pass as `["--pr-count", String(prCount)]` (not interpolated into a single command string).
* If the tests intentionally simulate CLI invocation, they should use the same `runProcess()` helper to keep patterns consistent.

**Definition of done**

* No Semgrep reds related to child_process/pythonCmd/prCount/seed.
* Zero usages of `shell: true` (or platform-conditional shell) anywhere in repo.

---

## Phase 2 — Path Traversal Hardening (tests + any runtime code) (PR #3)

**Findings:** `path.join/resolve` with “possible user input”.

### 2.1 Introduce safe path resolver

**Actions**

* Add helper `resolveInside(baseDir, ...parts)`:

  * `const resolved = path.resolve(baseDir, ...parts)`
  * `if (!resolved.startsWith(path.resolve(baseDir) + path.sep)) throw new Error("Path escapes baseDir")`
* Replace flagged joins/resolves in:

  * `extension/tests/performance.test.ts` lines flagged
  * `extension/tests/synthetic-fixtures.test.ts` lines flagged
* If any runtime code does artifact extraction to temp dirs, apply same helper there too.

**Definition of done**

* No Semgrep yellows for traversal in those files.
* Dedicated unit test for `resolveInside()` on Windows + POSIX path cases.

---

## Phase 3 — XSS Hardening (dashboard + settings + tests) (PR #4)

**Findings:** `innerHTML/outerHTML/document.write` in:

* `extension/ui/dashboard.ts`
* `extension/ui/settings.ts`
* `extension/tests/dashboard.test.ts`
* plus the bundled outputs in `src/ado_git_repo_insights/ui_bundle/*.js`

### 3.1 Stop using `innerHTML` for untrusted data

**Actions**

* Inventory each flagged line and categorize:

  1. **Template scaffolding** (static markup you control)
  2. **Dynamic content** (PR title, user name, repo name, artifact names, errors, etc.)
* For (2), replace with:

  * `textContent` for plain text
  * DOM building via `document.createElement`, `append`, `replaceChildren`
* If you truly need HTML (rare):

  * Introduce `escapeHtml(str)` and only allow a tiny subset (or better: avoid entirely).
  * Do **not** “sanitize by regex”; either escape or use a proven sanitizer dependency.
  * If adding a dependency is too heavy for the extension, default to escaping + DOM nodes.

### 3.2 Fix tests that use `innerHTML`

**Actions**

* Update `extension/tests/dashboard.test.ts` to build DOM using element creation rather than `innerHTML`.
* If the test is intentionally verifying rendering output, assert on `textContent` / DOM structure instead.

### 3.3 Regenerate bundles; do not hand-edit outputs

**Actions**

* Ensure `src/ado_git_repo_insights/ui_bundle/dashboard.js` and `settings.js` are generated from the TS sources.
* After fixing TS sources, **rebuild** to regenerate bundles.
* Only if Semgrep still scans bundles: handle in Phase 5.

**Definition of done**

* No Semgrep reds for XSS sinks in TS sources and tests.
* Bundle regenerated and matches source behavior.

---

## Phase 4 — Log Forging Hardening (PR #5)

**Findings:** “util.format / console.log format string injection” via string concat with non-literal variables:

* `extension/ui/dashboard.ts`
* `extension/ui/settings.ts`
* `extension/ui/artifact-client.ts`
* bundled equivalents

**Actions**

* Replace patterns like:

  * `console.log("msg: " + userInput)`
  * `util.format(userInput + "...")`
* With either:

  * `console.log("msg:", userInput)` (separate args; stable format string)
  * or `console.log("msg: %s", userInput)` (literal format string)
  * or `console.log("msg", { userInput })` for structured logs

**Definition of done**

* No Semgrep blues for format-string/log forging in sources.
* Bundles regenerated.

---

## Phase 5 — Semgrep Policy: Generated Files & Narrow Suppressions (PR #6)

**Goal:** Avoid “fight the bundle” forever, without masking real issues.

**Actions**

1. Confirm which directories are generated:

   * `src/ado_git_repo_insights/ui_bundle/**` appears generated/minified/bundled output.
2. Configure Semgrep to ignore build artifacts **only after** fixing the source:

   * Add ignore patterns for bundle directories in Semgrep config (or CI invocation), e.g.:

     * `src/**/ui_bundle/**`
     * any `dist/`, `build/`, etc.
3. If a remaining finding is truly a false positive:

   * Use the narrowest suppression mechanism available (inline ignore with justification) and require:

     * Comment includes: “why safe”, “why unavoidable”, “what would make it unsafe”.

**Pushback stance (acceptable)**

* It is reasonable to **exclude generated bundles** from Semgrep scanning, as long as:

  * the source TS/JS remains scanned, and
  * the build is deterministic and regenerates bundles from scanned sources.

**Definition of done**

* Semgrep passes in CI without blanket exclusions of `extension/ui/**` or task runtime code.
* Only generated outputs are excluded, with docs stating why.

---

## Phase 6 — Regression & Hardening Gates (PR #7)

**Actions**

* Add a “security invariants” test suite (lightweight):

  * Grep-based test: fail if `shell: true` appears anywhere.
  * Fail if `innerHTML =` appears in `extension/ui/**/*.ts` (allowlist exceptions only if static + documented).
* Ensure CI runs:

  * unit tests
  * Semgrep
  * build that regenerates bundles and verifies git clean (no uncommitted diffs)

**Definition of done**

* CI proves the invariants.
* No reintroduction possible without failing tests.

---

## Work Breakdown Table (what to fix where)

| Area                   | Finding Type              | Fix Pattern                                             | Where                                                                               |
| ---------------------- | ------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| extract-prs task       | command injection + shell | spawn/execFile + args + `shell:false` + validate python | `extension/tasks/extract-prs/index.js`                                              |
| perf + synthetic tests | command injection         | parse/validate number; pass as args array               | `extension/tests/performance.test.ts`, `extension/tests/synthetic-fixtures.test.ts` |
| tests                  | path traversal            | `resolveInside(baseDir, …)`                             | same test files                                                                     |
| dashboard/settings     | XSS                       | replace `innerHTML` with DOM APIs / `textContent`       | `extension/ui/dashboard.ts`, `extension/ui/settings.ts`                             |
| UI tests               | XSS                       | build DOM via createElement; assert on DOM/text         | `extension/tests/dashboard.test.ts`                                                 |
| UI + artifact client   | log forging               | literal format string or multi-arg console.log          | `extension/ui/*.ts`                                                                 |
| ui_bundle              | XSS/log forging           | regenerate from sources; then ignore in Semgrep         | `src/**/ui_bundle/**`                                                               |

---

Full list:
Carefully consider all this feedback we received from our review team. We are going to need a well thought out implementation plan to tackle all of these issues (or push back where necessary). Can you craft one that I can hand off to the autonomous software engineering team to follow through on and knock these issues out? Or are they too ambiguous for such a plan to go down safely?

extension/tasks/extract-prs/index.js
🔴 (line 90) [semgrep]: Detected calls to child_process from a function argument pythonCmd. This could lead to a command injection if the input is user controllable. Try to avoid calls to child_process, and if it is needed ensure user input is correctly sanitized or sandboxed.
🔴 (line 98) [semgrep]: Detected calls to child_process from a function argument pythonCmd. This could lead to a command injection if the input is user controllable. Try to avoid calls to child_process, and if it is needed ensure user input is correctly sanitized or sandboxed.
🔴 (line 107) [semgrep]: Detected calls to child_process from a function argument pythonCmd. This could lead to a command injection if the input is user controllable. Try to avoid calls to child_process, and if it is needed ensure user input is correctly sanitized or sandboxed.
🔴 (line 119) [semgrep]: Detected calls to child_process from a function argument pythonCmd. This could lead to a command injection if the input is user controllable. Try to avoid calls to child_process, and if it is needed ensure user input is correctly sanitized or sandboxed.
🔴 (line 395) [semgrep]: Found '$SPAWN' with '{shell: process.platform === "win32"}'. This is dangerous because this call will spawn the command using a shell process. Doing so propagates current shell settings and variables, which makes it much easier for a malicious actor to execute commands. Use '{shell: false}' instead.
🔴 (line 395) [semgrep]: Detected calls to child_process from a function argument pythonCmd. This could lead to a command injection if the input is user controllable. Try to avoid calls to child_process, and if it is needed ensure user input is correctly sanitized or sandboxed.
extension/tests/dashboard.test.ts
🔴 (line 53) [semgrep]: User controlled data in methods like innerHTML, outerHTML or document.write is an anti-pattern that can lead to XSS vulnerabilities
🔴 (line 64) [semgrep]: User controlled data in methods like innerHTML, outerHTML or document.write is an anti-pattern that can lead to XSS vulnerabilities
🔴 (line 138) [semgrep]: User controlled data in methods like innerHTML, outerHTML or document.write is an anti-pattern that can lead to XSS vulnerabilities
🔴 (line 160) [semgrep]: User controlled data in methods like innerHTML, outerHTML or document.write is an anti-pattern that can lead to XSS vulnerabilities
🔴 (line 162) [semgrep]: User controlled data in methods like innerHTML, outerHTML or document.write is an anti-pattern that can lead to XSS vulnerabilities
🔴 (line 238) [semgrep]: User controlled data in methods like innerHTML, outerHTML or document.write is an anti-pattern that can lead to XSS vulnerabilities
🔴 (line 271) [semgrep]: User controlled data in methods like innerHTML, outerHTML or document.write is an anti-pattern that can lead to XSS vulnerabilities
🔴 (line 776) [semgrep]: User controlled data in methods like innerHTML, outerHTML or document.write is an anti-pattern that can lead to XSS vulnerabilities
🔴 (line 1087) [semgrep]: User controlled data in methods like innerHTML, outerHTML or document.write is an anti-pattern that can lead to XSS vulnerabilities
🔴 (line 1300) [semgrep]: User controlled data in methods like innerHTML, outerHTML or document.write is an anti-pattern that can lead to XSS vulnerabilities
extension/tests/performance.test.ts
🔴 (line 364) [semgrep]: Detected calls to child_process from a function argument prCount. This could lead to a command injection if the input is user controllable. Try to avoid calls to child_process, and if it is needed ensure user input is correctly sanitized or sandboxed.
🔴 (line 402) [semgrep]: Detected calls to child_process from a function argument prCount. This could lead to a command injection if the input is user controllable. Try to avoid calls to child_process, and if it is needed ensure user input is correctly sanitized or sandboxed.
🔴 (line 435) [semgrep]: Detected calls to child_process from a function argument prCount. This could lead to a command injection if the input is user controllable. Try to avoid calls to child_process, and if it is needed ensure user input is correctly sanitized or sandboxed.
🟡 (line 348) [semgrep]: Detected possible user input going into a path.join or path.resolve function. This could possibly lead to a path traversal vulnerability, where the attacker can access arbitrary files stored in the file system. Instead, be sure to sanitize or validate user input first.
🟡 (line 389) [semgrep]: Detected possible user input going into a path.join or path.resolve function. This could possibly lead to a path traversal vulnerability, where the attacker can access arbitrary files stored in the file system. Instead, be sure to sanitize or validate user input first.
🟡 (line 390) [semgrep]: Detected possible user input going into a path.join or path.resolve function. This could possibly lead to a path traversal vulnerability, where the attacker can access arbitrary files stored in the file system. Instead, be sure to sanitize or validate user input first.
🟡 (line 423) [semgrep]: Detected possible user input going into a path.join or path.resolve function. This could possibly lead to a path traversal vulnerability, where the attacker can access arbitrary files stored in the file system. Instead, be sure to sanitize or validate user input first.
🟡 (line 424) [semgrep]: Detected possible user input going into a path.join or path.resolve function. This could possibly lead to a path traversal vulnerability, where the attacker can access arbitrary files stored in the file system. Instead, be sure to sanitize or validate user input first.
🟡 (line 444) [semgrep]: Detected possible user input going into a path.join or path.resolve function. This could possibly lead to a path traversal vulnerability, where the attacker can access arbitrary files stored in the file system. Instead, be sure to sanitize or validate user input first.
extension/tests/synthetic-fixtures.test.ts
🔴 (line 66) [semgrep]: Detected calls to child_process from a function argument prCount. This could lead to a command injection if the input is user controllable. Try to avoid calls to child_process, and if it is needed ensure user input is correctly sanitized or sandboxed.
🔴 (line 66) [semgrep]: Detected calls to child_process from a function argument seed. This could lead to a command injection if the input is user controllable. Try to avoid calls to child_process, and if it is needed ensure user input is correctly sanitized or sandboxed.
🟡 (line 49) [semgrep]: Detected possible user input going into a path.join or path.resolve function. This could possibly lead to a path traversal vulnerability, where the attacker can access arbitrary files stored in the file system. Instead, be sure to sanitize or validate user input first.
🟡 (line 52) [semgrep]: Detected possible user input going into a path.join or path.resolve function. This could possibly lead to a path traversal vulnerability, where the attacker can access arbitrary files stored in the file system. Instead, be sure to sanitize or validate user input first.
extension/ui/dashboard.ts
🔴 (line 670) [semgrep]: User controlled data in methods like innerHTML, outerHTML or document.write is an anti-pattern that can lead to XSS vulnerabilities
🔴 (line 699) [semgrep]: User controlled data in methods like innerHTML, outerHTML or document.write is an anti-pattern that can lead to XSS vulnerabilities
🔴 (line 757) [semgrep]: User controlled data in methods like innerHTML, outerHTML or document.write is an anti-pattern that can lead to XSS vulnerabilities
🔴 (line 1243) [semgrep]: User controlled data in methods like innerHTML, outerHTML or document.write is an anti-pattern that can lead to XSS vulnerabilities
🔴 (line 1286) [semgrep]: User controlled data in methods like innerHTML, outerHTML or document.write is an anti-pattern that can lead to XSS vulnerabilities
🔴 (line 1517) [semgrep]: User controlled data in methods like innerHTML, outerHTML or document.write is an anti-pattern that can lead to XSS vulnerabilities
🔴 (line 1573) [semgrep]: User controlled data in methods like innerHTML, outerHTML or document.write is an anti-pattern that can lead to XSS vulnerabilities
🔴 (line 1684) [semgrep]: User controlled data in methods like innerHTML, outerHTML or document.write is an anti-pattern that can lead to XSS vulnerabilities
🔴 (line 1744) [semgrep]: User controlled data in methods like innerHTML, outerHTML or document.write is an anti-pattern that can lead to XSS vulnerabilities
🔴 (line 1765) [semgrep]: User controlled data in methods like innerHTML, outerHTML or document.write is an anti-pattern that can lead to XSS vulnerabilities
🔴 (line 1833) [semgrep]: User controlled data in methods like innerHTML, outerHTML or document.write is an anti-pattern that can lead to XSS vulnerabilities
🔴 (line 1840) [semgrep]: User controlled data in methods like innerHTML, outerHTML or document.write is an anti-pattern that can lead to XSS vulnerabilities
🔴 (line 1876) [semgrep]: User controlled data in methods like innerHTML, outerHTML or document.write is an anti-pattern that can lead to XSS vulnerabilities
🔴 (line 1888) [semgrep]: User controlled data in methods like innerHTML, outerHTML or document.write is an anti-pattern that can lead to XSS vulnerabilities
🔴 (line 2129) [semgrep]: User controlled data in methods like innerHTML, outerHTML or document.write is an anti-pattern that can lead to XSS vulnerabilities
🔵 (line 364) [semgrep]: Detected string concatenation with a non-literal variable in a util.format / console.log function. If an attacker injects a format specifier in the string, it will forge the log message. Try to use constant values for the format string.
🔵 (line 514) [semgrep]: Detected string concatenation with a non-literal variable in a util.format / console.log function. If an attacker injects a format specifier in the string, it will forge the log message. Try to use constant values for the format string.
extension/ui/settings.ts
🔴 (line 370) [semgrep]: User controlled data in methods like innerHTML, outerHTML or document.write is an anti-pattern that can lead to XSS vulnerabilities
🔴 (line 372) [semgrep]: User controlled data in methods like innerHTML, outerHTML or document.write is an anti-pattern that can lead to XSS vulnerabilities
🔴 (line 591) [semgrep]: User controlled data in methods like innerHTML, outerHTML or document.write is an anti-pattern that can lead to XSS vulnerabilities
🔴 (line 611) [semgrep]: User controlled data in methods like innerHTML, outerHTML or document.write is an anti-pattern that can lead to XSS vulnerabilities
🔵 (line 540) [semgrep]: Detected string concatenation with a non-literal variable in a util.format / console.log function. If an attacker injects a format specifier in the string, it will forge the log message. Try to use constant values for the format string.
src/ado_git_repo_insights/ui_bundle/dashboard.js
🔴 (line 1621) [semgrep]: User controlled data in methods like innerHTML, outerHTML or document.write is an anti-pattern that can lead to XSS vulnerabilities
🔴 (line 1640) [semgrep]: User controlled data in methods like innerHTML, outerHTML or document.write is an anti-pattern that can lead to XSS vulnerabilities
🔴 (line 1676) [semgrep]: User controlled data in methods like innerHTML, outerHTML or document.write is an anti-pattern that can lead to XSS vulnerabilities
🔴 (line 1988) [semgrep]: User controlled data in methods like innerHTML, outerHTML or document.write is an anti-pattern that can lead to XSS vulnerabilities
🔴 (line 2010) [semgrep]: User controlled data in methods like innerHTML, outerHTML or document.write is an anti-pattern that can lead to XSS vulnerabilities
🔴 (line 2168) [semgrep]: User controlled data in methods like innerHTML, outerHTML or document.write is an anti-pattern that can lead to XSS vulnerabilities
🔴 (line 2213) [semgrep]: User controlled data in methods like innerHTML, outerHTML or document.write is an anti-pattern that can lead to XSS vulnerabilities
🔴 (line 2290) [semgrep]: User controlled data in methods like innerHTML, outerHTML or document.write is an anti-pattern that can lead to XSS vulnerabilities
🔴 (line 2336) [semgrep]: User controlled data in methods like innerHTML, outerHTML or document.write is an anti-pattern that can lead to XSS vulnerabilities
🔴 (line 2349) [semgrep]: User controlled data in methods like innerHTML, outerHTML or document.write is an anti-pattern that can lead to XSS vulnerabilities
🔴 (line 2393) [semgrep]: User controlled data in methods like innerHTML, outerHTML or document.write is an anti-pattern that can lead to XSS vulnerabilities
🔴 (line 2397) [semgrep]: User controlled data in methods like innerHTML, outerHTML or document.write is an anti-pattern that can lead to XSS vulnerabilities
🔴 (line 2425) [semgrep]: User controlled data in methods like innerHTML, outerHTML or document.write is an anti-pattern that can lead to XSS vulnerabilities
🔴 (line 2435) [semgrep]: User controlled data in methods like innerHTML, outerHTML or document.write is an anti-pattern that can lead to XSS vulnerabilities
🔴 (line 2599) [semgrep]: User controlled data in methods like innerHTML, outerHTML or document.write is an anti-pattern that can lead to XSS vulnerabilities
🔵 (line 1056) [semgrep]: Detected string concatenation with a non-literal variable in a util.format / console.log function. If an attacker injects a format specifier in the string, it will forge the log message. Try to use constant values for the format string.
🔵 (line 1083) [semgrep]: Detected string concatenation with a non-literal variable in a util.format / console.log function. If an attacker injects a format specifier in the string, it will forge the log message. Try to use constant values for the format string.
🔵 (line 1400) [semgrep]: Detected string concatenation with a non-literal variable in a util.format / console.log function. If an attacker injects a format specifier in the string, it will forge the log message. Try to use constant values for the format string.
🔵 (line 1515) [semgrep]: Detected string concatenation with a non-literal variable in a util.format / console.log function. If an attacker injects a format specifier in the string, it will forge the log message. Try to use constant values for the format string.
src/ado_git_repo_insights/ui_bundle/settings.js
🔴 (line 261) [semgrep]: User controlled data in methods like innerHTML, outerHTML or document.write is an anti-pattern that can lead to XSS vulnerabilities
🔴 (line 263) [semgrep]: User controlled data in methods like innerHTML, outerHTML or document.write is an anti-pattern that can lead to XSS vulnerabilities
🔴 (line 424) [semgrep]: User controlled data in methods like innerHTML, outerHTML or document.write is an anti-pattern that can lead to XSS vulnerabilities
🔴 (line 439) [semgrep]: User controlled data in methods like innerHTML, outerHTML or document.write is an anti-pattern that can lead to XSS vulnerabilities
🔵 (line 385) [semgrep]: Detected string concatenation with a non-literal variable in a util.format / console.log function. If an attacker injects a format specifier in the string, it will forge the log message. Try to use constant values for the format string.
extension/ui/artifact-client.ts
🔵 (line 372) [semgrep]: Detected string concatenation with a non-literal variable in a util.format / console.log function. If an attacker injects a format specifier in the string, it will forge the log message. Try to use constant values for the format string.
🔵 (line 408) [semgrep]: Detected string concatenation with a non-literal variable in a util.format / console.log function. If an attacker injects a format specifier in the string, it will forge the log message. Try to use constant values for the format string.
src/ado_git_repo_insights/ui_bundle/artifact-client.js
🔵 (line 320) [semgrep]: Detected string concatenation with a non-literal variable in a util.format / console.log function. If an attacker injects a format specifier in the string, it will forge the log message. Try to use constant values for the format string.
🔵 (line 347) [semgrep]: Detected string concatenation with a non-literal variable in a util.format / console.log function. If an attacker injects a format specifier in the string, it will forge the log message. Try to use constant values for the format string.
