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

# Production volume name from FR-005 / Contract 1. Marked readonly so it cannot
# drift to match TEST_VOL anywhere in this script.
readonly PROD_VOL=ado-git-repo-insights-gh-config

# Unique test-scoped volume name. Timestamp+PID makes collision practically impossible.
readonly TEST_VOL="${PROD_VOL}-c4c-test-$(date +%s%N)-$$"

# Isolation guards
[[ "$TEST_VOL" != "$PROD_VOL" ]] || { echo "FATAL: test/prod volume name collision" >&2; exit 1; }
[[ "$TEST_VOL" == *-c4c-test-* ]] || { echo "FATAL: test volume name missing test marker" >&2; exit 1; }
if docker volume inspect "$TEST_VOL" >/dev/null 2>&1; then
  echo "FATAL: test volume $TEST_VOL already exists; refusing to risk pre-existing data" >&2
  exit 1
fi

# Temp workspace path is fully owned by this script invocation; the prefix gives cleanup a guard token.
readonly TESTDIR=$(mktemp -d "${TMPDIR:-/tmp}/dc-c4c-XXXXXXXX")

cleanup() {
  local status=$?
  # Remove the test container by Dev Container CLI's label (no `devcontainer down` subcommand exists).
  docker ps -aq --filter "label=devcontainer.local_folder=$TESTDIR" \
    | xargs -r docker rm -f >/dev/null 2>&1 || true
  # Remove test-scoped volume — guarded against operating on the production name.
  if [[ "$TEST_VOL" != "$PROD_VOL" && "$TEST_VOL" == *-c4c-test-* ]]; then
    docker volume rm "$TEST_VOL" >/dev/null 2>&1 || true
  fi
  # Remove temp workspace — guarded against rm outside the expected mktemp prefix.
  if [[ "$TESTDIR" == */dc-c4c-* ]]; then
    rm -rf "$TESTDIR"
  fi
  exit $status
}
trap cleanup EXIT

# Stage a rewritten devcontainer.json in TESTDIR with two material changes:
#   1. mounts → TEST_VOL (isolation)
#   2. postCreateCommand → no-op (the production hook runs pnpm/uv against the
#      workspace; TESTDIR has no package.json/pyproject.toml/extension/, so the
#      production hook would fail before onCreateCommand's chown is verifiable)
#
# devcontainer.json is JSONC (line/block comments + trailing commas allowed by
# the Dev Containers spec). Python's strict json.load rejects it, so we strip
# comments inline before parsing. See feedback memory:
# `feedback_devcontainer_json_is_jsonc.md`.
mkdir -p "$TESTDIR/.devcontainer"
python3 - "$PROD_VOL" "$TEST_VOL" "$PROD_DEVCONTAINER" "$TESTDIR/.devcontainer/devcontainer.json" << 'PYEOF'
import json, re, sys

prod_vol, test_vol, src_path, dst_path = sys.argv[1:5]

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

# Rewrite mounts (string form per Contract 1) to use TEST_VOL.
# Fail loudly if the production volume name isn't present anywhere — that
# would mean isolation is illusory and the test would mount production data.
saw_prod = False
rewritten = []
for m in cfg.get("mounts", []):
    if isinstance(m, str) and prod_vol in m:
        rewritten.append(m.replace(prod_vol, test_vol))
        saw_prod = True
    else:
        rewritten.append(m)
if not saw_prod:
    sys.stderr.write(
        f"FATAL: production volume {prod_vol!r} not found in mounts; "
        "test isolation cannot be verified — refusing to proceed.\n"
    )
    sys.exit(1)
cfg["mounts"] = rewritten

# Override postCreateCommand to a no-op. We are validating onCreateCommand
# semantics only; repo-dep installs (pnpm install, uv sync, etc.) need the real
# workspace tree and are irrelevant to FR-005 contract verification.
cfg["postCreateCommand"] = "true"

# Do not modify onCreateCommand: the chown targets /home/vscode/.config/gh
# (the mount target), which is unchanged by the volume-name rewrite.
with open(dst_path, "w") as f:
    json.dump(cfg, f, indent=2)
PYEOF

# Bring up the test container; the devcontainer CLI runs onCreateCommand
# (sudo chown) as part of the lifecycle.
devcontainer up --workspace-folder "$TESTDIR" 2>&1 | tail -20

# Verify ownership + writability as vscode, in the freshly-created isolated container.
devcontainer exec --workspace-folder "$TESTDIR" bash -c '
  set -euo pipefail
  echo "--- mount point ownership ---"
  ls -ld /home/vscode/.config/gh
  owner_group=$(stat -c "%U:%G" /home/vscode/.config/gh)
  if [[ "$owner_group" != "vscode:vscode" ]]; then
    echo "FAIL: mount owner is $owner_group, expected vscode:vscode (onCreateCommand sudo chown did not run or failed)" >&2
    exit 1
  fi
  echo "--- vscode write test ---"
  testfile=/home/vscode/.config/gh/contract-4c-write-probe
  touch "$testfile"
  rm "$testfile"
  echo "OK: FR-005 contract verified on test-isolated volume ('"$TEST_VOL"')"
'
# trap cleanup EXIT removes ONLY the test-scoped volume, the test container, and the temp workspace.
