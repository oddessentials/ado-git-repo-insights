"""task.json semantic invariants registry.

Azure DevOps marketplace's ``PackageValidationStep`` enforces rules —
server-side, on upload — that are NOT present in the published
``tasks.schema.json``. Those rules are invisible to local jsonschema
validation, invisible to ``tfx extension create`` (packaging validates
structure, not semantics), and only surface post-upload via
``tfx extension isvalid`` or the marketplace red-X. This module is the
collecting place for those rules.

When a new server-side rule is discovered — always via
``tfx extension isvalid`` per ``feedback_run_isvalid_before_theorizing`` —
add a pure ``_find_<name>_violations`` checker below, a positive test
that asserts the REAL manifest is clean, and a negative test that
proves the checker catches an adversarial manifest containing the
exact violation class. Pure structural: no network, no PAT, runs in
the ordinary pytest gate that pre-push and CI already execute.

Current invariants (each with positive + adversarial coverage):

1. Dep-order across compound expressions: every identifier referenced
   by any operand of any ``visibleRule`` (splitting on ``&&`` / ``||``
   first) must resolve to a declared input at a lower index.

2. pickList RHS must be an exact option key: when an operand's LHS is
   a pickList input, the RHS must equal one of the declared option
   keys — no label fallback, no case-insensitive match.

3. Boolean RHS must be the literal ``true`` / ``false`` token. ADO's
   evaluator does not coerce ``True`` / ``"true"`` / ``1``; the rule
   compiles at package time and then silently never matches.

4. ``vss-extension.json`` source paths must exist on disk. Missing
   assets upload successfully but 404 on the marketplace manage page
   preview.

Related references:

* ``reference_ado_input_dep_order.md`` — 2026-04-17 incident origin.
* ``reference_tfx_isvalid_usage.md`` — invoking the ground-truth
  validator when a new rule appears.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
_EXTENSION_DIR = REPO_ROOT / "extension"
_TASK_MANIFEST = _EXTENSION_DIR / "tasks" / "extract-prs" / "task.json"
_VSS_MANIFEST = _EXTENSION_DIR / "vss-extension.json"

# ADO visibleRule grammar:
#
#     expr   = term ( boolOp term )*
#     boolOp = '&&' | '||'
#     term   = identifier cmpOp value
#     cmpOp  = '=' | '!=' | '>' | '>=' | '<' | '<='
#            | 'EndsWith'    | 'NotEndsWith'
#            | 'Contains'    | 'NotContains'
#            | 'StartsWith'  | 'NotStartsWith'
#
# ``_BOOL_SPLIT_RE`` peels top-level boolean operators; ``_TERM_RE``
# parses one operand. Optional parens around a term keep the parser
# tolerant of future wrapped-subexpression edits.
_BOOL_SPLIT_RE = re.compile(r"\s*(?:\|\||&&)\s*")
_TERM_RE = re.compile(
    r"^\s*\(?\s*"
    r"(?P<lhs>[A-Za-z_][A-Za-z0-9_]*)\s*"
    r"(?P<op>=|!=|>=|<=|>|<|"
    r"EndsWith|NotEndsWith|Contains|NotContains|StartsWith|NotStartsWith)"
    r"\s*(?P<rhs>.+?)\s*\)?\s*$"
)


def _split_visible_rule_terms(rule: str) -> list[str]:
    """Split a visibleRule into operand substrings by top-level ``&&``/``||``."""
    return [part.strip() for part in _BOOL_SPLIT_RE.split(rule) if part.strip()]


def _parse_term(term: str) -> tuple[str, str, str] | None:
    """Parse one operand into ``(lhs_name, op, rhs_value)``.

    Returns ``None`` on malformed input so callers can emit a contextual
    failure including which input's rule produced the malformed operand.

    RHS is returned verbatim (whitespace-trimmed only — quotes are NOT
    stripped). ADO's marketplace evaluator does not coerce quoted RHS
    against typed inputs: ``flag = "true"`` against a boolean never
    matches, and ``mode = "backfill-comments"`` against a pickList
    never matches either. Leaving quote-stripping out of the parser
    means the boolean / pickList checkers naturally reject quoted
    variants instead of silently accepting them — which is what the
    invariant docstrings promise.
    """
    match = _TERM_RE.match(term)
    if match is None:
        return None
    return match.group("lhs"), match.group("op"), match.group("rhs").strip()


def _load_task_manifest() -> dict[str, object]:
    data = json.loads(_TASK_MANIFEST.read_text(encoding="utf-8"))
    assert isinstance(data, dict), (
        f"task.json root must be an object; got {type(data).__name__}."
    )
    return data


def _load_vss_manifest() -> dict[str, object]:
    data = json.loads(_VSS_MANIFEST.read_text(encoding="utf-8"))
    assert isinstance(data, dict), (
        f"vss-extension.json root must be an object; got {type(data).__name__}."
    )
    return data


def _task_inputs() -> list[dict[str, object]]:
    """Load and sanity-check ``task.json``'s ``inputs`` list.

    Boundary assertions live here so every violation-finder below can
    assume well-formed ``name`` fields without re-checking.
    """
    manifest = _load_task_manifest()
    inputs = manifest.get("inputs", [])
    assert isinstance(inputs, list), (
        f"task.json `inputs` must be a list; got {type(inputs).__name__}."
    )
    for idx, entry in enumerate(inputs):
        assert isinstance(entry, dict), (
            f"task.json `inputs[{idx}]` must be a mapping; got {type(entry).__name__}."
        )
        name = entry.get("name")
        assert isinstance(name, str), (
            f"task.json `inputs[{idx}].name` must be a string; "
            f"got {type(name).__name__}."
        )
        assert name, f"task.json `inputs[{idx}].name` must be non-empty."
    return inputs


# --------------------------------------------------------------------- #
# Pure violation-finders (enables both real-manifest and adversarial    #
# negative tests without duplicating the traversal logic).              #
# --------------------------------------------------------------------- #


def _find_dep_order_violations(inputs: list[dict[str, object]]) -> list[str]:
    """Return violations of the compound-expression-aware dep-order rule.

    Every operand of every ``visibleRule`` is parsed individually after
    splitting on ``&&`` / ``||``. Each operand's LHS identifier must
    resolve to a declared input at a lower array index. Empty list
    means the manifest is clean.
    """
    violations: list[str] = []
    name_to_index: dict[str, int] = {}
    for idx, entry in enumerate(inputs):
        name = entry.get("name")
        if isinstance(name, str):
            name_to_index[name] = idx

    for idx, entry in enumerate(inputs):
        rule = entry.get("visibleRule")
        if rule is None:
            continue
        owner = entry.get("name")
        if not isinstance(owner, str):
            violations.append(f"inputs[{idx}] missing name; cannot validate rule")
            continue
        if not isinstance(rule, str):
            violations.append(
                f"input {owner!r} visibleRule must be a string; "
                f"got {type(rule).__name__}"
            )
            continue
        terms = _split_visible_rule_terms(rule)
        if not terms:
            violations.append(f"input {owner!r} has an empty visibleRule {rule!r}")
            continue
        for term in terms:
            parsed = _parse_term(term)
            if parsed is None:
                violations.append(
                    f"input {owner!r} visibleRule operand {term!r} is "
                    f"malformed (rule={rule!r})"
                )
                continue
            ref_name, _op, _rhs = parsed
            ref_idx = name_to_index.get(ref_name)
            if ref_idx is None:
                violations.append(
                    f"input {owner!r} visibleRule references unknown "
                    f"input {ref_name!r} (rule={rule!r})"
                )
                continue
            if ref_idx >= idx:
                violations.append(
                    f"input {owner!r} (index {idx}) visibleRule "
                    f"references {ref_name!r} (index {ref_idx}); Azure "
                    f"DevOps marketplace PackageValidationStep requires "
                    f"inputs in dependency order — {ref_name!r} must be "
                    f"declared BEFORE {owner!r}. Rule: {rule!r}"
                )
    return violations


def _find_picklist_rhs_violations(inputs: list[dict[str, object]]) -> list[str]:
    """Return visibleRule operands that compare a pickList LHS to a
    non-declared option key.

    Strict match: RHS must be exactly one of the option KEYS (not
    labels). No case-insensitive match. No partial match.
    """
    violations: list[str] = []
    picklist_keys: dict[str, set[str]] = {}
    for entry in inputs:
        if entry.get("type") != "pickList":
            continue
        name = entry.get("name")
        if not isinstance(name, str):
            continue
        options = entry.get("options")
        if not isinstance(options, dict):
            violations.append(
                f"pickList input {name!r} must declare `options` as a "
                f"mapping; got {type(options).__name__}"
            )
            continue
        keys: set[str] = set()
        for key in options:
            if isinstance(key, str) and key:
                keys.add(key)
        if not keys:
            violations.append(f"pickList input {name!r} declares no option keys")
            continue
        picklist_keys[name] = keys

    for entry in inputs:
        rule = entry.get("visibleRule")
        if not isinstance(rule, str):
            continue
        owner = entry.get("name")
        if not isinstance(owner, str):
            continue
        for term in _split_visible_rule_terms(rule):
            parsed = _parse_term(term)
            if parsed is None:
                continue
            ref_name, op, rhs = parsed
            allowed = picklist_keys.get(ref_name)
            if allowed is None:
                continue
            if op not in {"=", "!="}:
                violations.append(
                    f"input {owner!r} visibleRule uses operator {op!r} "
                    f"against pickList {ref_name!r}; only `=` and `!=` "
                    f"are meaningful against option keys (rule={rule!r})"
                )
                continue
            if rhs not in allowed:
                violations.append(
                    f"input {owner!r} visibleRule operand {term!r} "
                    f"compares pickList {ref_name!r} to {rhs!r}, which "
                    f"is NOT a declared option key "
                    f"(declared: {sorted(allowed)!r}). Option LABELS "
                    f"are NOT matched — use an exact key. Rule: {rule!r}"
                )
    return violations


def _find_boolean_rhs_violations(inputs: list[dict[str, object]]) -> list[str]:
    """Return visibleRule operands that compare a boolean LHS to anything
    other than the literal ``true`` / ``false`` token.
    """
    violations: list[str] = []
    boolean_names: set[str] = set()
    for entry in inputs:
        if entry.get("type") != "boolean":
            continue
        name = entry.get("name")
        if isinstance(name, str):
            boolean_names.add(name)

    for entry in inputs:
        rule = entry.get("visibleRule")
        if not isinstance(rule, str):
            continue
        owner = entry.get("name")
        if not isinstance(owner, str):
            continue
        for term in _split_visible_rule_terms(rule):
            parsed = _parse_term(term)
            if parsed is None:
                continue
            ref_name, op, rhs = parsed
            if ref_name not in boolean_names:
                continue
            if op not in {"=", "!="}:
                violations.append(
                    f"input {owner!r} visibleRule uses operator {op!r} "
                    f"against boolean {ref_name!r}; only `=` and `!=` "
                    f"are meaningful (rule={rule!r})"
                )
                continue
            if rhs not in {"true", "false"}:
                violations.append(
                    f"input {owner!r} visibleRule operand {term!r} "
                    f"compares boolean {ref_name!r} to {rhs!r}; ADO "
                    f"requires the literal `true` or `false` (unquoted, "
                    f"lowercase). Rule: {rule!r}"
                )
    return violations


def _iter_vss_source_paths(manifest: dict[str, object]) -> list[tuple[str, str]]:
    """Collect ``(context_label, rel_path)`` for every non-build-output
    path in ``vss-extension.json``.

    Skipped categories:

    * ``files[]`` entries with ``addressable: true`` — bundler output.
    * Any path starting with ``dist/`` — clean-checkout safety.

    Both omissions are intentional: the test must pass in a clean
    checkout where ``pnpm run build`` has not run.
    """
    out: list[tuple[str, str]] = []

    icons = manifest.get("icons")
    if isinstance(icons, dict):
        for role, path in icons.items():
            if isinstance(role, str) and isinstance(path, str):
                out.append((f"icons.{role}", path))

    content = manifest.get("content")
    if isinstance(content, dict):
        for role, body in content.items():
            if not isinstance(body, dict):
                continue
            path = body.get("path")
            if isinstance(role, str) and isinstance(path, str):
                out.append((f"content.{role}.path", path))

    files = manifest.get("files")
    if isinstance(files, list):
        for idx, entry in enumerate(files):
            if not isinstance(entry, dict):
                continue
            if entry.get("addressable") is True:
                continue
            path = entry.get("path")
            if isinstance(path, str) and not path.startswith("dist/"):
                out.append((f"files[{idx}].path", path))

    screenshots = manifest.get("screenshots")
    if isinstance(screenshots, list):
        for idx, entry in enumerate(screenshots):
            if not isinstance(entry, dict):
                continue
            path = entry.get("path")
            if isinstance(path, str):
                out.append((f"screenshots[{idx}].path", path))

    return out


def _find_missing_vss_paths(
    manifest: dict[str, object], extension_dir: Path
) -> list[str]:
    """Return human-readable descriptors for every non-build-output
    manifest path that does not resolve to a real file or directory.
    """
    missing: list[str] = []
    for context, rel_path in _iter_vss_source_paths(manifest):
        resolved = extension_dir / rel_path
        if not resolved.exists():
            missing.append(f"{context} -> {rel_path} (looked at {resolved})")
    return missing


# --------------------------------------------------------------------- #
# Real-manifest tests (must stay green).                                #
# --------------------------------------------------------------------- #


def test_task_json_visible_rule_dependency_order_across_compound_expressions() -> None:
    """Real ``task.json`` has no forward references, including compound
    expressions.

    Server error shape (2026-04-17 rejection)::

        Task definition input 'mode' should come before Task definition
        input 'commentsMaxThreadsPerPr' as per dependent inputs order
        for Task with ID '<uuid>'

    Negative coverage — ``test_dep_order_checker_rejects_*`` below —
    proves the checker catches forward references in simple rules AND
    inside ``||`` / ``&&`` compound expressions.
    """
    violations = _find_dep_order_violations(_task_inputs())
    assert violations == [], (
        "task.json has dependency-order violations that the Azure DevOps "
        "marketplace will reject at upload:\n"
        + "\n".join(f"  * {v}" for v in violations)
    )


def test_task_json_picklist_visible_rule_rhs_is_option_key() -> None:
    """Real ``task.json`` uses exact pickList option keys in every
    visibleRule RHS.

    Negative coverage — ``test_picklist_checker_rejects_*`` below —
    proves typo RHS values and label-for-key substitutions are caught.
    """
    violations = _find_picklist_rhs_violations(_task_inputs())
    assert violations == [], (
        "task.json has visibleRule operands whose RHS is not a declared "
        "pickList option key:\n" + "\n".join(f"  * {v}" for v in violations)
    )


def test_task_json_boolean_visible_rule_rhs_is_literal() -> None:
    """Real ``task.json`` compares booleans only to the literal ``true``
    / ``false`` tokens.

    Negative coverage — ``test_boolean_checker_rejects_*`` below —
    proves capitalised / quoted / numeric variants are caught.
    """
    violations = _find_boolean_rhs_violations(_task_inputs())
    assert violations == [], (
        "task.json has visibleRule operands whose boolean RHS is not "
        "the literal `true` / `false`:\n" + "\n".join(f"  * {v}" for v in violations)
    )


def test_vss_extension_manifest_source_paths_exist() -> None:
    """Real ``vss-extension.json`` source paths resolve to files or
    directories in ``extension/``.

    Build outputs are intentionally skipped (see
    ``_iter_vss_source_paths``) so the test remains green in a clean
    checkout. Negative coverage —
    ``test_vss_path_checker_rejects_missing_screenshot`` below — proves
    the checker flags a fabricated missing path.
    """
    missing = _find_missing_vss_paths(_load_vss_manifest(), _EXTENSION_DIR)
    assert missing == [], (
        "vss-extension.json references paths that do not exist on disk. "
        "These paths upload successfully but 404 on the marketplace "
        "manage page preview. Add the missing asset, OR remove the "
        "reference from the manifest if it was intentionally dropped. "
        "Missing:\n" + "\n".join(f"  * {entry}" for entry in missing)
    )


# --------------------------------------------------------------------- #
# Adversarial tests — prove each checker catches the violation class    #
# it claims to. Required by "Never claim enforcement without proof".    #
# --------------------------------------------------------------------- #


def test_dep_order_checker_rejects_simple_forward_reference() -> None:
    """Baseline: a visibleRule referencing a later-declared input is flagged."""
    inputs: list[dict[str, object]] = [
        {"name": "alpha", "type": "string", "visibleRule": "beta = true"},
        {"name": "beta", "type": "boolean"},
    ]
    violations = _find_dep_order_violations(inputs)
    assert len(violations) == 1, violations
    assert "'alpha'" in violations[0], violations[0]
    assert "'beta'" in violations[0], violations[0]
    assert "dependency order" in violations[0], violations[0]


def test_dep_order_checker_rejects_forward_reference_inside_or_compound() -> None:
    """Compound-expression coverage for ``||``. A regex-only sweep over
    the raw rule would still catch this particular case, but the
    split-and-parse path must also.
    """
    inputs: list[dict[str, object]] = [
        {
            "name": "alpha",
            "type": "string",
            "visibleRule": "gamma = true || beta = false",
        },
        {"name": "beta", "type": "boolean"},
        {"name": "gamma", "type": "boolean"},
    ]
    violations = _find_dep_order_violations(inputs)
    flagged = {(v.split("references ")[1].split(" ")[0]) for v in violations}
    assert flagged == {"'gamma'", "'beta'"}, (violations, flagged)


def test_dep_order_checker_rejects_forward_reference_inside_and_compound() -> None:
    """Compound-expression coverage for ``&&``. Proves the splitter
    handles both boolean operators, not just ``||``.
    """
    inputs: list[dict[str, object]] = [
        {
            "name": "alpha",
            "type": "string",
            "visibleRule": "beta = true && gamma = false",
        },
        {"name": "beta", "type": "boolean"},
        {"name": "gamma", "type": "boolean"},
    ]
    violations = _find_dep_order_violations(inputs)
    flagged = {(v.split("references ")[1].split(" ")[0]) for v in violations}
    assert flagged == {"'beta'", "'gamma'"}, (violations, flagged)


def test_dep_order_checker_accepts_correctly_ordered_compound_expression() -> None:
    """Positive compound case: both operands reference earlier inputs →
    no violations. Guards against over-reporting by the split parser.
    """
    inputs: list[dict[str, object]] = [
        {"name": "beta", "type": "boolean"},
        {"name": "gamma", "type": "boolean"},
        {
            "name": "alpha",
            "type": "string",
            "visibleRule": "beta = true || gamma = false",
        },
    ]
    assert _find_dep_order_violations(inputs) == []


def test_dep_order_checker_rejects_reference_to_undeclared_input() -> None:
    """An operand that names an identifier not present in ``inputs`` at
    all is a separate failure class from forward-reference — still a
    marketplace rejection, still must be flagged.
    """
    inputs: list[dict[str, object]] = [
        {"name": "alpha", "type": "string", "visibleRule": "ghost = true"},
    ]
    violations = _find_dep_order_violations(inputs)
    assert len(violations) == 1, violations
    assert "unknown" in violations[0], violations[0]
    assert "'ghost'" in violations[0], violations[0]


def test_picklist_checker_rejects_rhs_typo() -> None:
    """The silent-miss hazard: pickList RHS is close to a valid key but
    not exact → marketplace accepts the upload, rule never matches.
    """
    inputs: list[dict[str, object]] = [
        {
            "name": "mode",
            "type": "pickList",
            "options": {"extract": "Extract", "backfill-comments": "Backfill"},
        },
        {
            "name": "gated",
            "type": "string",
            "visibleRule": "mode = backfil-comments",
        },
    ]
    violations = _find_picklist_rhs_violations(inputs)
    assert len(violations) == 1, violations
    assert "'backfil-comments'" in violations[0]
    assert "NOT a declared option key" in violations[0]


def test_picklist_checker_rejects_label_instead_of_key() -> None:
    """Second silent-miss hazard: author writes the human-facing label
    instead of the option KEY. ADO matches KEYS only.
    """
    inputs: list[dict[str, object]] = [
        {
            "name": "mode",
            "type": "pickList",
            "options": {"extract": "Extract PRs (default)"},
        },
        {
            "name": "gated",
            "type": "string",
            "visibleRule": "mode = Extract PRs (default)",
        },
    ]
    violations = _find_picklist_rhs_violations(inputs)
    assert violations, "checker must reject label-as-RHS"
    assert any("LABELS" in v for v in violations), violations


def test_picklist_checker_accepts_exact_option_key() -> None:
    """Sanity positive: RHS equals a declared key → no violation."""
    inputs: list[dict[str, object]] = [
        {
            "name": "mode",
            "type": "pickList",
            "options": {"extract": "Extract", "backfill-comments": "Backfill"},
        },
        {
            "name": "gated",
            "type": "string",
            "visibleRule": "mode = backfill-comments",
        },
    ]
    assert _find_picklist_rhs_violations(inputs) == []


def test_boolean_checker_rejects_capitalised_true() -> None:
    """Python-ish ``True`` silently never matches in ADO's evaluator."""
    inputs: list[dict[str, object]] = [
        {"name": "flag", "type": "boolean"},
        {"name": "gated", "type": "string", "visibleRule": "flag = True"},
    ]
    violations = _find_boolean_rhs_violations(inputs)
    assert len(violations) == 1, violations
    assert "'True'" in violations[0], violations[0]
    assert "literal `true`" in violations[0], violations[0]


def test_boolean_checker_rejects_numeric_rhs() -> None:
    """``1`` / ``0`` are tempting but silently never match."""
    inputs: list[dict[str, object]] = [
        {"name": "flag", "type": "boolean"},
        {"name": "gated", "type": "string", "visibleRule": "flag = 1"},
    ]
    violations = _find_boolean_rhs_violations(inputs)
    assert len(violations) == 1, violations
    assert "'1'" in violations[0], violations[0]


def test_boolean_checker_rejects_double_quoted_true() -> None:
    """Quoted RHS never coerces to boolean in ADO's evaluator. The
    parser must NOT quietly strip the quotes — otherwise the boolean
    invariant silently accepts the literal string ``"true"`` that the
    docstring explicitly calls out as a rejection case.
    """
    inputs: list[dict[str, object]] = [
        {"name": "flag", "type": "boolean"},
        {"name": "gated", "type": "string", "visibleRule": 'flag = "true"'},
    ]
    violations = _find_boolean_rhs_violations(inputs)
    assert len(violations) == 1, violations
    assert '"true"' in violations[0], violations[0]
    assert "literal `true`" in violations[0], violations[0]


def test_boolean_checker_rejects_single_quoted_true() -> None:
    """Single-quoted variant of the same silent-miss hazard. Covers the
    second quote character the parser must also leave intact.
    """
    inputs: list[dict[str, object]] = [
        {"name": "flag", "type": "boolean"},
        {"name": "gated", "type": "string", "visibleRule": "flag = 'true'"},
    ]
    violations = _find_boolean_rhs_violations(inputs)
    assert len(violations) == 1, violations
    assert "'true'" in violations[0], violations[0]
    assert "literal `true`" in violations[0], violations[0]


def test_picklist_checker_rejects_quoted_option_key() -> None:
    """pickList matching is exact-key-only; wrapping a valid key in
    quotes (``mode = "backfill-comments"``) is NOT the same comparison
    and silently never matches the ADO evaluator. The parser must
    leave quotes intact so this case reaches the key-set check and is
    rejected as unknown.
    """
    inputs: list[dict[str, object]] = [
        {
            "name": "mode",
            "type": "pickList",
            "options": {"extract": "Extract", "backfill-comments": "Backfill"},
        },
        {
            "name": "gated",
            "type": "string",
            "visibleRule": 'mode = "backfill-comments"',
        },
    ]
    violations = _find_picklist_rhs_violations(inputs)
    assert violations, "checker must reject quoted pickList RHS"
    assert any('"backfill-comments"' in v for v in violations), violations


def test_boolean_checker_accepts_true_and_false_literals() -> None:
    """Sanity positive: ``true`` / ``false`` both accepted, no violation."""
    inputs: list[dict[str, object]] = [
        {"name": "flag_a", "type": "boolean"},
        {"name": "flag_b", "type": "boolean"},
        {"name": "gated_a", "type": "string", "visibleRule": "flag_a = true"},
        {"name": "gated_b", "type": "string", "visibleRule": "flag_b = false"},
    ]
    assert _find_boolean_rhs_violations(inputs) == []


def test_vss_path_checker_rejects_missing_screenshot(tmp_path: Path) -> None:
    """Fabricate a manifest with a missing screenshot path under a
    temporary extension dir; the checker must flag it with the
    screenshot index in the context label.
    """
    manifest: dict[str, object] = {
        "screenshots": [{"path": "screenshots/does-not-exist.png"}],
    }
    missing = _find_missing_vss_paths(manifest, tmp_path)
    assert len(missing) == 1, missing
    assert "screenshots[0].path" in missing[0]
    assert "does-not-exist.png" in missing[0]


def test_vss_path_checker_skips_addressable_build_outputs(tmp_path: Path) -> None:
    """``addressable: true`` file entries are bundler output; the
    checker MUST NOT flag them even when they don't exist, so the
    test stays green in clean checkouts.
    """
    manifest: dict[str, object] = {
        "files": [
            {"path": "dist/ui", "addressable": True},
            {"path": "dist/anything-else"},
        ],
    }
    assert _find_missing_vss_paths(manifest, tmp_path) == []
