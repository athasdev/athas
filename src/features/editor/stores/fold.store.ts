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
    foldLevel: (filePath: string, level: number) => void;
    unfoldAll: (filePath: string) => void;
    isFoldable: (filePath: string, lineNumber: number) => boolean;
    isCollapsed: (filePath: string, lineNumber: number) => boolean;
    isHidden: (filePath: string, lineNumber: number) => boolean;
    getFoldRegions: (filePath: string) => FoldRegion[];
    getCollapsedLines: (filePath: string) => number[];
    setCollapsedLines: (filePath: string, collapsedLines: number[]) => void;
    clearFolds: (filePath: string) => void;
  };
}

function forEachContentLine(
  content: string,
  callback: (line: string, lineNumber: number) => void,
): number {
  let lineStart = 0;
  let lineNumber = 0;

  for (let index = 0; index < content.length; index++) {
    if (content.charCodeAt(index) !== 10) continue;

    let lineEnd = index;
    if (lineEnd > lineStart && content.charCodeAt(lineEnd - 1) === 13) {
      lineEnd--;
    }

    callback(content.slice(lineStart, lineEnd), lineNumber);
    lineNumber++;
    lineStart = index + 1;
  }

  callback(content.slice(lineStart), lineNumber);
  return lineNumber + 1;
}

function detectDiffFoldRegions(content: string): FoldRegion[] {
  const regions: FoldRegion[] = [];
  const fileStarts: number[] = [];

  const lineCount = forEachContentLine(content, (line, lineNumber) => {
    if (line.startsWith("\uE000ATHAS_DIFF_FILE ")) {
      fileStarts.push(lineNumber);
    }
  });

  for (let i = 0; i < fileStarts.length; i++) {
    const startLine = fileStarts[i];
    const endLine = (fileStarts[i + 1] ?? lineCount) - 1;
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

  const regions: FoldRegion[] = [];
  const stack: Array<{
    startLine: number;
    indentLevel: number;
    hasChildLines: boolean;
  }> = [];

  const getIndentLevel = (line: string): number => {
    let level = 0;
    for (const char of line) {
      if (char === "\t") {
        level += 4;
      } else if (char === " " || /\s/.test(char)) {
        level += 1;
      } else {
        break;
      }
    }
    return level;
  };

  const isBlankOrComment = (line: string): boolean => {
    const trimmed = line.trim();
    return trimmed === "" || trimmed.startsWith("//") || trimmed.startsWith("#");
  };

  let lastMeaningfulLine = -1;

  forEachContentLine(content, (currentLine, lineNumber) => {
    if (isBlankOrComment(currentLine)) return;

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
      startLine: lineNumber,
      indentLevel: currentIndent,
      hasChildLines: false,
    });
    lastMeaningfulLine = lineNumber;
  });

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

function computeFoldDepths(regions: FoldRegion[]): Map<number, number> {
  const depths = new Map<number, number>();
  const ancestors: FoldRegion[] = [];
  const sortedRegions = [...regions].sort(
    (a, b) => a.startLine - b.startLine || b.endLine - a.endLine,
  );

  for (const region of sortedRegions) {
    while (
      ancestors.length > 0 &&
      (region.startLine > ancestors[ancestors.length - 1].endLine ||
        region.endLine > ancestors[ancestors.length - 1].endLine)
    ) {
      ancestors.pop();
    }

    depths.set(region.startLine, ancestors.length + 1);
    ancestors.push(region);
  }

  return depths;
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
          const foldableLines = new Set(regions.map((region) => region.startLine));
          newMap.set(filePath, {
            regions,
            collapsedLines: new Set(
              [...(existing?.collapsedLines ?? [])].filter((line) => foldableLines.has(line)),
            ),
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

      foldLevel: (filePath, level) => {
        const normalizedLevel = Math.max(1, Math.trunc(level));

        set((state) => {
          const newMap = new Map(state.foldsByFile);
          const fileState = newMap.get(filePath);
          if (!fileState) return state;

          const depths = computeFoldDepths(fileState.regions);
          const newCollapsed = new Set(fileState.collapsedLines);

          for (const region of fileState.regions) {
            if (depths.get(region.startLine) === normalizedLevel) {
              newCollapsed.add(region.startLine);
            }
          }

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

      getCollapsedLines: (filePath) => {
        const fileState = get().foldsByFile.get(filePath);
        return fileState ? [...fileState.collapsedLines].sort((a, b) => a - b) : [];
      },

      setCollapsedLines: (filePath, collapsedLines) => {
        set((state) => {
          const newMap = new Map(state.foldsByFile);
          const existing = newMap.get(filePath);
          const foldableLines =
            existing && existing.regions.length > 0
              ? new Set(existing.regions.map((region) => region.startLine))
              : null;
          const nextCollapsedLines = new Set(
            collapsedLines.filter((line) => !foldableLines || foldableLines.has(line)),
          );

          newMap.set(filePath, {
            regions: existing?.regions ?? [],
            collapsedLines: nextCollapsedLines,
          });
          return { foldsByFile: newMap };
        });
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
