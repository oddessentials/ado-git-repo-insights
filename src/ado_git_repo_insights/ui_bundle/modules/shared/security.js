"use strict";
/**
 * Security utilities for dashboard.
 *
 * SECURITY: These functions protect against XSS and other injection attacks.
 * Use escapeHtml for any user-controlled or external data before innerHTML.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.escapeHtml = escapeHtml;
exports.sanitizeUrl = sanitizeUrl;
/**
 * Escape HTML to prevent XSS attacks.
 * SECURITY: Use this for any user-controlled or external data before innerHTML.
 * DOM-FREE: Uses string replacement, no document access.
 */
function escapeHtml(text) {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
/**
 * Sanitize a URL for use in href attributes.
 * Only allows http, https, and relative URLs.
 */
function sanitizeUrl(url) {
    const trimmed = url.trim();
    if (trimmed.startsWith("https://") ||
        trimmed.startsWith("http://") ||
        trimmed.startsWith("/") ||
        trimmed.startsWith("./") ||
        trimmed.startsWith("?")) {
        return trimmed;
    }
    // Block javascript:, data:, and other potentially dangerous schemes
    return "#";
}
//# sourceMappingURL=security.js.map