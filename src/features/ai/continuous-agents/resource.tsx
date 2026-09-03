import { useEffect, useMemo, useState } from "react";
import { ProviderIcon } from "@/features/ai/components/icons/provider-icons";
import { useAgentOptions } from "@/features/ai/hooks/use-agent-options";
import { isTerminalAgent } from "@/features/ai/lib/terminal-agents";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useProjectStore } from "@/features/window/stores/project.store";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/ui/card";
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
  ArrowsClockwiseIcon as Continuous,
  ClockIcon as Clock,
  PauseIcon as Pause,
  PlayIcon as Play,
  PlusIcon as Plus,
  SparkleIcon as Sparkles,
  SquaresFourIcon as Overview,
  TrashIcon as Trash,
  WarningCircleIcon as Warning,
} from "@/ui/icons";
import Input from "@/ui/input";
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/ui/item";
import {
  ResourceViewer,
  ResourceViewerBody,
  ResourceViewerHeader,
  ResourceViewerTitle,
} from "@/ui/resource";
import Select from "@/ui/select";
import {
  SidebarFooter,
  SidebarIconButton,
  SidebarListItem,
  SidebarScrollArea,
  SidebarSection,
  SidebarWorkspace,
} from "@/ui/sidebar";
import Textarea from "@/ui/textarea";
import { ToggleGroup } from "@/ui/toggle-group";
import {
  CONTINUOUS_AGENT_CADENCES,
  formatContinuousAgentRunTime,
  getContinuousAgentCadence,
  type ContinuousAgentCadence,
} from "./continuous-agent-schedule";
import {
  CONTINUOUS_AGENT_NAME_MAX_LENGTH,
  CONTINUOUS_AGENT_PROMPT_MAX_LENGTH,
  type ContinuousAgentTask,
  useContinuousAgentsStore,
} from "./continuous-agents.store";

const GOAL_TEMPLATES = [
  {
    name: "Keep tests green",
    prompt:
      "Run the relevant test suites, investigate failures, and fix regressions without changing intentional behavior.",
  },
  {
    name: "Watch dependencies",
    prompt:
      "Review dependency health and security signals. Apply safe updates, verify compatibility, and summarize anything that needs a decision.",
  },
  {
    name: "Improve the codebase",
    prompt:
      "Find one high-leverage quality improvement in the current workspace, implement it with focused scope, and verify the result.",
  },
];

type ResourceSelection = "overview" | "create" | `task:${string}`;

function deriveGoalName(prompt: string) {
  const firstLine = prompt.trim().split("\n", 1)[0] ?? "Continuous goal";
  if (firstLine.length <= 48) return firstLine;
  return `${firstLine.slice(0, 47).trimEnd()}…`;
}

function getTaskSelection(taskId: string): ResourceSelection {
  return `task:${taskId}`;
}

function formatLastRun(lastRunAt: number | null) {
  if (lastRunAt === null) return "No runs yet";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(lastRunAt);
}

function ContinuousAgentsSidebar({
  tasks,
  runningTaskIds,
  selection,
  onSelect,
}: {
  tasks: ContinuousAgentTask[];
  runningTaskIds: Set<string>;
  selection: ResourceSelection;
  onSelect: (selection: ResourceSelection) => void;
}) {
  const activeCount = tasks.filter((task) => task.enabled).length;

  return (
    <aside
      className="w-[clamp(12rem,24vw,15rem)] shrink-0 border-border/70 border-r"
      aria-label="Continuous Agents navigation"
      data-slot="continuous-agents-sidebar"
    >
      <SidebarWorkspace
        title="Continuous Agents"
        actions={
          <SidebarIconButton
            tooltip="New continuous agent"
            aria-label="New continuous agent"
            active={selection === "create"}
            onClick={() => onSelect("create")}
          >
            <Plus />
          </SidebarIconButton>
        }
      >
        <SidebarScrollArea className="min-h-0 flex-1">
          <SidebarSection title="Workspace" forceExpanded>
            <SidebarListItem
              active={selection === "overview"}
              leading={<Overview />}
              trailing={tasks.length || undefined}
              onClick={() => onSelect("overview")}
            >
              Overview
            </SidebarListItem>
            <SidebarListItem
              active={selection === "create"}
              leading={<Plus />}
              onClick={() => onSelect("create")}
            >
              New agent
            </SidebarListItem>
          </SidebarSection>

          <SidebarSection title="Agents" defaultExpanded>
            {tasks.length > 0 ? (
              tasks.map((task) => {
                const cadence = getContinuousAgentCadence(task.cadence);
                const isRunning = runningTaskIds.has(task.id);
                return (
                  <SidebarListItem
                    key={task.id}
                    active={selection === getTaskSelection(task.id)}
                    description={cadence.label}
                    leading={<ProviderIcon providerId={task.agentId} />}
                    trailing={
                      isRunning
                        ? "Running"
                        : task.lastError
                          ? "Attention"
                          : task.enabled
                            ? "Active"
                            : "Paused"
                    }
                    onClick={() => onSelect(getTaskSelection(task.id))}
                  >
                    {task.name}
                  </SidebarListItem>
                );
              })
            ) : (
              <p className="px-1.5 py-2 text-subtle-foreground ui-text-sm">
                No continuous agents yet.
              </p>
            )}
          </SidebarSection>
        </SidebarScrollArea>

        <SidebarFooter>
          <div className="flex items-start gap-2 px-2 py-2 text-subtle-foreground ui-text-sm">
            <Clock className="mt-0.5 shrink-0" />
            <span>
              {activeCount > 0
                ? `${activeCount} active while Athas is open`
                : "Runs resume while Athas is open"}
            </span>
          </div>
        </SidebarFooter>
      </SidebarWorkspace>
    </aside>
  );
}

function OverviewContent({
  tasks,
  now,
  runningTaskIds,
  projectName,
  onCreate,
  onSelectTask,
}: {
  tasks: ContinuousAgentTask[];
  now: number;
  runningTaskIds: Set<string>;
  projectName: string;
  onCreate: () => void;
  onSelectTask: (taskId: string) => void;
}) {
  const activeCount = tasks.filter((task) => task.enabled).length;
  const totalRuns = tasks.reduce((total, task) => total + task.runCount, 0);

  return (
    <ResourceViewerBody className="space-y-8">
      <Card variant="muted">
        <CardHeader>
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <Badge variant="accent">Continuous</Badge>
            <span className="text-subtle-foreground ui-text-sm">Runs while Athas is open</span>
          </div>
          <CardTitle>Give Athas an outcome, not another reminder.</CardTitle>
          <CardDescription>
            Every cadence starts a fresh Agent session in {projectName}, keeps the workspace in
            context, and leaves a verifiable handoff in history.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button type="button" variant="accent" onClick={onCreate}>
            <Plus />
            New continuous agent
          </Button>
          {GOAL_TEMPLATES.slice(0, 2).map((template) => (
            <span
              key={template.name}
              className="inline-flex items-center gap-1.5 text-subtle-foreground ui-text-sm"
            >
              <Sparkles />
              {template.name}
            </span>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Active</CardDescription>
            <CardTitle>{activeCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Paused</CardDescription>
            <CardTitle>{tasks.length - activeCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Runs started</CardDescription>
            <CardTitle>{totalRuns}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-medium text-foreground ui-text-base">Your continuous agents</h2>
            <p className="text-subtle-foreground ui-text-sm">
              Select one to inspect its goal, schedule, and latest run.
            </p>
          </div>
          <Badge variant="muted">{tasks.length}</Badge>
        </div>

        {tasks.length > 0 ? (
          <div className="flex flex-col gap-2">
            {tasks.map((task) => {
              const cadence = getContinuousAgentCadence(task.cadence);
              const isRunning = runningTaskIds.has(task.id);
              return (
                <Item
                  key={task.id}
                  render={<button type="button" />}
                  variant="outline"
                  className="w-full text-left"
                  onClick={() => onSelectTask(task.id)}
                >
                  <ItemMedia
                    variant="icon"
                    className={task.enabled ? "text-primary" : "text-subtle-foreground"}
                  >
                    <ProviderIcon providerId={task.agentId} />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>
                      {task.name}
                      <Badge variant={isRunning || task.enabled ? "success" : "muted"}>
                        {isRunning
                          ? "Running"
                          : task.lastError
                            ? "Needs attention"
                            : task.enabled
                              ? "Active"
                              : "Paused"}
                      </Badge>
                    </ItemTitle>
                    <ItemDescription>
                      {cadence.label} ·{" "}
                      {task.runCount === 0 ? "First run ready" : `${task.runCount} runs`} ·{" "}
                      {isRunning
                        ? "Running now"
                        : task.lastError
                          ? "Needs attention"
                          : task.enabled
                            ? formatContinuousAgentRunTime(task.nextRunAt, now)
                            : "Paused"}
                    </ItemDescription>
                  </ItemContent>
                </Item>
              );
            })}
          </div>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Start with one clear outcome</CardTitle>
              <CardDescription>
                Choose an Agent and cadence. The first run begins immediately.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button type="button" variant="accent" onClick={onCreate}>
                <Plus />
                Create continuous agent
              </Button>
            </CardContent>
          </Card>
        )}
      </section>
    </ResourceViewerBody>
  );
}

function CreateContent({ onCreated }: { onCreated: (taskId: string) => void }) {
  const selectedAgentId = useAIChatStore((state) => state.selectedAgentId);
  const workspacePath = useProjectStore((state) => state.rootFolderPath ?? null);
  const createTask = useContinuousAgentsStore((state) => state.actions.createTask);
  const { options, isLoading } = useAgentOptions(selectedAgentId);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [agentId, setAgentId] = useState(selectedAgentId);
  const [cadence, setCadence] = useState<ContinuousAgentCadence>("hourly");

  const runnableAgents = useMemo(
    () =>
      options.filter(
        (option) => option.id !== "custom" && option.isInstalled && !isTerminalAgent(option.id),
      ),
    [options],
  );

  useEffect(() => {
    if (runnableAgents.some((option) => option.id === agentId)) return;
    const preferredAgent =
      runnableAgents.find((option) => option.id === selectedAgentId) ?? runnableAgents[0];
    if (preferredAgent) setAgentId(preferredAgent.id);
  }, [agentId, runnableAgents, selectedAgentId]);

  const cadenceOptions = CONTINUOUS_AGENT_CADENCES.map((option) => ({
    value: option.value,
    label: option.label,
  }));
  const agentOptions = runnableAgents.map((option) => ({
    value: option.id,
    label: option.name,
    icon: <ProviderIcon providerId={option.id} />,
  }));
  const normalizedName = name.trim() || deriveGoalName(prompt || "Continuous goal");
  const canCreate = Boolean(
    workspacePath &&
    prompt.trim() &&
    prompt.trim().length <= CONTINUOUS_AGENT_PROMPT_MAX_LENGTH &&
    normalizedName.length <= CONTINUOUS_AGENT_NAME_MAX_LENGTH &&
    agentId &&
    runnableAgents.length > 0,
  );

  const handleCreate = () => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt || !agentId || !workspacePath) return;
    const taskId = createTask({
      name: name.trim() || deriveGoalName(trimmedPrompt),
      prompt: trimmedPrompt,
      agentId,
      workspacePath,
      cadence,
    });
    setName("");
    setPrompt("");
    onCreated(taskId);
  };

  return (
    <ResourceViewerBody className="space-y-5">
      <Card variant="muted">
        <CardHeader>
          <div className="mb-1 flex items-center gap-2">
            <Badge variant="accent">New continuous agent</Badge>
          </div>
          <CardTitle>Define the outcome once.</CardTitle>
          <CardDescription>
            Athas starts one run now and continues in fresh Agent sessions on your cadence.
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Goal and schedule</CardTitle>
          <CardDescription>
            Be explicit about boundaries and what evidence should count as done.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="continuous-agent-goal">Goal</FieldLabel>
              <Textarea
                id="continuous-agent-goal"
                autoFocus
                rows={6}
                maxLength={CONTINUOUS_AGENT_PROMPT_MAX_LENGTH}
                value={prompt}
                placeholder="Keep this workspace healthy by…"
                onChange={(event) => setPrompt(event.target.value)}
              />
              <FieldDescription>
                Include the desired outcome, constraints, and verification steps.
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="continuous-agent-name">Name</FieldLabel>
              <Input
                id="continuous-agent-name"
                value={name}
                maxLength={CONTINUOUS_AGENT_NAME_MAX_LENGTH}
                placeholder={deriveGoalName(prompt || "Continuous goal")}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>

            <Field orientation="responsive">
              <FieldContent>
                <FieldTitle>Agent</FieldTitle>
                <FieldDescription>Each run starts as a fresh Agent session.</FieldDescription>
              </FieldContent>
              <Select
                value={agentId}
                options={agentOptions}
                onChange={setAgentId}
                disabled={isLoading || agentOptions.length === 0}
                placeholder={isLoading ? "Checking agents…" : "No runnable agents"}
                aria-label="Continuous agent provider"
              />
            </Field>

            <Field orientation="responsive">
              <FieldContent>
                <FieldTitle>Cadence</FieldTitle>
                <FieldDescription>
                  A due run waits if another Agent is already working.
                </FieldDescription>
              </FieldContent>
              <ToggleGroup
                value={cadence}
                onValueChange={setCadence}
                options={cadenceOptions}
                ariaLabel="Continuous agent cadence"
                variant="segmented"
                wrap
              />
            </Field>
          </FieldGroup>
          {!workspacePath ? (
            <div className="mt-4 flex items-center gap-2 text-warning ui-text-sm" role="status">
              <Warning />
              Open a workspace before creating a continuous agent.
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-subtle-foreground ui-text-sm">
          <Sparkles />
          Start from a template
        </span>
        {GOAL_TEMPLATES.map((template) => (
          <Button
            key={template.name}
            type="button"
            variant="ghost"
            onClick={() => {
              setName(template.name);
              setPrompt(template.prompt);
            }}
          >
            {template.name}
          </Button>
        ))}
      </div>

      <div className="flex justify-end border-border/70 border-t pt-5">
        <Button type="button" variant="accent" disabled={!canCreate} onClick={handleCreate}>
          <Play />
          Start continuous agent
        </Button>
      </div>
    </ResourceViewerBody>
  );
}

function TaskContent({
  task,
  isRunning,
  now,
  onDelete,
}: {
  task: ContinuousAgentTask;
  isRunning: boolean;
  now: number;
  onDelete: () => void;
}) {
  const setTaskEnabled = useContinuousAgentsStore((state) => state.actions.setTaskEnabled);
  const requestTaskRun = useContinuousAgentsStore((state) => state.actions.requestTaskRun);
  const openAgentBuffer = useBufferStore.use.actions().openAgentBuffer;
  const cadence = getContinuousAgentCadence(task.cadence);

  return (
    <ResourceViewerBody className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={isRunning || task.enabled ? "success" : "muted"}>
          {isRunning
            ? "Running"
            : task.lastError
              ? "Needs attention"
              : task.enabled
                ? "Active"
                : "Paused"}
        </Badge>
        <span className="flex items-center gap-1.5 text-subtle-foreground ui-text-sm">
          <ProviderIcon providerId={task.agentId} />
          {cadence.label}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Next run</CardDescription>
            <CardTitle>
              {isRunning
                ? "Running now"
                : task.enabled
                  ? formatContinuousAgentRunTime(task.nextRunAt, now)
                  : "Paused"}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Last run</CardDescription>
            <CardTitle>{formatLastRun(task.lastRunAt)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Runs started</CardDescription>
            <CardTitle>{task.runCount}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      {task.lastError ? (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2 text-warning">
              <Warning />
              <CardTitle>Needs attention</CardTitle>
            </div>
            <CardDescription>{task.lastError}</CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Goal</CardTitle>
          <CardDescription>The instruction each fresh session receives.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="whitespace-pre-wrap text-foreground ui-text-base">{task.prompt}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Run history</CardTitle>
          <CardDescription>
            Every run stays available as a normal Agent session with its full handoff.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {task.lastChatId ? (
            <Button
              type="button"
              variant="default"
              onClick={() => openAgentBuffer(task.lastChatId!)}
            >
              Open latest session
            </Button>
          ) : (
            <span className="text-subtle-foreground ui-text-sm">
              The first session will appear here when the Agent starts.
            </span>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2 border-border/70 border-t pt-5">
        <Button
          type="button"
          variant="accent"
          disabled={isRunning}
          onClick={() => requestTaskRun(task.id)}
        >
          <Play />
          Run now
        </Button>
        <Button
          type="button"
          variant="default"
          onClick={() => setTaskEnabled(task.id, !task.enabled)}
        >
          {task.enabled ? <Pause /> : <Continuous />}
          {task.enabled ? "Pause" : "Resume"}
        </Button>
        <Button type="button" variant="danger" className="ml-auto" onClick={onDelete}>
          <Trash />
          Delete
        </Button>
      </div>
    </ResourceViewerBody>
  );
}

export default function ContinuousAgentsResource() {
  const workspacePath = useProjectStore((state) => state.rootFolderPath ?? null);
  const projectName = useProjectStore((state) => state.projectName);
  const tasks = useContinuousAgentsStore((state) => state.tasks);
  const deleteTask = useContinuousAgentsStore((state) => state.actions.deleteTask);
  const pendingAgentLaunchRequest = useAIChatStore((state) => state.pendingAgentLaunchRequest);
  const agentRuns = useAIChatStore((state) => state.agentRuns);
  const [selection, setSelection] = useState<ResourceSelection>("overview");
  const [now, setNow] = useState(() => Date.now());

  const workspaceTasks = useMemo(
    () => tasks.filter((task) => task.workspacePath === workspacePath),
    [tasks, workspacePath],
  );
  const selectedTaskId = selection.startsWith("task:") ? selection.slice(5) : null;
  const selectedTask = selectedTaskId
    ? (workspaceTasks.find((task) => task.id === selectedTaskId) ?? null)
    : null;
  const runningTaskIds = useMemo(() => {
    const activeChatIds = new Set(Object.keys(agentRuns));
    if (pendingAgentLaunchRequest) activeChatIds.add(pendingAgentLaunchRequest.chatId);
    return new Set(
      workspaceTasks
        .filter((task) => task.lastChatId && activeChatIds.has(task.lastChatId))
        .map((task) => task.id),
    );
  }, [agentRuns, pendingAgentLaunchRequest, workspaceTasks]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (selectedTaskId && !selectedTask) setSelection("overview");
  }, [selectedTask, selectedTaskId]);

  const handleDelete = async () => {
    if (!selectedTask) return;
    const confirmed = await showConfirmDialog(
      <>
        Delete <strong>{selectedTask.name}</strong>? Its previous Agent sessions will stay in
        history.
      </>,
      {
        title: "Delete continuous agent",
        confirmLabel: "Delete",
      },
    );
    if (!confirmed) return;
    deleteTask(selectedTask.id);
    setSelection("overview");
  };

  const pageTitle =
    selection === "create" ? "New agent" : selectedTask?.name ? selectedTask.name : "Overview";

  return (
    <div
      className="flex size-full min-h-0 min-w-0 overflow-hidden bg-background"
      data-slot="continuous-agents-resource"
    >
      <ContinuousAgentsSidebar
        tasks={workspaceTasks}
        runningTaskIds={runningTaskIds}
        selection={selection}
        onSelect={setSelection}
      />

      <main className="min-w-0 flex-1">
        <ResourceViewer
          header={
            <ResourceViewerHeader
              leading={<Continuous />}
              title={
                <ResourceViewerTitle
                  kind="Continuous Agents"
                  title={pageTitle}
                  ariaLabel="Continuous Agents"
                />
              }
              meta={`${workspaceTasks.length} agent${workspaceTasks.length === 1 ? "" : "s"}`}
              actions={
                selection !== "create" ? (
                  <Button type="button" variant="ghost" onClick={() => setSelection("create")}>
                    <Plus />
                    New agent
                  </Button>
                ) : undefined
              }
            />
          }
        >
          {selection === "create" ? (
            <CreateContent onCreated={(taskId) => setSelection(getTaskSelection(taskId))} />
          ) : selectedTask ? (
            <TaskContent
              task={selectedTask}
              isRunning={runningTaskIds.has(selectedTask.id)}
              now={now}
              onDelete={() => void handleDelete()}
            />
          ) : (
            <OverviewContent
              tasks={workspaceTasks}
              now={now}
              runningTaskIds={runningTaskIds}
              projectName={projectName}
              onCreate={() => setSelection("create")}
              onSelectTask={(taskId) => setSelection(getTaskSelection(taskId))}
            />
          )}
        </ResourceViewer>
      </main>
    </div>
  );
}
