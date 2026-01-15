"""ML package for Advanced Analytics & ML features (Phase 5).

This package contains:
- ProphetForecaster: Prophet-based trend forecasting
- LLMInsightsGenerator: OpenAI-based insights generation

Note: These modules require the [ml] optional dependencies.
Install with: pip install -e ".[ml]"
"""

# Lazy imports only - no heavy module imports at package level
# to avoid breaking base installs without [ml] extras
__all__ = ["ProphetForecaster", "LLMInsightsGenerator"]
