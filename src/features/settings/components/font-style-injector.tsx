import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { useEditorSettingsStore } from "@/features/editor/stores/settings.store";
import {
  DEFAULT_MONO_FONT_FAMILY,
  DEFAULT_UI_FONT_FAMILY,
  getTypographyFontFallbacks,
} from "@/features/settings/config/typography-defaults";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { currentPlatform, IS_WINDOWS } from "@/utils/platform";
import { buildFontFamilyStack } from "../lib/font-family-resolution";
import { getUiFontScale, normalizeUiFontSize } from "../lib/ui-font-size";

function setRootStyleProperty(name: string, value: string) {
  const rootStyle = document.documentElement.style;
  if (rootStyle.getPropertyValue(name) === value) return;
  rootStyle.setProperty(name, value);
}

export const FontStyleInjector = () => {
  const codeEditorFontFamily = useEditorSettingsStore((state) => state.fontFamily);
  const { fontFamily, uiFontFamily, uiFontSize } = useSettingsStore(
    useShallow((state) => ({
      fontFamily: state.settings.fontFamily,
      uiFontFamily: state.settings.uiFontFamily,
      uiFontSize: state.settings.uiFontSize,
    })),
  );

  useEffect(() => {
    document.documentElement.setAttribute("data-platform", currentPlatform);

    const requestedEditorFont = fontFamily || codeEditorFontFamily || DEFAULT_MONO_FONT_FAMILY;
    const requestedUiFont = uiFontFamily || DEFAULT_UI_FONT_FAMILY;
    const { mono, sans } = getTypographyFontFallbacks(IS_WINDOWS);

    setRootStyleProperty("--editor-font-family", buildFontFamilyStack(requestedEditorFont, mono));
    setRootStyleProperty("--app-font-family", buildFontFamilyStack(requestedUiFont, sans));

    const normalizedUiFontSize = normalizeUiFontSize(uiFontSize);
    setRootStyleProperty("--app-ui-font-size", `${normalizedUiFontSize}px`);
    setRootStyleProperty("--app-ui-scale", `${getUiFontScale(normalizedUiFontSize)}`);
  }, [fontFamily, uiFontFamily, uiFontSize, codeEditorFontFamily]);

  return null;
};
