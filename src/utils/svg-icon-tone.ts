/**
 * How a catalog icon should be drawn. `monochrome` icons carry no color of their own (they paint
 * with `currentColor`, the default black, or one dark color), so an `<img>` draws them black and
 * they vanish on a dark theme; they are drawn as a mask in the text color instead. `color` icons
 * keep their own artwork.
 */
export type SvgIconTone = "monochrome" | "color";

const COLOR_PATTERN =
  /(?:fill|stroke|stop-color|color)\s*[:=]\s*["']?\s*(#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|currentcolor|none|transparent|black|white)/gi;

/**
 * A single color below this luminance falls short of 3:1 contrast against a dark editor surface,
 * the minimum for a graphic, so it is redrawn in the text color.
 */
const DARK_LUMINANCE = 0.12;

function parseColor(value: string): [number, number, number] | null {
  const color = value.toLowerCase();
  if (color === "black") return [0, 0, 0];
  if (color === "white") return [255, 255, 255];
  if (color.startsWith("#")) {
    let hex = color.slice(1);
    if (hex.length === 3 || hex.length === 4)
      hex = Array.from(hex.slice(0, 3), (digit) => digit + digit).join("");
    if (hex.length !== 6 && hex.length !== 8) return null;
    return [0, 2, 4].map((index) => Number.parseInt(hex.slice(index, index + 2), 16)) as [
      number,
      number,
      number,
    ];
  }
  const rgb = color.match(/rgba?\(([^)]*)\)/);
  if (!rgb) return null;
  const channels = rgb[1]!
    .split(/[\s,/]+/)
    .filter(Boolean)
    .slice(0, 3)
    .map(Number);
  return channels.length === 3 && channels.every(Number.isFinite)
    ? (channels as [number, number, number])
    : null;
}

function relativeLuminance([red, green, blue]: [number, number, number]): number {
  const channel = (value: number) => {
    const normalized = value / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
}

/** Classifies an SVG document by the colors it paints with. */
export function getSvgIconTone(svg: string): SvgIconTone {
  const colors = new Set<string>();
  for (const match of svg.matchAll(COLOR_PATTERN)) {
    const value = match[1]!.toLowerCase().replace(/\s+/g, "");
    if (value === "none" || value === "transparent") continue;
    colors.add(value);
  }

  // No paint at all falls back to black; only `currentColor` adapts to the text color.
  if (colors.size === 0) return "monochrome";
  if (colors.size === 1 && colors.has("currentcolor")) return "monochrome";

  const explicit = [...colors].filter((color) => color !== "currentcolor");
  if (explicit.length !== 1) return "color";

  // One explicit color: redraw it only when it is too dark to read on a dark surface. A bright
  // single-color mark keeps its brand color.
  const rgb = parseColor(explicit[0]!);
  return rgb && relativeLuminance(rgb) < DARK_LUMINANCE ? "monochrome" : "color";
}

/** The SVG text inside a `data:image/svg+xml` URI, or null for anything else. */
export function decodeSvgDataUri(uri: string): string | null {
  const match = uri.match(/^data:image\/svg\+xml(;[^,]*)?,(.*)$/is);
  if (!match) return null;
  const [, parameters = "", payload = ""] = match;
  try {
    return parameters.includes(";base64") ? atob(payload) : decodeURIComponent(payload);
  } catch {
    return null;
  }
}
