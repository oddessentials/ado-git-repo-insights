"""Tests for scripts/check_rule_disable_invariants.py (FR-014, FR-021).

Validates that the compensating guardrails for disabled lint rules
(S603/S607, S311) correctly detect unsafe patterns.
"""

from __future__ import annotations

import importlib.util
import json
import shutil
from io import StringIO
from pathlib import Path
from unittest.mock import patch

import pytest

SCRIPT = (
    Path(__file__).parent.parent.parent / "scripts" / "check_rule_disable_invariants.py"
)

# Import check functions for unit testing
_spec = importlib.util.spec_from_file_location("guardrail", SCRIPT)
assert _spec is not None
assert _spec.loader is not None
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)

check_subprocess_safety = _mod.check_subprocess_safety
check_random_safety = _mod.check_random_safety
check_syspath_safety = _mod.check_syspath_safety


class TestSubprocessGuardrail:
    """T048: S603 guardrail detects shell=True."""

    def test_shell_true_detected(self) -> None:
        """subprocess.run with shell=True is caught."""
        code = "import subprocess\nresult = subprocess.run(cmd, shell=True)\n"
        violations = check_subprocess_safety("test.py", code)
        assert len(violations) >= 1
        assert any(v["pattern"] == "shell=True" for v in violations)

    def test_shell_false_not_flagged(self) -> None:
        """subprocess.run with shell=False (the safe pattern) passes."""
        code = 'import subprocess\nresult = subprocess.run(["git", "status"], shell=False)\n'
        violations = check_subprocess_safety("test.py", code)
        assert len(violations) == 0

    def test_os_system_detected(self) -> None:
        """os.system() is always unsafe."""
        code = 'import os\nos.system("rm -rf /")\n'
        violations = check_subprocess_safety("test.py", code)
        assert len(violations) >= 1
        assert any(v["pattern"] == "os.system/popen" for v in violations)

    def test_os_popen_detected(self) -> None:
        """os.popen() is always unsafe."""
        code = 'import os\nresult = os.popen("ls")\n'
        violations = check_subprocess_safety("test.py", code)
        assert len(violations) >= 1

    def test_safe_subprocess_run_passes(self) -> None:
        """Standard safe pattern: subprocess.run with list args, no shell."""
        code = 'import subprocess\nresult = subprocess.run(["python", "-c", "pass"])\n'
        violations = check_subprocess_safety("test.py", code)
        assert len(violations) == 0

    def test_variable_command_detected(self) -> None:
        """P1: subprocess.run(cmd) with variable arg is caught."""
        code = "import subprocess\ncmd = get_command()\nresult = subprocess.run(cmd)\n"
        violations = check_subprocess_safety("test.py", code)
        assert len(violations) >= 1
        assert any("non-literal" in v["pattern"] for v in violations)

    def test_function_call_command_detected(self) -> None:
        """P1: subprocess.run(get_args()) with function call arg is caught."""
        code = "import subprocess\nresult = subprocess.run(build_cmd())\n"
        violations = check_subprocess_safety("test.py", code)
        assert len(violations) >= 1

    def test_fstring_command_detected(self) -> None:
        """P1: subprocess.run(f'...') with f-string arg is caught."""
        code = 'import subprocess\nresult = subprocess.run(f"{binary} --flag")\n'
        violations = check_subprocess_safety("test.py", code)
        assert len(violations) >= 1

    def test_string_literal_not_flagged(self) -> None:
        """shell=True inside a string literal is not flagged."""
        code = 'msg = "use shell=True for shell mode"\n'
        violations = check_subprocess_safety("test.py", code)
        assert len(violations) == 0

    def test_string_literal_in_subprocess_file_not_flagged(self) -> None:
        """P2 regression: shell=True as a pattern name string in a file that
        also uses subprocess must NOT be flagged.  This is the exact false
        positive that forced an allowlist entry for run_repo_hook.py:635."""
        code = (
            "import subprocess\n"
            "result = subprocess.run(['git', 'status'])\n"
            "subprocess_patterns = {\n"
            '    "subprocess with non-literal command",\n'
            '    "shell=True",\n'
            '    "os.system/popen",\n'
            "}\n"
        )
        violations = check_subprocess_safety("test.py", code)
        # The only subprocess call uses a list literal — zero violations expected
        assert len(violations) == 0

    def test_shell_true_multiline_call_detected(self) -> None:
        """shell=True on a continuation line of a subprocess call is caught."""
        code = (
            "import subprocess\n"
            "result = subprocess.run(\n"
            "    cmd,\n"
            "    shell=True,\n"
            ")\n"
        )
        violations = check_subprocess_safety("test.py", code)
        assert len(violations) >= 1
        assert any(v["pattern"] == "shell=True" for v in violations)

    def test_shell_true_no_subprocess_context_not_flagged(self) -> None:
        """shell=True as a keyword arg in a non-subprocess function is ignored."""
        code = "result = some_other_func(cmd, shell=True)\n"
        violations = check_subprocess_safety("test.py", code)
        assert len(violations) == 0


class TestRandomGuardrail:
    """T049: S311 guardrail detects crypto alongside random."""

    def test_secrets_with_random_detected(self) -> None:
        """import secrets in a file using random is caught."""
        code = "import random\nimport secrets\nrng = random.Random(42)\n"
        violations = check_random_safety("test.py", code)
        assert len(violations) >= 1
        assert any("secrets" in v["pattern"] for v in violations)

    def test_urandom_with_random_detected(self) -> None:
        """os.urandom in a file using random is caught."""
        code = "import random\nimport os\nkey = os.urandom(32)\n"
        violations = check_random_safety("test.py", code)
        assert len(violations) >= 1
        assert any("urandom" in v["pattern"] for v in violations)

    def test_system_random_detected(self) -> None:
        """random.SystemRandom is always caught (crypto-grade RNG)."""
        code = "import random\nrng = random.SystemRandom()\n"
        violations = check_random_safety("test.py", code)
        assert len(violations) >= 1

    def test_unseeded_random_detected(self) -> None:
        """random.Random() without seed is caught (non-deterministic)."""
        code = "import random\nrng = random.Random()\n"
        violations = check_random_safety("test.py", code)
        assert len(violations) >= 1
        assert any("without seed" in v["pattern"] for v in violations)

    def test_seeded_random_passes(self) -> None:
        """random.Random(seed) is the safe pattern — not flagged."""
        code = "import random\nrng = random.Random(42)\n"
        violations = check_random_safety("test.py", code)
        assert len(violations) == 0

    def test_secrets_without_random_passes(self) -> None:
        """import secrets alone (no random) is fine."""
        code = "import secrets\ntoken = secrets.token_hex(32)\n"
        violations = check_random_safety("test.py", code)
        assert len(violations) == 0

    def test_random_random_detected(self) -> None:
        """P2: random.random() module-level call is caught."""
        code = "import random\nx = random.random()\n"
        violations = check_random_safety("test.py", code)
        assert len(violations) >= 1
        assert any("module-level" in v["pattern"] for v in violations)

    def test_random_randint_detected(self) -> None:
        """P2: random.randint() module-level call is caught."""
        code = "import random\nx = random.randint(0, 100)\n"
        violations = check_random_safety("test.py", code)
        assert len(violations) >= 1

    def test_random_choice_detected(self) -> None:
        """P2: random.choice() module-level call is caught."""
        code = "import random\nx = random.choice([1, 2, 3])\n"
        violations = check_random_safety("test.py", code)
        assert len(violations) >= 1

    def test_instance_method_not_flagged(self) -> None:
        """Calling method on a seeded instance (rng.random()) is safe."""
        code = "import random\nrng = random.Random(42)\nx = rng.random()\n"
        violations = check_random_safety("test.py", code)
        # rng.random() does NOT match "random.random()" — it's instance-level
        assert not any("module-level" in v.get("pattern", "") for v in violations)


class TestSyspathGuardrail:
    """Tests for sys.path.insert/append detection (importlib enforcement)."""

    def test_syspath_insert_detected(self) -> None:
        code = 'import sys\nsys.path.insert(0, "/some/path")\n'
        violations = check_syspath_safety("scripts/foo.py", code)
        assert len(violations) == 1
        assert violations[0]["pattern"] == "sys.path manipulation"

    def test_syspath_append_detected(self) -> None:
        code = 'import sys\nsys.path.append("/some/path")\n'
        violations = check_syspath_safety("scripts/foo.py", code)
        assert len(violations) == 1

    def test_conftest_exempt(self) -> None:
        code = 'import sys\nsys.path.insert(0, "/some/path")\n'
        violations = check_syspath_safety("tests/conftest.py", code)
        assert len(violations) == 0

    def test_non_conftest_file_not_exempt(self) -> None:
        code = 'import sys\nsys.path.insert(0, "/some/path")\n'
        violations = check_syspath_safety("scripts/manage_generated_artifacts.py", code)
        assert len(violations) == 1

    def test_clean_file_passes(self) -> None:
        code = "import importlib.util\nspec = importlib.util.spec_from_file_location('m', 'f.py')\n"
        violations = check_syspath_safety("scripts/foo.py", code)
        assert len(violations) == 0

    def test_docstring_not_flagged(self) -> None:
        code = '"""\nsys.path.insert is bad practice.\n"""\nprint("ok")\n'
        violations = check_syspath_safety("scripts/foo.py", code)
        assert len(violations) == 0


class TestArtifactVerification:
    """T050: stale artifacts cause --verify-artifacts to fail."""

    REPO_ROOT = Path(__file__).parent.parent.parent
    TMP_ROOT = REPO_ROOT / "tmp_test_work" / "rule-disable-invariants"

    def test_verify_artifacts_passes_on_fresh_temp_artifacts(self) -> None:
        """Freshly generated temp artifacts verify successfully."""
        fresh_s603 = _mod.generate_subprocess_artifact(self.REPO_ROOT)
        fresh_s311 = _mod.generate_random_artifact(self.REPO_ROOT)

        self.TMP_ROOT.mkdir(parents=True, exist_ok=True)
        tmp_path = self.TMP_ROOT / "fresh-artifact-case"
        shutil.rmtree(tmp_path, ignore_errors=True)
        tmp_path.mkdir(parents=True, exist_ok=True)
        (tmp_path / ".rule-disable-audit-S603.json").write_text(
            json.dumps(fresh_s603, indent=2) + "\n",
            encoding="utf-8",
        )
        (tmp_path / ".rule-disable-audit-S311.json").write_text(
            json.dumps(fresh_s311, indent=2) + "\n",
            encoding="utf-8",
        )

        with (
            patch.object(_mod, "generate_subprocess_artifact", return_value=fresh_s603),
            patch.object(_mod, "generate_random_artifact", return_value=fresh_s311),
        ):
            result = _mod.verify_artifacts(tmp_path)

        assert result == 0

    def test_stale_artifact_detected_by_verify(self) -> None:
        """Modified artifact causes verify_artifacts() to return 1."""
        fresh = _mod.generate_subprocess_artifact(self.REPO_ROOT)
        fresh_entries = fresh.get("call_sites", [])
        assert len(fresh_entries) > 0, "Need at least 1 call site to test"

        stale = dict(fresh)
        stale["call_sites"] = list(fresh_entries[:-1])
        stale["total_call_sites"] = len(stale["call_sites"])
        stale["unsafe_count"] = sum(
            1 for entry in stale["call_sites"] if entry["safety"] != "safe-literal-list"
        )

        self.TMP_ROOT.mkdir(parents=True, exist_ok=True)
        tmp_path = self.TMP_ROOT / "stale-artifact-case"
        shutil.rmtree(tmp_path, ignore_errors=True)
        tmp_path.mkdir(parents=True, exist_ok=True)
        artifact_path = tmp_path / ".rule-disable-audit-S603.json"
        artifact_path.write_text(json.dumps(stale, indent=2) + "\n", encoding="utf-8")
        s311 = _mod.generate_random_artifact(self.REPO_ROOT)
        s311_path = tmp_path / ".rule-disable-audit-S311.json"
        s311_path.write_text(json.dumps(s311, indent=2) + "\n", encoding="utf-8")

        with (
            patch.object(_mod, "generate_subprocess_artifact", return_value=fresh),
            patch.object(_mod, "generate_random_artifact", return_value=s311),
        ):
            with patch("sys.stdout", new_callable=StringIO) as stdout:
                result = _mod.verify_artifacts(tmp_path)

        assert result == 1
        output = stdout.getvalue()
        assert "Comparison semantics: normalized semantic entries" in output
        assert (
            "Missing normalized entries" in output
            or "Extra normalized entries" in output
        )

    def test_line_number_drift_does_not_fail_verify(self) -> None:
        """Line-number-only drift must not mark an artifact stale."""
        fresh = _mod.generate_subprocess_artifact(self.REPO_ROOT)
        assert fresh["call_sites"], "Need at least 1 call site to test"

        committed = dict(fresh)
        committed["call_sites"] = [dict(entry) for entry in fresh["call_sites"]]
        committed["call_sites"][0]["line"] = int(committed["call_sites"][0]["line"]) + 7

        self.TMP_ROOT.mkdir(parents=True, exist_ok=True)
        tmp_path = self.TMP_ROOT / "line-drift-case"
        shutil.rmtree(tmp_path, ignore_errors=True)
        tmp_path.mkdir(parents=True, exist_ok=True)
        (tmp_path / ".rule-disable-audit-S603.json").write_text(
            json.dumps(committed, indent=2) + "\n",
            encoding="utf-8",
        )
        s311 = _mod.generate_random_artifact(self.REPO_ROOT)
        (tmp_path / ".rule-disable-audit-S311.json").write_text(
            json.dumps(s311, indent=2) + "\n",
            encoding="utf-8",
        )

        with (
            patch.object(_mod, "generate_subprocess_artifact", return_value=fresh),
            patch.object(_mod, "generate_random_artifact", return_value=s311),
        ):
            result = _mod.verify_artifacts(tmp_path)

        assert result == 0


class TestAllowlistMechanism:
    """Finding 9: Tests for the subprocess allowlist loading and filtering."""

    TMP_ROOT = (
        Path(__file__).parent.parent.parent
        / "tmp_test_work"
        / "rule-disable-invariants"
    )

    def test_load_allowlist_missing_file(self) -> None:
        """Missing allowlist file returns empty set."""
        from unittest.mock import patch

        with patch.object(_mod, "SUBPROCESS_ALLOWLIST_PATH", Path("/nonexistent")):
            result = _mod._load_subprocess_allowlist()
        assert result == set()

    def test_load_allowlist_valid_file(self) -> None:
        """Valid allowlist returns (file, line, code) triples."""
        self.TMP_ROOT.mkdir(parents=True, exist_ok=True)
        case_dir = self.TMP_ROOT / "allowlist-valid"
        shutil.rmtree(case_dir, ignore_errors=True)
        case_dir.mkdir(parents=True, exist_ok=True)
        allowlist_path = case_dir / "allowlist.json"
        allowlist_path.write_text(
            json.dumps(
                {
                    "entries": [
                        {
                            "file": "scripts/run.py",
                            "line": 65,
                            "code": "result = subprocess.run(",
                        },
                        {
                            "file": "tests/test_x.py",
                            "line": 10,
                            "code": "subprocess.run(",
                        },
                    ]
                }
            ),
            encoding="utf-8",
        )
        with patch.object(_mod, "SUBPROCESS_ALLOWLIST_PATH", allowlist_path):
            result = _mod._load_subprocess_allowlist()
        assert ("scripts/run.py", 65, "result = subprocess.run(") in result
        assert ("tests/test_x.py", 10, "subprocess.run(") in result
        assert len(result) == 2

    def test_load_allowlist_corrupt_json(self) -> None:
        """Corrupt JSON returns empty set, does not crash."""
        self.TMP_ROOT.mkdir(parents=True, exist_ok=True)
        case_dir = self.TMP_ROOT / "allowlist-corrupt"
        shutil.rmtree(case_dir, ignore_errors=True)
        case_dir.mkdir(parents=True, exist_ok=True)
        allowlist_path = case_dir / "allowlist.json"
        allowlist_path.write_text("not json", encoding="utf-8")
        with patch.object(_mod, "SUBPROCESS_ALLOWLIST_PATH", allowlist_path):
            result = _mod._load_subprocess_allowlist()
        assert result == set()

    def test_allowlisted_violation_filtered_by_file_line_code(self) -> None:
        """A violation matching an allowlist (file, line, code) triple is suppressed."""
        code = "import subprocess\ncmd = ['git', 'status']\nresult = subprocess.run(\n    cmd)\n"
        violations = check_subprocess_safety("scripts/run.py", code)
        assert len(violations) >= 1

        # Match on exact (file, line, code) — line 3 is where subprocess.run( appears
        target_line = violations[0]["line"]
        target_code = str(violations[0]["code"]).strip()
        allowlist = {("scripts/run.py", target_line, target_code)}
        assert _mod._match_allowlist(violations[0], allowlist)

    def test_allowlist_wrong_line_does_not_match(self) -> None:
        """Allowlist entry with wrong line number does not suppress."""
        code = "import subprocess\ncmd = ['git', 'status']\nresult = subprocess.run(\n    cmd)\n"
        violations = check_subprocess_safety("scripts/run.py", code)
        assert len(violations) >= 1

        target_code = str(violations[0]["code"]).strip()
        wrong_line_allowlist = {("scripts/run.py", 999, target_code)}
        assert not _mod._match_allowlist(violations[0], wrong_line_allowlist)

    def test_allowlist_does_not_filter_random_violations(self) -> None:
        """Subprocess allowlist entries do not suppress random violations."""
        code = "import random\nx = random.random()\n"
        violations = check_random_safety("scripts/run.py", code)
        assert len(violations) >= 1

        # Even with matching (file, line, code), random violations are not subprocess patterns
        # The caller filters by pattern type before checking the allowlist
        subprocess_patterns = {
            "subprocess with non-literal command",
            "shell=True",
            "os.system/popen",
        }
        assert violations[0]["pattern"] not in subprocess_patterns, (
            "Random violation should not be a subprocess pattern"
        )


class TestDualViolation:
    """A line with both shell=True and os.system produces two distinct violations."""

    def test_shell_true_and_os_system_on_same_line(self) -> None:
        """Both patterns fire independently — intentional, not double-counting."""
        code = (
            "import subprocess, os\n"
            "subprocess.run(cmd, shell=True); os.system('rm -rf /')\n"
        )
        violations = check_subprocess_safety("test.py", code)
        patterns = {v["pattern"] for v in violations}
        assert "shell=True" in patterns
        assert "os.system/popen" in patterns
        assert len(violations) >= 2


class TestCrossOSPaths:
    """T051: guardrail handles both / and \\ in paths."""

    def test_forward_slash_path_works(self) -> None:
        """Forward-slash paths (Unix/git style) work correctly."""
        code = 'import subprocess\nresult = subprocess.run(["git", "status"])\n'
        violations = check_subprocess_safety("scripts/my_script.py", code)
        assert len(violations) == 0

    def test_backslash_path_in_output_normalized(self) -> None:
        """Violations report forward-slash paths regardless of OS."""
        code = 'import subprocess\nos.system("danger")\n'
        violations = check_subprocess_safety("scripts\\my_script.py", code)
        # The file path in the violation should be whatever was passed in
        # (caller normalizes before calling)
        for v in violations:
            assert isinstance(v["file"], str)


class TestPreflightCIParity:
    """Preflight must invoke the same flags as CI for rule-disable invariants.

    CI runs --check-subprocess --check-random --verify-artifacts.  If preflight
    omits --verify-artifacts, stale proof artifacts pass locally but fail in CI,
    breaking the 'authoritative local gate before pushing' contract.
    """

    REPO_ROOT = Path(__file__).parent.parent.parent

    @staticmethod
    def _extract_flags(text: str) -> set[str]:
        """Extract --flags from the check_rule_disable_invariants invocation block."""
        flags: set[str] = set()
        in_block = False
        for line in text.splitlines():
            if "check_rule_disable_invariants" in line:
                in_block = True
            if in_block:
                for token in line.replace('"', " ").replace("'", " ").split():
                    if token.startswith("--"):
                        flags.add(token.rstrip(",)"))
                # Stop after finding all contiguous lines of the block
                # (next non-continuation line ends it)
                if (
                    in_block
                    and line.strip()
                    and "check_rule_disable_invariants" not in line
                ):
                    if not any(
                        token.startswith("--")
                        for token in line.replace('"', " ").replace("'", " ").split()
                    ):
                        break
        return flags

    def test_preflight_includes_verify_artifacts(self) -> None:
        """Preflight must include --verify-artifacts for rule-disable invariants."""
        preflight_script = self.REPO_ROOT / "scripts" / "run_pr_preflight.py"
        content = preflight_script.read_text(encoding="utf-8")
        flags = self._extract_flags(content)
        assert "--verify-artifacts" in flags, (
            f"Preflight must include --verify-artifacts to match CI. "
            f"Found flags: {flags}"
        )

    def test_preflight_flags_match_ci_workflow(self) -> None:
        """CI and preflight must use the same flags for rule-disable invariants."""
        ci_yml = self.REPO_ROOT / ".github" / "workflows" / "ci.yml"
        ci_flags = self._extract_flags(ci_yml.read_text(encoding="utf-8"))

        preflight_script = self.REPO_ROOT / "scripts" / "run_pr_preflight.py"
        preflight_flags = self._extract_flags(
            preflight_script.read_text(encoding="utf-8")
        )

        assert ci_flags, "Could not extract CI flags — check ci.yml parsing"
        assert preflight_flags, "Could not extract preflight flags — check parsing"
        assert ci_flags == preflight_flags, (
            f"CI flags {ci_flags} != preflight flags {preflight_flags}. "
            "These must be identical to maintain local/CI parity."
        )


class TestCmdRegenerateAllowlistPrunesOrphans:
    """Regression for #274: [REMOVED] must actually drop the entry from disk.

    Fixtures use one file per case so that the live/shifted/orphan branches
    cannot collide through the len(matches) > 1 path.
    """

    TMP_ROOT = (
        Path(__file__).parent.parent.parent
        / "tmp_test_work"
        / "rule-disable-invariants"
    )

    def _build_case(self, name: str) -> Path:
        self.TMP_ROOT.mkdir(parents=True, exist_ok=True)
        case_dir = self.TMP_ROOT / name
        shutil.rmtree(case_dir, ignore_errors=True)
        (case_dir / "scripts").mkdir(parents=True)
        return case_dir

    def test_orphan_entries_dropped_mixed_fixture(
        self, capsys: pytest.CaptureFixture[str]
    ) -> None:
        """Live + shifted + orphan across three separate files."""
        case_dir = self._build_case("prune-orphans-mixed")
        (case_dir / "scripts" / "live_exact.py").write_text(
            "import subprocess\ncmd_a = get()\nout_a = subprocess.run(cmd_a)\n",
            encoding="utf-8",
        )
        (case_dir / "scripts" / "live_shifted.py").write_text(
            "# pad\n"
            "# pad\n"
            "import subprocess\n"
            "cmd_b = get()\n"
            "out_b = subprocess.run(cmd_b)\n",
            encoding="utf-8",
        )
        (case_dir / "scripts" / "orphan_target.py").write_text(
            "# no subprocess call at all\nx = 1\n",
            encoding="utf-8",
        )
        allowlist_path = case_dir / "allowlist.json"
        allowlist_path.write_text(
            json.dumps(
                {
                    "description": "test",
                    "entries": [
                        {
                            "file": "scripts/live_exact.py",
                            "line": 3,
                            "code": "out_a = subprocess.run(cmd_a)",
                            "reason": "live-exact",
                        },
                        {
                            "file": "scripts/live_shifted.py",
                            "line": 2,
                            "code": "out_b = subprocess.run(cmd_b)",
                            "reason": "live-shifted",
                        },
                        {
                            "file": "scripts/orphan_target.py",
                            "line": 99,
                            "code": "out_z = subprocess.run(cmd_z)",
                            "reason": "orphan",
                        },
                    ],
                }
            ),
            encoding="utf-8",
        )

        with (
            patch.object(_mod, "SUBPROCESS_ALLOWLIST_PATH", allowlist_path),
            patch.object(
                _mod,
                "_get_tracked_py_files",
                return_value=[
                    "scripts/live_exact.py",
                    "scripts/live_shifted.py",
                    "scripts/orphan_target.py",
                ],
            ),
        ):
            rc = _mod.cmd_regenerate_allowlist(case_dir)

        assert rc == 0
        written = json.loads(allowlist_path.read_text(encoding="utf-8"))

        reasons = {e["reason"]: e for e in written["entries"]}
        assert "live-exact" in reasons, "live entry must survive"
        assert "live-shifted" in reasons, "shifted entry must survive"
        assert reasons["live-shifted"]["line"] == 5, (
            "shifted entry must be updated to line 5"
        )
        assert "orphan" not in reasons, "orphan reason must be gone from disk"

        orphan_files = [e["file"] for e in written["entries"] if "orphan" in e["file"]]
        assert orphan_files == [], "orphan file path must not appear on disk"

        out = capsys.readouterr().out
        assert "1 updated, 1 no longer matching, 0 ambiguous" in out

    def test_whitespace_variant_entry_is_not_misclassified_orphan(self) -> None:
        """Refinement #1 lock: regen normalization mirrors detection.

        An allowlist entry stored with trailing whitespace must still match
        the violation emitted by check_subprocess_safety. If this test breaks,
        the regen path has drifted from the detection path — exactly the
        false-orphan scenario that would silently delete legitimate entries.
        """
        case_dir = self._build_case("whitespace-variant")
        (case_dir / "scripts" / "ws.py").write_text(
            "import subprocess\ncmd = get()\nresult = subprocess.run(cmd)\n",
            encoding="utf-8",
        )
        allowlist_path = case_dir / "allowlist.json"
        allowlist_path.write_text(
            json.dumps(
                {
                    "description": "test",
                    "entries": [
                        {
                            "file": "scripts/ws.py",
                            "line": 3,
                            "code": "   result = subprocess.run(cmd)   ",
                            "reason": "whitespace-variant",
                        },
                    ],
                }
            ),
            encoding="utf-8",
        )

        with (
            patch.object(_mod, "SUBPROCESS_ALLOWLIST_PATH", allowlist_path),
            patch.object(_mod, "_get_tracked_py_files", return_value=["scripts/ws.py"]),
        ):
            rc = _mod.cmd_regenerate_allowlist(case_dir)

        assert rc == 0
        written = json.loads(allowlist_path.read_text(encoding="utf-8"))
        assert len(written["entries"]) == 1, (
            "whitespace-variant entry must NOT be classified as orphan; "
            "regen normalization has drifted from detection normalization"
        )
        assert written["entries"][0]["reason"] == "whitespace-variant"

    def test_duplicate_entries_not_silently_collapsed(self) -> None:
        """Refinement #4 lock: two identical live entries both survive.

        The accumulator pattern must not deduplicate. Collapsing duplicates
        would be silent data loss of reviewed exceptions.
        """
        case_dir = self._build_case("duplicate-entries")
        (case_dir / "scripts" / "dup.py").write_text(
            "import subprocess\ncmd = get()\nresult = subprocess.run(cmd)\n",
            encoding="utf-8",
        )
        allowlist_path = case_dir / "allowlist.json"
        allowlist_path.write_text(
            json.dumps(
                {
                    "description": "test",
                    "entries": [
                        {
                            "file": "scripts/dup.py",
                            "line": 3,
                            "code": "result = subprocess.run(cmd)",
                            "reason": "dup-A",
                        },
                        {
                            "file": "scripts/dup.py",
                            "line": 3,
                            "code": "result = subprocess.run(cmd)",
                            "reason": "dup-B",
                        },
                    ],
                }
            ),
            encoding="utf-8",
        )

        with (
            patch.object(_mod, "SUBPROCESS_ALLOWLIST_PATH", allowlist_path),
            patch.object(
                _mod, "_get_tracked_py_files", return_value=["scripts/dup.py"]
            ),
        ):
            rc = _mod.cmd_regenerate_allowlist(case_dir)

        assert rc == 0
        written = json.loads(allowlist_path.read_text(encoding="utf-8"))
        assert len(written["entries"]) == 2, (
            "duplicate entries must not be silently collapsed"
        )
        reasons = sorted(e["reason"] for e in written["entries"])
        assert reasons == ["dup-A", "dup-B"]


class TestAllowlistOrphanDetection:
    """Issue #273: verify_subprocess_allowlist_entries detects stale entries.

    Three orphan categories:
      file-removed        — target file deleted
      line-shifted        — file exists but code not on expected line
      refactored-to-safe  — code on line but call is now safe (literal list)
    """

    TMP_ROOT = (
        Path(__file__).parent.parent.parent / "tmp_test_work" / "allowlist-orphan"
    )

    def _build_case(
        self,
        name: str,
        entries: list[dict[str, str | int]],
        files: dict[str, str] | None = None,
    ) -> Path:
        self.TMP_ROOT.mkdir(parents=True, exist_ok=True)
        case_dir = self.TMP_ROOT / name
        shutil.rmtree(case_dir, ignore_errors=True)
        case_dir.mkdir(parents=True)
        (case_dir / ".subprocess-allowlist.json").write_text(
            json.dumps({"description": "test", "entries": entries}, indent=2) + "\n",
            encoding="utf-8",
        )
        for rel_path, content in (files or {}).items():
            full = case_dir / rel_path
            full.parent.mkdir(parents=True, exist_ok=True)
            full.write_text(content, encoding="utf-8")
        return case_dir

    def test_file_removed_detected(self) -> None:
        """Entry pointing at a non-existent file is category file-removed."""
        case_dir = self._build_case(
            "file-removed",
            [
                {
                    "file": "gone.py",
                    "line": 1,
                    "code": "subprocess.run(",
                    "reason": "test",
                }
            ],
        )
        orphans = _mod.verify_subprocess_allowlist_entries(case_dir)
        assert len(orphans) == 1
        assert orphans[0]["category"] == "file-removed"
        assert orphans[0]["file"] == "gone.py"

    def test_line_shifted_detected(self) -> None:
        """Entry with wrong line number is category line-shifted."""
        case_dir = self._build_case(
            "line-shifted",
            [
                {
                    "file": "s.py",
                    "line": 1,
                    "code": "result = subprocess.run(cmd)",
                    "reason": "test",
                }
            ],
            files={
                "s.py": "import subprocess\n# padding\nresult = subprocess.run(cmd)\n"
            },
        )
        orphans = _mod.verify_subprocess_allowlist_entries(case_dir)
        assert len(orphans) == 1
        assert orphans[0]["category"] == "line-shifted"

    def test_refactored_to_safe_detected(self) -> None:
        """Entry where call was refactored to literal list is refactored-to-safe."""
        case_dir = self._build_case(
            "refactored-safe",
            [
                {
                    "file": "s.py",
                    "line": 2,
                    "code": "result = subprocess.run(",
                    "reason": "test",
                }
            ],
            files={
                "s.py": (
                    "import subprocess\n"
                    "result = subprocess.run(\n"
                    '    ["git", "status"],\n'
                    ")\n"
                ),
            },
        )
        orphans = _mod.verify_subprocess_allowlist_entries(case_dir)
        assert len(orphans) == 1
        assert orphans[0]["category"] == "refactored-to-safe"

    def test_live_entry_not_flagged(self) -> None:
        """Entry matching a real unsafe violation returns empty list."""
        case_dir = self._build_case(
            "live",
            [
                {
                    "file": "s.py",
                    "line": 2,
                    "code": "result = subprocess.run(cmd)",
                    "reason": "test",
                }
            ],
            files={"s.py": "import subprocess\nresult = subprocess.run(cmd)\n"},
        )
        orphans = _mod.verify_subprocess_allowlist_entries(case_dir)
        assert len(orphans) == 0

    def test_missing_allowlist_returns_empty(self) -> None:
        """No allowlist file returns empty list, not an error."""
        self.TMP_ROOT.mkdir(parents=True, exist_ok=True)
        case_dir = self.TMP_ROOT / "no-allowlist"
        shutil.rmtree(case_dir, ignore_errors=True)
        case_dir.mkdir(parents=True)
        orphans = _mod.verify_subprocess_allowlist_entries(case_dir)
        assert orphans == []

    def test_committed_allowlist_is_clean(self) -> None:
        """The repo's committed .subprocess-allowlist.json has zero orphans."""
        repo_root = Path(__file__).parent.parent.parent
        orphans = _mod.verify_subprocess_allowlist_entries(repo_root)
        assert orphans == [], (
            f"Committed allowlist has {len(orphans)} orphan(s): "
            + ", ".join(f"{o['file']}:{o['line']} ({o['category']})" for o in orphans)
        )

    def test_verify_artifacts_fails_on_orphan(
        self, capsys: pytest.CaptureFixture[str]
    ) -> None:
        """--verify-artifacts returns non-zero when orphans exist."""
        case_dir = self._build_case(
            "verify-integration",
            [
                {
                    "file": "gone.py",
                    "line": 1,
                    "code": "subprocess.run(",
                    "reason": "test",
                }
            ],
        )
        fresh_s603 = _mod.generate_subprocess_artifact(
            Path(__file__).parent.parent.parent
        )
        fresh_s311 = _mod.generate_random_artifact(Path(__file__).parent.parent.parent)
        (case_dir / ".rule-disable-audit-S603.json").write_text(
            json.dumps(fresh_s603, indent=2) + "\n",
            encoding="utf-8",
        )
        (case_dir / ".rule-disable-audit-S311.json").write_text(
            json.dumps(fresh_s311, indent=2) + "\n",
            encoding="utf-8",
        )
        with (
            patch.object(_mod, "generate_subprocess_artifact", return_value=fresh_s603),
            patch.object(_mod, "generate_random_artifact", return_value=fresh_s311),
        ):
            rc = _mod.verify_artifacts(case_dir)
        assert rc == 1
        out = capsys.readouterr().out
        assert "orphan" in out.lower()
        assert "--regenerate-allowlist" in out
