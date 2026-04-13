/**
 * SVG path generation utilities.
 *
 * Pure functions that convert coordinate arrays into SVG path strings.
 * Coordinate scaling remains the caller's responsibility — these utilities
 * only handle the M/L path join, which is duplicated across sparklines,
 * throughput trend lines, and cycle-time trend charts.
 */

export interface Point {
  x: number;
  y: number;
}

/**
 * Build an SVG line path string from an array of points.
 * First point uses M (moveto), subsequent points use L (lineto).
 * Coordinates are rounded to 1 decimal place.
 *
 * Returns empty string for fewer than 2 points.
 */
export function buildLinePath(points: Point[]): string {
  if (points.length < 2) return "";
  return points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");
}
