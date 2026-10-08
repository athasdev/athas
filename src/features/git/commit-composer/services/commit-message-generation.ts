import {
  InlineEditError,
  requestInlineEdit,
} from "@/features/ai/intelligence/services/intelligence-text-service";
import type { GitFile } from "../../types/git.types";
import {
  buildCommitMessageContext,
  normalizeGeneratedCommitMessage,
  type CommitMessageMode,
} from "../utils/commit-message-context";

const INSTRUCTIONS: Record<CommitMessageMode, string> = {
  title:
    "Generate a concise Git commit subject from the staged changes. Return exactly one subject line and nothing else. Keep it under 72 characters when possible. Infer and match the repository's style from recent commit subjects. Do not force conventional commit format unless the recent commits clearly use it.",
  body: "Generate a Git commit message from the staged changes. Return a subject line and a short body only when the body adds useful context. Keep the subject under 72 characters when possible. Infer and match the repository's style from recent commit subjects. Do not force conventional commit format unless the recent commits clearly use it.",
};

interface GenerateCommitMessageOptions {
  model: string;
  repoPath: string;
  currentBranch?: string;
  stagedFiles: GitFile[];
  /** What the user already typed, passed to the model as a hint. */
  draft: string;
  mode: CommitMessageMode;
}

const getRepoLabel = (repoPath: string): string => {
  const normalized = repoPath.replace(/\\/g, "/").replace(/\/$/, "");
  return normalized.split("/").pop() || "repository";
};

/**
 * Asks the AI model for a commit message describing the staged changes. Every commit composer
 * goes through here, so the Git sidebar reaches the AI feature from one place. Resolves to an
 * empty string when the model returns nothing usable.
 */
export async function generateCommitMessage({
  model,
  repoPath,
  currentBranch,
  stagedFiles,
  draft,
  mode,
}: GenerateCommitMessageOptions): Promise<string> {
  const selectedText = await buildCommitMessageContext({
    repoPath,
    currentBranch,
    stagedFiles,
    existingDraftHint: draft.trim(),
  });
  const { editedText } = await requestInlineEdit({
    model,
    feature: "commit-message",
    beforeSelection: "",
    selectedText,
    afterSelection: "",
    instruction: INSTRUCTIONS[mode],
    filePath: getRepoLabel(repoPath),
    languageId: "git-commit",
  });
  return normalizeGeneratedCommitMessage(editedText, mode);
}

/** The AI service's own explanation of a failed generation when it gave one, else `fallback`. */
export function getCommitMessageGenerationError(error: unknown, fallback: string): string {
  return error instanceof InlineEditError ? error.message : fallback;
}
