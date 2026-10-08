import { getTypographyFontFallbacks } from "@/features/settings/config/typography-defaults";
import { useEffectiveTheme } from "@/features/settings/hooks/use-effective-theme";
import { isEditorWordWrapEnabled } from "@/features/settings/services/editor-word-wrap";
import { buildFontFamilyStack } from "@/features/settings/services/font-family-resolution";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useZoomStore } from "@/features/layout/stores/zoom.store";
import { IS_WINDOWS } from "@/utils/platform";
import { useShallow } from "zustand/react/shallow";
import { calculateLineHeight } from "../services/lines";

/** The editor's visual settings, resolved for whichever engine draws the text. */
export function useEditorViewSettings() {
  const themeId = useEffectiveTheme();
  const wordWrap = useSettingsStore((state) => isEditorWordWrapEnabled(state.settings));
  const {
    fontSize: baseFontSize,
    fontFamily: fontFamilySetting,
    editorLineHeight,
    tabSize,
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
  } = useSettingsStore(
    useShallow((state) => ({
      fontSize: state.settings.fontSize,
      fontFamily: state.settings.fontFamily,
      editorLineHeight: state.settings.editorLineHeight,
      tabSize: state.settings.tabSize,
      lineNumbers: state.settings.lineNumbers,
      renderWhitespace: state.settings.renderWhitespace,
      renderIndentGuides: state.settings.renderIndentGuides,
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
    lineHeight: calculateLineHeight(fontSize, editorLineHeight),
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
