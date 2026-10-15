import { ProviderIcon } from "@/features/ai/components/icons/provider-icons";
import { CloudIcon, GitPullRequestIcon, XCircleIcon } from "@/ui/icons";
import { SidebarListItem } from "@/ui/sidebar";
import { Spinner } from "@/ui/spinner";
import { formatCompactRelativeDate } from "@/utils/date";
import { type CloudAgentRun, isActiveCloudAgentRun } from "../services/cloud-agents-api";
import { fromCloudAgentId } from "../services/cloud-environment";
import { openCloudRunSession } from "../services/cloud-session";

/** A cloud run with no session here yet; opening it makes it one. */
export function CloudRunSidebarRow({
  run,
  workspacePath,
}: {
  run: CloudAgentRun;
  /** The open project the run's repository belongs to, if any. */
  workspacePath: string | null;
}) {
  const active = isActiveCloudAgentRun(run);
  const created = new Date(run.createdAt);
  return (
    <SidebarListItem
      leading={<ProviderIcon providerId={fromCloudAgentId(run.agent)} size={16} />}
      title={`${run.title} · ${run.repo}`}
      trailing={
        active ? (
          <Spinner label="Running in the cloud" compact />
        ) : (
          <span className="flex items-center gap-1 text-subtle-foreground ui-text-caption">
            {run.status === "succeeded" && run.prUrl ? (
              <GitPullRequestIcon aria-label="Pull request opened" />
            ) : run.status === "failed" ? (
              <XCircleIcon aria-label="Failed" />
            ) : (
              <CloudIcon aria-label="Cloud run" />
            )}
            {Number.isNaN(created.getTime())
              ? null
              : formatCompactRelativeDate(created, { includeAgo: false, justNowLabel: "now" })}
          </span>
        )
      }
      onClick={() => void openCloudRunSession(run, workspacePath)}
    >
      {run.title}
    </SidebarListItem>
  );
}
