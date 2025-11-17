import { memo, useCallback, useMemo } from "react";
import { useFoldStore } from "../../stores/fold-store";

interface LineMapping {
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

const GUTTER_PADDING = 8;

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
        const mapped = foldMapping.virtualToActual.get(region.startLine);
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
              top: `${virtualLine * lineHeight + GUTTER_PADDING}px`,
              left: 0,
              right: 0,
              height: `${lineHeight}px`,
              lineHeight: `${lineHeight}px`,
              textAlign: "center",
              cursor: "pointer",
              color: isCollapsed
                ? "var(--accent, #569cd6)"
                : "var(--text-light, rgba(255, 255, 255, 0.5))",
              opacity: isCollapsed ? 1 : 0.7,
              fontSize: `${fontSize * 0.7}px`,
              userSelect: "none",
              background: "none",
              border: "none",
              padding: 0,
            }}
            onClick={() => handleFoldClick(region.startLine)}
            aria-label={isCollapsed ? "Expand fold" : "Collapse fold"}
            aria-expanded={!isCollapsed}
          >
            {isCollapsed ? "›" : "⌄"}
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
        width: "16px",
      }}
    >
      {indicators}
    </div>
  );
}

export const FoldIndicators = memo(FoldIndicatorsComponent);
