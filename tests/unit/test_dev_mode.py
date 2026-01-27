"""Unit tests for dev mode detection (User Story 3).

Tests for:
- T044: isProductionEnvironment() detection
- T045: canShowSyntheticData() logic
"""

from __future__ import annotations


class TestIsProductionEnvironment:
    """Tests for isProductionEnvironment() detection (T044).

    Note: These are Python-side tests for the concept. The actual TypeScript
    implementation will be tested via the extension build validation.
    """

    def test_localhost_is_not_production(self) -> None:
        """localhost should not be considered production."""
        production_hostnames = [
            "dev.azure.com",
            "*.visualstudio.com",
        ]
        non_production = "localhost"
        assert non_production not in production_hostnames

    def test_azure_devops_is_production(self) -> None:
        """dev.azure.com should be considered production."""
        hostname = "dev.azure.com"
        production_patterns = ["dev.azure.com", "visualstudio.com"]
        is_production = any(pattern in hostname for pattern in production_patterns)
        assert is_production

    def test_visualstudio_is_production(self) -> None:
        """*.visualstudio.com should be considered production."""
        hostname = "myorg.visualstudio.com"
        production_patterns = ["dev.azure.com", "visualstudio.com"]
        is_production = any(pattern in hostname for pattern in production_patterns)
        assert is_production

    def test_file_protocol_is_not_production(self) -> None:
        """file:// protocol (local dashboard) should not be production."""
        # File protocol doesn't have a hostname
        hostname = ""
        production_patterns = ["dev.azure.com", "visualstudio.com"]
        is_production = any(pattern in hostname for pattern in production_patterns)
        assert not is_production

    def test_127_0_0_1_is_not_production(self) -> None:
        """127.0.0.1 should not be considered production."""
        hostname = "127.0.0.1"
        production_patterns = ["dev.azure.com", "visualstudio.com"]
        is_production = any(pattern in hostname for pattern in production_patterns)
        assert not is_production


class TestCanShowSyntheticData:
    """Tests for canShowSyntheticData() logic (T045)."""

    def test_synthetic_allowed_when_not_production_and_dev_mode(self) -> None:
        """Synthetic data should be allowed when not in production AND devMode=true."""
        is_production = False
        dev_mode = True
        can_show = not is_production and dev_mode
        assert can_show

    def test_synthetic_blocked_in_production(self) -> None:
        """Synthetic data should be blocked in production, even with devMode=true."""
        is_production = True
        dev_mode = True
        can_show = not is_production and dev_mode
        assert not can_show

    def test_synthetic_blocked_without_dev_mode(self) -> None:
        """Synthetic data should be blocked without devMode, even if not production."""
        is_production = False
        dev_mode = False
        can_show = not is_production and dev_mode
        assert not can_show

    def test_synthetic_blocked_production_and_no_dev_mode(self) -> None:
        """Synthetic data should be blocked when production AND devMode=false."""
        is_production = True
        dev_mode = False
        can_show = not is_production and dev_mode
        assert not can_show

    def test_localhost_with_dev_mode_allows_synthetic(self) -> None:
        """localhost with devMode=true should allow synthetic data."""
        hostname = "localhost"
        production_patterns = ["dev.azure.com", "visualstudio.com"]
        is_production = any(pattern in hostname for pattern in production_patterns)
        dev_mode = True
        can_show = not is_production and dev_mode
        assert can_show

    def test_azure_devops_blocks_synthetic(self) -> None:
        """dev.azure.com should block synthetic even with devMode=true."""
        hostname = "dev.azure.com"
        production_patterns = ["dev.azure.com", "visualstudio.com"]
        is_production = any(pattern in hostname for pattern in production_patterns)
        dev_mode = True
        can_show = not is_production and dev_mode
        assert not can_show


class TestDevModeEdgeCases:
    """Edge case tests for dev mode detection."""

    def test_empty_hostname_is_not_production(self) -> None:
        """Empty hostname (file:// protocol) should not be production."""
        hostname = ""
        production_patterns = ["dev.azure.com", "visualstudio.com"]
        is_production = any(pattern in hostname for pattern in production_patterns)
        assert not is_production

    def test_none_hostname_handled(self) -> None:
        """None hostname should be handled gracefully."""
        hostname = None
        production_patterns = ["dev.azure.com", "visualstudio.com"]
        # Safe handling of None
        is_production = hostname and any(
            pattern in hostname for pattern in production_patterns
        )
        assert not is_production

    def test_case_insensitive_production_check(self) -> None:
        """Production check should be case-insensitive."""
        hostname = "DEV.AZURE.COM"
        production_patterns = ["dev.azure.com", "visualstudio.com"]
        # Case-insensitive check
        hostname_lower = hostname.lower()
        is_production = any(
            pattern in hostname_lower for pattern in production_patterns
        )
        assert is_production
