import { agentIsDetached } from "@/features/ai/detached/agent-window.store";
import {
  AGENT_FOLLOW_INTERVAL_MS,
  type AgentFollowTarget,
  canFollowAgent,
  createLatestThrottle,
  isSameAgentFollowTarget,
  type LatestThrottle,
  pickAgentFollowPaneId,
  pickAgentFollowTarget,
} from "@/features/ai/lib/agent-follow";
import { resolveWorkspacePath } from "@/features/ai/lib/open-tool-location";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { isFollowingAgent, useAgentFollowStore } from "@/features/ai/stores/agent-follow.store";
import type { AcpToolCallLocation } from "@/features/ai/types/acp.types";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useEditorStateStore } from "@/features/editor/stores/state.store";
import { readFileContent } from "@/features/file-system/controllers/file-operations";
import {
  getDatabaseTypeFromPath,
  isBinaryFile,
  isImageFile,
  isPdfFile,
} from "@/features/file-system/controllers/file-utils";
import { usePaneStore } from "@/features/panes/stores/pane.store";
import { ensureBufferInPane } from "@/features/panes/utils/pane-buffer-actions";
import { getPaneScopeForPaneId } from "@/features/panes/utils/pane-routing";
import { createPaneBeside } from "@/features/panes/utils/pane-split-actions";
import { getBaseName } from "@/utils/path-helpers";

interface ChatFollower {
  throttle: LatestThrottle<AgentFollowTarget>;
  runId: string | null;
  last: AgentFollowTarget | null;
}

const followers = new Map<string, ChatFollower>();

function findAgentBuffer(chatId: string) {
  return useBufferStore
    .getState()
    .buffers.find((buffer) => buffer.type === "agent" && buffer.sessionId === chatId);
}

function findEditorBuffer(path: string) {
  return useBufferStore
    .getState()
    .buffers.find((buffer) => buffer.type === "editor" && buffer.path === path);
}

/** The chat's tab and pane, when the chat is the tab the user is looking at. */
function getVisibleChat(chatId: string) {
  const agentBuffer = findAgentBuffer(chatId);
  if (!agentBuffer) return null;
  const { actions } = usePaneStore.getState();
  const chatPane = actions.getPaneByBufferId(agentBuffer.id);
  const activePane = actions.getActivePane();
  if (!chatPane || activePane?.id !== chatPane.id || chatPane.activeBufferId !== agentBuffer.id) {
    return null;
  }
  return { agentBuffer, chatPane };
}

function mayFollow(chatId: string) {
  const visibleChat = getVisibleChat(chatId);
  const eligible = canFollowAgent({
    following: isFollowingAgent(chatId),
    running: Boolean(useAIChatStore.getState().agentRuns[chatId]),
    visible: Boolean(visibleChat),
    detached: agentIsDetached(chatId),
  });
  return eligible ? visibleChat : null;
}

/**
 * Opens the file the agent is at in a preview tab of another pane and scrolls its line into view.
 * The chat keeps its pane, its tab and the keyboard: the pane switch needed to route the tab is
 * undone in the same tick, before anything renders, and the preview editor never takes focus.
 */
async function revealAgentLocation(chatId: string, target: AgentFollowTarget) {
  if (!mayFollow(chatId)) return;
  const path = resolveWorkspacePath(target.path);
  // Following shows text; images, PDFs, databases and binaries keep their usual openers.
  if (isImageFile(path) || isPdfFile(path) || isBinaryFile(path) || getDatabaseTypeFromPath(path)) {
    return;
  }
  let content: string | null = null;
  if (!findEditorBuffer(path)) {
    try {
      content = await readFileContent(path);
    } catch {
      return;
    }
  }

  const visibleChat = mayFollow(chatId);
  if (!visibleChat) return;
  const existing = findEditorBuffer(path);
  if (!existing && content === null) return;

  const paneState = usePaneStore.getState();
  const { chatPane, agentBuffer } = visibleChat;
  const targetPaneId =
    pickAgentFollowPaneId({
      panes: getPaneScopeForPaneId(paneState.root, paneState.bottomRoot, chatPane.id),
      chatPaneId: chatPane.id,
      bufferId: existing?.id ?? null,
      mostRecentActivePaneIds: paneState.mostRecentActivePaneIds,
    }) ?? createPaneBeside(chatPane.id, "horizontal", "after");
  if (!targetPaneId) return;

  const bufferActions = useBufferStore.getState().actions;
  usePaneStore.getState().actions.setActivePane(targetPaneId);
  let bufferId: string;
  if (existing) {
    ensureBufferInPane(targetPaneId, existing.id, true);
    bufferId = existing.id;
  } else {
    bufferId = bufferActions.openBuffer(
      path,
      getBaseName(path),
      content ?? "",
      false,
      undefined,
      false,
      false,
      undefined,
      false,
      false,
      false,
      undefined,
      true,
    );
  }
  bufferActions.setActiveBuffer(agentBuffer.id);

  if (target.line) {
    useEditorStateStore.getState().actions.requestReveal({ bufferId, line: target.line });
  }
}

function getFollower(chatId: string): ChatFollower {
  let follower = followers.get(chatId);
  if (!follower) {
    follower = {
      throttle: createLatestThrottle((target) => {
        void revealAgentLocation(chatId, target).catch((error) => {
          console.warn("Failed to follow the agent:", error);
        });
      }, AGENT_FOLLOW_INTERVAL_MS),
      runId: null,
      last: null,
    };
    followers.set(chatId, follower);
  }
  return follower;
}

/** Moves the editor to where the agent is, when the chat follows it. */
export function followAgentTo(chatId: string, target: AgentFollowTarget) {
  if (!isFollowingAgent(chatId)) return;
  const runId = useAIChatStore.getState().agentRuns[chatId]?.runId ?? null;
  if (!runId) return;
  const follower = getFollower(chatId);
  if (follower.runId !== runId) {
    follower.runId = runId;
    follower.last = null;
  }
  if (isSameAgentFollowTarget(follower.last, target)) return;
  follower.last = target;
  follower.throttle.push(target);
}

/** Follows the last location an ACP tool call reports. */
export function followAgentLocations(
  chatId: string,
  locations: AcpToolCallLocation[] | null | undefined,
) {
  const target = pickAgentFollowTarget(locations);
  if (target) followAgentTo(chatId, target);
}

/** Turns following off for the chat and drops a jump that is still waiting. */
export function stopFollowingAgent(chatId: string) {
  useAgentFollowStore.getState().actions.setFollowing(chatId, false);
  const follower = followers.get(chatId);
  follower?.throttle.cancel();
  followers.delete(chatId);
}

/** Flips the chat's "Follow agent" toggle and returns the new state. */
export function toggleFollowAgent(chatId: string): boolean {
  if (isFollowingAgent(chatId)) {
    stopFollowingAgent(chatId);
    return false;
  }
  useAgentFollowStore.getState().actions.setFollowing(chatId, true);
  return true;
}
