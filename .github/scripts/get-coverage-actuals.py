#!/usr/bin/env python3
"""Compute coverage actuals and recommended thresholds.

This script parses coverage artifacts and configuration files to output
a JSON report comparing actual coverage to current thresholds and
computing recommended thresholds using the ratchet formula.

Formula: threshold = floor(actual_coverage - 2.0)

Usage:
    python get-coverage-actuals.py [--python-coverage PATH] [--ts-coverage PATH]

    If paths are not specified, uses default locations:
    - Python: coverage.xml (project root)
    - TypeScript: extension/coverage/lcov.info

Output:
    JSON to stdout with actual coverage, current thresholds, and recommended
    thresholds for both Python and TypeScript.

Dependencies:
    pip install -e ".[dev]"
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path
from typing import TypedDict

import defusedxml.ElementTree as ET  # noqa: N817


class CoverageMetrics(TypedDict):
    """Coverage metrics for a single language."""

    actual: float
    threshold_current: int
    threshold_recommended: int
    drift: float


class TypeScriptMetrics(TypedDict):
    """Detailed TypeScript coverage metrics."""

    statements: CoverageMetrics
    branches: CoverageMetrics
    functions: CoverageMetrics
    lines: CoverageMetrics


class CoverageReport(TypedDict):
    """Full coverage report output."""

    python: CoverageMetrics
    typescript: TypeScriptMetrics
    formula: str
    canonical_environment: dict[str, str]


def compute_recommended_threshold(actual: float) -> int:
    """Compute recommended threshold using the ratchet formula.

    Formula: threshold = floor(actual - 2.0)

    Args:
        actual: Actual coverage percentage (0.0-100.0)

    Returns:
        Recommended threshold as integer
    """
    return int(math.floor(actual - 2.0))


def parse_coverage_xml(path: Path) -> float:
    """Extract line coverage percentage from Cobertura XML.

    Args:
        path: Path to coverage.xml file

    Returns:
        Coverage percentage (0.0-100.0), rounded to 2 decimals

    Raises:
        FileNotFoundError: If the coverage file doesn't exist
        ValueError: If the XML is malformed or missing line-rate
    """
    if not path.exists():
        raise FileNotFoundError(f"Coverage file not found: {path}")

    try:
        tree = ET.parse(path)
        root = tree.getroot()
    except ET.ParseError as e:
        raise ValueError(f"Malformed XML in {path}: {e}") from e

    line_rate = root.get("line-rate")
    if line_rate is None:
        raise ValueError(f"Missing line-rate attribute in {path}")

    try:
        coverage_pct = round(float(line_rate) * 100, 2)
    except (TypeError, ValueError) as e:
        raise ValueError(f"Invalid line-rate value in {path}: {line_rate}") from e

    if not 0.0 <= coverage_pct <= 100.0:
        raise ValueError(f"Coverage out of range in {path}: {coverage_pct}")

    return coverage_pct


def parse_lcov_detailed(path: Path) -> dict[str, float]:
    """Extract detailed coverage metrics from LCOV info file.

    Parses LF/LH for lines, FNF/FNH for functions, BRF/BRH for branches.

    Args:
        path: Path to lcov.info file

    Returns:
        Dictionary with keys: lines, functions, branches, statements
        (statements = lines for LCOV format)

    Raises:
        FileNotFoundError: If the lcov file doesn't exist
        ValueError: If the file is empty or malformed
    """
    if not path.exists():
        raise FileNotFoundError(f"LCOV file not found: {path}")

    # Totals across all source files
    lines_found = 0
    lines_hit = 0
    functions_found = 0
    functions_hit = 0
    branches_found = 0
    branches_hit = 0

    try:
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
    except (ValueError, IndexError) as e:
        raise ValueError(f"Malformed LCOV file {path}: {e}") from e

    def safe_percentage(hit: int, found: int) -> float:
        if found == 0:
            return 0.0
        return round((hit / found) * 100, 2)

    return {
        "lines": safe_percentage(lines_hit, lines_found),
        "statements": safe_percentage(lines_hit, lines_found),  # Same as lines in LCOV
        "functions": safe_percentage(functions_hit, functions_found),
        "branches": safe_percentage(branches_hit, branches_found),
    }


def parse_python_threshold(pyproject_path: Path) -> int:
    """Extract fail_under threshold from pyproject.toml.

    Args:
        pyproject_path: Path to pyproject.toml

    Returns:
        Current fail_under threshold

    Raises:
        FileNotFoundError: If pyproject.toml doesn't exist
        ValueError: If fail_under is not found or invalid
    """
    if not pyproject_path.exists():
        raise FileNotFoundError(f"pyproject.toml not found: {pyproject_path}")

    content = pyproject_path.read_text(encoding="utf-8")

    # Simple regex to find fail_under = <number>
    # This avoids dependency on toml library
    match = re.search(r"fail_under\s*=\s*(\d+)", content)
    if not match:
        raise ValueError("fail_under not found in pyproject.toml")

    return int(match.group(1))


def parse_jest_thresholds(jest_config_path: Path) -> dict[str, int]:
    """Extract global coverage thresholds from jest.config.ts.

    Args:
        jest_config_path: Path to jest.config.ts

    Returns:
        Dictionary with keys: statements, branches, functions, lines

    Raises:
        FileNotFoundError: If jest.config.ts doesn't exist
        ValueError: If thresholds are not found
    """
    if not jest_config_path.exists():
        raise FileNotFoundError(f"jest.config.ts not found: {jest_config_path}")

    content = jest_config_path.read_text(encoding="utf-8")

    # Find the global threshold block
    # Pattern matches: global: { statements: 48, branches: 43, ... }
    thresholds: dict[str, int] = {}

    for metric in ["statements", "branches", "functions", "lines"]:
        # Match patterns like "statements: 48," or "statements: 48 }"
        pattern = rf"{metric}:\s*(\d+)"
        match = re.search(pattern, content)
        if match:
            thresholds[metric] = int(match.group(1))
        else:
            raise ValueError(f"Threshold for {metric} not found in jest.config.ts")

    return thresholds


def generate_report(
    python_coverage_path: Path,
    ts_coverage_path: Path,
    pyproject_path: Path,
    jest_config_path: Path,
) -> CoverageReport:
    """Generate the full coverage report.

    Args:
        python_coverage_path: Path to Python coverage.xml
        ts_coverage_path: Path to TypeScript lcov.info
        pyproject_path: Path to pyproject.toml
        jest_config_path: Path to jest.config.ts

    Returns:
        CoverageReport with all metrics and recommendations
    """
    # Parse Python coverage
    python_actual = parse_coverage_xml(python_coverage_path)
    python_threshold = parse_python_threshold(pyproject_path)
    python_recommended = compute_recommended_threshold(python_actual)

    # Parse TypeScript coverage
    ts_actuals = parse_lcov_detailed(ts_coverage_path)
    ts_thresholds = parse_jest_thresholds(jest_config_path)

    # Build TypeScript metrics
    def build_metric(metric_name: str) -> CoverageMetrics:
        actual = ts_actuals[metric_name]
        current = ts_thresholds[metric_name]
        recommended = compute_recommended_threshold(actual)
        return {
            "actual": actual,
            "threshold_current": current,
            "threshold_recommended": recommended,
            "drift": round(actual - current, 2),
        }

    ts_metrics: TypeScriptMetrics = {
        "statements": build_metric("statements"),
        "branches": build_metric("branches"),
        "functions": build_metric("functions"),
        "lines": build_metric("lines"),
    }

    return {
        "python": {
            "actual": python_actual,
            "threshold_current": python_threshold,
            "threshold_recommended": python_recommended,
            "drift": round(python_actual - python_threshold, 2),
        },
        "typescript": ts_metrics,
        "formula": "threshold = floor(actual_coverage - 2.0)",
        "canonical_environment": {
            "python": "ubuntu-latest + Python 3.11",
            "typescript": "ubuntu-latest + Node 22",
        },
    }


def main() -> int:
    """CLI entry point."""
    parser = argparse.ArgumentParser(
        description="Compute coverage actuals and recommended thresholds",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Formula: threshold = floor(actual_coverage - 2.0)

Example output:
{
  "python": {
    "actual": 75.65,
    "threshold_current": 70,
    "threshold_recommended": 73,
    "drift": 5.65
  },
  "typescript": {
    "lines": {
      "actual": 62.95,
      "threshold_current": 49,
      "threshold_recommended": 60,
      "drift": 13.95
    },
    ...
  }
}
""",
    )
    parser.add_argument(
        "--python-coverage",
        type=Path,
        default=Path("coverage.xml"),
        help="Path to Python coverage.xml (default: coverage.xml)",
    )
    parser.add_argument(
        "--ts-coverage",
        type=Path,
        default=Path("extension/coverage/lcov.info"),
        help="Path to TypeScript lcov.info (default: extension/coverage/lcov.info)",
    )
    parser.add_argument(
        "--pyproject",
        type=Path,
        default=Path("pyproject.toml"),
        help="Path to pyproject.toml (default: pyproject.toml)",
    )
    parser.add_argument(
        "--jest-config",
        type=Path,
        default=Path("extension/jest.config.ts"),
        help="Path to jest.config.ts (default: extension/jest.config.ts)",
    )
    parser.add_argument(
        "--output",
        "-o",
        type=Path,
        help="Output file path (default: stdout)",
    )

    args = parser.parse_args()

    errors: list[str] = []

    # Validate config files exist (these are always required)
    if not args.pyproject.exists():
        errors.append(f"pyproject.toml not found: {args.pyproject}")
    if not args.jest_config.exists():
        errors.append(f"jest.config.ts not found: {args.jest_config}")

    # Check coverage artifacts with helpful messages
    if not args.python_coverage.exists():
        errors.append(
            f"Python coverage.xml not found: {args.python_coverage}\n"
            "  Generate with: pytest --cov --cov-report=xml"
        )
    if not args.ts_coverage.exists():
        errors.append(
            f"TypeScript lcov.info not found: {args.ts_coverage}\n"
            "  Generate with: cd extension && pnpm test -- --coverage"
        )

    if errors:
        print("::error::Missing required files:", file=sys.stderr)
        for error in errors:
            print(f"  - {error}", file=sys.stderr)
        return 1

    try:
        report = generate_report(
            python_coverage_path=args.python_coverage,
            ts_coverage_path=args.ts_coverage,
            pyproject_path=args.pyproject,
            jest_config_path=args.jest_config,
        )

        json_output = json.dumps(report, indent=2, sort_keys=True)

        if args.output:
            args.output.write_text(json_output + "\n", encoding="utf-8")
            print(f"Wrote coverage report to {args.output}", file=sys.stderr)
        else:
            print(json_output)

        # Print summary to stderr for human consumption
        print("\n--- Coverage Summary ---", file=sys.stderr)
        print(
            f"Python: {report['python']['actual']}% actual, "
            f"{report['python']['threshold_current']}% threshold, "
            f"drift: {report['python']['drift']}%",
            file=sys.stderr,
        )
        print(
            f"TypeScript (lines): {report['typescript']['lines']['actual']}% actual, "
            f"{report['typescript']['lines']['threshold_current']}% threshold, "
            f"drift: {report['typescript']['lines']['drift']}%",
            file=sys.stderr,
        )

        # Warn if drift exceeds 2%
        if report["python"]["drift"] > 2.0:
            print(
                f"::warning::Python drift ({report['python']['drift']}%) exceeds 2% buffer",
                file=sys.stderr,
            )
        if report["typescript"]["lines"]["drift"] > 2.0:
            print(
                f"::warning::TypeScript lines drift "
                f"({report['typescript']['lines']['drift']}%) exceeds 2% buffer",
                file=sys.stderr,
            )

        return 0

    except (FileNotFoundError, ValueError) as e:
        print(f"::error::{e}", file=sys.stderr)
        return 1
    except Exception as e:
        print(f"::error::Unexpected error: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
