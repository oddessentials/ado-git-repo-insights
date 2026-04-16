from __future__ import annotations

import importlib
import json
from pathlib import Path

import pytest

mod = importlib.import_module("scripts.check_test_floor_contract")


def _write_contract(
    tmp_path: Path, *, python_min: int = 1773, extension_min: int = 2366
) -> Path:
    path = tmp_path / ".test-floor-contract.json"
    path.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "python": {
                    "min_collected": python_min,
                    "authority": "python authority",
                },
                "extension": {
                    "min_collected": extension_min,
                    "authority": "extension authority",
                },
            }
        ),
        encoding="utf-8",
    )
    return path


def test_verify_contract_passes_when_counts_match(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    contract = _write_contract(tmp_path)
    extension_junit = tmp_path / "extension-results.xml"
    extension_junit.write_text("<testsuite tests='0'/>", encoding="utf-8")
    monkeypatch.setattr(mod, "measure_python_count", lambda: 1773)
    monkeypatch.setattr(mod, "measure_extension_count", lambda _: 2366)

    exit_code = mod.verify_contract(contract, extension_junit=extension_junit)

    assert exit_code == 0
    out = capsys.readouterr().out
    assert "Python test floor contract matches canonical collector" in out
    assert "Extension test floor contract matches canonical collector" in out


def test_verify_contract_fails_when_python_floor_is_stale(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    contract = _write_contract(tmp_path, python_min=1763)
    extension_junit = tmp_path / "extension-results.xml"
    extension_junit.write_text("<testsuite tests='0'/>", encoding="utf-8")
    monkeypatch.setattr(mod, "measure_python_count", lambda: 1773)
    monkeypatch.setattr(mod, "measure_extension_count", lambda _: 2366)

    exit_code = mod.verify_contract(contract, extension_junit=extension_junit)

    assert exit_code == 1
    out = capsys.readouterr().out
    assert "Python test floor contract stale" in out
    assert "committed: 1763" in out
    assert "current:   1773" in out
