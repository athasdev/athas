import type * as Monaco from "monaco-editor";

const MONACO_SCROLLBAR_SIZE = 11;
const MONACO_SCROLLBAR_SLIDER_SIZE = 5;

export function getMonacoScrollbarOptions(
  scrollable: boolean,
): Monaco.editor.IEditorScrollbarOptions {
  return {
    vertical: scrollable ? "auto" : "hidden",
    horizontal: scrollable ? "auto" : "hidden",
    handleMouseWheel: scrollable,
    alwaysConsumeMouseWheel: scrollable,
    useShadows: false,
    verticalScrollbarSize: MONACO_SCROLLBAR_SIZE,
    verticalSliderSize: MONACO_SCROLLBAR_SLIDER_SIZE,
    horizontalScrollbarSize: MONACO_SCROLLBAR_SIZE,
    horizontalSliderSize: MONACO_SCROLLBAR_SLIDER_SIZE,
  };
}

export const monacoCodeCellScrollbarOptions: Monaco.editor.IEditorScrollbarOptions = {
  vertical: "hidden",
  horizontal: "auto",
  alwaysConsumeMouseWheel: false,
  useShadows: false,
  verticalScrollbarSize: MONACO_SCROLLBAR_SIZE,
  verticalSliderSize: MONACO_SCROLLBAR_SLIDER_SIZE,
  horizontalScrollbarSize: MONACO_SCROLLBAR_SIZE,
  horizontalSliderSize: MONACO_SCROLLBAR_SLIDER_SIZE,
};
