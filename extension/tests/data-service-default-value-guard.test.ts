/**
 * Guard: every getValue() call must include defaultValue.
 *
 * The Azure DevOps host's XDM serializer crashes when getValue()
 * returns null (no stored value). Passing defaultValue ensures the
 * host always serializes a non-null result, avoiding:
 *
 *   "Cannot set properties of null (setting '__remoteSerializationSettings')"
 *
 * This test reads production source files and verifies that every
 * getValue() call includes a defaultValue option.
 */

import * as path from "path";
import * as _fsOriginal from "fs";
function _loadFs(): typeof _fsOriginal {
  return _fsOriginal;
}
const _fs = _loadFs();

const UI_DIR = path.join(__dirname, "../ui");

/** Production files that use the Extension Data Service. */
const DATA_SERVICE_FILES = ["settings.ts", "dashboard.ts"];

/**
 * Extract all getValue() call blocks from source code.
 * Returns the text of each call (from .getValue to the closing paren).
 */
function extractGetValueCalls(source: string): string[] {
  const calls: string[] = [];
  const pattern = /\.getValue\b[^;]*;/gs;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    calls.push(match[0]);
  }
  return calls;
}

describe("Extension Data Service defaultValue guard", () => {
  for (const file of DATA_SERVICE_FILES) {
    describe(file, () => {
      let source: string;

      beforeAll(() => {
        source = _fs.readFileSync(path.join(UI_DIR, file), "utf8");
      });

      it("has at least one getValue() call", () => {
        const calls = extractGetValueCalls(source);
        expect(calls.length).toBeGreaterThan(0);
      });

      it("every getValue() call includes defaultValue", () => {
        const calls = extractGetValueCalls(source);
        const missing = calls.filter((c) => !c.includes("defaultValue"));
        if (missing.length > 0) {
          fail(
            `Found ${missing.length} getValue() call(s) without defaultValue in ${file}:\n` +
              missing.map((c) => `  ${c.trim()}`).join("\n") +
              "\n\nThe ADO host XDM serializer crashes on null results. " +
              "Always pass defaultValue to prevent __remoteSerializationSettings errors.",
          );
        }
      });
    });
  }
});
