import { memo, useCallback, useMemo } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { EDITOR_CONSTANTS } from "../../config/constants";
import { useFoldStore } from "../../stores/fold-store";

interface LineMapping {
  actualToVirtual: Map<number, number>;
  virtualToActual: Map<number, number>;
}

interface FoldIndicatorsProps {
  filePath?: string;
  lineHeight: number;
  fontSize: number;
  foldMapping?: LineMapping;
  startLine: number;
  endLine: number;
}

function FoldIndicatorsComponent({
  filePath,
  lineHeight,
  fontSize,
  foldMapping,
  startLine,
  endLine,
}: FoldIndicatorsProps) {
  const foldsByFile = useFoldStore((state) => state.foldsByFile);
  const foldActions = useFoldStore.use.actions();

  const handleFoldClick = useCallback(
    (lineNumber: number) => {
      if (!filePath) return;
      foldActions.toggleFold(filePath, lineNumber);
    },
    [filePath, foldActions],
  );

  const indicators = useMemo(() => {
    if (!filePath) return [];

    const fileState = foldsByFile.get(filePath);
    if (!fileState) return [];

    const result = [];

    for (const region of fileState.regions) {
      let virtualLine = region.startLine;
      if (foldMapping) {
        const mapped = foldMapping.actualToVirtual.get(region.startLine);
        if (mapped !== undefined) virtualLine = mapped;
      }

      if (virtualLine >= startLine && virtualLine < endLine) {
        const isCollapsed = fileState.collapsedLines.has(region.startLine);
        result.push(
          <button
            key={region.startLine}
            type="button"
            style={{
              position: "absolute",
              top: `${virtualLine * lineHeight + EDITOR_CONSTANTS.GUTTER_PADDING}px`,
              left: "0px",
              right: "0px",
              height: `${lineHeight}px`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              color: "var(--color-text-lighter, #8b93a1)",
              opacity: 1,
              userSelect: "none",
              background: "transparent",
              border: "1px solid transparent",
              borderRadius: "6px",
              padding: 0,
            }}
            onClick={() => handleFoldClick(region.startLine)}
            aria-label={isCollapsed ? "Expand fold" : "Collapse fold"}
            aria-expanded={!isCollapsed}
            title={
              region.kind === "diff-file"
                ? isCollapsed
                  ? "Expand file diff"
                  : "Collapse file diff"
                : region.kind === "diff-hunk"
                  ? isCollapsed
                    ? "Expand hunk"
                    : "Collapse hunk"
                  : isCollapsed
                    ? "Expand fold"
                    : "Collapse fold"
            }
            className="transition-colors hover:bg-hover/40 hover:text-text"
          >
            {isCollapsed ? (
              <ChevronRight size={14} strokeWidth={2} />
            ) : (
              <ChevronDown size={14} strokeWidth={2} />
            )}
          </button>,
        );
      }
    }

    return result;
  }, [
    filePath,
    foldsByFile,
    startLine,
    endLine,
    lineHeight,
    fontSize,
    handleFoldClick,
    foldMapping,
  ]);

  return (
    <div
      style={{
        position: "relative",
        width: "18px",
      }}
    >
      {indicators}
    </div>
  );
}

export const FoldIndicators = memo(FoldIndicatorsComponent);
