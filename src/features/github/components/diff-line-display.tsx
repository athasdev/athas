import { ArrowsInLineVerticalIcon as ArrowsInLineVertical } from "@phosphor-icons/react";
import { memo } from "react";
import { useEditorSettingsStore } from "@/features/editor/stores/settings.store";
import type { HighlightToken } from "@/features/editor/types/wasm-parser/wasm-parser.types";
import { calculateLineHeight } from "@/features/editor/utils/lines";
import { getDiffLineVisualState } from "@/features/git/utils/diff-viewer-visuals";
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
  let visualState = getDiffLineVisualState("context");
  let textClass = visualState.contentColor;
  let content = line;
  const isHunkHeader = line.startsWith("@@");

  if (line.startsWith("+")) {
    visualState = getDiffLineVisualState("added");
    textClass = visualState.contentColor;
    content = line.slice(1);
  } else if (line.startsWith("-")) {
    visualState = getDiffLineVisualState("removed");
    textClass = visualState.contentColor;
    content = line.slice(1);
  }

  const renderContent = () => {
    if (tokens && tokens.length > 0) {
      return renderTokenizedContent(content, tokens);
    }
    return content || " ";
  };

  if (isHunkHeader) {
    return (
      <div
        className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-center border-border/70 border-b bg-primary-bg text-text-lighter"
        style={{
          fontSize: `${fontSize}px`,
          fontFamily: editorFontFamily,
          lineHeight: `${lineHeight}px`,
          tabSize: editorTabSize,
        }}
      >
        <div className="flex min-h-8 items-center justify-center">
          <ArrowsInLineVertical size={18} />
        </div>
        <div className="flex min-w-0 items-center gap-3 pr-3">
          <div className="h-px flex-1 bg-border/70" />
          <span className="min-w-0 truncate ui-text-xs text-text-lighter">{line}</span>
          <div className="h-px flex-1 bg-border/70" />
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex min-w-full editor-font",
        visualState.lineBackground,
        visualState.railClassName,
        textClass,
      )}
      style={{
        fontSize: `${fontSize}px`,
        fontFamily: editorFontFamily,
        lineHeight: `${lineHeight}px`,
        tabSize: editorTabSize,
      }}
    >
      <span
        className={cn(
          "w-11 shrink-0 select-none border-border border-r px-2 py-0.5 text-right tabular-nums",
          visualState.gutterBackground,
          visualState.gutterTextColor,
        )}
      >
        {index + 1}
      </span>
      <span className="min-w-0 flex-1 whitespace-pre px-2.5 py-0.5 antialiased">
        {renderContent()}
      </span>
    </div>
  );
});

DiffLineDisplay.displayName = "DiffLineDisplay";
