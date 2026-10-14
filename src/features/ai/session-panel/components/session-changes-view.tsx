import { useMemo } from "react";
import { ExtensionDiffPreview } from "@/extensions/ui/components/extension-diff-preview";
import { DiffStats } from "@/features/ai/components/diff-stats";
import { useAgentSessionContext } from "@/features/ai/hooks/use-agent-session-context";
import { createAcpDiffViewNode } from "@/features/ai/lib/acp-diff-output";
import {
  type AgentSessionChange,
  openAgentSessionReview,
} from "@/features/ai/lib/agent-session-context";
import { keepAllAgentEdits, rejectAllAgentEdits } from "@/features/ai/services/agent-edits-service";
import { useAgentEditEntries } from "@/features/ai/stores/agent-edits.store";
import { Button } from "@/ui/button";
import { EmptyState } from "@/ui/empty";
import { CheckIcon, GitDiffIcon, XIcon } from "@/ui/icons";
import { ScrollArea } from "@/ui/scroll-area";
import { SidebarToolbar } from "@/ui/sidebar";
import { useSessionPanelStore } from "../stores/session-panel.store";
import { AgentSessionChangeRows } from "./session-change-rows";

function ChangeDiff({
  change,
  rootFolderPath,
}: {
  change: AgentSessionChange;
  rootFolderPath: string | null;
}) {
  const node = useMemo(
    () =>
      createAcpDiffViewNode(
        { path: change.path, oldText: change.oldText, newText: change.newText },
        rootFolderPath,
      ),
    [change.newText, change.oldText, change.path, rootFolderPath],
  );
  return (
    <ExtensionDiffPreview
      key={change.path}
      filePath={node.filePath}
      oldPath={node.oldPath}
      language={node.language}
      lines={node.lines}
      truncated={node.truncated}
    />
  );
}

/**
 * The files this session changed with the diff of the one picked, and keep or reject for
 * unreviewed edits.
 */
export function SessionChangesView({ chatId }: { chatId: string }) {
  const { context, rootFolderPath } = useAgentSessionContext(chatId);
  const unreviewed = Object.keys(useAgentEditEntries(chatId)).length;
  const selectedPath = useSessionPanelStore((state) => state.selectedChanges[chatId]);
  const { selectChange } = useSessionPanelStore.use.actions();
  const { changes, additions, deletions } = context;
  const selected = changes.find((change) => change.path === selectedPath) ?? changes[0];

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
      <ScrollArea className="max-h-48 shrink-0">
        <div className="px-chrome-inline pb-1">
          <AgentSessionChangeRows
            changes={changes}
            selectedPath={selected?.path}
            onSelect={(change) => selectChange(chatId, change.path)}
          />
        </div>
      </ScrollArea>
      {selected ? (
        <ScrollArea fill="flex">
          <div className="px-2 pt-1 pb-2">
            <ChangeDiff change={selected} rootFolderPath={rootFolderPath} />
          </div>
        </ScrollArea>
      ) : null}
    </div>
  );
}
