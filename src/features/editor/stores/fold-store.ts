import { create } from "zustand";
import { logger } from "@/features/editor/utils/logger";
import { createSelectors } from "@/utils/zustand-selectors";

export interface FoldRegion {
  startLine: number;
  endLine: number;
  indentLevel: number;
  kind?: "generic" | "diff-file" | "diff-hunk";
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

function detectDiffFoldRegions(content: string): FoldRegion[] {
  const lines = content.split(/\r?\n/);
  const regions: FoldRegion[] = [];
  const fileStarts: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("\uE000ATHAS_DIFF_FILE ")) {
      fileStarts.push(i);
    }
  }

  for (let i = 0; i < fileStarts.length; i++) {
    const startLine = fileStarts[i];
    const endLine = (fileStarts[i + 1] ?? lines.length) - 1;
    if (endLine > startLine) {
      regions.push({ startLine, endLine, indentLevel: 0, kind: "diff-file" });
    }
  }

  return regions;
}

function detectFoldRegions(filePath: string, content: string): FoldRegion[] {
  if (filePath.endsWith(".diff") || filePath.startsWith("diff-editor://")) {
    return detectDiffFoldRegions(content);
  }

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
          kind: "generic",
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
        kind: "generic",
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
        const regions = detectFoldRegions(filePath, content);
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
        const start = performance.now();
        let action: "fold" | "unfold" | "noop" = "noop";

        set((state) => {
          const newMap = new Map(state.foldsByFile);
          const fileState = newMap.get(filePath);
          if (!fileState) return state;

          const newCollapsed = new Set(fileState.collapsedLines);
          if (newCollapsed.has(lineNumber)) {
            newCollapsed.delete(lineNumber);
            action = "unfold";
          } else {
            const isFoldable = fileState.regions.some((r) => r.startLine === lineNumber);
            if (isFoldable) {
              newCollapsed.add(lineNumber);
              action = "fold";
            }
          }

          newMap.set(filePath, {
            ...fileState,
            collapsedLines: newCollapsed,
          });
          return { foldsByFile: newMap };
        });

        logger.info(
          "FoldStore",
          `${action} toggle for ${filePath}:${lineNumber + 1} took ${(performance.now() - start).toFixed(2)}ms`,
        );
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
