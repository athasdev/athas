import { commands, type GitHunk as BindingGitHunk } from "@/bindings/commands";
import { emitGitChanged } from "../events/git-events";
import { registerGitCacheInvalidator } from "../runtime/git-cache-registry";
import { runGitFileOperationBatch } from "../utils/git-operation-batch";
import type { GitHunk, GitStatus } from "../types/git.types";
import {
  isNotGitRepositoryError,
  resolveRepositoryPath,
  resolveRepositoryPathOrThrow,
} from "./git-repo-api";

const inFlightGitStatusRequests = new Map<string, Promise<GitStatus | null>>();
const gitStatusGenerations = new Map<string, number>();

const toBindingHunk = (hunk: GitHunk): BindingGitHunk => ({
  file_path: hunk.file_path,
  lines: hunk.lines.map((line) => ({
    ...line,
    old_line_number: line.old_line_number ?? null,
    new_line_number: line.new_line_number ?? null,
  })),
});

registerGitCacheInvalidator(({ repoPath }) => {
  if (!repoPath) {
    for (const [cachedRepoPath, generation] of gitStatusGenerations) {
      gitStatusGenerations.set(cachedRepoPath, generation + 1);
    }
    inFlightGitStatusRequests.clear();
    return;
  }

  gitStatusGenerations.set(repoPath, (gitStatusGenerations.get(repoPath) ?? 0) + 1);
  inFlightGitStatusRequests.delete(repoPath);
});

export const getGitStatus = async (repoPath: string): Promise<GitStatus | null> => {
  let resolvedRepoPath: string | null;

  try {
    resolvedRepoPath = await resolveRepositoryPath(repoPath);
  } catch (error) {
    if (!isNotGitRepositoryError(error)) {
      console.error("Failed to get git status:", error);
    }
    return null;
  }

  if (!resolvedRepoPath) {
    return null;
  }

  const existingRequest = inFlightGitStatusRequests.get(resolvedRepoPath);
  if (existingRequest) {
    return existingRequest;
  }

  const generation = gitStatusGenerations.get(resolvedRepoPath) ?? 0;
  if (!gitStatusGenerations.has(resolvedRepoPath)) {
    gitStatusGenerations.set(resolvedRepoPath, generation);
  }
  const request = commands
    .gitStatus(resolvedRepoPath)
    .then((status) => {
      if (generation !== (gitStatusGenerations.get(resolvedRepoPath) ?? 0)) {
        return getGitStatus(resolvedRepoPath);
      }
      return status;
    })
    .catch((error) => {
      if (!isNotGitRepositoryError(error)) {
        console.error("Failed to get git status:", error);
      }
      return null;
    })
    .finally(() => {
      if (inFlightGitStatusRequests.get(resolvedRepoPath) === request) {
        inFlightGitStatusRequests.delete(resolvedRepoPath);
      }
    });

  inFlightGitStatusRequests.set(resolvedRepoPath, request);
  return request;
};

export const stageFile = async (repoPath: string, filePath: string): Promise<boolean> => {
  try {
    const resolvedRepoPath = await resolveRepositoryPathOrThrow(repoPath);
    await commands.gitAdd(resolvedRepoPath, filePath);
    emitGitChanged({
      repoPath: resolvedRepoPath,
      filePath,
      scopes: ["working-tree"],
      source: "stage-file",
    });
    return true;
  } catch (error) {
    console.error("Failed to stage file:", error);
    return false;
  }
};

export const unstageFile = async (repoPath: string, filePath: string): Promise<boolean> => {
  try {
    const resolvedRepoPath = await resolveRepositoryPathOrThrow(repoPath);
    await commands.gitReset(resolvedRepoPath, filePath);
    emitGitChanged({
      repoPath: resolvedRepoPath,
      filePath,
      scopes: ["working-tree"],
      source: "unstage-file",
    });
    return true;
  } catch (error) {
    console.error("Failed to unstage file:", error);
    return false;
  }
};

export const setFilesStaged = async (
  repoPath: string,
  filePaths: string[],
  staged: boolean,
): Promise<Map<string, boolean>> => {
  if (filePaths.length === 0) return new Map();

  try {
    const resolvedRepoPath = await resolveRepositoryPathOrThrow(repoPath);
    const results = await runGitFileOperationBatch(filePaths, async (filePath) => {
      if (staged) {
        await commands.gitAdd(resolvedRepoPath, filePath);
      } else {
        await commands.gitReset(resolvedRepoPath, filePath);
      }
      return true;
    });

    const changedFilePaths = Array.from(results)
      .filter(([, success]) => success)
      .map(([filePath]) => filePath);
    if (changedFilePaths.length > 0) {
      emitGitChanged({
        repoPath: resolvedRepoPath,
        scopes: ["working-tree"],
        source: staged ? "stage-files" : "unstage-files",
      });
    }
    return results;
  } catch (error) {
    console.error(`Failed to ${staged ? "stage" : "unstage"} files:`, error);
    return new Map(filePaths.map((filePath) => [filePath, false]));
  }
};

export const stageAllFiles = async (repoPath: string): Promise<boolean> => {
  try {
    const resolvedRepoPath = await resolveRepositoryPathOrThrow(repoPath);
    await commands.gitAddAll(resolvedRepoPath);
    emitGitChanged({
      repoPath: resolvedRepoPath,
      scopes: ["working-tree"],
      source: "stage-all",
    });
    return true;
  } catch (error) {
    console.error("Failed to stage all files:", error);
    return false;
  }
};

export const unstageAllFiles = async (repoPath: string): Promise<boolean> => {
  try {
    const resolvedRepoPath = await resolveRepositoryPathOrThrow(repoPath);
    await commands.gitResetAll(resolvedRepoPath);
    emitGitChanged({
      repoPath: resolvedRepoPath,
      scopes: ["working-tree"],
      source: "unstage-all",
    });
    return true;
  } catch (error) {
    console.error("Failed to unstage all files:", error);
    return false;
  }
};

export const stageHunk = async (repoPath: string, hunk: GitHunk): Promise<boolean> => {
  try {
    const resolvedRepoPath = await resolveRepositoryPathOrThrow(repoPath);
    await commands.gitStageHunk(resolvedRepoPath, toBindingHunk(hunk));
    emitGitChanged({
      repoPath: resolvedRepoPath,
      filePath: hunk.file_path,
      scopes: ["working-tree"],
      source: "stage-hunk",
    });
    return true;
  } catch (error) {
    console.error("Failed to stage hunk:", error);
    return false;
  }
};

export const unstageHunk = async (repoPath: string, hunk: GitHunk): Promise<boolean> => {
  try {
    const resolvedRepoPath = await resolveRepositoryPathOrThrow(repoPath);
    await commands.gitUnstageHunk(resolvedRepoPath, toBindingHunk(hunk));
    emitGitChanged({
      repoPath: resolvedRepoPath,
      filePath: hunk.file_path,
      scopes: ["working-tree"],
      source: "unstage-hunk",
    });
    return true;
  } catch (error) {
    console.error("Failed to unstage hunk:", error);
    return false;
  }
};

export const discardAllChanges = async (repoPath: string): Promise<boolean> => {
  try {
    const resolvedRepoPath = await resolveRepositoryPathOrThrow(repoPath);
    await commands.gitDiscardAllChanges(resolvedRepoPath);
    emitGitChanged({
      repoPath: resolvedRepoPath,
      scopes: ["working-tree"],
      source: "discard-all",
    });
    return true;
  } catch (error) {
    console.error("Failed to discard all changes:", error);
    return false;
  }
};

export const discardFileChanges = async (repoPath: string, filePath: string): Promise<boolean> => {
  try {
    const resolvedRepoPath = await resolveRepositoryPathOrThrow(repoPath);
    await commands.gitDiscardFileChanges(resolvedRepoPath, filePath);
    emitGitChanged({
      repoPath: resolvedRepoPath,
      filePath,
      scopes: ["working-tree"],
      source: "discard-file",
    });
    return true;
  } catch (error) {
    console.error("Failed to discard file changes:", error);
    return false;
  }
};

export const initRepository = async (repoPath: string): Promise<boolean> => {
  try {
    await commands.gitInit(repoPath);
    emitGitChanged({
      repoPath,
      scopes: ["repository", "working-tree", "refs"],
      source: "initialize-repository",
    });
    return true;
  } catch (error) {
    console.error("Failed to initialize repository:", error);
    return false;
  }
};
