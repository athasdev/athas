import { useEffect } from "react";
import { useEditorSettingsStore } from "@/features/editor/stores/settings-store";
import { useSettingsStore } from "@/features/settings/store";
import { currentPlatform, IS_WINDOWS } from "@/utils/platform";

// Cross-platform monospace fallback stack
const DEFAULT_MONO_FALLBACK =
  '"Geist Mono Variable", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

// Windows-optimized monospace fallback stack (WebView2 renders these more consistently)
const WINDOWS_MONO_FALLBACK =
  'Consolas, "Cascadia Mono", "Cascadia Code", "Courier New", "Geist Mono Variable", ui-monospace, monospace';

// Cross-platform sans fallback stack
const DEFAULT_SANS_FALLBACK =
  '"Geist Variable", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

// Windows-optimized sans fallback stack
const WINDOWS_SANS_FALLBACK =
  '"Segoe UI", "Geist Variable", system-ui, -apple-system, BlinkMacSystemFont, Roboto, "Helvetica Neue", Arial, sans-serif';

function stripWrappingQuotes(value: string): string {
  const trimmed = value.trim();
  return trimmed.replace(/^['"]+|['"]+$/g, "");
}

function buildFontVariable(primary: string, fallback: string): string {
  const normalized = stripWrappingQuotes(primary);
  if (!normalized) return fallback;

  // Preserve legacy values that already include a full stack.
  if (normalized.includes(",")) {
    return `${normalized}, ${fallback}`;
  }

  return `"${normalized}", ${fallback}`;
}

/**
 * FontStyleInjector - Updates CSS variables when font settings change
 * Font fallbacks are defined in styles.css @theme directive
 */
export const FontStyleInjector = () => {
  const codeEditorFontFamily = useEditorSettingsStore((state) => state.fontFamily);
  const { settings } = useSettingsStore();

  useEffect(() => {
    document.documentElement.setAttribute("data-platform", currentPlatform);

    const requestedEditorFont =
      stripWrappingQuotes(settings.fontFamily || codeEditorFontFamily || "") ||
      "Geist Mono Variable";
    const requestedUiFont = stripWrappingQuotes(settings.uiFontFamily || "") || "Geist Variable";

    // Prefer mature native fonts on Windows by default if user is still on Geist defaults.
    const effectiveEditorFont =
      IS_WINDOWS && requestedEditorFont === "Geist Mono Variable"
        ? "Consolas"
        : requestedEditorFont;
    const effectiveUiFont =
      IS_WINDOWS && requestedUiFont === "Geist Variable" ? "Segoe UI" : requestedUiFont;

    const monoFallback = IS_WINDOWS ? WINDOWS_MONO_FALLBACK : DEFAULT_MONO_FALLBACK;
    const sansFallback = IS_WINDOWS ? WINDOWS_SANS_FALLBACK : DEFAULT_SANS_FALLBACK;

    document.documentElement.style.setProperty(
      "--editor-font-family",
      buildFontVariable(effectiveEditorFont, monoFallback),
    );
    document.documentElement.style.setProperty(
      "--app-font-family",
      buildFontVariable(effectiveUiFont, sansFallback),
    );
  }, [settings.fontFamily, settings.uiFontFamily, codeEditorFontFamily]);

  return null;
};
