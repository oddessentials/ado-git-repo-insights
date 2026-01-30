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

Dependencies:
    pip install -e ".[dev]"
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import defusedxml.ElementTree as ET  # noqa: N817

# Disallowed path prefixes (absolute paths that should never be accessed)
# These are sensitive system directories that artifact paths should never resolve to
# Note: /home is allowed because GitHub Actions runners use /home/runner/work/...
DISALLOWED_PREFIXES = (
    "/etc",
    "/root",
    "/var/log",
    "/var/run",
    "/usr",
    "/bin",
    "/sbin",
    "/proc",
    "/sys",
    "/dev",
)


def validate_path_bounds(
    path: str,
    base_dir: str | None = None,
    label: str = "file",
) -> Path:
    """Validate a file path is within expected bounds.

    Security checks:
    1. Resolve symlinks and normalize path (realpath)
    2. If base_dir specified, ensure path is within that directory
    3. Reject paths in sensitive system directories
    4. Ensure path is a regular file (not directory, device, etc.)

    Args:
        path: Path to validate
        base_dir: Optional base directory - path must be within this directory
        label: Human-readable label for error messages

    Returns:
        Resolved Path object

    Raises:
        ValueError: If path fails security validation
        FileNotFoundError: If path doesn't exist
    """
    # Resolve to absolute path, following symlinks
    try:
        resolved = Path(path).resolve(strict=True)
    except FileNotFoundError as e:
        raise FileNotFoundError(f"{label} not found: {path}") from e
    except OSError as e:
        raise ValueError(f"{label} path resolution failed: {path} ({e})") from e

    resolved_str = str(resolved)

    # Check against disallowed prefixes (Unix-style paths)
    # On Windows, these won't match, which is fine - the base_dir check is primary
    for prefix in DISALLOWED_PREFIXES:
        if resolved_str.startswith(prefix + "/") or resolved_str == prefix:
            raise ValueError(
                f"{label} path resolves to disallowed location: {resolved_str}"
            )

    # Validate against base directory if specified
    if base_dir is not None:
        try:
            base_resolved = Path(base_dir).resolve(strict=True)
        except (FileNotFoundError, OSError) as e:
            raise ValueError(f"Base directory invalid: {base_dir} ({e})") from e

        # Check that resolved path is within base directory
        try:
            resolved.relative_to(base_resolved)
        except ValueError as e:
            raise ValueError(
                f"{label} path escapes base directory: {resolved_str} "
                f"(expected within {base_resolved})"
            ) from e

    # Ensure it's a regular file
    if not resolved.is_file():
        raise ValueError(f"{label} is not a regular file: {resolved_str}")

    return resolved


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
        tree = ET.parse(coverage_path)
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


def parse_junit_xml(path: str) -> dict[str, str | int]:
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
        tree = ET.parse(junit_path)
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
    python_tests: dict[str, str | int],
    ts_coverage: float,
    ts_tests: dict[str, str | int],
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
    parser.add_argument(
        "--artifacts-dir",
        help="Base directory for input artifacts (paths must be within this directory)",
    )

    args = parser.parse_args()

    try:
        # Validate all input paths with realpath bounds checking
        # This prevents path traversal attacks via symlinks or ../ sequences
        python_cov_path = validate_path_bounds(
            args.python_coverage,
            base_dir=args.artifacts_dir,
            label="Python coverage",
        )
        python_test_path = validate_path_bounds(
            args.python_tests,
            base_dir=args.artifacts_dir,
            label="Python tests",
        )
        ts_cov_path = validate_path_bounds(
            args.ts_coverage,
            base_dir=args.artifacts_dir,
            label="TypeScript coverage",
        )
        ts_test_path = validate_path_bounds(
            args.ts_tests,
            base_dir=args.artifacts_dir,
            label="TypeScript tests",
        )

        # Parse all inputs (using validated paths)
        python_coverage = parse_coverage_xml(str(python_cov_path))
        python_tests = parse_junit_xml(str(python_test_path))
        ts_coverage = parse_lcov(str(ts_cov_path))
        ts_tests = parse_junit_xml(str(ts_test_path))

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
