/**
 * @jest-environment node
 */

import { JSDOM } from "jsdom";

import {
  canShowSyntheticData,
  getCurrentHostname,
  isLocalDevelopment,
  isProductionEnvironment,
} from "../../../ui/modules/ml/dev-mode";

describe("dev-mode (custom URL environments via JSDOM)", () => {
  function runInEnvironment(url: string, testFn: () => void): void {
    const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", { url });
    const originalWindow = (global as unknown as Record<string, unknown>)
      .window;
    const originalDocument = (global as unknown as Record<string, unknown>)
      .document;

    (global as unknown as Record<string, unknown>).window = dom.window;
    (global as unknown as Record<string, unknown>).document =
      dom.window.document;

    try {
      testFn();
    } finally {
      (global as unknown as Record<string, unknown>).window = originalWindow;
      (global as unknown as Record<string, unknown>).document =
        originalDocument;
      dom.window.close();
    }
  }

  it("production URL returns correct values", () => {
    runInEnvironment(
      "https://dev.azure.com/testorg/testproject/_apps/hub/test",
      () => {
        expect(getCurrentHostname()).toBe("dev.azure.com");
        expect(isProductionEnvironment()).toBe(true);
        expect(isLocalDevelopment()).toBe(false);
        expect(canShowSyntheticData(true)).toBe(false);
      },
    );
  });

  it("localhost URL returns correct values", () => {
    runInEnvironment("http://localhost:8080/dashboard", () => {
      expect(getCurrentHostname()).toBe("localhost");
      expect(isProductionEnvironment()).toBe(false);
      expect(isLocalDevelopment()).toBe(true);
      expect(canShowSyntheticData(true)).toBe(true);
    });
  });

  it("file:// protocol returns empty hostname", () => {
    runInEnvironment("file:///C:/dashboard/index.html", () => {
      expect(getCurrentHostname()).toBe("");
      expect(isProductionEnvironment()).toBe(false);
      expect(isLocalDevelopment()).toBe(true);
    });
  });
});
