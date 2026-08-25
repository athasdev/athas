import {
  ArrowDownIcon as ArrowDown,
  ArrowUpIcon as ArrowUp,
  CaretDownIcon as ChevronDown,
  WarningCircleIcon as AlertCircle,
  SparkleIcon as Sparkles,
} from "@/ui/icons";
import type React from "react";
import { useLayoutEffect, useRef, useState } from "react";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useAuthStore } from "@/features/window/stores/auth.store";
import { hasProductCapability } from "@/features/window/lib/product-capabilities";
import { Alert, AlertDescription } from "@/ui/alert";
import { Button } from "@/ui/button";
import { ButtonGroup, ButtonGroupSeparator } from "@/ui/button-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown";
import { SidebarComposerBody } from "@/ui/sidebar";
import Textarea from "@/ui/textarea";
import { toast } from "sonner";
import { cn } from "@/utils/cn";
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

const COMMIT_TEXTAREA_MIN_HEIGHT = 64;
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
  const [isGenerateModeMenuOpen, setIsGenerateModeMenuOpen] = useState(false);
  const [remoteAction, setRemoteAction] = useState<"push" | "pull" | null>(null);
  const [error, setError] = useState<string | null>(null);
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
    if (!repoPath || !commitMessage.trim() || stagedFilesCount === 0) return;

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

  return (
    <>
      <SidebarComposerBody variant="plain">
        {error ? (
          <Alert tone="error" className="mx-2 mt-2 w-auto">
            <AlertCircle />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <Textarea
          ref={commitTextareaRef}
          value={commitMessage}
          onChange={(e) => setCommitMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Commit message..."
          variant="ghost"
          className={cn(
            "max-h-32 min-h-16 w-full resize-none overflow-x-hidden bg-transparent",
            "font-sans ui-text-sm px-3 pt-3 pb-2 text-foreground placeholder:text-subtle-foreground",
            "focus:outline-none",
          )}
          rows={2}
          disabled={isCommitting}
        />
      </SidebarComposerBody>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 pt-1.5">
        <div className="flex min-w-fit flex-1 flex-wrap items-center gap-1">
          <span className="whitespace-nowrap px-1 ui-text-sm text-subtle-foreground">
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
                  className="text-git-added hover:text-git-added"
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
                  className="text-git-deleted hover:text-git-deleted"
                  tooltip={`Pull ${behind} commit${behind !== 1 ? "s" : ""}`}
                >
                  <ArrowDown />
                  <span>{behind}</span>
                </Button>
              )}
            </div>
          )}
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1">
          <ButtonGroup>
            <Button
              type="button"
              variant="default"
              size="xs"
              onClick={() => void handleGenerateCommitMessage()}
              disabled={isGenerateDisabled}
              tooltip="Generate commit message with AI"
              aria-label="Generate commit message with AI"
            >
              <Sparkles />
            </Button>
            <ButtonGroupSeparator />
            <DropdownMenu open={isGenerateModeMenuOpen} onOpenChange={setIsGenerateModeMenuOpen}>
              <DropdownMenuTrigger
                render={
                  <Button
                    type="button"
                    variant="default"
                    size="icon-xs"
                    disabled={isGenerating || isCommitting}
                    active={isGenerateModeMenuOpen}
                    tooltip="Commit message format"
                    aria-label="Commit message format"
                  />
                }
              >
                <ChevronDown />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-37.5">
                <DropdownMenuRadioGroup
                  value={commitMessageMode}
                  onValueChange={(value) => {
                    if (value === "title" || value === "body") setCommitMessageMode(value);
                  }}
                >
                  <DropdownMenuRadioItem value="title">Title only</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="body">Title + body</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </ButtonGroup>

          <Button
            type="button"
            onClick={() => void handleCommit()}
            disabled={isCommitDisabled}
            variant="accent"
            size="xs"
          >
            {isCommitting ? "Committing..." : "Commit"}
          </Button>
        </div>
      </div>
    </>
  );
};

export default GitCommitPanel;
