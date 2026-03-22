# Demo Data Versioning Policy

**Version**: 2.0
**Last Updated**: 2026-03-21

## Overview

The public demo is a governed product surface, not a hand-maintained fixture.

There is one canonical enterprise demo artifact root:

`artifacts/demo-enterprise/`

The published GitHub Pages dataset at `docs/data/` is a promoted mirror of:

`artifacts/demo-enterprise/data/`

The published GitHub Pages shell at `docs/index.html` is a generated mirror of:

`extension/ui/index.html` transformed by `scripts/demo_shell.py`

The published JS/CSS assets under `docs/` are copied from:

`extension/dist/ui/`

The only supported full refresh path is:

```bash
./scripts/build-demo.sh
```

The data-only refresh path is:

```bash
python scripts/build-demo-dataset.py
```

`docs/data/` and `docs/index.html` are generated-only and MUST NOT be hand-edited.

## Local Manual Preview

For local manual testing of the published synthetic demo dashboard in PowerShell:

```powershell
cd extension
pnpm install
pnpm run build:ui

cd ..
python scripts/publish-demo-surface.py --source extension/dist/ui --docs-dir docs
python scripts/build-demo-dataset.py

cd docs
python -m http.server 8080
```

Open `http://localhost:8080`.

For repeat runs after dependencies are already installed:

```powershell
cd extension
pnpm run build:ui

cd ..
python scripts/publish-demo-surface.py --source extension/dist/ui --docs-dir docs
python scripts/build-demo-dataset.py

cd docs
python -m http.server 8080
```

## Canonical Artifact Boundary

The canonical output layout is:

```text
artifacts/demo-enterprise/
├── data/
├── metadata/
└── report/
```

Promotion rules:

1. Build `extension/dist/ui/`
2. Publish `docs/index.html` and static assets from the built UI surface
3. Generate into `artifacts/demo-enterprise/`
4. Validate capability and startup parity reports
5. Promote `artifacts/demo-enterprise/data/` into `docs/data/`
6. Remove stale files and directories from `docs/data/`
7. Fail if the published shell or promoted mirror differs from the canonical source

## Version Sources Of Truth

The enterprise demo profile version MUST be consistent in all of these locations:

1. `scripts/generate-demo-data.py`
2. `dataset-manifest.json` under `demo_profile.version`
3. `artifacts/demo-enterprise/metadata/demo-profile.json`
4. this document

## Version Semantics

The enterprise demo profile is versioned independently from schema versions.

### Patch

Use a PATCH bump for deterministic refreshes that do not change expected user-visible walkthrough behavior.

Examples:

- regenerated data with identical feature coverage
- internal implementation cleanup with identical emitted bytes
- report wording cleanup outside the dataset surface

### Minor

Use a MINOR bump for backward-compatible demo expansions.

Examples:

- additive capability coverage
- richer but compatible enterprise scenarios
- increased scale with unchanged behavior contracts
- new manifest metadata that existing consumers safely ignore

### Major

Use a MAJOR bump for any demo behavior change that affects expected walkthrough results or publication semantics.

Examples:

- changing canonical output or promotion paths
- changing startup defaults
- removing capability coverage
- changing user-visible reviewer, author, comments, or truncation behavior
- changing schema semantics or breaking field compatibility

## Schema Version Rules

Schema versioning in `dataset-manifest.json` remains the compatibility boundary for consumers:

```json
{
  "manifest_schema_version": 1,
  "dataset_schema_version": 1,
  "aggregates_schema_version": 2,
  "predictions_schema_version": 1,
  "insights_schema_version": 1
}
```

Rules:

- add optional fields: no schema bump required
- remove fields: schema bump required
- change field types: schema bump required
- change enum semantics: schema bump required
- change canonical demo behavior without schema break: demo profile version bump still required

## Published File Contract

Every published demo file MUST be manifest-addressable through one of:

1. `aggregate_index[*].path`
2. `published_files.direct`
3. `published_files.globs`

This prevents stale or undocumented files from surviving promotion.

## Determinism Guarantee

The enterprise demo profile is deterministic:

- fixed seed: `42`
- fixed profile name: `enterprise-demo`
- fixed canonical output root: `artifacts/demo-enterprise/`
- repeated regeneration must produce byte-identical canonical artifacts

Any user-visible difference requires an intentional version decision and checked-in review.

## Maintainer Workflow

When changing demo generation:

1. Update the generator and, if needed, the manifest schema/types
2. Decide whether the enterprise demo profile version must bump
3. Run `./scripts/build-demo.sh`
4. Review `artifacts/demo-enterprise/report/capability-matrix.json`
5. Review `artifacts/demo-enterprise/report/startup-parity.json`
6. Verify `docs/index.html` and `docs/data/` match the canonical publish flow
7. Update this document if version semantics or publication rules changed

## Version History

### Version 2.0 (2026-03-21)

- locked canonical artifact root to `artifacts/demo-enterprise/`
- made `docs/index.html` a generated mirror of the extension UI shell
- made `docs/data/` a promoted mirror instead of a hand-maintained fixture
- required manifest-addressable publication for all demo files
- formalized demo profile version bump rules

### Version 1.0 (2026-01-31)

- initial demo data versioning baseline
