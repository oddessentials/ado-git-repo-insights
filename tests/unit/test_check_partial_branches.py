"""Unit coverage for ``scripts/check_partial_branches.py``.

Exercises the lcov BRDA parser, the baseline comparator, and all three
failure categories (``COVERAGE_REGRESSION``, ``BASELINE_COCHANGE_REQUIRED``,
``SETUP``) against in-memory fixtures so the gate's semantics are locked.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from types import ModuleType

import pytest

REPO_ROOT = Path(__file__).parent.parent.parent
GATE_SCRIPT = REPO_ROOT / "scripts" / "check_partial_branches.py"


def _load_gate_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("check_partial_branches", GATE_SCRIPT)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["check_partial_branches"] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def gate():
    return _load_gate_module()


def _write_lcov(tmp_path: Path, body: str) -> Path:
    path = tmp_path / "lcov.info"
    path.write_text(body, encoding="utf-8")
    return path


def _write_baseline(tmp_path: Path, files: dict[str, int]) -> Path:
    payload = {
        "schema_version": 1,
        "generated_from": "fixture",
        "files": files,
    }
    path = tmp_path / "baseline.json"
    path.write_text(json.dumps(payload) + "\n", encoding="utf-8")
    return path


class TestParseLcovPartialBranches:
    def test_line_with_mixed_branches_is_counted(self, gate, tmp_path: Path) -> None:
        """A line with one taken branch and one missed branch is partial."""
        lcov = _write_lcov(
            tmp_path,
            "SF:ui/modules/metrics.ts\nBRDA:10,0,0,1\nBRDA:10,0,1,0\nend_of_record\n",
        )
        counts = gate.parse_lcov_partial_branches(lcov)
        assert counts == {"extension/ui/modules/metrics.ts": 1}

    def test_line_with_all_branches_taken_is_not_partial(
        self, gate, tmp_path: Path
    ) -> None:
        """If every BRDA at a line has taken > 0, the line is fully covered."""
        lcov = _write_lcov(
            tmp_path,
            "SF:ui/modules/metrics.ts\nBRDA:10,0,0,3\nBRDA:10,0,1,2\nend_of_record\n",
        )
        assert gate.parse_lcov_partial_branches(lcov) == {}

    def test_line_with_all_branches_missed_is_not_partial(
        self, gate, tmp_path: Path
    ) -> None:
        """If every BRDA at a line has taken == 0, the line is uncovered,
        not partial (matches Codecov's definition)."""
        lcov = _write_lcov(
            tmp_path,
            "SF:ui/modules/metrics.ts\nBRDA:10,0,0,0\nBRDA:10,0,1,0\nend_of_record\n",
        )
        assert gate.parse_lcov_partial_branches(lcov) == {}

    def test_unreached_branch_points_are_ignored(self, gate, tmp_path: Path) -> None:
        """BRDA records with ``taken == '-'`` (unreached block) do not
        contribute to the partial or taken count."""
        lcov = _write_lcov(
            tmp_path,
            "SF:ui/modules/metrics.ts\nBRDA:10,0,0,-\nBRDA:10,0,1,-\nend_of_record\n",
        )
        assert gate.parse_lcov_partial_branches(lcov) == {}

    def test_windows_backslash_paths_are_normalized(self, gate, tmp_path: Path) -> None:
        """Windows-generated lcov uses backslashes; parser normalizes to
        forward slashes and roots at ``extension/``."""
        lcov = _write_lcov(
            tmp_path,
            "SF:ui\\modules\\metrics.ts\nBRDA:10,0,0,1\nBRDA:10,0,1,0\nend_of_record\n",
        )
        counts = gate.parse_lcov_partial_branches(lcov)
        assert counts == {"extension/ui/modules/metrics.ts": 1}

    def test_multiple_files_tracked_independently(self, gate, tmp_path: Path) -> None:
        lcov = _write_lcov(
            tmp_path,
            "SF:ui/modules/metrics.ts\n"
            "BRDA:10,0,0,1\n"
            "BRDA:10,0,1,0\n"
            "end_of_record\n"
            "SF:ui/modules/sdk.ts\n"
            "BRDA:20,0,0,1\n"
            "BRDA:20,0,1,0\n"
            "BRDA:30,0,0,1\n"
            "BRDA:30,0,1,0\n"
            "end_of_record\n",
        )
        counts = gate.parse_lcov_partial_branches(lcov)
        assert counts == {
            "extension/ui/modules/metrics.ts": 1,
            "extension/ui/modules/sdk.ts": 2,
        }

    def test_missing_lcov_raises(self, gate, tmp_path: Path) -> None:
        with pytest.raises(FileNotFoundError):
            gate.parse_lcov_partial_branches(tmp_path / "does-not-exist.info")


class TestParseLcovMalformedFailsClosed:
    """The parser must raise ValueError on any structurally invalid lcov
    input rather than silently returning an empty observation set.

    Silent-empty on malformed input would be reported by main() as
    BASELINE_COCHANGE_REQUIRED and suggest rewriting the baseline to {},
    which would effectively disable the ratchet after a coverage tooling
    break. These tests lock fail-closed behavior against that regression.
    """

    def test_truncated_brda_record_raises(self, gate, tmp_path: Path) -> None:
        lcov = _write_lcov(
            tmp_path,
            "SF:ui/modules/a.ts\n"
            "BRDA:10,0\n"  # only 2 fields instead of 4
            "end_of_record\n",
        )
        with pytest.raises(ValueError, match="fewer than 4"):
            gate.parse_lcov_partial_branches(lcov)

    def test_non_integer_brda_line_number_raises(self, gate, tmp_path: Path) -> None:
        lcov = _write_lcov(
            tmp_path,
            "SF:ui/modules/a.ts\nBRDA:xyz,0,0,1\nend_of_record\n",
        )
        with pytest.raises(ValueError, match="line number is not an integer"):
            gate.parse_lcov_partial_branches(lcov)

    def test_non_integer_brda_taken_value_raises(self, gate, tmp_path: Path) -> None:
        lcov = _write_lcov(
            tmp_path,
            "SF:ui/modules/a.ts\nBRDA:10,0,0,notanumber\nend_of_record\n",
        )
        with pytest.raises(ValueError, match="taken value is neither"):
            gate.parse_lcov_partial_branches(lcov)

    def test_brda_before_any_sf_record_raises(self, gate, tmp_path: Path) -> None:
        lcov = _write_lcov(tmp_path, "BRDA:10,0,0,1\n")
        with pytest.raises(ValueError, match="outside any SF block"):
            gate.parse_lcov_partial_branches(lcov)

    def test_empty_lcov_with_no_sf_records_raises(self, gate, tmp_path: Path) -> None:
        lcov = _write_lcov(tmp_path, "TN:\n")
        with pytest.raises(ValueError, match="no SF records found"):
            gate.parse_lcov_partial_branches(lcov)

    def test_completely_empty_lcov_raises(self, gate, tmp_path: Path) -> None:
        lcov = _write_lcov(tmp_path, "")
        with pytest.raises(ValueError, match="no SF records found"):
            gate.parse_lcov_partial_branches(lcov)

    def test_truncated_lcov_missing_end_of_record_raises(
        self, gate, tmp_path: Path
    ) -> None:
        """An SF block without a closing `end_of_record` means the writer
        was interrupted. Accepting it as parsed would let compare() declare
        every baseline entry absent from lcov and suggest a baseline
        shrink — ratcheting the gate downward after a tooling failure.
        """
        lcov = _write_lcov(
            tmp_path,
            "SF:ui/modules/a.ts\n"
            "BRDA:10,0,0,1\n"
            "BRDA:10,0,1,0\n",  # no end_of_record — writer was killed here
        )
        with pytest.raises(ValueError, match="still open"):
            gate.parse_lcov_partial_branches(lcov)

    def test_truncated_lcov_between_files_raises(self, gate, tmp_path: Path) -> None:
        """Even if an earlier SF block closed cleanly, an unterminated
        later block must still fail — the writer was still interrupted."""
        lcov = _write_lcov(
            tmp_path,
            "SF:ui/modules/a.ts\n"
            "BRDA:10,0,0,1\n"
            "BRDA:10,0,1,0\n"
            "end_of_record\n"
            "SF:ui/modules/b.ts\n"
            "BRDA:20,0,0,1\n",  # second block unterminated
        )
        with pytest.raises(ValueError, match="still open"):
            gate.parse_lcov_partial_branches(lcov)


class TestNormalizeSourceFile:
    """Path normalization must anchor on ``extension/ui/`` when present so
    absolute SF: entries emitted by CI runners match the committed baseline
    keys, not some path-prefixed frankenstein like
    ``extension/home/runner/work/repo/extension/ui/a.ts``.
    """

    def test_relative_unix_path_is_prefixed(self, gate) -> None:
        assert (
            gate._normalize_source_file("ui/modules/a.ts")
            == "extension/ui/modules/a.ts"
        )

    def test_relative_windows_path_is_normalized(self, gate) -> None:
        assert (
            gate._normalize_source_file("ui\\modules\\a.ts")
            == "extension/ui/modules/a.ts"
        )

    def test_canonical_path_is_unchanged(self, gate) -> None:
        assert (
            gate._normalize_source_file("extension/ui/modules/a.ts")
            == "extension/ui/modules/a.ts"
        )

    def test_absolute_linux_path_anchors_on_extension_ui(self, gate) -> None:
        assert (
            gate._normalize_source_file(
                "/home/runner/work/repo/extension/ui/modules/a.ts"
            )
            == "extension/ui/modules/a.ts"
        )

    def test_absolute_macos_path_anchors_on_extension_ui(self, gate) -> None:
        assert (
            gate._normalize_source_file(
                "/Users/dev/code/ado-git-repo-insights/extension/ui/modules/a.ts"
            )
            == "extension/ui/modules/a.ts"
        )

    def test_absolute_windows_forward_slash_path_anchors(self, gate) -> None:
        assert (
            gate._normalize_source_file(
                "C:/projects/ado-git-repo-insights/extension/ui/modules/a.ts"
            )
            == "extension/ui/modules/a.ts"
        )

    def test_absolute_windows_backslash_path_anchors(self, gate) -> None:
        assert (
            gate._normalize_source_file(
                "C:\\projects\\ado-git-repo-insights\\extension\\ui\\modules\\a.ts"
            )
            == "extension/ui/modules/a.ts"
        )

    def test_first_extension_ui_occurrence_wins(self, gate) -> None:
        """Pathological nested case: the shallowest ``extension/ui/`` is
        the correct anchor. ``find()`` (not ``rfind()``) guarantees that."""
        assert (
            gate._normalize_source_file(
                "/var/lib/scratch/extension/ui/outer/extension/ui/inner.ts"
            )
            == "extension/ui/outer/extension/ui/inner.ts"
        )


class TestLoadBaseline:
    def test_valid_baseline_round_trips(self, gate, tmp_path: Path) -> None:
        path = _write_baseline(tmp_path, {"extension/ui/a.ts": 2})
        loaded = gate.load_baseline(path)
        assert loaded["schema_version"] == 1
        assert loaded["files"] == {"extension/ui/a.ts": 2}

    def test_wrong_schema_version_rejected(self, gate, tmp_path: Path) -> None:
        path = tmp_path / "baseline.json"
        path.write_text(
            json.dumps({"schema_version": 2, "generated_from": "x", "files": {}}),
            encoding="utf-8",
        )
        with pytest.raises(ValueError, match="schema version mismatch"):
            gate.load_baseline(path)

    def test_missing_generated_from_rejected(self, gate, tmp_path: Path) -> None:
        path = tmp_path / "baseline.json"
        path.write_text(
            json.dumps({"schema_version": 1, "files": {}}), encoding="utf-8"
        )
        with pytest.raises(ValueError, match="generated_from"):
            gate.load_baseline(path)

    def test_negative_count_rejected(self, gate, tmp_path: Path) -> None:
        path = tmp_path / "baseline.json"
        path.write_text(
            json.dumps(
                {
                    "schema_version": 1,
                    "generated_from": "x",
                    "files": {"extension/ui/a.ts": -1},
                }
            ),
            encoding="utf-8",
        )
        with pytest.raises(ValueError, match="non-negative"):
            gate.load_baseline(path)


class TestCompare:
    def test_no_drift_is_clean(self, gate) -> None:
        baseline = gate.BaselineFile(
            schema_version=1,
            generated_from="x",
            files={"extension/ui/a.ts": 3},
        )
        regressions, improvements, removed = gate.compare(
            {"extension/ui/a.ts": 3}, baseline
        )
        assert regressions == []
        assert improvements == []
        assert removed == []

    def test_observed_above_baseline_is_regression(self, gate) -> None:
        baseline = gate.BaselineFile(
            schema_version=1,
            generated_from="x",
            files={"extension/ui/a.ts": 3},
        )
        regressions, improvements, removed = gate.compare(
            {"extension/ui/a.ts": 5}, baseline
        )
        assert len(regressions) == 1
        assert "+2" in regressions[0]
        assert improvements == []
        assert removed == []

    def test_new_file_defaults_to_zero_allowed(self, gate) -> None:
        """A file not present in the baseline is treated as having a zero
        allowance, so ANY partial branches in a new file is a regression."""
        baseline = gate.BaselineFile(
            schema_version=1,
            generated_from="x",
            files={},
        )
        regressions, improvements, removed = gate.compare(
            {"extension/ui/new.ts": 1}, baseline
        )
        assert len(regressions) == 1
        assert "extension/ui/new.ts" in regressions[0]

    def test_observed_below_baseline_is_cochange(self, gate) -> None:
        baseline = gate.BaselineFile(
            schema_version=1,
            generated_from="x",
            files={"extension/ui/a.ts": 5},
        )
        regressions, improvements, removed = gate.compare(
            {"extension/ui/a.ts": 2}, baseline
        )
        assert regressions == []
        assert len(improvements) == 1
        assert "-3" in improvements[0]
        assert removed == []

    def test_baseline_file_missing_from_lcov_is_cochange(self, gate) -> None:
        baseline = gate.BaselineFile(
            schema_version=1,
            generated_from="x",
            files={"extension/ui/gone.ts": 4},
        )
        regressions, improvements, removed = gate.compare({}, baseline)
        assert regressions == []
        assert improvements == []
        assert len(removed) == 1
        assert "extension/ui/gone.ts" in removed[0]

    def test_baseline_explicit_zero_absent_from_lcov_is_clean(self, gate) -> None:
        """Regression lock for the LOCKED_ZERO_FILES coupling fix: a file
        recorded with an explicit ``0`` in the baseline must not trigger
        the ``removed``/``absent-from-lcov`` co-change path when it is
        missing from the observed map. ``parse_lcov_partial_branches``
        drops zero-count files, so the only way for compare to see a
        locked-at-zero file is via an absent-from-observed path. Treating
        explicit ``0`` as semantically identical to absent removes the
        brittle coupling where LOCKED_ZERO_FILES would rely on compare's
        co-change path to reject explicit-zero entries, and lets the
        baseline file shape carry either encoding interchangeably.
        """
        baseline = gate.BaselineFile(
            schema_version=1,
            generated_from="x",
            files={"extension/ui/locked.ts": 0},
        )
        regressions, improvements, removed = gate.compare({}, baseline)
        assert regressions == []
        assert improvements == []
        assert removed == []


class TestMainCli:
    def test_clean_state_exits_zero(
        self, gate, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        lcov = _write_lcov(
            tmp_path,
            "SF:ui/modules/a.ts\nBRDA:1,0,0,1\nBRDA:1,0,1,0\nend_of_record\n",
        )
        baseline = _write_baseline(tmp_path, {"extension/ui/modules/a.ts": 1})
        monkeypatch.setattr(
            sys, "argv", ["check", "--lcov", str(lcov), "--baseline", str(baseline)]
        )
        assert gate.main() == 0

    def test_regression_exits_nonzero(
        self, gate, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        lcov = _write_lcov(
            tmp_path,
            "SF:ui/modules/a.ts\n"
            "BRDA:1,0,0,1\n"
            "BRDA:1,0,1,0\n"
            "BRDA:2,0,0,1\n"
            "BRDA:2,0,1,0\n"
            "end_of_record\n",
        )
        baseline = _write_baseline(tmp_path, {"extension/ui/modules/a.ts": 1})
        monkeypatch.setattr(
            sys, "argv", ["check", "--lcov", str(lcov), "--baseline", str(baseline)]
        )
        assert gate.main() == 1

    def test_cochange_exits_nonzero(
        self,
        gate,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        lcov = _write_lcov(
            tmp_path,
            "SF:ui/modules/a.ts\nBRDA:1,0,0,1\nBRDA:1,0,1,0\nend_of_record\n",
        )
        baseline = _write_baseline(tmp_path, {"extension/ui/modules/a.ts": 5})
        monkeypatch.setattr(
            sys, "argv", ["check", "--lcov", str(lcov), "--baseline", str(baseline)]
        )
        assert gate.main() == 1
        captured = capsys.readouterr()
        assert "BASELINE_COCHANGE_REQUIRED" in captured.err
        assert '"extension/ui/modules/a.ts": 1' in captured.err

    def test_missing_lcov_exits_setup_error(
        self,
        gate,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        baseline = _write_baseline(tmp_path, {})
        monkeypatch.setattr(
            sys,
            "argv",
            [
                "check",
                "--lcov",
                str(tmp_path / "missing.info"),
                "--baseline",
                str(baseline),
            ],
        )
        assert gate.main() == 1
        captured = capsys.readouterr()
        assert "SETUP" in captured.err

    def test_malformed_lcov_exits_setup_not_cochange(
        self,
        gate,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        """Regression lock for P1 review: a truncated lcov must surface
        as a SETUP failure, not as BASELINE_COCHANGE_REQUIRED with an
        empty suggested baseline. The latter would trick a maintainer
        into committing a baseline that effectively disables the ratchet
        after a coverage tooling break.
        """
        truncated = _write_lcov(
            tmp_path,
            "SF:ui/modules/a.ts\n"
            "BRDA:10,0\n",  # truncated mid-record, missing end_of_record too
        )
        baseline = _write_baseline(tmp_path, {"extension/ui/modules/a.ts": 3})
        monkeypatch.setattr(
            sys,
            "argv",
            ["check", "--lcov", str(truncated), "--baseline", str(baseline)],
        )
        assert gate.main() == 1
        captured = capsys.readouterr()
        assert "SETUP" in captured.err
        assert "BASELINE_COCHANGE_REQUIRED" not in captured.err
        assert '"files": {}' not in captured.err

    def test_empty_lcov_exits_setup_not_cochange(
        self,
        gate,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        """Regression lock for P1 review: an lcov file with zero SF
        records (coverage tool crashed before emitting any source) must
        surface as a SETUP failure, not as a co-change that suggests
        wiping the baseline to {}.
        """
        empty = _write_lcov(tmp_path, "TN:\n")
        baseline = _write_baseline(tmp_path, {"extension/ui/modules/a.ts": 3})
        monkeypatch.setattr(
            sys,
            "argv",
            ["check", "--lcov", str(empty), "--baseline", str(baseline)],
        )
        assert gate.main() == 1
        captured = capsys.readouterr()
        assert "SETUP" in captured.err
        assert "BASELINE_COCHANGE_REQUIRED" not in captured.err

    def test_interrupted_lcov_exits_setup_not_cochange_shrink(
        self,
        gate,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        """Regression lock for the second P1 review: an lcov with an open
        SF block at EOF (writer interrupted mid-report) must surface as a
        SETUP failure, NOT as BASELINE_COCHANGE_REQUIRED with a shrunken
        suggested baseline. Without this lock, a tooling glitch could
        ratchet the committed baseline downward and permanently weaken
        the gate.

        The fixture writes a multi-file lcov whose second SF block is
        interrupted before `end_of_record`. The baseline has entries for
        both files; compare() would otherwise treat the second file as
        absent-from-lcov and emit a co-change patch removing it.
        """
        interrupted = _write_lcov(
            tmp_path,
            "SF:ui/modules/a.ts\n"
            "BRDA:10,0,0,1\n"
            "BRDA:10,0,1,0\n"
            "end_of_record\n"
            "SF:ui/modules/b.ts\n"
            "BRDA:20,0,0,1\n"
            "BRDA:20,0,1,0\n",  # no end_of_record — writer killed here
        )
        baseline = _write_baseline(
            tmp_path,
            {
                "extension/ui/modules/a.ts": 1,
                "extension/ui/modules/b.ts": 1,
            },
        )
        monkeypatch.setattr(
            sys,
            "argv",
            ["check", "--lcov", str(interrupted), "--baseline", str(baseline)],
        )
        assert gate.main() == 1
        captured = capsys.readouterr()
        assert "SETUP" in captured.err
        assert "BASELINE_COCHANGE_REQUIRED" not in captured.err
        # The gate must NOT print a co-change suggested baseline. The
        # suggested-baseline emission is keyed on the "Apply this exact
        # baseline (replaces " prefix; absence of that prefix proves the
        # gate short-circuited before ever running compare().
        assert "Apply this exact baseline" not in captured.err


class TestLockedZeroFiles:
    """The ``LOCKED_ZERO_FILES`` guard rejects any non-zero baseline entry
    for the four target files (#271 meta-lock). Absent or explicit-zero is
    accepted; anything else exits ``SETUP``.
    """

    def _lcov_zero_partials_for_locked_files(self) -> str:
        """Build an lcov body whose SF records for each locked file have
        zero partial-branch lines (both branches taken). This lets the
        checker reach the baseline-locked-zero check without tripping
        the regression gate first.
        """
        blocks = []
        for path in (
            "ui/modules/charts/throughput.ts",
            "ui/modules/metrics.ts",
            "ui/modules/sdk.ts",
            "ui/modules/typeahead-dropdown.ts",
        ):
            blocks.append(f"SF:{path}\nBRDA:1,0,0,1\nBRDA:1,0,1,1\nend_of_record\n")
        return "".join(blocks)

    def test_locked_files_absent_from_baseline_passes(
        self, gate, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Absent-from-baseline encodes "zero allowed" via the
        "absent defaults to 0" rule. The locked-zero check accepts any
        locked file missing from the baseline's ``files`` map.
        """
        lcov = _write_lcov(tmp_path, self._lcov_zero_partials_for_locked_files())
        baseline = _write_baseline(tmp_path, {})  # no entries for anything
        monkeypatch.setattr(
            sys, "argv", ["check", "--lcov", str(lcov), "--baseline", str(baseline)]
        )
        assert gate.main() == 0

    def test_locked_files_explicit_zero_in_baseline_passes(
        self, gate, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Explicit ``0`` entries are semantically identical to absent
        and must be accepted. ``compare()`` treats ``baseline_count == 0``
        as not-present for the purposes of the absent-from-lcov co-change
        path, so a maintainer writing ``"metrics.ts": 0`` explicitly into
        the baseline does not trip a spurious "file removed" signal.
        """
        lcov = _write_lcov(tmp_path, self._lcov_zero_partials_for_locked_files())
        baseline = _write_baseline(
            tmp_path,
            {
                "extension/ui/modules/charts/throughput.ts": 0,
                "extension/ui/modules/metrics.ts": 0,
                "extension/ui/modules/sdk.ts": 0,
                "extension/ui/modules/typeahead-dropdown.ts": 0,
            },
        )
        monkeypatch.setattr(
            sys, "argv", ["check", "--lcov", str(lcov), "--baseline", str(baseline)]
        )
        assert gate.main() == 0

    def test_locked_file_with_positive_baseline_fails_setup(
        self,
        gate,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        """A maintainer who tries to raise the baseline above zero for any
        locked file — even when the observed count would legitimately
        justify it — must be rejected with a SETUP error referencing the
        file path. This is the backslide guard."""
        # Observed lcov reports 1 partial line in metrics.ts. The baseline
        # reflects that observation. Without the lock, the gate would pass
        # (observed == baseline). With the lock, it must fail SETUP.
        lcov_body = (
            "SF:ui/modules/metrics.ts\nBRDA:10,0,0,1\nBRDA:10,0,1,0\nend_of_record\n"
        )
        lcov = _write_lcov(tmp_path, lcov_body)
        baseline = _write_baseline(tmp_path, {"extension/ui/modules/metrics.ts": 1})
        monkeypatch.setattr(
            sys, "argv", ["check", "--lcov", str(lcov), "--baseline", str(baseline)]
        )
        assert gate.main() == 1
        captured = capsys.readouterr()
        assert "SETUP" in captured.err
        assert "Locked-zero baseline violation" in captured.err
        assert "extension/ui/modules/metrics.ts" in captured.err
        # Must short-circuit BEFORE running compare(): no regression or
        # co-change signals should appear for this failure mode.
        assert "COVERAGE_REGRESSION" not in captured.err
        assert "BASELINE_COCHANGE_REQUIRED" not in captured.err

    def test_update_baseline_refuses_locked_file_with_nonzero_observed(
        self,
        gate,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        """Regression lock for the ``--update-baseline`` LOCKED_ZERO
        enforcement gap. Without this guard a maintainer running
        ``check_partial_branches.py --update-baseline`` after a locked
        file regresses would write a baseline with a non-zero entry for
        that file — which the subsequent normal run would immediately
        reject as ``SETUP`` via ``find_locked_zero_violations``. The
        helper must refuse the write upfront, point at the regression,
        and leave the baseline file untouched so the only actionable
        next step is for the maintainer to close the regression (or
        deliberately remove the locked-file invariant).
        """
        lcov = _write_lcov(
            tmp_path,
            "SF:ui/modules/metrics.ts\nBRDA:10,0,0,1\nBRDA:10,0,1,0\nend_of_record\n",
        )
        baseline_path = tmp_path / "baseline.json"
        original_body = (
            json.dumps(
                {
                    "schema_version": 1,
                    "generated_from": "x",
                    "files": {},
                }
            )
            + "\n"
        )
        baseline_path.write_text(original_body, encoding="utf-8")
        monkeypatch.setattr(
            sys,
            "argv",
            [
                "check",
                "--lcov",
                str(lcov),
                "--baseline",
                str(baseline_path),
                "--update-baseline",
            ],
        )
        assert gate.main() == 1
        captured = capsys.readouterr()
        assert "SETUP" in captured.err
        assert "locked-zero" in captured.err.lower()
        assert "extension/ui/modules/metrics.ts" in captured.err
        assert "observed=1" in captured.err

        # Critical invariant: the helper must not have written anything.
        # An unchanged baseline file is the regression lock — if a future
        # edit writes before the LOCKED_ZERO check, this assertion catches
        # it and points directly at the ordering mistake.
        assert baseline_path.read_text(encoding="utf-8") == original_body, (
            "baseline file must be untouched when --update-baseline refuses the write"
        )

    def test_update_baseline_allows_locked_file_at_zero_observed(
        self,
        gate,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Symmetric happy-path: when locked files have zero observed
        partials (as they should), ``--update-baseline`` proceeds normally
        and writes a baseline that excludes the locked files (they
        naturally have no observed entries to carry forward). This locks
        in that the new guard does not break the normal helper flow.
        """
        lcov = _write_lcov(
            tmp_path,
            self._lcov_zero_partials_for_locked_files() + "SF:ui/modules/other.ts\n"
            "BRDA:5,0,0,1\n"
            "BRDA:5,0,1,0\n"
            "end_of_record\n",
        )
        baseline_path = tmp_path / "baseline.json"
        baseline_path.write_text(
            json.dumps({"schema_version": 1, "generated_from": "x", "files": {}})
            + "\n",
            encoding="utf-8",
        )
        monkeypatch.setattr(
            sys,
            "argv",
            [
                "check",
                "--lcov",
                str(lcov),
                "--baseline",
                str(baseline_path),
                "--update-baseline",
            ],
        )
        assert gate.main() == 0
        updated = json.loads(baseline_path.read_text(encoding="utf-8"))
        # Locked files have zero observed partials, so they naturally
        # don't appear in the written baseline. other.ts does.
        assert "extension/ui/modules/metrics.ts" not in updated["files"]
        assert updated["files"].get("extension/ui/modules/other.ts") == 1

    def test_locked_zero_files_constant_contains_expected_paths(self, gate) -> None:
        """Structural assertion: the LOCKED_ZERO_FILES frozenset holds
        exactly the eight target files we have driven to zero — the four
        from #271 (metrics, sdk, typeahead-dropdown, throughput) plus the
        four from #277 (cycle-time, predictions, reviewer-activity,
        summary-cards). Adding or removing a locked file should be a
        deliberate, audited change that fails this test first."""
        assert gate.LOCKED_ZERO_FILES == frozenset(
            {
                "extension/ui/modules/charts/cycle-time.ts",
                "extension/ui/modules/charts/predictions.ts",
                "extension/ui/modules/charts/reviewer-activity.ts",
                "extension/ui/modules/charts/summary-cards.ts",
                "extension/ui/modules/charts/throughput.ts",
                "extension/ui/modules/metrics.ts",
                "extension/ui/modules/sdk.ts",
                "extension/ui/modules/typeahead-dropdown.ts",
            }
        )
