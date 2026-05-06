import { TERMINAL_NERD_FONT_FALLBACKS } from "./terminal-fonts";

const WINDOWS_FALLBACK = "Consolas";
const MAC_FALLBACK = "Menlo";
const LINUX_FALLBACK = '"Liberation Mono"';
const CSS_GENERIC_FONT_FAMILIES = new Set([
  "cursive",
  "emoji",
  "fangsong",
  "fantasy",
  "math",
  "monospace",
  "sans-serif",
  "serif",
  "system-ui",
  "ui-monospace",
  "ui-rounded",
  "ui-sans-serif",
  "ui-serif",
]);

function getPlatform(): "windows" | "mac" | "linux" {
  if (typeof navigator === "undefined") return "linux";
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return "windows";
  if (/Mac/i.test(ua)) return "mac";
  return "linux";
}

function getPlatformFallback(): string {
  const platform = getPlatform();
  if (platform === "windows") return WINDOWS_FALLBACK;
  if (platform === "mac") return MAC_FALLBACK;
  return LINUX_FALLBACK;
}

function stripWrappingQuotes(name: string): string {
  return name.trim().replace(/^['"]+|['"]+$/g, "");
}

function quoteFontName(name: string): string {
  const normalized = stripWrappingQuotes(name);
  if (!normalized) return "";
  if (CSS_GENERIC_FONT_FAMILIES.has(normalized.toLowerCase())) return normalized;
  return `"${normalized.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function splitFontFamilyList(fontFamily: string): string[] {
  const families: string[] = [];
  let current = "";
  let quote: string | null = null;

  for (const char of fontFamily) {
    if ((char === '"' || char === "'") && !quote) {
      quote = char;
      current += char;
      continue;
    }

    if (char === quote) {
      quote = null;
      current += char;
      continue;
    }

    if (char === "," && !quote) {
      const family = stripWrappingQuotes(current);
      if (family) families.push(family);
      current = "";
      continue;
    }

    current += char;
  }

  const family = stripWrappingQuotes(current);
  if (family) families.push(family);
  return families;
}

function uniqueFontFamilies(families: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const family of families) {
    const normalized = stripWrappingQuotes(family);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }

  return result;
}

/**
 * Build the terminal font-family string with platform-aware fallbacks.
 *
 * xterm.js measures character width from the *first* font it can resolve,
 * so the order matters: primary -> Nerd Font glyph fallbacks -> platform native -> generic monospace.
 */
export function buildTerminalFontFamily(primaryFont: string): string {
  const requestedFonts = splitFontFamilyList(primaryFont);
  const concreteRequestedFonts = requestedFonts.filter(
    (font) => !CSS_GENERIC_FONT_FAMILIES.has(stripWrappingQuotes(font).toLowerCase()),
  );
  const platformFallback = getPlatformFallback();
  return uniqueFontFamilies([
    ...concreteRequestedFonts,
    ...TERMINAL_NERD_FONT_FALLBACKS,
    platformFallback,
    "monospace",
  ])
    .map(quoteFontName)
    .filter(Boolean)
    .join(", ");
}

/**
 * Load a font and verify it's available for canvas rendering.
 * Returns `true` if the font is ready, `false` if it failed/timed out.
 */
export async function loadAndVerifyFont(fontFamily: string, fontSize: number): Promise<boolean> {
  const testString = `${fontSize}px "${fontFamily}"`;

  try {
    await document.fonts.load(testString);
  } catch {
    return false;
  }

  // `check()` returns true only if every glyph in the test string can be
  // rendered with the requested font (i.e. the font actually loaded).
  return document.fonts.check(testString);
}

/**
 * Resolve the terminal font family — attempts to load the requested font,
 * verifies it, and falls back to a platform-native monospace font if needed.
 *
 * Always returns a usable CSS font-family string for xterm.js.
 */
export async function resolveTerminalFont(
  requestedFont: string,
  fontSize: number,
): Promise<{ fontFamily: string; skipWebGL: boolean }> {
  const loaded = await loadAndVerifyFont(requestedFont, fontSize);

  if (loaded) {
    return {
      fontFamily: buildTerminalFontFamily(requestedFont),
      // Variable/space-containing fonts have WebGL texture atlas issues
      skipWebGL: requestedFont.includes(" "),
    };
  }

  // Font didn't load — use platform native monospace
  const fallback = getPlatformFallback();
  return {
    fontFamily: buildTerminalFontFamily(fallback),
    skipWebGL: false,
  };
}
