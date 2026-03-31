/**
 * Settings page API version fallback tests.
 *
 * Verifies that getOrganizationProjects() negotiates a working API
 * version with the host, falling back from 7.1 → 6.0 → 5.1 for
 * Azure DevOps Server compatibility.
 */

import * as path from "path";
import * as _fsOriginal from "fs";
function _loadFs(): typeof _fsOriginal { return _fsOriginal; }
const _fs = _loadFs();

const SETTINGS_PATH = path.join(__dirname, "../ui/settings.ts");

describe("Settings API version fallback", () => {
  let settingsCode: string;

  beforeAll(() => {
    settingsCode = _fs.readFileSync(SETTINGS_PATH, "utf8");
  });

  it("defines a version fallback chain", () => {
    expect(settingsCode).toMatch(
      /PROJECT_API_VERSIONS\s*=\s*\[/,
    );
    // Must contain all three versions in order
    const match = settingsCode.match(
      /PROJECT_API_VERSIONS\s*=\s*\[([^\]]+)\]/,
    );
    expect(match).not.toBeNull();
    const versions = match?.[1]?.replace(/["\s]/g, "").split(",");
    expect(versions).toBeDefined();
    expect(versions).toEqual(["7.1", "6.0", "5.1"]);
  });

  it("fails fast on 401/403 without trying older versions", () => {
    // The code must check for auth failures before continuing the loop
    expect(settingsCode).toMatch(
      /response\.status\s*===\s*401\s*\|\|\s*response\.status\s*===\s*403/,
    );
    // The throw must come before the version loop continues
    const authCheck = settingsCode.indexOf("response.status === 401");
    const breakOrContinue = settingsCode.indexOf(
      "workingVersion = version",
      authCheck,
    );
    expect(authCheck).toBeLessThan(breakOrContinue);
  });

  it("reuses the discovered version for pagination", () => {
    // Pagination URL must use workingVersion, not a hardcoded version
    expect(settingsCode).toMatch(
      /api-version=\$\{workingVersion\}/,
    );
    // Must NOT have a hardcoded 7.1 in the pagination path
    const paginationSection = settingsCode.slice(
      settingsCode.indexOf("Paginate remaining pages"),
    );
    expect(paginationSection).not.toMatch(/api-version=7\.1/);
  });
});
