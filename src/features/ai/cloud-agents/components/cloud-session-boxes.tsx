import { useElapsedSeconds } from "@/features/ai/hooks/use-elapsed-seconds";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import Badge from "@/ui/badge";
import { CloudIcon, GitBranchIcon, GitPullRequestIcon, StopIcon } from "@/ui/icons";
import { Progress } from "@/ui/progress";
import { SidebarIconButton, SidebarListItem } from "@/ui/sidebar";
import { Spinner } from "@/ui/spinner";
import { openExternalUrl } from "@/utils/external-url";
import { useAgentEnvironment } from "../hooks/use-agent-environment";
import { useCloudTargets } from "../hooks/use-cloud-targets";
import { useStopCloudRun } from "../hooks/use-stop-cloud-run";
import type { CloudAgentRun } from "../services/cloud-agents-api";
import {
  formatCreditMicros,
  formatSandboxTime,
  getRunSandboxSeconds,
  getRunSpentMicros,
  parsePullRequestUrl,
} from "../services/cloud-environment";
import { CloudBranchPicker, CloudRepoPicker } from "./cloud-target-pickers";

/** The Environment box of a cloud session: the sandbox, and the repository and branch it uses. */
export function CloudEnvironmentRows({
  chatId,
  run,
}: {
  chatId: string;
  run: CloudAgentRun | null;
}) {
  const workspacePath = useAIChatStore(
    (state) => state.chats.find((chat) => chat.id === chatId)?.workspacePath ?? null,
  );
  const environment = useAgentEnvironment({ chatId, draftKey: chatId });
  const targets = useCloudTargets(environment, workspacePath);
  return (
    <>
      <SidebarListItem
        as="div"
        interactive={false}
        density="compact"
        leading={<CloudIcon />}
        description={run?.billing === "own-key" ? "Your API key" : "Athas credit"}
      >
        Cloud sandbox
      </SidebarListItem>
      <CloudRepoPicker
        environment={environment}
        targets={targets}
        variant="row"
        disabled={environment.locked}
      />
      <CloudBranchPicker
        environment={environment}
        targets={targets}
        variant="row"
        disabled={environment.locked}
      />
      {run?.branch ? (
        <SidebarListItem
          as="div"
          interactive={false}
          density="compact"
          leading={<GitBranchIcon />}
          description="Pushes to"
        >
          {run.branch}
        </SidebarListItem>
      ) : null}
    </>
  );
}

/** The Running box of a cloud session: the sandbox's time so far and a way to stop it. */
export function CloudRunningRow({ run }: { run: CloudAgentRun }) {
  const { stop, stopping } = useStopCloudRun(run.id);
  useElapsedSeconds(run.startedAt, run.status === "running");
  const seconds = getRunSandboxSeconds(run, Date.now());
  return (
    <SidebarListItem
      as="div"
      interactive={false}
      density="compact"
      leading={<Spinner compact label="Sandbox running" />}
      description={`Up to ${run.maxMinutes} min`}
      trailing={
        <SidebarIconButton
          tone="danger"
          tooltip="Stop run"
          aria-label="Stop run"
          disabled={stopping}
          onClick={() => void stop()}
        >
          <StopIcon />
        </SidebarIconButton>
      }
    >
      {run.status === "queued" ? "Starting sandbox" : `Sandbox · ${formatSandboxTime(seconds)}`}
    </SidebarListItem>
  );
}

/** The pull request a cloud run opened, as a row of the Changes box. */
export function CloudPullRequestRow({ run }: { run: CloudAgentRun }) {
  const pullRequest = parsePullRequestUrl(run.prUrl);
  if (!run.prUrl) return null;
  return (
    <SidebarListItem
      density="compact"
      leading={<GitPullRequestIcon />}
      description={`${pullRequest ? `#${pullRequest.number} · ` : ""}${run.branch}`}
      trailing={<Badge tone="success">Draft</Badge>}
      aria-label={`Open pull request ${run.title} on GitHub`}
      onClick={() => void openExternalUrl(run.prUrl!)}
    >
      {run.title}
    </SidebarListItem>
  );
}

/** The Cost box of a cloud session: credit the run has spent, against its cap when it has one. */
export function CloudCostContent({ run }: { run: CloudAgentRun }) {
  const spent = getRunSpentMicros(run);
  const cap = run.spendCapMicros;
  const label =
    run.billing === "own-key" ? "Sandbox time, models on your key" : "Sandbox time and models";
  return (
    <div className="px-1.5 pt-0.5 pb-1.5">
      {cap ? (
        <Progress
          value={Math.min(100, (spent / cap) * 100)}
          tone={spent >= cap ? "warning" : "accent"}
          aria-label="Credit spent"
          aria-valuetext={`${formatCreditMicros(spent)} of ${formatCreditMicros(cap)}`}
        >
          <span className="text-muted-foreground">{label}</span>
          <span className="ml-auto tabular-nums text-muted-foreground">
            {formatCreditMicros(spent)} of {formatCreditMicros(cap)}
          </span>
        </Progress>
      ) : (
        <p className="text-subtle-foreground ui-text-sm">
          {formatCreditMicros(spent)} so far · {label.toLowerCase()}
        </p>
      )}
    </div>
  );
}
