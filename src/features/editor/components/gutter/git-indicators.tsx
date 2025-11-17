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
  onIndicatorClick,
  startLine,
  endLine,
}: GitIndicatorsProps) {
  const decorations = useEditorDecorationsStore((state) => state.decorations);

  const gitDecorations = useMemo(() => {
    const added = new Map<number, true>();
    const modified = new Map<number, true>();
    const deleted = new Map<number, true>();

    decorations.forEach((decoration) => {
      if (decoration.type === "gutter") {
        const lineNum = decoration.range.start.line;
        if (lineNum >= startLine && lineNum < endLine) {
          if (decoration.className?.includes("added")) {
            added.set(lineNum, true);
          } else if (decoration.className?.includes("modified")) {
            modified.set(lineNum, true);
          } else if (decoration.className?.includes("deleted")) {
            deleted.set(lineNum, true);
          }
        }
      }
    });

    return { added, modified, deleted };
  }, [decorations, startLine, endLine]);

  const indicators = useMemo(() => {
    const result: React.ReactNode[] = [];

    const getColor = (type: "added" | "modified" | "deleted") => {
      if (type === "added") return "var(--git-added, #2ea043)";
      if (type === "modified") return "var(--git-modified, #0078d4)";
      return "var(--git-deleted, #f85149)";
    };

    gitDecorations.added.forEach((_, lineNum) => {
      result.push(
        <div
          key={`a${lineNum}`}
          style={{
            position: "absolute",
            top: `${lineNum * lineHeight + GUTTER_PADDING}px`,
            left: 0,
            right: 0,
            height: `${lineHeight}px`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            userSelect: "none",
          }}
          onClick={() => onIndicatorClick?.(lineNum, "added")}
          title="Click to see added changes"
        >
          <div
            style={{
              width: "3px",
              height: "100%",
              backgroundColor: getColor("added"),
              borderRadius: "1px",
            }}
          />
        </div>,
      );
    });

    gitDecorations.modified.forEach((_, lineNum) => {
      result.push(
        <div
          key={`m${lineNum}`}
          style={{
            position: "absolute",
            top: `${lineNum * lineHeight + GUTTER_PADDING}px`,
            left: 0,
            right: 0,
            height: `${lineHeight}px`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            userSelect: "none",
          }}
          onClick={() => onIndicatorClick?.(lineNum, "modified")}
          title="Click to see modified changes"
        >
          <div
            style={{
              width: "3px",
              height: "100%",
              backgroundColor: getColor("modified"),
              borderRadius: "1px",
            }}
          />
        </div>,
      );
    });

    gitDecorations.deleted.forEach((_, lineNum) => {
      result.push(
        <div
          key={`d${lineNum}`}
          style={{
            position: "absolute",
            top: `${lineNum * lineHeight + GUTTER_PADDING}px`,
            left: 0,
            right: 0,
            height: `${lineHeight}px`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            userSelect: "none",
          }}
          onClick={() => onIndicatorClick?.(lineNum, "deleted")}
          title="Click to see deleted changes"
        >
          <div
            style={{
              width: "3px",
              height: "100%",
              backgroundColor: getColor("deleted"),
              borderRadius: "1px",
            }}
          />
        </div>,
      );
    });

    return result;
  }, [gitDecorations, lineHeight, onIndicatorClick]);

  return (
    <div
      style={{
        position: "relative",
        width: "12px",
      }}
    >
      {indicators}
    </div>
  );
}

export const GitIndicators = memo(GitIndicatorsComponent);
