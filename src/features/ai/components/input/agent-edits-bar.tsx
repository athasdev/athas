import { useMemo } from "react";
import { computeAgentHunks, countChangedLines } from "@/features/ai/lib/agent-edit-hunks";
import { keepAllAgentEdits, rejectAllAgentEdits } from "@/features/ai/services/agent-edits-service";
import { useAgentEditEntries, useAgentEditsStore } from "@/features/ai/stores/agent-edits.store";
import { Button } from "@/ui/button";
import { ButtonGroup } from "@/ui/button-group";
import { CheckIcon, GitDiffIcon, XIcon } from "@/ui/icons";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/ui/item";

/** "N files changed" above the composer while the chat's agent edits wait for review. */
export function AgentEditsBar({ chatId }: { chatId: string }) {
  const entries = useAgentEditEntries(chatId);
  const summary = useMemo(() => {
    const files = Object.values(entries);
    const counts = countChangedLines(
      files.flatMap((entry) => computeAgentHunks(entry.baseline, entry.current)),
    );
    return { files: files.length, ...counts };
  }, [entries]);

  if (summary.files === 0) return null;

  return (
    <Item variant="muted" size="compact" role="status" aria-label="Unreviewed agent changes">
      <ItemContent>
        <ItemTitle>
          {summary.files} file{summary.files === 1 ? "" : "s"} changed
        </ItemTitle>
        <ItemDescription>
          +{summary.added} -{summary.removed} lines to review
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <ButtonGroup variant="ghost">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => useAgentEditsStore.getState().actions.openReview(chatId)}
          >
            <GitDiffIcon />
            Review
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            tone="success"
            onClick={() => void keepAllAgentEdits(chatId)}
            tooltip="Keep all agent changes"
          >
            <CheckIcon />
            Keep all
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            tone="danger"
            onClick={() => void rejectAllAgentEdits(chatId)}
            tooltip="Reject all agent changes"
          >
            <XIcon />
            Reject all
          </Button>
        </ButtonGroup>
      </ItemActions>
    </Item>
  );
}
