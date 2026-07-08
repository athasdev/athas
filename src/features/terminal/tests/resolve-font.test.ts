import { describe, expect, it } from "vite-plus/test";
import { buildTerminalFontFamily } from "@/features/terminal/utils/resolve-font";

describe("terminal font resolution", () => {
  it("keeps the configured font first and adds Nerd Font glyph fallbacks", () => {
    const fontFamily = buildTerminalFontFamily("Geist Mono");

    expect(fontFamily.startsWith('"Geist Mono",')).toBe(true);
    expect(fontFamily).toContain('"Symbols Nerd Font Mono"');
    expect(fontFamily).toContain('"MesloLGS NF"');
    expect(fontFamily).toMatch(/,\s*monospace$/);
  });

  it("deduplicates existing fallback lists without quoting CSS generic families", () => {
    const fontFamily = buildTerminalFontFamily('"Geist Mono", "Symbols Nerd Font Mono", monospace');

    expect(fontFamily.match(/"Symbols Nerd Font Mono"/g)).toHaveLength(1);
    expect(fontFamily).toContain('"Geist Mono"');
    expect(fontFamily).toMatch(/,\s*monospace$/);
    expect(fontFamily).not.toContain('"monospace"');
  });
});
