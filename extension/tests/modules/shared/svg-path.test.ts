/**
 * SVG Path Utility Tests
 *
 * Pure function tests for buildLinePath.
 */

import { buildLinePath } from "../../../ui/modules/shared/svg-path";
import type { Point } from "../../../ui/modules/shared/svg-path";

describe("buildLinePath", () => {
  it("returns empty string for empty array", () => {
    expect(buildLinePath([])).toBe("");
  });

  it("returns empty string for single point", () => {
    expect(buildLinePath([{ x: 10, y: 20 }])).toBe("");
  });

  it("builds M/L path for two points", () => {
    const points: Point[] = [
      { x: 0, y: 10 },
      { x: 60, y: 5 },
    ];
    expect(buildLinePath(points)).toBe("M 0.0 10.0 L 60.0 5.0");
  });

  it("builds path with multiple points", () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 5 },
      { x: 20, y: 3 },
      { x: 30, y: 8 },
    ];
    const result = buildLinePath(points);
    expect(result).toBe("M 0.0 0.0 L 10.0 5.0 L 20.0 3.0 L 30.0 8.0");
  });

  it("rounds coordinates to 1 decimal place", () => {
    const points: Point[] = [
      { x: 1.23456, y: 7.89012 },
      { x: 3.45678, y: 9.01234 },
    ];
    const result = buildLinePath(points);
    expect(result).toBe("M 1.2 7.9 L 3.5 9.0");
  });

  it("handles zero coordinates", () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ];
    expect(buildLinePath(points)).toBe("M 0.0 0.0 L 0.0 0.0");
  });

  it("produces no NaN in output", () => {
    const points: Point[] = [
      { x: 10, y: 20 },
      { x: 30, y: 40 },
      { x: 50, y: 60 },
    ];
    const result = buildLinePath(points);
    expect(result).not.toContain("NaN");
  });
});
