import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { getGitHubAvatarUrl } from "@/features/github/services/github-avatar-url";
import { pullRequestListQuery } from "@/features/github/services/github-queries";
import { useGitHubStore } from "@/features/github/stores/github.store";
import Badge from "@/ui/badge";
import { GroupedSection } from "@/ui/grouped-section";
import { GitPullRequestIcon } from "@/ui/icons";
import { SidebarListItem } from "@/ui/sidebar";
import { formatCompactRelativeDate } from "@/utils/date";
import { queryClient } from "@/utils/query-client";

const SHOWN_PULL_REQUESTS = 5;

/** The repository's open pull requests, newest activity first; hidden without GitHub. */
export function ProjectPullRequestsSection({ projectPath }: { projectPath: string }) {
  const isAuthenticated = useGitHubStore.use.isAuthenticated();
  const { markAuthFailed } = useGitHubStore.use.actions();
  const { data, isError } = useQuery(
    { ...pullRequestListQuery(projectPath, "all", markAuthFailed), enabled: isAuthenticated },
    queryClient,
  );

  useEffect(() => {
    void useGitHubStore.getState().actions.checkAuth();
  }, []);

  if (!isAuthenticated || isError || !data) return null;
  const pullRequests = [...data]
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .slice(0, SHOWN_PULL_REQUESTS);

  return (
    <GroupedSection
      title="Pull requests"
      description={data.length === 0 ? "No open pull requests" : `${data.length} open`}
      variant="flat"
    >
      {pullRequests.map((pr) => (
        <SidebarListItem
          key={pr.number}
          leading={
            <GitPullRequestIcon className={pr.isDraft ? "text-muted-foreground" : "text-success"} />
          }
          description={`#${pr.number} · ${pr.author.login} · ${pr.headRef}`}
          trailing={
            <span className="flex items-center gap-1.5">
              {pr.isDraft ? <Badge>Draft</Badge> : null}
              <span className="text-subtle-foreground tabular-nums ui-text-caption">
                {formatCompactRelativeDate(pr.updatedAt)}
              </span>
            </span>
          }
          onClick={() =>
            useBufferStore.getState().actions.openPRBuffer(pr.number, {
              title: pr.title,
              repoPath: projectPath,
              authorAvatarUrl: getGitHubAvatarUrl(pr.author),
            })
          }
        >
          {pr.title}
        </SidebarListItem>
      ))}
    </GroupedSection>
  );
}
