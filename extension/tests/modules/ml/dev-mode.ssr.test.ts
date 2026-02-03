/**
 * @jest-environment node
 */

import {
  canShowSyntheticData,
  getCurrentHostname,
  isLocalDevelopment,
  isProductionEnvironment,
} from "../../../ui/modules/ml/dev-mode";

describe("dev-mode (SSR compatibility)", () => {
  it("returns safe defaults when window is undefined", () => {
    expect(isProductionEnvironment()).toBe(false);
    expect(isLocalDevelopment()).toBe(false);
    expect(getCurrentHostname()).toBe("");
    expect(canShowSyntheticData(true)).toBe(true);
  });
});
