"""CSV generator for PowerBI-compatible output.

Generates CSVs that are:
- Schema-compliant (exact columns, exact order - Invariants 1-4)
- Deterministic (same DB → same bytes - Adjustment 3)
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import TYPE_CHECKING

import pandas as pd

from ..persistence.models import CSV_SCHEMAS, SORT_KEYS

if TYPE_CHECKING:
    from ..persistence.database import DatabaseManager

logger = logging.getLogger(__name__)


class CSVGenerationError(Exception):
    """CSV generation failed."""


class CSVGenerator:
    """Generates PowerBI-compatible CSV files from SQLite.

    Invariant 1: CSV schema is a hard contract.
    Invariant 3: CSV output must be deterministic.
    """

    def __init__(self, db: DatabaseManager, output_dir: Path) -> None:
        """Initialize the CSV generator.

        Args:
            db: Database manager instance.
            output_dir: Directory for CSV output files.
        """
        self.db = db
        self.output_dir = output_dir

    def generate_all(self) -> dict[str, int]:
        """Generate all CSV files.

        Returns:
            Dict mapping table names to row counts.

        Raises:
            CSVGenerationError: If generation fails.
        """
        self.output_dir.mkdir(parents=True, exist_ok=True)

        results: dict[str, int] = {}

        for table_name, columns in CSV_SCHEMAS.items():
            try:
                count = self._generate_table(table_name, columns)
                results[table_name] = count
                logger.info(f"Generated {table_name}.csv: {count} rows")
            except Exception as e:
                raise CSVGenerationError(
                    f"Failed to generate {table_name}.csv: {e}"
                ) from e

        return results

    def _generate_table(self, table_name: str, columns: list[str]) -> int:
        """Generate a single CSV file.

        Args:
            table_name: Name of the table/CSV.
            columns: Expected column order (contract).

        Returns:
            Number of rows written.
        """
        # Query the table
        column_list = ", ".join(columns)
        df = pd.read_sql_query(
            f"SELECT {column_list} FROM {table_name}",  # noqa: S608 -- SECURITY: table_name and columns are hardcoded constants, not user input
            self.db.connection,
        )

        # Ensure column order matches contract exactly (Invariant 1)
        df = df[columns]

        # Deterministic row ordering (Adjustment 3)
        sort_keys = SORT_KEYS.get(table_name, columns[:1])
        df = df.sort_values(by=sort_keys, ascending=True)

        # Write CSV with deterministic settings
        output_path = self.output_dir / f"{table_name}.csv"
        df.to_csv(
            output_path,
            index=False,
            encoding="utf-8",
            lineterminator="\n",  # Unix line endings for consistency
            date_format="%Y-%m-%dT%H:%M:%S",  # Consistent datetime format
        )

        return len(df)

    def validate_schemas(self) -> bool:
        """Validate that generated CSVs match expected schemas.

        Returns:
            True if all schemas valid.

        Raises:
            CSVGenerationError: If any schema mismatch.
        """
        for table_name, expected_columns in CSV_SCHEMAS.items():
            csv_path = self.output_dir / f"{table_name}.csv"

            if not csv_path.exists():
                raise CSVGenerationError(f"Missing CSV: {csv_path}")

            df = pd.read_csv(csv_path, nrows=0)  # Just read headers
            actual_columns = list(df.columns)

            if actual_columns != expected_columns:
                raise CSVGenerationError(
                    f"Schema mismatch in {table_name}.csv:\n"
                    f"  Expected: {expected_columns}\n"
                    f"  Actual:   {actual_columns}"
                )

        logger.info("All CSV schemas validated successfully")
        return True
