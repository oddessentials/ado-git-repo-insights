#!/usr/bin/env python3
"""CSV diff validation script.

Compares CSV outputs between two directories to validate:
1. Schema compatibility (same columns, same order)
2. Row-level differences with clear reporting
3. Deterministic output validation

Usage:
    python csv_diff.py <baseline_dir> <comparison_dir>

Exit codes:
    0 - No differences found
    1 - Differences found (detailed report printed)
    2 - Schema mismatch (critical error)
"""

from __future__ import annotations

import argparse
import hashlib
import sys
from pathlib import Path

import pandas as pd

# Expected CSV files (from CSV_SCHEMAS)
EXPECTED_FILES = [
    "organizations.csv",
    "projects.csv",
    "repositories.csv",
    "pull_requests.csv",
    "users.csv",
    "reviewers.csv",
]

# Expected column order per file
EXPECTED_SCHEMAS = {
    "organizations": ["organization_name"],
    "projects": ["organization_name", "project_name"],
    "repositories": [
        "repository_id",
        "repository_name",
        "project_name",
        "organization_name",
    ],
    "pull_requests": [
        "pull_request_uid",
        "pull_request_id",
        "organization_name",
        "project_name",
        "repository_id",
        "user_id",
        "title",
        "status",
        "description",
        "creation_date",
        "closed_date",
        "cycle_time_minutes",
    ],
    "users": ["user_id", "display_name", "email"],
    "reviewers": ["pull_request_uid", "user_id", "vote", "repository_id"],
}


def hash_file(path: Path) -> str:
    """Calculate SHA-256 hash of a file."""
    sha256 = hashlib.sha256()
    with path.open("rb") as f:
        sha256.update(f.read())
    return sha256.hexdigest()


def validate_schema(csv_path: Path, expected_columns: list[str]) -> tuple[bool, str]:
    """Validate that a CSV file matches expected schema.

    Returns:
        Tuple of (is_valid, error_message)
    """
    try:
        df = pd.read_csv(csv_path, nrows=0)  # Just read headers
        actual_columns = list(df.columns)

        if actual_columns != expected_columns:
            return False, (
                f"Schema mismatch in {csv_path.name}:\n"
                f"  Expected: {expected_columns}\n"
                f"  Actual:   {actual_columns}"
            )
        return True, ""
    except Exception as e:
        return False, f"Failed to read {csv_path.name}: {e}"


def compare_csvs(
    baseline_path: Path, comparison_path: Path, table_name: str
) -> tuple[bool, str]:
    """Compare two CSV files and report differences.

    Returns:
        Tuple of (are_identical, diff_report)
    """
    try:
        baseline_df = pd.read_csv(baseline_path)
        comparison_df = pd.read_csv(comparison_path)

        if baseline_df.equals(comparison_df):
            return True, ""

        # Detailed diff
        report_lines = [f"\n{table_name}.csv differences:"]
        report_lines.append(f"  Baseline rows: {len(baseline_df)}")
        report_lines.append(f"  Comparison rows: {len(comparison_df)}")

        # Find row differences by comparing hashes
        baseline_hash = hash_file(baseline_path)
        comparison_hash = hash_file(comparison_path)

        report_lines.append(f"  Baseline hash: {baseline_hash[:12]}...")
        report_lines.append(f"  Comparison hash: {comparison_hash[:12]}...")

        # Show first few differences
        merged = baseline_df.merge(
            comparison_df, how="outer", indicator=True, suffixes=("_base", "_comp")
        )

        left_only = merged[merged["_merge"] == "left_only"]
        right_only = merged[merged["_merge"] == "right_only"]

        if len(left_only) > 0:
            report_lines.append(f"  Rows only in baseline: {len(left_only)}")
        if len(right_only) > 0:
            report_lines.append(f"  Rows only in comparison: {len(right_only)}")

        return False, "\n".join(report_lines)

    except Exception as e:
        return False, f"Error comparing {table_name}.csv: {e}"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Compare CSV outputs for PowerBI compatibility validation"
    )
    parser.add_argument("baseline_dir", type=Path, help="Directory with baseline CSVs")
    parser.add_argument(
        "comparison_dir", type=Path, help="Directory with comparison CSVs"
    )
    parser.add_argument(
        "--validate-schema-only",
        action="store_true",
        help="Only validate schema, skip content comparison",
    )
    args = parser.parse_args()

    # Validate directories exist
    if not args.baseline_dir.is_dir():
        print(f"ERROR: Baseline directory not found: {args.baseline_dir}")
        return 2

    if not args.comparison_dir.is_dir():
        print(f"ERROR: Comparison directory not found: {args.comparison_dir}")
        return 2

    # Check all expected files exist
    missing_baseline = []
    missing_comparison = []

    for filename in EXPECTED_FILES:
        if not (args.baseline_dir / filename).exists():
            missing_baseline.append(filename)
        if not (args.comparison_dir / filename).exists():
            missing_comparison.append(filename)

    if missing_baseline:
        print(f"ERROR: Missing files in baseline: {missing_baseline}")
        return 2

    if missing_comparison:
        print(f"ERROR: Missing files in comparison: {missing_comparison}")
        return 2

    # Validate schemas
    print("Validating schemas...")
    schema_valid = True
    for filename in EXPECTED_FILES:
        table_name = filename.replace(".csv", "")
        expected = EXPECTED_SCHEMAS[table_name]

        for dir_name, dir_path in [
            ("baseline", args.baseline_dir),
            ("comparison", args.comparison_dir),
        ]:
            is_valid, error = validate_schema(dir_path / filename, expected)
            if not is_valid:
                print(f"SCHEMA ERROR ({dir_name}): {error}")
                schema_valid = False

    if not schema_valid:
        print("\nSCHEMA VALIDATION FAILED")
        return 2

    print("  All schemas valid ✓")

    if args.validate_schema_only:
        print("\nSchema validation passed")
        return 0

    # Compare contents
    print("\nComparing CSV contents...")
    all_identical = True
    diff_reports = []

    for filename in EXPECTED_FILES:
        table_name = filename.replace(".csv", "")
        baseline_path = args.baseline_dir / filename
        comparison_path = args.comparison_dir / filename

        is_identical, report = compare_csvs(baseline_path, comparison_path, table_name)

        if is_identical:
            print(f"  {table_name}: identical ✓")
        else:
            print(f"  {table_name}: DIFFERENCES FOUND")
            all_identical = False
            diff_reports.append(report)

    if all_identical:
        print("\nCSV VALIDATION PASSED - All files identical")
        return 0
    else:
        print("\nCSV VALIDATION FAILED - Differences found:")
        for report in diff_reports:
            print(report)
        return 1


if __name__ == "__main__":
    sys.exit(main())
