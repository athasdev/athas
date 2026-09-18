import { describe, expect, it } from "vitest";
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

interface BuiltinTheme {
  name: string;
  colors: Record<string, string>;
}

const builtinThemes = [
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
].flatMap((file) => file.themes as BuiltinTheme[]);

type Rgb = [number, number, number];

function parseColor(color: string, backdrop?: Rgb): Rgb {
  const value = color.trim();
  const shortHex = /^#([0-9a-f]{3})$/i.exec(value);
  if (shortHex) {
    return [...shortHex[1]].map((channel) => Number.parseInt(channel + channel, 16)) as Rgb;
  }
  const hex = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(value);
  if (hex) {
    const rgb = [0, 2, 4].map((index) =>
      Number.parseInt(hex[1].slice(index, index + 2), 16),
    ) as Rgb;
    const alpha = hex[2] ? Number.parseInt(hex[2], 16) / 255 : 1;
    return blend(rgb, alpha, backdrop);
  }
  const rgba = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\s*\)$/i.exec(
    value,
  );
  if (!rgba) throw new Error(`Unsupported color: ${color}`);
  return blend([+rgba[1], +rgba[2], +rgba[3]], rgba[4] === undefined ? 1 : +rgba[4], backdrop);
}

function blend(color: Rgb, alpha: number, backdrop: Rgb = [0, 0, 0]): Rgb {
  return color.map((channel, index) => channel * alpha + backdrop[index] * (1 - alpha)) as Rgb;
}

function relativeLuminance(color: Rgb) {
  const [red, green, blue] = color.map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

/** Contrast of `foreground` over `background`; a translucent foreground is composited first. */
function contrastRatio(foreground: string, background: string) {
  const backdrop = parseColor(background);
  const firstLuminance = relativeLuminance(parseColor(foreground, backdrop));
  const secondLuminance = relativeLuminance(backdrop);
  return (
    (Math.max(firstLuminance, secondLuminance) + 0.05) /
    (Math.min(firstLuminance, secondLuminance) + 0.05)
  );
}

describe("Athas theme contrast", () => {
  it.each(athasThemeFile.themes)("keeps $name text colors above WCAG AA", (theme) => {
    const foregrounds = [
      "foreground",
      "muted-foreground",
      "subtle-foreground",
      "primary",
      "destructive",
      "success",
      "warning",
      "info",
    ] as const;
    const surfaces = ["background", "surface", "accent"] as const;

    for (const foreground of foregrounds) {
      for (const surface of surfaces) {
        expect(
          contrastRatio(theme.colors[foreground], theme.colors[surface]),
          `${foreground} on ${surface}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }

    for (const foreground of ["foreground", "muted-foreground", "subtle-foreground", "primary"]) {
      expect(
        contrastRatio(theme.colors[foreground as keyof typeof theme.colors], theme.colors.selected),
        `${foreground} on selected`,
      ).toBeGreaterThanOrEqual(4.5);
    }

    expect(contrastRatio(theme.colors.background, theme.colors.primary)).toBeGreaterThanOrEqual(
      4.5,
    );
  });

  it.each(athasThemeFile.themes)("keeps $name interaction planes perceptible", (theme) => {
    const { background, surface, accent, selected, border } = theme.colors;
    expect(contrastRatio(accent, background)).toBeGreaterThanOrEqual(1.12);
    expect(contrastRatio(accent, surface)).toBeGreaterThanOrEqual(1.1);
    expect(contrastRatio(selected, background)).toBeGreaterThanOrEqual(1.25);
    expect(contrastRatio(selected, accent)).toBeGreaterThanOrEqual(1.08);
    expect(contrastRatio(border, background)).toBeGreaterThanOrEqual(1.25);
  });
});

describe("builtin theme contrast", () => {
  it.each(builtinThemes)("keeps $name secondary text readable", (theme) => {
    const { background, surface } = theme.colors;
    const readable = Math.min(4.5, contrastRatio(theme.colors.foreground, background) - 0.05);

    for (const key of ["muted-foreground", "subtle-foreground"]) {
      expect(
        contrastRatio(theme.colors[key], background),
        `${key} on background`,
      ).toBeGreaterThanOrEqual(readable);
      expect(contrastRatio(theme.colors[key], surface), `${key} on surface`).toBeGreaterThanOrEqual(
        readable - 0.7,
      );
    }
  });

  it.each(builtinThemes)("keeps $name interaction planes perceptible", (theme) => {
    const { background, surface, accent, selected, border } = theme.colors;
    expect(contrastRatio(accent, background), "accent on background").toBeGreaterThanOrEqual(1.1);
    expect(contrastRatio(accent, surface), "accent on surface").toBeGreaterThanOrEqual(1.1);
    expect(contrastRatio(selected, background), "selected on background").toBeGreaterThanOrEqual(
      1.2,
    );
    expect(contrastRatio(border, background), "border on background").toBeGreaterThanOrEqual(1.25);
  });
});
