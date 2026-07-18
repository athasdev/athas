import { describe, expect, it } from "vite-plus/test";
import {
  filterRetiredExtensions,
  isRetiredExtensionId,
} from "@/extensions/registry/retired-extensions";

describe("retired extensions", () => {
  it("retires the marketplace Athas theme pack", () => {
    expect(isRetiredExtensionId("athas.theme.market")).toBe(true);
    expect(isRetiredExtensionId("athas.theme.vercel")).toBe(false);
  });

  it("filters retired extensions from marketplace and installed extension lists", () => {
    expect(
      filterRetiredExtensions([
        { id: "athas.theme.market", name: "Athas Theme Pack" },
        { id: "athas.theme.vercel", name: "Vercel Theme" },
      ]),
    ).toEqual([{ id: "athas.theme.vercel", name: "Vercel Theme" }]);
  });
});
