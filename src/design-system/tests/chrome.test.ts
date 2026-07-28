import { describe, expect, it } from "vite-plus/test";
import {
  chromeBarVariants,
  chromeGroupVariants,
  chromeLabelVariants,
} from "@/design-system/chrome";

describe("chrome design contracts", () => {
  it("keeps every chrome region on semantic geometry tokens", () => {
    expect(chromeBarVariants({ region: "title" })).toContain("--athas-title-bar-height");
    expect(chromeBarVariants({ region: "footer" })).toContain("--athas-footer-height");
    expect(chromeBarVariants({ region: "tabs" })).toContain("--athas-tab-bar-height");
    expect(chromeBarVariants({ region: "sidebar" })).toContain("--athas-sidebar-header-height");
  });

  it("keeps spacing and hierarchy semantic", () => {
    expect(chromeGroupVariants({ gap: "tight" })).toContain("--athas-chrome-gap-tight");
    expect(chromeLabelVariants({ tone: "strong" })).toContain("text-text");
    expect(chromeLabelVariants({ tone: "muted" })).toContain("text-text-lighter");
  });
});
