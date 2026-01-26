"""ML package for Advanced Analytics & ML features (Phase 5).

This package contains:
- ProphetForecaster: Prophet-based trend forecasting
- LLMInsightsGenerator: OpenAI-based insights generation

Architecture Rationale:
-----------------------
The ML features are intentionally separated into distinct modules by their
external dependencies rather than combined into a single module:

1. forecaster.py (Prophet) - Time-series forecasting for PR metrics
   - Dependency: prophet (heavy, includes cmdstanpy, etc.)
   - Use case: Trend predictions for throughput, cycle time

2. insights.py (OpenAI) - LLM-based natural language insights
   - Dependency: openai SDK
   - Use case: Summarize bottlenecks, trends, anomalies

This separation ensures:
- Users can install only the dependencies they need ([ml] extras)
- Each module can evolve independently
- Lazy imports prevent breaking base installs without [ml] extras
- Testing isolation is cleaner (mock one provider without touching the other)

Note: These modules require the [ml] optional dependencies.
Install with: pip install -e ".[ml]"
"""

# Lazy imports only - no heavy module imports at package level
# to avoid breaking base installs without [ml] extras
__all__ = ["ProphetForecaster", "LLMInsightsGenerator"]
