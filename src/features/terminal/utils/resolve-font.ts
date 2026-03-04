const WINDOWS_FALLBACK = "Consolas";
const MAC_FALLBACK = "Menlo";
const LINUX_FALLBACK = '"Liberation Mono"';

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

function quoteFontName(name: string): string {
  return name.includes(" ") ? `"${name}"` : name;
}

/**
 * Build the terminal font-family string with platform-aware fallbacks.
 *
 * xterm.js measures character width from the *first* font it can resolve,
 * so the order matters: primary -> platform native -> generic monospace.
 */
export function buildTerminalFontFamily(primaryFont: string): string {
  const quoted = quoteFontName(primaryFont);
  const platformFallback = getPlatformFallback();
  return `${quoted}, ${platformFallback}, monospace`;
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
    fontFamily: `${fallback}, monospace`,
    skipWebGL: false,
  };
}
