import { ProviderIcon } from "@/features/ai/components/icons/provider-icons";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItems,
  ContextMenuTrigger,
} from "@/ui/context-menu";
import type { MenuItem } from "@/ui/dropdown";
import {
  ChatBubbleTextIcon,
  CloudIcon,
  CopyIcon,
  GitPullRequestIcon,
  XCircleIcon,
} from "@/ui/icons";
import { SidebarListItem } from "@/ui/sidebar";
import { Spinner } from "@/ui/spinner";
import { writeClipboardText } from "@/utils/clipboard";
import { formatCompactRelativeDate } from "@/utils/date";
import { openExternalUrl } from "@/utils/external-url";
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
  const prUrl = run.prUrl;
  const actions: MenuItem[] = [
    {
      id: "open",
      label: "Open",
      icon: <ChatBubbleTextIcon />,
      onClick: () => void openCloudRunSession(run, workspacePath),
    },
    ...(prUrl
      ? [
          {
            id: "pull-request",
            label: "Open Pull Request",
            icon: <GitPullRequestIcon />,
            onClick: () => void openExternalUrl(prUrl),
          },
        ]
      : []),
    {
      id: "copy-repo",
      label: "Copy Repository Name",
      icon: <CopyIcon />,
      onClick: () => void writeClipboardText(run.repo),
    },
  ];
  return (
    <ContextMenu>
      <ContextMenuTrigger className="block">
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
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItems items={actions} />
      </ContextMenuContent>
    </ContextMenu>
  );
}
