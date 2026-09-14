import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  SparkleIcon,
  WarningCircleIcon,
} from "@/ui/icons";
import type React from "react";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useAuthStore } from "@/features/window/stores/auth.store";
import { hasProductCapability } from "@/features/window/lib/product-capabilities";
import { Alert, AlertDescription } from "@/ui/alert";
import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown";
import { Composer } from "@/ui/composer";
import { Spinner } from "@/ui/spinner";
import Textarea from "@/ui/textarea";
import { toast } from "sonner";
import {
  InlineEditError,
  requestInlineEdit,
} from "@/features/editor/services/editor-inline-edit-service";
import { commitChanges } from "../../api/git-commits-api";
import { pullChanges, pushChanges, type GitRemoteActionResult } from "../../api/git-remotes-api";
import { useGitBlameStore } from "../../stores/git-blame.store";
import type { GitFile } from "../../types/git.types";
import {
  buildCommitMessageContext,
  normalizeGeneratedCommitMessage,
  type CommitMessageMode,
} from "../utils/commit-message-context";

interface GitCommitPanelProps {
  stagedFilesCount: number;
  stagedFiles: GitFile[];
  currentBranch?: string;
  repoPath?: string;
  ahead?: number;
  behind?: number;
  onCommitSuccess?: () => void;
}

const COMMIT_TEXTAREA_MIN_HEIGHT = 32;
const COMMIT_TEXTAREA_MAX_HEIGHT = 128;

const getRepoLabel = (repoPath: string): string => {
  const normalized = repoPath.replace(/\\/g, "/").replace(/\/$/, "");
  return normalized.split("/").pop() || "repository";
};

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
  const [remoteAction, setRemoteAction] = useState<"push" | "pull" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const commitTextareaRef = useRef<HTMLTextAreaElement>(null);
  const statusId = useId();

  useLayoutEffect(() => {
    const textarea = commitTextareaRef.current;
    if (!textarea) return;

    const resize = () => {
      textarea.style.height = "auto";
      const nextHeight = Math.min(
        COMMIT_TEXTAREA_MAX_HEIGHT,
        Math.max(COMMIT_TEXTAREA_MIN_HEIGHT, textarea.scrollHeight),
      );
      textarea.style.height = `${nextHeight}px`;
      textarea.style.overflowY =
        textarea.scrollHeight > COMMIT_TEXTAREA_MAX_HEIGHT ? "auto" : "hidden";
    };
    resize();
    let width = textarea.clientWidth;
    const observer = new ResizeObserver(() => {
      if (textarea.clientWidth === width) return;
      width = textarea.clientWidth;
      resize();
    });
    observer.observe(textarea);
    return () => observer.disconnect();
  }, [commitMessage]);

  const handleGenerateCommitMessage = async () => {
    if (!repoPath || stagedFilesCount === 0 || isGenerating || isCommitting) return;
    setError(null);

    if (!isAuthenticated) {
      setError("Please sign in to use AI commit message generation.");
      return;
    }

    const enterprisePolicy = subscription?.enterprise?.policy;
    const managedPolicy = enterprisePolicy?.managedMode ? enterprisePolicy : null;
    const hasIntelligence = hasProductCapability(subscription, "intelligence");

    if (managedPolicy && !managedPolicy.aiCompletionEnabled) {
      setError("AI commit message generation is disabled by your organization policy.");
      return;
    }

    const useByok = managedPolicy ? managedPolicy.allowByok && !hasIntelligence : !hasIntelligence;
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
          feature: "commit-message",
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
    if (
      !repoPath ||
      !commitMessage.trim() ||
      stagedFilesCount === 0 ||
      isCommitting ||
      isGenerating ||
      remoteAction
    )
      return;

    setIsCommitting(true);
    setError(null);

    try {
      const success = await commitChanges(repoPath, commitMessage.trim());
      if (success) {
        useGitBlameStore.getState().actions.clearAllBlame();
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
    let toastId: string | number | null = null;
    setRemoteAction(action);
    setError(null);

    try {
      toastId = toast.info(`${label}ing changes...`, {
        duration: 0,
      });

      const result = await run();
      if (result.success) {
        if (action === "pull") {
          useGitBlameStore.getState().actions.clearAllBlame();
        }
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
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void handleCommit();
    }
  };

  const isCommitDisabled =
    !repoPath ||
    !commitMessage.trim() ||
    stagedFilesCount === 0 ||
    isCommitting ||
    isGenerating ||
    remoteAction !== null;
  const isGenerateDisabled =
    !repoPath || stagedFilesCount === 0 || isGenerating || isCommitting || remoteAction !== null;
  const hasRemoteChanges = ahead > 0 || behind > 0;
  const isRemoteActionLoading = remoteAction !== null;

  return (
    <section aria-label="Commit changes" className="min-w-0 space-y-1">
      <Composer className="@container">
        <div className="px-2 pt-2 pb-1">
          <Textarea
            ref={commitTextareaRef}
            aria-label="Commit message"
            aria-describedby={statusId}
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Commit message…"
            variant="ghost"
            inset="flush"
            resize="none"
            className="block min-h-8 max-h-32 overflow-x-hidden overflow-y-auto"
            rows={1}
            disabled={isCommitting || isGenerating}
          />
        </div>

        <div className="flex min-w-0 items-center gap-1 px-1.5 pb-1.5">
          <span
            id={statusId}
            role="status"
            className="min-w-0 flex-1 truncate text-subtle-foreground ui-text-caption @max-[12rem]:sr-only"
          >
            {stagedFilesCount} staged
          </span>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="compact"
              iconOnly
              onClick={() => void handleGenerateCommitMessage()}
              disabled={isGenerateDisabled}
              tooltip="Generate commit message with AI"
            >
              {isGenerating ? <Spinner label="Generating message" compact /> : <SparkleIcon />}
            </Button>
            <Button
              type="button"
              size="compact"
              onClick={() => void handleCommit()}
              disabled={isCommitDisabled}
              variant="accent"
              aria-label={isCommitting ? "Committing changes" : "Commit changes"}
            >
              {isCommitting ? <Spinner label="Committing changes" compact /> : "Commit"}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="compact"
                    iconOnly
                    disabled={isGenerating || isCommitting || isRemoteActionLoading}
                    tooltip="Commit options"
                  />
                }
              >
                {isRemoteActionLoading ? (
                  <Spinner label="Syncing changes" compact />
                ) : (
                  <ChevronDownIcon />
                )}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" size="compact">
                {hasRemoteChanges && (
                  <>
                    {ahead > 0 && (
                      <DropdownMenuItem
                        disabled={!repoPath}
                        onClick={() =>
                          void handleRemoteAction("push", () => pushChanges(repoPath!))
                        }
                      >
                        <ArrowUpIcon />
                        Push {ahead} commit{ahead !== 1 ? "s" : ""}
                      </DropdownMenuItem>
                    )}
                    {behind > 0 && (
                      <DropdownMenuItem
                        disabled={!repoPath}
                        onClick={() =>
                          void handleRemoteAction("pull", () => pullChanges(repoPath!))
                        }
                      >
                        <ArrowDownIcon />
                        Pull {behind} commit{behind !== 1 ? "s" : ""}
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuGroup>
                  <DropdownMenuLabel>AI message format</DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={commitMessageMode}
                    onValueChange={(value) => {
                      if (value === "title" || value === "body") setCommitMessageMode(value);
                    }}
                  >
                    <DropdownMenuRadioItem value="title">Title only</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="body">Title + body</DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </Composer>

      {error ? (
        <Alert tone="error">
          <WarningCircleIcon />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </section>
  );
};

export default GitCommitPanel;
