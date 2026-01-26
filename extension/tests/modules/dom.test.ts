/**
 * DOM module tests.
 *
 * Tests DOM caching behavior and type-safe element accessors.
 * Uses JSDOM for DOM environment.
 */

import {
  getElement,
  getNodeList,
  cacheElement,
  cacheElements,
  clearElementCache,
} from "../../ui/modules/dom";

describe("dom module", () => {
  beforeEach(() => {
    // Clear cache before each test
    clearElementCache();
    // Reset DOM
    document.body.innerHTML = "";
  });

  describe("getElement", () => {
    it("returns null for uncached element", () => {
      expect(getElement("nonexistent")).toBeNull();
    });

    it("returns cached HTMLElement", () => {
      document.body.innerHTML = `<div id="test-div"></div>`;
      cacheElement("test-div");
      const el = getElement("test-div");
      expect(el).toBeInstanceOf(HTMLElement);
      expect(el?.id).toBe("test-div");
    });

    it("returns typed element when generic specified", () => {
      document.body.innerHTML = `<input id="test-input" type="text" />`;
      cacheElement("test-input");
      const el = getElement<HTMLInputElement>("test-input");
      expect(el).toBeInstanceOf(HTMLInputElement);
      expect(el?.type).toBe("text");
    });

    it("returns null for element ID not in DOM", () => {
      cacheElement("missing-element");
      expect(getElement("missing-element")).toBeNull();
    });
  });

  describe("getNodeList", () => {
    it("returns null for uncached node list", () => {
      expect(getNodeList("uncached-list")).toBeNull();
    });

    // Note: getNodeList requires manual caching of NodeList
    // which is typically done in cacheElements() for specific cases
  });

  describe("cacheElements", () => {
    it("caches standard dashboard elements", () => {
      // Create minimal DOM with some expected elements
      document.body.innerHTML = `
                <div id="app"></div>
                <div id="loading-state"></div>
                <div id="error-state"></div>
                <div id="main-content"></div>
            `;

      cacheElements();

      expect(getElement("app")).not.toBeNull();
      expect(getElement("loading-state")).not.toBeNull();
      expect(getElement("error-state")).not.toBeNull();
      expect(getElement("main-content")).not.toBeNull();
    });

    it("handles missing elements gracefully", () => {
      document.body.innerHTML = `<div id="app"></div>`;
      cacheElements();

      // Should not throw, uncached elements return null
      expect(getElement("app")).not.toBeNull();
      expect(getElement("loading-state")).toBeNull();
    });
  });

  describe("clearElementCache", () => {
    it("removes all cached elements", () => {
      document.body.innerHTML = `<div id="test-el"></div>`;
      cacheElement("test-el");
      expect(getElement("test-el")).not.toBeNull();

      clearElementCache();
      expect(getElement("test-el")).toBeNull();
    });
  });
});
