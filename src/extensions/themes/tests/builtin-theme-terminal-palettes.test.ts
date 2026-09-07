import { describe, expect, it } from "vite-plus/test";
import athasThemeFile from "@/extensions/themes/builtin/athas.json";
import ayuThemeFile from "@/extensions/themes/builtin/ayu.json";
import catppuccinThemeFile from "@/extensions/themes/builtin/catppuccin.json";
import christmasThemeFile from "@/extensions/themes/builtin/christmas.json";
import contrastThemeFile from "@/extensions/themes/builtin/contrast-themes.json";
import draculaThemeFile from "@/extensions/themes/builtin/dracula.json";
import githubThemeFile from "@/extensions/themes/builtin/github.json";
import nordThemeFile from "@/extensions/themes/builtin/nord.json";
import oneThemeFile from "@/extensions/themes/builtin/one.json";
import solarizedThemeFile from "@/extensions/themes/builtin/solarized.json";
import tokyoNightThemeFile from "@/extensions/themes/builtin/tokyo-night.json";
import vitesseThemeFile from "@/extensions/themes/builtin/vitesse.json";

const TERMINAL_COLOR_KEYS = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "bright-black",
  "bright-red",
  "bright-green",
  "bright-yellow",
  "bright-blue",
  "bright-magenta",
  "bright-cyan",
  "bright-white",
] as const;

const VISIBLE_COLOR_KEYS = TERMINAL_COLOR_KEYS.filter(
  (key) => key !== "black" && key !== "bright-black",
);

const builtinThemes = [
  athasThemeFile,
  ayuThemeFile,
  catppuccinThemeFile,
  christmasThemeFile,
  contrastThemeFile,
  draculaThemeFile,
  githubThemeFile,
  nordThemeFile,
  oneThemeFile,
  solarizedThemeFile,
  tokyoNightThemeFile,
  vitesseThemeFile,
].flatMap((file) => file.themes as Array<{ name: string; colors: Record<string, string> }>);

function relativeLuminance(hex: string) {
  const channels = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255);
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

function contrastRatio(first: string, second: string) {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  return (
    (Math.max(firstLuminance, secondLuminance) + 0.05) /
    (Math.min(firstLuminance, secondLuminance) + 0.05)
  );
}

describe("builtin theme terminal palettes", () => {
  it.each(builtinThemes)("$name defines a full hex ANSI palette", (theme) => {
    for (const key of TERMINAL_COLOR_KEYS) {
      expect(theme.colors[`terminal-${key}`], key).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it.each(builtinThemes)("$name keeps ANSI text legible on the background", (theme) => {
    const background = theme.colors.background.slice(0, 7);
    for (const key of VISIBLE_COLOR_KEYS) {
      expect(
        contrastRatio(theme.colors[`terminal-${key}`], background),
        `${key} on background`,
      ).toBeGreaterThanOrEqual(2.5);
    }
  });
});
