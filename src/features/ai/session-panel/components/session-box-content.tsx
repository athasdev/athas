import type { ReactNode } from "react";
import { DiffStats } from "@/features/ai/components/diff-stats";
import { openCustomize } from "@/features/ai/customize/services/open-customize";
import { formatTokenCount, formatUsageCost } from "@/features/ai/lib/acp-usage";
import { cleanCommand, shortenCommand } from "@/features/ai/lib/shell-command";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { ProjectGlyph } from "@/features/workspace/project-icons/components/project-glyph";
import Badge from "@/ui/badge";
import {
  ArrowsOutIcon,
  CircleDotIcon,
  GitBranchIcon,
  GitDiffIcon,
  GitPullRequestIcon,
  LaptopIcon,
  ListChecksIcon,
  PlugsConnectedIcon,
  RemoteIcon,
  SettingsIcon,
  TerminalIcon,
  TerminalWindowIcon,
} from "@/ui/icons";
import { Progress } from "@/ui/progress";
import { SidebarIconButton, SidebarListItem } from "@/ui/sidebar";
import { Spinner } from "@/ui/spinner";
import { StatusDot } from "@/ui/status-dot";
import Tooltip from "@/ui/tooltip";
import { IS_MAC, IS_WINDOWS } from "@/utils/platform";
import { useBranchPullRequest } from "../hooks/use-branch-pull-request";
import type { SessionBoxesData } from "../hooks/use-session-boxes";
import type { SessionRunningItem } from "../services/session-boxes";
import type { SessionLocation } from "../services/session-environment";
import { openInSessionBrowser } from "../services/session-links";
import { openSessionTool } from "../services/session-tools";
import type { SessionBoxId } from "../types/session-panel.types";
import { SessionBox } from "./session-box";
import { AgentSessionChangeRows } from "./session-change-rows";
import {
  CloudCostContent,
  CloudEnvironmentRows,
  CloudPullRequestRow,
  CloudRunningRow,
} from "@/features/ai/cloud-agents/components/cloud-session-boxes";
import { isActiveCloudAgentRun } from "@/features/ai/cloud-agents/services/cloud-agents-api";
import {
  formatCreditMicros,
  getRunSpentMicros,
} from "@/features/ai/cloud-agents/services/cloud-environment";

/** Changed files a box lists before it hands the rest to the Changes tool. */
const MAX_BOX_CHANGES = 6;

interface BoxProps {
  chatId: string;
  data: SessionBoxesData;
}

export const SESSION_BOX_TITLES: Record<SessionBoxId, string> = {
  environment: "Environment",
  context: "Context",
  changes: "Changes",
  running: "Running",
  cost: "Cost",
  plan: "Plan",
  connectors: "Connectors",
};

export function describeLocation(location: SessionLocation): string {
  switch (location.kind) {
    case "local":
      return IS_MAC ? "This Mac" : IS_WINDOWS ? "This PC" : "This computer";
    case "remote":
      return `SSH · ${location.host}`;
    case "wsl":
      return `WSL · ${location.distro}`;
  }
}

export function LocationIcon({ location }: { location: SessionLocation }) {
  switch (location.kind) {
    case "local":
      return <LaptopIcon />;
    case "remote":
      return <RemoteIcon />;
    case "wsl":
      return <TerminalWindowIcon />;
  }
}

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function BoxNote({ children }: { children: ReactNode }) {
  return <p className="px-1.5 pb-1 text-subtle-foreground ui-text-sm">{children}</p>;
}

function InfoRow({
  icon,
  title,
  description,
  tone,
}: {
  icon: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  tone?: "default" | "warning";
}) {
  return (
    <SidebarListItem
      as="div"
      interactive={false}
      density="compact"
      tone={tone}
      leading={icon}
      description={description}
    >
      {title}
    </SidebarListItem>
  );
}

function LiveDot() {
  return (
    <span className="flex size-[1em] items-center justify-center">
      <StatusDot tone="live" />
    </span>
  );
}

function EnvironmentBox({ chatId, data }: BoxProps) {
  if (data.cloud) {
    return (
      <SessionBox id="environment" title="Environment" summary="Cloud">
        <CloudEnvironmentRows chatId={chatId} run={data.cloud.run} />
      </SessionBox>
    );
  }
  const environment = data.environment;
  if (!environment) {
    return (
      <SessionBox id="environment" title="Environment">
        <BoxNote>No project folder.</BoxNote>
      </SessionBox>
    );
  }
  return (
    <SessionBox
      id="environment"
      title="Environment"
      summary={
        environment.location.kind === "local" ? undefined : describeLocation(environment.location)
      }
    >
      <InfoRow
        icon={<LocationIcon location={environment.location} />}
        title={describeLocation(environment.location)}
      />
      <Tooltip content={environment.workspacePath} width="full">
        <InfoRow
          icon={
            <ProjectGlyph
              projectPath={environment.workspacePath}
              iconPath={environment.iconPath}
              imageClassName="size-4"
            />
          }
          title={environment.name}
          description={environment.displayPath}
        />
      </Tooltip>
      {environment.branch ? <InfoRow icon={<GitBranchIcon />} title={environment.branch} /> : null}
    </SessionBox>
  );
}

function ContextBox({ data }: BoxProps) {
  const usage = data.context;
  if (!usage) return null;
  const used = formatTokenCount(usage.usedTokens);
  const detail =
    usage.limitTokens === null
      ? `${used} tokens`
      : `${used} of ${formatTokenCount(usage.limitTokens)} tokens`;
  return (
    <SessionBox
      id="context"
      title="Context"
      summary={usage.percent === null ? used : `${Math.round(usage.percent)}%`}
    >
      <div className="px-1.5 pt-0.5 pb-1.5">
        <Progress
          value={usage.percent ?? 0}
          tone={usage.tone}
          aria-label="Context window"
          aria-valuetext={detail}
        >
          <span className="text-muted-foreground">{detail}</span>
          {usage.cost ? (
            <span className="ml-auto tabular-nums text-muted-foreground">
              {formatUsageCost(usage.cost)}
            </span>
          ) : null}
        </Progress>
      </div>
    </SessionBox>
  );
}

function PullRequestRow({ repoPath, branch }: { repoPath: string; branch: string | null }) {
  const pullRequest = useBranchPullRequest(repoPath, branch);
  const openPRBuffer = useBufferStore.use.actions().openPRBuffer;
  if (!pullRequest) return null;
  const state = pullRequest.isDraft ? "Draft" : pullRequest.state.toUpperCase();
  return (
    <SidebarListItem
      density="compact"
      leading={<GitPullRequestIcon />}
      description={`#${pullRequest.number} · ${pullRequest.headRef}`}
      trailing={
        state === "OPEN" ? (
          <Badge tone="success">Open</Badge>
        ) : state === "MERGED" ? (
          <Badge tone="accent">Merged</Badge>
        ) : (
          <Badge>{state === "Draft" ? "Draft" : "Closed"}</Badge>
        )
      }
      onClick={() => openPRBuffer(pullRequest.number, { title: pullRequest.title, repoPath })}
    >
      {pullRequest.title}
    </SidebarListItem>
  );
}

function CloudChangesBox({ data }: BoxProps) {
  const run = data.cloud?.run;
  return (
    <SessionBox id="changes" title="Changes">
      {run?.prUrl ? (
        <CloudPullRequestRow run={run} />
      ) : (
        <BoxNote>
          {run && isActiveCloudAgentRun(run)
            ? "The agent's changes arrive as a pull request when it finishes."
            : "Changes from a cloud run arrive as a pull request."}
        </BoxNote>
      )}
    </SessionBox>
  );
}

function ChangesBox({ chatId, data }: BoxProps) {
  if (data.cloud) return <CloudChangesBox chatId={chatId} data={data} />;
  const { files, additions, deletions } = data.changes;
  const hidden = files.length - MAX_BOX_CHANGES;
  return (
    <SessionBox
      id="changes"
      title="Changes"
      summary={
        files.length > 0 ? <DiffStats additions={additions} deletions={deletions} /> : undefined
      }
      action={
        <SidebarIconButton
          tooltip="Open changes"
          aria-label="Open changes"
          onClick={() => openSessionTool(chatId, "changes")}
        >
          <ArrowsOutIcon />
        </SidebarIconButton>
      }
    >
      {data.environment ? (
        <PullRequestRow
          repoPath={data.environment.workspacePath}
          branch={data.environment.branch}
        />
      ) : null}
      {files.length === 0 ? (
        <BoxNote>Files the agent changes show up here.</BoxNote>
      ) : (
        <>
          <AgentSessionChangeRows
            changes={files.slice(0, MAX_BOX_CHANGES)}
            onSelect={(change) => openSessionTool(chatId, "changes", { changePath: change.path })}
          />
          {hidden > 0 ? (
            <SidebarListItem
              density="compact"
              leading={<GitDiffIcon />}
              onClick={() => openSessionTool(chatId, "changes")}
            >
              {hidden} more {hidden === 1 ? "file" : "files"}
            </SidebarListItem>
          ) : null}
        </>
      )}
    </SessionBox>
  );
}

function RunningRow({ chatId, item }: { chatId: string; item: SessionRunningItem }) {
  switch (item.kind) {
    case "server":
      return (
        <SidebarListItem
          density="compact"
          leading={<LiveDot />}
          description={item.command ? cleanCommand(item.command) : undefined}
          aria-label={`Open ${hostOf(item.url)} in the session browser`}
          onClick={() => openInSessionBrowser(chatId, item.url)}
        >
          {hostOf(item.url)}
        </SidebarListItem>
      );
    case "command":
      return (
        <SidebarListItem
          density="compact"
          leading={item.state === "live" ? <LiveDot /> : <Spinner compact />}
          aria-label={`${cleanCommand(item.command)} is running`}
          onClick={() => openSessionTool(chatId, "terminal")}
        >
          {shortenCommand(item.command)}
        </SidebarListItem>
      );
    case "failed":
      return (
        <SidebarListItem
          density="compact"
          tone="error"
          leading={<TerminalIcon />}
          onClick={() => openSessionTool(chatId, "terminal")}
        >
          A command failed
        </SidebarListItem>
      );
  }
}

function RunningBox({ chatId, data }: BoxProps) {
  const cloudRun = data.cloud?.run;
  if (data.cloud) {
    if (!cloudRun || !isActiveCloudAgentRun(cloudRun)) return null;
    return (
      <SessionBox id="running" title="Running">
        <CloudRunningRow run={cloudRun} />
      </SessionBox>
    );
  }
  if (data.running.length === 0) return null;
  return (
    <SessionBox id="running" title="Running">
      {data.running.map((item) => (
        <RunningRow key={item.kind} chatId={chatId} item={item} />
      ))}
    </SessionBox>
  );
}

function CostBox({ data }: BoxProps) {
  const run = data.cloud?.run;
  if (!run) return null;
  return (
    <SessionBox id="cost" title="Cost" summary={formatCreditMicros(getRunSpentMicros(run))}>
      <CloudCostContent run={run} />
    </SessionBox>
  );
}

function PlanBox({ chatId, data }: BoxProps) {
  const plan = data.plan;
  if (!plan) return null;
  const total = plan.entries.length;
  const current =
    plan.entries.find((entry) => entry.status === "in_progress") ??
    plan.entries.find((entry) => entry.status === "pending");
  return (
    <SessionBox
      id="plan"
      title="Plan"
      summary={`${plan.done}/${total}`}
      action={
        <SidebarIconButton
          tooltip="Open plan"
          aria-label="Open plan"
          onClick={() => openSessionTool(chatId, "plan")}
        >
          <ArrowsOutIcon />
        </SidebarIconButton>
      }
    >
      <div className="px-1.5 pt-0.5 pb-1">
        <Progress
          value={total > 0 ? (plan.done / total) * 100 : 0}
          aria-label="Plan progress"
          aria-valuetext={`${plan.done} of ${total} done`}
        />
      </div>
      {current ? (
        <SidebarListItem
          density="compact"
          leading={current.status === "in_progress" ? <CircleDotIcon /> : <ListChecksIcon />}
          onClick={() => openSessionTool(chatId, "plan")}
        >
          {current.content}
        </SidebarListItem>
      ) : (
        <BoxNote>Every step is done.</BoxNote>
      )}
    </SessionBox>
  );
}

function ConnectorsBox({ data }: BoxProps) {
  if (data.connectors.length === 0) return null;
  return (
    <SessionBox
      id="connectors"
      title="Connectors"
      summary={data.connectors.length}
      action={
        <SidebarIconButton
          tooltip="Manage MCP servers"
          aria-label="Manage MCP servers"
          onClick={() => openCustomize("mcp")}
        >
          <SettingsIcon />
        </SidebarIconButton>
      }
    >
      {data.connectors.map((connector) => (
        <InfoRow
          key={connector.id}
          icon={<PlugsConnectedIcon />}
          title={connector.name}
          tone={connector.skipped ? "warning" : "default"}
          description={connector.skipped ? "This agent cannot use it" : undefined}
        />
      ))}
    </SessionBox>
  );
}

/** One box's content in the session details. */
export function SessionBoxContent({ id, ...props }: BoxProps & { id: SessionBoxId }) {
  switch (id) {
    case "environment":
      return <EnvironmentBox {...props} />;
    case "context":
      return <ContextBox {...props} />;
    case "changes":
      return <ChangesBox {...props} />;
    case "running":
      return <RunningBox {...props} />;
    case "cost":
      return <CostBox {...props} />;
    case "plan":
      return <PlanBox {...props} />;
    case "connectors":
      return <ConnectorsBox {...props} />;
  }
}
