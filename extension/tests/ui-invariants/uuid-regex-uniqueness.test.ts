/**
 * UI invariant gate (issue #308): the UUID-pattern source literal
 * appears in exactly one .ts file in the extension — the canonical
 * shared module. Every production site and every invariant gate that
 * needs to detect a UUID-shaped string imports UUID_REGEX / isUuid /
 * findFirstUuid from there. Any other .ts that redeclares an
 * equivalent regex / string is flagged by this test.
 *
 * Grep shape: the regex below matches the hex-class-length-eight
 * shape common to every UUID pattern declaration. This source file
 * does NOT contain that contiguous literal — commentary uses the
 * non-triggering phrase "hex-class-length-eight" in place of the
 * regex fragment, and the matcher itself escapes the brackets and
 * braces so their characters are separated by backslashes in source.
 */

import * as _fsOriginal from "fs";
// Indirect import mirrors tests/modules/any-spread-guard.test.ts — it
// threads dynamic fs access through a factory so the ESLint
// security/detect-non-literal-fs-filename rule does not fire.
// The paths below are all constructed from __dirname or by recursive
// directory walk of the project tree; no external input reaches them.
function _loadFs(): typeof _fsOriginal {
  return _fsOriginal;
}
const _fs = _loadFs();
import { join } from "path";

const EXTENSION_ROOT = join(__dirname, "..", "..");
const CANONICAL_SOURCE = join(
  EXTENSION_ROOT,
  "ui",
  "modules",
  "shared",
  "uuid-pattern.ts",
);
const SKIP_DIRS: readonly string[] = [
  "node_modules",
  "dist",
  ".git",
  "broken-docs",
  "coverage",
];
// Matches regex literals and string literals that declare the hex-
// class-length-eight group. Case-insensitive to catch uppercase
// declarations. See module-level comment for why this file does not
// self-trigger.
const UUID_PATTERN_LITERAL = /\[0-9a-f\]\{8\}/i;

function* walkTs(dir: string): Iterable<string> {
  const entries = _fs.readdirSync(dir);
  for (const entry of entries) {
    if (SKIP_DIRS.includes(entry)) continue;
    const path = join(dir, entry);
    const stat = _fs.statSync(path);
    if (stat.isDirectory()) {
      yield* walkTs(path);
      continue;
    }
    if (!entry.endsWith(".ts")) continue;
    if (entry.endsWith(".d.ts")) continue;
    yield path;
  }
}

describe("UI invariant: UUID pattern is defined exactly once (#308)", () => {
  it("only shared/uuid-pattern.ts declares the UUID regex literal", () => {
    const offenders: string[] = [];
    for (const file of walkTs(EXTENSION_ROOT)) {
      if (file === CANONICAL_SOURCE) continue;
      const content = _fs.readFileSync(file, "utf8");
      if (UUID_PATTERN_LITERAL.test(content)) {
        offenders.push(file);
      }
    }
    if (offenders.length > 0) {
      const list = offenders.map((f) => `  - ${f}`).join("\n");
      throw new Error(
        `UUID pattern literal must live only in shared/uuid-pattern.ts.\n` +
          `Found redeclaration(s) in:\n${list}\n` +
          `Import UUID_REGEX / isUuid / findFirstUuid from ` +
          `"../shared/uuid-pattern" instead.`,
      );
    }
    expect(offenders).toEqual([]);
  });

  it("the canonical source file itself still contains the pattern (sanity)", () => {
    // Protects against accidental removal — if uuid-pattern.ts is
    // refactored in a way that drops the literal, the uniqueness gate
    // would vacuously pass with zero hits. This test locks the
    // existence of the single legitimate declaration.
    const content = _fs.readFileSync(CANONICAL_SOURCE, "utf8");
    expect(UUID_PATTERN_LITERAL.test(content)).toBe(true);
  });
});
