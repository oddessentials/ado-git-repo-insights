"""Defensive parser for CI YAML ``run:`` blocks used by check_ratchet_bump.

Extracted so check_ratchet_bump.py can navigate ``.github/workflows/ci.yml``
without naive regex on the raw YAML (multiline/indented commands would be
missed) and without ``AttributeError`` on missing keys (loud setup error
with context is required instead).

Contract:
    - ``extract_shell_commands`` folds backslash-continuation lines and
      normalizes whitespace before surfacing any ``python``/``pnpm``/``mypy``
      commands, matching the helper in tests/unit/test_ci_parity_drift.py
      so gate and parity-test stay consistent.
    - ``extract_flag_value`` searches a folded command string for
      ``<flag_name>=N`` and returns ``N`` as an int, raising CiYamlParseError
      if absent or non-numeric.
    - ``load_ci_run_block`` walks ``jobs[job_name].steps[name=step_name].run``
      with explicit type checks on every intermediate, raising
      CiYamlParseError with the file path, job name, step name, and what
      was expected vs. found on any mismatch.
"""

from __future__ import annotations

import re
from pathlib import Path

import yaml

__all__ = [
    "CiYamlParseError",
    "extract_shell_commands",
    "extract_flag_value",
    "load_ci_run_block",
]


class CiYamlParseError(RuntimeError):
    """Raised when CI YAML navigation or parsing fails with context.

    The ratchet-bump gate distinguishes setup errors (exit 2) from drift
    failures (exit 1). Every navigation path in this module raises
    CiYamlParseError so that the gate can catch it and map to exit 2
    while preserving the file/job/step/expected/got diagnostic.
    """


_SUPPORTED_COMMAND_PREFIXES: tuple[str, ...] = ("python ", "pnpm ", "mypy ")


def extract_shell_commands(run_block: str) -> list[str]:
    """Fold a YAML ``run:`` block into normalized command strings.

    Blank lines and ``#``-prefixed comment lines are dropped. A trailing
    backslash concatenates the current line with the next one (shell
    line continuation). After folding, whitespace is collapsed to single
    spaces and the command is surfaced only if it begins with one of
    ``python``/``pnpm``/``mypy`` — matching the existing test_ci_parity_drift
    helper so downstream assertions stay aligned.
    """
    commands: list[str] = []
    current = ""
    for raw_line in run_block.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        current = f"{current} {line}" if current else line
        if current.endswith("\\"):
            current = current[:-1].rstrip()
            continue
        normalized = " ".join(current.split())
        if normalized.startswith(_SUPPORTED_COMMAND_PREFIXES):
            commands.append(normalized)
        current = ""
    if current:
        normalized = " ".join(current.split())
        if normalized.startswith(_SUPPORTED_COMMAND_PREFIXES):
            commands.append(normalized)
    return commands


def extract_flag_value(command_text: str, flag_name: str) -> int:
    """Find ``<flag_name>=N`` in a folded command string; return N as int.

    Deliberately operates on already-folded text to avoid missing tokens
    split across backslash-continuation lines — callers should always
    pass the output of :func:`extract_shell_commands` (or an equivalent
    folded string), never the raw multiline ``run`` block.
    """
    pattern = re.compile(re.escape(flag_name) + r"=(\d+)")
    match = pattern.search(command_text)
    if match is None:
        raise CiYamlParseError(
            f"No {flag_name}=N token found. Inspected command text: {command_text!r}"
        )
    return int(match.group(1))


def _fail_navigate(message: str) -> CiYamlParseError:
    return CiYamlParseError(message)


def load_ci_run_block(ci_yaml_path: Path, job_name: str, step_name: str) -> str:
    """Return the ``run`` scalar for a specific (job, step) in a workflow.

    Every navigation step is type-checked; any missing or malformed node
    raises CiYamlParseError with the full context (file, job, step,
    available keys). The goal is to make setup errors distinguishable
    from real drift failures in the ratchet-bump gate.
    """
    try:
        raw = ci_yaml_path.read_text(encoding="utf-8")
    except FileNotFoundError as exc:
        raise _fail_navigate(f"CI workflow not found: {ci_yaml_path}") from exc
    except OSError as exc:
        raise _fail_navigate(
            f"{ci_yaml_path}: could not read workflow file: {exc}"
        ) from exc

    try:
        parsed: object = yaml.safe_load(raw)
    except yaml.YAMLError as exc:
        raise _fail_navigate(f"{ci_yaml_path}: YAML parse error: {exc}") from exc

    if not isinstance(parsed, dict):
        raise _fail_navigate(
            f"{ci_yaml_path}: top-level YAML is not a mapping "
            f"(got: {type(parsed).__name__})"
        )

    jobs_obj: object = parsed.get("jobs")
    if not isinstance(jobs_obj, dict):
        raise _fail_navigate(
            f"{ci_yaml_path}: missing or malformed 'jobs' section "
            f"(got: {type(jobs_obj).__name__})"
        )

    available_jobs = sorted(k for k in jobs_obj if isinstance(k, str))
    job_obj: object = jobs_obj.get(job_name)
    if not isinstance(job_obj, dict):
        raise _fail_navigate(
            f"{ci_yaml_path}: job '{job_name}' missing or not a mapping "
            f"(available jobs: {available_jobs})"
        )

    steps_obj: object = job_obj.get("steps")
    if not isinstance(steps_obj, list):
        raise _fail_navigate(
            f"{ci_yaml_path}: job '{job_name}' has missing or non-list "
            f"'steps' (got: {type(steps_obj).__name__})"
        )

    available_steps: list[str] = []
    for raw_step in steps_obj:
        if not isinstance(raw_step, dict):
            continue
        raw_name: object = raw_step.get("name")
        if isinstance(raw_name, str):
            available_steps.append(raw_name)
        if raw_name != step_name:
            continue
        run_obj: object = raw_step.get("run")
        if not isinstance(run_obj, str):
            raise _fail_navigate(
                f"{ci_yaml_path}: job '{job_name}' step '{step_name}' "
                f"has missing or non-string 'run' value "
                f"(got: {type(run_obj).__name__})"
            )
        return run_obj

    raise _fail_navigate(
        f"{ci_yaml_path}: job '{job_name}' has no step named '{step_name}' "
        f"(available steps: {available_steps})"
    )
