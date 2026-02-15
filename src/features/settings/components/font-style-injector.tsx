import { useEffect } from "react";
import { useEditorSettingsStore } from "@/features/editor/stores/settings-store";
import { useSettingsStore } from "@/features/settings/store";

// Geist + system monospace font stack for cross-platform compatibility
const SYSTEM_MONO_FALLBACK =
  '"Geist Mono Variable", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

// Geist + system sans font stack for UI
const SYSTEM_SANS_FALLBACK =
  '"Geist Variable", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/**
 * FontStyleInjector - Updates CSS variables when font settings change
 * Font fallbacks are defined in styles.css @theme directive
 */
export const FontStyleInjector = () => {
  const codeEditorFontFamily = useEditorSettingsStore((state) => state.fontFamily);
  const { settings } = useSettingsStore();

  useEffect(() => {
    // Get font families from settings (use Geist as default)
    const editorFont = settings.fontFamily || codeEditorFontFamily || "Geist Mono Variable";
    const uiFont = settings.uiFontFamily || "Geist Variable";

    // Update CSS variables with appropriate fallback chains
    document.documentElement.style.setProperty(
      "--editor-font-family",
      `"${editorFont}", ${SYSTEM_MONO_FALLBACK}`,
    );
    document.documentElement.style.setProperty(
      "--app-font-family",
      `"${uiFont}", ${SYSTEM_SANS_FALLBACK}`,
    );
  }, [settings.fontFamily, settings.uiFontFamily, codeEditorFontFamily]);

  return null;
};
