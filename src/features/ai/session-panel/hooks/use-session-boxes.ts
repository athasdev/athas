import { useEffect, useMemo, useState } from "react";
import { useAgentSessionContext } from "@/features/ai/hooks/use-agent-session-context";
import type { AgentSessionChange } from "@/features/ai/lib/agent-session-context";
import { getComposerContextBudget } from "@/features/ai/lib/composer-context-budget";
import { selectChatMode } from "@/features/ai/lib/composer-modes";
import {
  selectAcpAgentStatus,
  selectComposerAcpSession,
} from "@/features/ai/services/acp-session-state";
import { isAcpAgent } from "@/features/ai/services/ai-chat-service";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import type { McpTransport } from "@/features/ai/types/mcp-server.types";
import { getProviderById } from "@/features/ai/types/providers.types";
import { useGitStore } from "@/features/git/stores/git.store";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { areProjectTabPathsEqual } from "@/features/workspace/services/project-tab-path";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import { useWorkspaceTabsStore } from "@/features/workspace/stores/workspace-tabs.store";
import {
  getSessionRunningItems,
  getVisibleSessionBoxes,
  SHORT_COMMAND_MS,
  type SessionRunningItem,
} from "../services/session-boxes";
import {
  getAcpContextUsage,
  getBudgetContextUsage,
  type SessionContextUsage,
} from "../services/session-context-usage";
import {
  describeSessionEnvironment,
  type SessionEnvironment,
} from "../services/session-environment";
import { getLatestSessionPlan, type SessionPlan } from "../services/session-plan";
import { useSessionPanelStore } from "../stores/session-panel.store";
import type { SessionBoxId } from "../types/session-panel.types";
import { useCloudRun } from "@/features/ai/cloud-agents/hooks/use-cloud-runs";
import {
  type CloudAgentRun,
  isActiveCloudAgentRun,
} from "@/features/ai/cloud-agents/services/cloud-agents-api";
import { getLatestCloudRun } from "@/features/ai/cloud-agents/services/cloud-environment";

const NO_BUFFERS = new Set<string>();

export interface SessionConnector {
  id: string;
  name: string;
  transport: McpTransport;
  /** The agent left the server out because it cannot use its transport. */
  skipped: boolean;
}

export interface SessionBoxesData {
  visible: SessionBoxId[];
  environment:
    | (SessionEnvironment & {
        workspacePath: string;
        iconPath: string | undefined;
        branch: string | null;
      })
    | null;
  context: SessionContextUsage | null;
  changes: { files: AgentSessionChange[]; additions: number; deletions: number };
  running: SessionRunningItem[];
  plan: SessionPlan | null;
  connectors: SessionConnector[];
  /** Set for a session that runs in the cloud, with the run it sent last. */
  cloud: { repo: string | null; branch: string | null; run: CloudAgentRun | null } | null;
}

/** The newest command still running, and a clock that ticks once when it turns into a live process. */
function useRunningCommand(commands: { command: string; phase: string; timestamp?: number }[]) {
  const running = commands.find(
    (command) => command.phase === "running" || command.phase === "background",
  );
  const command = running?.command ?? null;
  const startedAt = running?.timestamp ?? 0;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!command) return;
    const remaining = startedAt + SHORT_COMMAND_MS - Date.now();
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, remaining) + 50);
    return () => clearTimeout(timer);
  }, [command, startedAt]);

  return { runningCommand: command ? { command, startedAt } : null, now };
}

/** What each box beside an agent session shows, and which boxes have something to show. */
export function useSessionBoxes(chatId: string): SessionBoxesData {
  const { chat, context, messages } = useAgentSessionContext(chatId);
  const rootFolderPath = useProjectStore((state) => state.rootFolderPath || null);
  const workspacePath = chat?.workspacePath ?? rootFolderPath;
  const agentId = chat?.agentId ?? "custom";
  const acp = isAcpAgent(agentId);

  const projectTab = useWorkspaceTabsStore((state) =>
    workspacePath
      ? state.projectTabs.find((tab) => areProjectTabPathsEqual(tab.path, workspacePath))
      : undefined,
  );
  const liveBranch = useGitStore((state) => state.workspaceGitStatus?.branch ?? null);
  const isActiveProject = Boolean(
    workspacePath && rootFolderPath && areProjectTabPathsEqual(workspacePath, rootFolderPath),
  );
  const branch = (isActiveProject ? liveBranch : null) ?? chat?.branch ?? null;
  const projectName = projectTab?.name;
  const iconPath = projectTab?.customIcon;
  const environment = useMemo(
    () =>
      workspacePath
        ? {
            ...describeSessionEnvironment(workspacePath, projectName),
            workspacePath,
            iconPath,
            branch,
          }
        : null,
    [branch, iconPath, projectName, workspacePath],
  );

  const acpUsage = useAIChatStore((state) =>
    acp ? selectComposerAcpSession(state, { chatId, agentId, workspacePath }).session.usage : null,
  );
  const defaultProviderId = useSettingsStore((state) => state.settings.aiProviderId);
  const defaultModelId = useSettingsStore((state) => state.settings.aiModelId);
  const providerId = chat?.providerId ?? defaultProviderId;
  const modelId = chat?.modelId ?? defaultModelId;
  const dynamicModels = useAIChatStore((state) => state.dynamicModels[providerId]);
  const mode = useAIChatStore((state) => selectChatMode(state, chatId));
  const contextWindow = (
    dynamicModels?.find((model) => model.id === modelId) ??
    getProviderById(providerId)?.models.find((model) => model.id === modelId)
  )?.contextWindow;
  const budget = useMemo(
    () =>
      !acp && messages?.length
        ? getComposerContextBudget({
            providerId,
            modelContextWindow: contextWindow,
            mode,
            messages,
            buffers: [],
            selectedBufferIds: NO_BUFFERS,
            editorContexts: [],
            rules: null,
          })
        : null,
    [acp, contextWindow, messages, mode, providerId],
  );
  const contextUsage = acp ? getAcpContextUsage(acpUsage) : getBudgetContextUsage(budget);

  const liveServer = useSessionPanelStore((state) => state.liveServers[chatId] ?? null);
  const terminalFailed = useSessionPanelStore((state) =>
    Boolean(state.attention[chatId]?.terminal),
  );
  const { runningCommand, now } = useRunningCommand(context.commands);
  const runningCommandText = runningCommand?.command ?? null;
  const runningStartedAt = runningCommand?.startedAt ?? 0;
  const running = useMemo(
    () =>
      getSessionRunningItems({
        liveServer,
        terminalFailed,
        runningCommand: runningCommandText
          ? { command: runningCommandText, startedAt: runningStartedAt }
          : null,
        now,
      }),
    [liveServer, now, runningCommandText, runningStartedAt, terminalFailed],
  );

  const plan = useMemo(() => (messages ? getLatestSessionPlan(messages) : null), [messages]);

  const mcpServers = useSettingsStore((state) => state.settings.mcpServers);
  const skippedServers = useAIChatStore((state) =>
    acp ? selectAcpAgentStatus(state, agentId, workspacePath)?.skippedMcpServers : undefined,
  );
  const connectors = useMemo(
    () =>
      mcpServers
        .filter((server) => server.enabled)
        .map((server) => ({
          id: server.id,
          name: server.name,
          transport: server.transport,
          skipped: skippedServers?.some((skipped) => skipped.name === server.name) ?? false,
        })),
    [mcpServers, skippedServers],
  );

  const cloudEnvironment = chat?.sessionSettings?.cloud ?? null;
  const cloudRun = useCloudRun(getLatestCloudRun(cloudEnvironment)?.runId);
  const cloud = useMemo(
    () =>
      cloudEnvironment
        ? { repo: cloudEnvironment.repo, branch: cloudEnvironment.branch, run: cloudRun }
        : null,
    [cloudEnvironment, cloudRun],
  );

  const visible = getVisibleSessionBoxes({
    started: (messages?.length ?? 0) > 0 || Boolean(cloudRun),
    hasContextUsage: contextUsage !== null,
    runningItems: running.length,
    hasPlan: plan !== null,
    connectors: connectors.length,
    cloud: cloud
      ? { running: Boolean(cloudRun && isActiveCloudAgentRun(cloudRun)), hasRun: Boolean(cloudRun) }
      : null,
  });

  return {
    visible,
    environment,
    context: contextUsage,
    changes: { files: context.changes, additions: context.additions, deletions: context.deletions },
    running,
    plan,
    connectors,
    cloud,
  };
}

/** Whether a session has details to show yet; a session that has not started has none. */
export function useSessionHasInfo(chatId: string): boolean {
  return useSessionBoxes(chatId).visible.length > 0;
}
