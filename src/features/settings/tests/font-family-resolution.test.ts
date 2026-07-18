import { describe, expect, it } from "vite-plus/test";
import {
  DEFAULT_MONO_FONT_FAMILY,
  DEFAULT_UI_FONT_FAMILY,
  getTypographyFontFallbacks,
} from "@/features/settings/config/typography-defaults";
import {
  buildFontFamilyStack,
  getPrimaryFontFamily,
  normalizeConfiguredFontFamily,
  resolveAvailableFontFamily,
} from "../lib/font-family-resolution";

describe("font family resolution", () => {
  it("extracts the primary font family from a stack", () => {
    expect(getPrimaryFontFamily('"Geist Mono", Menlo, monospace')).toBe("Geist Mono");
  });

  it("builds one normalized stack for UI and editor fonts", () => {
    const { mono, sans } = getTypographyFontFallbacks(false);

    expect(buildFontFamilyStack(DEFAULT_MONO_FONT_FAMILY, mono)).toBe(`"Geist Mono", ${mono}`);
    expect(buildFontFamilyStack(`"${DEFAULT_UI_FONT_FAMILY}"`, sans)).toBe(`"Geist Sans", ${sans}`);
  });

  it("preserves configured full font stacks", () => {
    const stack = '"Berkeley Mono", Menlo, monospace';

    expect(buildFontFamilyStack(stack, "ui-monospace, monospace")).toBe(stack);
  });

  it("preserves configured font names that may exist on the system", () => {
    expect(normalizeConfiguredFontFamily("Geist Mono", DEFAULT_MONO_FONT_FAMILY)).toBe(
      "Geist Mono",
    );
    expect(normalizeConfiguredFontFamily("Geist Sans", DEFAULT_UI_FONT_FAMILY)).toBe("Geist Sans");
  });

  it("falls back when the configured font is empty", () => {
    expect(normalizeConfiguredFontFamily("   ", DEFAULT_MONO_FONT_FAMILY)).toBe(
      DEFAULT_MONO_FONT_FAMILY,
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

  it("moves removed bundled font names back to current defaults when unavailable", () => {
    expect(
      resolveAvailableFontFamily(
        "IBM Plex Sans Variable",
        DEFAULT_UI_FONT_FAMILY,
        [],
        [DEFAULT_UI_FONT_FAMILY],
      ),
    ).toBe(DEFAULT_UI_FONT_FAMILY);
    expect(
      resolveAvailableFontFamily(
        "JetBrains Mono Variable",
        DEFAULT_MONO_FONT_FAMILY,
        [],
        [DEFAULT_MONO_FONT_FAMILY],
      ),
    ).toBe(DEFAULT_MONO_FONT_FAMILY);
  });

  it("keeps custom fonts that exist on the system", () => {
    expect(
      resolveAvailableFontFamily("Berkeley Mono", DEFAULT_MONO_FONT_FAMILY, ["berkeley mono"]),
    ).toBe("Berkeley Mono");
  });

  it("keeps Geist Mono when it is available as a system font", () => {
    expect(resolveAvailableFontFamily("Geist Mono", DEFAULT_MONO_FONT_FAMILY, ["geist mono"])).toBe(
      "Geist Mono",
    );
  });
});
