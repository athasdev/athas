import { useZoomStore } from "@/features/window/stores/zoom.store";
import { useEditorSettingsStore } from "../../stores/settings.store";
import { calculateLineHeight } from "../../utils/lines";

export function useMonacoEditorSettings() {
  const baseFontSize = useEditorSettingsStore.use.fontSize();
  const fontFamily = useEditorSettingsStore.use.fontFamily();
  const editorLineHeight = useEditorSettingsStore.use.lineHeight();
  const tabSize = useEditorSettingsStore.use.tabSize();
  const wordWrap = useEditorSettingsStore.use.wordWrap();
  const lineNumbers = useEditorSettingsStore.use.lineNumbers();
  const renderWhitespace = useEditorSettingsStore.use.renderWhitespace();
  const renderIndentGuides = useEditorSettingsStore.use.renderIndentGuides();
  const highlightOccurrences = useEditorSettingsStore.use.highlightOccurrences();
  const themeId = useEditorSettingsStore.use.theme();
  const zoomLevel = useZoomStore.use.editorZoomLevel();
  const fontSize = baseFontSize * zoomLevel;

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
    themeId,
  };
}
