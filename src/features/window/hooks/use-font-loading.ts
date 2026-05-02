import { useEffect } from "react";
import {
  DEFAULT_MONO_FONT_FAMILY,
  DEFAULT_UI_FONT_FAMILY,
} from "@/features/settings/config/typography-defaults";
import { resolveAvailableFontFamily } from "@/features/settings/lib/font-family-resolution";
import { useSettingsStore } from "@/features/settings/store";
import { useFontStore } from "@/features/settings/stores/font-store";

export function useFontLoading() {
  const { loadAvailableFonts } = useFontStore.use.actions();

  useEffect(() => {
    void (async () => {
      await loadAvailableFonts();

      const availableFonts = useFontStore
        .getState()
        .availableFonts.map((font) => font.family.toLowerCase());

      const settingsStore = useSettingsStore.getState();
      const { settings } = settingsStore;
      const updates: Array<Promise<void>> = [];

      const nextEditorFontFamily = resolveAvailableFontFamily(
        settings.fontFamily,
        DEFAULT_MONO_FONT_FAMILY,
        availableFonts,
        [DEFAULT_MONO_FONT_FAMILY],
      );
      if (nextEditorFontFamily !== settings.fontFamily) {
        updates.push(settingsStore.updateSetting("fontFamily", nextEditorFontFamily));
      }

      const nextTerminalFontFamily = resolveAvailableFontFamily(
        settings.terminalFontFamily,
        DEFAULT_MONO_FONT_FAMILY,
        availableFonts,
        [DEFAULT_MONO_FONT_FAMILY],
      );
      if (nextTerminalFontFamily !== settings.terminalFontFamily) {
        updates.push(settingsStore.updateSetting("terminalFontFamily", nextTerminalFontFamily));
      }

      const nextUiFontFamily = resolveAvailableFontFamily(
        settings.uiFontFamily,
        DEFAULT_UI_FONT_FAMILY,
        availableFonts,
        [DEFAULT_UI_FONT_FAMILY],
      );
      if (nextUiFontFamily !== settings.uiFontFamily) {
        updates.push(settingsStore.updateSetting("uiFontFamily", nextUiFontFamily));
      }

      await Promise.all(updates);
    })();
  }, [loadAvailableFonts]);
}
