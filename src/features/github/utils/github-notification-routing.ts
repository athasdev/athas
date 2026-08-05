import { getRemotes } from "@/features/git/api/git-remotes-api";
import { parseGitHubRepositoryUrl } from "./github-link-utils";

type RemoteLoader = typeof getRemotes;

function parseRepositoryFullName(value: string): { owner: string; repo: string } | null {
  const match = value.trim().match(/^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/);
  if (!match || match[1] === "." || match[1] === ".." || match[2] === "." || match[2] === "..") {
    return null;
  }
  return { owner: match[1], repo: match[2] };
}

export function buildGitHubRepositoryRef(repositoryFullName: string): string | null {
  const repository = parseRepositoryFullName(repositoryFullName);
  return repository ? `github://${repository.owner}/${repository.repo}` : null;
}

export async function resolveGitHubNotificationRepoPath(
  repositoryFullName: string,
  candidateRepoPaths: string[],
  loadRemotes: RemoteLoader = getRemotes,
): Promise<string | null> {
  const repository = parseRepositoryFullName(repositoryFullName);
  if (!repository) return null;

  const uniqueRepoPaths = [...new Set(candidateRepoPaths.filter(Boolean))];
  const remoteLists = await Promise.all(
    uniqueRepoPaths.map(async (repoPath) => ({ repoPath, remotes: await loadRemotes(repoPath) })),
  );
  const localMatch = remoteLists.find(({ remotes }) =>
    remotes.some((remote) => {
      const remoteRepository = parseGitHubRepositoryUrl(remote.url);
      return (
        remoteRepository?.owner.toLowerCase() === repository.owner.toLowerCase() &&
        remoteRepository.repo.toLowerCase() === repository.repo.toLowerCase()
      );
    }),
  );

  return localMatch?.repoPath ?? buildGitHubRepositoryRef(repositoryFullName);
}
