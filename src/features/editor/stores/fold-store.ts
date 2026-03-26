import { create } from "zustand";
import { createSelectors } from "@/utils/zustand-selectors";

interface FoldRegion {
  startLine: number;
  endLine: number;
  indentLevel: number;
}

interface FileFoldState {
  regions: FoldRegion[];
  collapsedLines: Set<number>;
}

interface FoldState {
  foldsByFile: Map<string, FileFoldState>;

  actions: {
    computeFoldRegions: (filePath: string, content: string) => void;
    toggleFold: (filePath: string, lineNumber: number) => void;
    foldAll: (filePath: string) => void;
    unfoldAll: (filePath: string) => void;
    isFoldable: (filePath: string, lineNumber: number) => boolean;
    isCollapsed: (filePath: string, lineNumber: number) => boolean;
    isHidden: (filePath: string, lineNumber: number) => boolean;
    getFoldRegions: (filePath: string) => FoldRegion[];
    clearFolds: (filePath: string) => void;
  };
}

function detectFoldRegions(content: string): FoldRegion[] {
  const lines = content.split(/\r?\n/);
  const regions: FoldRegion[] = [];
  const stack: Array<{
    startLine: number;
    indentLevel: number;
    hasChildLines: boolean;
  }> = [];

  const getIndentLevel = (line: string): number => {
    const match = line.match(/^(\s*)/);
    if (!match) return 0;
    // Count spaces (1 space = 1 level) and tabs (1 tab = 4 levels)
    let level = 0;
    for (const char of match[1]) {
      if (char === "\t") {
        level += 4;
      } else {
        level += 1;
      }
    }
    return level;
  };

  const isBlankOrComment = (line: string): boolean => {
    const trimmed = line.trim();
    return trimmed === "" || trimmed.startsWith("//") || trimmed.startsWith("#");
  };

  let lastMeaningfulLine = -1;

  for (let i = 0; i < lines.length; i++) {
    const currentLine = lines[i];

    if (isBlankOrComment(currentLine)) continue;

    const currentIndent = getIndentLevel(currentLine);

    while (stack.length > 0 && currentIndent <= stack[stack.length - 1].indentLevel) {
      const region = stack.pop()!;
      if (region.hasChildLines && lastMeaningfulLine > region.startLine) {
        regions.push({
          startLine: region.startLine,
          endLine: lastMeaningfulLine,
          indentLevel: region.indentLevel,
        });
      }
    }

    if (stack.length > 0 && currentIndent > stack[stack.length - 1].indentLevel) {
      stack[stack.length - 1].hasChildLines = true;
    }

    stack.push({
      startLine: i,
      indentLevel: currentIndent,
      hasChildLines: false,
    });
    lastMeaningfulLine = i;
  }

  while (stack.length > 0) {
    const region = stack.pop()!;
    if (region.hasChildLines && lastMeaningfulLine > region.startLine) {
      regions.push({
        startLine: region.startLine,
        endLine: lastMeaningfulLine,
        indentLevel: region.indentLevel,
      });
    }
  }

  return regions;
}

export const useFoldStore = createSelectors(
  create<FoldState>()((set, get) => ({
    foldsByFile: new Map(),

    actions: {
      computeFoldRegions: (filePath, content) => {
        const regions = detectFoldRegions(content);
        set((state) => {
          const newMap = new Map(state.foldsByFile);
          const existing = newMap.get(filePath);
          newMap.set(filePath, {
            regions,
            collapsedLines: existing?.collapsedLines || new Set(),
          });
          return { foldsByFile: newMap };
        });
      },

      toggleFold: (filePath, lineNumber) => {
        set((state) => {
          const newMap = new Map(state.foldsByFile);
          const fileState = newMap.get(filePath);
          if (!fileState) return state;

          const newCollapsed = new Set(fileState.collapsedLines);
          if (newCollapsed.has(lineNumber)) {
            newCollapsed.delete(lineNumber);
          } else {
            const isFoldable = fileState.regions.some((r) => r.startLine === lineNumber);
            if (isFoldable) {
              newCollapsed.add(lineNumber);
            }
          }

          newMap.set(filePath, {
            ...fileState,
            collapsedLines: newCollapsed,
          });
          return { foldsByFile: newMap };
        });
      },

      foldAll: (filePath) => {
        set((state) => {
          const newMap = new Map(state.foldsByFile);
          const fileState = newMap.get(filePath);
          if (!fileState) return state;

          const newCollapsed = new Set<number>();
          fileState.regions.forEach((r) => newCollapsed.add(r.startLine));

          newMap.set(filePath, {
            ...fileState,
            collapsedLines: newCollapsed,
          });
          return { foldsByFile: newMap };
        });
      },

      unfoldAll: (filePath) => {
        set((state) => {
          const newMap = new Map(state.foldsByFile);
          const fileState = newMap.get(filePath);
          if (!fileState) return state;

          newMap.set(filePath, {
            ...fileState,
            collapsedLines: new Set(),
          });
          return { foldsByFile: newMap };
        });
      },

      isFoldable: (filePath, lineNumber) => {
        const fileState = get().foldsByFile.get(filePath);
        if (!fileState) return false;
        return fileState.regions.some((r) => r.startLine === lineNumber);
      },

      isCollapsed: (filePath, lineNumber) => {
        const fileState = get().foldsByFile.get(filePath);
        if (!fileState) return false;
        return fileState.collapsedLines.has(lineNumber);
      },

      isHidden: (filePath, lineNumber) => {
        const fileState = get().foldsByFile.get(filePath);
        if (!fileState) return false;

        for (const region of fileState.regions) {
          if (
            fileState.collapsedLines.has(region.startLine) &&
            lineNumber > region.startLine &&
            lineNumber <= region.endLine
          ) {
            return true;
          }
        }
        return false;
      },

      getFoldRegions: (filePath) => {
        const fileState = get().foldsByFile.get(filePath);
        return fileState?.regions || [];
      },

      clearFolds: (filePath) => {
        set((state) => {
          const newMap = new Map(state.foldsByFile);
          newMap.delete(filePath);
          return { foldsByFile: newMap };
        });
      },
    },
  })),
);
