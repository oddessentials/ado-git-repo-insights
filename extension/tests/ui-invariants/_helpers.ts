/**
 * UI-invariant test helpers (issue #308).
 *
 * Two pure assertions consumed by the invariant gates in this directory:
 *
 *   - `assertNoGuidInVisibleText(root)` — walks a curated list of visible
 *     elements (no general attribute traversal) and fails if a UUID-shaped
 *     string appears in `textContent`, `aria-label`, or `title`.
 *     `data-*` and other attributes are intentionally out of scope —
 *     GUIDs belong in dispatch/debug attrs but never in copy users read
 *     or screen-readers announce.
 *
 *   - `assertPrNumbersAreLinked(root)` — walks text nodes, and for every
 *     `#\d{2,}` token verifies the nearest ancestor `<a>` has an `href`
 *     matching the ADO PR URL shape. Scoped per-call so callers can
 *     restrict it to surfaces that actually render PR numbers (do not
 *     over-assert on unrelated panels).
 *
 * The UUID_REGEX here is imported from the canonical shared module — the
 * `uuid-regex-uniqueness.test.ts` gate fails if any other `.ts` file
 * redeclares the pattern literal.
 */

import { UUID_REGEX } from "../../ui/modules/shared/uuid-pattern";

interface Violation {
  readonly where: string;
  readonly matched: string;
  readonly context: string;
}

/** Curated: elements that render user-visible text. Intentionally does
 *  NOT include form inputs, SVG internals, or attribute-only nodes. */
const VISIBLE_ELEMENT_SELECTOR =
  "h1, h2, h3, h4, h5, h6, th, td, a, button, span, p, dt, dd, label, li, summary";

/** Fields on a visible element that carry copy users read or hear. */
const VISIBLE_ATTRS: readonly string[] = ["aria-label", "title"];

export function assertNoGuidInVisibleText(root: ParentNode): void {
  const violations: Violation[] = [];
  const elements = root.querySelectorAll<HTMLElement>(VISIBLE_ELEMENT_SELECTOR);
  for (const el of Array.from(elements)) {
    const text = el.textContent ?? "";
    const textMatch = UUID_REGEX.exec(text);
    if (textMatch !== null) {
      violations.push({
        where: "textContent",
        matched: textMatch[0],
        context: summarize(el),
      });
    }
    for (const attr of VISIBLE_ATTRS) {
      const value = el.getAttribute(attr);
      if (value === null) continue;
      const match = UUID_REGEX.exec(value);
      if (match !== null) {
        violations.push({
          where: `[${attr}]`,
          matched: match[0],
          context: summarize(el),
        });
      }
    }
  }
  if (violations.length > 0) {
    const lines = violations.map(
      (v) => `  ${v.where}: "${v.matched}" in ${v.context}`,
    );
    throw new Error(
      `assertNoGuidInVisibleText: ${violations.length} visible-surface GUID leak(s) (#308 invariant):\n${lines.join("\n")}`,
    );
  }
}

const PR_NUMBER_IN_TEXT = /#\d{2,}/;
const ADO_PR_HREF = /\/_git\/[^/]+\/pullrequest\/\d+$/;

export function assertPrNumbersAreLinked(root: ParentNode): void {
  const violations: Violation[] = [];
  const walker = (root.ownerDocument ?? document).createTreeWalker(
    root as Node,
    NodeFilter.SHOW_TEXT,
  );
  let node: Node | null = walker.nextNode();
  while (node !== null) {
    const text = node.textContent ?? "";
    const match = PR_NUMBER_IN_TEXT.exec(text);
    if (match !== null) {
      const anchor = nearestAnchor(node);
      const href = anchor?.getAttribute("href") ?? null;
      if (href === null || !ADO_PR_HREF.test(href)) {
        violations.push({
          where: "text node",
          matched: match[0],
          context: `${node.parentElement ? summarize(node.parentElement) : "<detached>"} href=${href ?? "<none>"}`,
        });
      }
    }
    node = walker.nextNode();
  }
  if (violations.length > 0) {
    const lines = violations.map(
      (v) => `  ${v.where}: "${v.matched}" in ${v.context}`,
    );
    throw new Error(
      `assertPrNumbersAreLinked: ${violations.length} unlinked PR-number reference(s) (#308 invariant):\n${lines.join("\n")}`,
    );
  }
}

function summarize(el: HTMLElement): string {
  const tag = el.tagName.toLowerCase();
  const id = el.id !== "" ? `#${el.id}` : "";
  const classes = el.className
    ? `.${el.className.trim().split(/\s+/).join(".")}`
    : "";
  return `<${tag}${id}${classes}>`;
}

function nearestAnchor(node: Node): HTMLAnchorElement | null {
  let el: Element | null =
    node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
  while (el !== null) {
    if (el.tagName === "A") return el as HTMLAnchorElement;
    el = el.parentElement;
  }
  return null;
}
