#!/usr/bin/env python3
"""Generate badge status JSON from CI test and coverage reports.

This script parses coverage and test result files and outputs a deterministic
JSON file for Shields.io dynamic badges.

Usage:
    python generate-badge-json.py \
        --python-coverage coverage.xml \
        --python-tests test-results.xml \
        --ts-coverage extension/coverage/lcov.info \
        --ts-tests extension/test-results.xml \
        --output status.json
"""

from __future__ import annotations

import argparse
import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path


def parse_coverage_xml(path: str) -> float:
    """Extract line coverage percentage from Cobertura XML.

    Args:
        path: Path to coverage.xml file

    Returns:
        Coverage percentage (0.0-100.0), rounded to 1 decimal

    Raises:
        FileNotFoundError: If the coverage file doesn't exist
        ValueError: If the XML is malformed or missing line-rate
    """
    coverage_path = Path(path)
    if not coverage_path.exists():
        raise FileNotFoundError(f"Coverage file not found: {path}")

    try:
        # S314: Safe - parsing CI-generated coverage.xml, not untrusted data
        tree = ET.parse(coverage_path)  # noqa: S314
        root = tree.getroot()
    except ET.ParseError as e:
        raise ValueError(f"Malformed XML in {path}: {e}") from e

    line_rate = root.get("line-rate")
    if line_rate is None:
        raise ValueError(f"Missing line-rate attribute in {path}")

    try:
        coverage_pct = round(float(line_rate) * 100, 1)
    except (TypeError, ValueError) as e:
        raise ValueError(f"Invalid line-rate value in {path}: {line_rate}") from e

    if not 0.0 <= coverage_pct <= 100.0:
        raise ValueError(f"Coverage out of range in {path}: {coverage_pct}")

    return coverage_pct


def parse_lcov(path: str) -> float:
    """Extract line coverage percentage from LCOV info file.

    Args:
        path: Path to lcov.info file

    Returns:
        Coverage percentage (0.0-100.0), rounded to 1 decimal

    Raises:
        FileNotFoundError: If the lcov file doesn't exist
        ValueError: If the file is empty or malformed
    """
    lcov_path = Path(path)
    if not lcov_path.exists():
        raise FileNotFoundError(f"LCOV file not found: {path}")

    lines_found = 0
    lines_hit = 0

    try:
        with open(lcov_path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("LF:"):
                    lines_found += int(line.split(":")[1])
                elif line.startswith("LH:"):
                    lines_hit += int(line.split(":")[1])
    except (ValueError, IndexError) as e:
        raise ValueError(f"Malformed LCOV file {path}: {e}") from e

    if lines_found == 0:
        # No lines found - could be empty coverage or no source files
        return 0.0

    coverage_pct = round((lines_hit / lines_found) * 100, 1)

    if not 0.0 <= coverage_pct <= 100.0:
        raise ValueError(f"Coverage out of range in {path}: {coverage_pct}")

    return coverage_pct


def parse_junit_xml(path: str) -> dict:
    """Extract test counts from JUnit XML file.

    Args:
        path: Path to JUnit XML test results file

    Returns:
        Dictionary with keys: passed, skipped, total, display

    Raises:
        FileNotFoundError: If the test results file doesn't exist
        ValueError: If the XML is malformed or missing required attributes
    """
    junit_path = Path(path)
    if not junit_path.exists():
        raise FileNotFoundError(f"JUnit XML file not found: {path}")

    try:
        # S314: Safe - parsing CI-generated JUnit XML, not untrusted data
        tree = ET.parse(junit_path)  # noqa: S314
        root = tree.getroot()
    except ET.ParseError as e:
        raise ValueError(f"Malformed XML in {path}: {e}") from e

    # Handle both <testsuites> (wrapper) and <testsuite> (direct)
    if root.tag == "testsuites":
        testsuites = root.findall("testsuite")
        if not testsuites:
            raise ValueError(f"No testsuite elements found in {path}")

        tests = sum(int(ts.get("tests", 0)) for ts in testsuites)
        failures = sum(int(ts.get("failures", 0)) for ts in testsuites)
        errors = sum(int(ts.get("errors", 0)) for ts in testsuites)
        skipped = sum(int(ts.get("skipped", 0)) for ts in testsuites)
    elif root.tag == "testsuite":
        tests = int(root.get("tests", 0))
        failures = int(root.get("failures", 0))
        errors = int(root.get("errors", 0))
        skipped = int(root.get("skipped", 0))
    else:
        raise ValueError(f"Unexpected root element in {path}: {root.tag}")

    passed = tests - failures - errors - skipped

    # Validation
    if passed < 0:
        raise ValueError(
            f"Invalid test counts in {path}: passed={passed} "
            f"(tests={tests}, failures={failures}, errors={errors}, skipped={skipped})"
        )

    # Generate display string
    if skipped == 0:
        display = f"{passed} passed"
    else:
        display = f"{passed} passed, {skipped} skipped"

    return {
        "display": display,
        "passed": passed,
        "skipped": skipped,
        "total": tests,
    }


def generate_status_json(
    python_coverage: float,
    python_tests: dict,
    ts_coverage: float,
    ts_tests: dict,
) -> str:
    """Generate deterministic status JSON.

    Args:
        python_coverage: Python coverage percentage
        python_tests: Python test results dict
        ts_coverage: TypeScript coverage percentage
        ts_tests: TypeScript test results dict

    Returns:
        JSON string with sort_keys=True for determinism
    """
    status = {
        "python": {
            "coverage": python_coverage,
            "tests": python_tests,
        },
        "typescript": {
            "coverage": ts_coverage,
            "tests": ts_tests,
        },
    }

    # sort_keys=True ensures deterministic output
    return json.dumps(status, indent=2, sort_keys=True)


def main() -> int:
    """CLI entry point."""
    parser = argparse.ArgumentParser(
        description="Generate badge status JSON from CI reports"
    )
    parser.add_argument(
        "--python-coverage",
        required=True,
        help="Path to Python coverage.xml file",
    )
    parser.add_argument(
        "--python-tests",
        required=True,
        help="Path to Python JUnit XML test results",
    )
    parser.add_argument(
        "--ts-coverage",
        required=True,
        help="Path to TypeScript lcov.info file",
    )
    parser.add_argument(
        "--ts-tests",
        required=True,
        help="Path to TypeScript JUnit XML test results",
    )
    parser.add_argument(
        "--output",
        "-o",
        default="-",
        help="Output file path (default: stdout)",
    )

    args = parser.parse_args()

    try:
        # Parse all inputs
        python_coverage = parse_coverage_xml(args.python_coverage)
        python_tests = parse_junit_xml(args.python_tests)
        ts_coverage = parse_lcov(args.ts_coverage)
        ts_tests = parse_junit_xml(args.ts_tests)

        # Generate JSON
        json_output = generate_status_json(
            python_coverage=python_coverage,
            python_tests=python_tests,
            ts_coverage=ts_coverage,
            ts_tests=ts_tests,
        )

        # Write output
        if args.output == "-":
            print(json_output)
        else:
            output_path = Path(args.output)
            output_path.write_text(json_output + "\n", encoding="utf-8")
            print(f"Wrote badge JSON to {args.output}", file=sys.stderr)

        return 0

    except FileNotFoundError as e:
        print(f"::error::Missing required file: {e}", file=sys.stderr)
        return 1
    except ValueError as e:
        print(f"::error::Parse error: {e}", file=sys.stderr)
        return 1
    except Exception as e:
        print(f"::error::Unexpected error: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
