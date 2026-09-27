import { useMemo, useRef, useState } from "react";
import { ExtensionDiffPreview } from "@/extensions/ui/components/extension-diff-preview";
import { toRelativeDisplayPath } from "@/features/ai/lib/acp-diff-output";
import {
  buildHunkPreviewLines,
  computeAgentHunks,
  countChangedLines,
  hunkLine,
} from "@/features/ai/lib/agent-edit-hunks";
import { openToolPath } from "@/features/ai/lib/open-tool-location";
import {
  keepAgentFile,
  keepAgentHunk,
  keepAllAgentEdits,
  rejectAgentFile,
  rejectAgentHunk,
  rejectAllAgentEdits,
} from "@/features/ai/services/agent-edits-service";
import { pickAgentEditsChatId, useAgentEditsStore } from "@/features/ai/stores/agent-edits.store";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import type { AgentEditEntry, AgentEditHunk } from "@/features/ai/types/agent-edits.types";
import { useProjectStore } from "@/features/window/stores/project.store";
import { Button } from "@/ui/button";
import { ButtonGroup } from "@/ui/button-group";
import { EmptyState } from "@/ui/empty";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  GitDiffIcon,
  OpenExternalIcon,
  XIcon,
} from "@/ui/icons";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/ui/item";
import { ResourceDocument, ResourceSummary } from "@/ui/resource";
import Select from "@/ui/select";

interface ReviewHunk {
  path: string;
  hunk: AgentEditHunk;
  index: number;
}

interface ReviewFile {
  entry: AgentEditEntry;
  hunks: ReviewHunk[];
  counts: { added: number; removed: number };
}

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * The "Agent Changes" tab: every unreviewed hunk a chat's agent wrote, grouped by file, with keep
 * and reject per hunk, per file, and for everything. It sits beside the editor as a tab, so the
 * files stay open and editable while the review is.
 */
export default function AgentEditsReviewView() {
  const byChat = useAgentEditsStore((state) => state.byChat);
  const reviewChatId = useAgentEditsStore((state) => state.reviewChatId);
  const chats = useAIChatStore((state) => state.chats);
  const chatId =
    reviewChatId && byChat[reviewChatId] ? reviewChatId : pickAgentEditsChatId(reviewChatId);

  if (!chatId || !byChat[chatId]) {
    return (
      <ResourceDocument>
        <EmptyState
          className="min-h-40"
          icon={<GitDiffIcon />}
          title="No agent changes to review"
          message="Files an agent edits show up here until you keep or reject its changes."
        />
      </ResourceDocument>
    );
  }

  const chatOptions = Object.keys(byChat).map((id) => ({
    value: id,
    label: chats.find((chat) => chat.id === id)?.title || "Untitled chat",
  }));

  return (
    <AgentEditsReviewBody
      key={chatId}
      chatId={chatId}
      entries={byChat[chatId]}
      chatOptions={chatOptions}
    />
  );
}

function AgentEditsReviewBody({
  chatId,
  entries,
  chatOptions,
}: {
  chatId: string;
  entries: Record<string, AgentEditEntry>;
  chatOptions: Array<{ value: string; label: string }>;
}) {
  const rootFolderPath = useProjectStore((state) => state.rootFolderPath);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(0);

  const files = useMemo(() => {
    let index = 0;
    return Object.values(entries)
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((entry): ReviewFile => {
        const hunks = computeAgentHunks(entry.baseline, entry.current).map((hunk) => ({
          path: entry.path,
          hunk,
          index: index++,
        }));
        return { entry, hunks, counts: countChangedLines(hunks.map((item) => item.hunk)) };
      });
  }, [entries]);
  const total = files.reduce((sum, file) => sum + file.hunks.length, 0);
  const current = Math.min(focused, Math.max(total - 1, 0));
  const added = files.reduce((sum, file) => sum + file.counts.added, 0);
  const removed = files.reduce((sum, file) => sum + file.counts.removed, 0);

  const goTo = (index: number) => {
    if (total === 0) return;
    const next = (index + total) % total;
    setFocused(next);
    const target = bodyRef.current?.querySelector<HTMLElement>(`[data-hunk-index="${next}"]`);
    target?.scrollIntoView({ block: "nearest" });
    target?.querySelector<HTMLElement>("button")?.focus();
  };

  const summary = (
    <ResourceSummary
      icon={<GitDiffIcon />}
      title="Agent changes"
      description={`${plural(files.length, "file")}, ${plural(total, "change")}, +${added} -${removed}`}
      actions={
        <>
          {chatOptions.length > 1 ? (
            <Select
              value={chatId}
              options={chatOptions}
              onChange={(value) => useAgentEditsStore.getState().actions.openReview(value)}
              aria-label="Chat"
            />
          ) : null}
          <ButtonGroup variant="ghost">
            <Button
              type="button"
              variant="ghost"
              iconOnly
              disabled={total < 2}
              onClick={() => goTo(current - 1)}
              tooltip="Previous change"
            >
              <ChevronUpIcon />
            </Button>
            <Button
              type="button"
              variant="ghost"
              iconOnly
              disabled={total < 2}
              onClick={() => goTo(current + 1)}
              tooltip="Next change"
            >
              <ChevronDownIcon />
            </Button>
            <Button
              type="button"
              variant="ghost"
              tone="success"
              onClick={() => void keepAllAgentEdits(chatId)}
            >
              <CheckIcon />
              Keep all
            </Button>
            <Button
              type="button"
              variant="ghost"
              tone="danger"
              onClick={() => void rejectAllAgentEdits(chatId)}
            >
              <XIcon />
              Reject all
            </Button>
          </ButtonGroup>
        </>
      }
    />
  );

  return (
    <ResourceDocument summary={summary}>
      <div
        ref={bodyRef}
        className="flex flex-col gap-6"
        onKeyDown={(event) => {
          if (event.altKey && event.key === "ArrowDown") {
            event.preventDefault();
            goTo(current + 1);
          } else if (event.altKey && event.key === "ArrowUp") {
            event.preventDefault();
            goTo(current - 1);
          }
        }}
      >
        {files.map(({ entry, hunks, counts }) => {
          const displayPath = toRelativeDisplayPath(entry.path, rootFolderPath);
          const firstHunk = hunks[0]?.hunk;
          return (
            <section key={entry.path} aria-label={displayPath} className="flex flex-col gap-2">
              <Item variant="muted" size="compact">
                <ItemContent>
                  <ItemTitle>{displayPath}</ItemTitle>
                  <ItemDescription>
                    {entry.created ? "New file, " : ""}
                    {plural(hunks.length, "change")}, +{counts.added} -{counts.removed}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <ButtonGroup variant="ghost">
                    <Button
                      type="button"
                      variant="ghost"
                      iconOnly
                      onClick={() =>
                        void openToolPath(entry.path, firstHunk ? hunkLine(firstHunk) : undefined)
                      }
                      tooltip="Open file"
                    >
                      <OpenExternalIcon />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      tone="success"
                      onClick={() => void keepAgentFile(chatId, entry.path)}
                    >
                      Keep file
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      tone="danger"
                      onClick={() => void rejectAgentFile(chatId, entry.path)}
                    >
                      {entry.created ? "Delete file" : "Reject file"}
                    </Button>
                  </ButtonGroup>
                </ItemActions>
              </Item>
              <div
                role="list"
                aria-label={`Changes in ${displayPath}`}
                className="flex flex-col gap-3"
              >
                {hunks.map(({ hunk, index }) => (
                  <div
                    key={`${hunk.baseStart}-${hunk.currentStart}`}
                    role="listitem"
                    data-hunk-index={index}
                    aria-current={index === current ? "true" : undefined}
                    className="flex flex-col gap-1"
                  >
                    <ButtonGroup variant="ghost">
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        tone="success"
                        onClick={() => {
                          setFocused(index);
                          void keepAgentHunk(chatId, entry.path, hunk);
                        }}
                      >
                        <CheckIcon />
                        Keep
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        tone="danger"
                        onClick={() => {
                          setFocused(index);
                          void rejectAgentHunk(chatId, entry.path, hunk);
                        }}
                      >
                        <XIcon />
                        Reject
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={() => void openToolPath(entry.path, hunkLine(hunk))}
                      >
                        <OpenExternalIcon />
                        Line {hunkLine(hunk)}
                      </Button>
                    </ButtonGroup>
                    <ExtensionDiffPreview
                      filePath={`${displayPath}:${hunkLine(hunk)}`}
                      lines={buildHunkPreviewLines(entry.current, hunk)}
                    />
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </ResourceDocument>
  );
}
