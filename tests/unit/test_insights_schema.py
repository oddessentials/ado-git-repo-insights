"""Unit tests for insights schema validation (Phase 3.5).

Validates the insights/summary.json schema contract:
- Required root fields: schema_version, generated_at, insights
- Each insight requires: id, category, severity, title, description, affected_entities
- Valid category enums: bottleneck, trend, anomaly
- Valid severity enums: info, warning, critical
- Optional: evidence_refs
- Forward-compatible: unknown fields allowed
"""

from __future__ import annotations

from typing import Any

# Valid category enum values as per schema contract
VALID_CATEGORIES = {"bottleneck", "trend", "anomaly"}

# Valid severity enum values
VALID_SEVERITIES = {"info", "warning", "critical"}


def validate_insights_schema(insights: dict[str, Any]) -> dict[str, Any]:
    """Validate insights schema.

    Returns:
        {"valid": True} if valid
        {"valid": False, "error": str} if invalid
    """
    if not isinstance(insights, dict):
        return {"valid": False, "error": "Insights must be a dictionary"}

    # Check required root fields
    required_root_fields = ["schema_version", "generated_at", "insights"]
    for field in required_root_fields:
        if field not in insights:
            return {"valid": False, "error": f"Missing required field: {field}"}

    # Validate schema_version
    if not isinstance(insights["schema_version"], int):
        return {"valid": False, "error": "schema_version must be an integer"}

    # Validate generated_at
    if not isinstance(insights["generated_at"], str):
        return {"valid": False, "error": "generated_at must be a string"}

    # Validate insights array
    if not isinstance(insights["insights"], list):
        return {"valid": False, "error": "insights must be an array"}

    # Validate each insight entry
    for i, insight in enumerate(insights["insights"]):
        if not isinstance(insight, dict):
            return {"valid": False, "error": f"Insight[{i}] must be a dictionary"}

        # Check required fields
        required_insight_fields = [
            "id",
            "category",
            "severity",
            "title",
            "description",
            "affected_entities",
        ]
        for field in required_insight_fields:
            if field not in insight:
                return {
                    "valid": False,
                    "error": f"Insight[{i}]: Missing required field '{field}'",
                }

        # Check id is a string
        if not isinstance(insight["id"], str):
            return {"valid": False, "error": f"Insight[{i}]: id must be a string"}

        # Check category enum
        if insight["category"] not in VALID_CATEGORIES:
            return {
                "valid": False,
                "error": f"Insight[{i}]: Invalid category '{insight['category']}'. Must be one of {VALID_CATEGORIES}",
            }

        # Check severity enum
        if insight["severity"] not in VALID_SEVERITIES:
            return {
                "valid": False,
                "error": f"Insight[{i}]: Invalid severity '{insight['severity']}'. Must be one of {VALID_SEVERITIES}",
            }

        # Check title is a string
        if not isinstance(insight["title"], str):
            return {"valid": False, "error": f"Insight[{i}]: title must be a string"}

        # Check description is a string
        if not isinstance(insight["description"], str):
            return {
                "valid": False,
                "error": f"Insight[{i}]: description must be a string",
            }

        # Check affected_entities is an array
        if not isinstance(insight["affected_entities"], list):
            return {
                "valid": False,
                "error": f"Insight[{i}]: affected_entities must be an array",
            }

        # Optional: evidence_refs if present must be an array
        if "evidence_refs" in insight:
            if not isinstance(insight["evidence_refs"], list):
                return {
                    "valid": False,
                    "error": f"Insight[{i}]: evidence_refs must be an array",
                }

    return {"valid": True}


def build_valid_insights() -> dict[str, Any]:
    """Build a minimal valid insights object."""
    return {
        "schema_version": 1,
        "generated_at": "2026-01-14T12:00:00Z",
        "insights": [
            {
                "id": "insight-001",
                "category": "bottleneck",
                "severity": "warning",
                "title": "Code review latency increasing",
                "description": "Average time to first review has increased by 15%.",
                "affected_entities": ["project:default"],
            }
        ],
    }


class TestInsightsSchemaValidation:
    """Tests for insights schema validation."""

    def test_valid_schema_passes(self) -> None:
        """A valid insights schema should pass validation."""
        insights = build_valid_insights()
        result = validate_insights_schema(insights)
        assert result["valid"] is True

    def test_missing_schema_version_fails(self) -> None:
        """Missing schema_version should fail."""
        insights = build_valid_insights()
        del insights["schema_version"]
        result = validate_insights_schema(insights)
        assert result["valid"] is False
        assert "schema_version" in result["error"]

    def test_missing_generated_at_fails(self) -> None:
        """Missing generated_at should fail."""
        insights = build_valid_insights()
        del insights["generated_at"]
        result = validate_insights_schema(insights)
        assert result["valid"] is False
        assert "generated_at" in result["error"]

    def test_missing_insights_fails(self) -> None:
        """Missing insights should fail."""
        insights = build_valid_insights()
        del insights["insights"]
        result = validate_insights_schema(insights)
        assert result["valid"] is False
        assert "insights" in result["error"]

    def test_insight_missing_id_fails(self) -> None:
        """Insight missing id should fail."""
        insights = build_valid_insights()
        del insights["insights"][0]["id"]
        result = validate_insights_schema(insights)
        assert result["valid"] is False
        assert "id" in result["error"]

    def test_insight_missing_category_fails(self) -> None:
        """Insight missing category should fail."""
        insights = build_valid_insights()
        del insights["insights"][0]["category"]
        result = validate_insights_schema(insights)
        assert result["valid"] is False
        assert "category" in result["error"]

    def test_insight_missing_severity_fails(self) -> None:
        """Insight missing severity should fail."""
        insights = build_valid_insights()
        del insights["insights"][0]["severity"]
        result = validate_insights_schema(insights)
        assert result["valid"] is False
        assert "severity" in result["error"]

    def test_insight_missing_title_fails(self) -> None:
        """Insight missing title should fail."""
        insights = build_valid_insights()
        del insights["insights"][0]["title"]
        result = validate_insights_schema(insights)
        assert result["valid"] is False
        assert "title" in result["error"]

    def test_insight_missing_description_fails(self) -> None:
        """Insight missing description should fail."""
        insights = build_valid_insights()
        del insights["insights"][0]["description"]
        result = validate_insights_schema(insights)
        assert result["valid"] is False
        assert "description" in result["error"]

    def test_insight_missing_affected_entities_fails(self) -> None:
        """Insight missing affected_entities should fail."""
        insights = build_valid_insights()
        del insights["insights"][0]["affected_entities"]
        result = validate_insights_schema(insights)
        assert result["valid"] is False
        assert "affected_entities" in result["error"]

    def test_valid_category_bottleneck(self) -> None:
        """bottleneck is a valid category."""
        insights = build_valid_insights()
        insights["insights"][0]["category"] = "bottleneck"
        result = validate_insights_schema(insights)
        assert result["valid"] is True

    def test_valid_category_trend(self) -> None:
        """trend is a valid category."""
        insights = build_valid_insights()
        insights["insights"][0]["category"] = "trend"
        result = validate_insights_schema(insights)
        assert result["valid"] is True

    def test_valid_category_anomaly(self) -> None:
        """anomaly is a valid category."""
        insights = build_valid_insights()
        insights["insights"][0]["category"] = "anomaly"
        result = validate_insights_schema(insights)
        assert result["valid"] is True

    def test_invalid_category_fails(self) -> None:
        """Invalid category should fail."""
        insights = build_valid_insights()
        insights["insights"][0]["category"] = "invalid_category"
        result = validate_insights_schema(insights)
        assert result["valid"] is False
        assert "Invalid category" in result["error"]

    def test_valid_severity_info(self) -> None:
        """info is a valid severity."""
        insights = build_valid_insights()
        insights["insights"][0]["severity"] = "info"
        result = validate_insights_schema(insights)
        assert result["valid"] is True

    def test_valid_severity_warning(self) -> None:
        """warning is a valid severity."""
        insights = build_valid_insights()
        insights["insights"][0]["severity"] = "warning"
        result = validate_insights_schema(insights)
        assert result["valid"] is True

    def test_valid_severity_critical(self) -> None:
        """critical is a valid severity."""
        insights = build_valid_insights()
        insights["insights"][0]["severity"] = "critical"
        result = validate_insights_schema(insights)
        assert result["valid"] is True

    def test_invalid_severity_fails(self) -> None:
        """Invalid severity should fail."""
        insights = build_valid_insights()
        insights["insights"][0]["severity"] = "error"  # Not in enum
        result = validate_insights_schema(insights)
        assert result["valid"] is False
        assert "Invalid severity" in result["error"]

    def test_evidence_refs_optional(self) -> None:
        """evidence_refs is optional and can be included."""
        insights = build_valid_insights()
        insights["insights"][0]["evidence_refs"] = [
            "weekly_rollup:2026-W02",
            "distribution:2026",
        ]
        result = validate_insights_schema(insights)
        assert result["valid"] is True

    def test_evidence_refs_empty_array_allowed(self) -> None:
        """Empty evidence_refs array is allowed."""
        insights = build_valid_insights()
        insights["insights"][0]["evidence_refs"] = []
        result = validate_insights_schema(insights)
        assert result["valid"] is True

    def test_evidence_refs_not_array_fails(self) -> None:
        """evidence_refs must be an array if present."""
        insights = build_valid_insights()
        insights["insights"][0]["evidence_refs"] = "not-an-array"
        result = validate_insights_schema(insights)
        assert result["valid"] is False
        assert "array" in result["error"]

    def test_unknown_root_fields_allowed(self) -> None:
        """Unknown fields at root level are allowed (forward-compatible)."""
        insights = build_valid_insights()
        insights["model_version"] = "gpt-4"
        insights["processing_time_ms"] = 1234
        result = validate_insights_schema(insights)
        assert result["valid"] is True

    def test_unknown_insight_fields_allowed(self) -> None:
        """Unknown fields in insight entries are allowed."""
        insights = build_valid_insights()
        insights["insights"][0]["confidence_score"] = 0.92
        insights["insights"][0]["related_insights"] = ["insight-002"]
        result = validate_insights_schema(insights)
        assert result["valid"] is True

    def test_empty_insights_is_valid(self) -> None:
        """Empty insights array is valid (represents empty state)."""
        insights = {
            "schema_version": 1,
            "generated_at": "2026-01-14T12:00:00Z",
            "insights": [],
        }
        result = validate_insights_schema(insights)
        assert result["valid"] is True

    def test_multiple_insights_all_valid(self) -> None:
        """Multiple insights with different categories/severities are valid."""
        insights = build_valid_insights()
        insights["insights"].extend(
            [
                {
                    "id": "insight-002",
                    "category": "trend",
                    "severity": "info",
                    "title": "PR throughput stable",
                    "description": "Weekly PR rate remains consistent.",
                    "affected_entities": ["repo:main"],
                },
                {
                    "id": "insight-003",
                    "category": "anomaly",
                    "severity": "critical",
                    "title": "Unusual spike detected",
                    "description": "P90 cycle time exceeded threshold.",
                    "affected_entities": ["repo:main", "team:backend"],
                },
            ]
        )
        result = validate_insights_schema(insights)
        assert result["valid"] is True

    def test_insights_not_array_fails(self) -> None:
        """insights must be an array, not object."""
        insights = build_valid_insights()
        insights["insights"] = {}
        result = validate_insights_schema(insights)
        assert result["valid"] is False
        assert "array" in result["error"]

    def test_schema_version_not_integer_fails(self) -> None:
        """schema_version must be an integer."""
        insights = build_valid_insights()
        insights["schema_version"] = "1"  # String
        result = validate_insights_schema(insights)
        assert result["valid"] is False
        assert "integer" in result["error"]

    def test_affected_entities_not_array_fails(self) -> None:
        """affected_entities must be an array."""
        insights = build_valid_insights()
        insights["insights"][0]["affected_entities"] = "project:default"
        result = validate_insights_schema(insights)
        assert result["valid"] is False
        assert "array" in result["error"]

    def test_affected_entities_empty_allowed(self) -> None:
        """Empty affected_entities array is allowed."""
        insights = build_valid_insights()
        insights["insights"][0]["affected_entities"] = []
        result = validate_insights_schema(insights)
        assert result["valid"] is True
