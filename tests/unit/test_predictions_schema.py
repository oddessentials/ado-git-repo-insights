"""Unit tests for predictions schema validation (Phase 3.5).

Validates the predictions/trends.json schema contract:
- Required root fields: schema_version, generated_at, forecasts
- Valid metric enums: pr_throughput, cycle_time_minutes, review_time_minutes
- Valid period_start format: YYYY-MM-DD and Monday-aligned
- Bounds fields: predicted, lower_bound, upper_bound
- Forward-compatible: unknown fields allowed
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

# Valid metric enum values as per schema contract
VALID_METRICS = {"pr_throughput", "cycle_time_minutes", "review_time_minutes"}

# Metric to unit mapping
METRIC_UNITS = {
    "pr_throughput": "count",
    "cycle_time_minutes": "minutes",
    "review_time_minutes": "minutes",
}


def validate_predictions_schema(predictions: dict[str, Any]) -> dict[str, Any]:
    """Validate predictions schema.

    Returns:
        {"valid": True} if valid
        {"valid": False, "error": str} if invalid
    """
    if not isinstance(predictions, dict):
        return {"valid": False, "error": "Predictions must be a dictionary"}

    # Check required root fields
    required_root_fields = ["schema_version", "generated_at", "forecasts"]
    for field in required_root_fields:
        if field not in predictions:
            return {"valid": False, "error": f"Missing required field: {field}"}

    # Validate schema_version
    if not isinstance(predictions["schema_version"], int):
        return {"valid": False, "error": "schema_version must be an integer"}

    # Validate generated_at
    if not isinstance(predictions["generated_at"], str):
        return {"valid": False, "error": "generated_at must be a string"}

    # Validate forecasts array
    if not isinstance(predictions["forecasts"], list):
        return {"valid": False, "error": "forecasts must be an array"}

    # Validate each forecast entry
    for i, forecast in enumerate(predictions["forecasts"]):
        if not isinstance(forecast, dict):
            return {"valid": False, "error": f"Forecast[{i}] must be a dictionary"}

        # Check metric enum
        metric = forecast.get("metric")
        if metric not in VALID_METRICS:
            return {
                "valid": False,
                "error": f"Forecast[{i}]: Invalid metric '{metric}'. Must be one of {VALID_METRICS}",
            }

        # Check unit matches metric
        expected_unit = METRIC_UNITS.get(metric)
        actual_unit = forecast.get("unit")
        if actual_unit != expected_unit:
            return {
                "valid": False,
                "error": f"Forecast[{i}]: Unit '{actual_unit}' doesn't match metric '{metric}'. Expected '{expected_unit}'",
            }

        # Check values array
        values = forecast.get("values")
        if not isinstance(values, list):
            return {
                "valid": False,
                "error": f"Forecast[{i}]: values must be an array",
            }

        for j, value in enumerate(values):
            # Validate period_start format (YYYY-MM-DD)
            period_start = value.get("period_start")
            if not isinstance(period_start, str):
                return {
                    "valid": False,
                    "error": f"Forecast[{i}].values[{j}]: period_start must be a string",
                }

            try:
                parsed_date = date.fromisoformat(period_start)
            except ValueError:
                return {
                    "valid": False,
                    "error": f"Forecast[{i}].values[{j}]: period_start must be YYYY-MM-DD format",
                }

            # Check Monday-aligned
            if parsed_date.weekday() != 0:  # 0 = Monday
                return {
                    "valid": False,
                    "error": f"Forecast[{i}].values[{j}]: period_start must be Monday-aligned",
                }

            # Check bounds fields
            for bounds_field in ["predicted", "lower_bound", "upper_bound"]:
                if bounds_field not in value:
                    return {
                        "valid": False,
                        "error": f"Forecast[{i}].values[{j}]: Missing required field '{bounds_field}'",
                    }
                if not isinstance(value[bounds_field], (int, float)):
                    return {
                        "valid": False,
                        "error": f"Forecast[{i}].values[{j}]: {bounds_field} must be numeric",
                    }

    return {"valid": True}


def get_monday_date(offset_weeks: int = 0) -> str:
    """Get a Monday-aligned date string."""
    today = date.today()
    # Move to current week's Monday
    monday = today - timedelta(days=today.weekday())
    # Apply offset
    target = monday + timedelta(weeks=offset_weeks)
    return target.isoformat()


def build_valid_predictions() -> dict[str, Any]:
    """Build a minimal valid predictions object."""
    return {
        "schema_version": 1,
        "generated_at": "2026-01-14T12:00:00Z",
        "forecasts": [
            {
                "metric": "pr_throughput",
                "unit": "count",
                "horizon_weeks": 4,
                "values": [
                    {
                        "period_start": get_monday_date(0),
                        "predicted": 25,
                        "lower_bound": 20,
                        "upper_bound": 30,
                    },
                    {
                        "period_start": get_monday_date(1),
                        "predicted": 27,
                        "lower_bound": 22,
                        "upper_bound": 32,
                    },
                ],
            }
        ],
    }


class TestPredictionsSchemaValidation:
    """Tests for predictions schema validation."""

    def test_valid_schema_passes(self) -> None:
        """A valid predictions schema should pass validation."""
        predictions = build_valid_predictions()
        result = validate_predictions_schema(predictions)
        assert result["valid"] is True

    def test_missing_schema_version_fails(self) -> None:
        """Missing schema_version should fail."""
        predictions = build_valid_predictions()
        del predictions["schema_version"]
        result = validate_predictions_schema(predictions)
        assert result["valid"] is False
        assert "schema_version" in result["error"]

    def test_missing_generated_at_fails(self) -> None:
        """Missing generated_at should fail."""
        predictions = build_valid_predictions()
        del predictions["generated_at"]
        result = validate_predictions_schema(predictions)
        assert result["valid"] is False
        assert "generated_at" in result["error"]

    def test_missing_forecasts_fails(self) -> None:
        """Missing forecasts should fail."""
        predictions = build_valid_predictions()
        del predictions["forecasts"]
        result = validate_predictions_schema(predictions)
        assert result["valid"] is False
        assert "forecasts" in result["error"]

    def test_valid_metric_pr_throughput(self) -> None:
        """pr_throughput is a valid metric."""
        predictions = build_valid_predictions()
        predictions["forecasts"][0]["metric"] = "pr_throughput"
        predictions["forecasts"][0]["unit"] = "count"
        result = validate_predictions_schema(predictions)
        assert result["valid"] is True

    def test_valid_metric_cycle_time_minutes(self) -> None:
        """cycle_time_minutes is a valid metric."""
        predictions = build_valid_predictions()
        predictions["forecasts"][0]["metric"] = "cycle_time_minutes"
        predictions["forecasts"][0]["unit"] = "minutes"
        result = validate_predictions_schema(predictions)
        assert result["valid"] is True

    def test_valid_metric_review_time_minutes(self) -> None:
        """review_time_minutes is a valid metric."""
        predictions = build_valid_predictions()
        predictions["forecasts"][0]["metric"] = "review_time_minutes"
        predictions["forecasts"][0]["unit"] = "minutes"
        result = validate_predictions_schema(predictions)
        assert result["valid"] is True

    def test_invalid_metric_enum_fails(self) -> None:
        """Invalid metric enum should fail."""
        predictions = build_valid_predictions()
        predictions["forecasts"][0]["metric"] = "invalid_metric"
        result = validate_predictions_schema(predictions)
        assert result["valid"] is False
        assert "Invalid metric" in result["error"]

    def test_unit_must_match_metric(self) -> None:
        """Unit must match the metric type."""
        predictions = build_valid_predictions()
        predictions["forecasts"][0]["metric"] = "pr_throughput"
        predictions["forecasts"][0]["unit"] = "minutes"  # Wrong unit
        result = validate_predictions_schema(predictions)
        assert result["valid"] is False
        assert "doesn't match" in result["error"]

    def test_period_start_valid_format(self) -> None:
        """period_start must be YYYY-MM-DD format."""
        predictions = build_valid_predictions()
        # Already valid from build_valid_predictions
        result = validate_predictions_schema(predictions)
        assert result["valid"] is True

    def test_period_start_invalid_format_fails(self) -> None:
        """period_start with invalid format should fail."""
        predictions = build_valid_predictions()
        predictions["forecasts"][0]["values"][0]["period_start"] = "01-14-2026"
        result = validate_predictions_schema(predictions)
        assert result["valid"] is False
        assert "YYYY-MM-DD" in result["error"]

    def test_period_start_must_be_monday_aligned(self) -> None:
        """period_start must be Monday-aligned."""
        predictions = build_valid_predictions()
        # Find a Tuesday
        today = date.today()
        tuesday = today - timedelta(days=today.weekday()) + timedelta(days=1)
        predictions["forecasts"][0]["values"][0]["period_start"] = tuesday.isoformat()
        result = validate_predictions_schema(predictions)
        assert result["valid"] is False
        assert "Monday-aligned" in result["error"]

    def test_missing_predicted_fails(self) -> None:
        """Missing predicted field should fail."""
        predictions = build_valid_predictions()
        del predictions["forecasts"][0]["values"][0]["predicted"]
        result = validate_predictions_schema(predictions)
        assert result["valid"] is False
        assert "predicted" in result["error"]

    def test_missing_lower_bound_fails(self) -> None:
        """Missing lower_bound field should fail."""
        predictions = build_valid_predictions()
        del predictions["forecasts"][0]["values"][0]["lower_bound"]
        result = validate_predictions_schema(predictions)
        assert result["valid"] is False
        assert "lower_bound" in result["error"]

    def test_missing_upper_bound_fails(self) -> None:
        """Missing upper_bound field should fail."""
        predictions = build_valid_predictions()
        del predictions["forecasts"][0]["values"][0]["upper_bound"]
        result = validate_predictions_schema(predictions)
        assert result["valid"] is False
        assert "upper_bound" in result["error"]

    def test_bounds_must_be_numeric(self) -> None:
        """Bounds fields must be numeric."""
        predictions = build_valid_predictions()
        predictions["forecasts"][0]["values"][0]["predicted"] = "25"  # String, not int
        result = validate_predictions_schema(predictions)
        assert result["valid"] is False
        assert "numeric" in result["error"]

    def test_unknown_root_fields_allowed(self) -> None:
        """Unknown fields at root level are allowed (forward-compatible)."""
        predictions = build_valid_predictions()
        predictions["unknown_field"] = "some_value"
        predictions["future_feature"] = {"nested": "data"}
        result = validate_predictions_schema(predictions)
        assert result["valid"] is True

    def test_unknown_forecast_fields_allowed(self) -> None:
        """Unknown fields in forecast entries are allowed."""
        predictions = build_valid_predictions()
        predictions["forecasts"][0]["confidence_interval"] = 0.95
        predictions["forecasts"][0]["model_version"] = "v2.1"
        result = validate_predictions_schema(predictions)
        assert result["valid"] is True

    def test_unknown_value_fields_allowed(self) -> None:
        """Unknown fields in value entries are allowed."""
        predictions = build_valid_predictions()
        predictions["forecasts"][0]["values"][0]["confidence"] = 0.92
        predictions["forecasts"][0]["values"][0]["trend_direction"] = "up"
        result = validate_predictions_schema(predictions)
        assert result["valid"] is True

    def test_empty_forecasts_is_valid(self) -> None:
        """Empty forecasts array is valid (represents empty state)."""
        predictions = {
            "schema_version": 1,
            "generated_at": "2026-01-14T12:00:00Z",
            "forecasts": [],
        }
        result = validate_predictions_schema(predictions)
        assert result["valid"] is True

    def test_multiple_forecasts_all_valid(self) -> None:
        """Multiple forecasts with different metrics are valid."""
        predictions = build_valid_predictions()
        # Add more forecasts
        predictions["forecasts"].extend(
            [
                {
                    "metric": "cycle_time_minutes",
                    "unit": "minutes",
                    "horizon_weeks": 4,
                    "values": [
                        {
                            "period_start": get_monday_date(0),
                            "predicted": 240,
                            "lower_bound": 200,
                            "upper_bound": 280,
                        }
                    ],
                },
                {
                    "metric": "review_time_minutes",
                    "unit": "minutes",
                    "horizon_weeks": 4,
                    "values": [
                        {
                            "period_start": get_monday_date(0),
                            "predicted": 60,
                            "lower_bound": 45,
                            "upper_bound": 75,
                        }
                    ],
                },
            ]
        )
        result = validate_predictions_schema(predictions)
        assert result["valid"] is True

    def test_forecasts_not_array_fails(self) -> None:
        """forecasts must be an array, not object."""
        predictions = build_valid_predictions()
        predictions["forecasts"] = {}
        result = validate_predictions_schema(predictions)
        assert result["valid"] is False
        assert "array" in result["error"]

    def test_values_not_array_fails(self) -> None:
        """values within forecast must be an array."""
        predictions = build_valid_predictions()
        predictions["forecasts"][0]["values"] = "not an array"
        result = validate_predictions_schema(predictions)
        assert result["valid"] is False
        assert "array" in result["error"]

    def test_schema_version_not_integer_fails(self) -> None:
        """schema_version must be an integer."""
        predictions = build_valid_predictions()
        predictions["schema_version"] = "1"  # String
        result = validate_predictions_schema(predictions)
        assert result["valid"] is False
        assert "integer" in result["error"]
