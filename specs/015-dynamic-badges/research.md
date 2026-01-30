# Research: Dynamic CI Badges

**Feature**: 015-dynamic-badges
**Date**: 2026-01-29

## 1. GitHub Pages Deployment from CI

### Decision
Use `peaceiris/actions-gh-pages@v4` to publish to `gh-pages` branch using GITHUB_TOKEN.

### Rationale
- Official GitHub-recommended action for Pages deployment
- Works with GITHUB_TOKEN (no PAT required)
- Handles orphan branch creation automatically
- Supports partial updates (only changed files)

### Alternatives Considered
| Alternative | Rejected Because |
|-------------|------------------|
| Manual git push to gh-pages | Requires complex branch switching, force push handling |
| GitHub Pages Deploy API | Requires additional permissions, more complex |
| JamesIves/github-pages-deploy-action | Less maintained than peaceiris |

### Implementation Pattern
```yaml
- name: Deploy to GitHub Pages
  uses: peaceiris/actions-gh-pages@v4
  with:
    github_token: ${{ secrets.GITHUB_TOKEN }}
    publish_dir: ./badges
    destination_dir: badges
    keep_files: true
```

---

## 2. Shields.io Dynamic JSON Badge Format

### Decision
Use Shields.io dynamic JSON badge endpoint with explicit labels.

### URL Pattern
```
https://img.shields.io/badge/dynamic/json
  ?url=<encoded-json-url>
  &query=<jsonpath>
  &label=<badge-label>
  &suffix=<optional-suffix>
  &color=<color>
```

### Badge Specifications

| Badge | Query | Label | Suffix | Color |
|-------|-------|-------|--------|-------|
| Python Coverage | `$.python.coverage` | `Python Coverage` | `%` | `brightgreen` (≥80), `yellow` (≥60), `red` (<60) |
| TypeScript Coverage | `$.typescript.coverage` | `TypeScript Coverage` | `%` | Same thresholds |
| Python Tests | `$.python.tests.display` | `Python Tests` | (none) | `blue` |
| TypeScript Tests | `$.typescript.tests.display` | `TypeScript Tests` | (none) | `blue` |

### Example URLs
```markdown
![Python Coverage](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Foddessentials.github.io%2Fado-git-repo-insights%2Fbadges%2Fstatus.json&query=%24.python.coverage&label=Python%20Coverage&suffix=%25&color=brightgreen)
```

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
python .github/scripts/generate-badge-json.py > badges/status.json
python .github/scripts/generate-badge-json.py > /tmp/status-verify.json

if ! diff -q badges/status.json /tmp/status-verify.json; then
  echo "::error::Determinism check failed - JSON output differs between runs"
  diff badges/status.json /tmp/status-verify.json
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
    # Publish to gh-pages
    # Curl verify
```

---

## Summary

All research questions resolved. No NEEDS CLARIFICATION markers remain.

| Topic | Decision |
|-------|----------|
| Pages deployment | `peaceiris/actions-gh-pages@v4` with GITHUB_TOKEN |
| Badge format | Shields.io dynamic JSON with explicit labels |
| Python coverage | Parse `coverage.xml` `line-rate` attribute |
| TypeScript coverage | Parse `lcov.info` LF/LH values |
| Test counts | Parse JUnit XML totals, compute passed |
| Determinism | Generate twice, diff, fail on difference |
| CI trigger | `push` to `main` only, after test jobs |
