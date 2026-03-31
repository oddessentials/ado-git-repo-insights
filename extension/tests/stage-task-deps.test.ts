/**
 * Tests for stage-task-deps.mjs behavior.
 *
 * Verifies that task dependency staging produces a flat node_modules
 * layout that tfx can package into a VSIX. Uses npm (not pnpm) because
 * pnpm's symlinked layout causes tfx EISDIR errors.
 */

import * as _fsOriginal from "fs";
function _loadFs(): typeof _fsOriginal {
  return _fsOriginal;
}
const _fs = _loadFs();
import * as path from "path";

const TASK_DIR = path.join(__dirname, "../tasks/extract-prs");
const STAGE_SCRIPT = path.join(__dirname, "../scripts/stage-task-deps.mjs");

describe("stage-task-deps", () => {
  it("staging script exists", () => {
    expect(_fs.existsSync(STAGE_SCRIPT)).toBe(true);
  });

  it("extract-prs task has package.json", () => {
    const pkgPath = path.join(TASK_DIR, "package.json");
    expect(_fs.existsSync(pkgPath)).toBe(true);
  });

  it("staging script uses npm for tfx-compatible flat layout", () => {
    const content = _fs.readFileSync(STAGE_SCRIPT, "utf8");
    expect(content).toContain("npm install --production");
  });

  it("staging script cleans node_modules before install", () => {
    const content = _fs.readFileSync(STAGE_SCRIPT, "utf8");
    expect(content).toContain("rmSync(nodeModulesPath");
  });

  it("staging script removes transient package-lock.json", () => {
    const content = _fs.readFileSync(STAGE_SCRIPT, "utf8");
    expect(content).toContain("transientLock");
    expect(content).toContain("unlinkSync");
  });

  it("task directory does not have a committed package-lock.json", () => {
    const lockPath = path.join(TASK_DIR, "package-lock.json");
    expect(_fs.existsSync(lockPath)).toBe(false);
  });
});
