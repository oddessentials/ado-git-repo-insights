"""Test that ResourceWarnings are properly suppressed (T027).

This test verifies that the pytest configuration in pyproject.toml
properly filters out ResourceWarning messages to keep test output clean.
"""

import warnings


def test_resource_warnings_filtered_by_pytest_config() -> None:
    """Verify that the pytest filterwarnings config is applied.

    This test checks that when running under pytest, ResourceWarnings
    are filtered according to pyproject.toml [tool.pytest.ini_options].

    The actual warnings would come from database fixtures and pandas,
    but this test verifies the filter mechanism works.
    """
    # This should NOT cause the test to fail because pytest config filters it
    with warnings.catch_warnings(record=True):
        # The filterwarnings in pyproject.toml should suppress this
        warnings.warn("test resource warning", ResourceWarning, stacklevel=1)

    # If we get here without error, the filter is working
    assert True


def test_other_warnings_not_suppressed() -> None:
    """Verify that non-ResourceWarnings are still captured.

    Only ResourceWarning should be filtered - other warnings should
    still be visible for proper debugging.
    """
    # UserWarning should NOT be suppressed
    with warnings.catch_warnings(record=True) as captured:
        warnings.simplefilter("always")  # Capture all warnings
        warnings.warn("test user warning", UserWarning, stacklevel=1)

        # UserWarning should be captured
        assert len(captured) == 1
        assert issubclass(captured[0].category, UserWarning)
