import { openAgentWindowSession } from "@/features/ai/detached/services/agent-window-service";
import { getProviderApiToken } from "@/features/ai/services/ai-token-service";
import { openAgentHistoryChat } from "@/features/ai/services/open-agent-history";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import type {
  AgentMessageSubmitResult,
  ChatCloudEnvironment,
  ChatCloudRun,
  Message,
} from "@/features/ai/types/ai-chat.types";
import { getFallbackAgentSessionTitle } from "@/features/ai/utils/chat-session-title";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { queryClient } from "@/utils/query-client";
import { useCloudEnvironmentStore } from "../stores/cloud-environment.store";
import {
  type CloudAgentCredentials,
  type CloudAgentId,
  type CloudAgentRun,
  CloudAgentsError,
  cancelCloudAgentRun,
  isActiveCloudAgentRun,
  startCloudAgentRun,
} from "./cloud-agents-api";
import { cloudAgentKeys } from "./cloud-agents-queries";
import {
  DEFAULT_CLOUD_AGENT_ID,
  emptyCloudEnvironment,
  fromCloudAgentId,
  getLatestCloudRun,
  getNextRunBaseBranch,
  toCloudAgentId,
  toCloudRunError,
} from "./cloud-environment";

const createId = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export function getChatCloudEnvironment(chatId: string | null | undefined) {
  if (!chatId) return null;
  return (
    useAIChatStore.getState().chats.find((chat) => chat.id === chatId)?.sessionSettings?.cloud ??
    null
  );
}

export function getCachedCloudRun(runId: string | null | undefined): CloudAgentRun | null {
  if (!runId) return null;
  return (
    queryClient
      .getQueryData<CloudAgentRun[]>(cloudAgentKeys.runs())
      ?.find((run) => run.id === runId) ?? null
  );
}

function rememberRun(run: CloudAgentRun) {
  queryClient.setQueryData<CloudAgentRun[]>(cloudAgentKeys.runs(), (runs) => [
    run,
    ...(runs ?? []).filter((candidate) => candidate.id !== run.id),
  ]);
  void queryClient.invalidateQueries({ queryKey: cloudAgentKeys.runs() });
}

function updateCloudEnvironment(
  chatId: string,
  update: (cloud: ChatCloudEnvironment) => ChatCloudEnvironment,
) {
  const cloud = getChatCloudEnvironment(chatId);
  if (!cloud) return;
  useAIChatStore.getState().actions.setChatCloudEnvironment(chatId, update(cloud));
}

function updateCloudRun(chatId: string, messageId: string, patch: Partial<ChatCloudRun>) {
  updateCloudEnvironment(chatId, (cloud) => ({
    ...cloud,
    runs: cloud.runs.map((run) => (run.messageId === messageId ? { ...run, ...patch } : run)),
  }));
}

/** Turns a session's runs to the cloud, or back to this machine. */
export function setChatEnvironmentKind(chatId: string, kind: "local" | "cloud") {
  const { actions } = useAIChatStore.getState();
  const cloud = getChatCloudEnvironment(chatId);
  if (kind === "local") {
    if (cloud && cloud.runs.length === 0) actions.setChatCloudEnvironment(chatId, null);
    return;
  }
  if (!cloud) actions.setChatCloudEnvironment(chatId, emptyCloudEnvironment());
}

export function setChatCloudTarget(
  chatId: string,
  patch: Partial<Pick<ChatCloudEnvironment, "repo" | "branch">>,
) {
  updateCloudEnvironment(chatId, (cloud) => {
    const next = { ...cloud, ...patch };
    // Another repository has other branches; the default one is picked again.
    if (patch.repo !== undefined && patch.repo !== cloud.repo && patch.branch === undefined)
      next.branch = null;
    return next;
  });
}

/**
 * The key to send when the user chose to run on their own API key; nothing otherwise, and the run
 * spends Athas credit.
 */
async function resolveCredentials(agent: CloudAgentId): Promise<CloudAgentCredentials | undefined> {
  if (!useCloudEnvironmentStore.getState().preferences.useOwnKey) return undefined;
  const providerId = agent === "codex" ? "openai" : "anthropic";
  const key = await getProviderApiToken(providerId);
  if (!key)
    throw new CloudAgentsError(
      `Add your ${agent === "codex" ? "OpenAI" : "Anthropic"} API key in Settings > AI, or turn off "Use my own API key".`,
      400,
      "missing_credentials",
    );
  return agent === "codex" ? { openaiApiKey: key } : { anthropicApiKey: key };
}

async function requestRun(
  chatId: string,
  messageId: string,
  input: { repo: string; baseBranch: string; prompt: string; agent: CloudAgentId; title?: string },
) {
  try {
    const credentials = await resolveCredentials(input.agent);
    const run = await startCloudAgentRun({
      ...input,
      maxMinutes: useCloudEnvironmentStore.getState().preferences.maxMinutes,
      ...(credentials ? { credentials } : {}),
    });
    rememberRun(run);
    updateCloudRun(chatId, messageId, { runId: run.id, error: null });
  } catch (error) {
    updateCloudRun(chatId, messageId, { runId: null, error: toCloudRunError(error) });
    useAIChatStore.getState().actions.updateMessage(chatId, messageId, {
      isStreaming: false,
      responsePhase: undefined,
    });
  }
}

/** Why a session cannot send its next prompt to the cloud, or null when it can. */
export function getCloudSendBlocker(chatId: string): string | null {
  const chat = useAIChatStore.getState().chats.find((candidate) => candidate.id === chatId);
  const cloud = chat?.sessionSettings?.cloud;
  if (!chat || !cloud) return "This session does not run in the cloud.";
  if (!toCloudAgentId(chat.agentId))
    return "Cloud runs use Claude Code or Codex. Switch the agent to run this in the cloud.";
  const latest = getLatestCloudRun(cloud);
  if (latest && !latest.error) {
    const run = getCachedCloudRun(latest.runId);
    if (!latest.runId || (run && isActiveCloudAgentRun(run)))
      return "The cloud run is still working. Stop it or wait for it to finish.";
  }
  if (!cloud.repo) return "Pick a GitHub repository for the cloud run.";
  if (!getNextRunBaseBranch(cloud, getCachedCloudRun(latest?.runId)))
    return "Pick the branch the cloud run starts from.";
  return null;
}

/**
 * Sends `prompt` to the cloud as the session's next run. The prompt and an empty reply land in the
 * transcript at once; the reply fills in from the run's log, and a refused run says why there.
 */
export function startCloudSessionRun(chatId: string, prompt: string): AgentMessageSubmitResult {
  const content = prompt.trim();
  if (!content) return { accepted: false };
  const blocker = getCloudSendBlocker(chatId);
  if (blocker) return { accepted: false, error: blocker };

  const { actions } = useAIChatStore.getState();
  const chat = actions.getChatById(chatId)!;
  const cloud = chat.sessionSettings!.cloud!;
  const agent = toCloudAgentId(chat.agentId)!;
  const baseBranch = getNextRunBaseBranch(
    cloud,
    getCachedCloudRun(getLatestCloudRun(cloud)?.runId),
  )!;
  const isFirstPrompt = !chat.messages.some((message) => message.role === "user");
  const now = new Date();
  const messageId = createId();

  actions.addMessage(chatId, { id: createId(), role: "user", content, timestamp: now });
  actions.addMessage(chatId, {
    id: messageId,
    role: "assistant",
    content: "",
    timestamp: new Date(now.getTime() + 1),
    isStreaming: true,
    responsePhase: "starting",
  } satisfies Message);
  actions.setChatCloudEnvironment(chatId, {
    ...cloud,
    runs: [...cloud.runs, { messageId, runId: null }],
  });
  if (isFirstPrompt) actions.updateChatTitle(chatId, getFallbackAgentSessionTitle(content));

  void requestRun(chatId, messageId, { repo: cloud.repo!, baseBranch, prompt: content, agent });
  return { accepted: true };
}

/** Sends a refused run's prompt again. */
export function retryCloudRun(chatId: string, messageId: string) {
  const cloud = getChatCloudEnvironment(chatId);
  const { actions } = useAIChatStore.getState();
  const messages = actions.getMessagesForChat(chatId);
  const index = messages.findIndex((message) => message.id === messageId);
  const prompt = messages
    .slice(0, Math.max(index, 0))
    .reverse()
    .find((message) => message.role === "user");
  const chat = actions.getChatById(chatId);
  const agent = toCloudAgentId(chat?.agentId);
  if (!cloud?.repo || !prompt || !agent) return;
  const runIndex = cloud.runs.findIndex((run) => run.messageId === messageId);
  const previous = runIndex > 0 ? getCachedCloudRun(cloud.runs[runIndex - 1]?.runId) : null;
  const baseBranch = getNextRunBaseBranch(cloud, previous);
  if (!baseBranch) return;
  updateCloudRun(chatId, messageId, { runId: null, error: null });
  actions.updateMessage(chatId, messageId, { isStreaming: true, responsePhase: "starting" });
  void requestRun(chatId, messageId, {
    repo: cloud.repo,
    baseBranch,
    prompt: prompt.content,
    agent,
  });
}

export async function cancelCloudRun(runId: string) {
  const run = await cancelCloudAgentRun(runId);
  rememberRun(run);
  return run;
}

/** Opens a new agent session set to run in the cloud, with the current agent when it can. */
export function openNewCloudAgentChat() {
  const { actions } = useAIChatStore.getState();
  const currentAgentId = actions.getCurrentAgentId();
  const agentId = toCloudAgentId(currentAgentId) ? currentAgentId : DEFAULT_CLOUD_AGENT_ID;
  const chatId = actions.createNewChat(agentId, { activate: false });
  actions.setChatCloudEnvironment(chatId, emptyCloudEnvironment());
  const windowSession = openAgentWindowSession(chatId);
  if (windowSession) return windowSession;
  const bufferId = useBufferStore.getState().actions.openAgentBuffer(chatId);
  return bufferId;
}

/** Opens a run started elsewhere (another device, or before sessions held runs) as a session. */
export function openCloudRunSession(run: CloudAgentRun, workspacePath: string | null) {
  const { actions, chats } = useAIChatStore.getState();
  const existing = chats.find((chat) =>
    chat.sessionSettings?.cloud?.runs.some((entry) => entry.runId === run.id),
  );
  if (existing) return openAgentHistoryChat(existing.id);

  const chatId = actions.createNewChat(fromCloudAgentId(run.agent), {
    activate: false,
    workspacePath: workspacePath ?? `github://${run.repo}`,
  });
  const created = new Date(run.createdAt);
  const timestamp = Number.isNaN(created.getTime()) ? new Date() : created;
  const messageId = createId();
  actions.addMessage(chatId, {
    id: createId(),
    role: "user",
    content: run.prompt?.trim() || run.title,
    timestamp,
  });
  actions.addMessage(chatId, {
    id: messageId,
    role: "assistant",
    content: "",
    timestamp: new Date(timestamp.getTime() + 1),
  });
  actions.setChatCloudEnvironment(chatId, {
    repo: run.repo,
    branch: run.baseBranch,
    runs: [{ messageId, runId: run.id }],
  });
  actions.updateChatTitle(chatId, run.title);
  return openAgentHistoryChat(chatId);
}
