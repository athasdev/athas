import { toast } from "sonner";
import {
  InlineEditError,
  requestInlineEdit,
} from "@/features/ai/intelligence/services/intelligence-text-service";
import { AutocompleteModelRequiredError } from "@/features/ai/intelligence/services/intelligence-connection";
import { useIntelligenceSettingsStore } from "@/features/ai/intelligence/stores/intelligence-settings.store";
import { loadAgentContextPolicy } from "@/features/ai/services/agent-context-policy";
import { onProviderApiTokenChange } from "@/features/ai/services/ai-token-service";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { useDiagnosticsStore } from "@/features/diagnostics/stores/diagnostics.store";
import {
  type IntelligenceCompletionPauseReason,
  useIntelligenceCompletionStore,
} from "@/features/editor/stores/intelligence-completion.store";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { getLanguageIdFromPath } from "@/features/editor/services/language-id";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useAuthStore } from "@/features/auth/stores/auth.store";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import {
  clearRecentEdits,
  getNearbyDiagnostics,
  getRecentEdits,
  getRelatedFileSnippets,
  type RelatedFileCandidate,
  SENSITIVE_FILE_PATTERN,
} from "./intelligence-completion-context";
import { readBufferText } from "@/features/editor/services/buffer-text";

/** How long typing has to pause before Tab autocomplete asks for a completion. */
export const INTELLIGENCE_COMPLETION_DEBOUNCE_MS = 350;
/** Text before the cursor sent as context. */
export const INTELLIGENCE_COMPLETION_PREFIX_CHARS = 12000;
/** Text after the cursor sent as context. */
export const INTELLIGENCE_COMPLETION_SUFFIX_CHARS = 4000;

const notifiedPauseReasons = new Set<IntelligenceCompletionPauseReason>();

const PAUSE_NOTICES: Record<IntelligenceCompletionPauseReason, string> = {
  credits:
    "Tab autocomplete is paused: there is no Athas AI credit left. Pro includes $10 of Athas AI every month, then pay as you go at list price +10%.",
  "sign-in": "Tab autocomplete is paused. Sign in to use Athas AI.",
  "api-key": "Tab autocomplete is paused because the selected provider needs an API key.",
  policy: "Tab autocomplete is disabled by your organization.",
  model: "Tab autocomplete is paused until you choose a model for it in Settings.",
};

function getPauseReason(error: InlineEditError): IntelligenceCompletionPauseReason | null {
  if (error.status === 401) return error.hosted ? "sign-in" : "api-key";
  if (error.status === 402) return error.hosted ? "credits" : "api-key";
  // Only Athas enforces organization policy; a provider's own 403 is an ordinary failure.
  if (error.status === 403 && error.hosted) return "policy";
  return null;
}

/** Pauses Tab on account or billing errors so it stops retrying, and reports others once. */
function reportIntelligenceCompletionError(error: unknown) {
  const { actions } = useIntelligenceCompletionStore.getState();
  // Tab on Automatic with nothing to run on: the status indicator says so, without a notice.
  if (error instanceof AutocompleteModelRequiredError) {
    actions.pause("model", error.message);
    return;
  }
  if (error instanceof InlineEditError) {
    const reason = getPauseReason(error);
    if (reason) {
      actions.pause(reason, error.message);
      // One notice per reason per session; after that the status indicator carries it. A
      // signed-out user only sees the indicator, since the notice is for lost sessions.
      const notify = reason !== "sign-in" || useAuthStore.getState().isAuthenticated;
      if (notify && !notifiedPauseReasons.has(reason)) {
        notifiedPauseReasons.add(reason);
        toast.warning(PAUSE_NOTICES[reason]);
      }
      return;
    }
    actions.fail(error.message);
    return;
  }
  // Provider SDK and network errors: keep their own message, so the status menu says what
  // actually went wrong instead of a generic failure.
  const { message, status, name } = describeUnknownError(error);
  if (name === "AI_LoadAPIKeyError" || status === 401 || status === 402) {
    actions.pause("api-key", message ?? PAUSE_NOTICES["api-key"]);
    return;
  }
  actions.fail(message ?? "Tab autocomplete failed. Try again.");
}

const MAX_ERROR_MESSAGE_CHARS = 240;

function describeUnknownError(error: unknown): {
  message: string | null;
  status: number | null;
  name: string | null;
} {
  const raw =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : error && typeof error === "object" && "message" in error
          ? String((error as { message: unknown }).message)
          : "";
  const status =
    error && typeof error === "object" && "statusCode" in error
      ? Number((error as { statusCode: unknown }).statusCode) || null
      : null;
  const name = error instanceof Error ? error.name : null;
  const firstLine = raw.trim().split(/\r?\n/, 1)[0] ?? "";
  const message =
    firstLine.length > MAX_ERROR_MESSAGE_CHARS
      ? `${firstLine.slice(0, MAX_ERROR_MESSAGE_CHARS - 1)}…`
      : firstLine;
  return { message: message || null, status, name };
}

/**
 * Drops the end of a multi-line completion when it repeats the text that already follows
 * the cursor, such as a closing brace the model wrote again.
 */
export function trimSuffixOverlap(completion: string, suffix: string) {
  const nextLine = suffix.split(/\r?\n/, 1)[0].trim();
  if (!nextLine || !completion.includes("\n")) return completion;
  const trimmed = completion.trimEnd();
  if (!trimmed.endsWith(nextLine)) return completion;
  const withoutOverlap = trimmed.slice(0, trimmed.length - nextLine.length);
  return withoutOverlap.trim() ? withoutOverlap.replace(/[ \t]+$/, "") : completion;
}

/** Whether Tab autocomplete may run for a file right now, before any context is gathered. */
export function canRequestIntelligenceCompletion(filePath: string) {
  return (
    Boolean(filePath) &&
    useSettingsStore.getState().settings.aiCompletion &&
    useIntelligenceCompletionStore.getState().status.kind !== "paused" &&
    !SENSITIVE_FILE_PATTERN.test(filePath)
  );
}

export interface IntelligenceCompletionRequest {
  filePath: string;
  languageId: string;
  beforeSelection: string;
  afterSelection: string;
  /** One-based line of the cursor. */
  line: number;
  /** Aborted by the editor when the text or cursor moves on. */
  signal: AbortSignal;
}

/**
 * Asks the configured model for a completion at the cursor. Resolves to the text to show as
 * ghost text, or null when there is nothing to show or the request was overtaken.
 */
export async function requestIntelligenceCompletion(
  request: IntelligenceCompletionRequest,
): Promise<string | null> {
  const { filePath, beforeSelection, afterSelection, line } = request;
  if (!canRequestIntelligenceCompletion(filePath) || !beforeSelection.trim()) return null;
  if (request.signal.aborted) return null;

  const controller = new AbortController();
  const abort = () => controller.abort();
  request.signal.addEventListener("abort", abort);
  const unsubscribers = [
    useAuthStore.subscribe((next, previous) => {
      if (next.user?.id !== previous.user?.id || next.subscription !== previous.subscription)
        abort();
    }),
    useIntelligenceSettingsStore.subscribe((next, previous) => {
      if (next.scope !== previous.scope || next.preferences !== previous.preferences) abort();
    }),
    useSettingsStore.subscribe((next, previous) => {
      if (next.settings !== previous.settings) abort();
    }),
    useProjectStore.subscribe((next, previous) => {
      if (next.rootFolderPath !== previous.rootFolderPath) abort();
    }),
  ];
  const recentEdits = getRecentEdits(filePath, line);
  const diagnostics = getNearbyDiagnostics(
    useDiagnosticsStore.getState().diagnosticsByFile.get(filePath) ?? [],
    line,
  );
  const relatedFiles = getRelatedFileSnippets(
    filePath,
    request.languageId,
    beforeSelection,
    getOpenFileCandidates(),
  );
  const status = useIntelligenceCompletionStore.getState().actions;
  status.requestStarted();
  try {
    const projectRoot = useProjectStore.getState().rootFolderPath;
    if (projectRoot) {
      const allowsPath = await loadAgentContextPolicy(projectRoot);
      if (!allowsPath(filePath)) return null;
    }
    if (controller.signal.aborted) return null;
    const { editedText } = await requestInlineEdit(
      {
        feature: "autocomplete",
        model: "",
        beforeSelection,
        selectedText: "",
        afterSelection,
        filePath,
        languageId: request.languageId,
        instruction:
          "Insert a completion at the cursor. Finish the whole statement or block when the next step is clear.",
        ...(recentEdits.length ? { recentEdits } : {}),
        ...(diagnostics.length ? { diagnostics } : {}),
        ...(relatedFiles.length ? { relatedFiles } : {}),
      },
      { signal: controller.signal, timeoutMs: 10000 },
    );
    if (controller.signal.aborted || !editedText || afterSelection.startsWith(editedText)) {
      return null;
    }
    return trimSuffixOverlap(editedText, afterSelection);
  } catch (error) {
    if (!controller.signal.aborted) reportIntelligenceCompletionError(error);
    return null;
  } finally {
    status.requestFinished();
    request.signal.removeEventListener("abort", abort);
    for (const unsubscribe of unsubscribers) unsubscribe();
  }
}

/** Open text files that may be worth summarizing for the model. */
function getOpenFileCandidates(): RelatedFileCandidate[] {
  return useBufferStore.getState().buffers.flatMap((buffer) =>
    buffer.type === "editor" && !buffer.isVirtual && buffer.path
      ? [
          {
            path: buffer.path,
            content: readBufferText(buffer),
            languageId: buffer.languageOverride ?? getLanguageIdFromPath(buffer.path),
          },
        ]
      : [],
  );
}

let resumeRegistered = false;

/**
 * Lifts a Tab autocomplete pause once whatever caused it may have changed: the account, the
 * intelligence preferences, the provider's API key, or the selected provider and model.
 */
export function registerIntelligenceCompletionResume() {
  if (resumeRegistered) return;
  resumeRegistered = true;

  const resume = () => {
    if (useIntelligenceCompletionStore.getState().status.kind !== "idle") {
      useIntelligenceCompletionStore.getState().actions.resume();
    }
  };
  useAuthStore.subscribe((next, previous) => {
    if (
      next.user?.id !== previous.user?.id ||
      next.isAuthenticated !== previous.isAuthenticated ||
      next.subscription !== previous.subscription
    )
      resume();
  });
  useIntelligenceSettingsStore.subscribe((next, previous) => {
    if (next.scope !== previous.scope || next.preferences !== previous.preferences) resume();
  });
  onProviderApiTokenChange(resume);
  // Edits from the previous project say nothing about the next one.
  useProjectStore.subscribe((next, previous) => {
    if (next.rootFolderPath !== previous.rootFolderPath) clearRecentEdits();
  });
  useAIChatStore.subscribe((next, previous) => {
    if (next.providerApiKeys !== previous.providerApiKeys) resume();
  });
  useSettingsStore.subscribe((next, previous) => {
    if (
      next.settings.aiProviderId !== previous.settings.aiProviderId ||
      next.settings.aiModelId !== previous.settings.aiModelId
    )
      resume();
  });
}
