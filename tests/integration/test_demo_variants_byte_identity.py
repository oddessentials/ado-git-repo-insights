"""Feature 310 R-08 + Feature 333 FR-3-03 byte-identity test between demo
variant-on and variant-off.

Per R-08 (``specs/310-comments-visualization/research.md``):
``scripts/generate-demo-data.py`` gains a ``--comments-metrics`` flag
that gates output serialization only.  Generation-layer draws are
identical regardless of the flag — the capability-on artifact
(``artifacts/demo-enterprise/``) and the capability-off artifact
(``artifacts/demo-enterprise-comments-off/``) MUST be byte-identical
except for the gated keys:

  - ``manifest.capabilities.comments_metrics``
  - ``manifest.features.comments``
  - ``manifest.coverage.comments``
  - ``prs[*].thread_count``
  - ``prs[*].comment_count``
  - ``prs[*].active_thread_count``
  - ``rollup[W].comments`` (Feature 333 FR-3-03 / INV-1-08 — the entire
    weekly comments aggregate sub-object on each rollup root).

This test enforces the contract via three ordered subtests plus a
Feature-333 FR-3-03 four-failure-mode positive control on the
capability-off variant rollup tree:

  1. **Sorted key-set equality excluding gated set (structural).**  For
     every JSON file present in either tree, the key sets at every
     object path — with gated keys removed — must be identical.
  2. **Canonicalized byte equality after gated-key removal (content).**
     With gated keys stripped from both trees, every JSON file is
     re-serialized using ``json.dumps(..., sort_keys=True)`` and
     compared byte-for-byte.
  3. **Array-order parity including ``prs[]`` (ordering-sensitive).**
     Every ordering-sensitive array (``prs[]`` inside weekly rollups
     especially) must be identical in position AND element content
     after gated-key removal.
  4. **FR-3-03 four-failure-mode gate on capability-off rollups.**
     Independent of the on-vs-off comparison, every weekly rollup file
     in the capability-off variant tree MUST individually satisfy each
     of FR-3-03's four omission failure modes:

       (a) the ``comments`` key NOT present (canonical absent state);
       (b) the ``comments`` key NOT present-with-``null``-value;
       (c) the ``comments`` key NOT present-with-``{}``-empty-object;
       (d) the ``comments`` key NOT present-with-partial-fields
           (e.g., 3 of 4 fields per INV-1-08 atomicity).

     Each failure mode is gated by its own test function so a regression
     emitting any of them under capability-off fails loud and clear with
     a one-to-one test → spec mapping.  The four tests redundantly cover
     case (a) — that's intentional: each test stands alone as the
     positive control for its specific failure mode.  The (a) test is
     the canonical guard; (b)/(c)/(d) catch shapes that ``"comments" not
     in rollup`` would also catch but whose test descriptions document
     the specific regression class being prevented.

If any subtest fails the producer has a contract bug — most likely the
``--comments-metrics`` flag has leaked into the generation layer
(``pr_record_rng`` / RNG / review-time draws).  Per R-08 the fix is to
restore single-code-path generation; the flag affects ONLY the
serialize step.
"""

from __future__ import annotations

import importlib.util
import json
import os
import sys
from collections.abc import Callable, Iterator
from pathlib import Path
from types import ModuleType
from typing import Final, cast

import pytest

# Tuple-from-root paths stripped from both variant trees before the
# subtest-1/2/3 comparisons.  Despite the historical name (predates
# Feature 333), this set applies to every JSON file in either variant
# tree, not just manifests.  Single-element tuples like ``("comments",)``
# match a top-level key on whatever JSON file the recursion is walking
# (rollup files for the new weekly comments aggregate; manifest doesn't
# have a top-level ``comments`` key — uses ``features.comments`` and
# ``coverage.comments`` nested paths).
_GATED_MANIFEST_PATHS: Final[frozenset[tuple[str, ...]]] = frozenset(
    {
        ("capabilities", "comments_metrics"),
        ("features", "comments"),
        ("coverage", "comments"),
        # Feature 333 FR-3-03 / INV-1-08: rollup-level weekly comments
        # aggregate.  When capabilities.comments_metrics is on, the
        # aggregator emits this 4-field sub-object on every weekly
        # rollup root.  Stripped here so subtests 1/2/3 stay green
        # against the on-vs-off comparison once the demo generator
        # carries the on-variant emission (T026).  The off-variant
        # rollup tree is independently gated by the four FR-3-03
        # failure-mode tests below.
        ("comments",),
    },
)
_GATED_PR_FIELDS: Final[frozenset[str]] = frozenset(
    {"thread_count", "comment_count", "active_thread_count"},
)
# Feature 333: the four atomic fields of ``rollup[W].comments`` per
# INV-1-08.  Used by the FR-3-03 partial-fielded failure-mode test (d)
# to identify the "all-four-present" canonical shape; any subset is a
# violation.
_COMMENTS_AGGREGATE_FIELDS: Final[frozenset[str]] = frozenset(
    {"thread_count", "comment_count", "active_thread_count", "coverage_partial"},
)

# Reroot the scratch space under REPO_ROOT/tmp_test_work/ so the generator's
# docs/data/ bypass guard (which calls .relative_to(REPO_ROOT)) doesn't
# reject temp paths on platforms where tmp_path lives outside the repo
# (feedback_pytest_tmp_path_outside_repo).
_REPO_ROOT: Final[Path] = Path(__file__).resolve().parents[2]
_SCRATCH_ROOT: Final[Path] = (
    _REPO_ROOT / "tmp_test_work" / "demo_variants_byte_identity"
)


def _load_generator_module() -> ModuleType:
    """Load ``scripts/generate-demo-data.py`` as an in-process module.

    The script name contains a hyphen so it can't be imported by name;
    we use ``importlib.util.spec_from_file_location`` and register it
    in ``sys.modules`` (required for ``@dataclass`` + globals to
    resolve cleanly on Python 3.12+).
    """
    script_path = _REPO_ROOT / "scripts" / "generate-demo-data.py"
    spec = importlib.util.spec_from_file_location("generate_demo_data", script_path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["generate_demo_data"] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def variant_trees() -> tuple[Path, Path]:
    """Run the generator twice (on + off) into sibling scratch dirs.

    Module-scoped so the ~5-10s generation cost is paid once per test
    session; all three subtests consume the same pair of trees.
    """
    _SCRATCH_ROOT.mkdir(parents=True, exist_ok=True)
    on_dir = _SCRATCH_ROOT / "variant_on"
    off_dir = _SCRATCH_ROOT / "variant_off"
    # Clear any previous run so we detect producer regressions, not
    # leftover bytes from an earlier commit.
    for dir_path in (on_dir, off_dir):
        if dir_path.exists():
            for root, subdirs, filenames in os.walk(dir_path, topdown=False):
                root_path = Path(root)
                for name in filenames:
                    (root_path / name).unlink()
                for name in subdirs:
                    (root_path / name).rmdir()
            dir_path.rmdir()
    module = _load_generator_module()
    # Module loaded via importlib doesn't expose typed attributes to
    # mypy; cast to the known callable shape defined by the generator's
    # main(argv) -> int signature.
    main_fn = cast(Callable[[list[str]], int], module.main)
    rc_on = main_fn(
        ["--output-root", str(on_dir), "--comments-metrics", "true"],
    )
    assert rc_on == 0, "variant-on generator failed"
    rc_off = main_fn(
        ["--output-root", str(off_dir), "--comments-metrics", "false"],
    )
    assert rc_off == 0, "variant-off generator failed"
    return (on_dir, off_dir)


def _iter_json_files(root: Path) -> Iterator[Path]:
    yield from sorted(root.rglob("*.json"))


def _relative_json_files(root: Path) -> set[Path]:
    return {path.relative_to(root) for path in _iter_json_files(root)}


def _strip_gated(
    payload: object,
    manifest_path: tuple[str, ...] = (),
    in_prs_array: bool = False,
) -> object:
    """Recursively strip the gated keys from a parsed JSON payload.

    ``manifest_path`` tracks the current path under a manifest's root,
    so keys like ``capabilities.comments_metrics`` are stripped only at
    the manifest-level location rather than at every nested object.
    ``in_prs_array`` flag marks that the current recursion is inside a
    ``prs`` list element, enabling the per-PR field strip.
    """
    if isinstance(payload, dict):
        stripped: dict[str, object] = {}
        for key, value in payload.items():
            if in_prs_array and key in _GATED_PR_FIELDS:
                continue
            next_path = (*manifest_path, key)
            if next_path in _GATED_MANIFEST_PATHS:
                continue
            if key == "prs" and isinstance(value, list):
                stripped[key] = [
                    _strip_gated(item, (), in_prs_array=True) for item in value
                ]
            else:
                stripped[key] = _strip_gated(value, next_path, in_prs_array=False)
        return stripped
    if isinstance(payload, list):
        return [
            _strip_gated(item, manifest_path, in_prs_array=in_prs_array)
            for item in payload
        ]
    return payload


def _recursive_key_set(payload: object, prefix: str = "") -> set[str]:
    """Return every ``dot.path`` of every dict key reachable in ``payload``."""
    keys: set[str] = set()
    if isinstance(payload, dict):
        for key, value in payload.items():
            full = f"{prefix}.{key}" if prefix else key
            keys.add(full)
            keys.update(_recursive_key_set(value, full))
    elif isinstance(payload, list):
        for item in payload:
            # Index is intentionally NOT part of the key — the path
            # structure flattens arrays for the key-set comparison.
            # Array-order parity lives in the third subtest.
            keys.update(_recursive_key_set(item, prefix))
    return keys


# --------------------------------------------------------------------------
# Subtest 1: sorted key-set equality excluding gated set (structural).
# --------------------------------------------------------------------------


def test_sorted_key_equality_excluding_gated_set(
    variant_trees: tuple[Path, Path],
) -> None:
    """Structural: the two variants' JSON file sets and key sets agree."""
    on_dir, off_dir = variant_trees
    on_files = _relative_json_files(on_dir)
    off_files = _relative_json_files(off_dir)
    assert on_files == off_files, (
        f"variant file set mismatch:\n"
        f"  only-on: {sorted(on_files - off_files)!r}\n"
        f"  only-off: {sorted(off_files - on_files)!r}"
    )
    for rel in sorted(on_files):
        on_text = (on_dir / rel).read_text(encoding="utf-8")
        off_text = (off_dir / rel).read_text(encoding="utf-8")
        on_stripped = _strip_gated(json.loads(on_text))
        off_stripped = _strip_gated(json.loads(off_text))
        on_keys = _recursive_key_set(on_stripped)
        off_keys = _recursive_key_set(off_stripped)
        assert on_keys == off_keys, (
            f"key-set mismatch in {rel!s} after gated strip:\n"
            f"  only-on: {sorted(on_keys - off_keys)!r}\n"
            f"  only-off: {sorted(off_keys - on_keys)!r}"
        )


# --------------------------------------------------------------------------
# Subtest 2: canonicalized byte equality after gated-key removal (content).
# --------------------------------------------------------------------------


def test_canonicalized_byte_equality_after_gated_removal(
    variant_trees: tuple[Path, Path],
) -> None:
    """Content: the two variants' JSON payloads are byte-equal after strip."""
    on_dir, off_dir = variant_trees
    on_files = _relative_json_files(on_dir)
    for rel in sorted(on_files):
        on_obj = json.loads((on_dir / rel).read_text(encoding="utf-8"))
        off_obj = json.loads((off_dir / rel).read_text(encoding="utf-8"))
        on_stripped = _strip_gated(on_obj)
        off_stripped = _strip_gated(off_obj)
        on_canonical = json.dumps(on_stripped, sort_keys=True, indent=None)
        off_canonical = json.dumps(off_stripped, sort_keys=True, indent=None)
        assert on_canonical == off_canonical, (
            f"canonicalized bytes differ in {rel!s} after gated strip.\n"
            "This almost always means the --comments-metrics flag "
            "leaked into the generation layer (e.g. an ``if _EMIT_..."
            "`` branch that changed an RNG draw).  Restore single-"
            "code-path generation per R-08."
        )


# --------------------------------------------------------------------------
# Subtest 3: array-order parity including prs[] (ordering-sensitive).
# --------------------------------------------------------------------------


def _compare_arrays(
    on_payload: object,
    off_payload: object,
    path: str,
) -> list[str]:
    """Return a list of human-readable diagnostics for any ordering drift."""
    diagnostics: list[str] = []
    if isinstance(on_payload, list) and isinstance(off_payload, list):
        if len(on_payload) != len(off_payload):
            diagnostics.append(
                f"{path}: array length mismatch ({len(on_payload)} vs {len(off_payload)})"
            )
            return diagnostics
        for idx, (on_item, off_item) in enumerate(
            zip(on_payload, off_payload, strict=True)
        ):
            # Strip gated keys from each element before comparing so a
            # simple equality reveals any position-level drift.
            on_stripped = _strip_gated(on_item, in_prs_array=(path.endswith("prs")))
            off_stripped = _strip_gated(off_item, in_prs_array=(path.endswith("prs")))
            if on_stripped != off_stripped:
                diagnostics.append(
                    f"{path}[{idx}]: element content / order differs after gated strip.\n"
                    f"  on={on_stripped!r}\n"
                    f"  off={off_stripped!r}"
                )
        return diagnostics
    if isinstance(on_payload, dict) and isinstance(off_payload, dict):
        for key in sorted(set(on_payload) | set(off_payload)):
            diagnostics.extend(
                _compare_arrays(
                    on_payload.get(key), off_payload.get(key), f"{path}.{key}"
                ),
            )
    return diagnostics


def test_array_order_parity_including_prs(
    variant_trees: tuple[Path, Path],
) -> None:
    """Ordering: every ``prs[]`` and other array keeps identical position + content."""
    on_dir, off_dir = variant_trees
    on_files = _relative_json_files(on_dir)
    all_diagnostics: list[str] = []
    for rel in sorted(on_files):
        on_obj = json.loads((on_dir / rel).read_text(encoding="utf-8"))
        off_obj = json.loads((off_dir / rel).read_text(encoding="utf-8"))
        diagnostics = _compare_arrays(on_obj, off_obj, path=str(rel))
        all_diagnostics.extend(diagnostics)
    assert not all_diagnostics, (
        "array-order parity violations detected:\n  - "
        + "\n  - ".join(all_diagnostics[:10])
    )


# --------------------------------------------------------------------------
# Subtest 4 (Feature 333 FR-3-03): four-failure-mode gate on capability-off
# rollup tree.  Each failure mode is gated by its own test function so the
# test → spec mapping is one-to-one.  Cases (b)/(c)/(d) are redundant with
# (a) at the assertion level (``"comments" not in rollup`` covers all four
# physical shapes), but each is asserted with a description that documents
# the specific regression class being caught — a future maintainer reading
# the test names sees explicitly that all four FR-3-03 omission failure
# modes are gated.
# --------------------------------------------------------------------------


_WEEKLY_ROLLUPS_RELDIR: Final[Path] = Path("aggregates") / "weekly_rollups"


def _iter_off_variant_rollups(
    off_dir: Path,
) -> Iterator[tuple[Path, dict[str, object]]]:
    """Yield ``(rel_path, parsed_rollup_dict)`` for every off-variant rollup.

    Walks the capability-off variant tree's
    ``aggregates/weekly_rollups/*.json`` directory and parses each
    rollup file.  Skips non-rollup JSON files (manifest, distributions,
    comment batches) — FR-3-03 specifically gates the rollup-root
    ``comments`` key, not other surfaces.  The manifest's
    ``coverage.comments`` and ``features.comments`` nested paths are
    handled by the existing ``_GATED_MANIFEST_PATHS`` strip and are NOT
    re-checked here (different contract: those are dataset-level
    metadata, not the per-week aggregate this test guards).
    """
    rollups_dir = off_dir / _WEEKLY_ROLLUPS_RELDIR
    if not rollups_dir.is_dir():
        # Generator regressions could conceivably skip the weekly_rollups
        # directory entirely; surface that as a fixture-level failure
        # rather than a silent zero-iteration pass.
        pytest.fail(
            f"capability-off variant has no weekly_rollups directory at "
            f"{rollups_dir!s}; FR-3-03 cannot be gated"
        )
    rollup_files = sorted(rollups_dir.glob("*.json"))
    if not rollup_files:
        pytest.fail(
            f"capability-off variant weekly_rollups directory at "
            f"{rollups_dir!s} is empty; FR-3-03 cannot be gated"
        )
    for rollup_path in rollup_files:
        rel = rollup_path.relative_to(off_dir)
        parsed = json.loads(rollup_path.read_text(encoding="utf-8"))
        if not isinstance(parsed, dict):
            pytest.fail(
                f"weekly rollup at {rel!s} is not a JSON object "
                f"(got {type(parsed).__name__}); FR-3-03 expects "
                "object-rooted rollup files"
            )
        # ``parsed`` is dict[str, object] in shape; a precise cast keeps
        # mypy honest without a typing.Any escape hatch (QG-40).
        yield rel, cast(dict[str, object], parsed)


def test_fr_3_03_a_comments_key_absent_in_capability_off_rollups(
    variant_trees: tuple[Path, Path],
) -> None:
    """FR-3-03 (a): the ``comments`` key MUST be absent on every off rollup.

    This is the canonical absent state.  The aggregator under
    ``capabilities.comments_metrics === false`` MUST NOT emit the
    ``comments`` sub-object at all on any week's rollup root.  Cases
    (b)/(c)/(d) below are physical-shape variants of "the key is
    present" — this test catches all of them via the simple ``not in``
    assertion, but those tests stand alone as positive controls for
    their specific regression classes.
    """
    _on_dir, off_dir = variant_trees
    for rel, rollup in _iter_off_variant_rollups(off_dir):
        assert "comments" not in rollup, (
            f"FR-3-03 (a) violation in {rel!s}: rollup root has the "
            f"``comments`` key under capability-off "
            f"(value: {rollup.get('comments')!r}).  The entire "
            "weekly comments aggregate sub-object MUST be absent when "
            "capabilities.comments_metrics is false."
        )


def test_fr_3_03_b_comments_key_not_null_valued_in_capability_off_rollups(
    variant_trees: tuple[Path, Path],
) -> None:
    """FR-3-03 (b): the ``comments`` key MUST NOT be present with a null value.

    Catches the regression class where a producer emits
    ``"comments": null`` under capability-off (e.g., a defensive
    "always emit the key, set to None when capability is off"
    refactor).  Per FR-3-03 + INV-1-08, the entire key must be
    omitted; null is NOT an acceptable absent-state encoding.
    """
    _on_dir, off_dir = variant_trees
    for rel, rollup in _iter_off_variant_rollups(off_dir):
        if "comments" in rollup:
            value = rollup["comments"]
            pytest.fail(
                f"FR-3-03 (b) violation in {rel!s}: ``comments`` key "
                f"present with value {value!r} under capability-off.  "
                "Even null is a violation — the key MUST be omitted "
                "entirely (absent), never null-valued.  See spec "
                "FR-3-03 + INV-1-08."
            )


def test_fr_3_03_c_comments_key_not_empty_object_in_capability_off_rollups(
    variant_trees: tuple[Path, Path],
) -> None:
    """FR-3-03 (c): the ``comments`` key MUST NOT be present as ``{}``.

    Catches the regression class where a producer emits
    ``"comments": {}`` under capability-off (e.g., a unconditional
    ``rollup_data["comments"] = build_comments(...)`` that builds an
    empty dict when capability is off, instead of guarding the
    assignment).  Per FR-3-03 + INV-1-08, the entire key must be
    omitted; an empty object is NOT an acceptable absent-state
    encoding.  INV-1-08 atomicity demands all four fields when
    present, so ``{}`` is also an INV-1-08 violation independent of
    capability state.
    """
    _on_dir, off_dir = variant_trees
    for rel, rollup in _iter_off_variant_rollups(off_dir):
        if "comments" in rollup:
            value = rollup["comments"]
            # The assertion catches both ``{}`` literally AND any
            # other "present but unintended" shape; the (a)/(b)/(d)
            # tests catch the same root violation via different
            # framing, but this one's diagnostic specifically calls
            # out the empty-object failure mode.
            pytest.fail(
                f"FR-3-03 (c) violation in {rel!s}: ``comments`` key "
                f"present (value: {value!r}) under capability-off.  "
                "An empty object ``{}`` is NOT an acceptable absent-"
                "state encoding — the key MUST be omitted entirely.  "
                "See spec FR-3-03 + INV-1-08."
            )


def test_fr_3_03_d_comments_key_not_partial_fielded_in_capability_off_rollups(
    variant_trees: tuple[Path, Path],
) -> None:
    """FR-3-03 (d): the ``comments`` key MUST NOT be present with partial fields.

    Catches the regression class where a producer emits the
    ``comments`` sub-object with only a subset of INV-1-08's four
    canonical fields (e.g., 3 of 4 fields, or all 4 with one set to
    null) under capability-off.  Per FR-3-03 the entire key must be
    omitted; per INV-1-08 the sub-object is atomic when present, so
    partial-fielded shapes are doubly invalid under capability-off.
    Diagnostic includes the specific missing/extra fields so a
    failing emission is debuggable on first read.
    """
    _on_dir, off_dir = variant_trees
    for rel, rollup in _iter_off_variant_rollups(off_dir):
        if "comments" in rollup:
            value = rollup["comments"]
            if isinstance(value, dict):
                present = frozenset(value.keys())
                missing = sorted(_COMMENTS_AGGREGATE_FIELDS - present)
                extra = sorted(present - _COMMENTS_AGGREGATE_FIELDS)
                shape_diag = (
                    f"present_fields={sorted(present)!r}, "
                    f"missing_canonical={missing!r}, "
                    f"extra_unknown={extra!r}"
                )
            else:
                shape_diag = f"non-dict value={value!r}"
            pytest.fail(
                f"FR-3-03 (d) violation in {rel!s}: ``comments`` key "
                f"present under capability-off ({shape_diag}).  "
                "Partial-fielded shapes (e.g., 3 of 4 fields) are "
                "NEVER acceptable — under capability-off the entire "
                "key MUST be omitted (FR-3-03), and even under "
                "capability-on the four fields are atomic per "
                "INV-1-08.  See spec FR-3-03 + INV-1-08."
            )
