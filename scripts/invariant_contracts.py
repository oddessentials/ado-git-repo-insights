#!/usr/bin/env python3
"""Committed manifests for invariant artifacts and reviewed TS gate surfaces."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class InvariantArtifactContract:
    """Explicit authoritative input manifest for one committed invariant artifact."""

    contract_id: str
    artifact_path: str
    input_pathspecs: tuple[str, ...]
    hook_stages: tuple[str, ...]
    snapshot_mode: str
    verification_kind: str
    description: str


@dataclass(frozen=True)
class TypeScriptGateReview:
    """Reviewed disposition for a TypeScript parity surface."""

    gate_name: str
    authoritative_runner: str
    disposition: str
    reason: str


INVARIANT_ARTIFACT_CONTRACTS: tuple[InvariantArtifactContract, ...] = (
    InvariantArtifactContract(
        contract_id="rule-disable-s603",
        artifact_path=".rule-disable-audit-S603.json",
        input_pathspecs=("*.py",),
        hook_stages=("pre-commit", "pre-push"),
        snapshot_mode="index-filesystem",
        verification_kind="rule-disable-s603",
        description="Semantic subprocess call-site proof artifact for globally disabled S603/S607.",
    ),
    InvariantArtifactContract(
        contract_id="rule-disable-s311",
        artifact_path=".rule-disable-audit-S311.json",
        input_pathspecs=("*.py",),
        hook_stages=("pre-commit", "pre-push"),
        snapshot_mode="index-filesystem",
        verification_kind="rule-disable-s311",
        description="Semantic random-usage proof artifact for globally disabled S311.",
    ),
    InvariantArtifactContract(
        contract_id="test-floor-contract",
        artifact_path=".test-floor-contract.json",
        input_pathspecs=(
            "tests/",
            "scripts/check_ratchet_bump.py",
            "scripts/_pytest_count_collector.py",
            "scripts/_platform_test_filters.py",
            "extension/tests/",
            "extension/jest.config.ts",
            "extension/package.json",
        ),
        hook_stages=("pre-push",),
        snapshot_mode="clean-worktree",
        verification_kind="test-floor-contract",
        description="Committed min-collected floor contract for Python and Extension test gates.",
    ),
)


TYPESCRIPT_GATE_REVIEWS: tuple[TypeScriptGateReview, ...] = (
    TypeScriptGateReview(
        gate_name="Extension build check",
        authoritative_runner="pnpm run build:check",
        disposition="environment-insensitive-by-construction",
        reason="TypeScript compiler input scope is fixed by tsconfig.json and runs on the canonical ubuntu-latest extension job only.",
    ),
    TypeScriptGateReview(
        gate_name="Extension test type check",
        authoritative_runner="pnpm run build:check-tests",
        disposition="environment-insensitive-by-construction",
        reason="Compilation scope is fixed by tsconfig.test.json and guarded structurally by trigger/parity tests.",
    ),
    TypeScriptGateReview(
        gate_name="Extension test config parity",
        authoritative_runner="pnpm run test:config-parity",
        disposition="environment-insensitive-by-construction",
        reason="Parity script compares resolved tsconfig state inside the single canonical ubuntu-latest extension job.",
    ),
    TypeScriptGateReview(
        gate_name="Extension lint",
        authoritative_runner="pnpm run lint",
        disposition="environment-insensitive-by-construction",
        reason="ESLint target scope is path-fixed and already parity-locked between preflight and CI.",
    ),
    TypeScriptGateReview(
        gate_name="Extension test lint",
        authoritative_runner="pnpm run lint:tests",
        disposition="environment-insensitive-by-construction",
        reason="ESLint test target scope is path-fixed and already parity-locked between preflight and CI.",
    ),
    TypeScriptGateReview(
        gate_name="Extension format check",
        authoritative_runner="pnpm run format:check",
        disposition="environment-insensitive-by-construction",
        reason="Prettier scope is path-fixed and already parity-locked between preflight and CI.",
    ),
    TypeScriptGateReview(
        gate_name="Extension test count validation",
        authoritative_runner="pnpm run test:coverage -> extension/test-results.xml -> validate-test-results.py",
        disposition="single-platform-canonical",
        reason="Jest collected-count contract runs only on ubuntu-latest; there is no second OS authority today to compare against.",
    ),
    TypeScriptGateReview(
        gate_name="Partial-branch ratchet",
        authoritative_runner="pnpm --dir extension run test:partial-branches",
        disposition="single-platform-canonical",
        reason="LCOV baseline gate runs only on the canonical ubuntu-latest extension job and consumes a single-platform coverage artifact.",
    ),
    TypeScriptGateReview(
        gate_name="Extension smoke tests",
        authoritative_runner="pnpm run test:smoke",
        disposition="not-an-artifacted-invariant",
        reason="Browser smoke tests are pass/fail behavioral checks, not a stable collection-scope artifact contract.",
    ),
    TypeScriptGateReview(
        gate_name="Extension VSIX package",
        authoritative_runner="pnpm run package:vsix",
        disposition="not-an-artifacted-invariant",
        reason="Build+stage+tfx packaging step that produces the VSIX consumed by the inspection gate; not an environment-sensitive artifact contract.",
    ),
    TypeScriptGateReview(
        gate_name="Extension VSIX artifact inspection",
        authoritative_runner="pnpm run test:vsix",
        disposition="not-an-artifacted-invariant",
        reason="VSIX inspection validates packaged output behavior, not an environment-sensitive execution-scope artifact.",
    ),
)
