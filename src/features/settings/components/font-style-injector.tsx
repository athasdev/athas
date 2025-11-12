import { useEffect } from "react";
import { useEditorSettingsStore } from "@/features/editor/stores/settings-store";
import { useSettingsStore } from "@/features/settings/store";

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

    // Update CSS variables - fallback chains are in styles.css @theme
    document.documentElement.style.setProperty("--editor-font-family", `"${editorFont}"`);
    document.documentElement.style.setProperty("--app-font-family", `"${uiFont}"`);
  }, [settings.fontFamily, settings.uiFontFamily, codeEditorFontFamily]);

  return null;
};
