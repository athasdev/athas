import { logOutOfAcpAgent } from "@/features/ai/lib/acp-logout";
import { openAgentCliInTerminal } from "@/features/ai/lib/open-agent-cli-in-terminal";
import { openAgentSessions } from "@/features/ai/lib/open-agent-sessions";
import { openAgentInNewWindow } from "@/features/ai/detached/agent-window-service";
import { toggleFollowAgent } from "@/features/ai/services/agent-follow-service";
import {
  keepAllAgentEdits,
  openAgentEditsReview,
  rejectAllAgentEdits,
} from "@/features/ai/services/agent-edits-service";
import { cycleChatMode, readChatModeSource } from "@/features/ai/services/chat-mode-service";
import { pickAgentEditsChatId } from "@/features/ai/stores/agent-edits.store";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { showToast } from "@/utils/toast";
import {
  selectBrowseSessionsAgentId,
  selectCurrentAgentId,
  selectLogOutAgentId,
} from "./agent-command-context";
import { useProjectStore } from "@/features/workspace/stores/project.store";

function getActiveBuffer() {
  return useBufferStore.getState().actions.getActiveBuffer() ?? undefined;
}

/** The agent tab in front, or the chat the agent panel shows. */
function getActiveChatId(): string | null {
  const buffer = getActiveBuffer();
  return buffer?.type === "agent" ? buffer.sessionId : useAIChatStore.getState().currentChatId;
}

function getWorkspacePath() {
  return useProjectStore.getState().rootFolderPath;
}

export async function openActiveAgentInNewWindow(): Promise<void> {
  const buffer = getActiveBuffer();
  if (buffer?.type === "agent") await openAgentInNewWindow(buffer.sessionId);
  else showToast({ message: "Open an agent tab first.", type: "info" });
}

export function toggleFollowActiveAgent(): void {
  const chatId = getActiveChatId();
  if (!chatId) {
    showToast({ message: "Open an agent tab first.", type: "info" });
    return;
  }
  const following = toggleFollowAgent(chatId);
  showToast({
    message: following ? "Following the agent" : "Stopped following the agent",
    type: "info",
  });
}

export function cycleActiveAgentMode(): void {
  const mode = cycleChatMode(readChatModeSource(getActiveChatId()));
  showToast({
    message: mode ? `Mode: ${mode.label}` : "This agent has no other modes.",
    type: "info",
  });
}

function withAgentEditsChat(run: (chatId: string) => void): void {
  const chatId = pickAgentEditsChatId(getActiveChatId());
  if (!chatId) {
    showToast({ message: "No agent changes to review.", type: "info" });
    return;
  }
  run(chatId);
}

export function reviewPendingAgentChanges(): void {
  withAgentEditsChat((chatId) => openAgentEditsReview(chatId));
}

export function keepAllPendingAgentChanges(): void {
  withAgentEditsChat((chatId) => void keepAllAgentEdits(chatId));
}

export function rejectAllPendingAgentChanges(): void {
  withAgentEditsChat((chatId) => void rejectAllAgentEdits(chatId));
}

export function importAgentSession(): void {
  const agentId = selectBrowseSessionsAgentId(useAIChatStore.getState(), getWorkspacePath());
  if (agentId) openAgentSessions(agentId);
}

export function openCurrentAgentCliInTerminal(): void {
  openAgentCliInTerminal(selectCurrentAgentId(useAIChatStore.getState()));
}

export async function logOutOfCurrentAgent(): Promise<void> {
  const agentId = selectLogOutAgentId(useAIChatStore.getState(), getWorkspacePath());
  if (agentId) await logOutOfAcpAgent(agentId);
}
