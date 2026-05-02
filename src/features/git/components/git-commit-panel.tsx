import {
  ArrowDown,
  ArrowUp,
  Check,
  CaretDown as ChevronDown,
  WarningCircle as AlertCircle,
  Sparkle as Sparkles,
} from "@phosphor-icons/react";
import type React from "react";
import { useLayoutEffect, useRef, useState } from "react";
import { useSettingsStore } from "@/features/settings/store";
import { useAuthStore } from "@/features/window/stores/auth-store";
import { Button } from "@/ui/button";
import { Dropdown, type MenuItem } from "@/ui/dropdown";
import Textarea from "@/ui/textarea";
import Tooltip from "@/ui/tooltip";
import { toast } from "@/ui/toast";
import { cn } from "@/utils/cn";
import {
  InlineEditError,
  requestInlineEdit,
} from "@/features/editor/services/editor-inline-edit-service";
import { getFileDiff } from "../api/git-diff-api";
import { commitChanges, getGitLog } from "../api/git-commits-api";
import { pullChanges, pushChanges, type GitRemoteActionResult } from "../api/git-remotes-api";
import type { GitDiff, GitFile } from "../types/git-types";

interface GitCommitPanelProps {
  stagedFilesCount: number;
  stagedFiles: GitFile[];
  currentBranch?: string;
  repoPath?: string;
  ahead?: number;
  behind?: number;
  onCommitSuccess?: () => void;
}

const MAX_STAGED_FILES_FOR_AI_CONTEXT = 120;
const MAX_RECENT_COMMITS_FOR_AI_CONTEXT = 24;
const MAX_DIFF_FILES_FOR_AI_CONTEXT = 10;
const MAX_DIFF_LINES_PER_FILE_FOR_AI_CONTEXT = 80;
const MAX_COMMIT_AI_CONTEXT_CHARS = 11_000;
const COMMIT_TEXTAREA_MIN_HEIGHT = 64;
const COMMIT_TEXTAREA_MAX_HEIGHT = 128;

type CommitMessageMode = "title" | "body";

const getRepoLabel = (repoPath: string): string => {
  const normalized = repoPath.replace(/\\/g, "/").replace(/\/$/, "");
  return normalized.split("/").pop() || "repository";
};

const countDiffLines = (diff: GitDiff | null) => {
  if (!diff) return { additions: 0, deletions: 0 };

  return diff.lines.reduce(
    (totals, line) => {
      if (line.line_type === "added") totals.additions += 1;
      if (line.line_type === "removed") totals.deletions += 1;
      return totals;
    },
    { additions: 0, deletions: 0 },
  );
};

const formatDiffExcerpt = (file: GitFile, diff: GitDiff | null): string => {
  if (!diff) return `### ${file.path}\n(no staged text diff available)`;
  if (diff.is_binary || diff.is_image) return `### ${file.path}\n(binary or image change)`;

  const changedLines = diff.lines
    .filter((line) => line.line_type === "added" || line.line_type === "removed")
    .slice(0, MAX_DIFF_LINES_PER_FILE_FOR_AI_CONTEXT)
    .map((line) => `${line.line_type === "added" ? "+" : "-"}${line.content}`)
    .join("\n");

  const omittedCount = Math.max(
    diff.lines.filter((line) => line.line_type === "added" || line.line_type === "removed").length -
      MAX_DIFF_LINES_PER_FILE_FOR_AI_CONTEXT,
    0,
  );

  return [
    `### ${file.path}`,
    changedLines || "(metadata-only change)",
    omittedCount > 0 ? `... ${omittedCount} more changed lines omitted` : "",
  ]
    .filter(Boolean)
    .join("\n");
};

const truncateContext = (context: string): string => {
  if (context.length <= MAX_COMMIT_AI_CONTEXT_CHARS) return context;
  return `${context.slice(0, MAX_COMMIT_AI_CONTEXT_CHARS)}\n\n[context truncated]`;
};

async function buildCommitMessageContext({
  repoPath,
  currentBranch,
  stagedFiles,
  existingDraftHint,
}: {
  repoPath: string;
  currentBranch?: string;
  stagedFiles: GitFile[];
  existingDraftHint: string;
}): Promise<string> {
  const stagedFilesForContext = stagedFiles.slice(0, MAX_STAGED_FILES_FOR_AI_CONTEXT);
  const diffFilesForContext = stagedFiles.slice(0, MAX_DIFF_FILES_FOR_AI_CONTEXT);
  const [recentCommits, stagedDiffs] = await Promise.all([
    getGitLog(repoPath, MAX_RECENT_COMMITS_FOR_AI_CONTEXT, 0),
    Promise.all(diffFilesForContext.map((file) => getFileDiff(repoPath, file.path, true))),
  ]);
  const overflowCount = Math.max(stagedFiles.length - stagedFilesForContext.length, 0);
  const diffOverflowCount = Math.max(stagedFiles.length - diffFilesForContext.length, 0);
  const totals = stagedDiffs.reduce(
    (sum, diff) => {
      const counts = countDiffLines(diff);
      return {
        additions: sum.additions + counts.additions,
        deletions: sum.deletions + counts.deletions,
      };
    },
    { additions: 0, deletions: 0 },
  );

  const recentCommitLines = recentCommits
    .map((commit) => commit.message.trim())
    .filter(Boolean)
    .slice(0, MAX_RECENT_COMMITS_FOR_AI_CONTEXT)
    .map((message) => `- ${message}`)
    .join("\n");
  const stagedLines = stagedFilesForContext
    .map((file) => `- ${file.status}${file.staged ? " staged" : ""}: ${file.path}`)
    .join("\n");
  const diffExcerpt = diffFilesForContext
    .map((file, index) => formatDiffExcerpt(file, stagedDiffs[index]))
    .join("\n\n");

  return truncateContext(
    [
      `Repository: ${getRepoLabel(repoPath)}`,
      `Branch: ${currentBranch || "unknown"}`,
      "",
      "Recent commit subjects for style:",
      recentCommitLines || "- none",
      "",
      `Staged files (${stagedFiles.length}):`,
      stagedLines || "- none",
      overflowCount > 0 ? `- ...and ${overflowCount} more staged files` : "",
      "",
      `Staged diff summary for sampled files: +${totals.additions} -${totals.deletions}`,
      diffOverflowCount > 0
        ? `Diff excerpts include ${diffFilesForContext.length} of ${stagedFiles.length} staged files.`
        : "",
      diffExcerpt ? `\nStaged patch excerpts:\n${diffExcerpt}` : "",
      existingDraftHint ? `\nCurrent draft:\n${existingDraftHint}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

function normalizeGeneratedCommitMessage(message: string, mode: CommitMessageMode): string {
  const trimmed = message
    .replace(/^```[a-zA-Z0-9_-]*\n?/, "")
    .replace(/\n?```\s*$/, "")
    .trim();
  if (mode === "body") return trimmed;

  return (
    trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) || ""
  );
}

const GitCommitPanel = ({
  stagedFilesCount,
  stagedFiles,
  currentBranch,
  repoPath,
  ahead = 0,
  behind = 0,
  onCommitSuccess,
}: GitCommitPanelProps) => {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const subscription = useAuthStore((state) => state.subscription);
  const aiAutocompleteModelId = useSettingsStore((state) => state.settings.aiAutocompleteModelId);
  const [commitMessage, setCommitMessage] = useState("");
  const [isCommitting, setIsCommitting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [commitMessageMode, setCommitMessageMode] = useState<CommitMessageMode>("title");
  const [isGenerateModeMenuOpen, setIsGenerateModeMenuOpen] = useState(false);
  const [remoteAction, setRemoteAction] = useState<"push" | "pull" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generateMenuAnchorRef = useRef<HTMLDivElement>(null);
  const commitTextareaRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const textarea = commitTextareaRef.current;
    if (!textarea) return;

    textarea.style.height = "auto";
    const nextHeight = Math.min(
      COMMIT_TEXTAREA_MAX_HEIGHT,
      Math.max(COMMIT_TEXTAREA_MIN_HEIGHT, textarea.scrollHeight),
    );
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY =
      textarea.scrollHeight > COMMIT_TEXTAREA_MAX_HEIGHT ? "auto" : "hidden";
  }, [commitMessage]);

  const handleGenerateCommitMessage = async () => {
    if (!repoPath || stagedFilesCount === 0) return;
    setError(null);

    if (!isAuthenticated) {
      setError("Please sign in to use AI commit message generation.");
      return;
    }

    const subscriptionStatus = subscription?.status ?? "free";
    const enterprisePolicy = subscription?.enterprise?.policy;
    const managedPolicy = enterprisePolicy?.managedMode ? enterprisePolicy : null;
    const isPro = subscriptionStatus === "pro";

    if (managedPolicy && !managedPolicy.aiCompletionEnabled) {
      setError("AI commit message generation is disabled by your organization policy.");
      return;
    }

    const useByok = managedPolicy ? managedPolicy.allowByok && !isPro : !isPro;
    if (managedPolicy && useByok && !managedPolicy.allowByok) {
      setError("BYOK is disabled by your organization policy.");
      return;
    }

    const existingDraftHint = commitMessage.trim();

    setIsGenerating(true);
    try {
      const selectedText = await buildCommitMessageContext({
        repoPath,
        currentBranch,
        stagedFiles,
        existingDraftHint,
      });
      const { editedText } = await requestInlineEdit(
        {
          model: aiAutocompleteModelId,
          beforeSelection: "",
          selectedText,
          afterSelection: "",
          instruction:
            commitMessageMode === "title"
              ? "Generate a concise Git commit subject from the staged changes. Return exactly one subject line and nothing else. Keep it under 72 characters when possible. Infer and match the repository's style from recent commit subjects. Do not force conventional commit format unless the recent commits clearly use it."
              : "Generate a Git commit message from the staged changes. Return a subject line and a short body only when the body adds useful context. Keep the subject under 72 characters when possible. Infer and match the repository's style from recent commit subjects. Do not force conventional commit format unless the recent commits clearly use it.",
          filePath: getRepoLabel(repoPath),
          languageId: "git-commit",
        },
        { useByok },
      );

      const message = normalizeGeneratedCommitMessage(editedText, commitMessageMode);
      if (!message) {
        setError("AI returned an empty commit message.");
        return;
      }

      setCommitMessage(message);
    } catch (generationError) {
      if (generationError instanceof InlineEditError) {
        setError(generationError.message);
      } else {
        setError("Failed to generate commit message.");
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCommit = async () => {
    if (!repoPath || !commitMessage.trim() || stagedFilesCount === 0) return;

    setIsCommitting(true);
    setError(null);

    try {
      const success = await commitChanges(repoPath, commitMessage.trim());
      if (success) {
        setCommitMessage("");
        onCommitSuccess?.();
      } else {
        setError("Failed to commit changes");
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unknown error occurred");
    } finally {
      setIsCommitting(false);
    }
  };

  const handleRemoteAction = async (
    action: "push" | "pull",
    run: () => Promise<GitRemoteActionResult>,
  ) => {
    if (!repoPath) return;

    const label = action === "push" ? "Push" : "Pull";
    let toastId: string | null = null;
    setRemoteAction(action);
    setError(null);

    try {
      toastId = toast.show({
        message: `${label}ing changes...`,
        type: "info",
        duration: 0,
      });

      const result = await run();
      if (result.success) {
        toast.dismiss(toastId);
        toast.success(
          action === "push" ? "Changes pushed successfully." : "Changes pulled successfully.",
        );
        onCommitSuccess?.();
        return;
      }

      const errorMessage = result.error || `Failed to ${action} changes.`;
      toast.dismiss(toastId);
      toast.error(errorMessage);
      setError(errorMessage);
    } catch (remoteError) {
      const errorMessage =
        remoteError instanceof Error ? remoteError.message : `Failed to ${action} changes.`;
      if (toastId) toast.dismiss(toastId);
      toast.error(errorMessage);
      setError(errorMessage);
    } finally {
      setRemoteAction(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void handleCommit();
    }
  };

  const isCommitDisabled =
    !commitMessage.trim() || stagedFilesCount === 0 || isCommitting || isGenerating;
  const isGenerateDisabled = stagedFilesCount === 0 || isGenerating || isCommitting;
  const hasRemoteChanges = ahead > 0 || behind > 0;
  const isRemoteActionLoading = remoteAction !== null;
  const composerButtonClassName =
    "h-6 rounded-md border-transparent bg-transparent px-1.5 text-xs leading-none text-text-lighter shadow-none hover:bg-hover/80 hover:text-text focus-visible:ring-1 focus-visible:ring-border-strong/35 [&_svg]:size-3";
  const generateModeItems: MenuItem[] = [
    {
      id: "title",
      label: "Title only",
      icon: commitMessageMode === "title" ? <Check /> : undefined,
      onClick: () => setCommitMessageMode("title"),
    },
    {
      id: "body",
      label: "Title + body",
      icon: commitMessageMode === "body" ? <Check /> : undefined,
      onClick: () => setCommitMessageMode("body"),
    },
  ];

  return (
    <div className="overflow-hidden rounded-2xl border border-border/70 bg-[color-mix(in_srgb,var(--color-secondary-bg)_82%,var(--color-border)_18%)] pb-1">
      <div className="overflow-hidden rounded-xl border border-border/60 bg-[color-mix(in_srgb,var(--color-primary-bg)_96%,var(--color-secondary-bg)_4%)]">
        {error && (
          <div
            className={cn(
              "mx-2 mt-2 flex items-center gap-2 rounded border border-error/30",
              "bg-error/20 px-2 py-1 text-[0.84em] text-error",
            )}
          >
            <AlertCircle />
            {error}
          </div>
        )}

        <Textarea
          ref={commitTextareaRef}
          value={commitMessage}
          onChange={(e) => setCommitMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Commit message..."
          variant="ghost"
          className={cn(
            "max-h-32 min-h-16 w-full resize-none overflow-x-hidden bg-transparent",
            "ui-font ui-text-sm px-3 pt-3 pb-2 text-text placeholder:text-text-lighter",
            "focus:outline-none",
          )}
          rows={2}
          disabled={isCommitting}
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 pt-1.5">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
          <span className="px-1 text-[0.82em] text-text-lighter">
            {stagedFilesCount > 0
              ? `${stagedFilesCount} file${stagedFilesCount !== 1 ? "s" : ""} staged`
              : "No files staged"}
          </span>

          {hasRemoteChanges && (
            <div className="flex items-center gap-1">
              {ahead > 0 && (
                <Button
                  type="button"
                  onClick={() => void handleRemoteAction("push", () => pushChanges(repoPath!))}
                  disabled={!repoPath || isRemoteActionLoading}
                  variant="ghost"
                  size="xs"
                  className={cn(composerButtonClassName, "text-git-added hover:text-git-added")}
                  tooltip={`Push ${ahead} commit${ahead !== 1 ? "s" : ""}`}
                >
                  <ArrowUp />
                  <span>{ahead}</span>
                </Button>
              )}

              {behind > 0 && (
                <Button
                  type="button"
                  onClick={() => void handleRemoteAction("pull", () => pullChanges(repoPath!))}
                  disabled={!repoPath || isRemoteActionLoading}
                  variant="ghost"
                  size="xs"
                  className={cn(composerButtonClassName, "text-git-deleted hover:text-git-deleted")}
                  tooltip={`Pull ${behind} commit${behind !== 1 ? "s" : ""}`}
                >
                  <ArrowDown />
                  <span>{behind}</span>
                </Button>
              )}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <div
            ref={generateMenuAnchorRef}
            className={cn(
              "flex h-6 overflow-hidden rounded-md border border-border/60 bg-transparent text-text-lighter shadow-none transition-colors",
              isGenerateDisabled
                ? "cursor-not-allowed opacity-50"
                : "hover:border-border/80 hover:bg-hover/70",
              isGenerateModeMenuOpen && "border-border/80 bg-hover/70 text-text",
            )}
          >
            <Tooltip content="Generate commit message with AI" side="top">
              <button
                type="button"
                onClick={() => void handleGenerateCommitMessage()}
                disabled={isGenerateDisabled}
                className="flex size-6 items-center justify-center transition-colors hover:text-text focus-visible:ring-1 focus-visible:ring-border-strong/35 focus-visible:outline-none disabled:pointer-events-none [&_svg]:size-3"
                aria-label="Generate commit message with AI"
              >
                <Sparkles />
              </button>
            </Tooltip>
            <div className="my-1 w-px bg-border/70" />
            <Tooltip content="Commit message format" side="top">
              <button
                type="button"
                onClick={() => setIsGenerateModeMenuOpen((open) => !open)}
                disabled={isGenerating || isCommitting}
                className="flex h-full w-5 items-center justify-center transition-colors hover:text-text focus-visible:ring-1 focus-visible:ring-border-strong/35 focus-visible:outline-none disabled:pointer-events-none [&_svg]:size-3"
                aria-haspopup="menu"
                aria-expanded={isGenerateModeMenuOpen}
                aria-label="Commit message format"
              >
                <ChevronDown />
              </button>
            </Tooltip>
          </div>
          <Dropdown
            isOpen={isGenerateModeMenuOpen}
            anchorRef={generateMenuAnchorRef}
            anchorAlign="end"
            onClose={() => setIsGenerateModeMenuOpen(false)}
            items={generateModeItems}
            className="min-w-[150px]"
          />

          <Button
            type="button"
            onClick={() => void handleCommit()}
            disabled={isCommitDisabled}
            variant="ghost"
            size="xs"
            className={cn(
              composerButtonClassName,
              isCommitDisabled
                ? "cursor-not-allowed text-text-lighter opacity-50"
                : "text-accent hover:bg-accent/8 hover:text-accent/80",
            )}
          >
            {isCommitting ? "Committing..." : "Commit"}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default GitCommitPanel;
