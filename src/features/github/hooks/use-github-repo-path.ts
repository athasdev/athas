import { useRepositoryStore } from "@/features/git/stores/git-repository.store";
import { useProjectStore } from "@/features/workspace/stores/project.store";

/**
 * The repository a GitHub view talks to: the one its buffer was opened for, else the repository
 * picked in the source control view, else the workspace root.
 */
export function useGitHubRepoPath(preferredRepoPath?: string | null): string | null {
  const rootFolderPath = useProjectStore((state) => state.rootFolderPath);
  const activeRepoPath = useRepositoryStore.use.activeRepoPath();
  return preferredRepoPath ?? activeRepoPath ?? rootFolderPath ?? null;
}
