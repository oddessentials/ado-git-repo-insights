#!/usr/bin/env python3
"""Check changed-line coverage for the current branch.

This is a local parity guard for Codecov-style patch coverage feedback.
It is intentionally line-based and repo-owned so contributors can run it
before push without depending on Codecov's remote analysis.
"""

from __future__ import annotations

import argparse
import fnmatch
import re
import shutil
import subprocess
import sys
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

import yaml
from defusedxml.ElementTree import parse as parse_xml

REPO_ROOT = Path(__file__).resolve().parent.parent
EXTENSION_ROOT = REPO_ROOT / "extension"
DIFF_HUNK_RE = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@")


@dataclass(frozen=True)
class CoverageHit:
    line: int
    hits: int


def normalize_repo_path(path: str, *, ts: bool = False) -> str:
    normalized = path.replace("\\", "/").strip()
    if ts and not normalized.startswith("extension/"):
        normalized = f"extension/{normalized}"
    return normalized.lstrip("./")


def parse_changed_lines(base_ref: str) -> dict[str, set[int]]:
    git = shutil.which("git")
    if git is None:
        raise SystemExit("git is required for patch coverage checks but was not found.")

    result = subprocess.run(
        [
            git,
            "diff",
            "--unified=0",
            "--diff-filter=AMRT",
            f"{base_ref}...HEAD",
            "--",
            "src/",
            "extension/ui/",
        ],
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )

    changed: dict[str, set[int]] = defaultdict(set)
    current_file: str | None = None
    current_new_line = 0

    for raw_line in result.stdout.splitlines():
        if raw_line.startswith("+++ b/"):
            current_file = normalize_repo_path(raw_line[6:])
            continue

        match = DIFF_HUNK_RE.match(raw_line)
        if match:
            current_new_line = int(match.group(1))
            continue

        if current_file is None:
            continue

        if raw_line.startswith("+") and not raw_line.startswith("+++"):
            changed[current_file].add(current_new_line)
            current_new_line += 1
        elif raw_line.startswith(" "):
            current_new_line += 1

    return dict(changed)


def load_ignored_patterns(path: Path) -> list[str]:
    if not path.exists():
        return []
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    ignore = data.get("ignore", [])
    return [str(pattern).replace("\\", "/") for pattern in ignore if pattern]


def is_ignored(path: str, patterns: list[str]) -> bool:
    return any(fnmatch.fnmatch(path, pattern) for pattern in patterns)


def parse_python_coverage(path: Path) -> dict[str, dict[int, int]]:
    tree = parse_xml(path)
    root = tree.getroot()

    sources = [
        Path((source.text or "").strip())
        for source in root.findall("./sources/source")
        if (source.text or "").strip()
    ]
    coverage: dict[str, dict[int, int]] = {}

    for cls in root.findall(".//class"):
        filename = cls.attrib.get("filename")
        if not filename:
            continue

        rel_path: str | None = None
        for source in sources:
            candidate = (source / filename).resolve()
            try:
                rel_path = candidate.relative_to(REPO_ROOT).as_posix()
                break
            except ValueError:
                continue
        if rel_path is None:
            rel_path = normalize_repo_path(filename)
            if not rel_path.startswith("src/"):
                rel_path = f"src/ado_git_repo_insights/{rel_path}"

        line_hits: dict[int, int] = {}
        for line in cls.findall("./lines/line"):
            number = int(line.attrib["number"])
            hits = int(line.attrib.get("hits", "0"))
            line_hits[number] = hits
        coverage[rel_path] = line_hits

    return coverage


def parse_lcov(path: Path) -> dict[str, dict[int, int]]:
    coverage: dict[str, dict[int, int]] = {}
    current_file: str | None = None
    current_hits: dict[int, int] = {}

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        if raw_line.startswith("SF:"):
            current_file = normalize_repo_path(raw_line[3:], ts=True)
            current_hits = {}
        elif raw_line.startswith("DA:") and current_file is not None:
            line_no_str, hits_str = raw_line[3:].split(",", 1)
            current_hits[int(line_no_str)] = int(float(hits_str))
        elif raw_line == "end_of_record" and current_file is not None:
            coverage[current_file] = current_hits
            current_file = None
            current_hits = {}

    return coverage


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Check changed-line coverage against local coverage reports.",
    )
    parser.add_argument(
        "--base-ref",
        default="origin/main",
        help="Git base ref for patch diff (default: origin/main)",
    )
    parser.add_argument(
        "--python-coverage",
        type=Path,
        default=REPO_ROOT / "coverage.xml",
        help="Path to coverage.xml (default: coverage.xml)",
    )
    parser.add_argument(
        "--ts-coverage",
        type=Path,
        default=EXTENSION_ROOT / "coverage" / "lcov.info",
        help="Path to TypeScript lcov.info (default: extension/coverage/lcov.info)",
    )
    parser.add_argument(
        "--threshold",
        type=float,
        default=80.0,
        help="Minimum local patch coverage percentage (default: 80.0)",
    )
    parser.add_argument(
        "--codecov-config",
        type=Path,
        default=REPO_ROOT / "codecov.yml",
        help="Path to codecov.yml ignore patterns (default: codecov.yml)",
    )
    args = parser.parse_args()

    changed_lines = parse_changed_lines(args.base_ref)
    if not changed_lines:
        print("[OK] No src/ or extension/ui/ changes found for patch coverage.")
        return 0

    ignore_patterns = load_ignored_patterns(args.codecov_config)
    changed_lines = {
        path: lines
        for path, lines in changed_lines.items()
        if not is_ignored(path, ignore_patterns)
    }
    if not changed_lines:
        print("[OK] Changed files are excluded by codecov ignore patterns.")
        return 0

    python_cov = (
        parse_python_coverage(args.python_coverage)
        if args.python_coverage.exists()
        else {}
    )
    ts_cov = parse_lcov(args.ts_coverage) if args.ts_coverage.exists() else {}

    executable_changed = 0
    covered_changed = 0
    missing_by_file: dict[str, list[int]] = defaultdict(list)

    for file_path, lines in sorted(changed_lines.items()):
        coverage_map = python_cov.get(file_path) or ts_cov.get(file_path)
        if not coverage_map:
            continue

        for line in sorted(lines):
            if line not in coverage_map:
                continue
            executable_changed += 1
            if coverage_map[line] > 0:
                covered_changed += 1
            else:
                missing_by_file[file_path].append(line)

    if executable_changed == 0:
        print("[OK] No executable changed lines were found in local coverage reports.")
        return 0

    pct = (covered_changed / executable_changed) * 100
    print(
        f"Local patch coverage: {pct:.2f}% "
        f"({covered_changed}/{executable_changed} executable changed lines covered)"
    )

    if pct < args.threshold:
        print(
            f"::error::Local patch coverage {pct:.2f}% is below the configured "
            f"threshold of {args.threshold:.2f}%."
        )
        for file_path, missing_lines in sorted(missing_by_file.items()):
            if not missing_lines:
                continue
            print(f"  {file_path}: missing lines {missing_lines}")
        return 1

    print("[OK] Local patch coverage threshold satisfied.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
