# Research: Dynamic CI Badges

**Feature**: 015-dynamic-badges
**Date**: 2026-01-29

## 1. Publishing to Dedicated Branch from CI

### Decision
Use `stefanzweifel/git-auto-commit-action` or direct git push to publish to `badges` branch using GITHUB_TOKEN.

### Rationale
- GitHub Pages is reserved for `/docs` (future dashboard demo)
- Raw GitHub URLs work for public repos without Pages
- Dedicated branch keeps badge data isolated from code
- GITHUB_TOKEN can push to any branch in the repo

### Alternatives Considered
| Alternative | Rejected Because |
|-------------|------------------|
| GitHub Pages (`gh-pages`) | Reserved for future dashboard demo |
| Publish to `/docs` | Would mix badge data with documentation |
| Publish to `main` branch | Would pollute commit history |
| Use separate repo | Overcomplicated, breaks monorepo pattern |

### Implementation Pattern
```yaml
- name: Publish to badges branch
  run: |
    git config user.name "github-actions[bot]"
    git config user.email "github-actions[bot]@users.noreply.github.com"

    # Fetch badges branch or create orphan if doesn't exist
    git fetch origin badges:badges 2>/dev/null || git checkout --orphan badges
    git checkout badges

    # Replace status.json
    cp /tmp/status.json status.json
    git add status.json
    git commit -m "chore: update badge data [skip ci]" || echo "No changes to commit"
    git push origin badges
```

---

## 2. Shields.io Dynamic JSON Badge Format (Raw GitHub URL)

### Decision
Use Shields.io dynamic JSON badge endpoint with raw GitHub URL.

### URL Pattern
```
https://img.shields.io/badge/dynamic/json
  ?url=<encoded-raw-github-url>
  &query=<jsonpath>
  &label=<badge-label>
  &suffix=<optional-suffix>
  &color=<color>
```

### Raw GitHub URL Format
```
https://raw.githubusercontent.com/<org>/<repo>/<branch>/<file>
```

For this project:
```
https://raw.githubusercontent.com/oddessentials/ado-git-repo-insights/badges/status.json
```

### Badge Specifications

| Badge | Query | Label | Suffix | Color |
|-------|-------|-------|--------|-------|
| Python Coverage | `$.python.coverage` | `Python Coverage` | `%` | `brightgreen` (≥80), `yellow` (≥60), `red` (<60) |
| TypeScript Coverage | `$.typescript.coverage` | `TypeScript Coverage` | `%` | Same thresholds |
| Python Tests | `$.python.tests.display` | `Python Tests` | (none) | `blue` |
| TypeScript Tests | `$.typescript.tests.display` | `TypeScript Tests` | (none) | `blue` |

---

## 3. Coverage XML Parsing (Python)

### Decision
Parse `coverage.xml` (Cobertura format) for `line-rate` attribute on root `<coverage>` element.

### Rationale
- pytest-cov generates Cobertura XML by default
- `line-rate` is a decimal (0.0-1.0), multiply by 100 for percentage
- Root element attribute, no XPath complexity needed

### Extraction Pattern
```python
import xml.etree.ElementTree as ET

tree = ET.parse('coverage.xml')
root = tree.getroot()
line_rate = float(root.get('line-rate', 0))
coverage_pct = round(line_rate * 100, 1)
```

### Sample coverage.xml Structure
```xml
<?xml version="1.0" ?>
<coverage version="7.4.0" timestamp="1706500000000" lines-valid="5000" lines-covered="4500" line-rate="0.9" branch-rate="0.85" complexity="0">
  <packages>...</packages>
</coverage>
```

---

## 4. LCOV Parsing (TypeScript)

### Decision
Parse `lcov.info` for LF (lines found) and LH (lines hit) summary values.

### Rationale
- Jest generates lcov.info via `--coverage`
- LF/LH are cumulative totals at end of file
- Simple text parsing, no XML needed

### Extraction Pattern
```python
def parse_lcov(path: str) -> float:
    lines_found = 0
    lines_hit = 0
    with open(path) as f:
        for line in f:
            if line.startswith('LF:'):
                lines_found += int(line.split(':')[1])
            elif line.startswith('LH:'):
                lines_hit += int(line.split(':')[1])
    if lines_found == 0:
        return 0.0
    return round((lines_hit / lines_found) * 100, 1)
```

### Sample lcov.info Structure
```
TN:
SF:/path/to/file.ts
FN:1,functionName
FNDA:5,functionName
FNF:1
FNH:1
DA:1,5
DA:2,5
LF:10
LH:8
end_of_record
```

---

## 5. JUnit XML Parsing

### Decision
Parse JUnit XML for `tests`, `failures`, `errors`, `skipped` attributes on `<testsuite>` or `<testsuites>` root element.

### Rationale
- Both pytest and Jest generate JUnit XML
- Root element contains totals
- `passed = tests - failures - errors - skipped`

### Extraction Pattern
```python
import xml.etree.ElementTree as ET

def parse_junit(path: str) -> dict:
    tree = ET.parse(path)
    root = tree.getroot()

    # Handle both <testsuites> (wrapper) and <testsuite> (direct)
    if root.tag == 'testsuites':
        # Sum across all testsuites
        tests = sum(int(ts.get('tests', 0)) for ts in root.findall('testsuite'))
        failures = sum(int(ts.get('failures', 0)) for ts in root.findall('testsuite'))
        errors = sum(int(ts.get('errors', 0)) for ts in root.findall('testsuite'))
        skipped = sum(int(ts.get('skipped', 0)) for ts in root.findall('testsuite'))
    else:
        tests = int(root.get('tests', 0))
        failures = int(root.get('failures', 0))
        errors = int(root.get('errors', 0))
        skipped = int(root.get('skipped', 0))

    passed = tests - failures - errors - skipped
    return {
        'passed': passed,
        'skipped': skipped,
        'total': tests,
        'display': f"{passed} passed" if skipped == 0 else f"{passed} passed, {skipped} skipped"
    }
```

### Sample JUnit XML Structure (pytest)
```xml
<?xml version="1.0" encoding="utf-8"?>
<testsuites>
  <testsuite name="pytest" errors="0" failures="0" skipped="0" tests="312" time="45.123">
    <testcase classname="tests.unit.test_foo" name="test_bar" time="0.001"/>
  </testsuite>
</testsuites>
```

---

## 6. Determinism Verification

### Decision
Generate JSON twice in same CI run, diff output, fail if non-empty.

### Implementation Pattern
```bash
python .github/scripts/generate-badge-json.py > /tmp/status.json
python .github/scripts/generate-badge-json.py > /tmp/status-verify.json

if ! diff -q /tmp/status.json /tmp/status-verify.json; then
  echo "::error::Determinism check failed - JSON output differs between runs"
  diff /tmp/status.json /tmp/status-verify.json
  exit 1
fi
```

### JSON Key Ordering
Use `json.dumps(..., sort_keys=True)` to ensure stable key order.

---

## 7. CI Job Dependencies

### Decision
Badge publish job runs only on `push` to `main`, after `test` and `extension-tests` jobs succeed.

### Workflow Pattern
```yaml
badge-publish:
  runs-on: ubuntu-latest
  if: github.event_name == 'push' && github.ref == 'refs/heads/main'
  needs: [test, extension-tests]
  steps:
    # Download artifacts from test jobs
    # Generate badge JSON
    # Verify determinism
    # Publish to badges branch
    # Curl verify raw GitHub URL
```

---

## Summary

All research questions resolved. No NEEDS CLARIFICATION markers remain.

| Topic | Decision |
|-------|----------|
| Publish destination | Dedicated `badges` branch (NOT `gh-pages` or `/docs`) |
| Badge URL source | Raw GitHub URL (`raw.githubusercontent.com`) |
| Python coverage | Parse `coverage.xml` `line-rate` attribute |
| TypeScript coverage | Parse `lcov.info` LF/LH values |
| Test counts | Parse JUnit XML totals, compute passed |
| Determinism | Generate twice, diff, fail on difference |
| CI trigger | `push` to `main` only, after test jobs |
