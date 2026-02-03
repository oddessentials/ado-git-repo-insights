/**
 * Tests for DOM-dependent export functions.
 *
 * Tests triggerDownload and showToast functions that require jsdom.
 */

import { triggerDownload, showToast } from "../../ui/modules/export";

describe("export DOM functions", () => {
  describe("triggerDownload", () => {
    let originalCreateObjectURL: typeof URL.createObjectURL;
    let originalRevokeObjectURL: typeof URL.revokeObjectURL;
    let createObjectURLMock: jest.Mock;
    let revokeObjectURLMock: jest.Mock;
    let appendChildSpy: jest.SpyInstance;
    let removeChildSpy: jest.SpyInstance;

    beforeEach(() => {
      // Store originals
      originalCreateObjectURL = URL.createObjectURL;
      originalRevokeObjectURL = URL.revokeObjectURL;

      // Mock URL methods directly
      createObjectURLMock = jest.fn().mockReturnValue("blob:mock-url");
      revokeObjectURLMock = jest.fn();
      URL.createObjectURL = createObjectURLMock;
      URL.revokeObjectURL = revokeObjectURLMock;

      // Spy on document.body methods
      appendChildSpy = jest.spyOn(document.body, "appendChild");
      removeChildSpy = jest.spyOn(document.body, "removeChild");
    });

    afterEach(() => {
      // Restore originals
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
      jest.restoreAllMocks();
    });

    it("creates a Blob from string content", () => {
      const content = "test,content,csv";
      triggerDownload(content, "test.csv");

      expect(createObjectURLMock).toHaveBeenCalledTimes(1);
      const blobArg = createObjectURLMock.mock.calls[0][0];
      expect(blobArg).toBeInstanceOf(Blob);
    });

    it("uses provided Blob directly", () => {
      const blob = new Blob(["test content"], { type: "application/zip" });
      triggerDownload(blob, "test.zip");

      expect(createObjectURLMock).toHaveBeenCalledTimes(1);
      const blobArg = createObjectURLMock.mock.calls[0][0];
      expect(blobArg).toBe(blob);
    });

    it("sets download filename on link element", () => {
      triggerDownload("content", "my-file.csv");

      expect(appendChildSpy).toHaveBeenCalledTimes(1);
      const linkElement = appendChildSpy.mock.calls[0][0] as HTMLAnchorElement;
      expect(linkElement.download).toBe("my-file.csv");
    });

    it("triggers click on the link element", () => {
      const clickSpy = jest.fn();
      const originalCreateElement = document.createElement.bind(document);
      jest.spyOn(document, "createElement").mockImplementation((tagName: string) => {
        const element = originalCreateElement(tagName);
        if (tagName === "a") {
          element.click = clickSpy;
        }
        return element;
      });

      triggerDownload("content", "test.csv");

      expect(clickSpy).toHaveBeenCalledTimes(1);
    });

    it("cleans up by removing link and revoking URL", () => {
      triggerDownload("content", "test.csv");

      expect(removeChildSpy).toHaveBeenCalledTimes(1);
      expect(revokeObjectURLMock).toHaveBeenCalledTimes(1);
      expect(revokeObjectURLMock).toHaveBeenCalledWith("blob:mock-url");
    });

    it("uses custom MIME type for string content", () => {
      const content = '{"test": "json"}';
      triggerDownload(content, "test.json", "application/json");

      expect(createObjectURLMock).toHaveBeenCalledTimes(1);
      const blobArg = createObjectURLMock.mock.calls[0][0] as Blob;
      expect(blobArg.type).toBe("application/json");
    });

    it("uses default CSV MIME type when not specified", () => {
      triggerDownload("csv,content", "test.csv");

      expect(createObjectURLMock).toHaveBeenCalledTimes(1);
      const blobArg = createObjectURLMock.mock.calls[0][0] as Blob;
      expect(blobArg.type).toBe("text/csv;charset=utf-8;");
    });
  });

  describe("showToast", () => {
    beforeEach(() => {
      jest.useFakeTimers();
      // Clear any existing toasts
      document.body.innerHTML = "";
    });

    afterEach(() => {
      jest.useRealTimers();
      document.body.innerHTML = "";
    });

    it("creates a toast element with message", () => {
      showToast("Test message");

      const toast = document.querySelector(".toast");
      expect(toast).not.toBeNull();
      expect(toast?.textContent).toBe("Test message");
    });

    it("applies success class by default", () => {
      showToast("Success message");

      const toast = document.querySelector(".toast");
      expect(toast?.classList.contains("success")).toBe(true);
    });

    it("applies error class when specified", () => {
      showToast("Error message", "error");

      const toast = document.querySelector(".toast");
      expect(toast?.classList.contains("error")).toBe(true);
    });

    it("removes toast after default duration (3000ms)", () => {
      showToast("Temporary message");

      expect(document.querySelector(".toast")).not.toBeNull();

      jest.advanceTimersByTime(3000);

      expect(document.querySelector(".toast")).toBeNull();
    });

    it("removes toast after custom duration", () => {
      showToast("Custom duration", "success", 5000);

      expect(document.querySelector(".toast")).not.toBeNull();

      jest.advanceTimersByTime(3000);
      expect(document.querySelector(".toast")).not.toBeNull();

      jest.advanceTimersByTime(2000);
      expect(document.querySelector(".toast")).toBeNull();
    });

    it("can show multiple toasts", () => {
      showToast("First toast");
      showToast("Second toast");

      const toasts = document.querySelectorAll(".toast");
      expect(toasts.length).toBe(2);
    });

    it("removes toasts independently", () => {
      showToast("First toast", "success", 1000);
      showToast("Second toast", "success", 3000);

      expect(document.querySelectorAll(".toast").length).toBe(2);

      jest.advanceTimersByTime(1000);
      expect(document.querySelectorAll(".toast").length).toBe(1);

      jest.advanceTimersByTime(2000);
      expect(document.querySelectorAll(".toast").length).toBe(0);
    });
  });
});
