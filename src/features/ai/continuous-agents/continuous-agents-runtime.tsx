import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { CodexIntegrationService } from "@/features/ai/integrations/codex/codex-integration-service";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import type { AgentConfig } from "@/features/ai/types/acp.types";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useProjectStore } from "@/features/window/stores/project.store";
import {
  buildContinuousAgentPrompt,
  checkContinuousAgentReadiness,
  runNextDueContinuousAgent,
} from "./continuous-agent-runner";
import { selectNextDueContinuousAgent, useContinuousAgentsStore } from "./continuous-agents.store";

const CONTINUOUS_AGENT_CHECK_INTERVAL_MS = 30_000;
const CONTINUOUS_AGENT_SCHEDULER_LOCK = "athas-continuous-agent-scheduler";

export function ContinuousAgentsRuntime() {
  const workspacePath = useProjectStore((state) => state.rootFolderPath ?? null);
  const tasks = useContinuousAgentsStore((state) => state.tasks);
  const runningRef = useRef(false);

  const runNextDueTask = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      const run = async () => {
        await useContinuousAgentsStore.persist.rehydrate();
        return runNextDueContinuousAgent({
          getWorkspacePath: () => useProjectStore.getState().rootFolderPath ?? null,
          isAgentBusy: () => {
            const chatState = useAIChatStore.getState();
            return Boolean(
              chatState.pendingAgentLaunchRequest || Object.keys(chatState.agentRuns).length > 0,
            );
          },
          getDueTask: (currentWorkspacePath, now) =>
            selectNextDueContinuousAgent(
              useContinuousAgentsStore.getState().tasks,
              currentWorkspacePath,
              now,
            ),
          checkReadiness: (task) =>
            checkContinuousAgentReadiness(task, {
              loadAcpAgents: () => invoke<AgentConfig[]>("get_available_agents"),
              loadCodexStatus: () => CodexIntegrationService.status(),
            }),
          claimTask: (currentWorkspacePath, now, taskId) =>
            useContinuousAgentsStore
              .getState()
              .actions.claimDueTask(currentWorkspacePath, now, taskId),
          launchTask: (task) => {
            const chatState = useAIChatStore.getState();
            const chatId = chatState.actions.createNewChat(task.agentId, { activate: false });
            try {
              chatState.actions.setPendingAgentLaunchRequest({
                chatId,
                agentId: task.agentId,
                prompt: buildContinuousAgentPrompt(task.name, task.prompt),
                selectedBufferIds: [],
                selectedFilesPaths: [],
                editorSelections: [],
              });
              useBufferStore.getState().actions.openAgentBuffer(chatId);
              useContinuousAgentsStore.getState().actions.attachChat(task.id, chatId);
            } catch (error) {
              chatState.actions.setPendingAgentLaunchRequest(null);
              chatState.actions.deleteChat(chatId);
              throw error;
            }
          },
          pauseTask: (taskId, reason) => {
            useContinuousAgentsStore.getState().actions.pauseTaskForError(taskId, reason);
          },
        });
      };

      const lockManager = globalThis.navigator?.locks;
      const result = lockManager
        ? await lockManager.request(
            CONTINUOUS_AGENT_SCHEDULER_LOCK,
            { ifAvailable: true },
            (lock) => (lock ? run() : null),
          )
        : await run();

      if (!result) return;

      if (result.status === "started") {
        toast.success(`${result.task.name} started`, {
          description: "The run is open in a fresh Agent session.",
        });
      } else if (result.status === "paused") {
        toast.error(`${result.task.name} was paused`, {
          description: result.reason,
        });
      }
    } catch (error) {
      console.error("Failed to run a continuous agent:", error);
    } finally {
      runningRef.current = false;
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => void runNextDueTask(), 100);
    return () => window.clearTimeout(timeout);
  }, [runNextDueTask, tasks, workspacePath]);

  useEffect(() => {
    const interval = window.setInterval(
      () => void runNextDueTask(),
      CONTINUOUS_AGENT_CHECK_INTERVAL_MS,
    );
    return () => window.clearInterval(interval);
  }, [runNextDueTask]);

  return null;
}
