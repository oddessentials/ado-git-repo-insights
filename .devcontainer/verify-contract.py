#!/usr/bin/env python3
"""Verify .devcontainer/devcontainer.json satisfies Contract 1.

Usage:
    python3 .devcontainer/verify-contract.py

Exit 0 = Contract 1 passes static structural check; non-zero = the JSON is
structurally non-conforming and the failed assertion's message identifies which
MUST is violated.

This script is the canonical source for Contract 1's static verification.
The implementation PR copies this file to `.devcontainer/verify-contract.py`
and wires it into the verification gate (FR-013, SC-005). Any drift between
this file and the inline code block in `contracts/devcontainer.contract.md`
is a documentation defect — the .py file wins on conflict.

`.devcontainer/devcontainer.json` is JSONC per the Dev Containers spec
(// line comments, /* */ block comments, trailing commas allowed). Python's
strict json.load rejects it, so we strip JSONC inline before parsing. See the
`feedback_devcontainer_json_is_jsonc.md` memory for the rationale and the
canonical stripper routine.
"""

import json
import re
import sys
from pathlib import Path


def strip_jsonc(text: str) -> str:
    """Strip // line comments and /* */ block comments while preserving string
    contents (so 'https://...' is not truncated at //). Also drops trailing
    commas. Sufficient for devcontainer.json."""
    out, i, n = [], 0, len(text)
    in_str, str_ch = False, ""
    while i < n:
        c = text[i]
        if in_str:
            out.append(c)
            if c == "\\" and i + 1 < n:
                out.append(text[i + 1])
                i += 2
                continue
            if c == str_ch:
                in_str = False
            i += 1
        elif c == '"':
            in_str, str_ch = True, c
            out.append(c)
            i += 1
        elif c == "/" and i + 1 < n and text[i + 1] == "/":
            while i < n and text[i] != "\n":
                i += 1
        elif c == "/" and i + 1 < n and text[i + 1] == "*":
            i += 2
            while i + 1 < n and not (text[i] == "*" and text[i + 1] == "/"):
                i += 1
            i += 2
        else:
            out.append(c)
            i += 1
    return re.sub(r",(\s*[}\]])", r"\1", "".join(out))


# Resolve the production devcontainer.json deterministically so the verifier
# can be run from either (a) its installed location at .devcontainer/ (where
# devcontainer.json is in the same directory as the script), or (b) the
# spec-side artifact path at specs/.../contracts/ (where it isn't). Try the
# same-directory case first (cheap, no subprocess), then fall back to
# git rev-parse to find the repo root and resolve .devcontainer/devcontainer.json
# from there.
SCRIPT = Path(__file__).resolve()
same_dir = SCRIPT.parent / "devcontainer.json"
if same_dir.is_file():
    DEVCONTAINER = same_dir
else:
    import subprocess

    # `timeout=10` guards against a hung git invocation (e.g., a credential
    # helper that wedges on a stale IPC socket) leaving the verifier blocked
    # forever. `shell=False` is already the default for list-form args.
    try:
        repo_root = Path(
            subprocess.check_output(
                ["git", "rev-parse", "--show-toplevel"],
                cwd=SCRIPT.parent,
                stderr=subprocess.DEVNULL,
                text=True,
                timeout=10,
            ).strip()
        )
    except (
        subprocess.CalledProcessError,
        FileNotFoundError,
        subprocess.TimeoutExpired,
    ):
        sys.exit(
            f"FATAL: {same_dir} not found and git rev-parse failed; "
            "run from a git checkout or install the script next to devcontainer.json"
        )
    DEVCONTAINER = repo_root / ".devcontainer" / "devcontainer.json"
    if not DEVCONTAINER.is_file():
        sys.exit(f"FATAL: {DEVCONTAINER} not found")

d = json.loads(strip_jsonc(DEVCONTAINER.read_text()))

# features: node Feature pinned (not :1 or :latest)
assert "features" in d, "features block is required"
node_keys = [k for k in d["features"] if "devcontainers/features/node" in k]
assert len(node_keys) == 1, "exactly one node Feature entry required"
node_key = node_keys[0]
assert ":1" not in node_key, (
    f"node Feature must NOT use major-track tag `:1`; saw {node_key!r}"
)
assert ":latest" not in node_key, (
    f"node Feature must NOT use `:latest` tag; saw {node_key!r}"
)
assert "sha256:" in node_key or "@" in node_key, (
    f"node Feature must use digest (sha256:) or release-tag (@) pin; saw {node_key!r}"
)

# features: no community Features; no gh Feature (gh is Dockerfile-installed per FR-001)
forbidden_features = ["github-cli"]
for k in d["features"]:
    for forbidden in forbidden_features:
        assert forbidden not in k, (
            f"{forbidden} Feature is forbidden; gh is Dockerfile-installed"
        )

# Node Feature options: `pnpmVersion: "none"` is required (FR-003 + FR-021).
# The Feature defaults pnpmVersion to "latest" and runs
# `npm install -g pnpm@$PNPM_VERSION` unless the option is explicitly set to
# "none". Without this, every rebuild silently installs an unpinned global
# pnpm before postCreateCommand's Corepack activation of pnpm@9.15.0, causing
# drift across rebuilds and PATH precedence ambiguity. Codex review (PR #416)
# caught this gap.
node_options = d["features"][node_key]
assert isinstance(node_options, dict), (
    f"node Feature options must be a dict; saw {type(node_options).__name__}"
)
assert node_options.get("pnpmVersion") == "none", (
    'node Feature MUST set `"pnpmVersion": "none"` to disable Feature-side '
    "pnpm install; pnpm comes from Corepack in postCreateCommand per FR-003 "
    "+ FR-021. Without this, the Feature installs pnpm@latest globally on "
    "every rebuild and drift compounds."
)

# mounts: two named volumes (gh + entire) per FR-005
assert "mounts" in d, "mounts block is required for gh + entire auth named volumes"
assert any(
    "ado-git-repo-insights-gh-config" in m
    and "/home/vscode/.config/gh" in m
    and "type=volume" in m
    for m in d["mounts"]
), (
    "mounts must declare source=ado-git-repo-insights-gh-config "
    "target=/home/vscode/.config/gh type=volume"
)
assert any(
    "ado-git-repo-insights-entire-config" in m
    and "/home/vscode/.entire" in m
    and "type=volume" in m
    for m in d["mounts"]
), (
    "mounts must declare source=ado-git-repo-insights-entire-config "
    "target=/home/vscode/.entire type=volume (FR-005, FR-020)"
)

# onCreateCommand: sudo chown required (catches the v6 defect Codex flagged in pass 7)
oncreate = d.get("onCreateCommand", "")
if isinstance(oncreate, list):
    oncreate = " ".join(oncreate)
assert oncreate, (
    "onCreateCommand is required for named-volume chown (FR-005, Contract 1, Contract 3)"
)
assert "sudo" in oncreate, (
    "onCreateCommand must use 'sudo' — lifecycle hooks run as vscode, not root "
    "(see Contract 3 failure modes)"
)
assert "chown" in oncreate, (
    "onCreateCommand must run chown to fix root-owned mount point"
)
assert "/home/vscode/.config/gh" in oncreate, (
    "onCreateCommand chown must target the gh config mount path"
)
assert "/home/vscode/.entire" in oncreate, (
    "onCreateCommand chown must target the entire config mount path (FR-020)"
)
assert "vscode:vscode" in oncreate or "vscode " in oncreate, (
    "onCreateCommand chown must set ownership to vscode user"
)

# postCreateCommand: per FR-021, must begin with Corepack activation + pinned
# pnpm + fail-closed validation. Agent-specific entire wiring is contributor-
# driven (see README Scenario E) and MUST NOT appear in the tracked chain.
postcreate = d.get("postCreateCommand", "")
if isinstance(postcreate, list):
    postcreate = " && ".join(postcreate)
assert postcreate, "postCreateCommand is required"

# FR-021: Corepack activation as FIRST step (Node arrives via Feature; pnpm must
# be activated at first-up time, not image-build time)
assert "corepack enable" in postcreate, (
    "postCreateCommand must begin with `corepack enable` (FR-021); "
    "Node arrives via Dev Container Feature, so Corepack/pnpm activation moves "
    "from Dockerfile to postCreateCommand"
)
assert "corepack prepare pnpm@" in postcreate, (
    "postCreateCommand must include `corepack prepare pnpm@<version> --activate` "
    "to pin pnpm to package.json::packageManager value (FR-021)"
)
# FR-021: fail-closed pnpm version validation. Allow either explicit pnpm-version
# bracket-test OR equivalent shell construct that exits non-zero on mismatch.
assert "pnpm --version" in postcreate, (
    "postCreateCommand must validate pnpm version after Corepack activation "
    "(FR-021 fail-closed)"
)

# FR-020 (revised 2026-06-06): the `entire` BINARY install stays in the
# Dockerfile per FR-020. Agent-specific wiring (`entire enable --agent <X>`,
# `entire agent add <X>`) is contributor-driven, NOT part of the tracked
# postCreateCommand chain.
#
# History: PR #416 prescribed `entire enable --yes --agent claude-code,codex`
# in postCreateCommand. That command form was invalid — entire CLI v0.7.3
# defines `--agent` as StringVar (single value; see entireio/cli@v0.7.3/
# cmd/entire/cli/setup.go:888), so the comma-list is treated as one agent
# name in the registry lookup (agent/registry.go:34) and fails at runtime
# with `unknown agent: claude-code,codex`. The first hotfix attempt swapped
# to `entire enable --agent claude-code && entire agent add codex`, which
# pre-wires entire for two specific agents that AREN'T installed in this
# image (Claude Code and Codex are developer-personal per FR-008). It also
# ships an unverified `entire agent add` subcommand into a chain CI doesn't
# exercise (publish-devcontainer runs `docker build` only; postCreateCommand
# never executes in CI, so runtime defects stay invisible until the first
# contributor rebuild).
#
# Resolution: agent wiring moves OUT of postCreateCommand entirely. The
# `entire` binary still ships in the image, and the repo's `.husky/_/`
# scripts already invoke `entire hooks git <stage>` defensively, so basic
# git-hook capture activates as soon as the contributor runs `entire login`.
# Optional agent-specific wiring is documented as a contributor-driven step
# in README Scenario E.

# (1) Reject any tracked `entire enable` or `entire agent <subcmd>` invocation
#     in postCreateCommand. Agent wiring belongs to contributor-driven setup,
#     not the deterministic fail-closed chain.
assert "entire enable" not in postcreate, (
    "`entire enable` MUST NOT appear in postCreateCommand. Agent wiring is "
    "contributor-driven (see README Scenario E). Re-introducing it here "
    "couples tracked infra to a personal-agent choice and re-opens the "
    "PR #416 / #417 failure class — CI doesn't exercise postCreateCommand, "
    "so any agent-specific defect ships silently until first contributor "
    "rebuild."
)
assert "entire agent" not in postcreate, (
    "`entire agent <subcommand>` MUST NOT appear in postCreateCommand. "
    "See README Scenario E for the contributor-driven flow."
)

# (2) Belt-and-braces tripwire: if a future edit reintroduces an `entire`
#     subcommand via a different surface (e.g., list-form postCreateCommand,
#     a flag form not caught by the substring checks above), still reject
#     the comma-list `--agent` pattern from PR #416 with a specific error.
for m in re.finditer(r"--agent\s+(\S+)", postcreate):
    val = m.group(1)
    assert "," not in val, (
        f"entire CLI `--agent` is single-value (StringVar); saw {val!r}. "
        "Agent wiring is contributor-driven per README Scenario E; multi-"
        "agent setup is not expressed in tracked postCreateCommand at all."
    )

# Ordering invariant:
#   corepack BEFORE pnpm install (Corepack must activate pnpm before any pnpm command)
corepack_idx = postcreate.find("corepack enable")
pnpm_install_idx = postcreate.find("pnpm install")
assert corepack_idx != -1, "postCreateCommand must contain `corepack enable`"
assert pnpm_install_idx != -1, "postCreateCommand must contain `pnpm install`"
assert corepack_idx < pnpm_install_idx, (
    "postCreateCommand must run `corepack enable` BEFORE `pnpm install` "
    "(pnpm requires Corepack activation first per FR-021)"
)

# containerEnv: no tracked PAT injection (XIX-adjacent; reserved as enterprise override per FR-007)
env = d.get("containerEnv") or {}
for forbidden_key in ("GITHUB_TOKEN", "GH_TOKEN", "GITHUB_PAT"):
    assert forbidden_key not in env, (
        f"{forbidden_key} forbidden in tracked containerEnv (FR-005, FR-007)"
    )

print("OK: Contract 1 static verification passed")
