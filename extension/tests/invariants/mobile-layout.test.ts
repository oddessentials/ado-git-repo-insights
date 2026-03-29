/**
 * Mobile Layout Invariant Tests (FR-014, FR-030)
 *
 * Verifies that the JS MOBILE_BREAKPOINT constant stays coordinated
 * with CSS @media breakpoints in styles.css.
 */

import { resolve } from "node:path";
import { readTextFile } from "../helpers/fs-test-utils";
import { MOBILE_BREAKPOINT } from "../../ui/modules/shared/constants";

describe("MOBILE_BREAKPOINT parity (FR-014)", () => {
  const stylesPath = resolve(__dirname, "..", "..", "ui", "styles.css");
  const stylesContent = readTextFile(stylesPath);

  it("JS constant matches CSS @media max-width breakpoint", () => {
    const expected = `max-width: ${String(MOBILE_BREAKPOINT)}px`;
    expect(stylesContent).toContain(expected);
  });

  it("no stray 480px magic numbers outside @media rules", () => {
    const allMatches = stylesContent.match(/480px/g) ?? [];
    const mediaMatches =
      stylesContent.match(/@media[^{]*480px/g) ?? [];
    expect(allMatches.length).toBe(mediaMatches.length);
  });
});
