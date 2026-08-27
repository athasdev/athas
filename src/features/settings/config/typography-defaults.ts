export const DEFAULT_UI_FONT_FAMILY = "system-ui";
export const DEFAULT_MONO_FONT_FAMILY = "Geist Mono";

const DEFAULT_MONO_FONT_FALLBACK =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';
const WINDOWS_MONO_FONT_FALLBACK =
  'Consolas, "Cascadia Mono", "Cascadia Code", "Courier New", ui-monospace, monospace';
const DEFAULT_SANS_FONT_FALLBACK =
  'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const WINDOWS_SANS_FONT_FALLBACK =
  '"Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, Roboto, "Helvetica Neue", Arial, sans-serif';

export const DEFAULT_CODE_FONT_SIZE = 14;
export const DEFAULT_UI_FONT_SIZE = 13;
export const UI_FONT_SCALE_BASE_SIZE = DEFAULT_UI_FONT_SIZE;

export function getTypographyFontFallbacks(isWindows: boolean) {
  return {
    mono: isWindows ? WINDOWS_MONO_FONT_FALLBACK : DEFAULT_MONO_FONT_FALLBACK,
    sans: isWindows ? WINDOWS_SANS_FONT_FALLBACK : DEFAULT_SANS_FONT_FALLBACK,
  };
}
