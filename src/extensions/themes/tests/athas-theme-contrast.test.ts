import { describe, expect, it } from "vitest";
import athasThemeFile from "@/extensions/themes/builtin/athas.json";

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

describe("Athas theme contrast", () => {
  it.each(athasThemeFile.themes)("keeps $name text colors above WCAG AA", (theme) => {
    const foregrounds = ["foreground", "muted-foreground", "subtle-foreground", "primary"] as const;
    const surfaces = ["background", "surface", "accent", "selected"] as const;

    for (const foreground of foregrounds) {
      for (const surface of surfaces) {
        expect(
          contrastRatio(theme.colors[foreground], theme.colors[surface]),
          `${foreground} on ${surface}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
