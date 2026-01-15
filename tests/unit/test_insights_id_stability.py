"""Edge-case ID stability tests for insights (Phase 5).

These tests validate that insight IDs remain deterministic across:
- Empty datasets (no PRs)
- None DB markers
- Repeated runs with identical data
"""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import Mock, patch


class TestEdgeCaseIDStability:
    """ID stability edge-case tests (Phase 5 hardening)."""

    def test_id_stability_empty_dataset(self, tmp_path: Path) -> None:
        """IDs are deterministic even with empty dataset."""
        from ado_git_repo_insights.ml.insights import LLMInsightsGenerator
        
        # Mock database with NO pull requests
        mock_db = Mock()
        
        def mock_execute(query: str) -> Mock:
            cursor = Mock()
            if "COUNT(*)" in query and "completed" in query:
                cursor.fetchone.return_value = {"cnt": 0}
            elif "MIN(closed_date)" in query:
                cursor.fetchone.return_value = {"min_date": None, "max_date": None}
            elif "AVG(cycle_time_minutes)" in query:
                cursor.fetchone.return_value = {"avg_cycle": 0, "max_cycle": 0}
            elif "COUNT(DISTINCT" in query:
                cursor.fetchone.return_value = {"cnt": 0}
            elif "MAX(closed_date)" in query:
                # Empty dataset returns None
                cursor.fetchone.return_value = {"max_closed": None, "max_updated": None}
            else:
                cursor.fetchone.return_value = {}
            return cursor
        
        mock_db.execute = mock_execute
        
        # Mock OpenAI response
        mock_response_data = {
            "insights": [
                {
                    "id": "temp-1",
                    "category": "trend",
                    "severity": "info",
                    "title": "No data available",
                    "description": "Insufficient data for analysis",
                    "affected_entities": [],
                }
            ]
        }
        
        mock_client = Mock()
        mock_response = Mock()
        mock_response.choices = [Mock()]
        mock_response.choices[0].message.content = json.dumps(mock_response_data)
        mock_client.chat.completions.create.return_value = mock_response
        
        # Generate twice with same empty dataset
        with patch("ado_git_repo_insights.ml.insights.openai.OpenAI", return_value=mock_client), \
             patch.dict("os.environ", {"OPENAI_API_KEY": "test-key"}):
            
            # First run
            gen1 = LLMInsightsGenerator(db=mock_db, output_dir=tmp_path)
            gen1.generate()
            
            insights_file = tmp_path / "insights" / "summary.json"
            with insights_file.open("r") as f:
                data1 = json.load(f)
            ids_run1 = [insight["id"] for insight in data1["insights"]]
            
            # Clear cache and output for second run
            cache_file = tmp_path / "insights" / "cache.json"
            if cache_file.exists():
                cache_file.unlink()
            insights_file.unlink()
            
            # Second run with same data
            gen2 = LLMInsightsGenerator(db=mock_db, output_dir=tmp_path)
            gen2.generate()
            
            with insights_file.open("r") as f:
                data2 = json.load(f)
            ids_run2 = [insight["id"] for insight in data2["insights"]]
        
        # IDs must be identical for empty dataset
        assert ids_run1 == ids_run2, "IDs changed across runs with empty dataset"
        
        # IDs should use deterministic "empty-dataset" marker
        for id_val in ids_run1:
            assert id_val.startswith("trend-"), "ID should start with category"

    def test_id_stability_with_data(self, tmp_path: Path) -> None:
        """IDs are stable across repeated runs with identical DB markers."""
        from ado_git_repo_insights.ml.insights import LLMInsightsGenerator
        
        # Mock database with consistent data
        mock_db = Mock()
        
        def mock_execute(query: str) -> Mock:
            cursor = Mock()
            if "COUNT(*)" in query and "completed" in query:
                cursor.fetchone.return_value = {"cnt": 50}
            elif "MIN(closed_date)" in query:
                cursor.fetchone.return_value = {
                    "min_date": "2026-01-01",
                    "max_date": "2026-01-15",
                }
            elif "AVG(cycle_time_minutes)" in query:
                cursor.fetchone.return_value = {"avg_cycle": 300.0, "max_cycle": 900.0}
            elif "COUNT(DISTINCT" in query:
                cursor.fetchone.return_value = {"cnt": 10}
            elif "MAX(closed_date)" in query:
                # Stable markers
                cursor.fetchone.return_value = {
                    "max_closed": "2026-01-15",
                    "max_updated": "2026-01-15T12:00:00Z",
                }
            else:
                cursor.fetchone.return_value = {}
            return cursor
        
        mock_db.execute = mock_execute
        
        # Mock OpenAI response
        mock_response_data = {
            "insights": [
                {
                    "id": "temp-1",
                    "category": "bottleneck",
                    "severity": "warning",
                    "title": "Test",
                    "description": "Test description",
                    "affected_entities": ["repo:test"],
                },
                {
                    "id": "temp-2",
                    "category": "anomaly",
                    "severity": "critical",
                    "title": "Test 2",
                    "description": "Test description 2",
                    "affected_entities": [],
                },
            ]
        }
        
        mock_client = Mock()
        mock_response = Mock()
        mock_response.choices = [Mock()]
        mock_response.choices[0].message.content = json.dumps(mock_response_data)
        mock_client.chat.completions.create.return_value = mock_response
        
        # Generate twice with same data
        with patch("ado_git_repo_insights.ml.insights.openai.OpenAI", return_value=mock_client), \
             patch.dict("os.environ", {"OPENAI_API_KEY": "test-key"}):
            
            # First run
            gen1 = LLMInsightsGenerator(db=mock_db, output_dir=tmp_path)
            gen1.generate()
            
            insights_file = tmp_path / "insights" / "summary.json"
            with insights_file.open("r") as f:
                data1 = json.load(f)
            ids_run1 = [insight["id"] for insight in data1["insights"]]
            
            # Clear cache and output for second run
            cache_file = tmp_path / "insights" / "cache.json"
            if cache_file.exists():
                cache_file.unlink()
            insights_file.unlink()
            
            # Second run with identical DB markers
            gen2 = LLMInsightsGenerator(db=mock_db, output_dir=tmp_path)
            gen2.generate()
            
            with insights_file.open("r") as f:
                data2 = json.load(f)
            ids_run2 = [insight["id"] for insight in data2["insights"]]
        
        # IDs must be identical across runs
        assert ids_run1 == ids_run2, "IDs changed across runs with identical data"
        
        # Verify format: category-{hash}
        for insight, id_val in zip(mock_response_data["insights"], ids_run1, strict=True):
            expected_prefix = insight["category"] + "-"
            assert id_val.startswith(expected_prefix), f"ID should start with {expected_prefix}"
