import { useEffect } from "react";
import { useEditorSettingsStore } from "@/features/editor/stores/settings-store";
import { useSettingsStore } from "@/features/settings/store";

// System monospace font stack for cross-platform compatibility
const SYSTEM_MONO_FALLBACK =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

/**
 * FontStyleInjector - Updates CSS variables when font settings change
 * Font fallbacks are defined in styles.css @theme directive
 */
export const FontStyleInjector = () => {
  const codeEditorFontFamily = useEditorSettingsStore((state) => state.fontFamily);
  const { settings } = useSettingsStore();

  useEffect(() => {
    // Get font families from settings (use @theme defaults if not set)
    const editorFont = settings.fontFamily || codeEditorFontFamily || "JetBrains Mono";
    const uiFont = settings.uiFontFamily || "JetBrains Mono";

    // Update CSS variables with system mono fallback chain
    document.documentElement.style.setProperty(
      "--editor-font-family",
      `"${editorFont}", ${SYSTEM_MONO_FALLBACK}`,
    );
    document.documentElement.style.setProperty(
      "--app-font-family",
      `"${uiFont}", ${SYSTEM_MONO_FALLBACK}`,
    );
  }, [settings.fontFamily, settings.uiFontFamily, codeEditorFontFamily]);

  return null;
};
