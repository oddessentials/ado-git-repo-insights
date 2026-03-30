import * as path from "path";
import { readTextFile } from "./helpers/fs-test-utils";

describe("settings host resize behavior", () => {
  let settingsCode: string;

  beforeAll(() => {
    const settingsPath = path.join(__dirname, "../ui/settings.ts");
    settingsCode = readTextFile(settingsPath);
  });

  it("adds a host resize sync initializer for dynamic settings content", () => {
    expect(settingsCode).toContain("function initializeHostResizeSync(): void");
    expect(settingsCode).toContain("new ResizeObserver");
    expect(settingsCode).toContain(
      'window.addEventListener("resize", scheduleHostResize)',
    );
  });

  it("schedules host resize after status panel rerenders", () => {
    expect(settingsCode).toMatch(
      /renderTrustedHtml\(statusDisplay, html\);\s+scheduleHostResize\(\);/s,
    );
  });

  it("initializes host resize sync during page startup", () => {
    expect(settingsCode).toContain("initializeHostResizeSync();");
  });
});
