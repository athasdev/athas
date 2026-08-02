import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";

const themeStyles = readFileSync(new URL("../../../styles/theme.css", import.meta.url), "utf8");
const baseStyles = readFileSync(new URL("../../../styles/base.css", import.meta.url), "utf8");

describe("UI typography contract", () => {
  it("uses the configured UI font size without silently reducing interface text", () => {
    expect(themeStyles).toContain("--ui-text-sm: var(--app-ui-font-size);");
    expect(themeStyles).toContain("--ui-text-base: var(--app-ui-font-size);");
  });

  it("uses the configured UI font size for inherited interface text", () => {
    expect(baseStyles).toMatch(/body\s*\{[^}]*font-size:\s*var\(--ui-text-base\);/s);
  });
});
