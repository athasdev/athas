import { useEffect } from "react";
import { useSettingsStore } from "@/settings/stores/settings-store";
import { useEditorSettingsStore } from "@/stores/editor-settings-store";

export const FontStyleInjector = () => {
  const codeEditorFontFamily = useEditorSettingsStore((state) => state.fontFamily);
  const { settings } = useSettingsStore();

  useEffect(() => {
    // Priority: Settings store → Code editor store → JetBrains Mono default
    const fontFamily = settings.fontFamily || codeEditorFontFamily || "JetBrains Mono";

    // Set CSS variables for both editor and app-wide font with simple fallbacks
    const fallbackChain = `"${fontFamily}", "JetBrains Mono", monospace`;
    document.documentElement.style.setProperty("--editor-font-family", fallbackChain);
    document.documentElement.style.setProperty("--app-font-family", fallbackChain);
  }, [settings.fontFamily, codeEditorFontFamily]);

  // Set initial default styles immediately on mount
  useEffect(() => {
    // Ensure we always have a default font set
    const currentAppFont = document.documentElement.style.getPropertyValue("--app-font-family");
    if (!currentAppFont) {
      const defaultChain = `"JetBrains Mono", monospace`;
      document.documentElement.style.setProperty("--editor-font-family", defaultChain);
      document.documentElement.style.setProperty("--app-font-family", defaultChain);
    }
  }, []); // Run only once on mount

  return null;
};
