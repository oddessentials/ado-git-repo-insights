#!/usr/bin/env python3
"""Coverage delta guard — catches coverage drops before CI.

Compares current coverage against a checked-in baseline and fails if
any metric drops beyond the configured threshold. This is the local
parity equivalent of Codecov's project status check (target: auto,
threshold: 2%).

The baseline is stored in .coverage-baseline.json and updated via
the --update flag when coverage genuinely improves.

Usage:
    python scripts/check_coverage_delta.py                  # Check
    python scripts/check_coverage_delta.py --update         # Update baseline
    python scripts/check_coverage_delta.py --threshold 3.0  # Custom threshold
"""

from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from pathlib import Path

from defusedxml.ElementTree import parse as parse_xml

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_BASELINE = REPO_ROOT / ".coverage-baseline.json"
DEFAULT_PYTHON_COVERAGE = REPO_ROOT / "coverage.xml"
DEFAULT_TS_COVERAGE = REPO_ROOT / "extension" / "coverage" / "lcov.info"
DEFAULT_TS_SUMMARY = REPO_ROOT / "extension" / "coverage" / "coverage-summary.json"

BASELINE_VERSION = 1
DEFAULT_THRESHOLD = 2.0


def parse_coverage_xml(path: Path) -> float:
    """Extract line coverage percentage from Cobertura XML.

    Returns coverage as a float (0.0-100.0), rounded to 2 decimals.
    """
    tree = parse_xml(path)
    root = tree.getroot()
    line_rate = root.get("line-rate")
    if line_rate is None:
        raise ValueError(f"Missing line-rate attribute in {path}")
    return round(float(line_rate) * 100, 2)


def parse_lcov(path: Path) -> dict[str, float]:
    """Extract coverage metrics from LCOV info file.

    Returns dict with keys: lines, branches, functions.
    LCOV does not track statement coverage — use
    parse_coverage_summary_statements() for that metric.
    """
    lines_found = 0
    lines_hit = 0
    functions_found = 0
    functions_hit = 0
    branches_found = 0
    branches_hit = 0

    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line.startswith("LF:"):
                lines_found += int(line.split(":")[1])
            elif line.startswith("LH:"):
                lines_hit += int(line.split(":")[1])
            elif line.startswith("FNF:"):
                functions_found += int(line.split(":")[1])
            elif line.startswith("FNH:"):
                functions_hit += int(line.split(":")[1])
            elif line.startswith("BRF:"):
                branches_found += int(line.split(":")[1])
            elif line.startswith("BRH:"):
                branches_hit += int(line.split(":")[1])

    def pct(hit: int, found: int) -> float:
        return round((hit / found) * 100, 2) if found > 0 else 0.0

    return {
        "lines": pct(lines_hit, lines_found),
        "branches": pct(branches_hit, branches_found),
        "functions": pct(functions_hit, functions_found),
    }


def parse_coverage_summary_statements(path: Path) -> float:
    """Extract statements coverage from Istanbul coverage-summary.json.

    Istanbul tracks statements independently from lines (multiple
    statements per line). This is the authoritative source for
    statement coverage — LCOV does not have this metric.

    Returns coverage as a float (0.0-100.0), rounded to 2 decimals.
    """
    data = json.loads(path.read_text(encoding="utf-8"))
    total = data.get("total", {})
    stmts = total.get("statements", {})
    pct_val = stmts.get("pct")
    if pct_val is None:
        raise ValueError(f"Missing total.statements.pct in {path}")
    return round(float(pct_val), 2)


def load_baseline(path: Path) -> dict[str, dict[str, float]]:
    """Load the coverage baseline file.

    Returns dict with 'python' and 'typescript' keys, each mapping
    metric names to float percentages.
    """
    if not path.exists():
        raise FileNotFoundError(
            f"Coverage baseline not found: {path}\n"
            "Generate with: python scripts/check_coverage_delta.py --update"
        )

    data = json.loads(path.read_text(encoding="utf-8"))

    if data.get("version") != BASELINE_VERSION:
        raise ValueError(f"Unsupported baseline version: {data.get('version')}")

    return {
        "python": data.get("python", {}),
        "typescript": data.get("typescript", {}),
    }


def write_baseline(
    path: Path,
    python_lines: float,
    ts_metrics: dict[str, float],
) -> None:
    """Write a new coverage baseline file."""
    data = {
        "version": BASELINE_VERSION,
        "updated_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "python": {
            "lines": python_lines,
        },
        "typescript": {
            "lines": ts_metrics["lines"],
            "statements": ts_metrics["statements"],
            "branches": ts_metrics["branches"],
            "functions": ts_metrics["functions"],
        },
    }
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def check_delta(
    baseline: dict[str, dict[str, float]],
    python_actual: float,
    ts_actuals: dict[str, float],
    threshold: float,
) -> tuple[bool, list[str]]:
    """Compare current coverage against baseline.

    Returns (passed, messages) where passed is True if all metrics are
    within the threshold, and messages is a list of status lines.
    """
    passed = True
    messages: list[str] = []

    # Python
    py_baseline = baseline["python"].get("lines", 0.0)
    py_delta = round(python_actual - py_baseline, 2)
    status = "[OK]" if py_delta >= -threshold else "[FAIL]"
    if py_delta < -threshold:
        passed = False
    messages.append(
        f"  {status}  Python lines: {py_baseline}% -> {python_actual}% "
        f"(delta: {py_delta:+.2f}%)"
    )

    # TypeScript
    for metric in ("lines", "statements", "branches", "functions"):
        ts_baseline = baseline["typescript"].get(metric, 0.0)
        ts_actual = ts_actuals.get(metric, 0.0)
        ts_delta = round(ts_actual - ts_baseline, 2)
        status = "[OK]" if ts_delta >= -threshold else "[FAIL]"
        if ts_delta < -threshold:
            passed = False
        messages.append(
            f"  {status}  TS {metric}: {ts_baseline}% -> {ts_actual}% "
            f"(delta: {ts_delta:+.2f}%)"
        )

    return passed, messages


def main() -> int:
    """CLI entry point."""
    parser = argparse.ArgumentParser(
        description="Check coverage delta against baseline.",
    )
    parser.add_argument(
        "--python-coverage",
        type=Path,
        default=DEFAULT_PYTHON_COVERAGE,
        help=f"Path to coverage.xml (default: {DEFAULT_PYTHON_COVERAGE})",
    )
    parser.add_argument(
        "--ts-coverage",
        type=Path,
        default=DEFAULT_TS_COVERAGE,
        help=f"Path to lcov.info (default: {DEFAULT_TS_COVERAGE})",
    )
    parser.add_argument(
        "--ts-summary",
        type=Path,
        default=DEFAULT_TS_SUMMARY,
        help=f"Path to coverage-summary.json for statement coverage (default: {DEFAULT_TS_SUMMARY})",
    )
    parser.add_argument(
        "--baseline",
        type=Path,
        default=DEFAULT_BASELINE,
        help=f"Path to baseline JSON (default: {DEFAULT_BASELINE})",
    )
    parser.add_argument(
        "--threshold",
        type=float,
        default=DEFAULT_THRESHOLD,
        help=f"Max allowed drop in %% (default: {DEFAULT_THRESHOLD})",
    )
    parser.add_argument(
        "--update",
        action="store_true",
        help="Update baseline with current coverage values",
    )
    args = parser.parse_args()

    # Validate coverage files exist
    errors: list[str] = []
    if not args.python_coverage.exists():
        errors.append(
            f"Python coverage not found: {args.python_coverage}\n"
            "  Generate with: pytest --cov --cov-report=xml"
        )
    if not args.ts_coverage.exists():
        errors.append(
            f"TypeScript coverage not found: {args.ts_coverage}\n"
            "  Generate with: cd extension && pnpm test -- --coverage"
        )
    if errors:
        for err in errors:
            print(f"[WARN] {err}")
        if args.update:
            print("Cannot update baseline without coverage files.")
            return 1
        print("[WARN] Skipping coverage delta check (coverage files missing).")
        return 0

    # Parse current coverage
    python_actual = parse_coverage_xml(args.python_coverage)
    ts_actuals = parse_lcov(args.ts_coverage)

    # Statements come from Istanbul's coverage-summary.json (not LCOV).
    # LCOV does not track statement coverage — multiple statements per
    # line are invisible to the LF/LH counters.
    if args.ts_summary.exists():
        ts_actuals["statements"] = parse_coverage_summary_statements(args.ts_summary)
    else:
        print("[WARN] coverage-summary.json not found, using lines for statements")
        ts_actuals["statements"] = ts_actuals["lines"]

    # Update mode: write baseline and exit
    if args.update:
        write_baseline(args.baseline, python_actual, ts_actuals)
        print(f"Coverage baseline updated: {args.baseline}")
        print(f"  Python lines: {python_actual}%")
        print(f"  TS lines: {ts_actuals['lines']}%")
        print(f"  TS statements: {ts_actuals['statements']}%")
        print(f"  TS branches: {ts_actuals['branches']}%")
        print(f"  TS functions: {ts_actuals['functions']}%")
        return 0

    # Check mode: compare against baseline
    try:
        baseline = load_baseline(args.baseline)
    except (FileNotFoundError, ValueError) as e:
        print(f"[WARN] {e}")
        print("[WARN] Skipping coverage delta check.")
        return 0

    print(f"Coverage delta check (max drop: {args.threshold}%):")
    passed, messages = check_delta(
        baseline,
        python_actual,
        ts_actuals,
        args.threshold,
    )
    for msg in messages:
        print(msg)

    print()
    if passed:
        print("[OK] Coverage within acceptable delta.")
        return 0

    print(f"ERROR: Coverage dropped more than {args.threshold}% from baseline.")
    print()
    print("To fix: add tests to restore coverage, or if the drop is")
    print("intentional, update the baseline with:")
    print("  python scripts/check_coverage_delta.py --update")
    print()
    print(
        "Baseline changes require [threshold-update] in a commit SUBJECT "
        "line (scanned via `git log --oneline`; markers in commit bodies "
        "are NOT honored)."
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
