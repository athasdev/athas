import { useMemo } from "react";
import { useFoldStore } from "@/features/editor/stores/fold.store";
import { transformContentForFolding } from "@/features/athas-editor/utils/fold-transformer";
import { splitLines } from "@/features/athas-editor/utils/lines";

export interface FoldMapping {
  actualToVirtual: Map<number, number>;
  virtualToActual: Map<number, number>;
  foldedRanges: Array<{ start: number; end: number; virtualLine: number }>;
}

export interface FoldTransformResult {
  virtualContent: string;
  virtualLines: string[];
  mapping: FoldMapping;
  foldMarkers: Map<number, number>;
  hasActiveFolds: boolean;
}

export function useFoldTransform(
  filePath: string | undefined,
  content: string,
  baseLines?: string[],
): FoldTransformResult {
  const foldsByFile = useFoldStore((state) => state.foldsByFile);

  return useMemo(() => {
    if (!filePath) {
      const lines = baseLines ?? splitLines(content);
      return {
        virtualContent: content,
        virtualLines: lines,
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
      const lines = baseLines ?? splitLines(content);
      return {
        virtualContent: content,
        virtualLines: lines,
        mapping: {
          actualToVirtual: new Map<number, number>(),
          virtualToActual: new Map<number, number>(),
          foldedRanges: [],
        },
        foldMarkers: new Map<number, number>(),
        hasActiveFolds: false,
      };
    }

    const result = transformContentForFolding(
      content,
      fileState.collapsedLines,
      fileState.regions,
      baseLines,
    );
    return {
      ...result,
      hasActiveFolds: true,
    };
  }, [filePath, content, baseLines, foldsByFile]);
}
