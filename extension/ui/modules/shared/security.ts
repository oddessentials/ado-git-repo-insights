/**
 * Security utilities for dashboard.
 *
 * SECURITY: These functions protect against XSS and other injection attacks.
 * Use escapeHtml for any user-controlled or external data before innerHTML.
 */

/**
 * Escape HTML to prevent XSS attacks.
 * SECURITY: Use this for any user-controlled or external data before innerHTML.
 * DOM-FREE: Uses string replacement, no document access.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Tagged template literal for safe HTML construction.
 * All interpolated values are HTML-escaped automatically.
 *
 * SECURITY: Use this for any innerHTML assignment with dynamic values.
 * This is the preferred method over manual escapeHtml() calls.
 *
 * Usage: element.innerHTML = safeHtml`<div>${userInput}</div>`;
 *
 * @example
 * // All values are automatically escaped
 * const html = safeHtml`<span>${userName}</span>`;
 *
 * // Numbers are converted to strings safely
 * const count = safeHtml`<p>Count: ${count}</p>`;
 *
 * // null/undefined become empty strings
 * const optional = safeHtml`<p>${maybeNull}</p>`;
 */
export function safeHtml(
  strings: TemplateStringsArray,
  ...values: unknown[]
): string {
  return strings.reduce((result, str, i) => {
    // eslint-disable-next-line security/detect-object-injection -- SECURITY: i is loop index bounded by array length
    const value = i < values.length ? escapeHtml(String(values[i] ?? "")) : "";
    return result + str + value;
  }, "");
}

/**
 * Sanitize a URL for use in href attributes.
 * Only allows http, https, and relative URLs.
 */
export function sanitizeUrl(url: string): string {
  const trimmed = url.trim();
  if (
    trimmed.startsWith("https://") ||
    trimmed.startsWith("http://") ||
    trimmed.startsWith("/") ||
    trimmed.startsWith("./") ||
    trimmed.startsWith("?")
  ) {
    return trimmed;
  }
  // Block javascript:, data:, and other potentially dangerous schemes
  return "#";
}
