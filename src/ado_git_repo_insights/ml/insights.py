"""OpenAI-based insights generator for Phase 5.

Produces insights/summary.json with contract-compliant insights:
- schema_version: 1
- is_stub: false
- generated_by: "openai-v1.0"
- Categories: bottleneck, trend, anomaly
- Severities: info, warning, critical
- Single API call for up to 3 insights
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from ..persistence.database import DatabaseManager

logger = logging.getLogger(__name__)

# Schema version (locked)
INSIGHTS_SCHEMA_VERSION = 1
GENERATOR_ID = "openai-v1.0"

# Cache invalidation control:
# Bumping PROMPT_VERSION intentionally invalidates all cached insights.
# This ensures users get fresh insights after prompt improvements or bug fixes.
# Current: "phase5-v3" (bumped for v2 schema with data/recommendation fields)
PROMPT_VERSION = "phase5-v3"

# Default model (can be overridden with OPENAI_MODEL env var)
# PHASE5.md locked decision: gpt-5-nano
DEFAULT_MODEL = "gpt-5-nano"

# Severity ordering for deterministic sorting (T033)
# Order: critical (highest) > warning > info (lowest)
SEVERITY_ORDER = ["critical", "warning", "info"]

# Default cache TTL changed to 12 hours per US2 spec (T037)
DEFAULT_CACHE_TTL_HOURS = 12


def sort_insights(insights: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Sort insights deterministically by severity, category, then ID.

    Ordering (per spec clarification):
    1. Severity descending: critical > warning > info
    2. Category ascending (alphabetical): anomaly < bottleneck < trend
    3. ID ascending (alphabetical)

    Args:
        insights: List of insight dictionaries.

    Returns:
        Sorted list of insights.
    """
    if not insights:
        return []

    def sort_key(insight: dict[str, Any]) -> tuple[int, str, str]:
        severity = insight.get("severity", "info")
        category = insight.get("category", "")
        insight_id = insight.get("id", "")

        # Severity index (lower = higher priority)
        try:
            severity_idx = SEVERITY_ORDER.index(severity)
        except ValueError:
            severity_idx = len(SEVERITY_ORDER)  # Unknown severity last

        return (severity_idx, category, insight_id)

    return sorted(insights, key=sort_key)


class LLMInsightsGenerator:
    """Generate OpenAI-based insights from PR metrics.

    Single API call requesting JSON with up to 3 insights (one per category).
    Supports dry-run mode and 24h caching.
    """

    def __init__(
        self,
        db: DatabaseManager,
        output_dir: Path,
        max_tokens: int = 1000,
        cache_ttl_hours: int = DEFAULT_CACHE_TTL_HOURS,
        dry_run: bool = False,
    ) -> None:
        """Initialize the insights generator.

        Args:
            db: Database manager with PR data.
            output_dir: Directory for output files.
            max_tokens: Maximum tokens for OpenAI response.
            cache_ttl_hours: Cache TTL in hours.
            dry_run: If True, write prompt artifact without calling API.
        """
        self.db = db
        self.output_dir = output_dir
        self.max_tokens = max_tokens
        self.cache_ttl_hours = cache_ttl_hours
        self.dry_run = dry_run
        self.model = os.environ.get("OPENAI_MODEL", DEFAULT_MODEL)

    def generate(self) -> bool:
        """Generate insights and write to summary.json.

        Returns:
            True if file was written successfully, False otherwise.

        Behavior:
        - Dry-run: writes prompt.json, does NOT write summary.json, returns False
        - Cache hit: writes summary.json from cache, skips API call
        - API failure: warns, does NOT write file, returns False
        """
        start_time = time.perf_counter()

        insights_dir = self.output_dir / "insights"
        insights_dir.mkdir(parents=True, exist_ok=True)

        # Build prompt (returns prompt string and canonical data for cache key)
        prompt, prompt_data = self._build_prompt()

        if self.dry_run:
            # Dry-run: write prompt artifact and exit
            # NO API call, NO client creation
            prompt_artifact = {
                "model": self.model,
                "max_tokens": self.max_tokens,
                "prompt": prompt,
                "generated_at": datetime.now(timezone.utc).isoformat(),
            }
            prompt_path = insights_dir / "prompt.json"
            with prompt_path.open("w", encoding="utf-8") as f:
                json.dump(prompt_artifact, f, indent=2)
            logger.info(
                f"DRY RUN: Wrote prompt artifact to {prompt_path}. "
                "No API call made, no costs incurred."
            )
            return False  # Don't write summary.json in dry-run

        # Check cache
        cache_path = insights_dir / "cache.json"
        cache_key = self._get_cache_key(prompt_data)

        cached_insights = self._check_cache(cache_path, cache_key)
        if cached_insights:
            # Cache hit - write summary.json from cache
            summary_path = insights_dir / "summary.json"
            with summary_path.open("w", encoding="utf-8") as f:
                json.dump(cached_insights, f, indent=2, sort_keys=True)
            logger.info("Cache hit - wrote insights from cache")
            return True

        # Call OpenAI API
        try:
            insights_data = self._call_openai(prompt)
        except Exception as e:
            logger.warning(f"OpenAI API call failed: {type(e).__name__}: {e}")
            return False

        if not insights_data:
            logger.warning("OpenAI returned no insights")
            return False

        # Write summary.json
        summary_path = insights_dir / "summary.json"
        with summary_path.open("w", encoding="utf-8") as f:
            json.dump(insights_data, f, indent=2, sort_keys=True)

        # Update cache
        self._write_cache(cache_path, cache_key, insights_data)

        elapsed = time.perf_counter() - start_time
        logger.info(
            f"OpenAI insights generation completed in {elapsed:.2f}s "
            f"({len(insights_data.get('insights', []))} insights)"
        )
        return True

    def _build_prompt(self) -> tuple[str, dict[str, Any]]:
        """Build the prompt for OpenAI.

        Returns:
            Tuple of (prompt_string, canonical_data_dict)
            The canonical_data_dict is used for deterministic cache key generation.
        """
        # Get aggregate stats from database
        stats = self._get_pr_stats()

        # Canonical data for cache key (sorted, normalized)
        canonical_data = {
            "prompt_version": PROMPT_VERSION,
            "stats": stats,
        }

        prompt = f"""You are a DevOps metrics analyst. Analyze the following pull request metrics and provide up to 3 actionable insights with specific recommendations.

**Metrics Summary:**
- Total PRs: {stats["total_prs"]}
- Date range: {stats["date_range_start"]} to {stats["date_range_end"]}
- Average cycle time: {stats["avg_cycle_time_minutes"]} minutes
- P90 cycle time: {stats["p90_cycle_time_minutes"]} minutes
- Authors: {stats["authors_count"]}
- Repositories: {stats["repositories_count"]}

**Instructions:**
- Provide up to 3 insights, one per category: "bottleneck", "trend", "anomaly"
- For each insight, identify severity: "info", "warning", or "critical"
- Include specific metrics data with current values and trends
- Provide a concrete, actionable recommendation with effort estimate

**Required JSON format (v2 schema):**
{{
  "insights": [
    {{
      "id": "unique-id",
      "category": "bottleneck | trend | anomaly",
      "severity": "info | warning | critical",
      "title": "Short summary (max 60 chars)",
      "description": "Detailed description with specific numbers",
      "affected_entities": [
        {{"type": "team | repository | author", "name": "entity-name", "member_count": 5}}
      ],
      "data": {{
        "metric": "cycle_time_minutes | pr_throughput | review_time_minutes",
        "current_value": 150,
        "previous_value": 125,
        "change_percent": 20.0,
        "trend_direction": "up | down | stable",
        "sparkline": [120, 125, 130, 140, 150]
      }},
      "recommendation": {{
        "action": "Specific action to take",
        "priority": "high | medium | low",
        "effort": "high | medium | low"
      }}
    }}
  ]
}}

Respond ONLY with valid JSON matching this format."""

        return prompt, canonical_data

    def _get_pr_stats(self) -> dict[str, Any]:
        """Get PR statistics from database for prompt.

        Returns:
            Dict with aggregate statistics.
        """
        # Total PRs
        cursor = self.db.execute(
            "SELECT COUNT(*) as cnt FROM pull_requests WHERE status = 'completed'"
        )
        total_prs = cursor.fetchone()["cnt"]

        # Date range
        cursor = self.db.execute(
            """
            SELECT MIN(closed_date) as min_date, MAX(closed_date) as max_date
            FROM pull_requests
            WHERE closed_date IS NOT NULL
            """
        )
        row = cursor.fetchone()
        date_range_start = row["min_date"][:10] if row["min_date"] else "N/A"
        date_range_end = row["max_date"][:10] if row["max_date"] else "N/A"

        # Average cycle time
        cursor = self.db.execute(
            """
            SELECT AVG(cycle_time_minutes) as avg_cycle
            FROM pull_requests
            WHERE cycle_time_minutes IS NOT NULL
            """
        )
        row = cursor.fetchone()
        avg_cycle_time = round(row["avg_cycle"], 1) if row["avg_cycle"] else 0

        # P90 cycle time (true 90th percentile using SQL)
        # Uses LIMIT/OFFSET approach for SQLite compatibility
        # Formula: ceil(N * 0.9) - 1 as 0-indexed offset
        # Implemented as (N * 9 + 9) / 10 - 1 using integer arithmetic
        # This ensures correct P90 for small datasets (e.g., N=2 returns max, not min)
        cursor = self.db.execute(
            """
            SELECT cycle_time_minutes
            FROM pull_requests
            WHERE cycle_time_minutes IS NOT NULL
            ORDER BY cycle_time_minutes
            LIMIT 1 OFFSET (
                SELECT MAX(0, (COUNT(*) * 9 + 9) / 10 - 1)
                FROM pull_requests
                WHERE cycle_time_minutes IS NOT NULL
            )
            """
        )
        row = cursor.fetchone()
        p90_cycle_time = round(row["cycle_time_minutes"], 1) if row else 0

        # Authors
        cursor = self.db.execute(
            "SELECT COUNT(DISTINCT user_id) as cnt FROM pull_requests"
        )
        authors_count = cursor.fetchone()["cnt"]

        # Repositories
        cursor = self.db.execute("SELECT COUNT(*) as cnt FROM repositories")
        repositories_count = cursor.fetchone()["cnt"]

        return {
            "total_prs": total_prs,
            "date_range_start": date_range_start,
            "date_range_end": date_range_end,
            "avg_cycle_time_minutes": avg_cycle_time,
            "p90_cycle_time_minutes": p90_cycle_time,
            "authors_count": authors_count,
            "repositories_count": repositories_count,
        }

    def _get_cache_key(self, prompt_data: dict[str, Any]) -> str:
        """Generate deterministic cache key using canonical JSON.

        Args:
            prompt_data: Canonical data dict (not prompt string)

        Returns:
            SHA256 hash of cache key inputs.
        """
        # Deterministic DB freshness markers:
        # 1. Max closed_date from PRs
        # 2. Max updated_at (if available) to catch backfill/metadata changes
        # Note: Use deterministic fallback for empty datasets
        cursor = self.db.execute(
            """
            SELECT
                MAX(closed_date) as max_closed,
                MAX(COALESCE(updated_at, closed_date)) as max_updated
            FROM pull_requests
            """
        )
        row = cursor.fetchone()
        max_closed = row["max_closed"] if row and row["max_closed"] else "empty-dataset"
        max_updated = (
            row["max_updated"] if row and row["max_updated"] else "empty-dataset"
        )

        # Use canonical JSON with sorted keys for deterministic hashing
        # This prevents cache misses from non-deterministic ordering or whitespace
        canonical_json = json.dumps(prompt_data, sort_keys=True, ensure_ascii=True)
        prompt_hash = hashlib.sha256(canonical_json.encode()).hexdigest()[:16]

        # Cache key components
        key_parts = [
            PROMPT_VERSION,
            self.model,
            max_closed,
            max_updated,
            prompt_hash,
        ]
        key_string = "|".join(str(p) for p in key_parts)
        return hashlib.sha256(key_string.encode()).hexdigest()

    def _check_cache(self, cache_path: Path, cache_key: str) -> dict[str, Any] | None:
        """Check if valid cache exists.

        Args:
            cache_path: Path to cache file.
            cache_key: Expected cache key.

        Returns:
            Cached insights data if valid, None otherwise.
        """
        if not cache_path.exists():
            return None

        try:
            with cache_path.open("r", encoding="utf-8") as f:
                cache_data = json.load(f)

            # Validate cache key
            if cache_data.get("cache_key") != cache_key:
                logger.debug("Cache miss: key mismatch")
                return None

            # Validate TTL
            cached_at = datetime.fromisoformat(cache_data["cached_at"])
            age_hours = (datetime.now(timezone.utc) - cached_at).total_seconds() / 3600
            if age_hours > self.cache_ttl_hours:
                logger.debug(
                    f"Cache expired: {age_hours:.1f}h > {self.cache_ttl_hours}h"
                )
                return None

            logger.info(f"Cache hit: age {age_hours:.1f}h")
            # Cast from Any to expected type (cache stores validated insights_data)
            cached: dict[str, Any] | None = cache_data.get("insights_data")
            return cached

        except Exception as e:
            logger.debug(f"Cache read failed: {e}")
            return None

    def _write_cache(
        self, cache_path: Path, cache_key: str, insights_data: dict[str, Any]
    ) -> None:
        """Write insights to cache.

        Args:
            cache_path: Path to cache file.
            cache_key: Cache key.
            insights_data: Insights data to cache.
        """
        cache_data = {
            "cache_key": cache_key,
            "cached_at": datetime.now(timezone.utc).isoformat(),
            "insights_data": insights_data,
        }
        with cache_path.open("w", encoding="utf-8") as f:
            json.dump(cache_data, f, indent=2)

    def _call_openai(self, prompt: str) -> dict[str, Any] | None:
        """Call OpenAI API and parse response.

        Args:
            prompt: The prompt string.

        Returns:
            Insights data dict or None if failed.
        """
        import openai

        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            raise ValueError("OPENAI_API_KEY not set")

        # OpenAI SDK v1.0+ client-based API
        client = openai.OpenAI(api_key=api_key)

        try:
            response = client.chat.completions.create(
                model=self.model,
                messages=[
                    {
                        "role": "system",
                        "content": "You are a DevOps metrics analyst. Respond only with valid JSON.",
                    },
                    {"role": "user", "content": prompt},
                ],
                max_tokens=self.max_tokens,
                temperature=0.7,
            )

            # Extract response text
            if not response.choices:
                logger.warning("OpenAI returned no choices")
                return None

            content = response.choices[0].message.content
            if not content:
                logger.warning("OpenAI returned empty content")
                return None

            # Parse JSON
            try:
                insights_json = json.loads(content)
            except json.JSONDecodeError as e:
                logger.warning(f"Failed to parse OpenAI response as JSON: {e}")
                return None

            # Get DB freshness markers for deterministic ID generation
            # Handle empty datasets (None values) with deterministic fallback
            cursor = self.db.execute(
                """
                SELECT
                    MAX(closed_date) as max_closed,
                    MAX(COALESCE(updated_at, closed_date)) as max_updated
                FROM pull_requests
                """
            )
            row = cursor.fetchone()
            # Deterministic fallback for empty datasets
            max_closed = (
                row["max_closed"] if row and row["max_closed"] else "empty-dataset"
            )
            max_updated = (
                row["max_updated"] if row and row["max_updated"] else "empty-dataset"
            )

            # Validate and enforce contract with deterministic IDs
            return self._validate_and_fix_insights(
                insights_json, max_closed, max_updated
            )

        except Exception as e:
            logger.warning(f"OpenAI API error: {type(e).__name__}: {e}")
            return None

    def _validate_and_fix_insights(
        self, insights_json: dict[str, Any], max_closed: str, max_updated: str
    ) -> dict[str, Any] | None:
        """Validate and fix insights to match contract.

        Generates deterministic IDs to ensure cache stability and prevent UI flicker.

        Args:
            insights_json: Raw JSON from OpenAI.
            max_closed: Max closed_date from database (for ID generation).
            max_updated: Max updated_at from database (for ID generation).

        Returns:
            Contract-compliant insights or None if invalid.
        """
        if "insights" not in insights_json:
            logger.warning("Missing 'insights' array in response")
            return None

        insights_list = insights_json["insights"]
        if not isinstance(insights_list, list):
            logger.warning("'insights' is not an array")
            return None

        # Fix each insight
        fixed_insights = []
        for idx, insight in enumerate(insights_list):
            if not isinstance(insight, dict):
                continue

            # Enforce required fields
            if "affected_entities" not in insight:
                insight["affected_entities"] = []  # Enforce empty array if missing

            # Validate category (needed for deterministic ID)
            category = insight.get("category", "unknown")
            if not isinstance(category, str):
                logger.warning(f"Insight missing valid category: {insight}")
                continue

            # Generate deterministic ID based on category + dataset + prompt version
            # This ensures the same data produces the same IDs across cache hits
            id_input = f"{category}|{max_closed}|{max_updated}|{PROMPT_VERSION}|{idx}"
            deterministic_id = hashlib.sha256(id_input.encode()).hexdigest()[:12]
            insight["id"] = f"{category}-{deterministic_id}"

            # Validate other required fields exist
            required = ["severity", "title", "description"]
            if not all(field in insight for field in required):
                logger.warning(f"Insight missing required fields: {insight}")
                continue

            fixed_insights.append(insight)

        # Apply deterministic sorting (T035): severity desc → category asc → ID asc
        sorted_insights = sort_insights(fixed_insights)

        # Build contract-compliant output
        return {
            "schema_version": INSIGHTS_SCHEMA_VERSION,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "is_stub": False,
            "generated_by": GENERATOR_ID,
            "insights": sorted_insights,
        }
