import { describe, expect, it } from "vite-plus/test";
import {
  DEFAULT_MONO_FONT_FAMILY,
  DEFAULT_UI_FONT_FAMILY,
} from "@/features/settings/config/typography-defaults";
import {
  getPrimaryFontFamily,
  normalizeConfiguredFontFamily,
  resolveAvailableFontFamily,
} from "./font-family-resolution";

describe("font family resolution", () => {
  it("extracts the primary font family from a stack", () => {
    expect(getPrimaryFontFamily('"Geist Mono", Menlo, monospace')).toBe("Geist Mono");
  });

  it("migrates legacy Geist font names", () => {
    expect(normalizeConfiguredFontFamily("Geist Mono", DEFAULT_MONO_FONT_FAMILY)).toBe(
      DEFAULT_MONO_FONT_FAMILY,
    );
    expect(normalizeConfiguredFontFamily("Geist Sans", DEFAULT_UI_FONT_FAMILY)).toBe(
      DEFAULT_UI_FONT_FAMILY,
    );
  });

  it("falls back when the requested font is unavailable", () => {
    expect(
      resolveAvailableFontFamily(
        '"Missing Mono", Menlo, monospace',
        DEFAULT_MONO_FONT_FAMILY,
        ["menlo", "monaco"],
        [DEFAULT_MONO_FONT_FAMILY],
      ),
    ).toBe(DEFAULT_MONO_FONT_FAMILY);
  });

  it("keeps custom fonts that exist on the system", () => {
    expect(
      resolveAvailableFontFamily("Berkeley Mono", DEFAULT_MONO_FONT_FAMILY, ["berkeley mono"]),
    ).toBe("Berkeley Mono");
  });
});
