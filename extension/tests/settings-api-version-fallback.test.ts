/**
 * Settings page API version fallback tests.
 *
 * Verifies that getOrganizationProjects() uses the shared
 * fetchWithVersionFallback and handles its results correctly.
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

  it("uses the shared fetchWithVersionFallback (not an inline loop)", () => {
    // settings.ts must import fetchWithVersionFallback from the shared module
    expect(settingsCode).toMatch(/fetchWithVersionFallback/);
    expect(settingsCode).toMatch(/from\s+["']\.\/modules\/api-versions["']/);
    // Must NOT contain its own for-loop over version arrays
    expect(settingsCode).not.toMatch(
      /for\s*\(\s*const\s+version\s+of\s+ADO_REST_API_VERSIONS\b/,
    );
  });

  it("passes isListEndpoint: true for the projects endpoint", () => {
    // _apis/projects is a true list endpoint
    expect(settingsCode).toMatch(/isListEndpoint:\s*true/);
  });

  it("checks for auth failures (401/403) after the probe returns", () => {
    expect(settingsCode).toMatch(
      /firstResponse\.status\s*===\s*401\s*\|\|\s*firstResponse\.status\s*===\s*403/,
    );
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

  it("throws on non-ok responses from the probe (server errors not swallowed)", () => {
    // After the shared probe returns, settings must check !firstResponse.ok
    // and throw — not silently continue
    expect(settingsCode).toMatch(
      /if\s*\(\s*!firstResponse\.ok\s*\)/,
    );
  });
});
