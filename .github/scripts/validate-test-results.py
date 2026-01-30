#!/usr/bin/env python3
"""
Validate test results from JUnit XML output.

This script provides robust CI gating by parsing JUnit XML instead of
fragile regex parsing of pytest console output.

Exit codes:
    0: All checks passed
    1: Validation failed (test count, failures, etc.)
    2: Script error (missing file, parse error)

Dependencies:
    pip install -e ".[dev]"
"""

import sys
from pathlib import Path

import defusedxml.ElementTree as ET  # noqa: N817


def parse_junit_xml(xml_path: str) -> dict:
    """Parse JUnit XML and extract test metrics.

    Handles multiple JUnit XML formats:
    - pytest: <testsuites><testsuite tests="N" ...>
    - jest-junit: <testsuites tests="N" ...><testsuite ...>
    - single testsuite: <testsuite tests="N" ...>

    Uses defusedxml for safe XML parsing (prevents XXE and related attacks).
    """
    try:
        tree = ET.parse(xml_path)
        root = tree.getroot()

        # Handle different JUnit XML structures
        if root.tag == "testsuites":
            # Check if testsuites has totals (jest-junit style)
            if root.get("tests") is not None:
                # Jest-junit puts totals on the root testsuites element
                return {
                    "collected": int(root.get("tests", 0)),
                    "failures": int(root.get("failures", 0)),
                    "errors": int(root.get("errors", 0)),
                    # Jest doesn't set skipped on root, sum from children
                    "skipped": sum(
                        int(ts.get("skipped", 0)) for ts in root.findall("testsuite")
                    ),
                    "time": float(root.get("time", 0)),
                }
            else:
                # pytest style: sum from testsuite children
                testsuites = root.findall("testsuite")
                if not testsuites:
                    return {"error": "No testsuite elements found"}
                return {
                    "collected": sum(int(ts.get("tests", 0)) for ts in testsuites),
                    "failures": sum(int(ts.get("failures", 0)) for ts in testsuites),
                    "errors": sum(int(ts.get("errors", 0)) for ts in testsuites),
                    "skipped": sum(int(ts.get("skipped", 0)) for ts in testsuites),
                    "time": sum(float(ts.get("time", 0)) for ts in testsuites),
                }
        elif root.tag == "testsuite":
            # Single testsuite at root
            return {
                "collected": int(root.get("tests", 0)),
                "failures": int(root.get("failures", 0)),
                "errors": int(root.get("errors", 0)),
                "skipped": int(root.get("skipped", 0)),
                "time": float(root.get("time", 0)),
            }
        else:
            return {"error": f"Unknown root element: {root.tag}"}
    except ET.ParseError as e:
        return {"error": f"XML parse error: {e}"}
    except FileNotFoundError:
        return {"error": f"File not found: {xml_path}"}


def validate_results(
    results: dict,
    min_collected: int,
    max_skips: int = 0,
    allow_deselect: bool = False,
) -> tuple[bool, list[str]]:
    """
    Validate test results against CI gates.

    Returns:
        (passed, messages): Tuple of pass/fail and list of messages
    """
    messages = []
    passed = True

    if "error" in results:
        return False, [f"::error::Parse error: {results['error']}"]

    collected = results["collected"]
    failures = results["failures"]
    errors = results["errors"]
    skipped = results["skipped"]

    # Gate 1: Minimum collected tests
    if collected < min_collected:
        passed = False
        messages.append(
            f"::error::Test count dropped below minimum! "
            f"Expected >= {min_collected}, got {collected}"
        )
        messages.append(
            "::error::If tests were intentionally removed, update MIN_COLLECTED in ci.yml"
        )
    else:
        messages.append(f"[OK] Collected tests: {collected} (minimum: {min_collected})")

    # Gate 2: No failures or errors
    if failures > 0 or errors > 0:
        passed = False
        messages.append(
            f"::error::Test failures detected! Failures: {failures}, Errors: {errors}"
        )
    else:
        messages.append("[OK] No failures or errors")

    # Gate 3: Skip limit
    if skipped > max_skips:
        passed = False
        messages.append(
            f"::error::Too many skipped tests! Skipped: {skipped}, Max allowed: {max_skips}"
        )
        messages.append(
            "::error::Fix the test environment or add skipped tests to allowlist"
        )
    else:
        if skipped > 0:
            messages.append(
                f"[WARN] Skipped tests: {skipped} (max allowed: {max_skips})"
            )
        else:
            messages.append("[OK] No skipped tests")

    return passed, messages


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Validate pytest JUnit XML results")
    parser.add_argument("xml_file", help="Path to JUnit XML file")
    parser.add_argument(
        "--min-collected",
        type=int,
        required=True,
        help="Minimum expected test count",
    )
    parser.add_argument(
        "--max-skips",
        type=int,
        default=0,
        help="Maximum allowed skipped tests (default: 0)",
    )
    parser.add_argument(
        "--output-summary",
        action="store_true",
        help="Output GitHub Actions summary format",
    )

    args = parser.parse_args()

    if not Path(args.xml_file).exists():
        print(f"::error::JUnit XML file not found: {args.xml_file}")
        sys.exit(2)

    results = parse_junit_xml(args.xml_file)

    if "error" in results:
        print(f"::error::{results['error']}")
        sys.exit(2)

    passed, messages = validate_results(
        results,
        min_collected=args.min_collected,
        max_skips=args.max_skips,
    )

    # Print summary
    print(f"\n{'=' * 60}")
    print("Test Results Summary")
    print(f"{'=' * 60}")
    print(f"  Collected: {results['collected']}")
    print(
        f"  Passed:    {results['collected'] - results['failures'] - results['errors'] - results['skipped']}"
    )
    print(f"  Failed:    {results['failures']}")
    print(f"  Errors:    {results['errors']}")
    print(f"  Skipped:   {results['skipped']}")
    print(f"  Time:      {results['time']:.2f}s")
    print(f"{'=' * 60}\n")

    # Print validation messages
    for msg in messages:
        print(msg)

    if passed:
        print("\n[OK] All test validation checks passed")
        sys.exit(0)
    else:
        print("\n[FAIL] Test validation failed")
        sys.exit(1)


if __name__ == "__main__":
    main()
