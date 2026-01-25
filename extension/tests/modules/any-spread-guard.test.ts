/**
 * Test to verify the `any` type is only used in the documented exception.
 *
 * This test enforces the architectural constraint that `any` should only
 * appear in dom.ts (the DOM element cache).
 */

import * as fs from "fs";
import * as path from "path";

describe("any-spread prevention", () => {
  const modulesDir = path.join(__dirname, "../../ui/modules");

  // Files where `any` is explicitly allowed (documented exception)
  const allowedAnyFiles = ["dom.ts"];

  it("no-explicit-any should only appear in dom.ts", () => {
    // Pattern matches TypeScript any usage: ": any", "as any", "<any>"
    // More precise pattern that requires proper type context
    const anyPattern = /:\s*any\s*[,;)}\]|]|as\s+any\s*[,;)}\]|]|<any>/g;

    const moduleFiles = fs
      .readdirSync(modulesDir, { recursive: true })
      .filter((f): f is string => typeof f === "string")
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

    const violations: string[] = [];

    for (const file of moduleFiles) {
      if (allowedAnyFiles.some((allowed) => file.endsWith(allowed))) {
        continue;
      }

      const filePath = path.join(modulesDir, file);
      const content = fs.readFileSync(filePath, "utf-8");
      const matches = content.match(anyPattern);

      if (matches) {
        violations.push(`${file}: ${matches.length} occurrences of 'any'`);
      }
    }

    expect(violations).toEqual([]);
  });

  it("dom.ts uses proper union type instead of any", () => {
    const domPath = path.join(modulesDir, "dom.ts");
    const content = fs.readFileSync(domPath, "utf-8");

    // Should contain the CachedDomValue union type (improved from 'any')
    expect(content).toContain("CachedDomValue");
    expect(content).toContain("HTMLElement | NodeListOf<Element> | null");

    // Should have a typed elements cache
    expect(content).toContain("Record<string, CachedDomValue>");
  });

  it("dom.ts provides typed getElement accessor", () => {
    const domPath = path.join(modulesDir, "dom.ts");
    const content = fs.readFileSync(domPath, "utf-8");

    // Should export a typed accessor
    expect(content).toContain("function getElement");
    expect(content).toMatch(/getElement<.*>/);
  });
});
