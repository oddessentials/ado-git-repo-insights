"""Doc-vs-code parity locks for the backfill-comments surface.

Each test in this module pins a specific documentation-to-code parity
claim that regressed during the 058-backfill-comments Phase 2 doc audit.
The claims are:

1. The observable closing console signal documented in
   ``extension.md``'s "How to tell it's working" section must match
   ``cli.py``'s actual ``logger.info`` format string. The prior doc
   version misattributed the ``loop-complete: processed=X failed=Y``
   run_summary warning as the console signal — that string is written
   only to ``run_summary.json`` via ``_append_backfill_warning``.

2. Any user-facing doc that states the backfill throughput rate
   (``~1 PR/sec`` / ``one PR per second``) must hedge it as empirical
   guidance, not a guarantee. The rate is measured against one org on
   hosted Ubuntu agents and depends on thread volume per PR plus
   upstream rate limiting.

3. ``extension.md``'s Backfilling section must document the
   legacy-schema precondition and quote the actual ``cli.py`` log
   body verbatim so users can grep pipeline logs for it.

Each test carries at least one anchor to a source-code string plus one
anchor to the doc, so a unilateral edit to either side breaks the test
and forces both to move together. No assertion here is always-green.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]

_EXTENSION_DOC = REPO_ROOT / "docs" / "user-guide" / "extension.md"
_CLI_DOC = REPO_ROOT / "docs" / "reference" / "cli-reference.md"
_TASK_DOC = REPO_ROOT / "docs" / "reference" / "task-reference.md"
_CLI_SOURCE = REPO_ROOT / "src" / "ado_git_repo_insights" / "cli.py"
_TASK_MANIFEST = REPO_ROOT / "extension" / "tasks" / "extract-prs" / "task.json"

_RATE_PATTERN = re.compile(
    r"(~\s*1\s*PR\s*/\s*sec|one\s+PR\s+per\s+second)",
    re.IGNORECASE,
)
_HEDGE_PATTERN = re.compile(
    r"\b(empirical(?:ly)?|approximat(?:e|ely)|measured|not\s+a\s+guarantee)\b",
    re.IGNORECASE,
)


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def test_extension_md_closing_signal_matches_cli_logger() -> None:
    """extension.md must render the actual console closing line from cli.py.

    Regression being locked: a prior extension.md revision claimed
    ``loop-complete: processed=X failed=Y`` was the console closing
    signal. That string is appended to ``run_summary.json``'s
    ``warnings`` list via ``_append_backfill_warning`` and never reaches
    any logger. The real console closing line is emitted by
    ``logger.info`` in ``cmd_backfill_comments`` using the format
    asserted below.
    """
    cli_source = _read(_CLI_SOURCE)
    doc = _read(_EXTENSION_DOC)

    # Anchor 1 — cli.py logger format string. If cli.py renames this,
    # the test fails and the author is forced to update the doc + this
    # test together rather than silently drifting.
    closing_fmt = "processed %d pull requests (%d failures)"
    assert closing_fmt in cli_source, (
        f"cli.py closing logger.info format string missing "
        f"({closing_fmt!r}). This test locks extension.md against the "
        f"logger emission site; update both together if the format moves."
    )

    # Anchor 2 — doc rendering of that same format. Fails if the doc
    # stops documenting the observable signal users grep pipeline logs
    # for.
    doc_rendering = "processed N pull requests (K failures)"
    assert doc_rendering in doc, (
        f"extension.md must render the actual console closing line "
        f"({doc_rendering!r}) so users can grep pipeline logs for it. "
        f"cli.py emits this format but the doc no longer surfaces it."
    )

    # Anchor 3 — regression guard against the specific prior
    # misattribution shape (`loop-complete: ... | Closing line` in the
    # observable-signals table). The ``loop-complete:`` literal is
    # legitimately used elsewhere in the doc to describe the
    # run_summary.json artifact entry, so the guard is scoped to the
    # table-row shape that caused the original bug.
    forbidden_row = "`loop-complete: processed=X failed=Y` | Closing"
    assert forbidden_row not in doc, (
        "extension.md re-introduced the loop-complete console "
        "misattribution. That string is written only to "
        "run_summary.json's warnings list (cli.py "
        "_append_backfill_warning); the console closing line is "
        "'processed N pull requests (K failures)'."
    )


def test_backfill_rate_claim_is_hedged_in_every_doc() -> None:
    """Every doc that states the backfill rate must hedge it as empirical.

    Regression being locked: the ``~1 PR/sec`` claim appeared plainly
    in three reference surfaces. Step 1 of the Phase 2 audit hedged
    only one; the other two were missed, creating a cross-reference
    inconsistency flagged by the stop-hook review.

    This test sweeps every ``.md`` under ``docs/`` so that any future
    doc surface that adopts the rate claim is caught immediately if it
    lacks an empirical hedge.
    """
    doc_files = sorted((REPO_ROOT / "docs").rglob("*.md"))
    offenders: list[str] = []
    for doc_path in doc_files:
        text = _read(doc_path)
        if _RATE_PATTERN.search(text) and not _HEDGE_PATTERN.search(text):
            offenders.append(str(doc_path.relative_to(REPO_ROOT)))
    assert not offenders, (
        f"Docs state the backfill throughput rate without an empirical "
        f"hedge: {offenders}. The rate ('~1 PR/sec' / 'one PR per "
        f"second') is measured against one org on hosted Ubuntu agents; "
        f"treat it as empirical guidance, not a guarantee. Add a hedge "
        f"word (empirical / approximate / measured / not a guarantee) "
        f"in the same doc."
    )

    # Sanity anchor — at least one of the known surfaces must
    # currently state the rate. Without this, a future refactor that
    # silently drops the rate from every doc would leave the offenders
    # loop scanning nothing and reporting green. Forces explicit
    # re-evaluation if the claim ever disappears corpus-wide.
    known_surfaces = (_EXTENSION_DOC, _CLI_DOC, _TASK_DOC)
    rate_present = [p for p in known_surfaces if _RATE_PATTERN.search(_read(p))]
    assert rate_present, (
        "None of the known backfill-rate surfaces "
        f"({[str(p.relative_to(REPO_ROOT)) for p in known_surfaces]!r}) "
        "still state the rate. Either the feature was removed (delete "
        "this test and the rate guidance together) or the rate was "
        "silently dropped and must be re-added with empirical framing."
    )


def test_sample_pipeline_backfill_block_precedes_csv_generation() -> None:
    """The commented-out backfill-comments block in the sample pipeline
    must appear BEFORE the ``ado-insights generate-csv`` invocation.

    Regression being locked: a prior template placed the backfill block
    after generate-csv. Uncommenting would publish stale CSVs (generated
    from pre-backfill DB state), hiding the newly-covered comments from
    PowerBI consumers until the next pipeline run.
    """
    yml_path = REPO_ROOT / "pr-insights-pipeline.yml"
    text = yml_path.read_text(encoding="utf-8")

    backfill_idx = text.find("ado-insights backfill-comments")
    csv_idx = text.find("ado-insights generate-csv")

    assert backfill_idx != -1, (
        "pr-insights-pipeline.yml must contain an "
        "`ado-insights backfill-comments` reference (commented or "
        "uncommented) documenting the one-time backfill workflow."
    )
    assert csv_idx != -1, (
        "pr-insights-pipeline.yml must contain an "
        "`ado-insights generate-csv` invocation for PowerBI CSV generation."
    )
    assert backfill_idx < csv_idx, (
        "pr-insights-pipeline.yml must place the backfill-comments block "
        "(commented or uncommented) BEFORE the `ado-insights generate-csv` "
        "invocation. Uncommenting a later-placed block would publish stale "
        "CSVs (generated from pre-backfill DB state), hiding newly-covered "
        "comments from PowerBI consumers until the next pipeline run."
    )


def test_task_json_exposes_backfill_shared_inputs_in_backfill_mode() -> None:
    """Inputs documented in task-reference.md as "shared with extract mode"
    must remain reachable in backfill-comments mode via task.json.

    Regression being locked: task.json had
    ``visibleRule: "includeComments = true"`` on ``commentsMaxThreadsPerPr``,
    hiding the field in backfill mode where ``includeComments`` is neither
    set nor allowed (the task rejects ``includeComments: true`` in
    backfill mode per cross-mode input rejection). task-reference.md
    documents the input as a shared backfill input, so docs promised a
    UI affordance the manifest did not expose.

    A Python-side companion to the node-assert lock in
    ``extension/tasks/extract-prs/index.test.js``
    (``testTaskManifestKeepsSharedThreadCapVisible``). Cross-artifact
    verification: task-reference.md ↔ task.json, not just node tests ↔
    task.json.
    """
    task_manifest = json.loads(_TASK_MANIFEST.read_text(encoding="utf-8"))
    task_reference = _TASK_DOC.read_text(encoding="utf-8")

    # Sanity anchor 1 — task-reference.md still documents the input.
    # If the doc is restructured and this sentinel disappears, the test
    # must be re-scoped rather than silently going green.
    assert "commentsMaxThreadsPerPr" in task_reference, (
        "task-reference.md no longer mentions commentsMaxThreadsPerPr. "
        "Either the feature was removed or the doc was restructured — "
        "re-scope this test."
    )
    # Sanity anchor 2 — the doc must still describe backfill-mode inputs
    # using the "shared with extract mode" phrasing that signals the
    # cross-mode availability this test protects.
    assert "shared with extract mode" in task_reference, (
        "task-reference.md no longer describes backfill inputs as 'shared "
        "with extract mode'. Re-scope this test to match the current "
        "phrasing before it becomes vacuous."
    )

    # Manifest assertion — the input must be exposed in BOTH
    # extract-with-comments (``includeComments = true``) AND
    # backfill-comments mode. Accepted shapes:
    #   * no visibleRule (always visible; pollutes extract UX when
    #     includeComments=false, but not a correctness bug)
    #   * a precise OR rule that admits both modes
    # Rejected:
    #   * a rule that omits ``mode = backfill-comments`` (hides the field
    #     in backfill mode — the original bug)
    #   * a rule that omits ``includeComments = true`` (breaks existing
    #     extract users who enabled comments)
    raw_inputs = task_manifest.get("inputs", [])
    assert isinstance(raw_inputs, list), (
        f"task.json `inputs` must be a list; got {type(raw_inputs).__name__}."
    )
    matching = [
        entry
        for entry in raw_inputs
        if isinstance(entry, dict) and entry.get("name") == "commentsMaxThreadsPerPr"
    ]
    assert len(matching) == 1, (
        "task.json must declare exactly one `commentsMaxThreadsPerPr` "
        f"input; found {len(matching)}."
    )
    visible_rule = matching[0].get("visibleRule")
    if visible_rule is not None:
        assert isinstance(visible_rule, str), (
            "task.json `visibleRule` must be a string; got "
            f"{type(visible_rule).__name__}."
        )
        assert "mode = backfill-comments" in visible_rule, (
            "task.json visibleRule on `commentsMaxThreadsPerPr` does not "
            "admit backfill-comments mode, hiding the field where "
            "task-reference.md documents it as shared. Acceptable: no "
            "visibleRule, or a rule including `mode = backfill-comments` "
            "via an OR (e.g., "
            "`includeComments = true || mode = backfill-comments`). "
            f"Current: {visible_rule!r}"
        )
        assert "includeComments = true" in visible_rule, (
            "task.json visibleRule on `commentsMaxThreadsPerPr` does not "
            "admit extract mode with `includeComments=true`, which would "
            "break existing extract users who enabled comments. "
            "Acceptable: no visibleRule, or a rule including "
            "`includeComments = true` via an OR. "
            f"Current: {visible_rule!r}"
        )


def test_extension_md_documents_legacy_schema_precondition() -> None:
    """extension.md must quote the legacy-schema skip log body verbatim.

    Regression being locked: running ``backfill-comments`` against a
    DB whose schema predates the ``pr_threads`` / ``pr_comments``
    tables silently exits 0 after logging a ``skipped (legacy schema;
    …)`` warning. A user copying the doc verbatim onto an old DB
    artifact would see a "successful" pipeline run with zero coverage
    progress. The doc must front-load this precondition and quote the
    exact log body so users can grep for it in pipeline output.
    """
    cli_source = _read(_CLI_SOURCE)
    doc = _read(_EXTENSION_DOC)

    # Anchor 1 — cli.py log body. Fails on drift; forces this test and
    # the doc to move together if cli.py's wording changes.
    legacy_log_body = "skipped (legacy schema; no thread storage tables)"
    assert legacy_log_body in cli_source, (
        f"cli.py legacy-schema skip log body has drifted; expected "
        f"{legacy_log_body!r}. Update the doc precondition + this test "
        f"to match the new wording."
    )

    # Anchor 2 — doc quotes that same log body verbatim. Fails if the
    # precondition callout is removed, rewritten to paraphrase the log
    # line, or relocated out of the Backfilling section.
    assert legacy_log_body in doc, (
        f"extension.md's Backfilling section must quote the actual "
        f"cli.py legacy-schema log body ({legacy_log_body!r}) so users "
        f"can grep pipeline logs for it. Paraphrasing defeats the "
        f"grep-for-this-string workflow."
    )


_VISIBLE_RULE_LHS_RE = re.compile(
    r"([A-Za-z_][A-Za-z0-9_]*)\s*"
    r"(?:=|!=|>=?|<=?|EndsWith|NotEndsWith|Contains|NotContains|StartsWith|NotStartsWith)"
)


def test_task_json_inputs_declared_before_visible_rule_references() -> None:
    """Every input referenced by another input's ``visibleRule`` must
    appear earlier in the ``inputs`` array.

    Azure DevOps marketplace's ``PackageValidationStep`` rejects uploads
    whose task manifest declares an input AFTER another input whose
    ``visibleRule`` references it. Regression for the 2026-04-17
    marketplace rejection where the ``mode`` pickList was appended at
    the end of ``inputs`` while ``commentsMaxThreadsPerPr.visibleRule``
    was concurrently updated to reference ``mode`` — marketplace
    returned::

        Task definition input 'mode' should come before Task
        definition input 'commentsMaxThreadsPerPr' as per dependent
        inputs order ...

    Fix: move the referenced input earlier in the array. This test
    catches any future forward-reference across all inputs.
    """
    task_manifest = json.loads(_TASK_MANIFEST.read_text(encoding="utf-8"))
    inputs = task_manifest.get("inputs", [])
    assert isinstance(inputs, list), (
        f"task.json `inputs` must be a list; got {type(inputs).__name__}."
    )
    name_to_index: dict[str, int] = {}
    for idx, entry in enumerate(inputs):
        assert isinstance(entry, dict), (
            f"task.json `inputs[{idx}]` must be a mapping; got {type(entry).__name__}."
        )
        name = entry.get("name")
        assert isinstance(name, str), (
            f"task.json `inputs[{idx}].name` must be a string; got {type(name).__name__}."
        )
        assert name, f"task.json `inputs[{idx}].name` must be non-empty."
        name_to_index[name] = idx

    for idx, entry in enumerate(inputs):
        rule = entry.get("visibleRule")
        if rule is None:
            continue
        assert isinstance(rule, str), (
            f"task.json `inputs[{idx}].visibleRule` must be a string; "
            f"got {type(rule).__name__}."
        )
        for ref_name in _VISIBLE_RULE_LHS_RE.findall(rule):
            ref_idx = name_to_index.get(ref_name)
            assert ref_idx is not None, (
                f"input {entry['name']!r} visibleRule references unknown "
                f"input {ref_name!r}; rule={rule!r}"
            )
            assert ref_idx < idx, (
                f"input {entry['name']!r} (index {idx}) visibleRule "
                f"references {ref_name!r} (index {ref_idx}); Azure "
                f"DevOps marketplace PackageValidationStep requires "
                f"inputs in dependency order — {ref_name!r} must be "
                f"declared BEFORE {entry['name']!r}. Move the "
                f"{ref_name!r} input earlier in task.json's inputs "
                f"array. Rule: {rule!r}"
            )
