import { memo } from "react";
import { useEditorDecorationsStore } from "@/stores/editor-decorations-store";
import { useEditorViewStore } from "@/stores/editor-view-store";
import { LineGutter } from "./line-gutter";
import { LineRenderer } from "./line-renderer";

interface LineWithContentProps {
  lineNumber: number;
  showLineNumbers: boolean;
  gutterWidth: number;
  lineHeight: number;
  isSelected: boolean;
}

export const LineWithContent = memo<LineWithContentProps>(
  ({ lineNumber, showLineNumbers, gutterWidth, lineHeight, isSelected }) => {
    const content = useEditorViewStore((state) => state.lines[lineNumber]);
    const tokens = useEditorViewStore((state) => state.lineTokens.get(lineNumber)) ?? [];
    const decorations = useEditorDecorationsStore((state) =>
      state.getDecorationsForLine(lineNumber),
    );

    return (
      <div
        className="editor-line-wrapper"
        style={{
          position: "absolute",
          top: `${lineNumber * lineHeight}px`,
          left: 0,
          right: 0,
          height: `${lineHeight}px`,
          display: "flex",
          overflow: "hidden",
        }}
      >
        {showLineNumbers && (
          <LineGutter
            lineNumber={lineNumber}
            showLineNumbers={showLineNumbers}
            gutterWidth={gutterWidth}
            decorations={decorations}
          />
        )}
        <div
          className="editor-line-content-wrapper"
          style={{
            flex: 1,
            paddingLeft: showLineNumbers ? 0 : `16px`,
            lineHeight: `${lineHeight}px`,
            height: `${lineHeight}px`,
            overflow: "hidden",
          }}
        >
          <LineRenderer
            lineNumber={lineNumber}
            content={content}
            tokens={tokens}
            decorations={decorations}
            isSelected={isSelected}
          />
        </div>
      </div>
    );
  },
);

LineWithContent.displayName = "LineWithContent";
