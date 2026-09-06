import { recordAgentSessionDiffs } from "@/features/review/stores/agent-changes.store";
import { useProjectStore } from "@/features/window/stores/project.store";
import { useAIChatStore } from "../stores/ai-chat.store";
import { getAcpDiffOutputs } from "./acp-diff-output";

/**
 * Collect the file edits an agent reported in a tool result so the review
 * sidebar can offer the whole session as one reviewable change set.
 */
export function recordAgentToolDiffs(chatId: string, output: unknown): void {
  const diffs = getAcpDiffOutputs(output).filter((diff) => diff.oldText !== diff.newText);
  if (diffs.length === 0) return;

  const chat = useAIChatStore.getState().chats.find((candidate) => candidate.id === chatId);

  recordAgentSessionDiffs({
    sessionId: chatId,
    title: chat?.title || "Agent session",
    workspacePath: chat?.workspacePath ?? useProjectStore.getState().rootFolderPath ?? null,
    diffs,
  });
}
