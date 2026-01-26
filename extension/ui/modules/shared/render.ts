/**
 * Safe DOM Rendering Utilities
 *
 * SECURITY: These functions provide safe DOM construction without raw innerHTML.
 * Use these for all UI rendering to prevent XSS vulnerabilities.
 *
 * Pattern guidance:
 * - Use createElement() + appendChild() for building DOM trees
 * - Use renderNoData() for "no data" placeholder messages
 * - Use clearElement() to safely clear container contents
 * - Use renderTrustedHtml() ONLY for internally-generated HTML (no user data)
 *
 * @see security.ts for escapeHtml and safeHtml utilities
 */

// Re-export security utilities for convenience
export { escapeHtml, safeHtml, sanitizeUrl } from "./security";

/**
 * Clear all children from an element.
 * SECURITY: Safe alternative to `element.innerHTML = ""`
 *
 * @param el - Element to clear (null-safe)
 */
export function clearElement(el: HTMLElement | null): void {
  if (!el) return;
  while (el.firstChild) {
    el.removeChild(el.firstChild);
  }
}

/**
 * Create an element with safe attributes and optional text content.
 * SECURITY: Attributes are set via setAttribute (not innerHTML).
 * Text content is set via textContent (automatically escaped).
 *
 * @param tag - HTML tag name
 * @param attributes - Optional attribute key-value pairs
 * @param textContent - Optional text content (automatically safe)
 * @returns The created element
 */
export function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes?: Record<string, string>,
  textContent?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attributes) {
    for (const [key, value] of Object.entries(attributes)) {
      el.setAttribute(key, value);
    }
  }
  if (textContent !== undefined) {
    el.textContent = textContent;
  }
  return el;
}

/**
 * Append text content safely to an element.
 * SECURITY: Uses document.createTextNode which cannot execute scripts.
 *
 * @param parent - Parent element to append to
 * @param text - Text content to append
 * @returns The created text node
 */
export function appendText(parent: HTMLElement, text: string): Text {
  const textNode = document.createTextNode(text);
  parent.appendChild(textNode);
  return textNode;
}

/**
 * Create a "no data" placeholder paragraph.
 * Common pattern used across chart modules.
 *
 * @param container - Container element (null-safe)
 * @param message - Message to display
 */
export function renderNoData(
  container: HTMLElement | null,
  message: string,
): void {
  if (!container) return;
  clearElement(container);
  const p = createElement("p", { class: "no-data" }, message);
  container.appendChild(p);
}

/**
 * Render trusted HTML content.
 *
 * SECURITY WARNING: Only use this when ALL of:
 * 1. HTML structure is defined in code (not from external data)
 * 2. ALL interpolated values are either:
 *    - Numeric values computed in code
 *    - Strings passed through escapeHtml() or safeHtml``
 *    - Static constants defined in code
 *
 * This function documents the trust boundary - it makes explicit that
 * the caller has verified the HTML is safe.
 *
 * @param container - Container element (null-safe)
 * @param trustedHtml - HTML that has been verified safe by the caller
 */
export function renderTrustedHtml(
  container: HTMLElement | null,
  trustedHtml: string,
): void {
  if (!container) return;
  // SECURITY: This assignment is documented as trusted.
  // Callers MUST ensure all dynamic content is escaped.
  container.innerHTML = trustedHtml;
}

/**
 * Append trusted HTML content without clearing existing content.
 *
 * SECURITY WARNING: Same requirements as renderTrustedHtml.
 *
 * @param container - Container element (null-safe)
 * @param trustedHtml - HTML that has been verified safe by the caller
 */
export function appendTrustedHtml(
  container: HTMLElement | null,
  trustedHtml: string,
): void {
  if (!container) return;
  // Create a temporary container to parse the HTML
  const temp = document.createElement("div");
  temp.innerHTML = trustedHtml;
  // Move all children to the target container
  while (temp.firstChild) {
    container.appendChild(temp.firstChild);
  }
}

/**
 * Create an SVG element with attributes.
 * SECURITY: Safe SVG construction without innerHTML.
 *
 * @param tag - SVG tag name
 * @param attributes - Optional attribute key-value pairs
 * @returns The created SVG element
 */
export function createSvgElement<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes?: Record<string, string>,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  if (attributes) {
    for (const [key, value] of Object.entries(attributes)) {
      el.setAttribute(key, value);
    }
  }
  return el;
}

/**
 * Create an option element for select dropdowns.
 * Common pattern for populating filter dropdowns.
 *
 * @param value - Option value
 * @param text - Display text
 * @param selected - Whether option is selected
 * @returns The created option element
 */
export function createOption(
  value: string,
  text: string,
  selected = false,
): HTMLOptionElement {
  const option = createElement("option", { value }, text);
  if (selected) {
    option.selected = true;
  }
  return option;
}
