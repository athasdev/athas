import { logOutOfAcpAgent } from "@/features/ai/services/acp-logout";
import { openAgentCliInTerminal } from "@/features/ai/services/open-agent-cli-in-terminal";
import { openAgentSessions } from "@/features/ai/services/open-agent-sessions";
import { openAgentInNewWindow } from "@/features/ai/detached/services/agent-window-service";
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
} from "@/features/ai/services/agent-command-context";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import { useUIState } from "@/features/layout/stores/ui-state.store";
import { useSessionPanelStore } from "@/features/ai/session-panel/stores/session-panel.store";
import type { SessionPanelTab } from "@/features/ai/session-panel/types/session-panel.types";

function getActiveBuffer() {
  return useBufferStore.getState().actions.getActiveBuffer() ?? undefined;
}

/** The agent tab in front, or the current chat. */
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

function getActiveAgentSessionId(): string | null {
  const buffer = getActiveBuffer();
  if (buffer?.type === "agent") return buffer.sessionId;
  showToast({ message: "Open an agent session first.", type: "info" });
  return null;
}

/** Expands or collapses the tool card of the agent session in front. */
export function toggleActiveSessionPanel(): void {
  const chatId = getActiveAgentSessionId();
  if (chatId) useSessionPanelStore.getState().actions.toggle(chatId);
}

/** Expands the tool card of the agent session in front on `tab`, ready to use. */
export function showActiveSessionPanelTab(tab: SessionPanelTab): void {
  const chatId = getActiveAgentSessionId();
  if (!chatId) return;
  const { open, requestFocus } = useSessionPanelStore.getState().actions;
  requestFocus(chatId, tab);
  open(chatId, tab);
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

/** Shows the agents sidebar, where every session of the project is listed. */
export function showAgentSessions(): void {
  const ui = useUIState.getState();
  ui.setActiveView("agents");
  ui.setIsSidebarVisible(true);
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
