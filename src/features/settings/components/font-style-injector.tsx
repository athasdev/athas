import { useEffect } from "react";
import { useEditorSettingsStore } from "@/features/editor/stores/settings-store";
import { useSettingsStore } from "@/features/settings/store";

export const FontStyleInjector = () => {
  const codeEditorFontFamily = useEditorSettingsStore((state) => state.fontFamily);
  const { settings } = useSettingsStore();

  useEffect(() => {
    // Get font families from settings
    const editorFont = settings.fontFamily || codeEditorFontFamily || "JetBrains Mono";
    const uiFont = settings.uiFontFamily || "Space Grotesk";

    // Set CSS variables with fallbacks
    const editorFallbackChain = `"${editorFont}", "JetBrains Mono", monospace`;
    const uiFallbackChain = `"${uiFont}", "Space Grotesk", sans-serif`;

    document.documentElement.style.setProperty("--editor-font-family", editorFallbackChain);
    document.documentElement.style.setProperty("--app-font-family", uiFallbackChain);
  }, [settings.fontFamily, settings.uiFontFamily, codeEditorFontFamily]);

  // Set initial default styles immediately on mount
  useEffect(() => {
    // Ensure we always have a default font set
    const currentAppFont = document.documentElement.style.getPropertyValue("--app-font-family");
    if (!currentAppFont) {
      const editorDefaultChain = `"JetBrains Mono", monospace`;
      const uiDefaultChain = `"Space Grotesk", sans-serif`;
      document.documentElement.style.setProperty("--editor-font-family", editorDefaultChain);
      document.documentElement.style.setProperty("--app-font-family", uiDefaultChain);
    }
  }, []); // Run only once on mount

  return null;
};
