import { describe, expect, it } from "vite-plus/test";
import { getBundledContributionExtensions } from "@/extensions/bundled/bundled-contribution-extensions";

describe("bundled contribution extensions", () => {
  it("includes Vercel as an installable bundled theme extension", () => {
    const manifest = getBundledContributionExtensions().find(
      (extension) => extension.id === "athas.theme.vercel",
    );

    expect(manifest).toBeDefined();
    expect(manifest?.installation?.type).toBe("bundled");
    expect(manifest?.categories).toContain("Theme");
    expect(manifest?.themes?.map((theme) => theme.id)).toEqual(["vercel-light", "vercel-dark"]);
  });
});
