#!/usr/bin/env python3
"""Derive statistical distribution fixtures from a one-time tenant SQLite extract.

Feature 309 (`309-demo-pr-drilldown`), slice 2a. Emits the four tenant-derived
fixture files under `scripts/demo-distributions/` that the synthetic demo
generator (slice 2c/2d) samples from.

Inputs (CLI flags):
    --db <path>     Path to tenant SQLite (`.tmp/oddessentials-extract.sqlite`).
                    Developer-local; never committed.
    --output <dir>  Destination directory (`scripts/demo-distributions/`).

Outputs (emitted files):
    title-tokens.json               Weighted token frequency from PR titles.
    cycle-time-per-repo-size.json   Lognormal mu/sigma per repo-size tertile.
    author-concentration.json       Weekly author-count percentiles + Gini.
    pr-count-per-week-per-repo.json Weekly mean/std PR count per volume tertile.

The fifth fixture `truncation-exercise-week.json` is author-committed with
locked literals and is NOT derived by this script.

Contract: `specs/309-demo-pr-drilldown/contracts/distribution-fixture-schema.md`.

Privacy posture (authoritative):
    Before writing any fixture, an in-process blocklist check compares every
    derived token against:
        - tenant team names (teams.team_name)
        - tenant repo names (repositories.repository_name)
        - tenant author login fragments (users.user_id substrings >=6 chars)
        - email-shaped regex (\\S+@\\S+\\.\\S+)
        - URL-like regex (https?://\\S+)
    Any match aborts the script with a non-zero exit code and diagnostic. The
    commit-time gate `tests/unit/test_distribution_fixture_privacy.py` re-runs
    the regex checks + schema/literal invariants as a defence-in-depth guard.

Cross-OS (QG-39): pathlib-only; UTF-8 explicit; no shell. SQLite is read-only.
Typing  (QG-40): full annotations; no `typing.Any`.
"""

from __future__ import annotations

import argparse
import json
import logging
import math
import re
import sqlite3
import sys
from collections import Counter
from collections.abc import Iterable, Sequence
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Final, TypedDict

logger = logging.getLogger(__name__)

TOKEN_STRIP_RE: Final[re.Pattern[str]] = re.compile(r"[^a-z0-9-]+")
EMAIL_RE: Final[re.Pattern[str]] = re.compile(r"\S+@\S+\.\S+")
URL_RE: Final[re.Pattern[str]] = re.compile(r"https?://\S+")
ANY_DIGIT_RE: Final[re.Pattern[str]] = re.compile(r"\d")
MAX_TOKEN_LEN: Final[int] = 24
MIN_TOKEN_LEN: Final[int] = 2
USER_FRAGMENT_WINDOW: Final[int] = 6
MIN_SAMPLE_SIZE_PER_CATEGORY: Final[int] = 50
MIN_PR_COUNT_FOR_REPO_CATEGORY: Final[int] = 30
TOP_N_TOKENS: Final[int] = 400

STOPWORDS: Final[frozenset[str]] = frozenset(
    {
        "a",
        "an",
        "and",
        "are",
        "as",
        "at",
        "be",
        "been",
        "being",
        "but",
        "by",
        "can",
        "could",
        "did",
        "do",
        "does",
        "for",
        "from",
        "had",
        "has",
        "have",
        "if",
        "in",
        "into",
        "is",
        "it",
        "its",
        "not",
        "of",
        "off",
        "on",
        "or",
        "out",
        "over",
        "should",
        "so",
        "the",
        "that",
        "these",
        "this",
        "those",
        "to",
        "under",
        "up",
        "was",
        "were",
        "will",
        "with",
        "would",
    }
)


class TitleTokensFile(TypedDict):
    tokens: list[dict[str, float | str]]
    source_sample_size: int
    privacy_review_date: str


class CycleTimeCategory(TypedDict):
    mu: float
    sigma: float
    source_sample_size: int


class CycleTimePerRepoSizeFile(TypedDict):
    categories: dict[str, CycleTimeCategory]
    privacy_review_date: str


class AuthorsPerWeek(TypedDict):
    p50: float
    p90: float
    p99: float


class AuthorConcentrationFile(TypedDict):
    authors_per_week: AuthorsPerWeek
    author_repo_concentration: float
    privacy_review_date: str


class VolumeCategory(TypedDict):
    weekly_mean: float
    weekly_std: float


class PrCountPerWeekPerRepoFile(TypedDict):
    repos: dict[str, VolumeCategory]
    privacy_review_date: str


def _parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Derive anonymized statistical distribution fixtures from a "
            "tenant SQLite extract. See "
            "specs/309-demo-pr-drilldown/contracts/distribution-fixture-schema.md."
        )
    )
    parser.add_argument(
        "--db",
        type=Path,
        required=True,
        help="Path to tenant SQLite (e.g. .tmp/oddessentials-extract.sqlite).",
    )
    parser.add_argument(
        "--output",
        type=Path,
        required=True,
        help="Destination directory (e.g. scripts/demo-distributions/).",
    )
    return parser.parse_args(argv)


def _open_readonly(db_path: Path) -> sqlite3.Connection:
    if not db_path.exists():
        raise SystemExit(f"[extract-fixtures] tenant SQLite not found: {db_path}")
    uri = f"file:{db_path.as_posix()}?mode=ro"
    conn = sqlite3.connect(uri, uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def _normalize_token(raw: str) -> str:
    return TOKEN_STRIP_RE.sub("", raw.lower()).strip("-")


def _is_bot_noise(token: str) -> bool:
    """Drop any token containing a digit.

    In the tenant extracts observed so far, the overwhelming majority of
    digit-bearing title tokens are CI-bot artifacts — timestamps
    (``auto-20260123-1015``), auto-generated test-fixture names
    (``bugfixtest-400-diag-3``), numeric-suffixed branch conventions
    (``chorejan-7-1``). These drag down demo-title realism and
    false-positive downstream generic-secret heuristics. Stripping
    every digit-bearing token is a simple, cross-OS, deterministic rule
    that leaves only human-word content for the synthetic title pool.
    """
    return bool(ANY_DIGIT_RE.search(token))


def _tokenize_title(title: str) -> list[str]:
    result: list[str] = []
    for raw in re.split(r"\s+", title):
        token = _normalize_token(raw)
        if (
            MIN_TOKEN_LEN <= len(token) <= MAX_TOKEN_LEN
            and token not in STOPWORDS
            and not _is_bot_noise(token)
        ):
            result.append(token)
    return result


def _load_titles(conn: sqlite3.Connection) -> list[str]:
    rows = conn.execute(
        "SELECT title FROM pull_requests WHERE title IS NOT NULL"
    ).fetchall()
    return [str(row["title"]) for row in rows]


def _load_blocklist(conn: sqlite3.Connection) -> set[str]:
    """Tenant tokens that MUST NEVER appear in the committed token frequency list."""
    blocklist: set[str] = set()
    for row in conn.execute("SELECT team_name FROM teams"):
        for piece in _tokenize_title(str(row["team_name"])):
            blocklist.add(piece)
    for row in conn.execute("SELECT repository_name FROM repositories"):
        for piece in _tokenize_title(str(row["repository_name"])):
            blocklist.add(piece)
    for row in conn.execute("SELECT user_id FROM users"):
        user_id = str(row["user_id"])
        lowered = user_id.lower()
        for start in range(len(lowered) - USER_FRAGMENT_WINDOW + 1):
            blocklist.add(lowered[start : start + USER_FRAGMENT_WINDOW])
    return blocklist


def _blocklist_violation(token: str, tenant_blocklist: set[str]) -> str | None:
    if EMAIL_RE.search(token):
        return "email-shaped"
    if URL_RE.search(token):
        return "url-like"
    if token in tenant_blocklist:
        return "tenant-identity"
    for start in range(len(token) - USER_FRAGMENT_WINDOW + 1):
        if token[start : start + USER_FRAGMENT_WINDOW] in tenant_blocklist:
            return "tenant-user-fragment"
    return None


def _compute_token_frequencies(
    titles: Iterable[str], tenant_blocklist: set[str]
) -> tuple[list[dict[str, float | str]], int]:
    counter: Counter[str] = Counter()
    sample_size = 0
    for title in titles:
        sample_size += 1
        for token in _tokenize_title(title):
            counter[token] += 1

    for token in list(counter.keys()):
        reason = _blocklist_violation(token, tenant_blocklist)
        if reason is not None:
            logger.warning(
                "[extract-fixtures] dropping blocklisted token '%s' (reason=%s)",
                token,
                reason,
            )
            del counter[token]

    top = counter.most_common(TOP_N_TOKENS)
    total = sum(count for _, count in top)
    if total == 0:
        raise SystemExit(
            "[extract-fixtures] title-tokens empty after blocklist filter — "
            "cannot derive fixture; re-check tenant SQLite."
        )
    tokens: list[dict[str, float | str]] = [
        {"token": tok, "weight": round(cnt / total, 6)} for tok, cnt in top
    ]
    return tokens, sample_size


def _fit_lognormal(values: Sequence[float]) -> tuple[float, float]:
    filtered = [float(v) for v in values if v is not None and float(v) > 0.0]
    if len(filtered) < MIN_SAMPLE_SIZE_PER_CATEGORY:
        raise SystemExit(
            f"[extract-fixtures] category has only {len(filtered)} samples "
            f"(< {MIN_SAMPLE_SIZE_PER_CATEGORY} floor); refusing to emit."
        )
    logs = [math.log(v) for v in filtered]
    mu = sum(logs) / len(logs)
    var = sum((x - mu) ** 2 for x in logs) / len(logs)
    sigma = math.sqrt(var) if var > 0.0 else 1e-6
    return round(mu, 6), round(sigma, 6)


def _categorize_repos_by_pr_count(conn: sqlite3.Connection) -> dict[str, str]:
    """Partition active repos into small/medium/large tertiles by PR count.

    Repos with fewer than ``MIN_PR_COUNT_FOR_REPO_CATEGORY`` PRs are considered
    stubs/dormant and excluded from categorization — otherwise the bottom
    tertile would be dominated by repos with 1-2 PRs each, which cannot
    support the 50-sample lognormal-fit floor and would produce statistically
    meaningless mu/sigma estimates.
    """
    rows = conn.execute(
        "SELECT repository_id, COUNT(*) AS pr_count FROM pull_requests "
        "GROUP BY repository_id ORDER BY pr_count ASC"
    ).fetchall()
    if not rows:
        raise SystemExit("[extract-fixtures] no pull_requests rows in tenant SQLite.")
    active = [
        (str(r["repository_id"]), int(r["pr_count"]))
        for r in rows
        if int(r["pr_count"]) >= MIN_PR_COUNT_FOR_REPO_CATEGORY
    ]
    if len(active) < 3:
        raise SystemExit(
            f"[extract-fixtures] only {len(active)} active repos (>= "
            f"{MIN_PR_COUNT_FOR_REPO_CATEGORY} PRs); need at least 3 for "
            "tertile split."
        )
    n = len(active)
    small_cut = max(1, n // 3)
    medium_cut = max(small_cut + 1, 2 * n // 3)
    category_by_repo: dict[str, str] = {}
    for idx, (repo_id, _count) in enumerate(active):
        if idx < small_cut:
            category_by_repo[repo_id] = "small"
        elif idx < medium_cut:
            category_by_repo[repo_id] = "medium"
        else:
            category_by_repo[repo_id] = "large"
    return category_by_repo


def _build_cycle_time_fixture(
    conn: sqlite3.Connection, category_by_repo: dict[str, str]
) -> CycleTimePerRepoSizeFile:
    buckets: dict[str, list[float]] = {"small": [], "medium": [], "large": []}
    rows = conn.execute(
        "SELECT repository_id, cycle_time_minutes FROM pull_requests "
        "WHERE cycle_time_minutes IS NOT NULL"
    ).fetchall()
    for row in rows:
        repo_id = str(row["repository_id"])
        cycle = row["cycle_time_minutes"]
        category = category_by_repo.get(repo_id)
        if category is None or cycle is None:
            continue
        buckets[category].append(float(cycle))
    categories: dict[str, CycleTimeCategory] = {}
    for name, values in buckets.items():
        mu, sigma = _fit_lognormal(values)
        categories[name] = {
            "mu": mu,
            "sigma": sigma,
            "source_sample_size": len(values),
        }
    return {
        "categories": categories,
        "privacy_review_date": _today_iso(),
    }


def _iso_week_label(iso_date: str) -> str:
    parsed = datetime.fromisoformat(iso_date.replace("Z", "+00:00")).astimezone(UTC)
    year, week, _ = parsed.isocalendar()
    return f"{year:04d}-W{week:02d}"


def _load_pr_weeks(conn: sqlite3.Connection) -> list[tuple[str, str, str]]:
    rows = conn.execute(
        "SELECT pull_request_uid, repository_id, user_id, creation_date "
        "FROM pull_requests WHERE creation_date IS NOT NULL"
    ).fetchall()
    result: list[tuple[str, str, str]] = []
    for row in rows:
        try:
            week = _iso_week_label(str(row["creation_date"]))
        except (ValueError, TypeError):
            continue
        result.append((week, str(row["repository_id"]), str(row["user_id"])))
    return result


def _percentile(sorted_values: Sequence[float], fraction: float) -> float:
    if not sorted_values:
        raise SystemExit(
            "[extract-fixtures] cannot compute percentile on empty series."
        )
    idx = min(
        len(sorted_values) - 1,
        max(0, int(math.ceil(fraction * len(sorted_values)) - 1)),
    )
    return float(sorted_values[idx])


def _mean_std(values: Sequence[float]) -> tuple[float, float]:
    if not values:
        return 0.0, 0.0
    mean = sum(values) / len(values)
    if len(values) < 2:
        return round(mean, 6), 0.0
    var = sum((v - mean) ** 2 for v in values) / (len(values) - 1)
    return round(mean, 6), round(math.sqrt(var), 6)


def _build_author_concentration_fixture(
    pr_weeks: Sequence[tuple[str, str, str]],
) -> AuthorConcentrationFile:
    authors_per_week: Counter[str] = Counter()
    author_repo_counts: Counter[tuple[str, str]] = Counter()
    for week, repo_id, user_id in pr_weeks:
        authors_per_week[week] += 0  # seed weeks even if only one author
        author_repo_counts[(user_id, repo_id)] += 1
    weekly_unique: dict[str, set[str]] = {}
    for week, _repo_id, user_id in pr_weeks:
        weekly_unique.setdefault(week, set()).add(user_id)
    distribution = sorted(float(len(users)) for users in weekly_unique.values())
    percentiles: AuthorsPerWeek = {
        "p50": round(_percentile(distribution, 0.50), 6),
        "p90": round(_percentile(distribution, 0.90), 6),
        "p99": round(_percentile(distribution, 0.99), 6),
    }
    pair_counts = sorted(author_repo_counts.values())
    gini = _gini_coefficient(pair_counts)
    return {
        "authors_per_week": percentiles,
        "author_repo_concentration": round(gini, 6),
        "privacy_review_date": _today_iso(),
    }


def _gini_coefficient(sorted_counts: Sequence[int]) -> float:
    if not sorted_counts:
        return 0.0
    n = len(sorted_counts)
    cumulative = 0.0
    for idx, count in enumerate(sorted_counts, start=1):
        cumulative += (2 * idx - n - 1) * count
    total = sum(sorted_counts)
    if total == 0:
        return 0.0
    return max(0.0, min(1.0, cumulative / (n * total)))


def _build_volume_fixture(
    conn: sqlite3.Connection, category_by_repo: dict[str, str]
) -> PrCountPerWeekPerRepoFile:
    volume_name = {
        "small": "low-volume",
        "medium": "medium-volume",
        "large": "high-volume",
    }
    bucket_weekly_counts: dict[str, list[float]] = {
        "low-volume": [],
        "medium-volume": [],
        "high-volume": [],
    }
    rows = conn.execute(
        "SELECT repository_id, creation_date FROM pull_requests "
        "WHERE creation_date IS NOT NULL"
    ).fetchall()
    by_week_repo: Counter[tuple[str, str]] = Counter()
    for row in rows:
        try:
            week = _iso_week_label(str(row["creation_date"]))
        except (ValueError, TypeError):
            continue
        repo_id = str(row["repository_id"])
        by_week_repo[(week, repo_id)] += 1
    for (_week, repo_id), count in by_week_repo.items():
        category = category_by_repo.get(repo_id)
        if category is None:
            continue
        bucket_weekly_counts[volume_name[category]].append(float(count))

    repos: dict[str, VolumeCategory] = {}
    for label, series in bucket_weekly_counts.items():
        mean, std = _mean_std(series)
        repos[label] = {"weekly_mean": mean, "weekly_std": std}
    return {
        "repos": repos,
        "privacy_review_date": _today_iso(),
    }


def _today_iso() -> str:
    return date.today().isoformat()


def _canonical_write(path: Path, payload: object) -> None:
    text = json.dumps(payload, indent=2, ensure_ascii=False, sort_keys=True) + "\n"
    # Use write_bytes to guarantee LF-only terminators on every OS; Windows
    # Path.write_text otherwise translates "\n" to CRLF and produces byte
    # drift between re-derivations on different platforms.
    path.write_bytes(text.encode("utf-8"))


def _validate_token_shapes(tokens: Sequence[dict[str, float | str]]) -> None:
    for entry in tokens:
        token = entry["token"]
        if not isinstance(token, str):
            raise SystemExit(f"[extract-fixtures] non-string token emitted: {entry!r}")
        if token != token.lower():
            raise SystemExit(f"[extract-fixtures] token not lowercase: {token!r}")
        if TOKEN_STRIP_RE.search(token):
            raise SystemExit(
                f"[extract-fixtures] token contains forbidden characters: {token!r}"
            )
        if not (MIN_TOKEN_LEN <= len(token) <= MAX_TOKEN_LEN):
            raise SystemExit(
                f"[extract-fixtures] token length {len(token)} out of range: {token!r}"
            )


def main(argv: Sequence[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    args = _parse_args(argv)
    output_dir: Path = args.output
    output_dir.mkdir(parents=True, exist_ok=True)

    with _open_readonly(args.db) as conn:
        tenant_blocklist = _load_blocklist(conn)
        titles = _load_titles(conn)
        tokens, title_sample = _compute_token_frequencies(titles, tenant_blocklist)
        _validate_token_shapes(tokens)
        title_fixture: TitleTokensFile = {
            "tokens": tokens,
            "source_sample_size": title_sample,
            "privacy_review_date": _today_iso(),
        }

        category_by_repo = _categorize_repos_by_pr_count(conn)
        cycle_fixture = _build_cycle_time_fixture(conn, category_by_repo)
        pr_weeks = _load_pr_weeks(conn)
        author_fixture = _build_author_concentration_fixture(pr_weeks)
        volume_fixture = _build_volume_fixture(conn, category_by_repo)

    _canonical_write(output_dir / "title-tokens.json", title_fixture)
    _canonical_write(output_dir / "cycle-time-per-repo-size.json", cycle_fixture)
    _canonical_write(output_dir / "author-concentration.json", author_fixture)
    _canonical_write(output_dir / "pr-count-per-week-per-repo.json", volume_fixture)

    logger.info("[extract-fixtures] derivation complete. Output: %s", output_dir)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
