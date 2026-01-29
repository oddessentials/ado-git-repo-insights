# Research: Complete Root pnpm Migration

**Branch**: `014-root-pnpm-migration` | **Date**: 2026-01-29

## Research Questions

### RQ-1: Can semantic-release work with pnpm?

**Decision**: Yes, semantic-release works with pnpm out of the box.

**Rationale**: Semantic-release uses npm/pnpm/yarn as the package manager based on the lockfile present. When `pnpm-lock.yaml` exists, it uses pnpm. The `cycjimmy/semantic-release-action` respects the package manager configuration.

**Alternatives Considered**:
- Continue using npm for release only → Rejected: creates lockfile inconsistency
- Use semantic-release's npm plugin explicitly → Unnecessary: automatic detection works

### RQ-2: How to block npm usage at the package level?

**Decision**: Use a preinstall script that checks `npm_config_user_agent`.

**Rationale**: The `npm_config_user_agent` environment variable contains the package manager name and version (e.g., `npm/10.2.0` or `pnpm/9.15.0`). A preinstall script can check this and exit with an error if npm is detected.

**Alternatives Considered**:
- `engine-strict=true` in `.npmrc` with `engines.pnpm` → Only works if npm respects it (inconsistent)
- `only-allow` script from `which-pm-runs` package → Adds a dependency; preinstall is zero-dep

**Implementation**:
```json
"preinstall": "node -e \"if(process.env.npm_config_user_agent && process.env.npm_config_user_agent.includes('npm/')) { console.error('Error: Use pnpm, not npm'); process.exit(1); }\""
```

### RQ-3: How does the setup-pnpm action work?

**Decision**: Use existing `.github/actions/setup-pnpm` composite action.

**Rationale**: The repository already has a working composite action that:
1. Uses `pnpm/action-setup@v4` (reads version from `packageManager` field)
2. Sets up Node.js with pnpm caching
3. Enables corepack

**Evidence**: `.github/actions/setup-pnpm/action.yml` exists and is used by extension builds.

### RQ-4: How to detect package-lock.json anywhere in workspace?

**Decision**: Use `find` command with node_modules exclusion.

**Rationale**: The `find` command can recursively search the entire workspace and exclude `node_modules` directories (which legitimately contain lockfiles from dependencies).

**Implementation**:
```bash
find . -name "package-lock.json" -not -path "./node_modules/*"
```

### RQ-5: How to allowlist tfx-cli in npm grep check?

**Decision**: Pipe grep output through a second grep to exclude allowlisted patterns.

**Rationale**: The tfx-cli global install (`npm install -g tfx-cli`) is necessary because tfx-cli is not available via pnpm's global install mechanism in the same way. Global installs don't affect project lockfiles.

**Implementation**:
```bash
git grep -n "npm ci\|npm install" .github/workflows/ | grep -v "npm install -g tfx-cli"
```

## Findings Summary

| Question | Decision | Confidence |
|----------|----------|------------|
| RQ-1: semantic-release + pnpm | Works automatically | High |
| RQ-2: Block npm | preinstall script | High |
| RQ-3: setup-pnpm action | Use existing action | High |
| RQ-4: Detect lockfiles | find with exclusions | High |
| RQ-5: Allowlist tfx-cli | grep -v exclusion | High |

## No NEEDS CLARIFICATION Remaining

All technical questions resolved. Ready for implementation.
