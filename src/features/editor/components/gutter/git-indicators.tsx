import { memo, useMemo } from "react";
import { useEditorDecorationsStore } from "../../stores/decorations-store";

interface GitIndicatorsProps {
  lineHeight: number;
  fontSize: number;
  fontFamily: string;
  onIndicatorClick?: (lineNumber: number, type: "added" | "modified" | "deleted") => void;
  startLine: number;
  endLine: number;
}

const GUTTER_PADDING = 8;

function GitIndicatorsComponent({
  lineHeight,
  fontSize,
  fontFamily,
  onIndicatorClick,
  startLine,
  endLine,
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
    for (let i = startLine; i < endLine; i++) {
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
            position: "absolute",
            top: `${i * lineHeight + GUTTER_PADDING}px`,
            left: 0,
            right: 0,
            height: `${lineHeight}px`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: hasChange ? "pointer" : "default",
            userSelect: "none",
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
          {hasChange && (
            <div
              style={{
                width: "3px",
                height: "100%",
                backgroundColor: getColor(),
                borderRadius: "1px",
              }}
            />
          )}
        </div>,
      );
    }
    return result;
  }, [startLine, endLine, gitDecorations, lineHeight, onIndicatorClick]);

  return (
    <div
      style={{
        position: "relative",
        width: "12px",
        fontSize: `${fontSize}px`,
        fontFamily,
      }}
    >
      {indicators}
    </div>
  );
}

export const GitIndicators = memo(GitIndicatorsComponent);
