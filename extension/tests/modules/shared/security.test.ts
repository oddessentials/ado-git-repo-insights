/**
 * Tests for modules/shared/security.ts
 *
 * Verifies XSS prevention utilities:
 * - escapeHtml function
 * - safeHtml tagged template literal
 * - sanitizeUrl function
 */

import {
  escapeHtml,
  safeHtml,
  sanitizeUrl,
} from "../../../ui/modules/shared/security";

describe("security utilities", () => {
  describe("escapeHtml", () => {
    it("escapes ampersand", () => {
      expect(escapeHtml("foo & bar")).toBe("foo &amp; bar");
    });

    it("escapes less than", () => {
      expect(escapeHtml("<script>")).toBe("&lt;script&gt;");
    });

    it("escapes greater than", () => {
      expect(escapeHtml("a > b")).toBe("a &gt; b");
    });

    it("escapes double quotes", () => {
      expect(escapeHtml('say "hello"')).toBe("say &quot;hello&quot;");
    });

    it("escapes single quotes", () => {
      expect(escapeHtml("it's")).toBe("it&#039;s");
    });

    it("escapes all special characters together", () => {
      const input = "<script>alert(\"xss\" & 'bad')</script>";
      const expected =
        "&lt;script&gt;alert(&quot;xss&quot; &amp; &#039;bad&#039;)&lt;/script&gt;";
      expect(escapeHtml(input)).toBe(expected);
    });

    it("preserves safe characters", () => {
      expect(escapeHtml("Hello World 123")).toBe("Hello World 123");
    });

    it("handles empty string", () => {
      expect(escapeHtml("")).toBe("");
    });

    it("handles unicode characters", () => {
      expect(escapeHtml("Hello 世界 🌍")).toBe("Hello 世界 🌍");
    });
  });

  describe("safeHtml tagged template", () => {
    it("escapes interpolated values", () => {
      const userInput = "<script>alert('xss')</script>";
      const result = safeHtml`<div>${userInput}</div>`;
      expect(result).toBe(
        "<div>&lt;script&gt;alert(&#039;xss&#039;)&lt;/script&gt;</div>",
      );
    });

    it("preserves static template strings", () => {
      const result = safeHtml`<p>Hello</p>`;
      expect(result).toBe("<p>Hello</p>");
    });

    it("handles multiple interpolations", () => {
      const name = "<b>John</b>";
      const age = 30;
      const result = safeHtml`<p>Name: ${name}, Age: ${age}</p>`;
      expect(result).toBe("<p>Name: &lt;b&gt;John&lt;/b&gt;, Age: 30</p>");
    });

    it("converts numbers to strings", () => {
      const count = 42;
      const result = safeHtml`<span>Count: ${count}</span>`;
      expect(result).toBe("<span>Count: 42</span>");
    });

    it("handles null values as empty string", () => {
      const value = null;
      const result = safeHtml`<span>${value}</span>`;
      expect(result).toBe("<span></span>");
    });

    it("handles undefined values as empty string", () => {
      const value = undefined;
      const result = safeHtml`<span>${value}</span>`;
      expect(result).toBe("<span></span>");
    });

    it("handles boolean values", () => {
      const active = true;
      const result = safeHtml`<span>${active}</span>`;
      expect(result).toBe("<span>true</span>");
    });

    it("handles objects by converting to string", () => {
      const obj = { foo: "bar" };
      const result = safeHtml`<span>${obj}</span>`;
      expect(result).toBe("<span>[object Object]</span>");
    });

    it("escapes data attributes", () => {
      const xss = '" onclick="alert(1)"';
      const result = safeHtml`<div data-value="${xss}"></div>`;
      expect(result).toBe(
        '<div data-value="&quot; onclick=&quot;alert(1)&quot;"></div>',
      );
    });
  });

  describe("sanitizeUrl", () => {
    it("allows https URLs", () => {
      expect(sanitizeUrl("https://example.com")).toBe("https://example.com");
    });

    it("allows http URLs", () => {
      expect(sanitizeUrl("http://example.com")).toBe("http://example.com");
    });

    it("allows relative URLs starting with /", () => {
      expect(sanitizeUrl("/path/to/page")).toBe("/path/to/page");
    });

    it("allows relative URLs starting with ./", () => {
      expect(sanitizeUrl("./relative/path")).toBe("./relative/path");
    });

    it("allows query strings starting with ?", () => {
      expect(sanitizeUrl("?foo=bar")).toBe("?foo=bar");
    });

    it("blocks javascript: URLs", () => {
      expect(sanitizeUrl("javascript:alert(1)")).toBe("#");
    });

    it("blocks data: URLs", () => {
      expect(sanitizeUrl("data:text/html,<script>")).toBe("#");
    });

    it("blocks vbscript: URLs", () => {
      expect(sanitizeUrl("vbscript:msgbox(1)")).toBe("#");
    });

    it("blocks unknown protocols", () => {
      expect(sanitizeUrl("custom://evil")).toBe("#");
    });

    it("trims whitespace", () => {
      expect(sanitizeUrl("  https://example.com  ")).toBe(
        "https://example.com",
      );
    });

    it("handles empty string", () => {
      expect(sanitizeUrl("")).toBe("#");
    });

    it("handles URLs with special characters", () => {
      expect(sanitizeUrl("https://example.com/path?a=1&b=2#hash")).toBe(
        "https://example.com/path?a=1&b=2#hash",
      );
    });

    it("blocks javascript: with encoding tricks", () => {
      // These should be blocked because they don't start with allowed prefixes
      expect(sanitizeUrl("JAVASCRIPT:alert(1)")).toBe("#");
      expect(sanitizeUrl("Java\nScript:alert(1)")).toBe("#");
    });
  });
});
