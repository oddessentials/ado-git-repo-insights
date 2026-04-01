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

import { ADO_REST_API_VERSIONS } from "../ui/modules/api-versions";

const SETTINGS_PATH = path.join(__dirname, "../ui/settings.ts");

describe("Settings API version fallback", () => {
  let settingsCode: string;

  beforeAll(() => {
    settingsCode = _fs.readFileSync(SETTINGS_PATH, "utf8");
  });

  it("imports the shared version fallback chain", () => {
    // settings.ts must import ADO_REST_API_VERSIONS from the shared module
    expect(settingsCode).toMatch(/ADO_REST_API_VERSIONS/);
    expect(settingsCode).toMatch(/from\s+["']\.\/modules\/api-versions["']/);
    // The shared constant must contain all three versions in order
    expect([...ADO_REST_API_VERSIONS]).toEqual(["7.1", "6.0", "5.1"]);
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

  it("terminates pagination on malformed JSON", () => {
    // processPage must catch JSON parse failures and return null
    // to stop the pagination loop (not throw or continue)
    const processPageBlock = settingsCode.slice(
      settingsCode.indexOf("const processPage"),
      settingsCode.indexOf("let continuationToken = await processPage"),
    );
    // Must have try/catch around response.json()
    expect(processPageBlock).toMatch(/try\s*\{[\s\S]*?await response\.json\(\)/);
    expect(processPageBlock).toMatch(/\}\s*catch\s*\{/);
    // Must return null in the catch path (terminates pagination)
    expect(processPageBlock).toMatch(/catch\s*\{[\s\S]*?return null/);
  });
});
