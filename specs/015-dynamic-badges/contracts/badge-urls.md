# Badge URL Contract

**Feature**: 015-dynamic-badges
**Date**: 2026-01-29

## Canonical JSON URL

```
https://raw.githubusercontent.com/oddessentials/ado-git-repo-insights/badges/status.json
```

This URL MUST:
- Return HTTP 200 with valid JSON
- Contain valid JSON matching the schema in `data-model.md`
- Be updated within 5 minutes of CI completion on main
- NOT use GitHub Pages (raw.githubusercontent.com only)

## Badge URLs

### Python Coverage

```markdown
![Python Coverage](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Foddessentials%2Fado-git-repo-insights%2Fbadges%2Fstatus.json&query=%24.python.coverage&label=Python%20Coverage&suffix=%25&color=brightgreen)
```

**Rendered**: `Python Coverage | 89.2%`

### TypeScript Coverage

```markdown
![TypeScript Coverage](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Foddessentials%2Fado-git-repo-insights%2Fbadges%2Fstatus.json&query=%24.typescript.coverage&label=TypeScript%20Coverage&suffix=%25&color=brightgreen)
```

**Rendered**: `TypeScript Coverage | 74.5%`

### Python Tests

```markdown
![Python Tests](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Foddessentials%2Fado-git-repo-insights%2Fbadges%2Fstatus.json&query=%24.python.tests.display&label=Python%20Tests&color=blue)
```

**Rendered**: `Python Tests | 312 passed`

### TypeScript Tests

```markdown
![TypeScript Tests](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Foddessentials%2Fado-git-repo-insights%2Fbadges%2Fstatus.json&query=%24.typescript.tests.display&label=TypeScript%20Tests&color=blue)
```

**Rendered**: `TypeScript Tests | 637 passed, 5 skipped`

## URL Components

| Component | Value | Purpose |
|-----------|-------|---------|
| `url` | URL-encoded raw GitHub URL | Points to published status.json on `badges` branch |
| `query` | JSONPath expression | Extracts specific field |
| `label` | Badge left-side text | Distinguishes badge type |
| `suffix` | `%` for coverage | Appends to value |
| `color` | `brightgreen`, `blue` | Badge color |

## README Integration

Replace existing badges in `README.md`:

```markdown
<!-- CI & Quality -->

[![AI Review](https://github.com/oddessentials/ado-git-repo-insights/actions/workflows/ai-review.yml/badge.svg)](...)
![CI](https://github.com/oddessentials/ado-git-repo-insights/actions/workflows/ci.yml/badge.svg)
[![Release](https://github.com/oddessentials/ado-git-repo-insights/actions/workflows/release.yml/badge.svg)](...)
![Python Coverage](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Foddessentials%2Fado-git-repo-insights%2Fbadges%2Fstatus.json&query=%24.python.coverage&label=Python%20Coverage&suffix=%25&color=brightgreen)
![TypeScript Coverage](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Foddessentials%2Fado-git-repo-insights%2Fbadges%2Fstatus.json&query=%24.typescript.coverage&label=TypeScript%20Coverage&suffix=%25&color=brightgreen)
![Python Tests](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Foddessentials%2Fado-git-repo-insights%2Fbadges%2Fstatus.json&query=%24.python.tests.display&label=Python%20Tests&color=blue)
![TypeScript Tests](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Foddessentials%2Fado-git-repo-insights%2Fbadges%2Fstatus.json&query=%24.typescript.tests.display&label=TypeScript%20Tests&color=blue)
```

## Verification

CI MUST verify after publish:

```bash
BADGE_URL="https://raw.githubusercontent.com/oddessentials/ado-git-repo-insights/badges/status.json"
echo "Verifying badge JSON at: $BADGE_URL"

# Wait for GitHub raw content propagation (up to 60s)
for i in {1..12}; do
  if curl -sf "$BADGE_URL" | jq -e '.python.coverage' > /dev/null; then
    echo "[OK] Badge JSON accessible and valid"
    exit 0
  fi
  echo "Waiting for raw content propagation... ($i/12)"
  sleep 5
done

echo "::error::Badge JSON not accessible after 60s"
exit 1
```

## Branch Isolation

The `badges` branch:
- Is a dedicated orphan branch containing ONLY `status.json`
- Does NOT contain any code, docs, or other files
- Does NOT affect `main`, `gh-pages`, or `/docs`
- Is created automatically by CI on first publish
