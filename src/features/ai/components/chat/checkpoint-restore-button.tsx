import { useState } from "react";
import { useCheckpointRestorePlan } from "@/features/ai/hooks/use-checkpoint-restore-plan";
import { restoreCheckpoint } from "@/features/ai/services/agent-checkpoints-service";
import { showToast } from "@/features/layout/contexts/toast-context";
import { showConfirmDialog } from "@/ui/dialog";
import { HistoryIcon } from "@/ui/icons";
import { MessageAction } from "@/ui/message";

/**
 * "Restore checkpoint" on a user message: puts the files the agent changed from that message on
 * back the way they were before it. Renders nothing while there is nothing to restore.
 */
export function CheckpointRestoreButton({
  chatId,
  messageId,
}: {
  chatId: string | null | undefined;
  messageId: string;
}) {
  const plan = useCheckpointRestorePlan(chatId, messageId);
  const [restoring, setRestoring] = useState(false);
  if (!chatId || !plan) return null;

  const fileCount = plan.files.length;
  const files = `${fileCount} file${fileCount === 1 ? "" : "s"}`;

  const restore = async () => {
    const confirmed = await showConfirmDialog(
      `Put ${files} the agent changed from this message on back the way they were before it?`,
      { title: "Restore checkpoint", confirmLabel: "Restore" },
    );
    if (!confirmed) return;
    setRestoring(true);
    try {
      const result = await restoreCheckpoint(chatId, messageId);
      if (result.status === "restored" && result.failedPaths.length === 0) {
        showToast({ type: "success", message: `Restored ${files} to this checkpoint` });
      } else if (result.status === "unavailable") {
        showToast({
          type: "warning",
          message: "This checkpoint is no longer available",
          description: "Older checkpoints are dropped to keep the chat's history small.",
        });
      }
    } catch (error) {
      console.error("Failed to restore checkpoint:", error);
      showToast({ type: "error", message: "Could not restore this checkpoint" });
    } finally {
      setRestoring(false);
    }
  };

  return (
    <MessageAction
      label="Restore checkpoint"
      tooltip={`Restore ${files} to before this message`}
      disabled={restoring}
      onClick={() => void restore()}
    >
      <HistoryIcon className="size-3.5" />
    </MessageAction>
  );
}
