# Publication Validation Contract

**Branch**: `037-add-reviewer-demo`

## Purpose

Define the blocking validation behavior for the canonical reviewer-enhanced demo build.

## Blocking Conditions

The canonical demo build must fail before promotion when any of the following are missing or invalid:

- reviewer breakdowns in the canonical rollups
- reviewer fixture metadata in the manifest
- the documented reviewer-constrained walkthrough example
- the documented disallowed reviewer-plus-team example
- minimum reviewer activity expectations
- deterministic publication scope consistency

## Failure Behavior

- The build exits with a failing result.
- Promotion to `docs/data` does not occur.
- The error reason explicitly identifies the missing reviewer coverage artifact or validation contract that failed.

## Deterministic Publication Scope

Validation and regeneration comparison must cover the canonical published demo surface:

- dataset payload files under the canonical data root
- `dataset-manifest.json`
- generated validation reports required for demo governance
- generated metadata files required to describe the canonical demo profile

## Success Behavior

The build is publishable only when:

- reviewer fixture metadata is present and valid
- reviewer capability checks pass
- the canonical artifact output is internally consistent
- docs promotion remains a clean byte-identical mirror of canonical generated output
