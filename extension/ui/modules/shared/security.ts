/**
 * Security utilities for dashboard.
 *
 * SECURITY: These functions protect against XSS and other injection attacks.
 * Use escapeHtml for any user-controlled or external data before innerHTML.
 */

/**
 * Escape HTML to prevent XSS attacks.
 * SECURITY: Use this for any user-controlled or external data before innerHTML.
 */
export function escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
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
