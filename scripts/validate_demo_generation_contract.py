#!/usr/bin/env python3
"""Validate the committed-demo generation contract across scripts and CI."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import yaml
from demo_generation_common import (
    CANONICAL_COMMITTED_DEMO_MODE,
    CANONICAL_COMMITTED_DEMO_SCRIPT,
    COMMITTED_DEMO_BASELINE_PYTHON_MAJOR_MINOR,
)

REPO_ROOT = Path(__file__).resolve().parent.parent
WORKFLOW_PATH = REPO_ROOT / ".github" / "workflows" / "demo.yml"
PREFLIGHT_PATH = REPO_ROOT / "scripts" / "run_pr_preflight.py"
HELPER_SCRIPTS = {
    "scripts/generate-demo-data.py",
    "scripts/generate-demo-predictions.py",
    "scripts/generate-demo-insights.py",
}
CANONICAL_JOB_NAME = "regenerate"


def _load_yaml(path: Path) -> dict[str, Any]:
    content = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(content, dict):
        raise RuntimeError(f"{path} did not parse to a mapping")
    return content


def _step_run_text(step: dict[str, Any]) -> str:
    run_value = step.get("run")
    return run_value if isinstance(run_value, str) else ""


def validate_workflow_contract() -> None:
    workflow = _load_yaml(WORKFLOW_PATH)
    jobs = workflow.get("jobs")
    if not isinstance(jobs, dict):
        raise RuntimeError(f"{WORKFLOW_PATH} is missing jobs")

    job = jobs.get(CANONICAL_JOB_NAME)
    if not isinstance(job, dict):
        raise RuntimeError(
            f"{WORKFLOW_PATH} is missing the canonical '{CANONICAL_JOB_NAME}' job"
        )

    steps = job.get("steps")
    if not isinstance(steps, list):
        raise RuntimeError(
            f"{WORKFLOW_PATH} job '{CANONICAL_JOB_NAME}' is missing steps"
        )

    setup_python_steps = [
        step
        for step in steps
        if isinstance(step, dict)
        and str(step.get("uses", "")).startswith("actions/setup-python@")
    ]
    if not setup_python_steps:
        raise RuntimeError("Canonical demo workflow job must set up Python explicitly")

    baseline_matches = [
        step
        for step in setup_python_steps
        if isinstance(step.get("with"), dict)
        and str(step["with"].get("python-version"))
        == COMMITTED_DEMO_BASELINE_PYTHON_MAJOR_MINOR
    ]
    if not baseline_matches:
        raise RuntimeError(
            "Canonical demo workflow job must use Python "
            f"{COMMITTED_DEMO_BASELINE_PYTHON_MAJOR_MINOR}"
        )

    run_steps = [
        step
        for step in steps
        if isinstance(step, dict) and isinstance(step.get("run"), str)
    ]
    canonical_invocations = [
        step
        for step in run_steps
        if f"python {CANONICAL_COMMITTED_DEMO_SCRIPT}" in _step_run_text(step)
    ]
    if len(canonical_invocations) != 1:
        raise RuntimeError(
            "Canonical demo workflow job must invoke "
            f"`python {CANONICAL_COMMITTED_DEMO_SCRIPT}` exactly once"
        )

    helper_invocations = [
        script
        for script in sorted(HELPER_SCRIPTS)
        if any(f"python {script}" in _step_run_text(step) for step in run_steps)
    ]
    if helper_invocations:
        raise RuntimeError(
            "Canonical demo workflow job must not publish via helper scripts: "
            f"{helper_invocations}"
        )

    all_run_steps = [
        step
        for workflow_job in jobs.values()
        if isinstance(workflow_job, dict)
        for step in workflow_job.get("steps", [])
        if isinstance(step, dict) and isinstance(step.get("run"), str)
    ]
    drift_step = next(
        (
            step
            for step in all_run_steps
            if "Check for differences" in str(step.get("name", ""))
        ),
        None,
    )
    if drift_step is None:
        raise RuntimeError(
            "Canonical demo workflow must include a diff-check step for drift validation"
        )
    drift_text = _step_run_text(drift_step)
    if f"python {CANONICAL_COMMITTED_DEMO_SCRIPT}" not in drift_text:
        raise RuntimeError(
            "Diff remediation text must direct contributors to the canonical "
            f"producer `{CANONICAL_COMMITTED_DEMO_SCRIPT}`"
        )


def validate_preflight_contract() -> None:
    preflight_source = PREFLIGHT_PATH.read_text(encoding="utf-8")
    match = re.search(
        r'^BASELINE_PYTHON\s*=\s*"([^"]+)"', preflight_source, re.MULTILINE
    )
    if match is None:
        raise RuntimeError("run_pr_preflight.py is missing BASELINE_PYTHON")
    baseline_python = match.group(1)
    if baseline_python != COMMITTED_DEMO_BASELINE_PYTHON_MAJOR_MINOR:
        raise RuntimeError(
            "run_pr_preflight.py baseline must match the committed-demo baseline "
            f"({COMMITTED_DEMO_BASELINE_PYTHON_MAJOR_MINOR}), got {baseline_python!r}"
        )


def validate_common_contract() -> None:
    if CANONICAL_COMMITTED_DEMO_MODE != "canonical-committed-demo":
        raise RuntimeError(
            "Canonical generation mode drifted from the approved committed-demo contract"
        )


def main() -> int:
    validate_common_contract()
    validate_preflight_contract()
    validate_workflow_contract()
    print(
        "Committed-demo generation contract is valid: canonical script "
        f"{CANONICAL_COMMITTED_DEMO_SCRIPT} on Python "
        f"{COMMITTED_DEMO_BASELINE_PYTHON_MAJOR_MINOR}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
