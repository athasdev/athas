import { describe, expect, it } from "vite-plus/test";
import type { Theme } from "./theme-schema";
import { mergeCustomThemes } from "./custom-theme-store";

function theme(id: string, name = id): Theme {
  return {
    id,
    name,
    appearance: "dark",
    colors: {},
  };
}

describe("custom theme storage", () => {
  it("adds new variants without discarding existing custom themes", () => {
    expect(mergeCustomThemes([theme("first")], [theme("second")]).map(({ id }) => id)).toEqual([
      "first",
      "second",
    ]);
  });

  it("replaces an imported theme with the same ID", () => {
    const merged = mergeCustomThemes([theme("forest", "Old")], [theme("forest", "Updated")]);

    expect(merged).toHaveLength(1);
    expect(merged[0].name).toBe("Updated");
  });
});
