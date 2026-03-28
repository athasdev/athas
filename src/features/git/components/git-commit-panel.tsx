import { AlertCircle, Sparkles } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { useSettingsStore } from "@/features/settings/store";
import { useAuthStore } from "@/features/window/stores/auth-store";
import { Button } from "@/ui/button";
import Textarea from "@/ui/textarea";
import Tooltip from "@/ui/tooltip";
import { cn } from "@/utils/cn";
import {
  InlineEditError,
  requestInlineEdit,
} from "@/features/editor/services/editor-inline-edit-service";
import { commitChanges } from "../api/git-commits-api";
import type { GitFile } from "../types/git-types";

interface GitCommitPanelProps {
  stagedFilesCount: number;
  stagedFiles: GitFile[];
  currentBranch?: string;
  repoPath?: string;
  onCommitSuccess?: () => void;
}

const MAX_STAGED_FILES_FOR_AI_CONTEXT = 120;

const GitCommitPanel = ({
  stagedFilesCount,
  stagedFiles,
  currentBranch,
  repoPath,
  onCommitSuccess,
}: GitCommitPanelProps) => {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const subscription = useAuthStore((state) => state.subscription);
  const aiAutocompleteModelId = useSettingsStore((state) => state.settings.aiAutocompleteModelId);
  const [commitMessage, setCommitMessage] = useState("");
  const [isCommitting, setIsCommitting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

    const stagedLines = stagedFiles
      .slice(0, MAX_STAGED_FILES_FOR_AI_CONTEXT)
      .map((file) => `- ${file.status}: ${file.path}`)
      .join("\n");
    const overflowCount = Math.max(stagedFiles.length - MAX_STAGED_FILES_FOR_AI_CONTEXT, 0);
    const existingDraftHint = commitMessage.trim();
    const selectedText = [
      `Repository: ${repoPath}`,
      `Branch: ${currentBranch || "unknown"}`,
      `Staged files (${stagedFiles.length}):`,
      stagedLines || "- none",
      overflowCount > 0 ? `- ...and ${overflowCount} more staged files` : "",
      existingDraftHint ? `Current draft: ${existingDraftHint}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    setIsGenerating(true);
    try {
      const { editedText } = await requestInlineEdit(
        {
          model: aiAutocompleteModelId,
          beforeSelection: "",
          selectedText,
          afterSelection: "",
          instruction:
            "Generate a concise Git commit message from staged changes. Return only commit message text. Use imperative mood. Prefer conventional commit format when clear. Keep first line under 72 chars.",
          filePath: repoPath,
          languageId: "git-commit",
        },
        { useByok },
      );

      const message = editedText.trim();
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void handleCommit();
    }
  };

  const isCommitDisabled =
    !commitMessage.trim() || stagedFilesCount === 0 || isCommitting || isGenerating;
  const isGenerateDisabled = stagedFilesCount === 0 || isGenerating || isCommitting;

  return (
    <div className="overflow-hidden rounded-lg border border-border/60 bg-primary-bg/55">
      {error && (
        <div
          className={cn(
            "mx-2 mt-1.5 flex items-center gap-2 rounded border border-error/30",
            "bg-error/20 px-2 py-1 text-[0.84em] text-error",
          )}
        >
          <AlertCircle />
          {error}
        </div>
      )}

      <Textarea
        value={commitMessage}
        onChange={(e) => setCommitMessage(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Commit message..."
        variant="ghost"
        className={cn(
          "w-full resize-none bg-transparent px-2 py-1.5",
          "ui-font text-inherit text-text placeholder:text-text-lighter",
          "focus:outline-none",
        )}
        rows={2}
        disabled={isCommitting}
      />

      <div className="flex items-center justify-between px-2 py-1">
        <span className="text-[0.82em] text-text-lighter">
          {stagedFilesCount > 0
            ? `${stagedFilesCount} file${stagedFilesCount !== 1 ? "s" : ""} staged`
            : "No files staged"}
        </span>

        <div className="flex items-center gap-1">
          <Tooltip content="Generate commit message with AI" side="top">
            <span className="inline-flex">
              <Button
                onClick={() => void handleGenerateCommitMessage()}
                disabled={isGenerateDisabled}
                variant="ghost"
                size="icon-xs"
                className={cn(
                  isGenerateDisabled
                    ? "cursor-not-allowed text-text-lighter opacity-50"
                    : "text-text-lighter hover:text-text",
                )}
                aria-label="Generate commit message with AI"
              >
                <Sparkles />
              </Button>
            </span>
          </Tooltip>

          <Button
            onClick={() => void handleCommit()}
            disabled={isCommitDisabled}
            variant="ghost"
            size="xs"
            className={cn(
              isCommitDisabled
                ? "cursor-not-allowed text-text-lighter opacity-50"
                : "text-accent hover:text-accent/80",
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
