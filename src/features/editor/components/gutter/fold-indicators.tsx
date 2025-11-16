import { memo, useCallback, useMemo } from "react";
import { useFoldStore } from "../../stores/fold-store";

interface LineMapping {
  virtualToActual: Map<number, number>;
}

interface FoldIndicatorsProps {
  filePath?: string;
  totalLines: number;
  lineHeight: number;
  fontSize: number;
  foldMapping?: LineMapping;
}

function FoldIndicatorsComponent({
  filePath,
  totalLines,
  lineHeight,
  fontSize,
  foldMapping,
}: FoldIndicatorsProps) {
  const foldsByFile = useFoldStore((state) => state.foldsByFile);
  const foldActions = useFoldStore.use.actions();

  const foldState = useMemo(() => {
    if (!filePath) return { foldable: new Set<number>(), collapsed: new Set<number>() };

    const fileState = foldsByFile.get(filePath);
    if (!fileState) return { foldable: new Set<number>(), collapsed: new Set<number>() };

    const foldable = new Set<number>();
    fileState.regions.forEach((r) => foldable.add(r.startLine));

    return { foldable, collapsed: fileState.collapsedLines };
  }, [filePath, foldsByFile]);

  const handleFoldClick = useCallback(
    (lineNumber: number) => {
      if (!filePath) return;
      foldActions.toggleFold(filePath, lineNumber);
    },
    [filePath, foldActions],
  );

  const indicators = useMemo(() => {
    const result = [];
    for (let i = 0; i < totalLines; i++) {
      const actualLineNumber = foldMapping?.virtualToActual.get(i) ?? i;
      const isFoldable = foldState.foldable.has(actualLineNumber);
      const isCollapsed = foldState.collapsed.has(actualLineNumber);

      if (isFoldable) {
        result.push(
          <button
            key={i}
            type="button"
            style={{
              height: `${lineHeight}px`,
              lineHeight: `${lineHeight}px`,
              width: "100%",
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
              display: "block",
            }}
            onClick={() => handleFoldClick(actualLineNumber)}
            aria-label={isCollapsed ? "Expand fold" : "Collapse fold"}
            aria-expanded={!isCollapsed}
          >
            {isCollapsed ? "›" : "⌄"}
          </button>,
        );
      } else {
        result.push(
          <div
            key={i}
            style={{
              height: `${lineHeight}px`,
              lineHeight: `${lineHeight}px`,
              textAlign: "center",
              color: "transparent",
              opacity: 0,
              fontSize: `${fontSize * 0.7}px`,
              userSelect: "none",
            }}
          >
            {" "}
          </div>,
        );
      }
    }
    return result;
  }, [totalLines, foldState, lineHeight, fontSize, handleFoldClick, foldMapping]);

  return (
    <div
      style={{
        width: "16px",
        height: "100%",
        overflowY: "hidden",
        overflowX: "hidden",
        padding: "0.5rem 0",
      }}
    >
      {indicators}
    </div>
  );
}

export const FoldIndicators = memo(FoldIndicatorsComponent);
