"""ML package for Advanced Analytics & ML features (Phase 5).

This package contains:
- ProphetForecaster: Prophet-based trend forecasting (optional, requires [ml] extras)
- FallbackForecaster: NumPy-based linear regression (zero-config default)
- LLMInsightsGenerator: OpenAI-based insights generation
- get_forecaster: Factory function for auto-detecting best available forecaster

Architecture Rationale:
-----------------------
The ML features are intentionally separated into distinct modules by their
external dependencies rather than combined into a single module:

1. forecaster.py (Prophet) - Time-series forecasting for PR metrics
   - Dependency: prophet (heavy, includes cmdstanpy, etc.)
   - Use case: Trend predictions for throughput, cycle time

2. fallback_forecaster.py (NumPy) - Zero-config linear regression fallback
   - Dependency: numpy only (already via pandas)
   - Use case: Predictions when Prophet is not installed (FR-001)

3. insights.py (OpenAI) - LLM-based natural language insights
   - Dependency: openai SDK
   - Use case: Summarize bottlenecks, trends, anomalies

This separation ensures:
- Users can install only the dependencies they need ([ml] extras)
- Zero-config predictions work without Prophet (via FallbackForecaster)
- Each module can evolve independently
- Lazy imports prevent breaking base installs without [ml] extras
- Testing isolation is cleaner (mock one provider without touching the other)

Note: Prophet-based forecasting requires the [ml] optional dependencies.
Install with: pip install -e ".[ml]"
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    from ..persistence.database import DatabaseManager


class Forecaster(Protocol):
    """Protocol for forecaster implementations.

    Both ProphetForecaster and FallbackForecaster implement this interface.
    """

    def generate(self) -> bool:
        """Generate forecasts and write to output file.

        Returns:
            True if forecasts were successfully generated and written.
        """
        ...


logger = logging.getLogger(__name__)

# Lazy imports only - no heavy module imports at package level
# to avoid breaking base installs without [ml] extras
__all__ = [
    "Forecaster",
    "ProphetForecaster",
    "FallbackForecaster",
    "LLMInsightsGenerator",
    "get_forecaster",
    "is_prophet_available",
]


def is_prophet_available() -> bool:
    """Check if Prophet is available for import.

    Returns:
        True if Prophet can be imported, False otherwise.
    """
    try:
        from prophet import (
            Prophet,  # noqa: F401 -- REASON: import used for ML dependency check
        )

        return True
    except ImportError:
        return False


def get_forecaster(
    db: DatabaseManager,
    output_dir: Path,
    prefer_prophet: bool = True,
) -> Forecaster:
    """Factory function to get the best available forecaster.

    Auto-detects Prophet availability and returns the appropriate forecaster.
    This enables zero-config predictions (FR-001) while allowing enhanced
    accuracy when Prophet is installed (FR-002).

    Args:
        db: Database manager with PR data.
        output_dir: Directory for output files.
        prefer_prophet: If True (default), use Prophet when available.

    Returns:
        ProphetForecaster if Prophet is available and preferred,
        FallbackForecaster otherwise.
    """
    from .fallback_forecaster import FallbackForecaster

    if prefer_prophet and is_prophet_available():
        from .forecaster import ProphetForecaster

        logger.info("Using ProphetForecaster (Prophet available)")
        return ProphetForecaster(db, output_dir)
    else:
        if prefer_prophet:
            logger.info(
                "Using FallbackForecaster (Prophet not installed). "
                "Install Prophet for enhanced accuracy: pip install -e '.[ml]'"
            )
        else:
            logger.info("Using FallbackForecaster (Prophet disabled by configuration)")
        return FallbackForecaster(db, output_dir)
