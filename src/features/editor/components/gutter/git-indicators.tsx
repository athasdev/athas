import { memo, useMemo } from "react";
import { EDITOR_CONSTANTS } from "../../config/constants";
import { useEditorDecorationsStore } from "../../stores/decorations-store";
import type { Decoration } from "../../types/editor";

interface GitIndicatorsProps {
  lineHeight: number;
  fontSize: number;
  fontFamily: string;
  onIndicatorClick?: (lineNumber: number, type: "added" | "modified" | "deleted") => void;
  startLine: number;
  endLine: number;
}

function GitIndicatorsComponent({
  lineHeight,
  onIndicatorClick,
  startLine,
  endLine,
}: GitIndicatorsProps) {
  const decorations = useEditorDecorationsStore((state) => state.decorations);

  // Memoize the extraction of git decorations separately from viewport filtering
  // This ensures we don't iterate all decorations when scrolling
  const allGitDecorations = useMemo(() => {
    const added = new Set<number>();
    const modified = new Set<number>();
    const deleted = new Set<number>();

    if (!decorations) return { added, modified, deleted };

    decorations.forEach((decoration: Decoration & { id: string }) => {
      if (decoration.type === "gutter" && decoration.className) {
        // Check for specific git classes used in useGitGutter
        if (decoration.className.includes("git-gutter-added")) {
          added.add(decoration.range.start.line);
        } else if (decoration.className.includes("git-gutter-modified")) {
          modified.add(decoration.range.start.line);
        } else if (decoration.className.includes("git-gutter-deleted")) {
          deleted.add(decoration.range.start.line);
        }
      }
    });

    return { added, modified, deleted };
  }, [decorations]);

  // Filter decorations for the current viewport
  const indicators = useMemo(() => {
    const result: React.ReactNode[] = [];

    const getColor = (type: "added" | "modified" | "deleted") => {
      if (type === "added") return "var(--git-added, #2ea043)";
      if (type === "modified") return "var(--git-modified, #0078d4)";
      return "var(--git-deleted, #f85149)";
    };

    const renderIndicator = (lineNum: number, type: "added" | "modified" | "deleted") => (
      <div
        key={`${type[0]}${lineNum}`}
        style={{
          position: "absolute",
          top: `${lineNum * lineHeight + EDITOR_CONSTANTS.GUTTER_PADDING}px`,
          left: 0,
          right: 0,
          height: `${lineHeight}px`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          userSelect: "none",
        }}
        onClick={() => onIndicatorClick?.(lineNum, type)}
        title={`Click to see ${type} changes`}
      >
        <div
          style={{
            width: "3px",
            height: "100%",
            backgroundColor: getColor(type),
            borderRadius: "1px",
          }}
        />
      </div>
    );

    // Iterate only the viewport lines, checking against the Sets
    // This is O(ViewportLines) which is much faster than O(TotalDecorations) during scroll
    for (let lineNum = startLine; lineNum < endLine; lineNum++) {
      if (allGitDecorations.added.has(lineNum)) {
        result.push(renderIndicator(lineNum, "added"));
      } else if (allGitDecorations.modified.has(lineNum)) {
        result.push(renderIndicator(lineNum, "modified"));
      } else if (allGitDecorations.deleted.has(lineNum)) {
        result.push(renderIndicator(lineNum, "deleted"));
      }
    }

    return result;
  }, [allGitDecorations, lineHeight, startLine, endLine, onIndicatorClick]);

  return (
    <div
      style={{
        position: "relative",
        width: "12px",
        zIndex: 2,
      }}
    >
      {indicators}
    </div>
  );
}

export const GitIndicators = memo(GitIndicatorsComponent);
