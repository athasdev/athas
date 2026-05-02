import { useEffect } from "react";
import { useEditorSettingsStore } from "@/features/editor/stores/settings-store";
import {
  DEFAULT_MONO_FONT_FAMILY,
  DEFAULT_UI_FONT_FAMILY,
} from "@/features/settings/config/typography-defaults";
import { useSettingsStore } from "@/features/settings/store";
import { currentPlatform, IS_WINDOWS } from "@/utils/platform";
import { getUiFontScale, normalizeUiFontSize } from "../lib/ui-font-size";

// Cross-platform monospace fallback stack
const DEFAULT_MONO_FALLBACK =
  '"JetBrains Mono Variable", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

// Windows-optimized monospace fallback stack (WebView2 renders these more consistently)
const WINDOWS_MONO_FALLBACK =
  '"JetBrains Mono Variable", Consolas, "Cascadia Mono", "Cascadia Code", "Courier New", ui-monospace, monospace';

// Cross-platform sans fallback stack
const DEFAULT_SANS_FALLBACK =
  '"IBM Plex Sans Variable", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

// Windows-optimized sans fallback stack
const WINDOWS_SANS_FALLBACK =
  '"IBM Plex Sans Variable", "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, Roboto, "Helvetica Neue", Arial, sans-serif';

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
      DEFAULT_MONO_FONT_FAMILY;
    const requestedUiFont =
      stripWrappingQuotes(settings.uiFontFamily || "") || DEFAULT_UI_FONT_FAMILY;

    const monoFallback = IS_WINDOWS ? WINDOWS_MONO_FALLBACK : DEFAULT_MONO_FALLBACK;
    const sansFallback = IS_WINDOWS ? WINDOWS_SANS_FALLBACK : DEFAULT_SANS_FALLBACK;

    document.documentElement.style.setProperty(
      "--editor-font-family",
      buildFontVariable(requestedEditorFont, monoFallback),
    );
    document.documentElement.style.setProperty(
      "--app-font-family",
      buildFontVariable(requestedUiFont, sansFallback),
    );

    const normalizedUiFontSize = normalizeUiFontSize(settings.uiFontSize);
    document.documentElement.style.setProperty("--app-ui-font-size", `${normalizedUiFontSize}px`);
    document.documentElement.style.setProperty(
      "--app-ui-scale",
      `${getUiFontScale(normalizedUiFontSize)}`,
    );
  }, [settings.fontFamily, settings.uiFontFamily, settings.uiFontSize, codeEditorFontFamily]);

  return null;
};
