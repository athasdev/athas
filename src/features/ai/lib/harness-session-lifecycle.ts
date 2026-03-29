import { DEFAULT_HARNESS_SESSION_KEY } from "@/features/ai/lib/chat-scope";
import {
  DEFAULT_HARNESS_RUNTIME_BACKEND,
  type HarnessRuntimeBackend,
} from "@/features/ai/lib/harness-runtime-backend";
import type { Buffer } from "@/features/editor/stores/buffer-store";

type ClosedBufferHistorySource = Pick<
  Buffer,
  | "path"
  | "name"
  | "isPinned"
  | "isAgent"
  | "agentSessionId"
  | "agentBackend"
  | "isVirtual"
  | "isDiff"
  | "isImage"
  | "isSQLite"
  | "isMarkdownPreview"
  | "isHtmlPreview"
  | "isCsvPreview"
  | "isExternalEditor"
  | "isWebViewer"
  | "isPullRequest"
  | "isPdf"
  | "isTerminal"
>;

export type ClosedBufferHistoryEntry =
  | {
      kind: "file";
      path: string;
      name: string;
      isPinned: boolean;
    }
  | {
      kind: "agent";
      sessionId: string;
      backend: HarnessRuntimeBackend;
      name: string;
      isPinned: boolean;
    };

export const createClosedBufferHistoryEntry = (
  buffer: ClosedBufferHistorySource,
): ClosedBufferHistoryEntry | null => {
  if (buffer.isAgent) {
    return {
      kind: "agent",
      sessionId: buffer.agentSessionId ?? DEFAULT_HARNESS_SESSION_KEY,
      backend: buffer.agentBackend ?? DEFAULT_HARNESS_RUNTIME_BACKEND,
      name: buffer.name,
      isPinned: buffer.isPinned,
    };
  }

  if (
    buffer.isVirtual ||
    buffer.isDiff ||
    buffer.isImage ||
    buffer.isSQLite ||
    buffer.isMarkdownPreview ||
    buffer.isHtmlPreview ||
    buffer.isCsvPreview ||
    buffer.isExternalEditor ||
    buffer.isWebViewer ||
    buffer.isPullRequest ||
    buffer.isPdf ||
    buffer.isTerminal
  ) {
    return null;
  }

  return {
    kind: "file",
    path: buffer.path,
    name: buffer.name,
    isPinned: buffer.isPinned,
  };
};

export const getMostRecentClosedHarnessSession = (
  history: ClosedBufferHistoryEntry[],
): Extract<ClosedBufferHistoryEntry, { kind: "agent" }> | null => {
  return history.find((entry) => entry.kind === "agent") ?? null;
};

export const buildHarnessTransitionPromptMessage = (
  actionLabel: string,
  sessionNames: string[],
): string => {
  const visibleSessionNames = sessionNames.slice(0, 5);
  const remainingCount = sessionNames.length - visibleSessionNames.length;
  const sessionList = visibleSessionNames.map((name) => `• ${name}`).join("\n");
  const remainingLabel =
    remainingCount > 0
      ? `\n• ${remainingCount} more session${remainingCount === 1 ? "" : "s"}`
      : "";

  return [
    `The following Harness session${sessionNames.length === 1 ? " is" : "s are"} still running and will be stopped before ${actionLabel}:`,
    "",
    `${sessionList}${remainingLabel}`,
    "",
    "Continue?",
  ].join("\n");
};
