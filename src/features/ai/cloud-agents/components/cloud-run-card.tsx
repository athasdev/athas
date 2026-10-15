import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useElapsedSeconds } from "@/features/ai/hooks/use-elapsed-seconds";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import type { ChatCloudRun } from "@/features/ai/types/ai-chat.types";
import { Alert, AlertActions, AlertDescription, AlertTitle } from "@/ui/alert";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/ui/item";
import Badge from "@/ui/badge";
import { GithubMark } from "@/ui/brand-marks";
import { Button } from "@/ui/button";
import { Card } from "@/ui/card";
import { CodeOutput } from "@/ui/code-output";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  CloudIcon,
  CloudWarningIcon,
  GitPullRequestIcon,
  MinusCircleIcon,
  StopIcon,
  WarningCircleIcon,
} from "@/ui/icons";
import { Spinner } from "@/ui/spinner";
import { openExternalUrl } from "@/utils/external-url";
import { useCloudRun } from "../hooks/use-cloud-runs";
import { useStopCloudRun } from "../hooks/use-stop-cloud-run";
import { type CloudAgentRun, isActiveCloudAgentRun } from "../services/cloud-agents-api";
import {
  describeCloudProblem,
  formatCreditMicros,
  formatSandboxTime,
  getRunSandboxSeconds,
  getRunSpentMicros,
  parsePullRequestUrl,
} from "../services/cloud-environment";
import { openCloudProblemPage } from "../services/cloud-problem-actions";
import { readCloudRunLog } from "../services/cloud-run-log";
import { formatCloudRunLog } from "../services/cloud-run-transcript";
import { retryCloudRun } from "../services/cloud-session";
import { selectCloudRunLog, useCloudEnvironmentStore } from "../stores/cloud-environment.store";

function useRunMeta(run: CloudAgentRun) {
  const active = isActiveCloudAgentRun(run);
  useElapsedSeconds(run.startedAt, active && run.status === "running");
  const seconds = getRunSandboxSeconds(run, Date.now());
  const spent = getRunSpentMicros(run);
  return [
    run.status === "queued" ? "Starting sandbox" : `${formatSandboxTime(seconds)} in the sandbox`,
    spent > 0
      ? `${formatCreditMicros(spent)} ${run.billing === "own-key" ? "sandbox" : "credit"}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function LogToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <Button type="button" size="xs" variant="ghost" aria-expanded={open} onClick={onToggle}>
      {open ? <ChevronDownIcon /> : <ChevronRightIcon />}
      Log
    </Button>
  );
}

function RunLog({ runId }: { runId: string }) {
  const log = useCloudEnvironmentStore((state) => selectCloudRunLog(state, runId));
  const text = useMemo(() => formatCloudRunLog(log.lines), [log.lines]);
  useEffect(() => {
    if (!log.loaded) void readCloudRunLog(runId);
  }, [log.loaded, runId]);
  return (
    <div className="px-3 py-2">
      <CodeOutput tone="muted" aria-live="polite">
        {log.error && !text
          ? log.error
          : text || (log.loaded ? "Nothing was logged yet." : "Reading the log…")}
      </CodeOutput>
    </div>
  );
}

function RunRow({
  icon,
  title,
  description,
  actions,
}: {
  icon: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <Item variant="list">
      <ItemMedia variant="icon">{icon}</ItemMedia>
      <ItemContent>
        <ItemTitle>{title}</ItemTitle>
        {description ? <ItemDescription>{description}</ItemDescription> : null}
      </ItemContent>
      {actions ? <ItemActions>{actions}</ItemActions> : null}
    </Item>
  );
}

function ActiveRunCard({ run }: { run: CloudAgentRun }) {
  const [logOpen, setLogOpen] = useState(false);
  const { stop, stopping } = useStopCloudRun(run.id);
  const meta = useRunMeta(run);
  const status = useCloudEnvironmentStore((state) => {
    const lines = selectCloudRunLog(state, run.id).lines;
    const last = lines[lines.length - 1];
    return last?.stream === "system" ? last.text.trim() || null : null;
  });

  return (
    <Card layout="list" data-slot="cloud-run-card" data-status={run.status}>
      <RunRow
        icon={<Spinner compact label="Running in the cloud" />}
        title={
          status ?? (run.status === "queued" ? "Starting the sandbox" : "Working in the cloud")
        }
        description={`${run.repo} · ${run.baseBranch} · ${meta}`}
        actions={
          <>
            <LogToggle open={logOpen} onToggle={() => setLogOpen((open) => !open)} />
            <Button
              type="button"
              size="xs"
              variant="ghost"
              tone="danger"
              disabled={stopping}
              onClick={() => void stop()}
            >
              <StopIcon />
              Stop
            </Button>
          </>
        }
      />
      {logOpen ? <RunLog runId={run.id} /> : null}
    </Card>
  );
}

function PullRequestCard({ run }: { run: CloudAgentRun }) {
  const [logOpen, setLogOpen] = useState(false);
  const meta = useRunMeta(run);
  const pullRequest = parsePullRequestUrl(run.prUrl);
  return (
    <Card layout="list" data-slot="cloud-run-card" data-status={run.status}>
      <RunRow
        icon={<GitPullRequestIcon className="text-success" />}
        title={run.title}
        description={`${pullRequest ? `${pullRequest.repo} #${pullRequest.number}` : run.repo} · ${run.branch} → ${run.baseBranch}`}
        actions={<Badge tone="success">Draft</Badge>}
      />
      <RunRow
        icon={<CloudIcon />}
        title={meta}
        actions={
          <>
            <LogToggle open={logOpen} onToggle={() => setLogOpen((open) => !open)} />
            <Button type="button" size="xs" onClick={() => void openExternalUrl(run.prUrl!)}>
              <GithubMark />
              Open on GitHub
            </Button>
          </>
        }
      />
      {logOpen ? <RunLog runId={run.id} /> : null}
    </Card>
  );
}

function FinishedRunCard({ run }: { run: CloudAgentRun }) {
  const [logOpen, setLogOpen] = useState(false);
  const meta = useRunMeta(run);
  const failed = run.status === "failed";
  return (
    <Card layout="list" data-slot="cloud-run-card" data-status={run.status}>
      <RunRow
        icon={
          failed ? (
            <WarningCircleIcon className="text-destructive" />
          ) : run.status === "cancelled" ? (
            <MinusCircleIcon />
          ) : (
            <CloudIcon />
          )
        }
        title={
          failed
            ? "The run failed"
            : run.status === "cancelled"
              ? "Run stopped"
              : "Finished without changes to push"
        }
        description={
          failed ? run.error || "The agent stopped before it opened a pull request." : meta
        }
        actions={<LogToggle open={logOpen} onToggle={() => setLogOpen((open) => !open)} />}
      />
      {logOpen ? <RunLog runId={run.id} /> : null}
    </Card>
  );
}

function RefusedRunCard({
  chatId,
  entry,
}: {
  chatId: string;
  entry: ChatCloudRun & { error: NonNullable<ChatCloudRun["error"]> };
}) {
  const problem = describeCloudProblem(entry.error);
  const action = problem.action;
  return (
    <Alert
      tone={action === "retry" ? "error" : "warning"}
      data-slot="cloud-run-card"
      data-status="refused"
    >
      <CloudWarningIcon />
      <AlertTitle>{problem.title}</AlertTitle>
      <AlertDescription>{problem.description}</AlertDescription>
      {action && problem.actionLabel ? (
        <AlertActions>
          <Button
            type="button"
            size="xs"
            onClick={() =>
              action === "retry"
                ? retryCloudRun(chatId, entry.messageId)
                : openCloudProblemPage(action)
            }
          >
            {problem.actionLabel}
          </Button>
        </AlertActions>
      ) : null}
    </Alert>
  );
}

/**
 * Where a cloud run stands, under the reply it writes: working with a way to stop it, the pull
 * request it opened, or why it failed or could not start.
 */
export function CloudRunCard({ chatId, messageId }: { chatId: string; messageId: string }) {
  const entry = useAIChatStore((state) =>
    state.chats
      .find((chat) => chat.id === chatId)
      ?.sessionSettings?.cloud?.runs.find((run) => run.messageId === messageId),
  );
  const run = useCloudRun(entry?.runId);
  if (!entry) return null;

  let card: ReactNode = null;
  if (entry.error)
    card = <RefusedRunCard chatId={chatId} entry={{ ...entry, error: entry.error }} />;
  else if (!run) card = null;
  else if (isActiveCloudAgentRun(run)) card = <ActiveRunCard run={run} />;
  else if (run.status === "succeeded" && run.prUrl) card = <PullRequestCard run={run} />;
  else card = <FinishedRunCard run={run} />;

  return card ? <div className="mt-2 flex flex-col">{card}</div> : null;
}
