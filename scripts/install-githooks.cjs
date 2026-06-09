#!/usr/bin/env node
// Install SELF-CONTAINED git-hook dispatchers into husky's hooks directory
// (`.husky/_`), so the local quality gates run deterministically even though
// entire.io continuously re-injects its own hook wrappers.
//
// WHY THIS EXISTS
// --------------
// git runs the file at `core.hooksPath/<hook>` (husky sets that to `.husky/_`).
// entire.io (entireio/cli) installs its own wrappers into that same directory
// on every session — by design; it records the session. When entire wraps an
// existing hook it backs the original up to `<hook>.pre-entire` and chains to
// it by EXECUTING that backup by path (cmd/entire/cli/strategy/hooks.go,
// generateChainedContent). That chaining works for a self-contained script —
// but NOT for husky's stock dispatcher, which sources `.husky/_/h` and resolves
// the user hook from `$0`'s basename. Renamed to `<hook>.pre-entire`, husky's
// `h` looks for `.husky/<hook>.pre-entire` (absent) and silently exits 0, so
// the real gate (commitlint / pre-push preflight) is skipped.
//
// Replacing husky's stock `.husky/_/<hook>` dispatchers with SELF-CONTAINED
// ones (filename-independent: they exec `.husky/<hook>` by a hard-coded name)
// makes entire's wrap-and-chain run the gate in BOTH states — fresh, and after
// entire wraps + backs up + chains. There is no window in which the gate is
// skipped, and it relies only on entire's documented chain-to-backup behavior,
// not on any version-specific bug. See LOCAL_CI_PARITY_INVARIANTS.md row 7f.
//
// Runs from `prepare` AFTER `husky` (which regenerates the stock dispatchers on
// every `pnpm install`) so the self-contained dispatchers are always restored.
// `.husky/_` is gitignored, so this never produces working-tree churn.
const fs = require("fs");
const path = require("path");

// Only hooks that have a tracked `.husky/<hook>` gate script. pre-commit is NOT
// entire-managed (entire never wraps it) but still needs a self-contained
// dispatcher so it runs via `.husky/_`.
const HOOKS = [
  "pre-commit",
  "commit-msg",
  "pre-push",
  "post-commit",
  "prepare-commit-msg",
];

// ADO_HOOKS_REPO_ROOT overrides the repo root for tests only; production omits it.
const repoRoot = process.env.ADO_HOOKS_REPO_ROOT
  ? path.resolve(process.env.ADO_HOOKS_REPO_ROOT)
  : path.resolve(__dirname, "..");
const huskyDir = path.join(repoRoot, ".husky");
const internalDir = path.join(huskyDir, "_");

// Self-contained dispatcher: honors HUSKY=0 (parity with husky's `h`, used by
// CI's semantic-release), then execs the tracked user hook by hard-coded name
// so it is immune to entire renaming this file to `<hook>.pre-entire`.
function dispatcher(hook) {
  return (
    "#!/usr/bin/env sh\n" +
    '[ "${HUSKY-}" = "0" ] && exit 0\n' +
    `exec sh "$(dirname "$(dirname "$0")")/${hook}" "$@"\n`
  );
}

try {
  fs.mkdirSync(internalDir, { recursive: true });
} catch {
  // husky not generated yet / not writable — nothing to do.
  process.exit(0);
}

let installed = 0;
for (const hook of HOOKS) {
  if (!fs.existsSync(path.join(huskyDir, hook))) continue; // no tracked gate script
  const target = path.join(internalDir, hook);
  const content = dispatcher(hook);
  try {
    const fresh =
      !fs.existsSync(target) || fs.readFileSync(target, "utf8") !== content;
    if (fresh) {
      // Write the self-contained dispatcher FIRST (replacing any entire wrapper
      // or husky stock dispatcher), then drop the stale `<hook>.pre-entire`
      // backup. entire keeps an existing backup verbatim on re-wrap, so a stale
      // backup holding husky's basename dispatcher would re-break the chain;
      // clearing it forces entire to re-back-up the self-contained dispatcher.
      fs.writeFileSync(target, content, { mode: 0o755 });
      fs.chmodSync(target, 0o755);
      installed++;
    }
    const backup = target + ".pre-entire";
    if (fs.existsSync(backup) && fs.readFileSync(backup, "utf8") !== content) {
      fs.rmSync(backup, { force: true });
    }
  } catch (err) {
    console.warn(`[install-githooks] WARNING: could not write ${hook}: ${err && err.message}`);
  }
}

if (installed > 0) {
  console.log(`[install-githooks] installed ${installed} self-contained hook dispatcher(s) into .husky/_`);
}
process.exit(0);
