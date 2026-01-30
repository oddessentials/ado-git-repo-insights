"""Tests for .github/scripts/get-coverage-actuals.py.

This module provides comprehensive test coverage for the coverage actuals
script which computes recommended thresholds using the ratchet formula.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType

import pytest

# Load module with hyphenated filename using importlib
SCRIPTS_DIR = (Path(__file__).parent.parent.parent / ".github" / "scripts").resolve()
_module_path = SCRIPTS_DIR / "get-coverage-actuals.py"
_spec = importlib.util.spec_from_file_location("get_coverage_actuals", _module_path)
assert _spec is not None
assert _spec.loader is not None
_module: ModuleType = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_module)

# Extract functions from the loaded module
compute_recommended_threshold = _module.compute_recommended_threshold
generate_report = _module.generate_report
main = _module.main
parse_coverage_xml = _module.parse_coverage_xml
parse_jest_thresholds = _module.parse_jest_thresholds
parse_lcov_detailed = _module.parse_lcov_detailed
parse_python_threshold = _module.parse_python_threshold


class TestComputeRecommendedThreshold:
    """Test the ratchet formula: floor(actual - 2.0)."""

    @pytest.mark.parametrize(
        ("actual", "expected"),
        [
            (75.65, 73),  # Normal case
            (50.0, 48),  # Exact integer
            (50.5, 48),  # Just above integer
            (51.99, 49),  # Just below next integer
            (100.0, 98),  # Maximum coverage
            (2.0, 0),  # Minimum positive result
            (1.5, -1),  # Negative result (edge case)
            (0.0, -2),  # Zero coverage
            (99.99, 97),  # Near maximum
            (10.01, 8),  # Small coverage
        ],
    )
    def test_ratchet_formula(self, actual: float, expected: int) -> None:
        """Verify floor(actual - 2.0) formula produces correct results."""
        assert compute_recommended_threshold(actual) == expected


class TestParseCoverageXml:
    """Test Cobertura XML parsing."""

    def test_valid_xml_extracts_line_rate(self, tmp_path: Path) -> None:
        """Valid coverage.xml returns correct percentage."""
        coverage_xml = tmp_path / "coverage.xml"
        coverage_xml.write_text(
            '<?xml version="1.0" ?>\n'
            '<coverage line-rate="0.7565" branch-rate="0.50">\n'
            "  <packages/>\n"
            "</coverage>\n",
            encoding="utf-8",
        )

        result = parse_coverage_xml(coverage_xml)

        assert result == 75.65

    def test_rounds_to_two_decimals(self, tmp_path: Path) -> None:
        """Coverage percentage is rounded to 2 decimal places."""
        coverage_xml = tmp_path / "coverage.xml"
        coverage_xml.write_text(
            '<?xml version="1.0" ?>\n<coverage line-rate="0.756789">\n</coverage>\n',
            encoding="utf-8",
        )

        result = parse_coverage_xml(coverage_xml)

        assert result == 75.68  # 75.6789 rounded to 2 decimals

    def test_file_not_found_raises_error(self, tmp_path: Path) -> None:
        """Missing file raises FileNotFoundError."""
        missing_path = tmp_path / "nonexistent.xml"

        with pytest.raises(FileNotFoundError, match="not found"):
            parse_coverage_xml(missing_path)

    def test_malformed_xml_raises_value_error(self, tmp_path: Path) -> None:
        """Malformed XML raises ValueError."""
        coverage_xml = tmp_path / "coverage.xml"
        coverage_xml.write_text("<coverage line-rate=", encoding="utf-8")

        with pytest.raises(ValueError, match="Malformed XML"):
            parse_coverage_xml(coverage_xml)

    def test_missing_line_rate_raises_value_error(self, tmp_path: Path) -> None:
        """XML without line-rate attribute raises ValueError."""
        coverage_xml = tmp_path / "coverage.xml"
        coverage_xml.write_text(
            '<?xml version="1.0" ?>\n<coverage branch-rate="0.50">\n</coverage>\n',
            encoding="utf-8",
        )

        with pytest.raises(ValueError, match="Missing line-rate"):
            parse_coverage_xml(coverage_xml)

    def test_invalid_line_rate_value_raises_error(self, tmp_path: Path) -> None:
        """Invalid line-rate value raises ValueError."""
        coverage_xml = tmp_path / "coverage.xml"
        coverage_xml.write_text(
            '<?xml version="1.0" ?>\n'
            '<coverage line-rate="not-a-number">\n'
            "</coverage>\n",
            encoding="utf-8",
        )

        with pytest.raises(ValueError, match="Invalid line-rate"):
            parse_coverage_xml(coverage_xml)

    def test_out_of_range_coverage_raises_error(self, tmp_path: Path) -> None:
        """Coverage percentage > 100% raises ValueError."""
        coverage_xml = tmp_path / "coverage.xml"
        coverage_xml.write_text(
            '<?xml version="1.0" ?>\n'
            '<coverage line-rate="1.50">\n'  # 150% is invalid
            "</coverage>\n",
            encoding="utf-8",
        )

        with pytest.raises(ValueError, match="out of range"):
            parse_coverage_xml(coverage_xml)

    def test_zero_coverage_is_valid(self, tmp_path: Path) -> None:
        """Zero coverage (0.0) is a valid result."""
        coverage_xml = tmp_path / "coverage.xml"
        coverage_xml.write_text(
            '<?xml version="1.0" ?>\n<coverage line-rate="0.0">\n</coverage>\n',
            encoding="utf-8",
        )

        result = parse_coverage_xml(coverage_xml)

        assert result == 0.0

    def test_full_coverage_is_valid(self, tmp_path: Path) -> None:
        """Full coverage (100%) is a valid result."""
        coverage_xml = tmp_path / "coverage.xml"
        coverage_xml.write_text(
            '<?xml version="1.0" ?>\n<coverage line-rate="1.0">\n</coverage>\n',
            encoding="utf-8",
        )

        result = parse_coverage_xml(coverage_xml)

        assert result == 100.0


class TestParseLcovDetailed:
    """Test LCOV file parsing."""

    def test_valid_lcov_extracts_all_metrics(self, tmp_path: Path) -> None:
        """Valid lcov.info returns all coverage metrics."""
        lcov_file = tmp_path / "lcov.info"
        lcov_file.write_text(
            "TN:\n"
            "SF:/path/to/file1.ts\n"
            "FNF:10\n"
            "FNH:8\n"
            "LF:100\n"
            "LH:75\n"
            "BRF:20\n"
            "BRH:15\n"
            "end_of_record\n",
            encoding="utf-8",
        )

        result = parse_lcov_detailed(lcov_file)

        assert result["lines"] == 75.0
        assert result["statements"] == 75.0  # Same as lines in LCOV
        assert result["functions"] == 80.0
        assert result["branches"] == 75.0

    def test_aggregates_multiple_source_files(self, tmp_path: Path) -> None:
        """Metrics are aggregated across multiple source files."""
        lcov_file = tmp_path / "lcov.info"
        lcov_file.write_text(
            "TN:\n"
            "SF:/path/to/file1.ts\n"
            "FNF:10\n"
            "FNH:10\n"
            "LF:100\n"
            "LH:100\n"
            "BRF:20\n"
            "BRH:20\n"
            "end_of_record\n"
            "TN:\n"
            "SF:/path/to/file2.ts\n"
            "FNF:10\n"
            "FNH:0\n"  # No functions covered
            "LF:100\n"
            "LH:50\n"  # 50% lines covered
            "BRF:20\n"
            "BRH:0\n"  # No branches covered
            "end_of_record\n",
            encoding="utf-8",
        )

        result = parse_lcov_detailed(lcov_file)

        # Totals: 200 lines, 150 hit = 75%
        assert result["lines"] == 75.0
        # Totals: 20 functions, 10 hit = 50%
        assert result["functions"] == 50.0
        # Totals: 40 branches, 20 hit = 50%
        assert result["branches"] == 50.0

    def test_division_by_zero_returns_zero(self, tmp_path: Path) -> None:
        """Files with no coverage items return 0.0, not error."""
        lcov_file = tmp_path / "lcov.info"
        lcov_file.write_text(
            "TN:\n"
            "SF:/path/to/empty.ts\n"
            "FNF:0\n"
            "FNH:0\n"
            "LF:0\n"
            "LH:0\n"
            "BRF:0\n"
            "BRH:0\n"
            "end_of_record\n",
            encoding="utf-8",
        )

        result = parse_lcov_detailed(lcov_file)

        assert result["lines"] == 0.0
        assert result["functions"] == 0.0
        assert result["branches"] == 0.0

    def test_file_not_found_raises_error(self, tmp_path: Path) -> None:
        """Missing file raises FileNotFoundError."""
        missing_path = tmp_path / "nonexistent.info"

        with pytest.raises(FileNotFoundError, match="not found"):
            parse_lcov_detailed(missing_path)

    def test_malformed_value_raises_error(self, tmp_path: Path) -> None:
        """Malformed numeric value raises ValueError."""
        lcov_file = tmp_path / "lcov.info"
        lcov_file.write_text(
            "TN:\nSF:/path/to/file.ts\nLF:not-a-number\nLH:50\nend_of_record\n",
            encoding="utf-8",
        )

        with pytest.raises(ValueError, match="Malformed LCOV"):
            parse_lcov_detailed(lcov_file)

    def test_rounds_to_two_decimals(self, tmp_path: Path) -> None:
        """Percentages are rounded to 2 decimal places."""
        lcov_file = tmp_path / "lcov.info"
        lcov_file.write_text(
            "TN:\n"
            "SF:/path/to/file.ts\n"
            "FNF:3\n"
            "FNH:1\n"  # 33.333...%
            "LF:100\n"
            "LH:75\n"
            "BRF:10\n"
            "BRH:3\n"
            "end_of_record\n",
            encoding="utf-8",
        )

        result = parse_lcov_detailed(lcov_file)

        assert result["functions"] == 33.33  # Rounded to 2 decimals

    def test_empty_file_returns_zeros(self, tmp_path: Path) -> None:
        """Empty LCOV file returns zeros (no records found)."""
        lcov_file = tmp_path / "lcov.info"
        lcov_file.write_text("", encoding="utf-8")

        result = parse_lcov_detailed(lcov_file)

        assert result["lines"] == 0.0
        assert result["functions"] == 0.0
        assert result["branches"] == 0.0


class TestParsePythonThreshold:
    """Test pyproject.toml fail_under extraction."""

    def test_valid_pyproject_extracts_threshold(self, tmp_path: Path) -> None:
        """Valid pyproject.toml returns correct threshold."""
        pyproject = tmp_path / "pyproject.toml"
        pyproject.write_text(
            "[tool.coverage.report]\nfail_under = 75\nshow_missing = true\n",
            encoding="utf-8",
        )

        result = parse_python_threshold(pyproject)

        assert result == 75

    def test_threshold_with_spaces(self, tmp_path: Path) -> None:
        """Handles various whitespace around fail_under."""
        pyproject = tmp_path / "pyproject.toml"
        pyproject.write_text(
            "[tool.coverage.report]\nfail_under   =   80\n",
            encoding="utf-8",
        )

        result = parse_python_threshold(pyproject)

        assert result == 80

    def test_file_not_found_raises_error(self, tmp_path: Path) -> None:
        """Missing file raises FileNotFoundError."""
        missing_path = tmp_path / "nonexistent.toml"

        with pytest.raises(FileNotFoundError, match="not found"):
            parse_python_threshold(missing_path)

    def test_missing_fail_under_raises_value_error(self, tmp_path: Path) -> None:
        """Missing fail_under key raises ValueError."""
        pyproject = tmp_path / "pyproject.toml"
        pyproject.write_text(
            "[tool.coverage.report]\nshow_missing = true\n",
            encoding="utf-8",
        )

        with pytest.raises(ValueError, match="fail_under not found"):
            parse_python_threshold(pyproject)

    def test_commented_fail_under_is_matched(self, tmp_path: Path) -> None:
        """Commented fail_under is matched - known regex limitation.

        The current regex implementation does not distinguish between
        commented and uncommented lines. This test documents that behavior.
        In practice, pyproject.toml files have uncommented fail_under values,
        so this limitation does not cause issues.
        """
        pyproject = tmp_path / "pyproject.toml"
        pyproject.write_text(
            "[tool.coverage.report]\n# fail_under = 75\nshow_missing = true\n",
            encoding="utf-8",
        )

        # The regex matches the commented line - this is a known limitation
        result = parse_python_threshold(pyproject)
        assert result == 75


class TestParseJestThresholds:
    """Test jest.config.ts threshold extraction."""

    def test_valid_jest_config_extracts_all_thresholds(self, tmp_path: Path) -> None:
        """Valid jest.config.ts returns all four thresholds."""
        jest_config = tmp_path / "jest.config.ts"
        jest_config.write_text(
            'import type { Config } from "jest";\n'
            "const config: Config = {\n"
            "  coverageThreshold: {\n"
            "    global: {\n"
            "      statements: 48,\n"
            "      branches: 43,\n"
            "      functions: 46,\n"
            "      lines: 49,\n"
            "    },\n"
            "  },\n"
            "};\n"
            "export default config;\n",
            encoding="utf-8",
        )

        result = parse_jest_thresholds(jest_config)

        assert result["statements"] == 48
        assert result["branches"] == 43
        assert result["functions"] == 46
        assert result["lines"] == 49

    def test_file_not_found_raises_error(self, tmp_path: Path) -> None:
        """Missing file raises FileNotFoundError."""
        missing_path = tmp_path / "nonexistent.ts"

        with pytest.raises(FileNotFoundError, match="not found"):
            parse_jest_thresholds(missing_path)

    @pytest.mark.parametrize(
        "missing_metric", ["statements", "branches", "functions", "lines"]
    )
    def test_missing_metric_raises_value_error(
        self, tmp_path: Path, missing_metric: str
    ) -> None:
        """Missing any metric raises ValueError."""
        metrics = {
            "statements": 48,
            "branches": 43,
            "functions": 46,
            "lines": 49,
        }
        # Remove one metric
        del metrics[missing_metric]

        jest_config = tmp_path / "jest.config.ts"
        content = "const config = {\n  coverageThreshold: {\n    global: {\n"
        for metric, value in metrics.items():
            content += f"      {metric}: {value},\n"
        content += "    },\n  },\n};\n"
        jest_config.write_text(content, encoding="utf-8")

        with pytest.raises(
            ValueError, match=f"Threshold for {missing_metric} not found"
        ):
            parse_jest_thresholds(jest_config)


class TestGenerateReport:
    """Test full report generation."""

    @pytest.fixture
    def complete_test_env(self, tmp_path: Path) -> dict[str, Path]:
        """Create a complete test environment with all required files."""
        # Coverage XML
        coverage_xml = tmp_path / "coverage.xml"
        coverage_xml.write_text(
            '<?xml version="1.0" ?>\n<coverage line-rate="0.7759">\n</coverage>\n',
            encoding="utf-8",
        )

        # LCOV info
        lcov_info = tmp_path / "lcov.info"
        lcov_info.write_text(
            "TN:\n"
            "SF:/path/to/file.ts\n"
            "FNF:100\n"
            "FNH:54\n"  # 54% functions
            "LF:200\n"
            "LH:126\n"  # 63% lines
            "BRF:50\n"
            "BRH:26\n"  # 52% branches
            "end_of_record\n",
            encoding="utf-8",
        )

        # pyproject.toml
        pyproject = tmp_path / "pyproject.toml"
        pyproject.write_text(
            "[tool.coverage.report]\nfail_under = 75\n",
            encoding="utf-8",
        )

        # jest.config.ts
        jest_config = tmp_path / "jest.config.ts"
        jest_config.write_text(
            "const config = {\n"
            "  coverageThreshold: {\n"
            "    global: {\n"
            "      statements: 48,\n"
            "      branches: 43,\n"
            "      functions: 46,\n"
            "      lines: 49,\n"
            "    },\n"
            "  },\n"
            "};\n",
            encoding="utf-8",
        )

        return {
            "python_coverage": coverage_xml,
            "ts_coverage": lcov_info,
            "pyproject": pyproject,
            "jest_config": jest_config,
        }

    def test_generates_complete_report(
        self, complete_test_env: dict[str, Path]
    ) -> None:
        """Report contains all expected fields."""
        report = generate_report(
            python_coverage_path=complete_test_env["python_coverage"],
            ts_coverage_path=complete_test_env["ts_coverage"],
            pyproject_path=complete_test_env["pyproject"],
            jest_config_path=complete_test_env["jest_config"],
        )

        # Verify structure
        assert "python" in report
        assert "typescript" in report
        assert "formula" in report
        assert "canonical_environment" in report

        # Verify Python metrics
        assert report["python"]["actual"] == 77.59
        assert report["python"]["threshold_current"] == 75
        assert report["python"]["threshold_recommended"] == 75  # floor(77.59 - 2)
        assert report["python"]["drift"] == 2.59

        # Verify TypeScript metrics
        for metric in ["statements", "branches", "functions", "lines"]:
            assert metric in report["typescript"]
            ts_metric = report["typescript"][metric]
            assert "actual" in ts_metric
            assert "threshold_current" in ts_metric
            assert "threshold_recommended" in ts_metric
            assert "drift" in ts_metric

        # Verify formula
        assert report["formula"] == "threshold = floor(actual_coverage - 2.0)"

    def test_drift_calculation(self, complete_test_env: dict[str, Path]) -> None:
        """Drift is correctly calculated as actual - threshold_current."""
        report = generate_report(
            python_coverage_path=complete_test_env["python_coverage"],
            ts_coverage_path=complete_test_env["ts_coverage"],
            pyproject_path=complete_test_env["pyproject"],
            jest_config_path=complete_test_env["jest_config"],
        )

        # Python: 77.59 - 75 = 2.59
        assert report["python"]["drift"] == 2.59

        # TypeScript lines: 63.0 - 49 = 14.0
        assert report["typescript"]["lines"]["drift"] == 14.0

    def test_propagates_parser_errors(self, tmp_path: Path) -> None:
        """Errors from child parsers propagate correctly."""
        with pytest.raises(FileNotFoundError):
            generate_report(
                python_coverage_path=tmp_path / "missing.xml",
                ts_coverage_path=tmp_path / "missing.info",
                pyproject_path=tmp_path / "missing.toml",
                jest_config_path=tmp_path / "missing.ts",
            )


class TestMain:
    """Test CLI entry point."""

    @pytest.fixture
    def complete_test_env(self, tmp_path: Path) -> dict[str, Path]:
        """Create a complete test environment with all required files."""
        # Coverage XML
        coverage_xml = tmp_path / "coverage.xml"
        coverage_xml.write_text(
            '<?xml version="1.0" ?>\n<coverage line-rate="0.80">\n</coverage>\n',
            encoding="utf-8",
        )

        # LCOV info
        lcov_info = tmp_path / "lcov.info"
        lcov_info.write_text(
            "TN:\n"
            "SF:/path/to/file.ts\n"
            "FNF:100\n"
            "FNH:60\n"
            "LF:200\n"
            "LH:130\n"
            "BRF:50\n"
            "BRH:30\n"
            "end_of_record\n",
            encoding="utf-8",
        )

        # pyproject.toml
        pyproject = tmp_path / "pyproject.toml"
        pyproject.write_text(
            "[tool.coverage.report]\nfail_under = 75\n",
            encoding="utf-8",
        )

        # jest.config.ts
        jest_config = tmp_path / "jest.config.ts"
        jest_config.write_text(
            "const config = {\n"
            "  coverageThreshold: {\n"
            "    global: {\n"
            "      statements: 55,\n"
            "      branches: 49,\n"
            "      functions: 51,\n"
            "      lines: 56,\n"
            "    },\n"
            "  },\n"
            "};\n",
            encoding="utf-8",
        )

        return {
            "python_coverage": coverage_xml,
            "ts_coverage": lcov_info,
            "pyproject": pyproject,
            "jest_config": jest_config,
        }

    def test_returns_0_on_success(
        self, monkeypatch: pytest.MonkeyPatch, complete_test_env: dict[str, Path]
    ) -> None:
        """CLI returns 0 on successful report generation."""
        monkeypatch.setattr(
            "sys.argv",
            [
                "get-coverage-actuals.py",
                "--python-coverage",
                str(complete_test_env["python_coverage"]),
                "--ts-coverage",
                str(complete_test_env["ts_coverage"]),
                "--pyproject",
                str(complete_test_env["pyproject"]),
                "--jest-config",
                str(complete_test_env["jest_config"]),
            ],
        )

        result = main()

        assert result == 0

    def test_returns_1_on_missing_files(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        """CLI returns 1 when required files are missing."""
        monkeypatch.setattr(
            "sys.argv",
            [
                "get-coverage-actuals.py",
                "--python-coverage",
                str(tmp_path / "missing.xml"),
                "--ts-coverage",
                str(tmp_path / "missing.info"),
                "--pyproject",
                str(tmp_path / "missing.toml"),
                "--jest-config",
                str(tmp_path / "missing.ts"),
            ],
        )

        result = main()

        assert result == 1

    def test_custom_paths_work(
        self, monkeypatch: pytest.MonkeyPatch, complete_test_env: dict[str, Path]
    ) -> None:
        """Custom path arguments are properly used."""
        # Rename files to non-default locations
        custom_xml = complete_test_env["python_coverage"].parent / "custom.xml"
        complete_test_env["python_coverage"].rename(custom_xml)

        custom_lcov = complete_test_env["ts_coverage"].parent / "custom.info"
        complete_test_env["ts_coverage"].rename(custom_lcov)

        monkeypatch.setattr(
            "sys.argv",
            [
                "get-coverage-actuals.py",
                "--python-coverage",
                str(custom_xml),
                "--ts-coverage",
                str(custom_lcov),
                "--pyproject",
                str(complete_test_env["pyproject"]),
                "--jest-config",
                str(complete_test_env["jest_config"]),
            ],
        )

        result = main()

        assert result == 0

    def test_output_to_file(
        self,
        monkeypatch: pytest.MonkeyPatch,
        complete_test_env: dict[str, Path],
        tmp_path: Path,
    ) -> None:
        """--output flag writes JSON to specified file."""
        import json

        output_file = tmp_path / "report.json"

        monkeypatch.setattr(
            "sys.argv",
            [
                "get-coverage-actuals.py",
                "--python-coverage",
                str(complete_test_env["python_coverage"]),
                "--ts-coverage",
                str(complete_test_env["ts_coverage"]),
                "--pyproject",
                str(complete_test_env["pyproject"]),
                "--jest-config",
                str(complete_test_env["jest_config"]),
                "--output",
                str(output_file),
            ],
        )

        result = main()

        assert result == 0
        assert output_file.exists()

        # Verify valid JSON was written
        report = json.loads(output_file.read_text(encoding="utf-8"))
        assert "python" in report
        assert "typescript" in report

    def test_warning_when_drift_exceeds_threshold(
        self,
        monkeypatch: pytest.MonkeyPatch,
        complete_test_env: dict[str, Path],
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        """Warning is emitted when drift exceeds 2.0%."""
        # Modify pyproject to have a low threshold (creates high drift)
        pyproject = complete_test_env["pyproject"]
        pyproject.write_text(
            "[tool.coverage.report]\n"
            "fail_under = 70\n",  # 80% actual - 70% threshold = 10% drift
            encoding="utf-8",
        )

        monkeypatch.setattr(
            "sys.argv",
            [
                "get-coverage-actuals.py",
                "--python-coverage",
                str(complete_test_env["python_coverage"]),
                "--ts-coverage",
                str(complete_test_env["ts_coverage"]),
                "--pyproject",
                str(pyproject),
                "--jest-config",
                str(complete_test_env["jest_config"]),
            ],
        )

        result = main()

        assert result == 0
        captured = capsys.readouterr()
        assert "::warning::" in captured.err
        assert "drift" in captured.err.lower()

    def test_error_format_uses_prefix(
        self,
        monkeypatch: pytest.MonkeyPatch,
        tmp_path: Path,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        """Error messages use ::error:: prefix for CI visibility."""
        monkeypatch.setattr(
            "sys.argv",
            [
                "get-coverage-actuals.py",
                "--python-coverage",
                str(tmp_path / "missing.xml"),
                "--ts-coverage",
                str(tmp_path / "missing.info"),
                "--pyproject",
                str(tmp_path / "missing.toml"),
                "--jest-config",
                str(tmp_path / "missing.ts"),
            ],
        )

        result = main()

        assert result == 1
        captured = capsys.readouterr()
        assert "::error::" in captured.err


class TestStatementEqualsLines:
    """Verify that statements equals lines in LCOV format."""

    def test_statements_equals_lines(self, tmp_path: Path) -> None:
        """LCOV statements metric equals lines metric."""
        lcov_file = tmp_path / "lcov.info"
        lcov_file.write_text(
            "TN:\n"
            "SF:/path/to/file.ts\n"
            "FNF:10\n"
            "FNH:5\n"
            "LF:100\n"
            "LH:75\n"
            "BRF:20\n"
            "BRH:10\n"
            "end_of_record\n",
            encoding="utf-8",
        )

        result = parse_lcov_detailed(lcov_file)

        assert result["statements"] == result["lines"]
