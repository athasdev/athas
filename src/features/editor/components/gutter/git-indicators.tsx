import { memo, useMemo } from "react";
import { useEditorDecorationsStore } from "../../stores/decorations-store";

interface GitIndicatorsProps {
  totalLines: number;
  lineHeight: number;
  fontSize: number;
  fontFamily: string;
  onIndicatorClick?: (lineNumber: number, type: "added" | "modified" | "deleted") => void;
}

function GitIndicatorsComponent({
  totalLines,
  lineHeight,
  fontSize,
  fontFamily,
  onIndicatorClick,
}: GitIndicatorsProps) {
  const decorationsArray = useEditorDecorationsStore((state) =>
    Array.from(state.decorations.values()),
  );

  const gitDecorations = useMemo(() => {
    const added = new Set<number>();
    const modified = new Set<number>();
    const deleted = new Set<number>();

    decorationsArray.forEach((decoration) => {
      if (decoration.type === "gutter") {
        const lineNum = decoration.range.start.line;
        if (decoration.className?.includes("added")) {
          added.add(lineNum);
        } else if (decoration.className?.includes("modified")) {
          modified.add(lineNum);
        } else if (decoration.className?.includes("deleted")) {
          deleted.add(lineNum);
        }
      }
    });

    return { added, modified, deleted };
  }, [decorationsArray]);

  const indicators = useMemo(() => {
    const result = [];
    for (let i = 0; i < totalLines; i++) {
      const isAdded = gitDecorations.added.has(i);
      const isModified = gitDecorations.modified.has(i);
      const isDeleted = gitDecorations.deleted.has(i);
      const hasChange = isAdded || isModified || isDeleted;

      const getColor = () => {
        if (isAdded) return "var(--git-added, #2ea043)";
        if (isModified) return "var(--git-modified, #0078d4)";
        if (isDeleted) return "var(--git-deleted, #f85149)";
        return "transparent";
      };

      const getChar = () => {
        if (isAdded) return "█";
        if (isModified) return "█";
        if (isDeleted) return "▼";
        return " ";
      };

      const getType = (): "added" | "modified" | "deleted" | null => {
        if (isAdded) return "added";
        if (isModified) return "modified";
        if (isDeleted) return "deleted";
        return null;
      };

      result.push(
        <div
          key={i}
          style={{
            height: `${lineHeight}px`,
            lineHeight: `${lineHeight}px`,
            color: getColor(),
            cursor: hasChange ? "pointer" : "default",
            userSelect: "none",
            textAlign: "center",
            transition: "opacity 0.15s",
          }}
          onClick={() => {
            const type = getType();
            if (type && onIndicatorClick) {
              onIndicatorClick(i, type);
            }
          }}
          onMouseEnter={(e) => {
            if (hasChange) {
              e.currentTarget.style.opacity = "0.8";
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = "1";
          }}
          title={hasChange ? `Click to see ${getType()} changes` : undefined}
        >
          {getChar()}
        </div>,
      );
    }
    return result;
  }, [totalLines, gitDecorations, lineHeight, onIndicatorClick]);

  return (
    <div
      style={{
        width: "12px",
        height: "100%",
        overflowY: "hidden",
        overflowX: "hidden",
        fontSize: `${fontSize}px`,
        fontFamily,
        lineHeight: `${lineHeight}px`,
        padding: "0.5rem 0",
        whiteSpace: "pre",
      }}
    >
      {indicators}
    </div>
  );
}

export const GitIndicators = memo(GitIndicatorsComponent);
