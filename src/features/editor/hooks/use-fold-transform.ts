import { useMemo } from "react";
import { useFoldStore } from "../stores/fold-store";
import { transformContentForFolding } from "../utils/fold-transformer";
import { splitLines } from "../utils/lines";

interface FoldMapping {
  actualToVirtual: Map<number, number>;
  virtualToActual: Map<number, number>;
  foldedRanges: Array<{ start: number; end: number; virtualLine: number }>;
}

interface FoldTransformResult {
  virtualContent: string;
  virtualLines: string[];
  mapping: FoldMapping;
  foldMarkers: Map<number, number>;
  hasActiveFolds: boolean;
}

export function useFoldTransform(
  filePath: string | undefined,
  content: string,
): FoldTransformResult {
  const foldsByFile = useFoldStore((state) => state.foldsByFile);

  return useMemo(() => {
    if (!filePath) {
      return {
        virtualContent: content,
        virtualLines: splitLines(content),
        mapping: {
          actualToVirtual: new Map<number, number>(),
          virtualToActual: new Map<number, number>(),
          foldedRanges: [],
        },
        foldMarkers: new Map<number, number>(),
        hasActiveFolds: false,
      };
    }

    const fileState = foldsByFile.get(filePath);
    if (!fileState || fileState.collapsedLines.size === 0) {
      const lines = splitLines(content);
      const actualToVirtual = new Map<number, number>();
      const virtualToActual = new Map<number, number>();
      lines.forEach((_, i) => {
        actualToVirtual.set(i, i);
        virtualToActual.set(i, i);
      });

      return {
        virtualContent: content,
        virtualLines: lines,
        mapping: {
          actualToVirtual,
          virtualToActual,
          foldedRanges: [],
        },
        foldMarkers: new Map<number, number>(),
        hasActiveFolds: false,
      };
    }

    const result = transformContentForFolding(content, fileState.collapsedLines, fileState.regions);
    return {
      ...result,
      hasActiveFolds: true,
    };
  }, [filePath, content, foldsByFile]);
}
