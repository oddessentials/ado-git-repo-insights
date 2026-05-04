"""Commit-time privacy-review gate for distribution fixtures (feature 309, slice 2a).

Enforces, at commit and CI time, that every committed fixture under
``scripts/demo-distributions/`` conforms to its locked schema AND carries no
residue that could leak tenant identity:
    - Token charset/length/lowercase invariants.
    - Email-shape and URL-shape regex rejection.
    - Weight-sum sanity.
    - Deterministic literals on ``truncation-exercise-week.json``.
    - Sane monotonic percentiles and volume categories.
    - Every derived file carries ``privacy_review_date`` within an allowed
      window.

Tenant-identity string checks (team names / repo names / user-id fragments)
are enforced at derivation time by
``scripts/extract_distribution_fixtures.py`` because the tenant SQLite is
developer-local and never committed; the defense-in-depth gate here covers
the shape + regex surfaces independently of the tenant database.

Cross-OS (QG-39): pathlib + UTF-8 explicit; no shell.
Typing  (QG-40): full annotations; no ``typing.Any``.
"""

from __future__ import annotations

import json
import re
from datetime import date
from pathlib import Path
from typing import Final

import pytest

REPO_ROOT: Final[Path] = Path(__file__).resolve().parents[2]
FIXTURE_DIR: Final[Path] = REPO_ROOT / "scripts" / "demo-distributions"

TITLE_TOKENS_FILE: Final[Path] = FIXTURE_DIR / "title-tokens.json"
CYCLE_TIME_FILE: Final[Path] = FIXTURE_DIR / "cycle-time-per-repo-size.json"
AUTHOR_CONCENTRATION_FILE: Final[Path] = FIXTURE_DIR / "author-concentration.json"
PR_COUNT_FILE: Final[Path] = FIXTURE_DIR / "pr-count-per-week-per-repo.json"
TRUNCATION_WEEK_FILE: Final[Path] = FIXTURE_DIR / "truncation-exercise-week.json"

DERIVED_FILES: Final[tuple[Path, ...]] = (
    TITLE_TOKENS_FILE,
    CYCLE_TIME_FILE,
    AUTHOR_CONCENTRATION_FILE,
    PR_COUNT_FILE,
)

EMAIL_RE: Final[re.Pattern[str]] = re.compile(r"\S+@\S+\.\S+")
URL_RE: Final[re.Pattern[str]] = re.compile(r"https?://\S+")
TOKEN_CHARSET_RE: Final[re.Pattern[str]] = re.compile(r"^[a-z0-9-]+$")

MIN_TOKEN_LEN: Final[int] = 2
MAX_TOKEN_LEN: Final[int] = 24
MIN_SAMPLE_SIZE_PER_CATEGORY: Final[int] = 50
PRIVACY_REVIEW_DATE_LOWER_BOUND: Final[date] = date(2026, 4, 1)


def _load_json(path: Path) -> object:
    return json.loads(path.read_text(encoding="utf-8"))


def test_title_tokens_file_exists_and_shape() -> None:
    payload = _load_json(TITLE_TOKENS_FILE)
    assert isinstance(payload, dict), "title-tokens.json must be an object"
    assert set(payload.keys()) == {
        "tokens",
        "source_sample_size",
        "privacy_review_date",
    }
    tokens = payload["tokens"]
    assert isinstance(tokens, list), "tokens must be a list"
    assert tokens, "tokens must be non-empty"
    sample_size = payload["source_sample_size"]
    assert isinstance(sample_size, int), "source_sample_size must be int"
    assert sample_size > 0, f"source_sample_size must be positive, got {sample_size}"


def test_title_tokens_normalization_invariants() -> None:
    payload = _load_json(TITLE_TOKENS_FILE)
    assert isinstance(payload, dict)
    tokens_obj = payload["tokens"]
    assert isinstance(tokens_obj, list)
    for entry in tokens_obj:
        assert isinstance(entry, dict)
        assert set(entry.keys()) == {"token", "weight"}
        token = entry["token"]
        assert isinstance(token, str)
        assert token == token.lower(), f"token not lowercase: {token!r}"
        assert TOKEN_CHARSET_RE.fullmatch(token), f"forbidden chars in token: {token!r}"
        assert MIN_TOKEN_LEN <= len(token) <= MAX_TOKEN_LEN, (
            f"token length {len(token)} out of range: {token!r}"
        )


def test_title_tokens_no_email_or_url_residue() -> None:
    payload = _load_json(TITLE_TOKENS_FILE)
    assert isinstance(payload, dict)
    tokens_obj = payload["tokens"]
    assert isinstance(tokens_obj, list)
    for entry in tokens_obj:
        assert isinstance(entry, dict)
        token = entry["token"]
        assert isinstance(token, str)
        assert not EMAIL_RE.search(token), f"email-shaped token leaked: {token!r}"
        assert not URL_RE.search(token), f"URL-shaped token leaked: {token!r}"


def test_title_tokens_weights_normalize_to_one() -> None:
    payload = _load_json(TITLE_TOKENS_FILE)
    assert isinstance(payload, dict)
    tokens_obj = payload["tokens"]
    assert isinstance(tokens_obj, list)
    total = 0.0
    for entry in tokens_obj:
        assert isinstance(entry, dict)
        weight = entry["weight"]
        assert isinstance(weight, (int, float))
        weight_float = float(weight)
        assert 0.0 <= weight_float <= 1.0
        total += weight_float
    assert abs(total - 1.0) <= 0.01, f"weights sum to {total}, expected 1.0 ± 0.01"


def test_cycle_time_per_repo_size_schema() -> None:
    payload = _load_json(CYCLE_TIME_FILE)
    assert isinstance(payload, dict)
    assert set(payload.keys()) == {"categories", "privacy_review_date"}
    categories = payload["categories"]
    assert isinstance(categories, dict)
    assert set(categories.keys()) == {"small", "medium", "large"}
    for name, body in categories.items():
        assert isinstance(body, dict), f"category {name} not a dict"
        assert set(body.keys()) == {"mu", "sigma", "source_sample_size"}
        assert isinstance(body["mu"], (int, float))
        sigma = body["sigma"]
        assert isinstance(sigma, (int, float)), f"{name} sigma type"
        assert float(sigma) > 0.0, f"{name} sigma must be positive"
        sample_size = body["source_sample_size"]
        assert isinstance(sample_size, int)
        assert sample_size >= MIN_SAMPLE_SIZE_PER_CATEGORY, (
            f"category {name} has {sample_size} samples "
            f"(< {MIN_SAMPLE_SIZE_PER_CATEGORY})"
        )


def test_author_concentration_schema() -> None:
    payload = _load_json(AUTHOR_CONCENTRATION_FILE)
    assert isinstance(payload, dict)
    assert set(payload.keys()) == {
        "authors_per_week",
        "author_repo_concentration",
        "privacy_review_date",
    }
    percentiles = payload["authors_per_week"]
    assert isinstance(percentiles, dict)
    assert set(percentiles.keys()) == {"p50", "p90", "p99"}
    p50 = float(percentiles["p50"])
    p90 = float(percentiles["p90"])
    p99 = float(percentiles["p99"])
    assert p50 <= p90 <= p99, f"percentiles not monotonic: {p50}, {p90}, {p99}"
    concentration = payload["author_repo_concentration"]
    assert isinstance(concentration, (int, float))
    concentration_float = float(concentration)
    assert 0.0 <= concentration_float <= 1.0


def test_pr_count_per_week_per_repo_schema() -> None:
    payload = _load_json(PR_COUNT_FILE)
    assert isinstance(payload, dict)
    assert set(payload.keys()) == {"repos", "privacy_review_date"}
    repos = payload["repos"]
    assert isinstance(repos, dict)
    assert set(repos.keys()) == {"high-volume", "medium-volume", "low-volume"}
    for name, body in repos.items():
        assert isinstance(body, dict), f"repo category {name} not a dict"
        assert set(body.keys()) == {"weekly_mean", "weekly_std"}
        mean = float(body["weekly_mean"])
        std = float(body["weekly_std"])
        assert mean > 0.0, f"repo category {name} weekly_mean not positive: {mean}"
        assert std >= 0.0, f"repo category {name} weekly_std negative: {std}"


def test_truncation_exercise_week_literal_values() -> None:
    payload = _load_json(TRUNCATION_WEEK_FILE)
    assert payload == {
        "week": "2025-W26",
        "target_qualified_pr_count": 520,
        "contrast_weeks": ["2025-W25", "2025-W27"],
        "contrast_max_pr_count": 300,
    }


@pytest.mark.parametrize("fixture_path", DERIVED_FILES, ids=lambda p: p.name)
def test_derived_file_has_privacy_review_date(fixture_path: Path) -> None:
    payload = _load_json(fixture_path)
    assert isinstance(payload, dict)
    raw = payload.get("privacy_review_date")
    assert isinstance(raw, str), f"{fixture_path.name} missing privacy_review_date"
    reviewed = date.fromisoformat(raw)
    assert reviewed >= PRIVACY_REVIEW_DATE_LOWER_BOUND, (
        f"{fixture_path.name} privacy_review_date {reviewed} precedes "
        f"lower-bound {PRIVACY_REVIEW_DATE_LOWER_BOUND}"
    )
    assert reviewed <= date.today(), (
        f"{fixture_path.name} privacy_review_date {reviewed} is in the future"
    )
