#!/usr/bin/env bash
# Contract 4c — devcontainer config integration check.
#
# Brings up the dev container per the tracked .devcontainer/devcontainer.json
# in an ISOLATED test environment (test-scoped named volume, temp workspace
# with rewritten config), then verifies as the vscode user that the gh-auth
# mount point is owned by vscode:vscode and writable. This proves that the
# onCreateCommand `sudo chown` actually runs and produces the contract-required
# effect, end-to-end. See contracts/devcontainer.contract.md §"Contract 4c"
# for the prose specification.
#
# This script is the canonical source for Contract 4c's integration check.
# The implementation PR copies this file to `.devcontainer/verify-contract-4c.sh`
# (or wires it into the CI verification job at an equivalent location). Any
# drift between this file and the inline code block in
# contracts/devcontainer.contract.md is a documentation defect — the .sh file
# wins on conflict.

set -euo pipefail

# Prerequisites (fail-fast with actionable install hints)
command -v git          >/dev/null 2>&1 || { echo "FATAL: git not on PATH"                                       >&2; exit 1; }
command -v docker       >/dev/null 2>&1 || { echo "FATAL: docker not on PATH"                                    >&2; exit 1; }
command -v python3      >/dev/null 2>&1 || { echo "FATAL: python3 not on PATH"                                   >&2; exit 1; }
command -v devcontainer >/dev/null 2>&1 || { echo "FATAL: devcontainer CLI not on PATH (npm i -g @devcontainers/cli)" >&2; exit 1; }

# Resolve repo root from anywhere the script is invoked
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "FATAL: not inside a git repo" >&2; exit 1; }
readonly REPO_ROOT
readonly PROD_DEVCONTAINER="$REPO_ROOT/.devcontainer/devcontainer.json"
[[ -f "$PROD_DEVCONTAINER" ]] || { echo "FATAL: $PROD_DEVCONTAINER not found" >&2; exit 1; }

# Production volume names from FR-005 / Contract 1. Both must be rewritten to
# test-scoped names before `devcontainer up` reads the staged config —
# otherwise the test mounts (and the production onCreateCommand chowns) the
# contributor's REAL auth volumes. Codex review (PR #416) flagged the prior
# single-volume-only rewrite as a real auth-data-mutation risk. Marked
# readonly so they cannot drift to match a TEST_VOL_* anywhere in this script.
readonly PROD_VOL_GH=ado-git-repo-insights-gh-config
readonly PROD_VOL_ENTIRE=ado-git-repo-insights-entire-config

# Single timestamp+PID suffix shared by both test volumes so they're created
# in the same logical test run and cleanup can reason about them as a pair.
readonly TEST_SUFFIX="-c4c-test-$(date +%s%N)-$$"
readonly TEST_VOL_GH="${PROD_VOL_GH}${TEST_SUFFIX}"
readonly TEST_VOL_ENTIRE="${PROD_VOL_ENTIRE}${TEST_SUFFIX}"

# Isolation guards — every test name must differ from every production name
# (including the OTHER tool's production name, defense in depth) and must
# carry the test marker so cleanup can refuse to operate on anything else.
[[ "$TEST_VOL_GH"     != "$PROD_VOL_GH"     ]] || { echo "FATAL: gh test/prod volume name collision"          >&2; exit 1; }
[[ "$TEST_VOL_GH"     != "$PROD_VOL_ENTIRE" ]] || { echo "FATAL: gh test name collides with entire prod"      >&2; exit 1; }
[[ "$TEST_VOL_ENTIRE" != "$PROD_VOL_ENTIRE" ]] || { echo "FATAL: entire test/prod volume name collision"      >&2; exit 1; }
[[ "$TEST_VOL_ENTIRE" != "$PROD_VOL_GH"     ]] || { echo "FATAL: entire test name collides with gh prod"      >&2; exit 1; }
[[ "$TEST_VOL_GH"     == *-c4c-test-*       ]] || { echo "FATAL: gh test volume name missing test marker"     >&2; exit 1; }
[[ "$TEST_VOL_ENTIRE" == *-c4c-test-*       ]] || { echo "FATAL: entire test volume name missing test marker" >&2; exit 1; }

# Pre-existence check — both test volumes must NOT exist on the host before
# we proceed, otherwise we risk colliding with someone else's test residue.
if docker volume inspect "$TEST_VOL_GH" >/dev/null 2>&1; then
  echo "FATAL: gh test volume $TEST_VOL_GH already exists; refusing to risk pre-existing data" >&2
  exit 1
fi
if docker volume inspect "$TEST_VOL_ENTIRE" >/dev/null 2>&1; then
  echo "FATAL: entire test volume $TEST_VOL_ENTIRE already exists; refusing to risk pre-existing data" >&2
  exit 1
fi

# Temp workspace path is fully owned by this script invocation; the prefix gives cleanup a guard token.
readonly TESTDIR=$(mktemp -d "${TMPDIR:-/tmp}/dc-c4c-XXXXXXXX")

cleanup() {
  local status=$?
  # Remove the test container by Dev Container CLI's label (no `devcontainer down` subcommand exists).
  docker ps -aq --filter "label=devcontainer.local_folder=$TESTDIR" \
    | xargs -r docker rm -f >/dev/null 2>&1 || true
  # Remove gh test-scoped volume — guarded against operating on EITHER
  # production name (gh or entire), defense in depth.
  if [[ "$TEST_VOL_GH" != "$PROD_VOL_GH" \
        && "$TEST_VOL_GH" != "$PROD_VOL_ENTIRE" \
        && "$TEST_VOL_GH" == *-c4c-test-* ]]; then
    docker volume rm "$TEST_VOL_GH" >/dev/null 2>&1 || true
  fi
  # Remove entire test-scoped volume — same guard pattern.
  if [[ "$TEST_VOL_ENTIRE" != "$PROD_VOL_GH" \
        && "$TEST_VOL_ENTIRE" != "$PROD_VOL_ENTIRE" \
        && "$TEST_VOL_ENTIRE" == *-c4c-test-* ]]; then
    docker volume rm "$TEST_VOL_ENTIRE" >/dev/null 2>&1 || true
  fi
  # Remove temp workspace — guarded against rm outside the expected mktemp prefix.
  if [[ "$TESTDIR" == */dc-c4c-* ]]; then
    rm -rf "$TESTDIR"
  fi
  exit $status
}
trap cleanup EXIT

# Stage a rewritten devcontainer.json in TESTDIR with two material changes:
#   1. mounts → both BOTH gh AND entire volumes rewritten to TEST_VOL_*
#      (isolation; the prior single-volume rewrite let the production entire
#      volume mount unchanged, allowing the test to mutate real auth data).
#   2. postCreateCommand → no-op (the production hook runs pnpm/uv against the
#      workspace; TESTDIR has no package.json/pyproject.toml/extension/, so the
#      production hook would fail before onCreateCommand's chown is verifiable)
#
# onCreateCommand is preserved as-is: the chown targets /home/vscode/.config/gh
# AND /home/vscode/.entire — both mount target paths, which are unchanged by
# the volume-name rewrite.
#
# devcontainer.json is JSONC (line/block comments + trailing commas allowed by
# the Dev Containers spec). Python's strict json.load rejects it, so we strip
# comments inline before parsing. See feedback memory:
# `feedback_devcontainer_json_is_jsonc.md`.
mkdir -p "$TESTDIR/.devcontainer"
python3 - \
    "$PROD_VOL_GH" "$TEST_VOL_GH" \
    "$PROD_VOL_ENTIRE" "$TEST_VOL_ENTIRE" \
    "$PROD_DEVCONTAINER" "$TESTDIR/.devcontainer/devcontainer.json" << 'PYEOF'
import json, re, sys

(
    prod_vol_gh,
    test_vol_gh,
    prod_vol_entire,
    test_vol_entire,
    src_path,
    dst_path,
) = sys.argv[1:7]

def strip_jsonc(text):
    """Strip // line comments and /* */ block comments while preserving string
    contents. Also drops trailing commas. Sufficient for devcontainer.json."""
    out, i, n = [], 0, len(text)
    in_str, str_ch = False, ""
    while i < n:
        c = text[i]
        if in_str:
            out.append(c)
            if c == "\\" and i + 1 < n:
                out.append(text[i+1]); i += 2; continue
            if c == str_ch:
                in_str = False
            i += 1
        elif c == '"':
            in_str, str_ch = True, c; out.append(c); i += 1
        elif c == "/" and i + 1 < n and text[i+1] == "/":
            while i < n and text[i] != "\n":
                i += 1
        elif c == "/" and i + 1 < n and text[i+1] == "*":
            i += 2
            while i + 1 < n and not (text[i] == "*" and text[i+1] == "/"):
                i += 1
            i += 2
        else:
            out.append(c); i += 1
    return re.sub(r",(\s*[}\]])", r"\1", "".join(out))

with open(src_path) as f:
    cfg = json.loads(strip_jsonc(f.read()))

# Rewrite BOTH production volume names (gh + entire) to test-scoped names.
# `elif` is safe here because the two production names are disjoint —
# neither is a substring of the other (we asserted in bash that they don't
# collide with each other's test names either, but inside a single mount
# string only one production name can appear).
# Fail loudly if EITHER production volume name isn't found in mounts —
# missing means either isolation is illusory OR the devcontainer.json drifted
# from the FR-005 + Contract 1 contract.
saw_prod_gh = False
saw_prod_entire = False
rewritten = []
for m in cfg.get("mounts", []):
    if isinstance(m, str) and prod_vol_gh in m:
        rewritten.append(m.replace(prod_vol_gh, test_vol_gh))
        saw_prod_gh = True
    elif isinstance(m, str) and prod_vol_entire in m:
        rewritten.append(m.replace(prod_vol_entire, test_vol_entire))
        saw_prod_entire = True
    else:
        rewritten.append(m)
if not saw_prod_gh:
    sys.stderr.write(
        f"FATAL: production volume {prod_vol_gh!r} not found in mounts; "
        "test isolation cannot be verified — refusing to proceed.\n"
    )
    sys.exit(1)
if not saw_prod_entire:
    sys.stderr.write(
        f"FATAL: production volume {prod_vol_entire!r} not found in mounts; "
        "test isolation cannot be verified — refusing to proceed.\n"
    )
    sys.exit(1)
cfg["mounts"] = rewritten

# Override postCreateCommand to a no-op. We are validating onCreateCommand
# semantics only; repo-dep installs (pnpm install, uv sync, etc.) need the real
# workspace tree and are irrelevant to FR-005 contract verification.
cfg["postCreateCommand"] = "true"

# Do not modify onCreateCommand: the chown targets /home/vscode/.config/gh
# AND /home/vscode/.entire (both mount targets), which are unchanged by the
# volume-name rewrite.
with open(dst_path, "w") as f:
    json.dump(cfg, f, indent=2)
PYEOF

# Bring up the test container; the devcontainer CLI runs onCreateCommand
# (sudo chown) as part of the lifecycle.
devcontainer up --workspace-folder "$TESTDIR" 2>&1 | tail -20

# Verify ownership + writability as vscode for BOTH mount targets in the
# freshly-created isolated container. The FR-005 contract is that onCreateCommand
# chowns both /home/vscode/.config/gh AND /home/vscode/.entire; testing only
# one would let a regression on the other surface only at first contributor
# `entire login` (which is a deferred-by-necessity verification per the spec).
devcontainer exec --workspace-folder "$TESTDIR" bash -c '
  set -euo pipefail
  check_mount() {
    local label="$1" path="$2"
    echo "--- ${label} mount point ownership (${path}) ---"
    ls -ld "$path"
    local owner_group
    owner_group=$(stat -c "%U:%G" "$path")
    if [[ "$owner_group" != "vscode:vscode" ]]; then
      echo "FAIL: ${label} mount owner is ${owner_group}, expected vscode:vscode (onCreateCommand sudo chown did not run or failed)" >&2
      exit 1
    fi
    echo "--- ${label} vscode write test ---"
    local testfile="${path}/contract-4c-write-probe"
    touch "$testfile"
    rm "$testfile"
  }
  check_mount gh     /home/vscode/.config/gh
  check_mount entire /home/vscode/.entire
  echo "OK: FR-005 contract verified on test-isolated volumes (gh: '"$TEST_VOL_GH"' + entire: '"$TEST_VOL_ENTIRE"')"
'
# trap cleanup EXIT removes ONLY the test-scoped volumes (both), the test
# container, and the temp workspace — never any production volume.
