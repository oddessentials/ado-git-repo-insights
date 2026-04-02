# Quickstart: 046-migrate-ado-sdk

**Branch**: `046-migrate-ado-sdk` | **Date**: 2026-03-30

## Prerequisites

- Node.js 20+ and pnpm 9.15+
- Python 3.10+ (for backend tests — not changed by this feature)
- Git with hooks enabled (never `--no-verify`)

## Setup

```bash
git checkout 046-migrate-ado-sdk
cd extension
pnpm install        # Installs new SDK packages, removes old
```

After install, verify:
- `node_modules/azure-devops-extension-sdk/` exists
- `node_modules/azure-devops-extension-api/` exists
- `node_modules/vss-web-extension-sdk/` does NOT exist
- `extension/ui/VSS.SDK.min.js` does NOT exist

## Build

```bash
pnpm run build      # tsc + esbuild bundle
```

Verify:
- No TypeScript errors (strict mode)
- `dist/` contains bundled JS files without VSS.SDK.min.js
- No `VSS.SDK.min.js` in build output

## Test

```bash
pnpm test           # Jest full suite
pnpm run build:check       # tsc --noEmit
pnpm run build:check-tests # tsc --noEmit --project tsconfig.test.json
pnpm run lint              # ESLint --max-warnings=0
```

All must pass with zero warnings, zero new suppressions.

## Key Files to Understand

| File | Role | Migration Impact |
|------|------|-----------------|
| `ui/modules/sdk.ts` | SDK abstraction (sole host contact point) | **Rewrite** — absorbs all breaking changes |
| `ui/artifact-client.ts` | Authenticated REST API calls | Token format: `{ token }` → `string` |
| `ui/settings.ts` | Settings page with project listing | AMD `VSS.require` → ESM `getClient(CoreRestClient)` |
| `ui/dashboard.ts` | Dashboard widget | Minimal changes (uses sdk.ts) |
| `tests/harness/vss-sdk-mock.ts` | Test mock for SDK | **Rewrite** — mocks ESM module, not global |
| `tests/sdk-bundling.test.ts` | Build verification tests | **Rewrite** — asserts no old SDK references |
| `tests/auth-pattern.test.ts` | Auth token assertions | Token format assertions updated |

## Debugging Tips

- If `SDK.init()` hangs: check that the extension is loaded inside an Azure DevOps iframe. Local mode should bypass init entirely.
- If `getExtensionDataService()` fails: the two-step pattern requires `getAccessToken()` + `getExtensionContext().id`. Both must succeed.
- If `getClient(CoreRestClient)` fails: `SDK.init()` must have completed first — the host connection must be established.
- If bundle size increases significantly: check that esbuild tree-shaking is working. Only used SDK functions should be included.

## Verification Checklist

- [ ] `pnpm test` — all pass, no new skips
- [ ] `pnpm run build` — clean build, no VSS.SDK.min.js in output
- [ ] `pnpm run lint` — zero warnings
- [ ] `pnpm run build:check` — zero type errors
- [ ] `grep -r "vss-web-extension-sdk" extension/` — zero matches
- [ ] `grep -r "VSS.SDK.min.js" extension/ui/` — zero matches (except in test assertions that verify absence)
