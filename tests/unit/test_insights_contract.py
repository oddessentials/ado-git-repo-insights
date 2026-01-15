"""Contract tests for OpenAI insights output (Phase 5).

These tests validate the EXACT JSON output schema against the Phase 5 contract.
They are a HARD RELEASE GATE - any failures block merge.

Tests use sys.modules patching to inject fake openai module, avoiding [ml] extras
in base CI while ensuring tests work regardless of whether openai is installed.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime
from pathlib import Path
from types import ModuleType
from typing import Any
from unittest.mock import Mock, patch

import pytest


class TestInsightsContract:
    """Schema contract validation for insights/summary.json."""

    @pytest.fixture
    def mock_db(self) -> Mock:
        """Mock database with sample PR data."""
        db = Mock()

        # Mock PR stats queries
        def mock_execute(query: str) -> Mock:
            cursor = Mock()
            if "COUNT(*)" in query and "completed" in query:
                cursor.fetchone.return_value = {"cnt": 42}
            elif "MIN(closed_date)" in query:
                cursor.fetchone.return_value = {
                    "min_date": "2026-01-01T00:00:00Z",
                    "max_date": "2026-01-15T00:00:00Z",
                }
            elif "AVG(cycle_time_minutes)" in query:
                cursor.fetchone.return_value = {"avg_cycle": 240.5, "max_cycle": 720.0}
            elif "COUNT(DISTINCT user_id)" in query:
                cursor.fetchone.return_value = {"cnt": 12}
            elif "COUNT(*)" in query and "repositories" in query:
                cursor.fetchone.return_value = {"cnt": 3}
            elif "MAX(closed_date)" in query:
                cursor.fetchone.return_value = {
                    "max_closed": "2026-01-15",
                    "max_updated": "2026-01-15T10:00:00Z",
                }
            else:
                cursor.fetchone.return_value = {}
            return cursor

        db.execute = mock_execute
        return db

    @pytest.fixture
    def mock_openai_response(self) -> dict[str, Any]:
        """Mock OpenAI API response with valid insights."""
        return {
            "insights": [
                {
                    "id": "llm-generated-id-1",  # Will be replaced with deterministic ID
                    "category": "bottleneck",
                    "severity": "warning",
                    "title": "Code review latency increasing",
                    "description": "Average time to first review has increased by 15%.",
                    "affected_entities": ["project:default"],
                },
                {
                    "id": "llm-generated-id-2",
                    "category": "trend",
                    "severity": "info",
                    "title": "PR throughput stable",
                    "description": "Weekly PR rate remains consistent.",
                    "affected_entities": [],
                },
            ]
        }

    @pytest.fixture
    def fake_openai_module(self, mock_openai_response: dict[str, Any]) -> ModuleType:
        """Create a fake openai module with mock OpenAI client."""
        fake_module = ModuleType("openai")

        # Create mock client
        mock_client = Mock()
        mock_response = Mock()
        mock_response.choices = [Mock()]
        mock_response.choices[0].message.content = json.dumps(mock_openai_response)
        mock_client.chat.completions.create.return_value = mock_response

        # OpenAI class returns the mock client
        fake_module.OpenAI = Mock(return_value=mock_client)  # type: ignore[attr-defined]
        return fake_module

    def test_insights_schema_structure(
        self, mock_db: Mock, fake_openai_module: ModuleType, tmp_path: Path
    ) -> None:
        """Insights JSON has exact required structure."""
        from ado_git_repo_insights.ml.insights import LLMInsightsGenerator

        with (
            patch.dict(sys.modules, {"openai": fake_openai_module}),
            patch.dict("os.environ", {"OPENAI_API_KEY": "test-key"}),
        ):
            generator = LLMInsightsGenerator(
                db=mock_db,
                output_dir=tmp_path,
                max_tokens=1000,
                cache_ttl_hours=24,
                dry_run=False,
            )
            success = generator.generate()

        assert success is True

        # Verify file exists
        insights_file = tmp_path / "insights" / "summary.json"
        assert insights_file.exists()

        # Load and validate structure
        with insights_file.open("r") as f:
            data = json.load(f)

        # Root fields
        assert "schema_version" in data
        assert "generated_at" in data
        assert "is_stub" in data
        assert "generated_by" in data
        assert "insights" in data

        # Type validation
        assert isinstance(data["schema_version"], int)
        assert isinstance(data["generated_at"], str)
        assert isinstance(data["is_stub"], bool)
        assert isinstance(data["generated_by"], str)
        assert isinstance(data["insights"], list)

    def test_insights_contract_values(
        self, mock_db: Mock, fake_openai_module: ModuleType, tmp_path: Path
    ) -> None:
        """Insights JSON has exact contract-compliant values."""
        from ado_git_repo_insights.ml.insights import (
            GENERATOR_ID,
            INSIGHTS_SCHEMA_VERSION,
            LLMInsightsGenerator,
        )

        with (
            patch.dict(sys.modules, {"openai": fake_openai_module}),
            patch.dict("os.environ", {"OPENAI_API_KEY": "test-key"}),
        ):
            generator = LLMInsightsGenerator(db=mock_db, output_dir=tmp_path)
            generator.generate()

        insights_file = tmp_path / "insights" / "summary.json"
        with insights_file.open("r") as f:
            data = json.load(f)

        # Contract values
        assert data["schema_version"] == INSIGHTS_SCHEMA_VERSION
        assert data["schema_version"] == 1  # Locked value
        assert data["is_stub"] is False  # Real ML, not stub
        assert data["generated_by"] == GENERATOR_ID

        # Timestamp format
        datetime.fromisoformat(data["generated_at"])  # Should not raise

    def test_insight_category_enums(
        self, mock_db: Mock, fake_openai_module: ModuleType, tmp_path: Path
    ) -> None:
        """Insight categories match exact contract enums."""
        from ado_git_repo_insights.ml.insights import LLMInsightsGenerator

        valid_categories = {"bottleneck", "trend", "anomaly"}

        with (
            patch.dict(sys.modules, {"openai": fake_openai_module}),
            patch.dict("os.environ", {"OPENAI_API_KEY": "test-key"}),
        ):
            generator = LLMInsightsGenerator(db=mock_db, output_dir=tmp_path)
            generator.generate()

        insights_file = tmp_path / "insights" / "summary.json"
        with insights_file.open("r") as f:
            data = json.load(f)

        for insight in data["insights"]:
            assert insight["category"] in valid_categories

    def test_insight_severity_enums(
        self, mock_db: Mock, fake_openai_module: ModuleType, tmp_path: Path
    ) -> None:
        """Insight severities match exact contract enums."""
        from ado_git_repo_insights.ml.insights import LLMInsightsGenerator

        valid_severities = {"info", "warning", "critical"}

        with (
            patch.dict(sys.modules, {"openai": fake_openai_module}),
            patch.dict("os.environ", {"OPENAI_API_KEY": "test-key"}),
        ):
            generator = LLMInsightsGenerator(db=mock_db, output_dir=tmp_path)
            generator.generate()

        insights_file = tmp_path / "insights" / "summary.json"
        with insights_file.open("r") as f:
            data = json.load(f)

        for insight in data["insights"]:
            assert insight["severity"] in valid_severities

    def test_insight_required_fields(
        self, mock_db: Mock, fake_openai_module: ModuleType, tmp_path: Path
    ) -> None:
        """Each insight has all required fields."""
        from ado_git_repo_insights.ml.insights import LLMInsightsGenerator

        with (
            patch.dict(sys.modules, {"openai": fake_openai_module}),
            patch.dict("os.environ", {"OPENAI_API_KEY": "test-key"}),
        ):
            generator = LLMInsightsGenerator(db=mock_db, output_dir=tmp_path)
            generator.generate()

        insights_file = tmp_path / "insights" / "summary.json"
        with insights_file.open("r") as f:
            data = json.load(f)

        required_fields = [
            "id",
            "category",
            "severity",
            "title",
            "description",
            "affected_entities",
        ]

        for insight in data["insights"]:
            for field in required_fields:
                assert field in insight, f"Missing required field: {field}"

            # Type validation
            assert isinstance(insight["id"], str)
            assert isinstance(insight["category"], str)
            assert isinstance(insight["severity"], str)
            assert isinstance(insight["title"], str)
            assert isinstance(insight["description"], str)
            assert isinstance(insight["affected_entities"], list)

    def test_deterministic_ids(
        self, mock_db: Mock, fake_openai_module: ModuleType, tmp_path: Path
    ) -> None:
        """Insight IDs are deterministic based on data, not random."""
        from ado_git_repo_insights.ml.insights import LLMInsightsGenerator

        with (
            patch.dict(sys.modules, {"openai": fake_openai_module}),
            patch.dict("os.environ", {"OPENAI_API_KEY": "test-key"}),
        ):
            generator = LLMInsightsGenerator(db=mock_db, output_dir=tmp_path)
            generator.generate()

        insights_file = tmp_path / "insights" / "summary.json"
        with insights_file.open("r") as f:
            data1 = json.load(f)

        # Generate again (cache will be hit, but IDs should be same)
        with (
            patch.dict(sys.modules, {"openai": fake_openai_module}),
            patch.dict("os.environ", {"OPENAI_API_KEY": "test-key"}),
        ):
            generator2 = LLMInsightsGenerator(db=mock_db, output_dir=tmp_path)
            generator2.generate()

        with insights_file.open("r") as f:
            data2 = json.load(f)

        # IDs should be identical
        ids1 = [insight["id"] for insight in data1["insights"]]
        ids2 = [insight["id"] for insight in data2["insights"]]
        assert ids1 == ids2

        # IDs should follow pattern: {category}-{hash}
        for insight in data1["insights"]:
            assert insight["id"].startswith(insight["category"] + "-")

    def test_dry_run_no_file_written(self, mock_db: Mock, tmp_path: Path) -> None:
        """Dry-run mode writes prompt artifact but NOT summary.json."""
        from ado_git_repo_insights.ml.insights import LLMInsightsGenerator

        # Dry-run doesn't need API key
        generator = LLMInsightsGenerator(
            db=mock_db,
            output_dir=tmp_path,
            dry_run=True,
        )
        success = generator.generate()

        # Should return False (no summary written)
        assert success is False

        # Prompt artifact should exist
        prompt_file = tmp_path / "insights" / "prompt.json"
        assert prompt_file.exists()

        # Summary should NOT be written
        insights_file = tmp_path / "insights" / "summary.json"
        assert not insights_file.exists()

    def test_affected_entities_enforcement(self, mock_db: Mock, tmp_path: Path) -> None:
        """affected_entities is enforced even if LLM omits it."""
        from ado_git_repo_insights.ml.insights import LLMInsightsGenerator

        # Mock response WITHOUT affected_entities
        mock_response_data = {
            "insights": [
                {
                    "id": "test-1",
                    "category": "bottleneck",
                    "severity": "warning",
                    "title": "Test",
                    "description": "Test description",
                    # affected_entities intentionally missing
                }
            ]
        }

        fake_openai = ModuleType("openai")
        mock_client = Mock()
        mock_response = Mock()
        mock_response.choices = [Mock()]
        mock_response.choices[0].message.content = json.dumps(mock_response_data)
        mock_client.chat.completions.create.return_value = mock_response
        fake_openai.OpenAI = Mock(return_value=mock_client)  # type: ignore[attr-defined]

        with (
            patch.dict(sys.modules, {"openai": fake_openai}),
            patch.dict("os.environ", {"OPENAI_API_KEY": "test-key"}),
        ):
            generator = LLMInsightsGenerator(db=mock_db, output_dir=tmp_path)
            generator.generate()

        insights_file = tmp_path / "insights" / "summary.json"
        with insights_file.open("r") as f:
            data = json.load(f)

        # affected_entities should be enforced as empty array
        for insight in data["insights"]:
            assert "affected_entities" in insight
            assert isinstance(insight["affected_entities"], list)
