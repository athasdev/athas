import { commands, type GitBlame as GitBlamePayload } from "@/bindings/commands";
import type { GitBlame } from "../types/git.types";
import { isNotGitRepositoryError, resolveRepositoryForFile } from "./git-repo-api";

export interface ResolvedGitBlame {
  blame: GitBlame;
  repoPath: string;
  filePath: string;
}

/** The command lists each commit once; every line range gets its commit's details back here. */
function expandGitBlame(payload: GitBlamePayload): GitBlame {
  return {
    file_path: payload.file_path,
    lines: payload.hunks.map((hunk) => {
      const commit = hunk.commit_index === null ? undefined : payload.commits[hunk.commit_index];
      return {
        line_number: hunk.line_number,
        total_lines: hunk.total_lines,
        commit_hash: commit?.hash ?? "",
        is_uncommitted: !commit,
        author: commit?.author ?? "",
        email: commit?.email ?? "",
        time: commit?.time ?? 0,
        commit: commit?.message ?? "",
      };
    }),
  };
}

export const getResolvedGitBlame = async (
  rootPath: string,
  filePath: string,
  content: string,
): Promise<ResolvedGitBlame | null> => {
  try {
    const resolved = await resolveRepositoryForFile(rootPath, filePath);
    if (!resolved) {
      return null;
    }

    const payload = await commands.gitBlameFile(resolved.repoPath, resolved.filePath, content);
    return {
      blame: expandGitBlame(payload),
      repoPath: resolved.repoPath,
      filePath: resolved.filePath,
    };
  } catch (error) {
    if (!isNotGitRepositoryError(error)) {
      console.error("Failed to get git blame:", error);
    }
    return null;
  }
};

export const getGitBlame = async (
  rootPath: string,
  filePath: string,
  content: string,
): Promise<GitBlame | null> => {
  return (await getResolvedGitBlame(rootPath, filePath, content))?.blame ?? null;
};

/**
 * Asks the backend to compute committed blame for these files in the background, so the first
 * blame after HEAD moves is served from its cache. Files outside a repository are skipped.
 */
export async function prewarmGitBlame(rootPath: string, filePaths: string[]): Promise<void> {
  const resolved = await Promise.all(
    filePaths.map((filePath) => resolveRepositoryForFile(rootPath, filePath).catch(() => null)),
  );
  const filesByRepo = new Map<string, string[]>();
  for (const file of resolved) {
    if (!file) continue;
    const files = filesByRepo.get(file.repoPath) ?? [];
    if (!files.includes(file.filePath)) files.push(file.filePath);
    filesByRepo.set(file.repoPath, files);
  }
  await Promise.all(
    [...filesByRepo].map(([repoPath, files]) =>
      commands.gitPrewarmBlame(repoPath, files).catch(() => undefined),
    ),
  );
}
