import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  getProviderApiToken,
  onProviderApiTokenChange,
} from "@/features/ai/services/ai-token-service";
import { useProFeature } from "@/features/auth/hooks/use-pro-feature";
import { useGitStore } from "@/features/git/stores/git.store";
import { useUIState } from "@/features/layout/stores/ui-state.store";
import { resolveProjectGitHubRepository } from "@/features/views/services/view-github";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import { Alert, AlertActions, AlertDescription, AlertTitle } from "@/ui/alert";
import Badge, { type BadgeTone } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/ui/card";
import { CodeOutput } from "@/ui/code-output";
import { showConfirmDialog } from "@/ui/dialog";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/ui/field";
import {
  BroadcastIcon,
  CheckCircleIcon,
  CloudIcon,
  GitPullRequestIcon,
  KeyIcon,
  MinusCircleIcon,
  OpenExternalIcon,
  PlayIcon,
  PlusIcon,
  StopIcon,
  WarningCircleIcon,
  XCircleIcon,
} from "@/ui/icons";
import Input from "@/ui/input";
import { ResourceDocument, ResourceSummary } from "@/ui/resource";
import {
  SidebarFooter,
  SidebarIconButton,
  SidebarListItem,
  SidebarScrollArea,
  SidebarSection,
  SidebarWorkspace,
} from "@/ui/sidebar";
import { Spinner } from "@/ui/spinner";
import Textarea from "@/ui/textarea";
import { ToggleGroup } from "@/ui/toggle-group";
import { createSandboxPreview } from "@/features/previews/services/previews-api";
import { parsePortInput } from "@/features/previews/services/preview-display";
import { tryWriteClipboardText } from "@/utils/clipboard";
import { openExternalUrl } from "@/utils/external-url";
import { formatCloudAgentLogLine } from "./cloud-agent-log-format";
import {
  type CloudAgentId,
  type CloudAgentRun,
  type CloudAgentRunStatus,
  CloudAgentsError,
  cancelCloudAgentRun,
  isActiveCloudAgentRun,
  startCloudAgentRun,
} from "./cloud-agents-api";
import { cloudAgentKeys, cloudAgentRunsQuery, providerKeyQuery } from "./cloud-agents-queries";
import { useCloudAgentLogs } from "./use-cloud-agent-logs";

const AGENTS: Array<{ value: CloudAgentId; label: string; provider: "anthropic" | "openai" }> = [
  { value: "claude-code", label: "Claude Code", provider: "anthropic" },
  { value: "codex", label: "Codex", provider: "openai" },
];

const TIME_LIMITS = [
  { value: "30", label: "30 min" },
  { value: "60", label: "1 hour" },
  { value: "120", label: "2 hours" },
];

const PROMPT_MAX_LENGTH = 20_000;
const SANDBOX_HOURLY_USD = 0.4;

const STATUS: Record<CloudAgentRunStatus, { label: string; tone: BadgeTone }> = {
  queued: { label: "Starting", tone: "info" },
  running: { label: "Running", tone: "accent" },
  succeeded: { label: "Pull request opened", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

type Selection = "create" | `run:${string}`;

function RunStatusIcon({ status }: { status: CloudAgentRunStatus }) {
  const { label } = STATUS[status];
  if (status === "queued" || status === "running") return <Spinner label={label} compact />;
  if (status === "succeeded")
    return <CheckCircleIcon role="img" aria-label={label} className="text-success" />;
  if (status === "failed")
    return <XCircleIcon role="img" aria-label={label} className="text-destructive" />;
  return <MinusCircleIcon role="img" aria-label={label} className="text-subtle-foreground" />;
}

function agentLabel(agent: CloudAgentId) {
  return AGENTS.find((option) => option.value === agent)!.label;
}

function formatDuration(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function formatCents(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function CloudAgentsSidebar({
  runs,
  selection,
  onSelect,
}: {
  runs: CloudAgentRun[];
  selection: Selection;
  onSelect: (selection: Selection) => void;
}) {
  const activeCount = runs.filter(isActiveCloudAgentRun).length;

  return (
    <aside
      className="w-[clamp(12rem,24vw,15rem)] shrink-0 border-border border-r"
      aria-label="Cloud Agents navigation"
    >
      <SidebarWorkspace
        title="Cloud Agents"
        actions={
          <SidebarIconButton
            tooltip="New cloud run"
            aria-label="New cloud run"
            active={selection === "create"}
            onClick={() => onSelect("create")}
          >
            <PlusIcon />
          </SidebarIconButton>
        }
      >
        <SidebarScrollArea>
          <SidebarSection title="Runs" forceExpanded>
            <SidebarListItem
              active={selection === "create"}
              leading={<PlusIcon />}
              onClick={() => onSelect("create")}
            >
              New run
            </SidebarListItem>
            {runs.map((run) => (
              <SidebarListItem
                key={run.id}
                active={selection === `run:${run.id}`}
                description={run.repo}
                leading={<RunStatusIcon status={run.status} />}
                onClick={() => onSelect(`run:${run.id}`)}
              >
                {run.title}
              </SidebarListItem>
            ))}
          </SidebarSection>
        </SidebarScrollArea>
        <SidebarFooter>
          <div className="flex items-start gap-2 px-2 py-2 text-subtle-foreground ui-text-sm">
            <CloudIcon className="mt-0.5 shrink-0" />
            <span>
              {activeCount > 0
                ? `${activeCount} running in the cloud`
                : "Runs continue with Athas closed"}
            </span>
          </div>
        </SidebarFooter>
      </SidebarWorkspace>
    </aside>
  );
}

function CreateRun({ onStarted }: { onStarted: (run: CloudAgentRun) => void }) {
  const queryClient = useQueryClient();
  const workspacePath = useProjectStore((state) => state.rootFolderPath ?? null);
  const currentBranch = useGitStore((state) => state.gitStatus?.branch ?? null);
  const [repo, setRepo] = useState("");
  const [baseBranch, setBaseBranch] = useState("");
  const [prompt, setPrompt] = useState("");
  const [agent, setAgent] = useState<CloudAgentId>("claude-code");
  const [timeLimit, setTimeLimit] = useState("60");
  const provider = AGENTS.find((option) => option.value === agent)!.provider;
  const keyQuery = useQuery(providerKeyQuery(provider));

  useEffect(
    () =>
      onProviderApiTokenChange((providerId) => {
        void queryClient.invalidateQueries({ queryKey: cloudAgentKeys.providerKey(providerId) });
      }),
    [queryClient],
  );

  useEffect(() => {
    if (!workspacePath) return;
    let cancelled = false;
    void resolveProjectGitHubRepository(workspacePath)
      .then((repository) => {
        if (!cancelled && repository) setRepo(`${repository.owner}/${repository.repo}`);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [workspacePath]);

  useEffect(() => {
    if (currentBranch) setBaseBranch((value) => value || currentBranch);
  }, [currentBranch]);

  const start = useMutation({
    mutationFn: async () => {
      const key = await getProviderApiToken(provider);
      if (!key) throw new CloudAgentsError("Add your API key in Settings > AI first.", 400);
      return startCloudAgentRun({
        repo: repo.trim(),
        baseBranch: baseBranch.trim(),
        prompt: prompt.trim(),
        agent,
        maxMinutes: Number(timeLimit),
        credentials: provider === "anthropic" ? { anthropicApiKey: key } : { openaiApiKey: key },
      });
    },
    onSuccess: (run) => {
      queryClient.setQueryData<CloudAgentRun[]>(cloudAgentKeys.runs(), (runs) => [
        run,
        ...(runs ?? []),
      ]);
      void queryClient.invalidateQueries({ queryKey: cloudAgentKeys.runs() });
      setPrompt("");
      onStarted(run);
    },
    onError: (error) => toast.error(error.message),
  });

  const canStart = Boolean(
    /^[\w.-]+\/[\w.-]+$/.test(repo.trim()) &&
    baseBranch.trim() &&
    prompt.trim() &&
    keyQuery.data &&
    !start.isPending,
  );
  const maxCost = (Number(timeLimit) / 60) * SANDBOX_HOURLY_USD;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <div className="mb-1 flex items-center gap-2">
            <Badge tone="accent">Cloud</Badge>
            <span className="text-subtle-foreground ui-text-sm">
              ${SANDBOX_HOURLY_USD.toFixed(2)} per sandbox hour, from your Athas credit
            </span>
          </div>
          <CardTitle>Start an agent, close your laptop, review a pull request.</CardTitle>
          <CardDescription>
            The agent works on a fresh clone in an isolated sandbox with your own model key, then
            Athas opens a draft pull request with its changes.
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="cloud-agent-prompt">Task</FieldLabel>
              <Textarea
                id="cloud-agent-prompt"
                autoFocus
                rows={6}
                maxLength={PROMPT_MAX_LENGTH}
                value={prompt}
                placeholder="Fix the failing date parsing tests and…"
                onChange={(event) => setPrompt(event.target.value)}
              />
              <FieldDescription>
                Describe the change and how to verify it. The first line becomes the pull request
                title.
              </FieldDescription>
            </Field>

            <Field orientation="responsive">
              <FieldContent>
                <FieldTitle>Repository</FieldTitle>
                <FieldDescription>A GitHub repository you connected to Athas.</FieldDescription>
              </FieldContent>
              <Input
                aria-label="Repository"
                value={repo}
                placeholder="owner/name"
                onChange={(event) => setRepo(event.target.value)}
              />
            </Field>

            <Field orientation="responsive">
              <FieldContent>
                <FieldTitle>Base branch</FieldTitle>
                <FieldDescription>
                  The agent branches from its latest pushed commit.
                </FieldDescription>
              </FieldContent>
              <Input
                aria-label="Base branch"
                value={baseBranch}
                placeholder="main"
                onChange={(event) => setBaseBranch(event.target.value)}
              />
            </Field>

            <Field orientation="responsive">
              <FieldContent>
                <FieldTitle>Agent</FieldTitle>
                <FieldDescription>
                  Runs with your own API key, which Athas never stores.
                </FieldDescription>
              </FieldContent>
              <ToggleGroup
                value={agent}
                onValueChange={setAgent}
                options={AGENTS.map(({ value, label }) => ({ value, label }))}
                ariaLabel="Cloud agent"
                variant="segmented"
              />
            </Field>

            <Field orientation="responsive">
              <FieldContent>
                <FieldTitle>Time limit</FieldTitle>
                <FieldDescription>
                  You pay for the time used, at most {formatCents(maxCost * 100)}.
                </FieldDescription>
              </FieldContent>
              <ToggleGroup
                value={timeLimit}
                onValueChange={setTimeLimit}
                options={TIME_LIMITS}
                ariaLabel="Time limit"
                variant="segmented"
              />
            </Field>
          </FieldGroup>
          {keyQuery.data === false ? (
            <Alert tone="warning" role="status" className="mt-4">
              <KeyIcon />
              <AlertTitle>API key needed</AlertTitle>
              <AlertDescription>
                Add your {provider === "anthropic" ? "Anthropic" : "OpenAI"} API key to run{" "}
                {agentLabel(agent)}.
              </AlertDescription>
              <AlertActions>
                <Button
                  type="button"
                  onClick={() => useUIState.getState().openSettings("ai-models", "API keys")}
                >
                  Add key
                </Button>
              </AlertActions>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      <div className="flex justify-end border-border border-t pt-5">
        <Button type="button" variant="accent" disabled={!canStart} onClick={() => start.mutate()}>
          <PlayIcon />
          {start.isPending ? "Starting…" : "Run in the cloud"}
        </Button>
      </div>
    </div>
  );
}

function PreviewPort({ runId }: { runId: string }) {
  const [portInput, setPortInput] = useState("");
  const port = parsePortInput(portInput);
  const preview = useMutation({
    mutationFn: (value: number) => createSandboxPreview(runId, value),
    onSuccess: async (created) => {
      const copied = await tryWriteClipboardText(created.url);
      toast.success(copied ? "Preview link copied" : "Preview ready");
      void openExternalUrl(created.url);
    },
    onError: (cause) => toast.error(cause.message),
  });

  return (
    <section className="space-y-2" aria-labelledby={`preview-port-${runId}`}>
      <h2 id={`preview-port-${runId}`} className="font-medium text-foreground ui-text-base">
        Preview
      </h2>
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (port !== null) preview.mutate(port);
        }}
      >
        <Input
          aria-label="Sandbox port"
          inputMode="numeric"
          placeholder="3000"
          value={portInput}
          onChange={(event) => setPortInput(event.target.value)}
        />
        <Button type="submit" disabled={port === null || preview.isPending}>
          <BroadcastIcon />
          {preview.isPending ? "Opening…" : "Preview port"}
        </Button>
      </form>
      <p className="text-subtle-foreground ui-text-sm">
        Opens a temporary link to a server the agent started in its sandbox. The server must listen
        on 0.0.0.0, and the link stops working when the run ends.
      </p>
    </section>
  );
}

function RunDetails({ run }: { run: CloudAgentRun }) {
  const queryClient = useQueryClient();
  const { hasPreviews } = useProFeature();
  const active = isActiveCloudAgentRun(run);
  const { lines, error } = useCloudAgentLogs(run.id, active);
  const output = useMemo(
    () =>
      lines
        .map(formatCloudAgentLogLine)
        .filter((text): text is string => text !== null)
        .join("\n"),
    [lines],
  );
  const cancel = useMutation({
    mutationFn: () => cancelCloudAgentRun(run.id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: cloudAgentKeys.runs() }),
    onError: (cause) => toast.error(cause.message),
  });

  const handleCancel = async () => {
    const confirmed = await showConfirmDialog(
      "Stop this run? The agent's work so far is discarded and you pay for the time used.",
      { title: "Stop cloud run", confirmLabel: "Stop" },
    );
    if (confirmed) cancel.mutate();
  };

  return (
    <ResourceDocument
      summary={
        <ResourceSummary
          icon={<CloudIcon className="text-subtle-foreground" />}
          title={run.title}
          badges={<Badge tone={STATUS[run.status].tone}>{STATUS[run.status].label}</Badge>}
          description={`${agentLabel(run.agent)} · ${run.repo} · ${run.baseBranch}`}
          meta={
            <span className="text-subtle-foreground ui-text-sm">
              {active
                ? `Up to ${run.maxMinutes} min, holding ${formatCents(run.holdCents)} until it finishes.`
                : `${formatDuration(run.billedSeconds)} in the sandbox, ${formatCents(run.chargedCents)} charged.`}
            </span>
          }
          actions={
            <>
              {run.prUrl ? (
                <Button
                  type="button"
                  variant="accent"
                  onClick={() => void openExternalUrl(run.prUrl!)}
                >
                  <GitPullRequestIcon />
                  Open pull request
                  <OpenExternalIcon />
                </Button>
              ) : null}
              {active ? (
                <Button
                  type="button"
                  tone="danger"
                  disabled={cancel.isPending}
                  onClick={() => void handleCancel()}
                >
                  <StopIcon />
                  Stop run
                </Button>
              ) : null}
            </>
          }
        />
      }
    >
      <div className="space-y-5">
        {run.error ? (
          <Alert tone="error">
            <WarningCircleIcon />
            <AlertTitle>Run failed</AlertTitle>
            <AlertDescription>{run.error}</AlertDescription>
          </Alert>
        ) : null}

        {run.status === "running" && hasPreviews ? <PreviewPort runId={run.id} /> : null}

        <section className="space-y-2">
          <h2 className="font-medium text-foreground ui-text-base">Activity</h2>
          {error ? <p className="text-subtle-foreground ui-text-sm">{error}</p> : null}
          <CodeOutput tone="muted" height="auto" aria-live="polite">
            {output || (active ? "Waiting for the sandbox…" : "No activity was recorded.")}
          </CodeOutput>
        </section>
      </div>
    </ResourceDocument>
  );
}

function UpgradeCard() {
  const { isPro } = useProFeature();

  if (isPro) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Cloud agents are not available yet.</CardTitle>
          <CardDescription>
            Your plan includes them, but they are not turned on for your account yet. Check back
            after the next Athas update.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="mb-1 flex items-center gap-2">
          <Badge tone="accent">Pro</Badge>
        </div>
        <CardTitle>Cloud agents are part of Athas Pro.</CardTitle>
        <CardDescription>
          Run Claude Code or Codex in an isolated cloud sandbox and get a draft pull request, even
          with Athas closed.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          type="button"
          variant="accent"
          onClick={() => void openExternalUrl("https://athas.dev/pricing")}
        >
          See plans
          <OpenExternalIcon />
        </Button>
      </CardContent>
    </Card>
  );
}

export default function CloudAgentsResource() {
  const { hasCloudAgents } = useProFeature();
  const runsQuery = useQuery(cloudAgentRunsQuery(hasCloudAgents));
  const runs = runsQuery.data ?? [];
  const [selection, setSelection] = useState<Selection>("create");
  const selectedRun = selection.startsWith("run:")
    ? (runs.find((run) => `run:${run.id}` === selection) ?? null)
    : null;

  useEffect(() => {
    if (selection.startsWith("run:") && runsQuery.isSuccess && !selectedRun) setSelection("create");
  }, [runsQuery.isSuccess, selectedRun, selection]);

  return (
    <div className="flex size-full min-h-0 min-w-0 overflow-hidden bg-background">
      {hasCloudAgents ? (
        <CloudAgentsSidebar runs={runs} selection={selection} onSelect={setSelection} />
      ) : null}
      <main className="min-w-0 flex-1">
        {hasCloudAgents && selectedRun ? (
          <RunDetails key={selectedRun.id} run={selectedRun} />
        ) : (
          <ResourceDocument
            summary={
              <ResourceSummary
                icon={<CloudIcon className="text-subtle-foreground" />}
                title={hasCloudAgents ? "New cloud run" : "Cloud Agents"}
              />
            }
          >
            {hasCloudAgents ? (
              <CreateRun onStarted={(run) => setSelection(`run:${run.id}`)} />
            ) : (
              <UpgradeCard />
            )}
          </ResourceDocument>
        )}
      </main>
    </div>
  );
}
