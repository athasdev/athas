import { create } from "zustand";
import { getGitBlame } from "../api/blame";
import type { GitBlame, GitBlameLine } from "../types/git";

interface GitBlameState {
  blameData: Map<string, GitBlame>;
  isLoading: Map<string, boolean>;
  errors: Map<string, string>;
  fileToRepo: Map<string, string>;

  loadBlameForFile: (repoPath: string, filePath: string) => Promise<void>;
  clearBlameForFile: (filePath: string) => void;
  clearAllBlame: () => void;
  getBlameForLine: (filePath: string, lineNumber: number) => GitBlameLine | null;
  getRepoPath: (filePath: string) => string | null;
}

export const useGitBlameStore = create<GitBlameState>((set, get) => ({
  blameData: new Map(),
  isLoading: new Map(),
  errors: new Map(),
  fileToRepo: new Map(),

  loadBlameForFile: async (repoPath: string, filePath: string) => {
    const { blameData, isLoading, fileToRepo } = get();

    if (blameData.has(filePath) || isLoading.get(filePath)) {
      return;
    }

    set({
      isLoading: new Map(isLoading).set(filePath, true),
      errors: new Map(get().errors),
    });

    try {
      const blame = await getGitBlame(repoPath, filePath);

      if (blame) {
        set({
          blameData: new Map(get().blameData).set(filePath, blame),
          fileToRepo: new Map(fileToRepo).set(filePath, repoPath),
          isLoading: new Map(get().isLoading).set(filePath, false),
        });
      } else {
        set({
          errors: new Map(get().errors).set(filePath, "Failed to load blame data"),
          isLoading: new Map(get().isLoading).set(filePath, false),
        });
      }
    } catch (error) {
      set({
        errors: new Map(get().errors).set(
          filePath,
          error instanceof Error ? error.message : "Unknown error",
        ),
        isLoading: new Map(get().isLoading).set(filePath, false),
      });
    }
  },

  clearBlameForFile: (filePath: string) => {
    const { blameData, isLoading, errors, fileToRepo } = get();
    const newBlameData = new Map(blameData);
    const newIsLoading = new Map(isLoading);
    const newErrors = new Map(errors);
    const newFileToRepo = new Map(fileToRepo);

    newBlameData.delete(filePath);
    newIsLoading.delete(filePath);
    newErrors.delete(filePath);
    newFileToRepo.delete(filePath);

    set({
      blameData: newBlameData,
      isLoading: newIsLoading,
      errors: newErrors,
      fileToRepo: newFileToRepo,
    });
  },

  clearAllBlame: () => {
    set({
      blameData: new Map(),
      isLoading: new Map(),
      errors: new Map(),
      fileToRepo: new Map(),
    });
  },

  getBlameForLine: (filePath: string, lineNumber: number) => {
    const { blameData } = get();
    const blame = blameData.get(filePath);

    if (!blame) return null;

    for (const line of blame.lines) {
      const start = line.line_number;
      const end = start + line.total_lines - 1;
      if (lineNumber >= start && lineNumber <= end) {
        return line;
      }
    }

    return null;
  },

  getRepoPath: (filePath: string) => {
    return get().fileToRepo.get(filePath) ?? null;
  },
}));
