import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItems,
  DropdownMenuTrigger,
  type MenuItem,
} from "@/ui/dropdown";
import {
  ArrowCounterClockwiseIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  ArrowsClockwiseIcon,
  ChevronDownIcon,
  GitBranchIcon,
  NodesIcon,
  SparkleIcon,
} from "@/ui/icons";
import { cn } from "@/utils/cn";
import { StreamIconButton } from "@/features/sidebar/components/stream/stream-list";
import { DiffNumbers } from "./stream-primitives";
import type { SourceControlModel } from "./use-source-control-model";

const MESSAGE_MIN_HEIGHT = 32;
const MESSAGE_MAX_HEIGHT = 140;

export function StreamIdentity({
  model,
  isLinkedWorktree,
  onOpenBranches,
  actionsMenu,
}: {
  model: SourceControlModel;
  isLinkedWorktree: boolean;
  onOpenBranches: () => void;
  actionsMenu: ReactNode;
}) {
  return (
    <div className="@container/identity flex items-center gap-1 px-2 pt-2 pb-1.5">
      <button
        type="button"
        onClick={onOpenBranches}
        title={`${model.activeRepoPath ?? ""}\n${model.branch} — switch branch`}
        className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 text-left hover:bg-foreground/5"
      >
        {isLinkedWorktree ? (
          <NodesIcon className="size-3.5 shrink-0 text-subtle-foreground" />
        ) : (
          <GitBranchIcon className="size-3.5 shrink-0 text-subtle-foreground" />
        )}
        <span className="min-w-0 truncate ui-text-sm">
          <span className="text-subtle-foreground @max-[240px]/identity:hidden">
            {model.repoName} /{" "}
          </span>
          <span className="font-medium text-foreground">{model.branch || "detached"}</span>
        </span>
        <ChevronDownIcon className="size-3 shrink-0 text-subtle-foreground" />
      </button>
      <SyncButton model={model} />
      {actionsMenu}
    </div>
  );
}

function SyncButton({ model }: { model: SourceControlModel }) {
  const { ahead, behind, remoteAction, suggestedRemote } = model;
  const anchorRef = useRef<HTMLDivElement>(null);
  const busy = !!remoteAction;
  const tone = behind > 0 ? "warn" : ahead > 0 ? "primary" : "quiet";

  const items: MenuItem[] = [
    {
      id: "push",
      label: ahead > 0 ? `Push ${ahead} commit${ahead === 1 ? "" : "s"}` : "Push",
      icon: <ArrowUpIcon />,
      disabled: busy,
      onClick: () => void model.runRemote("push"),
    },
    {
      id: "pull",
      label: behind > 0 ? `Pull ${behind} commit${behind === 1 ? "" : "s"}` : "Pull",
      icon: <ArrowDownIcon />,
      disabled: busy,
      onClick: () => void model.runRemote("pull"),
    },
    {
      id: "fetch",
      label: "Fetch",
      icon: <ArrowCounterClockwiseIcon />,
      disabled: busy,
      onClick: () => void model.runRemote("fetch"),
    },
  ];

  const count = suggestedRemote === "pull" ? behind : suggestedRemote === "push" ? ahead : 0;
  const title =
    suggestedRemote === "fetch"
      ? "Fetch from remote"
      : `${suggestedRemote === "push" ? "Push" : "Pull"} ${count} commit${count === 1 ? "" : "s"}`;

  return (
    <div
      ref={anchorRef}
      className={cn(
        "flex h-6 shrink-0 items-stretch overflow-hidden rounded-md ui-text-sm font-medium",
        tone === "warn" && "bg-warning/12 text-warning",
        tone === "primary" && "bg-primary/12 text-primary",
        tone === "quiet" && "text-muted-foreground",
      )}
    >
      <button
        type="button"
        disabled={busy}
        onClick={() => void model.runRemote(suggestedRemote)}
        title={title}
        aria-label={title}
        className="flex items-center gap-0.5 pr-1 pl-1.5 hover:bg-foreground/8 disabled:opacity-60"
      >
        {busy || suggestedRemote === "fetch" ? (
          <ArrowsClockwiseIcon className={cn("size-3", busy && "animate-spin")} />
        ) : suggestedRemote === "pull" ? (
          <ArrowDownIcon className="size-3" />
        ) : (
          <ArrowUpIcon className="size-3" />
        )}
        {count > 0 ? <span className="tabular-nums">{count}</span> : null}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              aria-label="More remote actions"
              className="flex items-center px-0.5 hover:bg-foreground/8"
            />
          }
        >
          <ChevronDownIcon className="size-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent anchor={anchorRef} align="end" size="compact">
          <DropdownMenuItems items={items} />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function StreamComposer({ model }: { model: SourceControlModel }) {
  const [message, setMessage] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(MESSAGE_MAX_HEIGHT, Math.max(MESSAGE_MIN_HEIGHT, textarea.scrollHeight))}px`;
    textarea.style.overflowY = textarea.scrollHeight > MESSAGE_MAX_HEIGHT ? "auto" : "hidden";
  }, [message]);

  const stagedCount = model.staged.length;
  const willStageAll = stagedCount === 0 && model.unstaged.length > 0;
  const targetFiles = willStageAll ? model.unstaged : model.staged;
  const additions = targetFiles.reduce((sum, file) => sum + file.additions, 0);
  const deletions = targetFiles.reduce((sum, file) => sum + file.deletions, 0);
  const canCommit = !!message.trim() && targetFiles.length > 0 && !model.isCommitting;

  const submit = async (options: { andPush?: boolean; stageAll?: boolean } = {}) => {
    if (!canCommit) return;
    const ok = await model.commit(message.trim(), {
      stageAll: options.stageAll || willStageAll,
      andPush: options.andPush,
    });
    if (ok) setMessage("");
  };

  const commitItems: MenuItem[] = [
    {
      id: "push",
      label: "Commit & Push",
      icon: <ArrowUpIcon />,
      disabled: !canCommit,
      onClick: () => void submit({ andPush: true }),
    },
    {
      id: "all",
      label: "Stage All & Commit",
      disabled: !message.trim() || model.files.length === 0 || model.isCommitting,
      onClick: () => void submit({ stageAll: true }),
    },
  ];

  const scopeLabel =
    model.files.length === 0
      ? "Nothing to commit"
      : willStageAll
        ? `All ${model.unstaged.length}`
        : `${stagedCount} staged`;

  return (
    <div className="px-3 pb-2.5">
      <div className="@container/composer rounded-lg border border-border bg-foreground/3 transition-colors focus-within:border-primary/50">
        <textarea
          ref={textareaRef}
          value={message}
          rows={1}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void submit({ andPush: event.shiftKey });
            }
          }}
          placeholder="Commit message"
          aria-label="Commit message"
          className="block w-full resize-none bg-transparent px-2.5 py-2 ui-text-sm leading-4 text-foreground outline-none placeholder:text-subtle-foreground"
        />
        <div className="flex items-center gap-1 px-1 pb-1">
          <StreamIconButton
            label="Generate message with AI"
            disabled={stagedCount === 0 || model.isGenerating}
            onClick={async () => {
              const generated = await model.generateMessage(message);
              if (generated) setMessage(generated);
            }}
          >
            <SparkleIcon className={cn("size-3", model.isGenerating && "animate-pulse")} />
          </StreamIconButton>
          <span className="flex min-w-0 flex-1 items-center gap-1.5 ui-text-caption text-subtle-foreground">
            <span className="min-w-0 truncate">{scopeLabel}</span>
            <span className="@max-[230px]/composer:hidden">
              <DiffNumbers additions={additions} deletions={deletions} />
            </span>
          </span>
          <div ref={anchorRef} className="flex h-6 shrink-0 overflow-hidden rounded-md">
            <button
              type="button"
              disabled={!canCommit}
              onClick={() => void submit()}
              title="Commit (⌘↵)"
              className="bg-primary px-2.5 ui-text-sm font-medium whitespace-nowrap text-primary-foreground transition-opacity hover:bg-primary-hover disabled:opacity-40"
            >
              {model.isCommitting ? "Committing…" : "Commit"}
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button
                    type="button"
                    aria-label="More commit options"
                    className="border-l border-primary-foreground/20 bg-primary px-1 text-primary-foreground hover:bg-primary-hover"
                  />
                }
              >
                <ChevronDownIcon className="size-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent anchor={anchorRef} align="end" size="compact">
                <DropdownMenuItems items={commitItems} />
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </div>
  );
}
