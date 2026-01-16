"""Tests for logging_config module."""

import logging
import tempfile
from pathlib import Path

from ado_git_repo_insights.utils.logging_config import (
    JsonlHandler,
    LoggingConfig,
    RedactingFormatter,
    RedactionConfig,
    setup_logging,
)


class TestRedactionConfig:
    """Tests for RedactionConfig."""

    def test_should_redact_key_true(self) -> None:
        config = RedactionConfig()
        assert config.should_redact_key("pat")
        assert config.should_redact_key("PAT")
        assert config.should_redact_key("auth_header")
        assert config.should_redact_key("password")

    def test_should_redact_key_false(self) -> None:
        config = RedactionConfig()
        assert not config.should_redact_key("auth_mode")
        assert not config.should_redact_key("username")
        assert not config.should_redact_key("project")

    def test_redact_value_with_pat(self) -> None:
        config = RedactionConfig()
        pat = "a" * 52  # 52-char ADO PAT
        result = config.redact_value(f"Using PAT: {pat}")
        assert "***REDACTED***" in result
        assert pat not in result

    def test_redact_value_with_bearer(self) -> None:
        config = RedactionConfig()
        result = config.redact_value(
            "Auth: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
        )
        assert "***REDACTED***" in result

    def test_redact_value_safe_string(self) -> None:
        config = RedactionConfig()
        safe = "Just a normal log message"
        assert config.redact_value(safe) == safe


class TestRedactingFormatter:
    """Tests for RedactingFormatter."""

    def test_format_redacts_message(self) -> None:
        formatter = RedactingFormatter("%(message)s")
        record = logging.LogRecord(
            name="test",
            level=logging.INFO,
            pathname="",
            lineno=0,
            msg="PAT: " + "a" * 52,
            args=(),
            exc_info=None,
        )
        result = formatter.format(record)
        assert "***REDACTED***" in result


class TestJsonlHandler:
    """Tests for JsonlHandler."""

    def test_emit_writes_jsonl(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            log_file = Path(tmpdir) / "test.log.jsonl"
            handler = JsonlHandler(log_file)

            record = logging.LogRecord(
                name="test.logger",
                level=logging.INFO,
                pathname="",
                lineno=0,
                msg="Test message",
                args=(),
                exc_info=None,
            )
            handler.emit(record)

            assert log_file.exists()
            content = log_file.read_text()
            assert "Test message" in content
            assert "test.logger" in content

    def test_emit_redacts_secrets(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            log_file = Path(tmpdir) / "test.log.jsonl"
            handler = JsonlHandler(log_file)
            pat = "a" * 52

            record = logging.LogRecord(
                name="test",
                level=logging.INFO,
                pathname="",
                lineno=0,
                msg=f"Using PAT: {pat}",
                args=(),
                exc_info=None,
            )
            handler.emit(record)

            content = log_file.read_text()
            assert "***REDACTED***" in content
            assert pat not in content


class TestLoggingConfig:
    """Tests for LoggingConfig."""

    def test_defaults(self) -> None:
        config = LoggingConfig()
        assert config.format == "console"
        assert config.log_file is None


class TestSetupLogging:
    """Tests for setup_logging function."""

    def test_setup_console_logging(self) -> None:
        config = LoggingConfig(format="console")
        setup_logging(config)
        root = logging.getLogger()
        assert len(root.handlers) >= 1

    def test_setup_jsonl_logging(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            config = LoggingConfig(
                format="jsonl",
                artifacts_dir=Path(tmpdir),
            )
            setup_logging(config)
            root = logging.getLogger()
            assert len(root.handlers) >= 1


class TestJsonlRedactionStructuredFields:
    """Tests for JSONL redaction across message, exception, and structured fields."""

    def test_jsonl_redacts_exception_traceback(self) -> None:
        """JSONL handler redacts secrets appearing in exception tracebacks."""
        import sys

        with tempfile.TemporaryDirectory() as tmpdir:
            log_file = Path(tmpdir) / "test.log.jsonl"
            handler = JsonlHandler(log_file)
            pat = "a" * 52

            # Create an exception containing the PAT
            try:
                raise ValueError(f"Auth failed with PAT: {pat}")
            except ValueError:
                exc_info = sys.exc_info()

            record = logging.LogRecord(
                name="test",
                level=logging.ERROR,
                pathname="",
                lineno=0,
                msg="Exception occurred",
                args=(),
                exc_info=exc_info,
            )
            handler.emit(record)

            content = log_file.read_text()
            # PAT should not appear anywhere in the output
            assert pat not in content

    def test_jsonl_redacts_structured_extra_fields(self) -> None:
        """JSONL handler redacts secrets in structured extra attributes."""
        with tempfile.TemporaryDirectory() as tmpdir:
            log_file = Path(tmpdir) / "test.log.jsonl"
            handler = JsonlHandler(log_file)
            pat = "a" * 52

            record = logging.LogRecord(
                name="test",
                level=logging.INFO,
                pathname="",
                lineno=0,
                msg="Processing request",
                args=(),
                exc_info=None,
            )
            # Add structured extra field containing a secret
            record.auth_token = pat
            record.bearer = f"Bearer {pat}"

            handler.emit(record)

            content = log_file.read_text()
            # PAT should be redacted even in structured fields
            assert pat not in content

    def test_jsonl_redacts_nested_dict_in_args(self) -> None:
        """JSONL handler redacts secrets in message args."""
        with tempfile.TemporaryDirectory() as tmpdir:
            log_file = Path(tmpdir) / "test.log.jsonl"
            handler = JsonlHandler(log_file)
            pat = "a" * 52

            record = logging.LogRecord(
                name="test",
                level=logging.INFO,
                pathname="",
                lineno=0,
                msg="Config: %s",
                args=({"pat": pat, "org": "TestOrg"},),
                exc_info=None,
            )
            handler.emit(record)

            content = log_file.read_text()
            # PAT should not appear in serialized output
            assert pat not in content
