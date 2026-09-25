import { useEffect, useMemo, useRef, useState } from "react";
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
import { useAgentEditEntries, useAgentEditsStore } from "@/features/ai/stores/agent-edits.store";
import type { AgentEditHunk } from "@/features/ai/types/agent-edits.types";
import { useProjectStore } from "@/features/window/stores/project.store";
import { Button } from "@/ui/button";
import { ButtonGroup } from "@/ui/button-group";
import Dialog from "@/ui/dialog";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  GitDiffIcon,
  OpenExternalIcon,
  XIcon,
} from "@/ui/icons";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/ui/item";

interface ReviewHunk {
  path: string;
  hunk: AgentEditHunk;
  index: number;
}

/** The review surface for the chat whose review is open; mounted once for the whole app. */
export function AgentEditsReview() {
  const chatId = useAgentEditsStore((state) => state.reviewChatId);
  if (!chatId) return null;
  return <AgentEditsReviewDialog chatId={chatId} />;
}

function AgentEditsReviewDialog({ chatId }: { chatId: string }) {
  const entries = useAgentEditEntries(chatId);
  const rootFolderPath = useProjectStore((state) => state.rootFolderPath);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(0);
  const close = () => useAgentEditsStore.getState().actions.closeReview();

  const files = useMemo(() => {
    let index = 0;
    return Object.values(entries)
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((entry) => {
        const hunks = computeAgentHunks(entry.baseline, entry.current).map((hunk): ReviewHunk => ({
          path: entry.path,
          hunk,
          index: index++,
        }));
        return { entry, hunks, counts: countChangedLines(hunks.map((item) => item.hunk)) };
      });
  }, [entries]);
  const total = files.reduce((sum, file) => sum + file.hunks.length, 0);
  const current = Math.min(focused, Math.max(total - 1, 0));

  // Everything reviewed: nothing left to show.
  useEffect(() => {
    if (total === 0) useAgentEditsStore.getState().actions.closeReview();
  }, [total]);

  const goTo = (index: number) => {
    if (total === 0) return;
    const next = (index + total) % total;
    setFocused(next);
    const target = bodyRef.current?.querySelector<HTMLElement>(`[data-hunk-index="${next}"]`);
    target?.scrollIntoView({ block: "nearest" });
    target?.querySelector<HTMLElement>("button")?.focus();
  };

  const openAt = (path: string, hunk: AgentEditHunk) => {
    close();
    void openToolPath(path, hunkLine(hunk));
  };

  return (
    <Dialog
      onClose={close}
      title="Review agent changes"
      icon={GitDiffIcon}
      size="settings"
      headerActions={
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
      }
    >
      <div
        ref={bodyRef}
        className="flex flex-col gap-4"
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
          return (
            <section key={entry.path} aria-label={displayPath} className="flex flex-col gap-2">
              <Item variant="muted" size="compact">
                <ItemContent>
                  <ItemTitle>{displayPath}</ItemTitle>
                  <ItemDescription>
                    {entry.created ? "New file, " : ""}
                    {hunks.length} change{hunks.length === 1 ? "" : "s"}, +{counts.added} -
                    {counts.removed}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <ButtonGroup variant="ghost">
                    <Button
                      type="button"
                      variant="ghost"
                      iconOnly
                      onClick={() => hunks[0] && openAt(entry.path, hunks[0].hunk)}
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
                        onClick={() => openAt(entry.path, hunk)}
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
    </Dialog>
  );
}
