export const DEFAULT_UI_FONT_FAMILY = "Geist Sans";
export const DEFAULT_MONO_FONT_FAMILY = "Geist Mono";

export const DEFAULT_MONO_FONT_FALLBACK =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';
export const WINDOWS_MONO_FONT_FALLBACK =
  'Consolas, "Cascadia Mono", "Cascadia Code", "Courier New", ui-monospace, monospace';
export const DEFAULT_SANS_FONT_FALLBACK =
  'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
export const WINDOWS_SANS_FONT_FALLBACK =
  '"Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, Roboto, "Helvetica Neue", Arial, sans-serif';

export const DEFAULT_CODE_FONT_SIZE = 14;
export const DEFAULT_UI_FONT_SIZE_OFFSET = 1;
export const DEFAULT_UI_FONT_SIZE = DEFAULT_CODE_FONT_SIZE + DEFAULT_UI_FONT_SIZE_OFFSET;
export const DEFAULT_TERMINAL_FONT_SIZE = DEFAULT_CODE_FONT_SIZE;

export function getTypographyFontFallbacks(isWindows: boolean) {
  return {
    mono: isWindows ? WINDOWS_MONO_FONT_FALLBACK : DEFAULT_MONO_FONT_FALLBACK,
    sans: isWindows ? WINDOWS_SANS_FONT_FALLBACK : DEFAULT_SANS_FONT_FALLBACK,
  };
}
