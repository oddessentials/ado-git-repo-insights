"""Tests for scripts/check_coverage_delta.py.

Validates the coverage delta guard: baseline loading, delta computation,
threshold enforcement, update mode, and error handling.

Tests use synthetic coverage files — no dependency on real test runs.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent.parent
SCRIPT = REPO_ROOT / "scripts" / "check_coverage_delta.py"


def write_baseline(path: Path, python_lines: float, ts: dict[str, float]) -> None:
    """Write a synthetic baseline file."""
    data = {
        "version": 1,
        "updated_at": "2026-01-01T00:00:00Z",
        "python": {"lines": python_lines},
        "typescript": ts,
    }
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def write_cobertura_xml(path: Path, line_rate: float) -> None:
    """Write a minimal Cobertura XML with the given line-rate (0.0-1.0)."""
    path.write_text(
        f'<?xml version="1.0" ?>\n'
        f'<coverage line-rate="{line_rate}" branch-rate="0">\n'
        f"  <sources><source>src</source></sources>\n"
        f"  <packages/>\n"
        f"</coverage>\n",
        encoding="utf-8",
    )


def write_lcov(
    path: Path,
    *,
    lines_found: int = 100,
    lines_hit: int = 80,
    funcs_found: int = 50,
    funcs_hit: int = 40,
    branches_found: int = 60,
    branches_hit: int = 45,
) -> None:
    """Write a minimal LCOV file with the given totals."""
    path.write_text(
        "TN:\n"
        "SF:ui/example.ts\n"
        f"LF:{lines_found}\n"
        f"LH:{lines_hit}\n"
        f"FNF:{funcs_found}\n"
        f"FNH:{funcs_hit}\n"
        f"BRF:{branches_found}\n"
        f"BRH:{branches_hit}\n"
        "end_of_record\n",
        encoding="utf-8",
    )


def write_coverage_summary(
    path: Path,
    *,
    statements_total: int = 100,
    statements_covered: int = 75,
) -> None:
    """Write a synthetic Istanbul coverage-summary.json."""
    pct = (
        round((statements_covered / statements_total) * 100, 2)
        if statements_total > 0
        else 0
    )
    data = {
        "total": {
            "lines": {"total": 100, "covered": 80, "skipped": 0, "pct": 80.0},
            "statements": {
                "total": statements_total,
                "covered": statements_covered,
                "skipped": 0,
                "pct": pct,
            },
            "branches": {"total": 60, "covered": 45, "skipped": 0, "pct": 75.0},
            "functions": {"total": 50, "covered": 40, "skipped": 0, "pct": 80.0},
        },
    }
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def run_script(
    tmp_path: Path,
    *,
    baseline: Path | None = None,
    python_cov: Path | None = None,
    ts_cov: Path | None = None,
    ts_summary: Path | None = None,
    threshold: float | None = None,
    update: bool = False,
) -> subprocess.CompletedProcess[str]:
    """Run check_coverage_delta.py with the given arguments."""
    args = [sys.executable, str(SCRIPT)]
    if baseline is not None:
        args.extend(["--baseline", str(baseline)])
    if python_cov is not None:
        args.extend(["--python-coverage", str(python_cov)])
    if ts_cov is not None:
        args.extend(["--ts-coverage", str(ts_cov)])
    if ts_summary is not None:
        args.extend(["--ts-summary", str(ts_summary)])
    if threshold is not None:
        args.extend(["--threshold", str(threshold)])
    if update:
        args.append("--update")

    return subprocess.run(
        args,
        capture_output=True,
        text=True,
        cwd=REPO_ROOT,
    )


class TestCoverageDeltaCheck:
    """Tests for the delta comparison mode."""

    def test_passes_when_coverage_unchanged(self, tmp_path: Path) -> None:
        """Should pass when current coverage matches baseline exactly."""
        baseline = tmp_path / "baseline.json"
        python_cov = tmp_path / "coverage.xml"
        ts_cov = tmp_path / "lcov.info"

        write_baseline(
            baseline,
            python_lines=80.0,
            ts={"lines": 70.0, "statements": 70.0, "branches": 60.0, "functions": 65.0},
        )
        write_cobertura_xml(python_cov, 0.80)
        write_lcov(
            ts_cov,
            lines_found=100,
            lines_hit=70,
            funcs_found=100,
            funcs_hit=65,
            branches_found=100,
            branches_hit=60,
        )

        result = run_script(
            tmp_path, baseline=baseline, python_cov=python_cov, ts_cov=ts_cov
        )
        assert result.returncode == 0, f"Expected pass:\n{result.stdout}"
        assert "[OK]" in result.stdout

    def test_passes_when_coverage_improves(self, tmp_path: Path) -> None:
        """Should pass when current coverage is higher than baseline."""
        baseline = tmp_path / "baseline.json"
        python_cov = tmp_path / "coverage.xml"
        ts_cov = tmp_path / "lcov.info"

        write_baseline(
            baseline,
            python_lines=75.0,
            ts={"lines": 65.0, "statements": 65.0, "branches": 55.0, "functions": 60.0},
        )
        write_cobertura_xml(python_cov, 0.85)  # +10% improvement
        write_lcov(
            ts_cov,
            lines_found=100,
            lines_hit=75,
            funcs_found=100,
            funcs_hit=70,
            branches_found=100,
            branches_hit=65,
        )

        result = run_script(
            tmp_path, baseline=baseline, python_cov=python_cov, ts_cov=ts_cov
        )
        assert result.returncode == 0

    def test_passes_within_threshold(self, tmp_path: Path) -> None:
        """Should pass when coverage drops but stays within threshold."""
        baseline = tmp_path / "baseline.json"
        python_cov = tmp_path / "coverage.xml"
        ts_cov = tmp_path / "lcov.info"

        write_baseline(
            baseline,
            python_lines=80.0,
            ts={"lines": 70.0, "statements": 70.0, "branches": 60.0, "functions": 65.0},
        )
        # Python drops 1.5% (within 2% threshold)
        write_cobertura_xml(python_cov, 0.785)
        write_lcov(
            ts_cov,
            lines_found=100,
            lines_hit=69,
            funcs_found=100,
            funcs_hit=64,
            branches_found=100,
            branches_hit=59,
        )

        result = run_script(
            tmp_path, baseline=baseline, python_cov=python_cov, ts_cov=ts_cov
        )
        assert result.returncode == 0

    def test_fails_when_python_drops_beyond_threshold(self, tmp_path: Path) -> None:
        """Should fail when Python coverage drops more than 2%."""
        baseline = tmp_path / "baseline.json"
        python_cov = tmp_path / "coverage.xml"
        ts_cov = tmp_path / "lcov.info"

        write_baseline(
            baseline,
            python_lines=80.0,
            ts={"lines": 70.0, "statements": 70.0, "branches": 60.0, "functions": 65.0},
        )
        # Python drops 5% (beyond 2% threshold)
        write_cobertura_xml(python_cov, 0.75)
        write_lcov(
            ts_cov,
            lines_found=100,
            lines_hit=70,
            funcs_found=100,
            funcs_hit=65,
            branches_found=100,
            branches_hit=60,
        )

        result = run_script(
            tmp_path, baseline=baseline, python_cov=python_cov, ts_cov=ts_cov
        )
        assert result.returncode == 1
        assert "[FAIL]" in result.stdout
        assert "Python" in result.stdout

    def test_fails_when_typescript_drops_beyond_threshold(self, tmp_path: Path) -> None:
        """Should fail when any TypeScript metric drops more than 2%."""
        baseline = tmp_path / "baseline.json"
        python_cov = tmp_path / "coverage.xml"
        ts_cov = tmp_path / "lcov.info"

        write_baseline(
            baseline,
            python_lines=80.0,
            ts={"lines": 70.0, "statements": 70.0, "branches": 60.0, "functions": 65.0},
        )
        write_cobertura_xml(python_cov, 0.80)
        # TS branches drop from 60% to 50% (-10%)
        write_lcov(
            ts_cov,
            lines_found=100,
            lines_hit=70,
            funcs_found=100,
            funcs_hit=65,
            branches_found=100,
            branches_hit=50,
        )

        result = run_script(
            tmp_path, baseline=baseline, python_cov=python_cov, ts_cov=ts_cov
        )
        assert result.returncode == 1
        assert "branches" in result.stdout

    def test_custom_threshold(self, tmp_path: Path) -> None:
        """Custom threshold should override the default 2%."""
        baseline = tmp_path / "baseline.json"
        python_cov = tmp_path / "coverage.xml"
        ts_cov = tmp_path / "lcov.info"

        write_baseline(
            baseline,
            python_lines=80.0,
            ts={"lines": 70.0, "statements": 70.0, "branches": 60.0, "functions": 65.0},
        )
        # Drop 3% — fails at 2% threshold but passes at 5%
        write_cobertura_xml(python_cov, 0.77)
        write_lcov(
            ts_cov,
            lines_found=100,
            lines_hit=70,
            funcs_found=100,
            funcs_hit=65,
            branches_found=100,
            branches_hit=60,
        )

        result_strict = run_script(
            tmp_path,
            baseline=baseline,
            python_cov=python_cov,
            ts_cov=ts_cov,
            threshold=2.0,
        )
        assert result_strict.returncode == 1

        result_lenient = run_script(
            tmp_path,
            baseline=baseline,
            python_cov=python_cov,
            ts_cov=ts_cov,
            threshold=5.0,
        )
        assert result_lenient.returncode == 0

    def test_output_includes_instructions(self, tmp_path: Path) -> None:
        """Failure output must tell the developer how to fix or update."""
        baseline = tmp_path / "baseline.json"
        python_cov = tmp_path / "coverage.xml"
        ts_cov = tmp_path / "lcov.info"

        write_baseline(
            baseline,
            python_lines=80.0,
            ts={"lines": 70.0, "statements": 70.0, "branches": 60.0, "functions": 65.0},
        )
        write_cobertura_xml(python_cov, 0.70)
        write_lcov(
            ts_cov,
            lines_found=100,
            lines_hit=70,
            funcs_found=100,
            funcs_hit=65,
            branches_found=100,
            branches_hit=60,
        )

        result = run_script(
            tmp_path, baseline=baseline, python_cov=python_cov, ts_cov=ts_cov
        )
        assert result.returncode == 1
        assert "--update" in result.stdout
        assert "[threshold-update]" in result.stdout


class TestCoverageDeltaUpdate:
    """Tests for the --update mode."""

    def test_creates_baseline_file(self, tmp_path: Path) -> None:
        """--update should create a new baseline from current coverage."""
        baseline = tmp_path / "baseline.json"
        python_cov = tmp_path / "coverage.xml"
        ts_cov = tmp_path / "lcov.info"

        write_cobertura_xml(python_cov, 0.82)
        write_lcov(
            ts_cov,
            lines_found=100,
            lines_hit=74,
            funcs_found=100,
            funcs_hit=72,
            branches_found=100,
            branches_hit=67,
        )

        result = run_script(
            tmp_path,
            baseline=baseline,
            python_cov=python_cov,
            ts_cov=ts_cov,
            update=True,
        )
        assert result.returncode == 0
        assert baseline.exists()

        data = json.loads(baseline.read_text(encoding="utf-8"))
        assert data["version"] == 1
        assert data["python"]["lines"] == 82.0
        assert data["typescript"]["lines"] == 74.0
        assert data["typescript"]["functions"] == 72.0
        assert data["typescript"]["branches"] == 67.0
        assert "updated_at" in data

    def test_update_fails_without_coverage_files(self, tmp_path: Path) -> None:
        """--update should fail if coverage files don't exist."""
        baseline = tmp_path / "baseline.json"
        missing_python = tmp_path / "nope.xml"
        missing_ts = tmp_path / "nope.info"

        result = run_script(
            tmp_path,
            baseline=baseline,
            python_cov=missing_python,
            ts_cov=missing_ts,
            update=True,
        )
        assert result.returncode == 1


class TestCoverageDeltaEdgeCases:
    """Edge cases and error handling."""

    def test_missing_baseline_skips_gracefully(self, tmp_path: Path) -> None:
        """Should skip (not crash) when baseline file doesn't exist."""
        baseline = tmp_path / "nonexistent.json"
        python_cov = tmp_path / "coverage.xml"
        ts_cov = tmp_path / "lcov.info"

        write_cobertura_xml(python_cov, 0.80)
        write_lcov(ts_cov)

        result = run_script(
            tmp_path, baseline=baseline, python_cov=python_cov, ts_cov=ts_cov
        )
        assert result.returncode == 0
        assert "[WARN]" in result.stdout

    def test_invalid_baseline_json_skips_gracefully(self, tmp_path: Path) -> None:
        """Should skip when baseline file contains invalid JSON."""
        baseline = tmp_path / "baseline.json"
        baseline.write_text("not json{{{", encoding="utf-8")
        python_cov = tmp_path / "coverage.xml"
        ts_cov = tmp_path / "lcov.info"

        write_cobertura_xml(python_cov, 0.80)
        write_lcov(ts_cov)

        result = run_script(
            tmp_path, baseline=baseline, python_cov=python_cov, ts_cov=ts_cov
        )
        assert result.returncode == 0
        assert "[WARN]" in result.stdout

    def test_wrong_baseline_version_skips_gracefully(self, tmp_path: Path) -> None:
        """Should skip when baseline has unsupported version."""
        baseline = tmp_path / "baseline.json"
        baseline.write_text(
            json.dumps({"version": 999, "python": {}, "typescript": {}}),
            encoding="utf-8",
        )
        python_cov = tmp_path / "coverage.xml"
        ts_cov = tmp_path / "lcov.info"

        write_cobertura_xml(python_cov, 0.80)
        write_lcov(ts_cov)

        result = run_script(
            tmp_path, baseline=baseline, python_cov=python_cov, ts_cov=ts_cov
        )
        assert result.returncode == 0
        assert "[WARN]" in result.stdout

    def test_missing_coverage_files_skips_gracefully(self, tmp_path: Path) -> None:
        """Should skip when coverage files don't exist (tests weren't run)."""
        baseline = tmp_path / "baseline.json"
        write_baseline(
            baseline,
            python_lines=80.0,
            ts={"lines": 70.0, "statements": 70.0, "branches": 60.0, "functions": 65.0},
        )

        result = run_script(
            tmp_path,
            baseline=baseline,
            python_cov=tmp_path / "nope.xml",
            ts_cov=tmp_path / "nope.info",
        )
        assert result.returncode == 0
        assert "[WARN]" in result.stdout

    def test_script_exists(self) -> None:
        """The coverage delta script must exist."""
        assert SCRIPT.is_file()


class TestStatementsCoverageParity:
    """Tests for real statements coverage from coverage-summary.json."""

    def test_statements_parsed_from_summary_not_lcov_lines(
        self, tmp_path: Path
    ) -> None:
        """Statements must come from coverage-summary.json, not LCOV lines.

        This is the test that would have caught the original bug: if
        statements is hardcoded to lines, changing only the summary JSON
        will not affect the check.
        """
        baseline = tmp_path / "baseline.json"
        python_cov = tmp_path / "coverage.xml"
        ts_cov = tmp_path / "lcov.info"
        ts_summary = tmp_path / "coverage-summary.json"

        # LCOV says lines=80%, but summary says statements=75%
        write_baseline(
            baseline,
            python_lines=80.0,
            ts={"lines": 80.0, "statements": 75.0, "branches": 75.0, "functions": 80.0},
        )
        write_cobertura_xml(python_cov, 0.80)
        write_lcov(
            ts_cov,
            lines_found=100,
            lines_hit=80,
            branches_found=100,
            branches_hit=75,
            funcs_found=100,
            funcs_hit=80,
        )
        write_coverage_summary(ts_summary, statements_total=100, statements_covered=75)

        # Should pass — statements baseline=75% matches summary=75%
        result = run_script(
            tmp_path,
            baseline=baseline,
            python_cov=python_cov,
            ts_cov=ts_cov,
            ts_summary=ts_summary,
        )
        assert result.returncode == 0, f"Expected pass:\n{result.stdout}"

    def test_statements_delta_caught_independently_of_lines(
        self, tmp_path: Path
    ) -> None:
        """A statements drop must fail even when lines are unchanged.

        Baseline: lines=80%, statements=78%.
        Current: lines=80% (unchanged), statements=74% (dropped 4%).
        Should FAIL because statements dropped beyond 2% threshold.
        """
        baseline = tmp_path / "baseline.json"
        python_cov = tmp_path / "coverage.xml"
        ts_cov = tmp_path / "lcov.info"
        ts_summary = tmp_path / "coverage-summary.json"

        write_baseline(
            baseline,
            python_lines=80.0,
            ts={"lines": 80.0, "statements": 78.0, "branches": 75.0, "functions": 80.0},
        )
        write_cobertura_xml(python_cov, 0.80)
        write_lcov(
            ts_cov,
            lines_found=100,
            lines_hit=80,
            branches_found=100,
            branches_hit=75,
            funcs_found=100,
            funcs_hit=80,
        )
        # statements dropped to 74% (delta = -4%, exceeds 2% threshold)
        write_coverage_summary(ts_summary, statements_total=100, statements_covered=74)

        result = run_script(
            tmp_path,
            baseline=baseline,
            python_cov=python_cov,
            ts_cov=ts_cov,
            ts_summary=ts_summary,
        )
        assert result.returncode == 1, (
            f"Expected FAIL on statements drop:\n{result.stdout}"
        )
        assert "[FAIL]" in result.stdout
        assert "statements" in result.stdout

    def test_falls_back_to_lines_when_summary_unavailable(self, tmp_path: Path) -> None:
        """Without coverage-summary.json, statements falls back to lines with a warning."""
        baseline = tmp_path / "baseline.json"
        python_cov = tmp_path / "coverage.xml"
        ts_cov = tmp_path / "lcov.info"
        nonexistent_summary = tmp_path / "no-such-file.json"

        write_baseline(
            baseline,
            python_lines=80.0,
            ts={"lines": 80.0, "statements": 80.0, "branches": 75.0, "functions": 80.0},
        )
        write_cobertura_xml(python_cov, 0.80)
        write_lcov(
            ts_cov,
            lines_found=100,
            lines_hit=80,
            branches_found=100,
            branches_hit=75,
            funcs_found=100,
            funcs_hit=80,
        )

        result = run_script(
            tmp_path,
            baseline=baseline,
            python_cov=python_cov,
            ts_cov=ts_cov,
            ts_summary=nonexistent_summary,
        )
        assert result.returncode == 0, f"Expected pass (fallback):\n{result.stdout}"
        assert "[WARN]" in result.stdout
        assert "coverage-summary.json" in result.stdout


class TestThresholdScriptGitLogScope:
    """Verify check_threshold_changes.py git log uses two-dot range."""

    def test_git_log_uses_two_dot_range_not_symmetric_difference(self) -> None:
        """Threshold marker scan via git log must use branch-only range.

        git log A...B (three-dot) includes commits on both sides of the
        merge base. git log A..B (two-dot) scans only branch-local commits.
        Note: git diff A...B is CORRECT (diff since merge base) and should
        NOT be changed.
        """
        threshold_script = REPO_ROOT / "scripts" / "check_threshold_changes.py"
        source = threshold_script.read_text(encoding="utf-8")
        # Extract only git log lines (not git diff lines)
        log_lines = [
            line for line in source.splitlines() if "log" in line and "HEAD" in line
        ]
        assert len(log_lines) > 0, "Expected at least one git log line with HEAD"
        for line in log_lines:
            assert "..HEAD" in line, f"git log line should use two-dot range: {line}"
            assert "...HEAD" not in line, (
                f"git log line must NOT use three-dot range: {line}"
            )
