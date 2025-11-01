import { create } from "zustand";
import { getGitBlame } from "@/features/version-control/git/controllers/git";
import type { GitBlame, GitBlameLine } from "@/features/version-control/git/types/git";

interface GitBlameState {
  // State
  blameData: Map<string, GitBlame>;
  repoPathMap: Map<string, string>;
  loadingFiles: Set<string>;
  errorFiles: Map<string, string>;

  // Actions
  loadBlameForFile: (repoPath: string, filePath: string) => Promise<void>;
  getBlameForLine: (filePath: string, lineNumber: number) => GitBlameLine | null;
  getRepoPath: (filePath: string) => string | null;
  clearBlameForFile: (filePath: string) => void;
  clearAllBlame: () => void;
  isFileLoading: (filePath: string) => boolean;
  getFileError: (filePath: string) => string | null;
}

export const useGitBlameStore = create<GitBlameState>((set, get) => ({
  // Initial state
  blameData: new Map(),
  repoPathMap: new Map(),
  loadingFiles: new Set(),
  errorFiles: new Map(),

  // Load blame data for a specific file
  loadBlameForFile: async (repoPath: string, filePath: string) => {
    const state = get();

    // Don't load if already loading or already loaded
    if (state.loadingFiles.has(filePath) || state.blameData.has(filePath)) {
      return;
    }

    // Start loading
    set((state) => ({
      loadingFiles: new Set([...state.loadingFiles, filePath]),
      errorFiles: new Map([...state.errorFiles].filter(([key]) => key !== filePath)),
    }));

    try {
      // Convert absolute path to relative path if needed
      let relativePath = filePath;
      if (relativePath.startsWith(repoPath)) {
        relativePath = relativePath.slice(repoPath.length);
        if (relativePath.startsWith("/")) {
          relativePath = relativePath.slice(1);
        }
      }

      const blame = await getGitBlame(repoPath, relativePath);

      if (blame) {
        set((state) => {
          const newBlameData = new Map(state.blameData);
          newBlameData.set(filePath, blame);

          const newRepoPathMap = new Map(state.repoPathMap);
          newRepoPathMap.set(filePath, repoPath);

          const newLoadingFiles = new Set(state.loadingFiles);
          newLoadingFiles.delete(filePath);

          return {
            blameData: newBlameData,
            repoPathMap: newRepoPathMap,
            loadingFiles: newLoadingFiles,
          };
        });
      } else {
        throw new Error("No blame data available for this file");
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to load blame data";

      set((state) => {
        const newLoadingFiles = new Set(state.loadingFiles);
        newLoadingFiles.delete(filePath);

        const newErrorFiles = new Map(state.errorFiles);
        newErrorFiles.set(filePath, errorMessage);

        return {
          loadingFiles: newLoadingFiles,
          errorFiles: newErrorFiles,
        };
      });
    }
  },

  // Get blame data for a specific line
  getBlameForLine: (filePath: string, lineNumber: number) => {
    const state = get();
    const blame = state.blameData.get(filePath);

    if (!blame) {
      return null;
    }

    // Find the blame line that matches the line number
    // Note: Git blame line numbers are 1-based, editor line numbers might be 0-based
    const currentLine = lineNumber + 1;
    const blameLine = blame.lines.find((line) => {
      if (currentLine === line.line_number) {
        return true;
      }

      if (currentLine > line.line_number && currentLine < line.line_number + line.total_lines) {
        return true;
      }

      return false;
    });
    return blameLine || null;
  },

  // Get repo path for a file
  getRepoPath: (filePath: string) => {
    const state = get();
    return state.repoPathMap.get(filePath) || null;
  },

  // Clear blame data for a specific file
  clearBlameForFile: (filePath: string) => {
    set((state) => {
      const newBlameData = new Map(state.blameData);
      newBlameData.delete(filePath);

      const newRepoPathMap = new Map(state.repoPathMap);
      newRepoPathMap.delete(filePath);

      const newLoadingFiles = new Set(state.loadingFiles);
      newLoadingFiles.delete(filePath);

      const newErrorFiles = new Map(state.errorFiles);
      newErrorFiles.delete(filePath);

      return {
        blameData: newBlameData,
        repoPathMap: newRepoPathMap,
        loadingFiles: newLoadingFiles,
        errorFiles: newErrorFiles,
      };
    });
  },

  // Clear all blame data
  clearAllBlame: () => {
    set({
      blameData: new Map(),
      repoPathMap: new Map(),
      loadingFiles: new Set(),
      errorFiles: new Map(),
    });
  },

  // Check if a file is currently loading
  isFileLoading: (filePath: string) => {
    const state = get();
    return state.loadingFiles.has(filePath);
  },

  // Get error message for a file
  getFileError: (filePath: string) => {
    const state = get();
    return state.errorFiles.get(filePath) || null;
  },
}));
