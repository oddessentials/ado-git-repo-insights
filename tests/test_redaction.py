"""Tests for logging redaction to prevent false positives."""

from ado_git_repo_insights.utils.logging_config import RedactionConfig


def test_redaction_config_no_false_positives():
    """Verify redaction doesn't redact legitimate non-secret strings."""
    config = RedactionConfig()

    # Test corpus of strings that should NOT be redacted
    test_cases = [
        # GUIDs / UUIDs
        ("550e8400-e29b-41d4-a716-446655440000", "ADO work item ID"),
        ("a3b8d1b6-0b3b-4b1a-9c1a-1a2b3c4d5e6f", "Pipeline run ID"),
        # Git SHAs (various lengths)
        ("8d88fb4", "Git SHA short"),
        ("8d88fb47a1c2d3e4f5678901234567890abcdef0", "Git SHA full"),
        # ADO IDs and build numbers
        ("12345", "Build number"),
        ("vstfs:///Build/Build/987654", "ADO build URI"),
        # Normal URLs (without tokens/params)
        ("https://dev.azure.com/myorg/myproject", "ADO org URL"),
        ("https://github.com/oddessentials/ado-git-repo-insights", "GitHub repo URL"),
        # Stack trace snippets
        ('  File \\"/path/to/file.py\\", line 123', "Stack trace line"),
        ('raise ConfigurationError(\\"Invalid config\\")', "Exception"),
        # Diagnostic strings
        ("auth_mode=OAuth", "Auth mode diagnostic"),
        ("authentication_type=PAT", "Auth type diagnostic"),
        ("authorization_header_present=true", "Auth header check"),
    ]

    for test_string, description in test_cases:
        result = config.redact_value(test_string)
        assert result == test_string, (
            f"False positive: {description} was redacted\\n"
            f"Input:  '{test_string}'\\n"
            f"Output: '{result}'"
        )


def test_redaction_config_redacts_actual_secrets():
    """Verify redaction catches actual secrets."""
    config = RedactionConfig()

    # Test actual secret patterns that SHOULD be redacted
    secret_cases = [
        # 52-character ADO PAT
        ("a" * 52, "52-char ADO PAT"),
        (
            "AbcDefGh1234567890AbcDefGh1234567890AbcDefGh12345678",
            "Valid ADO PAT format",
        ),  # Exactly 52 chars
        # Bearer tokens
        (
            "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0",
            "JWT Bearer token",
        ),
    ]

    for test_string, description in secret_cases:
        result = config.redact_value(test_string)
        assert result != test_string, (
            f"Failed to redact: {description}\\n"
            f"Input:  '{test_string}'\\n"
            f"Output: '{result}'"
        )
        assert "***REDACTED***" in result, (
            f"Redaction marker missing for: {description}"
        )


def test_redaction_config_key_denylist():
    """Verify key deny-list works correctly."""
    config = RedactionConfig()

    # Keys that SHOULD be redacted
    sensitive_keys = [
        "pat",
        "PAT",
        "personal_access_token",
        "auth_header",
        "Authorization",
        "webhook_url",
        "SECRET",
        "password",
    ]
    for key in sensitive_keys:
        assert config.should_redact_key(key), f"Failed to redact key: {key}"

    # Keys that should NOT be redacted (diagnostic/harmless)
    safe_keys = [
        "auth_mode",
        "auth_type",
        "authentication_required",
        "authorization_enabled",
        "pat_expiry_date",
        "secret_count",
    ]
    for key in safe_keys:
        assert not config.should_redact_key(key), f"False positive for key: {key}"
