import { DiffStats } from "@/features/ai/components/diff-stats";
import { AgentSessionChangeRows } from "@/features/ai/components/panel/agent-context-sidebar";
import { useAgentSessionContext } from "@/features/ai/hooks/use-agent-session-context";
import { openAgentSessionReview } from "@/features/ai/lib/agent-session-context";
import { keepAllAgentEdits, rejectAllAgentEdits } from "@/features/ai/services/agent-edits-service";
import { useAgentEditEntries } from "@/features/ai/stores/agent-edits.store";
import { Button } from "@/ui/button";
import { EmptyState } from "@/ui/empty";
import { CheckIcon, GitDiffIcon, XIcon } from "@/ui/icons";
import { SidebarScrollArea, SidebarToolbar } from "@/ui/sidebar";

/** The files this session changed, with their net diff, and keep or reject for unreviewed edits. */
export function SessionChangesView({ chatId }: { chatId: string }) {
  const { context } = useAgentSessionContext(chatId);
  const unreviewed = Object.keys(useAgentEditEntries(chatId)).length;
  const { changes, additions, deletions } = context;

  if (changes.length === 0) {
    return (
      <EmptyState
        layout="sidebar"
        icon={<GitDiffIcon />}
        message="Files the agent changes in this session show up here."
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SidebarToolbar>
        <span className="flex min-w-0 flex-1 items-center gap-chrome text-muted-foreground">
          <span className="truncate">
            {changes.length} {changes.length === 1 ? "file" : "files"}
          </span>
          <DiffStats additions={additions} deletions={deletions} />
        </span>
        {unreviewed > 0 ? (
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              tone="success"
              tooltip="Keep every unreviewed edit"
              onClick={() => void keepAllAgentEdits(chatId)}
            >
              <CheckIcon />
              Keep
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              tone="danger"
              tooltip="Reject every unreviewed edit"
              onClick={() => void rejectAllAgentEdits(chatId)}
            >
              <XIcon />
              Reject
            </Button>
          </>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          tooltip="Open every change in one diff"
          onClick={() => openAgentSessionReview(changes)}
        >
          <GitDiffIcon />
          Diff
        </Button>
      </SidebarToolbar>
      <SidebarScrollArea>
        <AgentSessionChangeRows changes={changes} />
      </SidebarScrollArea>
    </div>
  );
}
