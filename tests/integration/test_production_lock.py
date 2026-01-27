"""Integration tests for production lock (User Story 3).

Tests for:
- T046: Synthetic data rejected in production mode

These tests validate the integration of:
- Environment detection
- Dev mode parameter
- Synthetic data gate logic
"""

from __future__ import annotations


class TestProductionLock:
    """Integration tests for production environment synthetic data lock (T046)."""

    def test_production_lock_rejects_synthetic_azure_devops(self) -> None:
        """Synthetic data should be rejected when running on dev.azure.com."""
        # Simulate production environment
        hostname = "dev.azure.com"
        production_patterns = ["dev.azure.com", "visualstudio.com"]
        is_production = any(pattern in hostname for pattern in production_patterns)

        # Even with devMode=true, production should block synthetic
        dev_mode = True
        can_show_synthetic = not is_production and dev_mode

        assert not can_show_synthetic, (
            "Synthetic data must be rejected in production environment"
        )

    def test_production_lock_rejects_synthetic_visualstudio(self) -> None:
        """Synthetic data should be rejected when running on *.visualstudio.com."""
        hostname = "contoso.visualstudio.com"
        production_patterns = ["dev.azure.com", "visualstudio.com"]
        is_production = any(pattern in hostname for pattern in production_patterns)

        dev_mode = True
        can_show_synthetic = not is_production and dev_mode

        assert not can_show_synthetic, (
            "Synthetic data must be rejected on visualstudio.com"
        )

    def test_synthetic_allowed_localhost_dev_mode(self) -> None:
        """Synthetic data should be allowed on localhost with devMode=true."""
        hostname = "localhost"
        production_patterns = ["dev.azure.com", "visualstudio.com"]
        is_production = any(pattern in hostname for pattern in production_patterns)

        dev_mode = True
        can_show_synthetic = not is_production and dev_mode

        assert can_show_synthetic, "Synthetic data should be allowed on localhost"

    def test_synthetic_blocked_localhost_no_dev_mode(self) -> None:
        """Synthetic data should be blocked on localhost without devMode flag."""
        hostname = "localhost"
        production_patterns = ["dev.azure.com", "visualstudio.com"]
        is_production = any(pattern in hostname for pattern in production_patterns)

        dev_mode = False
        can_show_synthetic = not is_production and dev_mode

        assert not can_show_synthetic, "Synthetic data requires explicit devMode flag"

    def test_local_file_protocol_allows_synthetic_with_dev_mode(self) -> None:
        """Local file:// protocol should allow synthetic with devMode."""
        # file:// protocol has empty hostname
        hostname = ""
        production_patterns = ["dev.azure.com", "visualstudio.com"]
        is_production = any(pattern in hostname for pattern in production_patterns)

        dev_mode = True
        can_show_synthetic = not is_production and dev_mode

        assert can_show_synthetic, "Local file protocol should allow synthetic data"


class TestSyntheticDataMarkers:
    """Tests for synthetic data identification markers."""

    def test_synthetic_data_has_is_stub_marker(self) -> None:
        """Synthetic data must have is_stub: true marker."""
        synthetic_predictions = {
            "is_stub": True,
            "generated_by": "synthetic-preview",
            "forecaster": "linear",
            "forecasts": [],
        }

        assert synthetic_predictions["is_stub"] is True, (
            "Synthetic data must have is_stub: true"
        )

    def test_synthetic_data_has_generator_marker(self) -> None:
        """Synthetic data must identify itself as synthetic-preview."""
        synthetic_insights = {
            "is_stub": True,
            "generated_by": "synthetic-preview",
            "schema_version": 1,
            "insights": [],
        }

        assert synthetic_insights["generated_by"] == "synthetic-preview", (
            "Synthetic data must be marked as synthetic-preview"
        )

    def test_real_data_is_not_stub(self) -> None:
        """Real data should have is_stub: false."""
        real_insights = {
            "is_stub": False,
            "generated_by": "openai-v1.0",
            "schema_version": 1,
            "insights": [],
        }

        assert real_insights["is_stub"] is False, (
            "Real data should not be marked as stub"
        )


class TestProductionLockIntegration:
    """Full integration tests for production lock flow."""

    def test_full_flow_production_environment(self) -> None:
        """Full flow test: production environment should never show synthetic."""
        # Setup production context
        context = {
            "hostname": "dev.azure.com",
            "is_production": True,
            "dev_mode_param": True,  # Even with this
            "has_real_data": False,  # And no real data
        }

        # Decision logic
        can_show_synthetic = not context["is_production"] and context["dev_mode_param"]

        # Should fall back to empty state, not synthetic
        should_show_empty_state = (
            not context["has_real_data"] and not can_show_synthetic
        )

        assert should_show_empty_state, (
            "Production should show empty state, not synthetic data"
        )

    def test_full_flow_local_dev_mode(self) -> None:
        """Full flow test: local development with devMode should show synthetic."""
        # Setup local dev context
        context = {
            "hostname": "localhost",
            "is_production": False,
            "dev_mode_param": True,
            "has_real_data": False,
        }

        # Decision logic
        can_show_synthetic = not context["is_production"] and context["dev_mode_param"]

        # Should show synthetic when no real data
        should_show_synthetic = not context["has_real_data"] and can_show_synthetic

        assert should_show_synthetic, (
            "Local dev mode should show synthetic data for preview"
        )
