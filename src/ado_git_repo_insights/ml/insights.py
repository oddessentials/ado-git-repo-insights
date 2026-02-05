"""LLM-based insights generator for Phase 5.

Produces insights/summary.json with contract-compliant insights:
- schema_version: 1
- is_stub: false
- generated_by: "{provider}-v1.0"
- Categories: bottleneck, trend, anomaly
- Severities: info, warning, critical
- Single API call for up to 3 insights

Supported providers:
- OpenAI (default): Set OPENAI_API_KEY
- Azure OpenAI: Set AZURE_OPENAI_API_KEY + AZURE_OPENAI_ENDPOINT + AZURE_OPENAI_DEPLOYMENT
- Anthropic: Set ANTHROPIC_API_KEY

Provider is auto-detected based on environment variables with the following priority:
1. Azure OpenAI (if AZURE_OPENAI_ENDPOINT is set)
2. Anthropic (if ANTHROPIC_API_KEY is set)
3. OpenAI (default, requires OPENAI_API_KEY)
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import TYPE_CHECKING, Any

from ..utils.path_security import safe_join

if TYPE_CHECKING:
    from ..persistence.database import DatabaseManager

logger = logging.getLogger(__name__)

# Schema version (locked)
INSIGHTS_SCHEMA_VERSION = 1


class LLMProvider(Enum):
    """Supported LLM providers for insights generation."""

    OPENAI = "openai"
    AZURE_OPENAI = "azure-openai"
    ANTHROPIC = "anthropic"


@dataclass
class ProviderConfig:
    """Configuration for an LLM provider.

    This dataclass encapsulates all provider-specific configuration,
    enabling clean separation between provider detection and usage.
    """

    provider: LLMProvider
    api_key: str
    model: str
    # Azure OpenAI specific
    endpoint: str | None = None
    deployment: str | None = None
    api_version: str | None = None

    def get_generator_id(self) -> str:
        """Get the generator ID for this provider configuration."""
        return f"{self.provider.value}-v1.0"


def detect_provider() -> ProviderConfig:
    """Auto-detect the LLM provider based on environment variables.

    Detection priority:
    1. Azure OpenAI - if AZURE_OPENAI_ENDPOINT is set (requires full Azure config)
    2. Anthropic - if ANTHROPIC_API_KEY is set
    3. OpenAI - default, requires OPENAI_API_KEY

    Returns:
        ProviderConfig with detected provider and configuration.

    Raises:
        ValueError: If no valid provider configuration is found.
    """
    # Check Azure OpenAI first (most specific configuration)
    azure_endpoint = os.environ.get("AZURE_OPENAI_ENDPOINT")
    if azure_endpoint:
        azure_key = os.environ.get("AZURE_OPENAI_API_KEY") or os.environ.get(
            "OPENAI_API_KEY"
        )
        if not azure_key:
            raise ValueError(
                "Azure OpenAI endpoint specified but no API key found. "
                "Set AZURE_OPENAI_API_KEY or OPENAI_API_KEY."
            )

        deployment = os.environ.get("AZURE_OPENAI_DEPLOYMENT")
        if not deployment:
            raise ValueError(
                "Azure OpenAI endpoint specified but AZURE_OPENAI_DEPLOYMENT not set. "
                "This is required to identify the model deployment."
            )

        api_version = os.environ.get("AZURE_OPENAI_API_VERSION", "2024-02-01")

        logger.info(
            f"Detected Azure OpenAI provider: endpoint={azure_endpoint}, "
            f"deployment={deployment}, api_version={api_version}"
        )

        return ProviderConfig(
            provider=LLMProvider.AZURE_OPENAI,
            api_key=azure_key,
            model=deployment,  # Azure uses deployment name as model
            endpoint=azure_endpoint,
            deployment=deployment,
            api_version=api_version,
        )

    # Check Anthropic
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY")
    if anthropic_key:
        model = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-20250514")
        logger.info(f"Detected Anthropic provider: model={model}")
        return ProviderConfig(
            provider=LLMProvider.ANTHROPIC,
            api_key=anthropic_key,
            model=model,
        )

    # Default to OpenAI
    openai_key = os.environ.get("OPENAI_API_KEY")
    if openai_key:
        model = os.environ.get("OPENAI_MODEL", DEFAULT_MODEL)
        logger.info(f"Detected OpenAI provider: model={model}")
        return ProviderConfig(
            provider=LLMProvider.OPENAI,
            api_key=openai_key,
            model=model,
        )

    raise ValueError(
        "No LLM provider configured. Set one of:\n"
        "  - OPENAI_API_KEY (for OpenAI)\n"
        "  - ANTHROPIC_API_KEY (for Anthropic)\n"
        "  - AZURE_OPENAI_ENDPOINT + AZURE_OPENAI_API_KEY + AZURE_OPENAI_DEPLOYMENT "
        "(for Azure OpenAI)"
    )


class BaseLLMClient(ABC):
    """Abstract base class for LLM clients.

    This provides a consistent interface for calling different LLM providers,
    enabling clean separation of provider-specific implementation details.
    """

    def __init__(self, config: ProviderConfig, max_tokens: int = 1000) -> None:
        """Initialize the LLM client.

        Args:
            config: Provider configuration.
            max_tokens: Maximum tokens for the response.
        """
        self.config = config
        self.max_tokens = max_tokens

    @abstractmethod
    def generate(self, system_prompt: str, user_prompt: str) -> str | None:
        """Generate a response from the LLM.

        Args:
            system_prompt: The system prompt setting context.
            user_prompt: The user prompt with the request.

        Returns:
            The generated response text, or None if the call failed.
        """
        pass


class OpenAIClient(BaseLLMClient):
    """OpenAI API client implementation."""

    def generate(self, system_prompt: str, user_prompt: str) -> str | None:
        """Generate a response using the OpenAI API."""
        import openai

        client = openai.OpenAI(api_key=self.config.api_key)

        try:
            response = client.chat.completions.create(
                model=self.config.model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                max_tokens=self.max_tokens,
                temperature=0.7,
            )

            if not response.choices:
                logger.warning("OpenAI returned no choices")
                return None

            content = response.choices[0].message.content
            if not content:
                logger.warning("OpenAI returned empty content")
                return None

            # Cast to str to satisfy mypy (SDK returns Any without stubs)
            return str(content)

        except Exception as e:
            logger.warning(f"OpenAI API error: {type(e).__name__}: {e}")
            return None


class AzureOpenAIClient(BaseLLMClient):
    """Azure OpenAI API client implementation."""

    def generate(self, system_prompt: str, user_prompt: str) -> str | None:
        """Generate a response using the Azure OpenAI API."""
        import openai

        client = openai.AzureOpenAI(
            api_key=self.config.api_key,
            api_version=self.config.api_version,
            azure_endpoint=self.config.endpoint,
        )

        try:
            response = client.chat.completions.create(
                model=self.config.deployment,  # Azure uses deployment name
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                max_tokens=self.max_tokens,
                temperature=0.7,
            )

            if not response.choices:
                logger.warning("Azure OpenAI returned no choices")
                return None

            content = response.choices[0].message.content
            if not content:
                logger.warning("Azure OpenAI returned empty content")
                return None

            # Cast to str to satisfy mypy (SDK returns Any without stubs)
            return str(content)

        except Exception as e:
            logger.warning(f"Azure OpenAI API error: {type(e).__name__}: {e}")
            return None


class AnthropicClient(BaseLLMClient):
    """Anthropic API client implementation."""

    def generate(self, system_prompt: str, user_prompt: str) -> str | None:
        """Generate a response using the Anthropic API."""
        import anthropic

        client = anthropic.Anthropic(api_key=self.config.api_key)

        try:
            response = client.messages.create(
                model=self.config.model,
                max_tokens=self.max_tokens,
                system=system_prompt,
                messages=[{"role": "user", "content": user_prompt}],
            )

            if not response.content:
                logger.warning("Anthropic returned no content")
                return None

            # Anthropic returns a list of content blocks
            text_blocks = [
                block.text for block in response.content if hasattr(block, "text")
            ]
            if not text_blocks:
                logger.warning("Anthropic returned no text content")
                return None

            # Cast to str to satisfy mypy (SDK returns Any without stubs)
            return str(text_blocks[0])

        except Exception as e:
            logger.warning(f"Anthropic API error: {type(e).__name__}: {e}")
            return None


def create_llm_client(config: ProviderConfig, max_tokens: int = 1000) -> BaseLLMClient:
    """Factory function to create the appropriate LLM client.

    Args:
        config: Provider configuration from detect_provider().
        max_tokens: Maximum tokens for responses.

    Returns:
        Configured LLM client instance.

    Raises:
        ValueError: If the provider is not supported.
    """
    if config.provider == LLMProvider.OPENAI:
        return OpenAIClient(config, max_tokens)
    elif config.provider == LLMProvider.AZURE_OPENAI:
        return AzureOpenAIClient(config, max_tokens)
    elif config.provider == LLMProvider.ANTHROPIC:
        return AnthropicClient(config, max_tokens)
    else:
        raise ValueError(f"Unsupported provider: {config.provider}")

# Cache invalidation control:
# Bumping PROMPT_VERSION intentionally invalidates all cached insights.
# This ensures users get fresh insights after prompt improvements or bug fixes.
# Current: "phase5-v4" (bumped for multi-provider support)
PROMPT_VERSION = "phase5-v4"

# Default models per provider (can be overridden with environment variables)
# PHASE5.md locked decision for OpenAI: gpt-5-nano
DEFAULT_MODEL = "gpt-5-nano"  # OpenAI default
DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-20250514"  # Anthropic default
DEFAULT_AZURE_API_VERSION = "2024-02-01"  # Azure OpenAI API version

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
    """Generate LLM-based insights from PR metrics.

    Supports multiple providers: OpenAI, Azure OpenAI, and Anthropic.
    Single API call requesting JSON with up to 3 insights (one per category).
    Supports dry-run mode and 12h caching.
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
            max_tokens: Maximum tokens for LLM response.
            cache_ttl_hours: Cache TTL in hours.
            dry_run: If True, write prompt artifact without calling API.
        """
        self.db = db
        self.output_dir = output_dir
        self.max_tokens = max_tokens
        self.cache_ttl_hours = cache_ttl_hours
        self.dry_run = dry_run

        # Provider detection is deferred until generate() to allow dry-run
        # without requiring API credentials
        self._provider_config: ProviderConfig | None = None
        self._llm_client: BaseLLMClient | None = None

    @property
    def provider_config(self) -> ProviderConfig:
        """Lazy-load provider configuration.

        Returns:
            Detected provider configuration.

        Raises:
            ValueError: If no valid provider is configured.
        """
        if self._provider_config is None:
            self._provider_config = detect_provider()
        return self._provider_config

    @property
    def model(self) -> str:
        """Get the model name for the configured provider."""
        return self.provider_config.model

    @property
    def generator_id(self) -> str:
        """Get the generator ID for the configured provider."""
        return self.provider_config.get_generator_id()

    def _get_llm_client(self) -> BaseLLMClient:
        """Get or create the LLM client.

        Returns:
            Configured LLM client for the detected provider.
        """
        if self._llm_client is None:
            self._llm_client = create_llm_client(self.provider_config, self.max_tokens)
        return self._llm_client

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

        insights_dir = safe_join(self.output_dir, "insights")
        insights_dir.mkdir(parents=True, exist_ok=True)

        # Build prompt (returns prompt string and canonical data for cache key)
        prompt, prompt_data = self._build_prompt()

        if self.dry_run:
            # Dry-run: write prompt artifact and exit
            # NO API call, NO client creation, NO provider detection required
            # Use placeholder values for model since provider may not be configured
            model_name = os.environ.get(
                "OPENAI_MODEL",
                os.environ.get("ANTHROPIC_MODEL", DEFAULT_MODEL),
            )
            prompt_artifact = {
                "model": model_name,
                "max_tokens": self.max_tokens,
                "prompt": prompt,
                "generated_at": datetime.now(timezone.utc).isoformat(),
            }
            prompt_path = safe_join(insights_dir, "prompt.json")
            with prompt_path.open("w", encoding="utf-8") as f:
                json.dump(prompt_artifact, f, indent=2)
            logger.info(
                f"DRY RUN: Wrote prompt artifact to {prompt_path}. "
                "No API call made, no costs incurred."
            )
            return False  # Don't write summary.json in dry-run

        # Detect provider and log configuration
        try:
            config = self.provider_config
            logger.info(
                f"Using LLM provider: {config.provider.value} "
                f"(model: {config.model})"
            )
        except ValueError as e:
            logger.error(f"Provider configuration error: {e}")
            return False

        # Check cache
        cache_path = safe_join(insights_dir, "cache.json")
        cache_key = self._get_cache_key(prompt_data)

        cached_insights = self._check_cache(cache_path, cache_key)
        if cached_insights:
            # Cache hit - write summary.json from cache
            summary_path = safe_join(insights_dir, "summary.json")
            with summary_path.open("w", encoding="utf-8") as f:
                json.dump(cached_insights, f, indent=2, sort_keys=True)
            logger.info("Cache hit - wrote insights from cache")
            return True

        # Call LLM API
        try:
            insights_data = self._call_llm(prompt)
        except Exception as e:
            logger.warning(f"LLM API call failed: {type(e).__name__}: {e}")
            return False

        if not insights_data:
            logger.warning("LLM returned no insights")
            return False

        # Write summary.json
        summary_path = safe_join(insights_dir, "summary.json")
        with summary_path.open("w", encoding="utf-8") as f:
            json.dump(insights_data, f, indent=2, sort_keys=True)

        # Update cache
        self._write_cache(cache_path, cache_key, insights_data)

        elapsed = time.perf_counter() - start_time
        logger.info(
            f"{self.provider_config.provider.value} insights generation "
            f"completed in {elapsed:.2f}s "
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

    def _call_llm(self, prompt: str) -> dict[str, Any] | None:
        """Call the configured LLM API and parse response.

        Args:
            prompt: The prompt string.

        Returns:
            Insights data dict or None if failed.
        """
        system_prompt = "You are a DevOps metrics analyst. Respond only with valid JSON."

        try:
            client = self._get_llm_client()
            content = client.generate(system_prompt, prompt)

            if not content:
                return None

            # Parse JSON
            try:
                insights_json = json.loads(content)
            except json.JSONDecodeError as e:
                logger.warning(f"Failed to parse LLM response as JSON: {e}")
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
            logger.warning(f"LLM API error: {type(e).__name__}: {e}")
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
            "generated_by": self.generator_id,
            "insights": sorted_insights,
        }
