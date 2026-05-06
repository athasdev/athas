import { describe, expect, it } from "vite-plus/test";
import { buildTerminalFontFamily } from "@/features/terminal/utils/resolve-font";

describe("terminal font resolution", () => {
  it("keeps the configured font first and adds Nerd Font glyph fallbacks", () => {
    const fontFamily = buildTerminalFontFamily("JetBrains Mono Variable");

    expect(fontFamily.startsWith('"JetBrains Mono Variable",')).toBe(true);
    expect(fontFamily).toContain('"Symbols Nerd Font Mono"');
    expect(fontFamily).toContain('"MesloLGS NF"');
    expect(fontFamily).toMatch(/,\s*monospace$/);
  });

  it("deduplicates existing fallback lists without quoting CSS generic families", () => {
    const fontFamily = buildTerminalFontFamily(
      '"JetBrains Mono Variable", "Symbols Nerd Font Mono", monospace',
    );

    expect(fontFamily.match(/"Symbols Nerd Font Mono"/g)).toHaveLength(1);
    expect(fontFamily).toContain('"JetBrains Mono Variable"');
    expect(fontFamily).toMatch(/,\s*monospace$/);
    expect(fontFamily).not.toContain('"monospace"');
  });
});
