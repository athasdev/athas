import { getTypographyFontFallbacks } from "@/features/settings/config/typography-defaults";
import { useEffectiveTheme } from "@/features/settings/hooks/use-effective-theme";
import { buildFontFamilyStack } from "@/features/settings/services/font-family-resolution";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useZoomStore } from "@/features/layout/stores/zoom.store";
import { IS_WINDOWS } from "@/utils/platform";
import { useShallow } from "zustand/react/shallow";
import { calculateLineHeight } from "../services/lines";
import {
  resolveEditorSettings,
  useEditorSettingOverridesStore,
} from "../stores/editor-setting-overrides.store";

/** The editor's visual settings, resolved for whichever engine draws the text. */
export function useEditorViewSettings() {
  const themeId = useEffectiveTheme();
  const overrides = useEditorSettingOverridesStore.use.overrides();
  const settingsSource = useSettingsStore(
    useShallow((state) => ({
      fontSize: state.settings.fontSize,
      editorLineHeight: state.settings.editorLineHeight,
      tabSize: state.settings.tabSize,
      lineNumbers: state.settings.lineNumbers,
      wordWrap: state.settings.wordWrap,
      horizontalTabScroll: state.settings.horizontalTabScroll,
      renderWhitespace: state.settings.renderWhitespace,
      renderIndentGuides: state.settings.renderIndentGuides,
    })),
  );
  const {
    fontSize: baseFontSize,
    lineHeight: lineHeightSetting,
    tabSize,
    lineNumbers,
    wordWrap,
    renderWhitespace,
    renderIndentGuides,
  } = resolveEditorSettings(settingsSource, overrides);
  const {
    fontFamily: fontFamilySetting,
    highlightOccurrences,
    editorFontLigatures,
    editorItalicComments,
    editorStickyScroll,
    editorBracketPairColorization,
    editorSmoothScrolling,
    editorScrollBeyondLastLine,
    editorCursorStyle,
    editorCursorBlinking,
  } = useSettingsStore(
    useShallow((state) => ({
      fontFamily: state.settings.fontFamily,
      highlightOccurrences: state.settings.highlightOccurrences,
      editorFontLigatures: state.settings.editorFontLigatures,
      editorItalicComments: state.settings.editorItalicComments,
      editorStickyScroll: state.settings.editorStickyScroll,
      editorBracketPairColorization: state.settings.editorBracketPairColorization,
      editorSmoothScrolling: state.settings.editorSmoothScrolling,
      editorScrollBeyondLastLine: state.settings.editorScrollBeyondLastLine,
      editorCursorStyle: state.settings.editorCursorStyle,
      editorCursorBlinking: state.settings.editorCursorBlinking,
    })),
  );
  const zoomLevel = useZoomStore.use.editorZoomLevel();
  const fontSize = baseFontSize * zoomLevel;
  const fontFamily = buildFontFamilyStack(
    fontFamilySetting,
    getTypographyFontFallbacks(IS_WINDOWS).mono,
  );

  return {
    fontFamily,
    fontSize,
    lineHeight: calculateLineHeight(fontSize, lineHeightSetting),
    tabSize,
    wordWrap,
    lineNumbers,
    renderWhitespace,
    renderIndentGuides,
    highlightOccurrences,
    editorFontLigatures,
    editorItalicComments,
    editorStickyScroll,
    editorBracketPairColorization,
    editorSmoothScrolling,
    editorScrollBeyondLastLine,
    editorCursorStyle,
    editorCursorBlinking,
    themeId,
  };
}
