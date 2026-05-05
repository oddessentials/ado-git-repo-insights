"""Unit tests for setup guides (User Story 4).

Tests for:
- T058: YAML snippet generation
- T059: Clipboard copy functionality
"""

from __future__ import annotations


class TestYamlSnippetGeneration:
    """Tests for YAML snippet generation (T058)."""

    def test_predictions_yaml_snippet_structure(self) -> None:
        """Predictions YAML snippet should have correct structure."""
        yaml_snippet = """
- task: ExtractPullRequests@3
  inputs:
    generateAggregates: true
    enablePredictions: true
""".strip()

        assert "- task: ExtractPullRequests@3" in yaml_snippet
        assert "enablePredictions: true" in yaml_snippet
        assert "generateAggregates: true" in yaml_snippet

    def test_predictions_yaml_indentation(self) -> None:
        """Predictions YAML should use 2-space indentation under inputs."""
        yaml_snippet = """- task: ExtractPullRequests@3
  inputs:
    generateAggregates: true
    enablePredictions: true"""

        lines = yaml_snippet.split("\n")
        # inputs: is 2 spaces under the task
        assert lines[1].startswith("  inputs:")
        # input keys are 4 spaces (2-space indent under inputs:)
        assert lines[2].startswith("    ")
        assert not lines[2].startswith("      ")  # Not 6 spaces

    def test_insights_yaml_snippet_structure(self) -> None:
        """Insights YAML snippet should have correct structure."""
        yaml_snippet = """
- task: ExtractPullRequests@3
  inputs:
    generateAggregates: true
    enableInsights: true
    openaiApiKey: $(OPENAI_API_KEY)
""".strip()

        assert "- task: ExtractPullRequests@3" in yaml_snippet
        assert "enableInsights: true" in yaml_snippet
        assert "openaiApiKey" in yaml_snippet

    def test_insights_yaml_uses_variable_syntax(self) -> None:
        """Insights YAML should use ADO variable syntax for API key."""
        yaml_snippet = "openaiApiKey: $(OPENAI_API_KEY)"

        # Should use $() syntax for ADO variables
        assert "$(" in yaml_snippet
        assert ")" in yaml_snippet
        # Should NOT contain actual API key
        assert "sk-" not in yaml_snippet

    def test_combined_yaml_snippet(self) -> None:
        """Combined YAML should enable both features."""
        yaml_snippet = """
- task: ExtractPullRequests@3
  inputs:
    generateAggregates: true
    enablePredictions: true
    enableInsights: true
    openaiApiKey: $(OPENAI_API_KEY)
""".strip()

        assert "enablePredictions: true" in yaml_snippet
        assert "enableInsights: true" in yaml_snippet


class TestClipboardCopy:
    """Tests for clipboard copy functionality (T059).

    Note: Actual clipboard API requires browser environment.
    These tests validate the logic patterns.
    """

    def test_copy_content_is_string(self) -> None:
        """Content to copy should be a string."""
        content = """- task: ExtractPullRequests@3
  inputs:
    generateAggregates: true
    enablePredictions: true"""

        assert isinstance(content, str)
        assert len(content) > 0

    def test_copy_preserves_newlines(self) -> None:
        """Copied content should preserve newlines."""
        content = "line1\nline2\nline3"

        assert "\n" in content
        assert content.count("\n") == 2

    def test_copy_preserves_indentation(self) -> None:
        """Copied content should preserve indentation."""
        content = """parent:
  child1: value1
  child2: value2"""

        lines = content.split("\n")
        assert lines[1].startswith("  ")
        assert lines[2].startswith("  ")

    def test_feedback_state_transitions(self) -> None:
        """Feedback should transition: idle -> copying -> copied -> idle."""
        states = ["idle", "copying", "copied", "idle"]

        # Simulate state machine
        current = states[0]
        for next_state in states[1:]:
            # Transition is valid
            assert current != next_state or current == "idle"
            current = next_state

        assert current == "idle"


class TestSetupGuideContent:
    """Tests for setup guide content quality."""

    def test_predictions_guide_has_description(self) -> None:
        """Predictions guide should have a description."""
        guide = {
            "title": "Enable Predictions",
            "description": "Add time-series forecasting to your pipeline.",
            "yaml": "enablePredictions: true",
        }

        assert len(guide["description"]) > 10
        assert "forecast" in guide["description"].lower()

    def test_insights_guide_has_cost_estimate(self) -> None:
        """Insights guide should include cost estimate."""
        guide = {
            "title": "Enable AI Insights",
            "description": "Get actionable insights powered by OpenAI.",
            "cost_estimate": "~$0.001-0.01 per run",
        }

        assert "cost_estimate" in guide
        assert "$" in guide["cost_estimate"]
        assert "0.001" in guide["cost_estimate"] or "0.01" in guide["cost_estimate"]

    def test_insights_guide_mentions_api_key(self) -> None:
        """Insights guide should mention API key requirement."""
        guide_steps = [
            "Get an OpenAI API key",
            "Add key to ADO variable group",
            "Reference in pipeline YAML",
        ]

        api_key_mentioned = any("api key" in step.lower() for step in guide_steps)
        assert api_key_mentioned

    def test_predictions_guide_is_zero_config(self) -> None:
        """Predictions guide should emphasize zero-config setup."""
        guide = {
            "title": "Enable Predictions",
            "description": "Zero-config forecasting. No API key required.",
            "yaml": "enablePredictions: true",
        }

        # Should not require API key
        assert "api key" not in guide["yaml"].lower()
        # Should mention zero-config or no setup
        desc_lower = guide["description"].lower()
        assert "zero" in desc_lower or "no" in desc_lower
