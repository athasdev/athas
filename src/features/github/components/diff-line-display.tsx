import { memo } from "react";
import { useEditorSettingsStore } from "@/features/editor/stores/settings.store";
import type { HighlightToken } from "@/features/editor/types/wasm-parser/wasm-parser.types";
import { calculateLineHeight } from "@/features/editor/utils/lines";
import { useZoomStore } from "@/features/window/stores/zoom.store";
import { cn } from "@/utils/cn";
import { renderTokenizedContent } from "../utils/github-pr-viewer-utils";

interface DiffLineDisplayProps {
  line: string;
  index: number;
  tokens?: HighlightToken[];
}

export const DiffLineDisplay = memo(({ line, index, tokens }: DiffLineDisplayProps) => {
  const editorFontSize = useEditorSettingsStore.use.fontSize();
  const editorFontFamily = useEditorSettingsStore.use.fontFamily();
  const editorLineHeight = useEditorSettingsStore.use.lineHeight();
  const editorTabSize = useEditorSettingsStore.use.tabSize();
  const zoomLevel = useZoomStore.use.editorZoomLevel();
  const fontSize = editorFontSize * zoomLevel;
  const lineHeight = calculateLineHeight(fontSize, editorLineHeight);
  let bgClass = "";
  let textClass = "text-text";
  let content = line;

  if (line.startsWith("@@")) {
    bgClass = "bg-blue-500/10";
    textClass = "text-blue-400";
  } else if (line.startsWith("+")) {
    bgClass = "bg-git-added/10";
    textClass = tokens && tokens.length > 0 ? "text-text" : "text-git-added";
    content = line.slice(1);
  } else if (line.startsWith("-")) {
    bgClass = "bg-git-deleted/10";
    textClass = tokens && tokens.length > 0 ? "text-text" : "text-git-deleted";
    content = line.slice(1);
  }

  const renderContent = () => {
    if (tokens && tokens.length > 0) {
      return renderTokenizedContent(content, tokens);
    }
    return content || " ";
  };

  return (
    <div
      className={cn("px-3 editor-font", bgClass, textClass)}
      style={{
        fontSize: `${fontSize}px`,
        fontFamily: editorFontFamily,
        lineHeight: `${lineHeight}px`,
        tabSize: editorTabSize,
      }}
    >
      <span className="mr-3 inline-block w-10 select-none text-right text-text-lighter/50">
        {index + 1}
      </span>
      <span className="whitespace-pre">{renderContent()}</span>
    </div>
  );
});

DiffLineDisplay.displayName = "DiffLineDisplay";
